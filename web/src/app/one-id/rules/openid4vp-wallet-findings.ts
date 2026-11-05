import { type Origin, sameOrigin } from './support/exchange';
import { type AuthorizationRequest, type Certificate, parameterFindings, type RequestReading, signatureFindings, type WalletReading } from './support/openid4vp';

export type WalletFinding =
  | { code: 'malformed' }
  | { code: 'originNotExpected'; origin: Origin }
  | { code: 'badSignature' }
  | { code: 'untrustedVerifier'; certificate: Certificate };

/**
 * The reasons a wallet does not answer an OpenID4VP request.
 *
 * requirement: OID-204
 * lean: Rules.OneId.OpenId4Vp.walletFindings
 */
export function openId4VpWalletFindings(r: RequestReading, w: WalletReading, trustedVerifiers: readonly Certificate[], seenOrigin: Origin, a: AuthorizationRequest): WalletFinding[] {
  return [
    ...(parameterFindings(r, a).length === 0 ? [] : [{ code: 'malformed' } as WalletFinding]),
    ...(a.expectedOrigins.some((o) => sameOrigin(o, seenOrigin)) ? [] : [{ code: 'originNotExpected', origin: seenOrigin } as WalletFinding]),
    ...(w.signatureChecked && signatureFindings(a).length > 0 ? [{ code: 'badSignature' } as WalletFinding] : []),
    ...(w.verifierListChecked && !trustedVerifiers.some((c) => c.name === a.clientCertificate.name) ? [{ code: 'untrustedVerifier', certificate: a.clientCertificate } as WalletFinding] : []),
  ];
}
