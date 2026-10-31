import { contradicted, findingRows, readable, tone, turnFor, versionOf, type Turn } from './turns';

const turn = (n: number, question: string, extra: Partial<Turn> = {}): Turn => ({
  contact: 'c',
  turn: n,
  at: 0,
  mode: 'verified',
  state: 'verified',
  question,
  draft: 'd',
  check: null,
  rules: {},
  provenance: null,
  ...extra,
});

describe('turns', () => {
  it('pairs a reply with the latest untaken turn for its question', () => {
    const turns = [turn(1, 'a'), turn(2, 'b'), turn(3, 'a')];
    expect(turnFor(turns, 'a', new Set())?.turn).toBe(3);
    expect(turnFor(turns, 'a', new Set([3]))?.turn).toBe(1);
    expect(turnFor(turns, 'c', new Set())).toBeNull();
  });

  it('reads the check logic as an equation', () => {
    expect(readable('(= tripStage\n   AFTER_MISSED_FLIGHT)')).toBe('tripStage = AFTER_MISSED_FLIGHT');
    expect(readable('(and a b)')).toBe('(and a b)');
  });

  it('keeps the premises of each finding with its claims, once each', () => {
    const t = turn(1, 'a', {
      check: {
        result: 'VALID',
        rulesApplied: [],
        untranslated: [],
        findings: [
          { kind: 'valid', premises: ['(= fare BASIC)'], claims: ['(= cancellationRefundUsd 0.0)'] },
          { kind: 'valid', premises: ['(= fare FLEX)'], claims: ['(= cancellationRefundUsd 100.0)'] },
          { kind: 'valid', premises: ['(= fare BASIC)'], claims: ['(= cancellationRefundUsd 0.0)'] },
        ],
      },
    });
    expect(findingRows(t)).toEqual([
      { premises: ['fare = BASIC'], claims: ['cancellationRefundUsd = 0.0'] },
      { premises: ['fare = FLEX'], claims: ['cancellationRefundUsd = 100.0'] },
    ]);
  });

  it('colours a rule amber when any criterion behind it is open', () => {
    expect(tone([{ id: 'A', proven: 5, total: 5 }])).toBe('proven');
    expect(tone([{ id: 'A', proven: 5, total: 5 }, { id: 'B', proven: 4, total: 5 }])).toBe('open');
  });

  it('names the rules a contradicted draft broke', () => {
    const t = turn(1, 'a', {
      check: { result: 'INVALID', rulesApplied: [], untranslated: [], findings: [{ kind: 'invalid', rules: ['R1', 'R2'] }, { kind: 'valid', rules: ['R3'] }] },
    });
    expect(contradicted(t)).toEqual(['R1', 'R2']);
  });

  it('reads the policy version from its ARN', () => {
    expect(versionOf('arn:aws:bedrock:us-east-1:1:automated-reasoning-policy/x:5')).toBe('5');
    expect(versionOf(undefined)).toBeNull();
  });
});
