// The OpenID4VP request, from Rules/OneId/OpenId4Vp.lean.  Both the relying
// party's check of a request and the wallet's use these parts.
import type { Key, Nonce, Origin } from './exchange';

export interface Certificate {
  name: string;
}

export interface CredentialQuery {
  format: string;
  docType: string;
  claims: readonly (readonly [string, string])[];
}

export interface AuthorizationRequest {
  protocol: string;
  responseType: string;
  responseMode: string;
  clientIdPrefix: string;
  clientCertificate: Certificate;
  signedWith: Certificate | null;
  expectedOrigins: Origin[];
  encryptionKey: Key | null;
  credentials: CredentialQuery[];
  nonce: Nonce | null;
  state: string | null;
}

export interface RequestReading {
  stateRequired: boolean;
}

export interface WalletReading {
  signatureChecked: boolean;
  verifierListChecked: boolean;
}

export type RequestFinding =
  | { code: 'wrongProtocol'; found: string }
  | { code: 'wrongResponseType'; found: string }
  | { code: 'wrongResponseMode'; found: string }
  | { code: 'wrongClientIdPrefix'; found: string }
  | { code: 'notSigned' }
  | { code: 'signedWithAnotherKey' }
  | { code: 'noExpectedOrigins' }
  | { code: 'noEncryptionKey' }
  | { code: 'wrongFormat'; docType: string }
  | { code: 'noNonce' }
  | { code: 'noState' };

export const PROTOCOL = 'openid4vp-v1-signed';
export const RESPONSE_TYPE = 'vp_token';
export const RESPONSE_MODE = 'dc_api.jwt';
export const CLIENT_ID_PREFIX = 'x509_hash';
export const MDOC_FORMAT = 'mso_mdoc';

/** parameterFindings: what a wallet can check without validating the signature. */
export function parameterFindings(r: RequestReading, a: AuthorizationRequest): RequestFinding[] {
  return [
    ...(a.protocol === PROTOCOL ? [] : [{ code: 'wrongProtocol', found: a.protocol } as RequestFinding]),
    ...(a.responseType === RESPONSE_TYPE ? [] : [{ code: 'wrongResponseType', found: a.responseType } as RequestFinding]),
    ...(a.responseMode === RESPONSE_MODE ? [] : [{ code: 'wrongResponseMode', found: a.responseMode } as RequestFinding]),
    ...(a.clientIdPrefix === CLIENT_ID_PREFIX ? [] : [{ code: 'wrongClientIdPrefix', found: a.clientIdPrefix } as RequestFinding]),
    ...(a.expectedOrigins.length === 0 ? [{ code: 'noExpectedOrigins' } as RequestFinding] : []),
    ...(a.encryptionKey == null ? [{ code: 'noEncryptionKey' } as RequestFinding] : []),
    ...a.credentials.filter((c) => c.format !== MDOC_FORMAT).map((c): RequestFinding => ({ code: 'wrongFormat', docType: c.docType })),
    ...(a.nonce == null ? [{ code: 'noNonce' } as RequestFinding] : []),
    ...(r.stateRequired && a.state == null ? [{ code: 'noState' } as RequestFinding] : []),
  ];
}

/** signatureFindings: whether a request is signed with the key of the certificate its client identifier names. */
export function signatureFindings(a: AuthorizationRequest): RequestFinding[] {
  if (a.signedWith == null) return [{ code: 'notSigned' }];
  return a.signedWith.name === a.clientCertificate.name ? [] : [{ code: 'signedWithAnotherKey' }];
}
