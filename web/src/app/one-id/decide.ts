// Where a trip stands while points of the guide are undecided.  Nothing here is
// typed by hand: results come from the checks in rules/, tried under every
// setting of each undecided point a check reads, and the link between a traveler
// and an open question comes from scenarios.json and readings.json.
import { type CheckKey, type CheckResult, planChecks, type PlannedCheck, resultOf } from './checks';
import { allReadings, credentialOf, firstSettings, presentationReadings, type PresentationScenario, presentationScenarios, type Reading, readings, type Scenario, scenarios } from './data';
import { planPresentationChecks } from './presentation-checks';
import { boardingPassDocType, photoidDocType } from './rules/support/identifiers';
import type { Mdoc } from './rules/support/types';
import type { Setting, Settings } from './rules/support/readings';

/** What the gate can be asked about: a traveler's credentials, or one presentation. */
export type Subject = Scenario | PresentationScenario;

export const isPresentation = (s: Subject): s is PresentationScenario => 'held' in s;

/** Every traveler and every presentation. */
export const subjects: readonly Subject[] = [...scenarios, ...presentationScenarios];

const planFor = (s: Subject): PlannedCheck[] => (isPresentation(s) ? planPresentationChecks(s) : planChecks(s));

/** The credential of a kind a subject holds. */
export function mdocOf(s: Subject, role: 'photoid' | 'boardingPass'): Mdoc | undefined {
  if (!isPresentation(s)) return credentialOf(s, role);
  const docType = role === 'photoid' ? photoidDocType : boardingPassDocType;
  return (s.response?.documents ?? s.held).find((c) => c.mdoc.docType === docType)?.mdoc;
}


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
  /** A pair can be boarded.  One credential alone only gets a result for itself, since the gate needs both (OID-207).  A presentation is accepted or refused. */
  kind: 'pair' | 'credential' | 'presentation';
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

const settingsOf = (point: string) => allReadings.find((r) => r.id === point)!.settings;

/** Every combination of the settings of some points. */
function combinations(points: readonly string[]): Settings[] {
  return points.reduce<Settings[]>((all, point) => all.flatMap((c) => settingsOf(point).map((s) => ({ ...c, [point]: s.value }))), [{}]);
}

/** One check, tried under every setting of the undecided points it reads. */
function viewCheck(check: PlannedCheck, base: Settings, d: Decisions): CheckView {
  const open = check.reads.filter((point) => !decided(d, point));
  const passes = (extra: Settings): boolean => check.run({ ...base, ...extra }).passed;
  const tried = combinations(open).map((c) => ({ c, passed: passes(c) }));
  const state: CheckState = tried.every((t) => t.passed) ? 'passed' : tried.some((t) => t.passed) ? 'depends' : 'failed';
  const splits = state !== 'depends' ? [] : open.filter((point) => tried.some(({ c, passed }) => settingsOf(point).some((s) => passes({ ...c, [point]: s.value }) !== passed)));
  return { result: resultOf(check, base), state, splits };
}

/** Each check the subject allows, tried under every setting of what is undecided. */
export function viewChecks(subject: Subject, d: Decisions): CheckView[] {
  const base = complete(d);
  return planFor(subject).map((check) => viewCheck(check, base, d));
}

/** The points whose open question has this subject as a worked example, from the files.  One the subject's rules do not read in its profile cannot stop it. */
export function exampleOf(subject: Subject): string[] {
  if (subject.example === null) return [];
  const reads = new Set(planFor(subject).flatMap((c) => c.reads));
  const named = [...readings, ...presentationReadings].filter((r) => r.questions.some((q) => q.examples.includes(subject.example!))).map((r) => r.id);
  return [...new Set(named)].filter((point) => reads.has(point));
}

function kindOf(subject: Subject): GateView['kind'] {
  if (isPresentation(subject)) return 'presentation';
  return credentialOf(subject, 'photoid') && credentialOf(subject, 'boardingPass') ? 'pair' : 'credential';
}

/** What the gate can say about a subject. */
export function viewGate(subject: Subject, d: Decisions): GateView {
  const checks = viewChecks(subject, d);
  const blocking = checks.filter((c) => c.result.blocks);
  const failed = blocking.find((c) => c.state === 'failed');
  const outcome: Outcome = failed ? 'refer' : blocking.some((c) => c.state === 'depends') ? 'depends' : 'board';
  const splitting = outcome === 'depends' ? blocking.flatMap((c) => c.splits) : [];
  return {
    kind: kindOf(subject),
    outcome,
    checks,
    failure: failed?.result.key,
    // A worked example stops the trip even when its result is the same under every setting: the two John Smiths board either way.
    stops: [...new Set([...splitting, ...exampleOf(subject).filter((point) => !decided(d, point))])],
  };
}

/** Whether a setting of this point changes what the gate says about a subject. */
export function affects(subject: Subject, point: Reading, d: Decisions): boolean {
  if (!planFor(subject).some((c) => c.reads.includes(point.id))) return false;
  return new Set(point.settings.map((option) => viewGate(subject, { ...d, [point.id]: option.value }).outcome)).size > 1;
}

export interface ConsequenceRow {
  scenario: Subject;
  /** Whether both credentials are about one traveler, for a subject holding both.  The issuer knows this; a reader does not. */
  sameTraveler: boolean | null;
  cells: { value: Setting; view: GateView; wrong: boolean }[];
}

/** Whether the gate's answer is wrong, given who the credentials are about. */
const isWrong = (view: GateView, same: boolean | null): boolean =>
  same !== null && ((view.outcome === 'board' && !same) || (view.outcome === 'refer' && same));

/** Whether a subject's two credentials are about one traveler, when it holds both. */
export function sameTravelerOf(s: Subject): boolean | null {
  const about = (docType: string): string | undefined =>
    isPresentation(s) ? s.held.find((h) => h.mdoc.docType === docType)?.subject.id : s.credentials.find((c) => c.mdoc.docType === docType)?.about;
  const photoid = about(photoidDocType);
  const pass = about(boardingPassDocType);
  return photoid && pass ? photoid === pass : null;
}

/** The defaults that read this point, for comparison, and each subject it changes or is an example of. */
export function consequences(point: Reading, d: Decisions): ConsequenceRow[] {
  return subjects
    .filter((subject) => planFor(subject).some((c) => c.reads.includes(point.id)))
    .map((scenario) => {
      const same = sameTravelerOf(scenario);
      const cells = point.settings.map((s) => {
        const view = viewGate(scenario, { ...d, [point.id]: s.value });
        return { value: s.value, view, wrong: isWrong(view, same) };
      });
      return { scenario, sameTraveler: same, cells };
    })
    .filter((row) => row.scenario.default || new Set(row.cells.map((c) => c.view.outcome)).size > 1 || exampleOf(row.scenario).includes(point.id));
}
