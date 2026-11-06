import type { ElementRef, Key, Nonce } from './support/exchange';

export interface DeviceRequest {
  protocol: string;
  encryptionProtocol: string;
  nonce: Nonce | null;
  recipientKey: Key | null;
  elements: ElementRef[];
}

export type MdocProfileRequest = DeviceRequest;

export type MdocRequestFinding =
  | { code: 'wrongProtocol'; found: string }
  | { code: 'wrongEncryptionProtocol'; found: string }
  | { code: 'noNonce' }
  | { code: 'weakNonce'; entropyBytes: number }
  | { code: 'noRecipientKey' };

const PROTOCOL = 'org-iso-mdoc';
const ENCRYPTION_PROTOCOL = 'dcapi';
const MINIMUM_NONCE_ENTROPY = 16;

/**
 * What a request of the mdoc profile lacks of what the guide requires of one.
 *
 * requirement: OID-206
 * lean: Rules.OneId.MdocProfile.requestFindings
 */
export function mdocProfileRequestFindings(d: DeviceRequest): MdocRequestFinding[] {
  return [
    ...(d.protocol === PROTOCOL ? [] : [{ code: 'wrongProtocol', found: d.protocol } as MdocRequestFinding]),
    ...(d.encryptionProtocol === ENCRYPTION_PROTOCOL ? [] : [{ code: 'wrongEncryptionProtocol', found: d.encryptionProtocol } as MdocRequestFinding]),
    ...(d.nonce == null ? [{ code: 'noNonce' } as MdocRequestFinding] : d.nonce.entropyBytes >= MINIMUM_NONCE_ENTROPY ? [] : [{ code: 'weakNonce', entropyBytes: d.nonce.entropyBytes } as MdocRequestFinding]),
    ...(d.recipientKey == null ? [{ code: 'noRecipientKey' } as MdocRequestFinding] : []),
  ];
}
