import { Location, isPlatformBrowser } from '@angular/common';
import { Injectable, OnDestroy, PLATFORM_ID, afterNextRender, computed, inject, signal } from '@angular/core';
import { LeanModel } from '../lean-model';
import { defaultScenario, presentationScenarios, scenarios } from './data';
import type { Decisions, Subject } from './decide';
import type { Setting } from './rules/support/readings';
import { type Action, next, type Step } from './trip-steps';

export type { Action, Step } from './trip-steps';

/** The steps at which the wallet holds the boarding pass. */
export const PASS_HELD: readonly Step[] = ['passAdded', 'gateAsked', 'gateDeclined', 'presented'];

export interface TripState {
  /** Grows with each change, so a surface takes only news. */
  rev: number;
  step: Step;
  /** The traveler the presenter picked.  With the model hidden, the trip is always the default scenario. */
  scenarioId: string;
  /** What has been decided.  Nothing is, to begin with: the site chooses nothing for the business. */
  decisions: Decisions;
}

type Message = { type: 'hello' } | { type: 'state'; state: TripState };

const CHANNEL = 'verified-airline-one-id';

/**
 * The trip the three surfaces share.  They talk through a BroadcastChannel, so
 * a laptop can show the website, the wallet and the gate reader side by side in
 * one browser.  A new tab says hello and any tab further along answers with
 * where the trip stands.  Only the step, the traveler and the decisions travel;
 * each surface computes its own results from them.
 */
@Injectable({ providedIn: 'root' })
export class Trip implements OnDestroy {
  private readonly lean = inject(LeanModel);
  private readonly channel = isPlatformBrowser(inject(PLATFORM_ID)) && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  private readonly state = signal<TripState>({ rev: 0, step: 'start', scenarioId: defaultScenario.id, decisions: {} });

  readonly step = computed(() => this.state().step);
  readonly decisions = computed(() => this.state().decisions);
  readonly pickedId = computed(() => this.state().scenarioId);
  /** The traveler whose credentials the website and the wallet show.  A presentation picked on the panel leaves them on the default trip. */
  readonly scenario = computed(() => (this.lean.shown() ? (scenarios.find((s) => s.id === this.state().scenarioId) ?? defaultScenario) : defaultScenario));
  /** What the gate is asked about: the picked presentation, or the traveler. */
  readonly subject = computed<Subject>(() => (this.lean.shown() ? presentationScenarios.find((s) => s.id === this.state().scenarioId) : undefined) ?? this.scenario());

  constructor() {
    if (!this.channel) return;
    this.channel.onmessage = (event: MessageEvent<Message>) => {
      const message = event.data;
      if (message.type === 'hello') {
        if (this.state().rev > 0) this.post({ type: 'state', state: this.state() });
      } else if (message.state.rev > this.state().rev) {
        this.state.set(message.state);
      }
    };
    this.post({ type: 'hello' });
  }

  ngOnDestroy(): void {
    this.channel?.close();
  }

  private post(message: Message): void {
    this.channel?.postMessage(message);
  }

  private change(part: Partial<TripState>): void {
    // The clock lets a change in a new tab beat a trip older tabs still hold, which a count alone would not.
    const next = { ...this.state(), ...part, rev: Math.max(this.state().rev + 1, Date.now()) };
    this.state.set(next);
    this.post({ type: 'state', state: next });
  }

  /** Where the trip stands, for the relay to carry to another device. */
  snapshot(): TripState {
    return this.state();
  }

  /**
   * A trip another device sent through the relay.  It is taken as a tab takes one
   * from the BroadcastChannel, when it is newer, or always with `force`, and the
   * other tabs follow.  Like the tabs' messages, it is outside the trip's proofs.
   */
  adopt(state: TripState, force = false): boolean {
    if (!force && state.rev <= this.state().rev) return false;
    const next = { ...state, rev: Math.max(state.rev, this.state().rev + 1) };
    this.state.set(next);
    this.post({ type: 'state', state: next });
    return true;
  }

  /** A traveler's action, by the model's steps.  One the current step does not allow changes nothing. */
  act(action: Action): void {
    const step = next(this.state().step, action);
    if (step) this.change({ step });
  }

  /**
   * The presenter's traveler or presentation goes straight to the gate reader.  This is
   * no part of a traveler's trip, so the model's theorems do not cover it, and it is
   * only on the panel, which shows only with the model.
   */
  pick(scenarioId: string): void {
    this.change({ scenarioId, step: 'presented' });
  }

  /** A fresh trip for a traveler, with nothing decided.  A tour's link starts here. */
  begin(scenarioId: string, step: Step): void {
    this.change({ scenarioId, step, decisions: {} });
  }

  /** Records a setting of a point, or null for "none of these", which keeps the trip stopped there. */
  set(point: string, value: Setting | null): void {
    this.change({ decisions: { ...this.state().decisions, [point]: value } });
  }

  undo(point: string): void {
    const { [point]: _removed, ...rest } = this.state().decisions;
    this.change({ decisions: rest });
  }

  clearDecisions(): void {
    this.change({ decisions: {} });
  }
}

/**
 * For a screen's constructor.  A tour's link names a traveler, as in
 * /gate?traveler=two-john-smiths: this starts a fresh trip for them at this screen,
 * then takes the query out of the address so a reload keeps the trip.  It waits for
 * the first render, which has to match the page as it was prerendered.  Going straight
 * to the gate skips the traveler's consent, so that happens only with the model shown,
 * as the presenter's picks do.
 */
export function startFromTourLink(step: Step): void {
  const trip = inject(Trip);
  const location = inject(Location);
  const lean = inject(LeanModel);
  afterNextRender(() => {
    const [path, query] = location.path().split('?');
    const id = new URLSearchParams(query).get('traveler');
    if (!id) return;
    const known = [...scenarios, ...presentationScenarios].some((s) => s.id === id);
    if (known && (step !== 'presented' || lean.shown())) trip.begin(id, step);
    location.replaceState(path);
  });
}
