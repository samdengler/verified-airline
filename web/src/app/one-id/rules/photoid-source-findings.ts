import type { Finding, PhotoidReading, SourceDocument } from './support/types';

/**
 * Whether the guide allows the kind of document a photoid was derived from,
 * under the reading of whether a passport is required.
 *
 * requirement: OID-109
 * lean: Rules.OneId.Photoid.sourceFindings
 */
export function photoidSourceFindings(r: PhotoidReading, source: SourceDocument): Finding[] {
  return r.passportRequired && source !== 'passport' ? [{ code: 'notFromPassport' }] : [];
}
