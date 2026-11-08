// The relay that lets the demo span devices: a laptop on the check-in page, a
// phone running the wallet, a tablet running the gate reader.  It carries one
// exchange at a time: the request a screen makes of a wallet, and the wallet's
// answer.  It is transport, and the Lean model holds none.  The wallet's checks
// run on the request it receives and the asking screen's checks run on the answer
// it receives, as they do on one device (presentation-checks.ts, Relayed).
//
// With the request and the answer travels what tabs pass each other through the
// BroadcastChannel: the step, the traveler and the decisions, taken unchecked.
// After a share at check-in the website also sends the boarding pass it signed,
// so the phone's wallet holds it at the gate.  The answer carries the signed
// credentials the wallet presents, and the asking screen checks their signatures
// before its checks run (signatures.ts).
//
// The server is the VerifiedAirlineOneId stack in infra/.  Its address comes from
// /one-id-relay.json, which scripts/publish-site.sh writes from the stack's output;
// with none, the panels say so and the wallet on the same device still works.
import { Location, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, type WritableSignal, afterNextRender, effect, inject, signal, untracked } from '@angular/core';
import type { PresentationRequest, WalletResponse } from './rules/support/exchange';
import type { AuthorizationRequest } from './rules/support/openid4vp';
import { Signatures } from './signatures';
import { fromBase64Url } from './signing/credential';
import { Trip, type TripState } from './trip';
import { stopIndex } from './trip-route';
import type { Step } from './trip-steps';

export type RelayFor = 'check-in' | 'gate';

/** What the asking screen sends: the relying party's request, its authorization request for OpenID4VP, and the trip. */
export interface RelayedRequest {
  for: RelayFor;
  request: PresentationRequest;
  authorization: AuthorizationRequest | null;
  trip: TripState;
}

/**
 * What the wallet sends back.  A share carries the response and, for each of its
 * documents, the signed credential narrowed to what it holds, as base64url.  A
 * decline carries no credential.
 */
export type RelayedAnswer = { answer: 'shared'; response: WalletResponse; credentials: (string | null)[]; trip: TripState } | { answer: 'declined'; trip: TripState };

/** A response this device received, with the signed credentials that came with it; null when none came, which the signature check refuses. */
export interface Received {
  response: WalletResponse;
  credentials: (string | null)[] | null;
}

export type AskState = 'idle' | 'starting' | 'waiting' | 'answered' | 'declined' | 'expired' | 'failed' | 'unconfigured';

/** An asking screen's session on this device. */
export interface Asking {
  state: AskState;
  id: string | null;
  /** The wallet's address with the session, for the code and the link. */
  link: string | null;
  /** The trip's rev when the code was shown.  The answer's trip is taken whole if this trip has not moved since. */
  sentRev: number;
  until: number;
  /** A share at check-in, after which the website sends the boarding pass once. */
  passDue: boolean;
}

export type JoinState = 'loading' | 'open' | 'sent' | 'passAdded' | 'declined' | 'answered' | 'expired' | 'failed' | 'unconfigured' | 'noPass';

/** The session the wallet on this device joined from a code. */
export interface Joined {
  id: string;
  state: JoinState;
  request: RelayedRequest | null;
}

/** How long a session lasts: SESSION_SECONDS in infra/verified_airline_infra/one_id_stack.py. */
export const SESSION_MS = 10 * 60 * 1000;
export const SESSION_ID = /^[A-Za-z0-9_-]{22}$/;
/** Where a phone keeps the trip the relay last moved, so a second tab opened by a code finds it. */
const HANDOFF = 'verified-airline-one-id-relay';
const IDLE: Asking = { state: 'idle', id: null, link: null, sentRev: 0, until: 0, passDue: false };

type Part = { kind: 'part'; value: unknown } | { kind: 'none' } | { kind: 'gone' } | { kind: 'error' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A trip as the relay carries it, with a step of the trip's model. */
export const isTripState = (v: unknown): v is TripState =>
  isObject(v) && Number.isFinite(v['rev']) && typeof v['step'] === 'string' && stopIndex(v['step'] as Step) >= 0 && typeof v['scenarioId'] === 'string' && isObject(v['decisions']);

const isRequest = (v: unknown): v is RelayedRequest =>
  isObject(v) && (v['for'] === 'check-in' || v['for'] === 'gate') && isObject(v['request']) && Array.isArray(v['request']['elements'])
  && (v['authorization'] === null || isObject(v['authorization'])) && isTripState(v['trip']);

const isAnswer = (v: unknown): v is RelayedAnswer =>
  isObject(v) && isTripState(v['trip'])
  && (v['answer'] === 'declined' || (v['answer'] === 'shared' && isObject(v['response']) && Array.isArray(v['response']['documents'])));

/** The signed credentials an answer carries, or null when it carries none in the expected form. */
const credentialsOf = (v: Record<string, unknown>): (string | null)[] | null =>
  Array.isArray(v['credentials']) && v['credentials'].every((c) => c === null || typeof c === 'string') ? (v['credentials'] as (string | null)[]) : null;

function remember(trip: TripState): void {
  try {
    localStorage.setItem(HANDOFF, JSON.stringify({ trip, at: Date.now() }));
  } catch {
    // private browsing
  }
}

function recall(): TripState | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(HANDOFF) ?? 'null');
    return isObject(saved) && typeof saved['at'] === 'number' && Date.now() - saved['at'] < SESSION_MS && isTripState(saved['trip']) ? saved['trip'] : null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class Relay {
  private readonly trip = inject(Trip);
  private readonly signatures = inject(Signatures);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private config: Promise<string | null> | null = null;
  /** How often a screen asks the relay for news. */
  pollMs = 2000;

  /** Each asking screen's session on this device. */
  readonly asking: Readonly<Record<RelayFor, WritableSignal<Asking>>> = { 'check-in': signal(IDLE), gate: signal(IDLE) };
  /** The responses this device received, by the screen that asked.  That screen checks their signatures, and its checks run on them. */
  readonly received = signal<Partial<Record<RelayFor, Received>>>({});
  readonly joined = signal<Joined | null>(null);

  constructor() {
    let last: Step | null = null;
    effect(() => {
      const step = this.trip.step();
      untracked(() => {
        // A trip started again leaves nothing of the last one's exchanges.
        if (step === 'start' && last !== null && last !== 'start') this.reset();
        // The boarding pass added, by the website's button or its map.
        if (step === 'passAdded' && last !== 'passAdded') void this.sendPass();
        last = step;
      });
    });
  }

  /** The relay's address, from /one-id-relay.json, or null when this copy of the site has none. */
  url(): Promise<string | null> {
    if (!this.browser) return Promise.resolve(null);
    this.config ??= fetch('/one-id-relay.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((c: unknown) => (isObject(c) && typeof c['url'] === 'string' && /^https?:\/\/[^/]+/.test(c['url']) ? c['url'].replace(/\/+$/, '') : null))
      .catch(() => {
        this.config = null;
        return null;
      });
    return this.config;
  }

  /** Starts a session with this screen's request, for a wallet on another device, and waits for its answer. */
  async ask(kind: RelayFor, request: Pick<RelayedRequest, 'request' | 'authorization'>): Promise<void> {
    const s = this.asking[kind];
    if (s().state === 'starting' || s().state === 'waiting') return;
    s.set({ ...IDLE, state: 'starting' });
    const url = await this.url();
    if (s().state !== 'starting') return;
    if (!url) return s.set({ ...IDLE, state: 'unconfigured' });
    const trip = this.trip.snapshot();
    try {
      // A text body and no headers keep this a simple request, which needs no preflight.
      const res = await fetch(`${url}/sessions`, { method: 'POST', body: JSON.stringify({ for: kind, ...request, trip }) });
      const created: unknown = res.status === 201 ? await res.json() : null;
      const id = isObject(created) ? created['id'] : null;
      if (typeof id !== 'string' || !SESSION_ID.test(id)) throw new Error(`the relay answered ${res.status}`);
      if (s().state !== 'starting') return;
      s.set({ state: 'waiting', id, link: `${location.origin}/wallet?session=${id}`, sentRev: trip.rev, until: Date.now() + SESSION_MS, passDue: false });
      this.later(() => this.awaitAnswer(kind, url, id));
    } catch {
      if (s().state === 'starting') s.set({ ...IDLE, state: 'failed' });
    }
  }

  private async awaitAnswer(kind: RelayFor, url: string, id: string): Promise<void> {
    const s = this.asking[kind];
    const current = () => s().id === id && s().state === 'waiting';
    if (!current()) return;
    if (Date.now() > s().until) return s.update((a) => ({ ...a, state: 'expired' }));
    const got = await this.get(url, id, 'response');
    if (!current()) return;
    if (got.kind === 'gone') return s.update((a) => ({ ...a, state: 'expired' }));
    if (got.kind !== 'part' || !isAnswer(got.value)) return this.later(() => this.awaitAnswer(kind, url, id));
    const answer = got.value;
    if (answer.answer === 'shared') this.received.update((r) => ({ ...r, [kind]: { response: answer.response, credentials: credentialsOf(answer) } }));
    // Taken whole if this trip has not moved since the code was shown, and otherwise only if newer, as a tab's.
    if (!this.trip.adopt(answer.trip, this.trip.snapshot().rev === s().sentRev)) {
      this.received.update(({ [kind]: _stale, ...rest }) => rest);
      return s.set(IDLE);
    }
    s.update((a) => ({ ...a, state: answer.answer === 'shared' ? 'answered' : 'declined', passDue: answer.answer === 'shared' && kind === 'check-in' }));
  }

  /** After a share from a phone at check-in, sends that phone's wallet the boarding pass the website signed. */
  private async sendPass(): Promise<void> {
    const a = this.asking['check-in']();
    if (!a.passDue || !a.id) return;
    this.asking['check-in'].update((x) => ({ ...x, passDue: false }));
    const trip = this.trip.snapshot();
    const url = await this.url();
    if (!url) return;
    try {
      const credential = await this.signatures.held64(this.trip.scenario(), 'boardingPass');
      await fetch(`${url}/sessions/${a.id}/pass`, { method: 'POST', body: JSON.stringify({ trip, credential }) });
    } catch {
      // The phone keeps the trip it has.
    }
  }

  /** Joins a session from a code: takes the request and the trip, and opens the consent sheet. */
  async join(id: string): Promise<void> {
    const set = (state: JoinState, request: RelayedRequest | null = null) => this.joined.set({ id, state, request });
    if (!SESSION_ID.test(id)) return set('expired');
    set('loading');
    const saved = recall();
    if (saved) this.trip.adopt(saved);
    const url = await this.url();
    if (!url) return set('unconfigured');
    const got = await this.get(url, id, 'request');
    if (got.kind === 'gone') return set('expired');
    if (got.kind !== 'part' || !isRequest(got.value)) return set('failed');
    const request = got.value;
    const answered = await this.get(url, id, 'response');
    if (answered.kind === 'part') {
      // Opened again after answering, as by a reload.
      const shared = isAnswer(answered.value) && answered.value.answer === 'shared';
      if (shared && request.for === 'check-in') {
        set('sent', request);
        this.later(() => this.awaitPass(url, id, Date.now() + SESSION_MS));
      } else {
        set('answered', request);
      }
      return;
    }
    if (request.for === 'check-in') {
      // Check-in is where a trip starts, so the wallet takes the website's trip whole and opens.
      this.trip.adopt(request.trip, true);
      if (this.trip.step() === 'start' || this.trip.step() === 'declined') this.trip.act('openWallet');
    } else {
      // The gate reader may know less of the trip than this wallet does.
      this.trip.adopt(request.trip);
      const step = this.trip.step();
      if (step === 'passAdded' || step === 'gateDeclined') this.trip.act('present');
      else if (step !== 'gateAsked') return set('noPass', request);
    }
    remember(this.trip.snapshot());
    set('open', request);
  }

  /** The wallet's answer, once the traveler has chosen on the consent sheet and the trip has moved.  A share carries the signed credentials. */
  async answer(answer: 'shared' | 'declined', response: WalletResponse | null, credentials: (string | null)[] = []): Promise<void> {
    const j = this.joined();
    if (!j?.request || j.state !== 'open') return;
    const trip = this.trip.snapshot();
    remember(trip);
    const url = await this.url();
    if (!url) return this.joined.set({ ...j, state: 'failed' });
    try {
      const res = await fetch(`${url}/sessions/${j.id}/response`, { method: 'POST', body: JSON.stringify(answer === 'shared' ? { answer, response, credentials, trip } : { answer, trip }) });
      if (res.status === 404) return this.joined.set({ ...j, state: 'expired' });
      if (res.status === 409) return this.joined.set({ ...j, state: 'answered' });
      if (!res.ok) throw new Error(`the relay answered ${res.status}`);
    } catch {
      return this.joined.set({ ...j, state: 'failed' });
    }
    this.joined.set({ ...j, state: answer === 'shared' ? 'sent' : 'declined' });
    if (answer === 'shared' && j.request.for === 'check-in') this.later(() => this.awaitPass(url, j.id, Date.now() + SESSION_MS));
  }

  private async awaitPass(url: string, id: string, until: number): Promise<void> {
    const current = () => this.joined()?.id === id && this.joined()?.state === 'sent';
    if (!current() || Date.now() > until) return;
    const got = await this.get(url, id, 'pass');
    if (!current() || got.kind === 'gone') return;
    if (got.kind === 'part' && isObject(got.value) && isTripState(got.value['trip'])) {
      const pass = typeof got.value['credential'] === 'string' ? fromBase64Url(got.value['credential']) : null;
      if (pass) this.signatures.keep(got.value['trip'].scenarioId, 'boardingPass', pass);
      this.trip.adopt(got.value['trip']);
      remember(this.trip.snapshot());
      return this.joined.update((j) => j && { ...j, state: 'passAdded' });
    }
    this.later(() => this.awaitPass(url, id, until));
  }

  /** One part of a session: its JSON, none before it is written, gone with the session, or an error. */
  private async get(url: string, id: string, part: 'request' | 'response' | 'pass'): Promise<Part> {
    try {
      const res = await fetch(`${url}/sessions/${id}/${part}`);
      if (res.status === 204) return { kind: 'none' };
      if (res.status === 404) return { kind: 'gone' };
      if (!res.ok) return { kind: 'error' };
      return { kind: 'part', value: await res.json() };
    } catch {
      return { kind: 'error' };
    }
  }

  private later(next: () => Promise<void>): void {
    setTimeout(() => void next(), this.pollMs);
  }

  private reset(): void {
    for (const s of Object.values(this.asking)) s.set(IDLE);
    this.received.set({});
    this.joined.set(null);
  }
}

/**
 * For the wallet's constructor.  A code's link, /wallet?session=<id>, joins that
 * session once the page has drawn, since the first render has to match the page as
 * it was prerendered.  The link stays in the address, so a reload joins again.
 */
export function joinFromLink(): void {
  const relay = inject(Relay);
  const location = inject(Location);
  afterNextRender(() => {
    const id = new URLSearchParams(location.path().split('?')[1] ?? '').get('session');
    if (id) void relay.join(id);
  });
}
