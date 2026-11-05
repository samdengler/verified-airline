import { element } from './element';
import { baseNameSpace, bcbpNameSpace, bcbpStringId, familyNameId, givenNameId } from './support/identifiers';
import type { MatchReading, Mdoc, Resolution792 } from './support/types';

function photoidName(m: Mdoc): readonly [string, string] | undefined {
  const family = element(m, baseNameSpace, familyNameId);
  const given = element(m, baseNameSpace, givenNameId);
  return family && given && 'text' in family && 'text' in given ? [family.text, given.text] : undefined;
}

function boardingPassName(x: Resolution792, m: Mdoc): readonly [string, string] | undefined {
  const value = element(m, bcbpNameSpace, bcbpStringId);
  return value && 'text' in value ? x.passenger(value.text) : undefined;
}

/**
 * Whether a photoid and a boarding pass presented together pass the check of
 * the reading.  No check of their content can say they are about one traveler;
 * who a credential is about is fixed when it is issued.
 *
 * requirement: OID-107
 * lean: Rules.OneId.travelerMatch
 */
export function travelerMatch(r: MatchReading, x: Resolution792, photoid: Mdoc, boardingPass: Mdoc): boolean {
  if (r === 'notChecked') return true;
  const a = photoidName(photoid);
  const b = boardingPassName(x, boardingPass);
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}
