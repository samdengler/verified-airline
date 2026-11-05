import { dataGroupsNameSpace, enrolmentPortraitId, photoidNameSpace } from './support/identifiers';
import { elementIn, nameSpaceNamed } from './support/mdoc';
import { mandatory, missingMandatory } from './support/tables';
import type { Advisory, ElementTable, Mdoc, PhotoidTables, SourceDocument } from './support/types';

function nameSpaceAdvisories(t: ElementTable, name: string, extra: string[], m: Mdoc): Advisory[] {
  const ns = nameSpaceNamed(m, name);
  if (!ns) return [{ code: 'missingRecommendedNameSpace', name }];
  const missing = [...missingMandatory(t, ns), ...extra.filter((id) => elementIn(ns, id) === undefined && !mandatory(t).includes(id))];
  return missing.map((identifier): Advisory => ({ code: 'missingRecommendedElement', nameSpace: name, identifier }));
}

/**
 * The recommendations of the guide a photoid does not follow.  None of them
 * makes the photoid unacceptable.
 *
 * requirement: OID-102
 * lean: Rules.OneId.Photoid.advisories
 */
export function photoidAdvisories(t: PhotoidTables, source: SourceDocument, m: Mdoc): Advisory[] {
  return [
    ...(source === 'passport' ? [] : [{ code: 'notDerivedFromPassport' } as Advisory]),
    ...nameSpaceAdvisories(t.photoid, photoidNameSpace, [enrolmentPortraitId], m),
    ...nameSpaceAdvisories(t.dataGroups, dataGroupsNameSpace, [], m),
  ];
}
