// The model's checks for one traveler under one set of switches.  Each result
// comes from a function in rules/.  Combining them into a decision (`decide`)
// is ordinary code, and the gate's banner carries a grey marker that says so.
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
import type { Advisory, Finding } from './rules/support/types';
import { travelerMatch } from './rules/traveler-match';

export type CheckKey = 'photoid' | 'source' | 'advisories' | 'photoidValidity' | 'boardingPass' | 'passValidity' | 'photoidExpired' | 'passExpired' | 'match';

export interface CheckResult {
  key: CheckKey;
  /** False when a failure refers the traveler to an agent.  Only the recommendations cannot. */
  blocks: boolean;
  passed: boolean;
  /** The check's answer, in the form the model's table records it. */
  answer: (Finding | Advisory)[] | boolean;
  /** Its name in decisions.jsonl, without the scenario. */
  decisionCase: string;
  /** The reading points the check read, with their settings. */
  points: Readonly<Record<string, Settings[string]>>;
}

const pick = (s: Settings, ...ids: string[]): Record<string, Settings[string]> => Object.fromEntries(ids.map((id) => [id, s[id]]));

const PHOTOID_POINTS = ['PhotoidReading.dataGroupsTableBinds', 'PhotoidReading.photoidTableBinds', 'PhotoidReading.portraitIsDg2', 'PhotoidReading.portraitRequired', 'PhotoidReading.repeatedNamesRefused', 'PhotoidReading.unlistedDataAllowed'];

function findings(key: CheckKey, decisionCase: string, answer: (Finding | Advisory)[], points: CheckResult['points'], blocks = true): CheckResult {
  return { key, blocks, passed: answer.length === 0, answer, decisionCase, points };
}

/** Every check whose credentials the traveler holds. */
export function runChecks(scenario: Scenario, s: Settings): CheckResult[] {
  const photoid = credentialOf(scenario, 'photoid');
  const pass = credentialOf(scenario, 'boardingPass');
  const source = scenario.sourceDocument;
  const journey = scenario.journey;
  const expiry = pick(s, 'ExpiryReading.validAtEnd');
  const out: CheckResult[] = [];
  if (photoid) {
    out.push(findings('photoid', 'Photoid.violations', photoidViolations(photoidReading(s), tables, photoid), pick(s, ...PHOTOID_POINTS)));
    if (source) {
      out.push(findings('source', 'Photoid.sourceFindings', photoidSourceFindings(photoidReading(s), source.kind), pick(s, 'PhotoidReading.passportRequired')));
      out.push(findings('advisories', 'Photoid.advisories', photoidAdvisories(tables, source.kind, photoid), {}, false));
      out.push(findings('photoidValidity', 'Photoid.validityFindings', photoidValidityFindings(photoidValidityReading(s), source.expires, photoid), pick(s, 'PhotoidValidityReading')));
    }
  }
  if (pass) {
    out.push(findings('boardingPass', 'BoardingPass.violations', boardingPassViolations(boardingPassReading(s), exampleResolution792, pass), pick(s, 'BoardingPassReading.repeatedNamesRefused', 'BoardingPassReading.unlistedDataAllowed')));
    if (journey) {
      out.push(findings('passValidity', 'BoardingPass.validityFindings', boardingPassValidityFindings(validityReading(s), journey, pass), pick(s, 'ValidityReading.departure', 'ValidityReading.soonAfter')));
    }
  }
  if (photoid) {
    const answer = expired(expiryReading(s), photoid, scenario.checkedAt);
    out.push({ key: 'photoidExpired', blocks: true, passed: !answer, answer, decisionCase: 'expired photoid', points: expiry });
  }
  if (pass) {
    const answer = expired(expiryReading(s), pass, scenario.checkedAt);
    out.push({ key: 'passExpired', blocks: true, passed: !answer, answer, decisionCase: 'expired boardingPass', points: expiry });
  }
  if (photoid && pass) {
    const answer = travelerMatch(matchReading(s), exampleResolution792, photoid, pass);
    out.push({ key: 'match', blocks: true, passed: answer, answer, decisionCase: 'travelerMatch', points: pick(s, 'MatchReading') });
  }
  return out;
}

/** The first check that refers the traveler to an agent, or undefined to board them. */
export const firstFailure = (results: CheckResult[]): CheckResult | undefined => results.find((r) => r.blocks && !r.passed);

/** The name of a check's line in decisions.jsonl, whose points are sorted by key. */
export function decisionName(scenario: Scenario, r: CheckResult): string {
  const settings = Object.keys(r.points)
    .sort()
    .map((k) => `${k}=${r.points[k]}`);
  return [`${scenario.id} ${r.decisionCase}`, ...settings].join(' ');
}
