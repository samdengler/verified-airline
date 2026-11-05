import type { AuthorizationRequest } from './support/openid4vp';

export type ReuseFinding = { code: 'nonceReused' } | { code: 'encryptionKeyReused' };

const distinct = (xs: string[]): boolean => new Set(xs).size === xs.length;

/**
 * The nonces and encryption keys the requests of one relying party share.  A
 * request that lacks one is refused on its own and is not counted here.
 *
 * part of requirement: OID-203
 * lean: Rules.OneId.OpenId4Vp.reuseFindings
 */
export function openId4VpReuseFindings(requests: readonly AuthorizationRequest[]): ReuseFinding[] {
  const nonces = requests.flatMap((a) => (a.nonce == null ? [] : [JSON.stringify([a.nonce.value, a.nonce.entropyBytes])]));
  const keys = requests.flatMap((a) => (a.encryptionKey == null ? [] : [a.encryptionKey.name]));
  return [...(distinct(nonces) ? [] : [{ code: 'nonceReused' } as ReuseFinding]), ...(distinct(keys) ? [] : [{ code: 'encryptionKeyReused' } as ReuseFinding])];
}
