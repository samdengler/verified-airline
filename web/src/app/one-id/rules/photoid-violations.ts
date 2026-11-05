import { baseNameSpace, dataGroupsNameSpace, dg2Id, photoidDocType, photoidNameSpace, portraitId } from './support/identifiers';
import { docTypeFindings, elementIn, nameFindings, nameSpacesNamed, sameValue, values } from './support/mdoc';
import { entryOf, mandatory, missingMandatory, wronglyEncoded } from './support/tables';
import type { ElementTable, Finding, Mdoc, NameSpace, PhotoidReading, PhotoidTables } from './support/types';

function baseIn(r: PhotoidReading, t: PhotoidTables, ns: NameSpace): Finding[] {
  return [
    ...missingMandatory(t.base, ns).map((identifier): Finding => ({ code: 'missingElement', nameSpace: baseNameSpace, identifier })),
    ...wronglyEncoded(t.base, ns).map((e): Finding => ({ code: 'wrongEncoding', nameSpace: baseNameSpace, identifier: e.identifier })),
    ...(r.portraitRequired && elementIn(ns, portraitId) === undefined && !mandatory(t.base).includes(portraitId)
      ? [{ code: 'missingElement', nameSpace: baseNameSpace, identifier: portraitId } as Finding]
      : []),
  ];
}

function baseFindings(r: PhotoidReading, t: PhotoidTables, m: Mdoc): Finding[] {
  const copies = nameSpacesNamed(m, baseNameSpace);
  return copies.length === 0 ? [{ code: 'missingNameSpace', name: baseNameSpace }] : copies.flatMap((ns) => baseIn(r, t, ns));
}

function tableFindings(binds: boolean, t: ElementTable, name: string, m: Mdoc): Finding[] {
  if (!binds) return [];
  return nameSpacesNamed(m, name).flatMap((ns) =>
    missingMandatory(t, ns).map((identifier): Finding => ({ code: 'missingElement', nameSpace: name, identifier })),
  );
}

function tableOf(t: PhotoidTables, name: string): ElementTable | undefined {
  if (name === baseNameSpace) return t.base;
  if (name === photoidNameSpace) return t.photoid;
  if (name === dataGroupsNameSpace) return t.dataGroups;
  return undefined;
}

function unlistedIn(t: PhotoidTables, ns: NameSpace): Finding[] {
  const table = tableOf(t, ns.name);
  if (!table) return [{ code: 'unlistedNameSpace', name: ns.name }];
  return ns.elements
    .filter((e) => entryOf(table, e.identifier) === undefined)
    .map((e): Finding => ({ code: 'unlistedElement', nameSpace: ns.name, identifier: e.identifier }));
}

function portraitFindings(r: PhotoidReading, m: Mdoc): Finding[] {
  const differs =
    r.portraitIsDg2 &&
    values(m, baseNameSpace, portraitId).some((p) => values(m, dataGroupsNameSpace, dg2Id).some((d) => !sameValue(p, d)));
  return differs ? [{ code: 'portraitDiffersFromDg2' }] : [];
}

/**
 * Every requirement the content of a credential breaks as a photoid; empty
 * for a photoid the system accepts.
 *
 * requirement: OID-101
 * lean: Rules.OneId.Photoid.violations
 */
export function photoidViolations(r: PhotoidReading, t: PhotoidTables, m: Mdoc): Finding[] {
  return [
    ...docTypeFindings(photoidDocType, m),
    ...nameFindings(r.repeatedNamesRefused, m),
    ...baseFindings(r, t, m),
    ...tableFindings(r.photoidTableBinds, t.photoid, photoidNameSpace, m),
    ...tableFindings(r.dataGroupsTableBinds, t.dataGroups, dataGroupsNameSpace, m),
    ...(r.unlistedDataAllowed ? [] : m.nameSpaces.flatMap((ns) => unlistedIn(t, ns))),
    ...portraitFindings(r, m),
  ];
}
