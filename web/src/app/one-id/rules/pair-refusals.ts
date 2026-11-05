import { refusals } from './refusals';
import { type AcceptanceReading, type IsoTranscripts, type Issuer, type PairRefusal, type Presented, type PresentationRequest, sameKey } from './support/exchange';
import { boardingPassDocType, photoidDocType } from './support/identifiers';
import type { ExpiryReading, Instant, MatchReading, Resolution792 } from './support/types';
import { travelerMatch } from './traveler-match';

/**
 * The reasons a relying party refuses a photoid and a boarding pass presented
 * together: each must be accepted on its own, and the two must pass the check of
 * the reading.  No check they can pass says they are about one traveler.
 *
 * requirement: OID-207
 * lean: Rules.OneId.pairRefusals
 */
export function pairRefusals(
  r: AcceptanceReading,
  e: ExpiryReading,
  x: IsoTranscripts,
  trusted: readonly Issuer[],
  pr: { content: MatchReading; sameDeviceKey: boolean },
  x792: Resolution792,
  q: PresentationRequest,
  photoid: Presented,
  boardingPass: Presented,
  now: Instant,
): PairRefusal[] {
  const matched = travelerMatch(pr.content, x792, photoid.mdoc, boardingPass.mdoc) && (!pr.sameDeviceKey || sameKey(photoid.deviceKey, boardingPass.deviceKey));
  return [
    ...refusals(r, e, x, trusted, q, { documents: [photoid, boardingPass] }, now).map((reason): PairRefusal => ({ code: 'refused', reason })),
    ...(photoid.mdoc.docType === photoidDocType ? [] : [{ code: 'notAPhotoid', docType: photoid.mdoc.docType } as PairRefusal]),
    ...(boardingPass.mdoc.docType === boardingPassDocType ? [] : [{ code: 'notABoardingPass', docType: boardingPass.mdoc.docType } as PairRefusal]),
    ...(matched ? [] : [{ code: 'notOneTraveler' } as PairRefusal]),
  ];
}
