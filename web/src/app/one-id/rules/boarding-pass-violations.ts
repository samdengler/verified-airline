import { bcbpNameSpace, bcbpStringId, boardingPassDocType } from './support/identifiers';
import { docTypeFindings, elementIn, nameFindings, nameSpaceNamed, nameSpacesNamed } from './support/mdoc';
import type { BoardingPassReading, Finding, Mdoc, NameSpace, Resolution792 } from './support/types';

function stringIn(x: Resolution792, ns: NameSpace): Finding[] {
  return ns.elements
    .filter((e) => e.identifier === bcbpStringId)
    .flatMap((e): Finding[] => {
      if (!('text' in e.value)) return [{ code: 'notText', nameSpace: bcbpNameSpace, identifier: bcbpStringId }];
      return x.follows(e.value.text) ? [] : [{ code: 'notResolution792' }];
    });
}

function stringFindings(x: Resolution792, m: Mdoc): Finding[] {
  const copies = nameSpacesNamed(m, bcbpNameSpace);
  if (copies.length === 0) return [{ code: 'missingNameSpace', name: bcbpNameSpace }];
  const first = nameSpaceNamed(m, bcbpNameSpace);
  return [
    ...(first && elementIn(first, bcbpStringId) === undefined
      ? [{ code: 'missingElement', nameSpace: bcbpNameSpace, identifier: bcbpStringId } as Finding]
      : []),
    ...copies.flatMap((ns) => stringIn(x, ns)),
  ];
}

function unlistedFindings(r: BoardingPassReading, m: Mdoc): Finding[] {
  if (r.unlistedDataAllowed) return [];
  return [
    ...m.nameSpaces.filter((ns) => ns.name !== bcbpNameSpace).map((ns): Finding => ({ code: 'unlistedNameSpace', name: ns.name })),
    ...nameSpacesNamed(m, bcbpNameSpace).flatMap((ns) =>
      ns.elements
        .filter((e) => e.identifier !== bcbpStringId)
        .map((e): Finding => ({ code: 'unlistedElement', nameSpace: bcbpNameSpace, identifier: e.identifier })),
    ),
  ];
}

/**
 * Every requirement the content of a credential breaks as a boarding pass;
 * empty for a boarding pass the system accepts.
 *
 * requirement: OID-103
 * lean: Rules.OneId.BoardingPass.violations
 */
export function boardingPassViolations(r: BoardingPassReading, x: Resolution792, m: Mdoc): Finding[] {
  return [
    ...docTypeFindings(boardingPassDocType, m),
    ...nameFindings(r.repeatedNamesRefused, m),
    ...stringFindings(x, m),
    ...unlistedFindings(r, m),
  ];
}
