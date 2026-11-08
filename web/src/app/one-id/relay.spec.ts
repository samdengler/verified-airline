// The relay between devices, against a relay kept in memory.  One test bed is one
// device, so each test plays one side and writes the other side's part by hand.
// The point of these tests: the relay only carries, and the checks still decide.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CheckIn } from './check-in';
import { defaultScenario, wording } from './data';
import { viewChecks } from './decide';
import { checkInPresentation, gatePresentation, requestToSend } from './presentation-checks';
import { qrCode } from './qr';
import { Relay, type RelayedAnswer, type RelayedRequest, SESSION_ID } from './relay';
import { Trip } from './trip';
import { Wallet } from './wallet';

const URL = 'https://relay.test';

/** The relay's three routes on a map, as infra/verified_airline_infra/functions/relay/relay.py answers them. */
class MemoryRelay {
  readonly sessions = new Map<string, Record<string, string>>();
  configured: string | null = URL;
  private next = 0;

  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    if (input === '/one-id-relay.json') return Response.json({ url: this.configured });
    const path = input.slice(URL.length).split('/').filter(Boolean);
    const method = init?.method ?? 'GET';
    if (method === 'POST' && path.length === 1) {
      const id = `session${String(this.next++).padStart(15, '0')}`;
      this.sessions.set(id, { request: String(init!.body) });
      return Response.json({ id }, { status: 201 });
    }
    const [, id, part] = path;
    const session = this.sessions.get(id);
    if (!session) return new Response(null, { status: 404 });
    if (method === 'POST') {
      if (part in session || (part === 'pass' && !('response' in session))) return new Response(null, { status: 409 });
      session[part] = String(init!.body);
      return new Response(null, { status: 204 });
    }
    return part in session ? new Response(session[part], { status: 200 }) : new Response(null, { status: 204 });
  };

  part<T>(id: string, part: string): T | undefined {
    const v = this.sessions.get(id)?.[part];
    return v === undefined ? undefined : JSON.parse(v);
  }

  /** Starts a session as another device would. */
  start(request: RelayedRequest): string {
    const id = `other${String(this.next++).padStart(17, '0')}`;
    this.sessions.set(id, { request: JSON.stringify(request) });
    return id;
  }
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) {
    TestBed.tick();
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(done()).toBe(true);
}

describe('the relay between devices', () => {
  let memory: MemoryRelay;
  let relay: Relay;
  let trip: Trip;
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    document.documentElement.classList.remove('lean-on');
    localStorage.clear();
    memory = new MemoryRelay();
    globalThis.fetch = memory.fetch as typeof fetch;
    await TestBed.configureTestingModule({ providers: [provideRouter([])] }).compileComponents();
    relay = TestBed.inject(Relay);
    relay.pollMs = 5;
    trip = TestBed.inject(Trip);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('draws a code with its finder patterns and quiet zone', () => {
    const { size, d } = qrCode('https://air.dengler.io/wallet?session=AbCdEfGhIjKlMnOpQrStUv');
    expect(size).toBe(33 + 8);
    // The top-left finder pattern starts after four modules of quiet zone.
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true);
    expect(d).not.toContain('M0 0');
  });

  it("the website's request goes out, and the phone's answer moves the trip as a wallet tab would", async () => {
    await relay.ask('check-in', requestToSend(checkInPresentation(defaultScenario)));
    const asking = relay.asking['check-in']();
    expect(asking.state).toBe('waiting');
    expect(asking.link).toMatch(/\/wallet\?session=/);
    expect(SESSION_ID.test(asking.id!)).toBe(true);
    const sent = memory.part<RelayedRequest>(asking.id!, 'request')!;
    expect(sent.request).toEqual(checkInPresentation(defaultScenario).request);
    expect(trip.step()).toBe('start');

    // The phone opens the wallet and shares.
    const response = checkInPresentation(defaultScenario).response!;
    const phoneTrip = { ...sent.trip, step: 'shared' as const, rev: sent.trip.rev + 2 };
    memory.sessions.get(asking.id!)!['response'] = JSON.stringify({ answer: 'shared', response, trip: phoneTrip } satisfies RelayedAnswer);
    await until(() => trip.step() === 'shared');
    expect(relay.received()['check-in']).toEqual(response);

    // Adding the boarding pass, from the button or the map, sends it to the phone.
    trip.act('addPass');
    await until(() => memory.part(asking.id!, 'pass') !== undefined);
    expect(memory.part<{ trip: { step: string } }>(asking.id!, 'pass')!.trip.step).toBe('passAdded');

    trip.act('startAgain');
    await until(() => relay.asking['check-in']().state === 'idle');
    expect(relay.received()).toEqual({});
  });

  it('a response changed on the way is refused by the same checks', () => {
    const honest = checkInPresentation(defaultScenario).response!;
    const elsewhere = { documents: honest.documents.map((d) => ({ ...d, deviceSignature: { key: d.deviceKey, transcript: { iso: 'another session' } } })) };
    const state = (response: typeof honest) => viewChecks(checkInPresentation(defaultScenario, { response }), {}).find((c) => c.result.key === 'refusals')!.state;
    expect(state(honest)).toBe('passed');
    expect(state(elsewhere)).toBe('failed');
    expect(state({ documents: [] })).toBe('failed');
  });

  it('the check-in page checks the answer it received', async () => {
    const checkIn = TestBed.createComponent(CheckIn);
    await checkIn.whenStable();
    const honest = checkInPresentation(defaultScenario).response!;
    relay.received.set({ 'check-in': { documents: [] } });
    trip.act('openWallet');
    trip.act('share');
    await checkIn.whenStable();
    expect((checkIn.nativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(wording.traveler.checkIn.refusedTitle);
    relay.received.set({ 'check-in': honest });
    await checkIn.whenStable();
    expect((checkIn.nativeElement as HTMLElement).querySelector('h1')?.textContent).toMatch(/checked in/);
  });

  it("the phone's wallet opens the website's request, shares, and waits for the boarding pass", async () => {
    const other = { rev: 1000, step: 'start' as const, scenarioId: defaultScenario.id, decisions: {} };
    const id = memory.start({ for: 'check-in', ...requestToSend(checkInPresentation(defaultScenario)), trip: other });
    const wallet = TestBed.createComponent(Wallet);
    await wallet.whenStable();
    await relay.join(id);
    expect(relay.joined()?.state).toBe('open');
    expect(trip.step()).toBe('asked');
    await wallet.whenStable();
    const el = wallet.nativeElement as HTMLElement;
    expect(el.querySelector('[data-sheet="consent"]')?.getAttribute('data-relayed')).toBe('true');
    expect(el.querySelector('[data-panel="relay-wallet"]')?.textContent).toContain(wording.traveler.relay.wallet.title);

    (el.querySelector('[data-action="share"]') as HTMLButtonElement).click();
    await until(() => memory.part(id, 'response') !== undefined);
    const answer = memory.part<RelayedAnswer>(id, 'response')!;
    expect(answer.answer).toBe('shared');
    expect(answer.answer === 'shared' && answer.response).toEqual(checkInPresentation(defaultScenario).response);
    expect(answer.trip.step).toBe('shared');
    expect(answer.trip.rev).toBeGreaterThan(other.rev);

    memory.sessions.get(id)!['pass'] = JSON.stringify({ trip: { ...answer.trip, step: 'passAdded', rev: answer.trip.rev + 1 } });
    await until(() => relay.joined()?.state === 'passAdded');
    expect(trip.step()).toBe('passAdded');
  });

  it('a decline sends no credential', async () => {
    const id = memory.start({ for: 'check-in', ...requestToSend(checkInPresentation(defaultScenario)), trip: { rev: 1, step: 'start', scenarioId: defaultScenario.id, decisions: {} } });
    await relay.join(id);
    trip.act('decline');
    await relay.answer('declined', null);
    expect(memory.part<Record<string, unknown>>(id, 'response')).toEqual({ answer: 'declined', trip: trip.snapshot() });
  });

  it("the gate's request finds the boarding pass the phone holds, and a phone with none says so", async () => {
    const gateRequest = { for: 'gate' as const, ...requestToSend(gatePresentation(defaultScenario)), trip: { rev: 0, step: 'start' as const, scenarioId: defaultScenario.id, decisions: {} } };
    await relay.join(memory.start(gateRequest));
    expect(relay.joined()?.state).toBe('noPass');

    for (const action of ['openWallet', 'share', 'addPass'] as const) trip.act(action);
    await relay.join(memory.start(gateRequest));
    expect(relay.joined()?.state).toBe('open');
    expect(trip.step()).toBe('gateAsked');
  });

  it('with no relay set up, both sides say so and nothing is sent', async () => {
    memory.configured = null;
    await relay.ask('gate', requestToSend(gatePresentation(defaultScenario)));
    expect(relay.asking.gate().state).toBe('unconfigured');
    await relay.join('A'.repeat(22));
    expect(relay.joined()?.state).toBe('unconfigured');
    expect(memory.sessions.size).toBe(0);
  });

  it('an unknown or malformed session is treated as expired', async () => {
    await relay.join('A'.repeat(22));
    expect(relay.joined()?.state).toBe('expired');
    await relay.join('../not-an-id');
    expect(relay.joined()?.state).toBe('expired');
  });
});
