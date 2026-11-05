import fc from 'fast-check';
import { firstFailure, runChecks } from './checks';
import { defaultScenario, firstSettings, readings, scenarios } from './data';
import { consequences, type Decisions, exampleOf, viewGate } from './decide';

/** Any state the switches can be in: decided, left open, or not touched. */
const anyDecisions: fc.Arbitrary<Decisions> = fc.record(
  Object.fromEntries(readings.map((r) => [r.id, fc.constantFrom(...r.settings.map((s) => s.value), null)])),
  { requiredKeys: [] },
) as fc.Arbitrary<Decisions>;

const reading = (id: string) => readings.find((r) => r.id === id)!;

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

  it('resolves a stop once its points are decided', () => {
    for (const s of scenarios.filter((x) => !x.default)) {
      const d: Record<string, unknown> = {};
      for (let i = 0; i < readings.length && viewGate(s, d as Decisions).stops.length; i++) {
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
  });

  it('links each traveler but the default to the open question it is an example of', () => {
    expect(exampleOf(defaultScenario)).toEqual([]);
    for (const s of scenarios.filter((x) => !x.default)) expect(exampleOf(s).length, s.id).toBe(1);
  });

  it('shows what each matching setting gets wrong, from who the credentials are about', () => {
    const rows = consequences(reading('MatchReading'), {});
    expect(rows.map((r) => r.scenario.id).sort()).toEqual(['accented-name', 'another-travelers-pass', 'default-trip', 'two-john-smiths']);
    const wrong = (setting: string) => rows.filter((r) => r.cells.find((c) => c.value === setting)!.wrong).map((r) => r.scenario.id).sort();
    expect(wrong('notChecked')).toEqual(['another-travelers-pass', 'two-john-smiths']);
    expect(wrong('namesAgree')).toEqual(['accented-name', 'two-john-smiths']);
  });
});
