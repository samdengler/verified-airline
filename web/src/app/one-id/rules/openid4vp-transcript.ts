import type { Key, Nonce, Origin, SessionTranscript } from './support/exchange';

/**
 * The session transcript of the OpenID4VP profile: the origin of the request,
 * the nonce and the relying party's encryption key.  The model keeps the three
 * values in place of the hash the specification defines.
 *
 * requirement: OID-205
 * lean: Rules.OneId.OpenId4Vp.transcript
 */
export function openId4VpTranscript(origin: Origin, nonce: Nonce, encryptionKey: Key): SessionTranscript {
  return { handover: { origin, nonce, encryptionKey } };
}
