// The model's checks for one traveler under one set of switches.  Each result
// comes from a function in rules/.  A check is planned once for a traveler, with
// the reading points it reads, so decide.ts can try it under every setting of
// those points without running the others.  Combining results into a decision is
// ordinary code, and the gate's banner carries a grey marker that says so.
import { credentialOf, type Scenario, tables } from './data';
import { boardingPassValidityFindings } from './rules/boarding-pass-validity-findings';
import { boardingPassViolations } from './rules/boarding-pass-violations';
import { expired } from './rules/expired';
import { photoidAdvisories } from './rules/photoid-advisories';
import { photoidSourceFindings } from './rules/photoid-source-findings';
import { photoidValidityFindings } from './rules/photoid-validity-findings';
import { photoidViolations } from './rules/photoid-violations';
import { boardingPassReading, expiryReading, matchReading, photoidReading, photoidValidityReading, validityReading, type Settings } from './rules/support/readings';
import { exampleResolution792 } from './rules/support/stand-ins';
import { travelerMatch } from './rules/traveler-match';

export type CheckKey =
  | 'photoid' | 'source' | 'advisories' | 'photoidValidity' | 'boardingPass' | 'passValidity' | 'photoidExpired' | 'passExpired' | 'match'
  | 'walletRespond' | 'refusals' | 'pairRefusals' | 'requestFindings' | 'walletFindings' | 'transcript' | 'tokenFindings' | 'deviceRequest' | 'sessions';

/** One check a traveler's credentials or presentation allow. */
export interface PlannedCheck {
  key: CheckKey;
  /** False when a failure cannot refer the traveler to an agent. */
  blocks: boolean;
  /** Its name in the decisions files, without the scenario. */
  decisionCase: string;
  /** The reading points it reads. */
  reads: readonly string[];
  run(s: Settings): { passed: boolean; answer: unknown };
}

export interface CheckResult {
  key: CheckKey;
  blocks: boolean;
  passed: boolean;
  /** The check's answer, in the form the model's table records it. */
  answer: unknown;
  decisionCase: string;
  /** The reading points the check read, with their settings. */
  points: Readonly<Record<string, Settings[string]>>;
}

export const resultOf = (check: PlannedCheck, s: Settings): CheckResult => ({
  key: check.key,
  blocks: check.blocks,
  decisionCase: check.decisionCase,
  points: Object.fromEntries(check.reads.map((id) => [id, s[id]])),
  ...check.run(s),
});

const PHOTOID_POINTS = ['PhotoidReading.dataGroupsTableBinds', 'PhotoidReading.photoidTableBinds', 'PhotoidReading.portraitIsDg2', 'PhotoidReading.portraitRequired', 'PhotoidReading.repeatedNamesRefused', 'PhotoidReading.unlistedDataAllowed'];
const EXPIRY_POINTS = ['ExpiryReading.validAtEnd'];

/** A check whose answer lists findings, and passes when the list is empty. */
export function findingsCheck(key: CheckKey, decisionCase: string, reads: readonly string[], list: (s: Settings) => unknown[], blocks = true): PlannedCheck {
  return {
    key,
    blocks,
    decisionCase,
    reads,
    run: (s) => {
      const answer = list(s);
      return { passed: answer.length === 0, answer };
    },
  };
}

/** Every check whose credentials the traveler holds. */
export function planChecks(scenario: Scenario): PlannedCheck[] {
  const photoid = credentialOf(scenario, 'photoid');
  const pass = credentialOf(scenario, 'boardingPass');
  const source = scenario.sourceDocument;
  const journey = scenario.journey;
  const out: PlannedCheck[] = [];
  if (photoid) {
    out.push(findingsCheck('photoid', 'Photoid.violations', PHOTOID_POINTS, (s) => photoidViolations(photoidReading(s), tables, photoid)));
    if (source) {
      out.push(findingsCheck('source', 'Photoid.sourceFindings', ['PhotoidReading.passportRequired'], (s) => photoidSourceFindings(photoidReading(s), source.kind)));
      out.push(findingsCheck('advisories', 'Photoid.advisories', [], () => photoidAdvisories(tables, source.kind, photoid), false));
      out.push(findingsCheck('photoidValidity', 'Photoid.validityFindings', ['PhotoidValidityReading'], (s) => photoidValidityFindings(photoidValidityReading(s), source.expires, photoid)));
    }
  }
  if (pass) {
    out.push(findingsCheck('boardingPass', 'BoardingPass.violations', ['BoardingPassReading.repeatedNamesRefused', 'BoardingPassReading.unlistedDataAllowed'], (s) => boardingPassViolations(boardingPassReading(s), exampleResolution792, pass)));
    if (journey) {
      out.push(findingsCheck('passValidity', 'BoardingPass.validityFindings', ['ValidityReading.departure', 'ValidityReading.soonAfter'], (s) => boardingPassValidityFindings(validityReading(s), journey, pass)));
    }
  }
  const expiryCheck = (key: CheckKey, decisionCase: string, m: NonNullable<typeof photoid>): PlannedCheck => ({
    key,
    blocks: true,
    decisionCase,
    reads: EXPIRY_POINTS,
    run: (s) => {
      const answer = expired(expiryReading(s), m, scenario.checkedAt);
      return { passed: !answer, answer };
    },
  });
  if (photoid) out.push(expiryCheck('photoidExpired', 'expired photoid', photoid));
  if (pass) out.push(expiryCheck('passExpired', 'expired boardingPass', pass));
  if (photoid && pass) {
    out.push({
      key: 'match',
      blocks: true,
      decisionCase: 'travelerMatch',
      reads: ['MatchReading'],
      run: (s) => {
        const answer = travelerMatch(matchReading(s), exampleResolution792, photoid, pass);
        return { passed: answer, answer };
      },
    });
  }
  return out;
}

/** Every check whose credentials the traveler holds, under some settings. */
export const runChecks = (scenario: Scenario, s: Settings): CheckResult[] => planChecks(scenario).map((check) => resultOf(check, s));

/** The first check that refers the traveler to an agent, or undefined to board them. */
export const firstFailure = (results: CheckResult[]): CheckResult | undefined => results.find((r) => r.blocks && !r.passed);

/** Whether two answers are equal, whatever order their keys are in: the model's files sort theirs. */
export function sameAnswer(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameAnswer(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a).sort();
    const others = Object.keys(b).sort();
    return keys.length === others.length && keys.every((k, i) => k === others[i] && sameAnswer((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/** A finding or an advisory as a line of text, with its fields in the order the model's files have them. */
export function describeFinding(f: unknown): string {
  if (f === null || typeof f !== 'object') return String(f);
  return Object.keys(f)
    .sort()
    .map((k) => describeFinding((f as Record<string, unknown>)[k]))
    .join(' ');
}

/** The name of a check's line in the decisions files, whose points are sorted by key. */
export function decisionName(subject: { id: string }, r: CheckResult): string {
  const settings = Object.keys(r.points)
    .sort()
    .map((k) => `${k}=${r.points[k]}`);
  return [`${subject.id} ${r.decisionCase}`, ...settings].join(' ');
}
