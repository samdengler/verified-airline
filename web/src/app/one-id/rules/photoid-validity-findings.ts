import type { Finding, Instant, Mdoc, PhotoidValidityReading } from './support/types';

/**
 * How the validity of a photoid relates to the expiry of the document it was
 * derived from, under the reading.
 *
 * requirement: OID-108
 * lean: Rules.OneId.Photoid.validityFindings
 */
export function photoidValidityFindings(r: PhotoidValidityReading, documentExpiry: Instant, m: Mdoc): Finding[] {
  return r === 'endsWithDocument' && documentExpiry < m.validUntil ? [{ code: 'outlivesSourceDocument' }] : [];
}
