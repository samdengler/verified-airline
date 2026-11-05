import type { ExpiryReading, Instant, Mdoc } from './support/types';

/**
 * Whether a credential is expired at a time, under the reading of whether it
 * is still valid at the exact instant its validity ends.
 *
 * requirement: OID-105
 * lean: Rules.OneId.expired
 */
export function expired(e: ExpiryReading, m: Mdoc, now: Instant): boolean {
  return e.validAtEnd ? m.validUntil < now : m.validUntil <= now;
}
