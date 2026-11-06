// The theorems of trip-model/Trip/Theorems.lean restated for the TypeScript, each
// tagged with the criterion it checks.  A pass means the code held on every path
// tried.  The proofs are about the Lean model and cover every path.
import fc from 'fast-check';
import { STOPS, stopIndex } from './trip-route';
import { type Action, type CheckState, gateShows, kindFrom, next, type Outcome, outcomeOf, type Step } from './trip-steps';

const ACTIONS: Action[] = ['openWallet', 'share', 'decline', 'addPass', 'present', 'shareGate', 'declineGate', 'startAgain'];
const STEPS: Step[] = ['start', 'asked', 'declined', 'shared', 'passAdded', 'gateAsked', 'gateDeclined', 'presented'];
const OUTCOMES: Outcome[] = ['board', 'refer', 'depends'];
const STATES: CheckState[] = ['passed', 'failed', 'depends'];

interface Point { step: Step; sentToWebsite: boolean; sentToGate: boolean }

/**
 * A trip along a path, with what has been sent as the model counts it.  Each number
 * picks an action the step allows, so the paths are real trips.  Starting again is
 * always allowed, so it is picked rarely, or few paths would get as far as the gate.
 */
function walk(choices: number[]): Point[] {
  const points: Point[] = [{ step: 'start', sentToWebsite: false, sentToGate: false }];
  for (const choice of choices) {
    const at = points[points.length - 1];
    const onward = ACTIONS.filter((a) => a !== 'startAgain' && next(at.step, a) !== null);
    const action = !onward.length || choice % 15 === 0 ? 'startAgain' : onward[choice % onward.length];
    const step = next(at.step, action)!;
    points.push(action === 'startAgain' ? { step, sentToWebsite: false, sentToGate: false } : { step, sentToWebsite: at.sentToWebsite || action === 'share', sentToGate: at.sentToGate || action === 'shareGate' });
  }
  return points;
}

const paths = fc.array(fc.nat({ max: 1000 }), { maxLength: 60 });
const view = fc.record({
  kind: fc.record({ presentation: fc.boolean(), photoid: fc.boolean(), pass: fc.boolean() }).map(kindFrom),
  outcome: fc.constantFrom(...OUTCOMES),
  stops: fc.array(fc.constant('a point'), { maxLength: 2 }),
});
const also = fc.option(fc.constantFrom(...OUTCOMES).map((outcome) => ({ outcome })), { nil: null });

describe('the trip, on paths of any length', () => {
  it('reaches the gate often enough for these to mean something', () => {
    let reached = 0;
    fc.assert(fc.property(paths, (p) => { if (walk(p).some((q) => q.step === 'presented')) reached++; }), { numRuns: 500 });
    expect(reached).toBeGreaterThan(40);
  });

  it('TRIP-002.2 and TRIP-002.3: a trip at the gate has both shares, and short of it has sent the gate nothing', () => {
    fc.assert(fc.property(paths, (p) => walk(p).every((q) => (q.step === 'presented' ? q.sentToWebsite && q.sentToGate : !q.sentToGate))), { numRuns: 500 });
  });

  it('TRIP-002.1: only the gate sheet\'s Share reaches the gate', () => {
    for (const step of STEPS) for (const action of ACTIONS) {
      expect(next(step, action) === 'presented').toBe(step === 'gateAsked' && action === 'shareGate');
    }
  });

  it('TRIP-002.5 and TRIP-002.6: a decline has sent nothing to whoever asked', () => {
    fc.assert(fc.property(paths, (p) => walk(p).every((q) => (q.step !== 'declined' || !q.sentToWebsite) && (q.step !== 'gateDeclined' || !q.sentToGate))), { numRuns: 500 });
  });

  it('TRIP-003.2: a result at the gate means the traveler shared', () => {
    fc.assert(fc.property(paths, view, also, (p, v, a) => walk(p).every((q) => gateShows(q.step, v, a) === 'waiting' || (q.sentToWebsite && q.sentToGate))), { numRuns: 300 });
  });
});

describe('the gate, for any result of the checks', () => {
  const step = fc.constantFrom(...STEPS);

  it('TRIP-003.1: it waits until the trip is presented', () => {
    fc.assert(fc.property(step, view, also, (s, v, a) => s === 'presented' || gateShows(s, v, a) === 'waiting'));
  });

  it('TRIP-003.3: one credential never boards', () => {
    fc.assert(fc.property(step, view, also, (s, v, a) => gateShows(s, v, a) !== 'board' || v.kind === 'pair'));
  });

  it('TRIP-003.4: a stop never shows Board or Refer', () => {
    fc.assert(fc.property(step, view, also, (s, v, a) => {
      const undecided = v.stops.length > 0 || v.outcome === 'depends' || a?.outcome === 'depends';
      return !undecided || ['waiting', 'decide'].includes(gateShows(s, v, a));
    }));
  });

  it('TRIP-003.5: Board needs everything', () => {
    fc.assert(fc.property(step, view, also, (s, v, a) => gateShows(s, v, a) !== 'board' || (s === 'presented' && v.stops.length === 0 && v.outcome === 'board' && a?.outcome !== 'refer' && a?.outcome !== 'depends')));
  });
});

describe('the checks\' outcome, for lists longer than the model\'s table', () => {
  const lists = fc.array(fc.constantFrom(...STATES), { maxLength: 30 });

  it('TRIP-004.1: any failure refers, and only a failure', () => {
    fc.assert(fc.property(lists, (c) => (outcomeOf(c) === 'refer') === c.includes('failed')));
  });

  it('TRIP-004.2: something undecided leaves it undecided, unless a check failed', () => {
    fc.assert(fc.property(lists, (c) => (outcomeOf(c) === 'depends') === (!c.includes('failed') && c.includes('depends'))));
  });

  it('TRIP-004.3: Board only when every check passed', () => {
    fc.assert(fc.property(lists, (c) => (outcomeOf(c) === 'board') === c.every((s) => s === 'passed')));
  });
});

describe('the route', () => {
  it('TRIP-001.1: following the stops from the start reaches the gate', () => {
    const end = STOPS.reduce<Step | null>((step, stop) => (stop.action && step ? next(step, stop.action) : step), 'start');
    expect(end).toBe('presented');
  });

  it('TRIP-001.2: a stop\'s action moves the trip to the next stop', () => {
    for (const step of STEPS) {
      const action = STOPS[stopIndex(step)].action;
      if (action) expect(stopIndex(next(step, action)!)).toBe(stopIndex(step) + 1);
    }
  });

  it('TRIP-001.3: short of the gate, a trip\'s stop has an action its step allows', () => {
    for (const step of STEPS.filter((s) => s !== 'presented')) {
      expect(next(step, STOPS[stopIndex(step)].action!)).not.toBeNull();
    }
  });
});
