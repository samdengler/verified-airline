// Where a trip stands while points of the guide are undecided.  Nothing here is
// typed by hand: results come from the checks in rules/, tried under every
// setting of each undecided point a check reads, and the link between a traveler
// and an open question comes from scenarios.json and readings.json.
import { type CheckKey, type CheckResult, runChecks } from './checks';
import { credentialOf, defaultScenario, firstSettings, readings, type Reading, type Scenario, scenarios } from './data';
import type { Setting, Settings } from './rules/support/readings';

/** A point's state: a setting, null for "none of these", or absent while nobody has decided it. */
export type Decisions = Readonly<Record<string, Setting | null>>;

export type CheckState = 'passed' | 'failed' | 'depends';
export type Outcome = 'board' | 'refer' | 'depends';

export interface CheckView {
  /** The check under the decided settings, and the first setting of each undecided point. */
  result: CheckResult;
  /** Whether it passes under every setting of the undecided points it reads, under none, or under some. */
  state: CheckState;
  /** The undecided points whose setting changes whether it passes. */
  splits: string[];
}

export interface GateView {
  /** A pair can be boarded.  One credential alone only gets a result for itself, since the gate needs both (OID-207). */
  kind: 'pair' | 'credential';
  outcome: Outcome;
  checks: CheckView[];
  /** The check that refers this traveler, whichever way the undecided points go. */
  failure?: CheckKey;
  /** The undecided points this trip stops at. */
  stops: string[];
}

const decided = (d: Decisions, point: string): boolean => d[point] !== undefined && d[point] !== null;

function complete(d: Decisions): Settings {
  const out: Record<string, Setting> = { ...firstSettings };
  for (const point of Object.keys(d)) if (decided(d, point)) out[point] = d[point] as Setting;
  return out;
}

/** Every combination of the settings of some points. */
function combinations(points: string[]): Settings[] {
  return points.reduce<Settings[]>(
    (all, point) => all.flatMap((c) => readings.find((r) => r.id === point)!.settings.map((s) => ({ ...c, [point]: s.value }))),
    [{}],
  );
}

/** Each check the traveler's credentials allow, tried under every setting of what is undecided. */
export function viewChecks(scenario: Scenario, d: Decisions): CheckView[] {
  const base = complete(d);
  return runChecks(scenario, base).map((result) => {
    const passes = (extra: Settings): boolean => runChecks(scenario, { ...base, ...extra }).find((r) => r.key === result.key && r.decisionCase === result.decisionCase)!.passed;
    const open = Object.keys(result.points).filter((point) => !decided(d, point));
    const tried = combinations(open).map((c) => ({ c, passed: passes(c) }));
    const state: CheckState = tried.every((t) => t.passed) ? 'passed' : tried.some((t) => t.passed) ? 'depends' : 'failed';
    const splits = state !== 'depends' ? [] : open.filter((point) =>
      tried.some(({ c, passed }) => readings.find((r) => r.id === point)!.settings.some((s) => passes({ ...c, [point]: s.value }) !== passed)));
    return { result, state, splits };
  });
}

/** The points whose open question has this traveler as a worked example, from the two files. */
export const exampleOf = (scenario: Scenario): string[] =>
  readings.filter((r) => r.questions.some((q) => scenario.example !== null && q.examples.includes(scenario.example))).map((r) => r.id);

/** What the gate can say about a traveler. */
export function viewGate(scenario: Scenario, d: Decisions): GateView {
  const checks = viewChecks(scenario, d);
  const blocking = checks.filter((c) => c.result.blocks);
  const failed = blocking.find((c) => c.state === 'failed');
  const outcome: Outcome = failed ? 'refer' : blocking.some((c) => c.state === 'depends') ? 'depends' : 'board';
  const splitting = outcome === 'depends' ? blocking.flatMap((c) => c.splits) : [];
  return {
    kind: credentialOf(scenario, 'photoid') && credentialOf(scenario, 'boardingPass') ? 'pair' : 'credential',
    outcome,
    checks,
    failure: failed?.result.key,
    // A worked example stops the trip even when its result is the same under every setting: the two John Smiths board either way.
    stops: [...new Set([...splitting, ...exampleOf(scenario).filter((point) => !decided(d, point))])],
  };
}

export interface ConsequenceRow {
  scenario: Scenario;
  /** Whether both credentials are about one traveler, for a traveler holding both.  The issuer knows this; a reader does not. */
  sameTraveler: boolean | null;
  cells: { value: Setting; view: GateView; wrong: boolean }[];
}

/** Whether the gate's answer is wrong, given who the credentials are about. */
const isWrong = (view: GateView, same: boolean | null): boolean =>
  same !== null && ((view.outcome === 'board' && !same) || (view.outcome === 'refer' && same));

const sameTravelerOf = (s: Scenario): boolean | null => {
  const about = (role: 'photoid' | 'boardingPass') => s.credentials.find((c) => c.role === role)?.about;
  return about('photoid') && about('boardingPass') ? about('photoid') === about('boardingPass') : null;
};

/** The default trip, for comparison, and each traveler this point changes or is an example of. */
export function consequences(point: Reading, d: Decisions): ConsequenceRow[] {
  return scenarios
    .map((scenario) => {
      const same = sameTravelerOf(scenario);
      const cells = point.settings.map((s) => {
        const view = viewGate(scenario, { ...d, [point.id]: s.value });
        return { value: s.value, view, wrong: isWrong(view, same) };
      });
      return { scenario, sameTraveler: same, cells };
    })
    .filter((row) => row.scenario === defaultScenario || new Set(row.cells.map((c) => c.view.outcome)).size > 1 || exampleOf(row.scenario).includes(point.id));
}
