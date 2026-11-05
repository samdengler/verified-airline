import type { Presented } from './support/exchange';

export type TokenFinding = { code: 'severalMdocs'; count: number };

/**
 * The device responses of a token that hold more than one mdoc.
 *
 * part of requirement: OID-205
 * lean: Rules.OneId.OpenId4Vp.tokenFindings
 */
export function openId4VpTokenFindings(token: readonly (readonly Presented[])[]): TokenFinding[] {
  return token.filter((dr) => dr.length > 1).map((dr): TokenFinding => ({ code: 'severalMdocs', count: dr.length }));
}
