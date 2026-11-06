import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { decisionName, firstFailure, resultOf, runChecks, sameAnswer } from './checks';
import { allReadings, defaultPresentation, defaultScenario, firstSettings, presentationScenarios, readings, scenarios } from './data';
import { consequences, type Decisions, exampleOf, subjects, viewGate } from './decide';
import { checkInPresentation, gatePresentation, planPresentationChecks } from './presentation-checks';
import { walletRespond } from './rules/wallet-respond';
import { ISO_TRANSCRIPTS } from './rules/support/stand-ins';

const presentationTable: Record<string, unknown> = Object.fromEntries(
  readFileSync('../model/one-id/presentation/decisions.jsonl', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((d: { name: string; response: { result: unknown } }) => [d.name, d.response.result]),
);

/** Any state the switches can be in: decided, left open, or not touched. */
const anyDecisions: fc.Arbitrary<Decisions> = fc.record(
  Object.fromEntries(allReadings.map((r) => [r.id, fc.constantFrom(...r.settings.map((s) => s.value), null)])),
  { requiredKeys: [] },
) as fc.Arbitrary<Decisions>;

const reading = (id: string) => allReadings.find((r) => r.id === id)!;
const anySettings = fc.record(Object.fromEntries(allReadings.map((r) => [r.id, fc.constantFrom(...r.settings.map((s) => s.value))])));

describe('where a trip stands', () => {
  it('never stops the default trip, and boards it, whatever has been decided', () => {
    fc.assert(
      fc.property(anyDecisions, (d) => {
        const view = viewGate(defaultScenario, d);
        return view.stops.length === 0 && view.outcome === 'board' && view.kind === 'pair';
      }),
      { numRuns: 300 },
    );
  });

  it('stops every other traveler while nothing is decided', () => {
    for (const s of scenarios.filter((x) => !x.default)) expect(viewGate(s, {}).stops.length, s.id).toBeGreaterThan(0);
  });

  it('stops the two John Smiths, though they board under every setting', () => {
    const smiths = scenarios.find((s) => s.id === 'two-john-smiths')!;
    expect(viewGate(smiths, {}).outcome).toBe('board');
    expect(viewGate(smiths, {}).stops).toEqual(['MatchReading']);
  });

  it('never stops a default presentation, nor the trip built on them, whatever has been decided', () => {
    const trip = [defaultPresentation('openid4vp'), defaultPresentation('mdocOverDcApi'), defaultPresentation('proximity'), checkInPresentation(defaultScenario), gatePresentation(defaultScenario)];
    fc.assert(
      fc.property(fc.constantFrom(...trip), anyDecisions, (p, d) => {
        const view = viewGate(p, d);
        return view.stops.length === 0 && view.outcome === 'board';
      }),
      { numRuns: 400 },
    );
  });

  it('gives every result the model gives for every presentation, under any settings', () => {
    fc.assert(
      fc.property(fc.constantFrom(...presentationScenarios), anySettings, (p, settings) => {
        for (const check of planPresentationChecks(p)) {
          const r = resultOf(check, settings);
          const name = decisionName(p, r);
          expect(presentationTable, name).toHaveProperty([name]);
          expect(sameAnswer(r.answer, presentationTable[name]), name).toBe(true);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('runs every rule the model evaluates for a presentation', () => {
    for (const p of presentationScenarios) {
      const cases = new Set(planPresentationChecks(p).map((c) => c.decisionCase));
      const expected = new Set(Object.keys(presentationTable).filter((n) => n.startsWith(`${p.id} `)).map((n) => n.slice(p.id.length + 1).split(' ')[0]));
      expect([...cases].sort(), p.id).toEqual([...expected].sort());
    }
  });

  it("holds the default trip's gate presentation to the model's own default", () => {
    const base = defaultPresentation('proximity');
    expect(sameAnswer(gatePresentation(defaultScenario).held, base.held)).toBe(true);
    expect(sameAnswer(gatePresentation(defaultScenario).response, base.response)).toBe(true);
    for (const c of ['perElement', 'wholeCredential'] as const) {
      expect(sameAnswer(walletRespond(c, ISO_TRANSCRIPTS[base.isoTranscripts], base.held, base.seen!, base.consent!), base.response)).toBe(true);
    }
  });

  it('asks only for the photoid at check-in, and the wallet sends only that', () => {
    const p = checkInPresentation(defaultScenario);
    expect(p.seen!.elements.map((e) => e.identifier).sort()).toEqual(['family_name', 'given_name', 'portrait']);
    expect(p.response!.documents.length).toBe(1);
  });

  it('resolves a stop once its points are decided', () => {
    for (const s of subjects) {
      const d: Record<string, unknown> = {};
      for (let i = 0; i < allReadings.length && viewGate(s, d as Decisions).stops.length; i++) {
        for (const point of viewGate(s, d as Decisions).stops) d[point] = reading(point).settings[0].value;
      }
      expect(viewGate(s, d as Decisions).stops, s.id).toEqual([]);
    }
  });

  it('keeps the trip stopped when a point is left open', () => {
    const accented = scenarios.find((s) => s.id === 'accented-name')!;
    expect(viewGate(accented, { MatchReading: null }).stops).toEqual(['MatchReading']);
    expect(viewGate(accented, { MatchReading: 'namesAgree' }).stops).toEqual([]);
  });

  it('agrees with the checks once everything is decided', () => {
    fc.assert(
      fc.property(fc.constantFrom(...scenarios), fc.record(Object.fromEntries(readings.map((r) => [r.id, fc.constantFrom(...r.settings.map((s) => s.value))]))), (s, settings) => {
        const view = viewGate(s, settings);
        const failure = firstFailure(runChecks(s, settings));
        expect(view.stops).toEqual([]);
        expect(view.outcome).toBe(failure ? 'refer' : 'board');
        expect(view.failure).toBe(failure?.key);
      }),
      { numRuns: 200 },
    );
  });

  it('treats one credential as a credential check, whatever its result', () => {
    for (const s of scenarios) {
      const pair = s.credentials.length === 2;
      expect(viewGate(s, firstSettings).kind, s.id).toBe(pair ? 'pair' : 'credential');
    }
    for (const p of presentationScenarios) expect(viewGate(p, firstSettings).kind, p.id).toBe('presentation');
  });

  it('shows what requiring one device key gets wrong, with the two cases the model names', () => {
    const rows = consequences(reading('PairReading.sameDeviceKey'), { 'PairReading.content': 'notChecked' });
    const wrong = (setting: boolean) => rows.filter((r) => r.cells.find((c) => c.value === setting)!.wrong).map((r) => r.scenario.id).sort();
    expect(wrong(true)).toEqual(['two-devices-one-traveler', 'two-travelers-one-device']);
    expect(wrong(false)).toEqual(['two-travelers-one-device']);
  });

  it('links each traveler but the default to the open question it is an example of', () => {
    expect(exampleOf(defaultScenario)).toEqual([]);
    for (const s of scenarios.filter((x) => !x.default)) expect(exampleOf(s).length, s.id).toBe(1);
    for (const s of subjects) for (const point of exampleOf(s)) expect(allReadings.map((r) => r.id)).toContain(point);
  });

  it('shows what each matching setting gets wrong, from who the credentials are about', () => {
    const rows = consequences(reading('MatchReading'), {});
    expect(rows.map((r) => r.scenario.id).sort()).toEqual(['accented-name', 'another-travelers-pass', 'default-trip', 'two-john-smiths']);
    const wrong = (setting: string) => rows.filter((r) => r.cells.find((c) => c.value === setting)!.wrong).map((r) => r.scenario.id).sort();
    expect(wrong('notChecked')).toEqual(['another-travelers-pass', 'two-john-smiths']);
    expect(wrong('namesAgree')).toEqual(['accented-name', 'two-john-smiths']);
  });
});
