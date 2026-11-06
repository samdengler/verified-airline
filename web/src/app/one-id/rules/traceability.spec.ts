// From each thing on a screen to the model: every check in this folder names
// its requirement and Lean function in a comment, and the model has them.
// scripts/check_one_id.py reads the same comments when the build's content step
// runs, so a check with no requirement stops the build as well.
import { readFileSync, readdirSync } from 'node:fs';
import { PRESENTATION_READING_POINTS, READING_POINTS } from './support/readings';

const DIR = 'src/app/one-id/rules';
const model = JSON.parse(readFileSync('../model/one-id/model.json', 'utf8'));
const readings = JSON.parse(readFileSync('../model/one-id/readings.json', 'utf8')).readings as { id: string; checks: string[] }[];
const presentationReadings = JSON.parse(readFileSync('../model/one-id/presentation/readings.json', 'utf8')).readings as { id: string; checks: string[] }[];

interface Named {
  file: string;
  name: string;
  requirement?: string;
  lean?: string;
  /** A Lean function that is part of the requirement, beside the one it is named for. */
  part: boolean;
  outside?: string;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const checks: Named[] = files.flatMap((file) => {
  const text = readFileSync(`${DIR}/${file}`, 'utf8');
  return [...text.matchAll(/^export function (\w+)/gm)].map(([, name]) => {
    const doc = [...text.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*export function (\w+)/g)].find((m) => m[2] === name)?.[1] ?? '';
    return {
      file,
      name,
      requirement: doc.match(/requirement: (\S+)/)?.[1],
      lean: doc.match(/lean: (\S+)/)?.[1],
      part: /part of requirement:/.test(doc),
      outside: doc.match(/not in the model: (\S+)/)?.[1],
    };
  });
});

/** The plan's table, from each TypeScript function to its requirement. */
const TABLE: Record<string, string> = {
  element: 'OID-106',
  photoidViolations: 'OID-101',
  photoidAdvisories: 'OID-102',
  photoidSourceFindings: 'OID-109',
  boardingPassValidityFindings: 'OID-104',
  boardingPassViolations: 'OID-103',
  expired: 'OID-105',
  photoidValidityFindings: 'OID-108',
  travelerMatch: 'OID-107',
  walletRespond: 'OID-201',
  refusals: 'OID-202',
  openId4VpRequestFindings: 'OID-203',
  openId4VpReuseFindings: 'OID-203',
  openId4VpWalletFindings: 'OID-204',
  openId4VpTranscript: 'OID-205',
  openId4VpTokenFindings: 'OID-205',
  mdocProfileRequestFindings: 'OID-206',
  pairRefusals: 'OID-207',
  proximitySessionFindings: 'OID-301',
};

describe('traceability', () => {
  it('has one file for each check in the table, and no other', () => {
    expect(checks.map((c) => c.name).sort()).toEqual(Object.keys(TABLE).sort());
    expect(files.length).toBe(Object.keys(TABLE).length);
  });

  it.each(checks.filter((c) => !c.outside))('$name names a requirement the model has, with its Lean function', (c) => {
    expect(c.requirement).toBe(TABLE[c.name]);
    expect(Object.keys(model.requirements)).toContain(c.requirement);
    if (c.part) expect(c.lean).toMatch(/^Rules\.OneId\./);
    else expect(c.lean).toBe(model.requirements[c.requirement!].name);
  });

  it('leaves no check outside the model', () => {
    expect(checks.filter((c) => c.outside)).toEqual([]);
  });

  it('takes the reading points readings.json has, for the same checks', () => {
    expect(READING_POINTS).toEqual(Object.fromEntries(readings.map((r) => [r.id, r.checks])));
  });

  it('takes the reading points presentation/readings.json has, for the same checks', () => {
    expect(PRESENTATION_READING_POINTS).toEqual(Object.fromEntries(presentationReadings.map((r) => [r.id, r.checks])));
  });

  it('has a check for every requirement of the model', () => {
    const named = new Set(checks.map((c) => c.requirement));
    expect(Object.keys(model.requirements).filter((id) => !named.has(id))).toEqual([]);
  });
});
