// Every line of model/trip/decisions.jsonl through the TypeScript: the model's
// answer for every step and action, every input to the gate, and every list of up to
// three checks.  The inputs of next and gateShows are finite, so a pass here means
// these functions agree with the Lean ones everywhere.  The proofs are about the Lean
// functions, and they cover the paths, which have no limit.
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { Trip } from './trip';
import { type Action, type CheckState, gateShows, kindFrom, next, type Outcome, outcomeOf, type Shows, type Step } from './trip-steps';

interface NextRow { kind: 'next'; name: string; step: Step; action: Action; to: Step | null }
interface GateRow { kind: 'gate'; name: string; step: Step; presentation: boolean; photoid: boolean; pass: boolean; outcome: Outcome; stops: boolean; also: Outcome | null; shows: Shows }
interface OutcomeRow { kind: 'outcome'; name: string; checks: CheckState[]; outcome: Outcome }
type Row = NextRow | GateRow | OutcomeRow;

const rows: Row[] = readFileSync('../model/trip/decisions.jsonl', 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const nextRows = rows.filter((r): r is NextRow => r.kind === 'next');
const gateRows = rows.filter((r): r is GateRow => r.kind === 'gate');
const outcomeRows = rows.filter((r): r is OutcomeRow => r.kind === 'outcome');

describe('the trip against the model', () => {
  it('has every input: 8 steps by 8 actions, and 1,536 at the gate', () => {
    expect(nextRows.length).toBe(64);
    expect(gateRows.length).toBe(8 * 8 * 3 * 2 * 4);
    expect(outcomeRows.length).toBe(1 + 3 + 9 + 27);
  });

  it.each(nextRows)('$name', ({ step, action, to }) => {
    expect(next(step, action)).toBe(to);
  });

  it.each(outcomeRows)('$name', ({ checks, outcome }) => {
    expect(outcomeOf(checks)).toBe(outcome);
  });

  it.each(gateRows)('$name', ({ step, presentation, photoid, pass, outcome, stops, also, shows }) => {
    const view = { kind: kindFrom({ presentation, photoid, pass }), outcome, stops: stops ? ['a point'] : [] };
    expect(gateShows(step, view, also ? { outcome: also } : null)).toBe(shows);
  });
});

describe('the trip service', () => {
  it('ignores an action the step does not allow, so nothing skips the consent sheet', () => {
    const trip = TestBed.inject(Trip);
    trip.act('shareGate');
    expect(trip.step()).toBe('start');
    trip.act('openWallet');
    trip.act('shareGate');
    expect(trip.step()).toBe('asked');
    trip.act('share');
    trip.act('addPass');
    trip.act('present');
    trip.act('shareGate');
    expect(trip.step()).toBe('presented');
    trip.act('startAgain');
    expect(trip.step()).toBe('start');
  });
});

describe('the traceability of the trip', () => {
  const model = JSON.parse(readFileSync('../model/trip/model.json', 'utf8'));
  const lean = readFileSync('../trip-model/Trip/Model.lean', 'utf8');
  const text = readFileSync('src/app/one-id/trip-steps.ts', 'utf8');
  const named = [...text.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*export function (\w+)/g)].map(([, doc, name]) => ({
    name,
    requirement: doc.match(/requirement: (\S+)/)?.[1],
    lean: doc.match(/lean: (\S+)/)?.[1],
    part: /part of requirement:/.test(doc),
  }));

  it('names all four functions', () => {
    expect(named.map((n) => n.name).sort()).toEqual(['gateShows', 'kindFrom', 'next', 'outcomeOf']);
  });

  it.each(named)('$name names a requirement the model has, with its Lean function', ({ requirement, lean: name, part }) => {
    const r = model.requirements[requirement!];
    expect(r).toBeDefined();
    if (!part) expect(r.name).toBe(name);
    expect(lean).toContain(`def ${name!.replace('Trip.', '')} `);
  });

  it('has every criterion proven, by a theorem the file names', () => {
    for (const r of Object.values<{ criteria: { status: string; theorem: string }[] }>(model.requirements)) {
      for (const c of r.criteria) {
        expect(c.status).toBe('proven');
        expect(c.theorem).toMatch(/^Trip\./);
      }
    }
  });
});
