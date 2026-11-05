import type { Finding, Journey, Mdoc, ValidityReading } from './support/types';

/**
 * Whether the validity of a boarding pass ends on or soon after the departure
 * of the last leg, for the departure and the length the reading names.
 *
 * requirement: OID-104
 * lean: Rules.OneId.BoardingPass.validityFindings
 */
export function boardingPassValidityFindings(v: ValidityReading, j: Journey, m: Mdoc): Finding[] {
  const departure = v.departure === 'scheduled' ? j.scheduledDeparture : j.actualDeparture;
  return [
    ...(m.validUntil < departure ? [{ code: 'endsBeforeLastDeparture' } as Finding] : []),
    ...(departure + v.soonAfter < m.validUntil ? [{ code: 'endsLongAfterLastDeparture' } as Finding] : []),
  ];
}
