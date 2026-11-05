import { type AuthorizationRequest, parameterFindings, type RequestFinding, type RequestReading, signatureFindings } from './support/openid4vp';

/**
 * What an OpenID4VP request lacks of what the guide requires of one.
 *
 * requirement: OID-203
 * lean: Rules.OneId.OpenId4Vp.requestFindings
 */
export function openId4VpRequestFindings(r: RequestReading, a: AuthorizationRequest): RequestFinding[] {
  return [...parameterFindings(r, a), ...signatureFindings(a)];
}
