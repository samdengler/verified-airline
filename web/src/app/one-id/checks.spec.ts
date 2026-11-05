import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { decisionName, describeFinding, firstFailure, runChecks, sameAnswer } from './checks';
import { defaultScenario, readings, scenarios, firstSettings, wording } from './data';
import type { Settings } from './rules/support/readings';

const table: Record<string, unknown> = Object.fromEntries(
  readFileSync('../model/one-id/decisions.jsonl', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((d: { name: string; response: { result: unknown } }) => [d.name, d.response.result]),
);

/** A setting of every reading point in readings.json. */
const anySettings: fc.Arbitrary<Settings> = fc.record(Object.fromEntries(readings.map((r) => [r.id, fc.constantFrom(...r.settings.map((s) => s.value))])));

describe('the checks for one traveler', () => {
  it('gives every result the model gives, for every scenario under any settings', () => {
    fc.assert(
      fc.property(fc.constantFrom(...scenarios), anySettings, (scenario, settings) => {
        for (const r of runChecks(scenario, settings)) {
          expect(table).toHaveProperty([decisionName(scenario, r)]);
          expect(r.answer).toEqual(table[decisionName(scenario, r)]);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('compares an answer with the model whatever order the keys are in', () => {
    const noPortrait = scenarios.find((s) => s.id === 'no-portrait')!;
    const violations = runChecks(noPortrait, firstSettings).find((r) => r.key === 'photoid')!;
    const model = table[decisionName(noPortrait, violations)] as object[];
    expect(model.length).toBeGreaterThan(0);
    expect(sameAnswer(model, violations.answer)).toBe(true);
    expect(sameAnswer(model, [])).toBe(false);
    expect(sameAnswer(true, false)).toBe(false);
    expect(sameAnswer([{ code: 'a', x: '1' }], [{ x: '2', code: 'a' }])).toBe(false);
    expect(describeFinding(model[0])).toBe(describeFinding((violations.answer as object[])[0]));
  });

  it('boards the default trip under any settings', () => {
    fc.assert(fc.property(anySettings, (settings) => firstFailure(runChecks(defaultScenario, settings)) === undefined), { numRuns: 1000 });
  });

  it('refers a traveler when a check fails, and not for a recommendation', () => {
    const accented = scenarios.find((s) => s.id === 'accented-name')!;
    expect(firstFailure(runChecks(accented, { ...firstSettings, MatchReading: 'namesAgree' }))?.key).toBe('match');
    expect(firstFailure(runChecks(accented, { ...firstSettings, MatchReading: 'notChecked' }))).toBeUndefined();
    expect(runChecks(defaultScenario, firstSettings).find((r) => r.key === 'advisories')?.passed).toBe(false);
  });

  it('has wording for every check it runs', () => {
    for (const scenario of scenarios) {
      for (const r of runChecks(scenario, firstSettings)) {
        expect(wording.lean.checks).toHaveProperty(r.key);
        if (r.blocks) expect(wording.traveler.reasons).toHaveProperty(r.key);
      }
    }
  });
});
