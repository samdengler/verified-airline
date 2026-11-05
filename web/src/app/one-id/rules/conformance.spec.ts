// Every line of decisions.jsonl through the TypeScript checks: the model's
// answer for each scenario, check and setting of a reading.  A pass means the
// TypeScript is right on these cases.  It is a test; the proofs are about the
// Lean model.
import { readFileSync } from 'node:fs';
import { answer, type OracleRequest } from './support/answer';

interface Decision {
  name: string;
  scenario: string | null;
  request: OracleRequest;
  response: { result: unknown };
}

const decisions: Decision[] = readFileSync('../model/one-id/decisions.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

describe('the conformance vectors', () => {
  it('has the eight rules of the oracle', () => {
    expect(new Set(decisions.map((d) => d.request.rule)).size).toBe(8);
  });

  it.each(decisions)('$name', ({ request, response }) => {
    expect(answer(request)).toEqual(response.result);
  });
});
