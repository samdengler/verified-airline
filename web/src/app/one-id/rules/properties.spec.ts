// The proven theorems of Rules/OneId/Theorems.lean restated for the TypeScript,
// each tagged with the criterion it checks.  A pass means the code held on every
// input tried.  The proofs are about the Lean model.  A theorem proven for one
// reading, named <theorem>_of_<reading>, checks no criterion and is tagged with
// its name alone.
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { boardingPassValidityFindings } from './boarding-pass-validity-findings';
import { boardingPassViolations } from './boarding-pass-violations';
import { element } from './element';
import { expired } from './expired';
import { photoidAdvisories } from './photoid-advisories';
import { photoidSourceFindings } from './photoid-source-findings';
import { photoidValidityFindings } from './photoid-validity-findings';
import { photoidViolations } from './photoid-violations';
import { baseNameSpace, bcbpNameSpace, bcbpStringId, boardingPassDocType, dataGroupsNameSpace, dg2Id, enrolmentPortraitId, familyNameId, givenNameId, photoidDocType, photoidNameSpace, portraitId } from './support/identifiers';
import { elementIn, nameSpaceNamed, nameSpacesNamed, sameValue, values, wellFormed } from './support/mdoc';
import { exampleResolution792 } from './support/stand-ins';
import { accepts, entryOf, mandatory, missingMandatory } from './support/tables';
import type { BoardingPassReading, ElementTable, Encoding, Journey, Mdoc, NameSpace, PhotoidReading, PhotoidTables, Resolution792, Value } from './support/types';
import { travelerMatch } from './traveler-match';

const model = JSON.parse(readFileSync('../model/one-id/model.json', 'utf8'));

const IDS = [familyNameId, givenNameId, portraitId, enrolmentPortraitId, dg2Id, 'sod', bcbpStringId, 'extra'];
const NAMES = [baseNameSpace, photoidNameSpace, dataGroupsNameSpace, bcbpNameSpace, 'org.example.1'];

/** Three times in four the first, so inputs that meet a theorem's premise are common. */
const mostly = <T>(a: fc.Arbitrary<T>, b: fc.Arbitrary<T>): fc.Arbitrary<T> => fc.integer({ min: 0, max: 3 }).chain((i) => (i < 3 ? a : b));

const instant = fc.integer({ min: 0, max: 30 });
const value: fc.Arbitrary<Value> = fc.oneof(
  fc.record({ text: fc.constantFrom('SMITH', 'JOHN', 'EXAMPLE:SMITH/JOHN', 'not a pass') }),
  fc.record({ bytes: fc.array(fc.nat({ max: 2 }), { maxLength: 2 }) }),
  fc.record({ flag: fc.boolean() }),
  fc.record({ other: fc.constant('43') }),
);
const dataElement = fc.record({ identifier: fc.constantFrom(...IDS), value });
const nameSpace: fc.Arbitrary<NameSpace> = fc.record({ name: fc.constantFrom(...NAMES), elements: fc.array(dataElement, { maxLength: 4 }) });
const docType = fc.constantFrom(photoidDocType, boardingPassDocType, 'org.example.document');
const anyMdoc: fc.Arbitrary<Mdoc> = fc.record({ docType, nameSpaces: fc.array(nameSpace, { maxLength: 4 }), validUntil: instant });
const uniqueMdoc: fc.Arbitrary<Mdoc> = fc.record({
  docType,
  nameSpaces: fc.uniqueArray(
    fc.record({ name: fc.constantFrom(...NAMES), elements: fc.uniqueArray(dataElement, { maxLength: 4, selector: (e) => e.identifier }) }),
    { maxLength: 4, selector: (ns) => ns.name },
  ),
  validUntil: instant,
});

const encoding = fc.constantFrom<Encoding>('text', 'bytes', 'flag', 'other');
const table: fc.Arbitrary<ElementTable> = fc.record({
  entries: fc.array(fc.record({ identifier: fc.constantFrom(...IDS), presence: fc.constantFrom<'mandatory' | 'optional' | 'other'>('mandatory', 'optional', 'other'), encoding }), { maxLength: 4 }),
});
const tables: fc.Arbitrary<PhotoidTables> = fc.record({ base: table, photoid: table, dataGroups: table });

const photoidReading: fc.Arbitrary<PhotoidReading> = fc.record({
  portraitRequired: fc.boolean(),
  unlistedDataAllowed: fc.boolean(),
  portraitIsDg2: fc.boolean(),
  photoidTableBinds: fc.boolean(),
  dataGroupsTableBinds: fc.boolean(),
  repeatedNamesRefused: fc.boolean(),
  passportRequired: fc.boolean(),
});
const boardingPassReading: fc.Arbitrary<BoardingPassReading> = fc.record({ unlistedDataAllowed: fc.boolean(), repeatedNamesRefused: fc.boolean() });
const expiryReading = fc.record({ validAtEnd: fc.boolean() });
const validityReading = fc.record({ departure: fc.constantFrom<'scheduled' | 'actual'>('scheduled', 'actual'), soonAfter: fc.integer({ min: 0, max: 10 }) });
const journey: fc.Arbitrary<Journey> = fc.record({ scheduledDeparture: instant, actualDeparture: instant, completed: instant });
const source = fc.constantFrom<'passport' | 'other'>('passport', 'other');
// For every value Resolution 792 could have, and the stand-in.
const resolution792: fc.Arbitrary<Resolution792> = mostly<Resolution792>(
  fc.record({
    follows: fc.func<[string], boolean>(fc.boolean()),
    passenger: fc.func<[string], readonly [string, string] | undefined>(fc.option(fc.constant(['SMITH', 'JOHN'] as const), { nil: undefined })),
  }),
  fc.constant(exampleResolution792),
);

const conforming = (e: Encoding): Value => (e === 'text' ? { text: 'SMITH' } : e === 'bytes' ? { bytes: [1] } : e === 'flag' ? { flag: true } : { other: '43' });

/** A photoid built to hold what a table marks mandatory, so that accepted photoids are common among the inputs. */
function nearlyAccepted(t: PhotoidTables, extra: NameSpace[], validUntil: number): Mdoc {
  const fill = (name: string, tb: ElementTable, more: string[]): NameSpace => ({
    name,
    elements: [...new Set([...mandatory(tb), ...more])].map((identifier) => ({
      identifier,
      value: conforming(entryOf(tb, identifier)?.encoding ?? 'bytes'),
    })),
  });
  return {
    docType: photoidDocType,
    nameSpaces: [fill(baseNameSpace, t.base, [portraitId]), ...extra.map((ns) => (ns.name === photoidNameSpace ? fill(ns.name, t.photoid, []) : ns.name === dataGroupsNameSpace ? fill(ns.name, t.dataGroups, []) : ns))],
    validUntil,
  };
}
const photoidCase: fc.Arbitrary<{ t: PhotoidTables; r: PhotoidReading; m: Mdoc }> = tables.chain((t) =>
  fc.record({
    t: fc.constant(t),
    r: photoidReading,
    m: mostly(fc.tuple(fc.array(nameSpace, { maxLength: 2 }), instant).map(([extra, until]) => nearlyAccepted(t, extra, until)), anyMdoc),
  }),
);

const listedPass: NameSpace[] = [{ name: bcbpNameSpace, elements: [{ identifier: bcbpStringId, value: { text: 'EXAMPLE:SMITH/JOHN' } }] }];
const nearlyAcceptedPass: fc.Arbitrary<Mdoc> = fc.record({
  docType: fc.constant(boardingPassDocType),
  nameSpaces: mostly(fc.constant(listedPass), fc.array(nameSpace, { maxLength: 3 })),
  validUntil: instant,
});
const passCase: fc.Arbitrary<{ r: BoardingPassReading; x: Resolution792; m: Mdoc }> = fc.record({ r: boardingPassReading, x: resolution792, m: mostly(nearlyAcceptedPass, anyMdoc) });

const registered: { criteria: string[]; theorem: string }[] = [];

/** One theorem as a property: its premise must hold on enough of the generated inputs for the run to mean anything. */
function theorem<T>(criteria: string[], name: string, inputs: fc.Arbitrary<T>, premise: (x: T) => boolean, conclusion: (x: T) => boolean): void {
  registered.push({ criteria, theorem: name });
  it(`${criteria.length ? criteria.join(' ') : 'for one reading'}: ${name}`, () => {
    let met = 0;
    fc.assert(
      fc.property(inputs, (x) => {
        if (!premise(x)) return true;
        met++;
        return conclusion(x);
      }),
      { numRuns: 1000 },
    );
    expect(met).toBeGreaterThan(10);
  });
}

const accepted = ({ r, t, m }: { r: PhotoidReading; t: PhotoidTables; m: Mdoc }) => photoidViolations(r, t, m).length === 0;
const passAccepted = ({ r, x, m }: { r: BoardingPassReading; x: Resolution792; m: Mdoc }) => boardingPassViolations(r, x, m).length === 0;
const everywhere = () => true;

describe('the proven theorems as properties', () => {
  describe('data elements and their names', () => {
    theorem(['OID-106.1'], 'element_addressable', uniqueMdoc, (m) => wellFormed(m), (m) =>
      m.nameSpaces.every((ns) => ns.elements.every((e) => {
        const v = element(m, ns.name, e.identifier);
        return v !== undefined && sameValue(v, e.value);
      })));
    theorem(['OID-106.2'], 'element_absent',
      fc.record({ m: anyMdoc, name: fc.constantFrom(...NAMES), identifier: fc.constantFrom(...IDS) }),
      ({ m, name, identifier }) => m.nameSpaces.every((ns) => ns.name !== name || ns.elements.every((e) => e.identifier !== identifier)),
      ({ m, name, identifier }) => element(m, name, identifier) === undefined);
  });

  describe('the photoid', () => {
    theorem(['OID-101.1'], 'photoid_docType', photoidCase, accepted, ({ m }) => m.docType === photoidDocType);
    theorem(['OID-101.2'], 'photoid_has_base', photoidCase, accepted, ({ m }) => nameSpaceNamed(m, baseNameSpace) !== undefined);
    theorem(['OID-101.3'], 'photoid_has_mandatory_base', photoidCase, accepted, ({ t, m }) =>
      mandatory(t.base).every((id) => element(m, baseNameSpace, id) !== undefined));
    theorem(['OID-101.4'], 'photoid_base_encoding', photoidCase, accepted, ({ t, m }) =>
      nameSpacesNamed(m, baseNameSpace).every((ns) => ns.elements.every((e) => {
        const entry = entryOf(t.base, e.identifier);
        return !entry || accepts(entry.encoding, e.value);
      })));
    theorem([], 'photoid_has_portrait_of_portraitRequired', photoidCase, (c) => c.r.portraitRequired && accepted(c), ({ m }) =>
      element(m, baseNameSpace, portraitId) !== undefined);
    theorem([], 'photoid_only_listed_of_closed', photoidCase, (c) => !c.r.unlistedDataAllowed && accepted(c), ({ t, m }) =>
      m.nameSpaces.every((ns) => {
        const tb = ns.name === baseNameSpace ? t.base : ns.name === photoidNameSpace ? t.photoid : ns.name === dataGroupsNameSpace ? t.dataGroups : undefined;
        return !!tb && ns.elements.every((e) => entryOf(tb, e.identifier) !== undefined);
      }));
    theorem([], 'portrait_is_dg2_of_portraitIsDg2', photoidCase, (c) => c.r.portraitIsDg2 && accepted(c), ({ m }) =>
      values(m, baseNameSpace, portraitId).every((p) => values(m, dataGroupsNameSpace, dg2Id).every((d) => sameValue(p, d))));
    theorem([], 'photoid_nameSpace_complete_of_photoidTableBinds', photoidCase, (c) => c.r.photoidTableBinds && accepted(c), ({ t, m }) =>
      nameSpacesNamed(m, photoidNameSpace).every((ns) => missingMandatory(t.photoid, ns).length === 0));
    theorem([], 'dataGroups_nameSpace_complete_of_dataGroupsTableBinds', photoidCase, (c) => c.r.dataGroupsTableBinds && accepted(c), ({ t, m }) =>
      nameSpacesNamed(m, dataGroupsNameSpace).every((ns) => missingMandatory(t.dataGroups, ns).length === 0));
    theorem([], 'photoid_names_unique_of_repeatedNamesRefused', photoidCase, (c) => c.r.repeatedNamesRefused && accepted(c), ({ m }) => wellFormed(m));
    theorem([], 'photoid_from_passport_of_passportRequired', fc.record({ r: photoidReading, s: source }), ({ r, s }) =>
      r.passportRequired && photoidSourceFindings(r, s).length === 0, ({ s }) => s === 'passport');
  });

  describe('recommendations for a photoid', () => {
    const advisory = fc.record({ t: tables, s: source, m: mostly(anyMdoc, uniqueMdoc) });
    theorem(['OID-102.1'], 'advises_photoid_nameSpace', advisory, ({ m }) => nameSpaceNamed(m, photoidNameSpace) === undefined, ({ t, s, m }) =>
      photoidAdvisories(t, s, m).some((a) => a.code === 'missingRecommendedNameSpace' && a.name === photoidNameSpace));
    theorem(['OID-102.1'], 'advises_dataGroups_nameSpace', advisory, ({ m }) => nameSpaceNamed(m, dataGroupsNameSpace) === undefined, ({ t, s, m }) =>
      photoidAdvisories(t, s, m).some((a) => a.code === 'missingRecommendedNameSpace' && a.name === dataGroupsNameSpace));
    theorem(['OID-102.2'], 'advises_enrolment_portrait', advisory,
      ({ m }) => {
        const ns = nameSpaceNamed(m, photoidNameSpace);
        return !!ns && elementIn(ns, enrolmentPortraitId) === undefined;
      },
      ({ t, s, m }) => photoidAdvisories(t, s, m).some((a) => a.code === 'missingRecommendedElement' && a.nameSpace === photoidNameSpace && a.identifier === enrolmentPortraitId));
    theorem(['OID-102.3'], 'advises_source_document', fc.record({ t: tables, m: anyMdoc }), everywhere, ({ t, m }) =>
      photoidAdvisories(t, 'other', m).some((a) => a.code === 'notDerivedFromPassport'));
    theorem(['OID-102.4'], 'recommended_nameSpace_never_required', photoidCase, everywhere, ({ r, t, m }) =>
      !photoidViolations(r, t, m).some((f) => f.code === 'missingNameSpace' && (f.name === photoidNameSpace || f.name === dataGroupsNameSpace)));
  });

  describe('the boarding pass', () => {
    theorem(['OID-103.1'], 'boardingPass_docType', passCase, passAccepted, ({ m }) => m.docType === boardingPassDocType);
    theorem(['OID-103.2', 'OID-103.3', 'OID-103.4', 'OID-103.5'], 'boardingPass_has_string', passCase, passAccepted, ({ x, m }) => {
      const v = element(m, bcbpNameSpace, bcbpStringId);
      return !!v && 'text' in v && x.follows(v.text);
    });
    theorem(['OID-103.4', 'OID-103.5'], 'boardingPass_strings_follow', passCase, passAccepted, ({ x, m }) =>
      values(m, bcbpNameSpace, bcbpStringId).every((v) => 'text' in v && x.follows(v.text)));
    theorem(['OID-101.1', 'OID-103.1'], 'not_photoid_and_boardingPass',
      fc.record({ r: photoidReading, t: tables, b: boardingPassReading, x: resolution792, m: mostly(nearlyAcceptedPass, anyMdoc) }),
      ({ b, x, m }) => boardingPassViolations(b, x, m).length === 0,
      ({ r, t, m }) => photoidViolations(r, t, m).length > 0);
    theorem([], 'boardingPass_only_listed_of_closed', passCase, (c) => !c.r.unlistedDataAllowed && passAccepted(c), ({ m }) =>
      m.nameSpaces.every((ns) => ns.name === bcbpNameSpace && ns.elements.every((e) => e.identifier === bcbpStringId)));
    theorem([], 'boardingPass_names_unique_of_repeatedNamesRefused', passCase, (c) => c.r.repeatedNamesRefused && passAccepted(c), ({ m }) => wellFormed(m));
  });

  describe('validity', () => {
    const at = fc.record({ e: expiryReading, m: anyMdoc, now: instant, later: instant });
    theorem(['OID-105.1'], 'expired_after_validUntil', at, ({ m, now }) => m.validUntil < now, ({ e, m, now }) => expired(e, m, now));
    theorem(['OID-105.2'], 'valid_before_validUntil', at, ({ m, now }) => now < m.validUntil, ({ e, m, now }) => !expired(e, m, now));
    theorem(['OID-105.3'], 'expired_stays_expired', at, ({ e, m, now, later }) => expired(e, m, now) && now <= later, ({ e, m, later }) => expired(e, m, later));
    theorem([], 'valid_at_validUntil_of_validAtEnd', at, ({ e, m, now }) => e.validAtEnd && now <= m.validUntil, ({ e, m, now }) => !expired(e, m, now));

    const departure = ({ v, j }: { v: { departure: string }; j: Journey }) => (v.departure === 'scheduled' ? j.scheduledDeparture : j.actualDeparture);
    // Mostly a validity that ends in the window the reading allows.
    const pass = mostly(
      fc.record({ e: expiryReading, v: validityReading, j: journey, m: anyMdoc, now: instant, offset: fc.nat({ max: 10 }) }).map((c) => ({
        ...c,
        m: { ...c.m, validUntil: departure(c) + Math.min(c.offset, c.v.soonAfter) },
      })),
      fc.record({ e: expiryReading, v: validityReading, j: journey, m: anyMdoc, now: instant, offset: fc.constant(0) }),
    );
    const fits = (c: { v: Parameters<typeof boardingPassValidityFindings>[0]; j: Journey; m: Mdoc }) => boardingPassValidityFindings(c.v, c.j, c.m).length === 0;
    theorem(['OID-104.1'], 'validity_reaches_departure', pass, fits, (c) => departure(c) <= c.m.validUntil);
    theorem(['OID-104.2'], 'validity_ends_soon_after', pass, fits, (c) => c.m.validUntil <= departure(c) + c.v.soonAfter);
    theorem(['OID-104.3'], 'valid_before_departure', pass, (c) => fits(c) && c.now < departure(c), (c) => !expired(c.e, c.m, c.now));
    theorem([], 'expired_once_journey_completed_of_short_window', pass,
      (c) => fits(c) && departure(c) + c.v.soonAfter <= c.j.completed && c.j.completed < c.now, (c) => expired(c.e, c.m, c.now));
    theorem([], 'valid_until_actual_departure_of_actual', pass,
      (c) => c.v.departure === 'actual' && fits(c) && c.now < c.j.actualDeparture, (c) => !expired(c.e, c.m, c.now));
    theorem([], 'photoid_expires_with_document_of_endsWithDocument', fc.record({ e: expiryReading, d: instant, m: anyMdoc, now: instant }),
      ({ d, m, now }) => photoidValidityFindings('endsWithDocument', d, m).length === 0 && d < now, ({ e, m, now }) => expired(e, m, now));
  });

  describe('one traveler', () => {
    theorem([], 'same_traveler_matches_of_notChecked', fc.record({ x: resolution792, p: anyMdoc, b: anyMdoc }), everywhere, ({ x, p, b }) =>
      travelerMatch('notChecked', x, p, b));
  });

  it('has a property for every proven criterion of the credential checks', () => {
    const tagged = new Set(registered.flatMap((t) => t.criteria));
    const proven = Object.entries<{ criteria: { id: string; status: string }[] }>(model.requirements)
      .filter(([id]) => id.startsWith('OID-1'))
      .flatMap(([, r]) => r.criteria.filter((c) => c.status === 'proven').map((c) => c.id));
    expect(proven.filter((c) => !tagged.has(c))).toEqual([]);
    expect([...tagged].filter((c) => !proven.includes(c))).toEqual([]);
  });
});
