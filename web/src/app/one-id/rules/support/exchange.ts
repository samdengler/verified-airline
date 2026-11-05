// What a wallet and a relying party exchange, from Rules/OneId/Exchange.lean,
// in the JSON form lake exe oracle reads and writes.  No cryptography is
// modelled: a key, a nonce and an origin are values that can only be compared,
// and whether a signature verifies is a field of the thing signed.
import type { Finding, Mdoc } from './types';

export interface Key {
  name: string;
}

export interface Nonce {
  value: string;
  entropyBytes: number;
}

export interface Origin {
  value: string;
}

export interface Issuer {
  name: string;
}

/** One data element of one kind of credential. */
export interface ElementRef {
  docType: string;
  nameSpace: string;
  identifier: string;
}

export type Profile = 'mdocOverDcApi' | 'openid4vp' | 'proximity';

export type SessionTranscript = { handover: { origin: Origin; nonce: Nonce; encryptionKey: Key } } | { iso: string };

export interface DeviceSignature {
  key: Key;
  transcript: SessionTranscript;
}

/** A credential as it was issued and as a wallet holds it. */
export interface Held {
  mdoc: Mdoc;
  subject: { id: string };
  issuer: Issuer;
  deviceKey: Key;
}

/** One credential as a relying party receives it. */
export interface Presented {
  mdoc: Mdoc;
  issuer: Issuer;
  issuerSignatureValid: boolean;
  deviceKey: Key;
  deviceSignature: DeviceSignature | null;
}

export interface WalletResponse {
  documents: Presented[];
}

export interface PresentationRequest {
  profile: Profile;
  origin: Origin;
  nonce: Nonce;
  encryptionKey: Key;
  engagementKey: Key | null;
  elements: ElementRef[];
}

export interface Consent {
  approved: ElementRef[];
}

/** What the ISO documents decide about a session transcript, which verified-id has not read: a parameter. */
export interface IsoTranscripts {
  annexC(q: PresentationRequest): SessionTranscript;
  proximity(q: PresentationRequest): SessionTranscript;
}

export type Refusal =
  | { code: 'untrustedIssuer'; issuer: Issuer }
  | { code: 'issuerSignatureInvalid'; docType: string }
  | { code: 'expired'; docType: string }
  | { code: 'noDeviceSignature'; docType: string }
  | { code: 'wrongDeviceKey'; docType: string }
  | { code: 'otherRequest'; docType: string }
  | { code: 'notRequested'; element: ElementRef }
  | { code: 'missing'; element: ElementRef };

export type PairRefusal =
  | { code: 'refused'; reason: Refusal }
  | { code: 'notAPhotoid'; docType: string }
  | { code: 'notABoardingPass'; docType: string }
  | { code: 'notOneTraveler' };

// The readings of the presentation rules.

export type ConsentReading = 'perElement' | 'wholeCredential';

export interface AcceptanceReading {
  extrasRefusedInMdocProfile: boolean;
  extrasRefusedInOpenId4Vp: boolean;
  extrasRefusedInProximity: boolean;
  missingRefusedInMdocProfile: boolean;
  missingRefusedInProximity: boolean;
  validityCheckedInOpenId4Vp: boolean;
  validityCheckedInProximity: boolean;
  proximityRebuildsTranscript: boolean;
}

export const sameKey = (a: Key, b: Key): boolean => a.name === b.name;
export const sameNonce = (a: Nonce, b: Nonce): boolean => a.value === b.value && a.entropyBytes === b.entropyBytes;
export const sameOrigin = (a: Origin, b: Origin): boolean => a.value === b.value;
export const sameIssuer = (a: Issuer, b: Issuer): boolean => a.name === b.name;
export const sameRef = (a: ElementRef, b: ElementRef): boolean => a.docType === b.docType && a.nameSpace === b.nameSpace && a.identifier === b.identifier;

export function sameTranscript(a: SessionTranscript, b: SessionTranscript): boolean {
  if ('iso' in a) return 'iso' in b && a.iso === b.iso;
  if (!('handover' in b)) return false;
  return sameOrigin(a.handover.origin, b.handover.origin) && sameNonce(a.handover.nonce, b.handover.nonce) && sameKey(a.handover.encryptionKey, b.handover.encryptionKey);
}

export const hasRef = (refs: readonly ElementRef[], ref: ElementRef): boolean => refs.some((r) => sameRef(r, ref));

/** Mdoc.refs: every data element a credential holds. */
export const mdocRefs = (m: Mdoc): ElementRef[] =>
  m.nameSpaces.flatMap((ns) => ns.elements.map((el) => ({ docType: m.docType, nameSpace: ns.name, identifier: el.identifier })));

/** Mdoc.disclose: a credential with only the allowed data elements.  A namespace left with none is dropped. */
export function disclose(m: Mdoc, allowed: readonly ElementRef[]): Mdoc {
  return {
    ...m,
    nameSpaces: m.nameSpaces
      .map((ns) => ({ ...ns, elements: ns.elements.filter((el) => hasRef(allowed, { docType: m.docType, nameSpace: ns.name, identifier: el.identifier })) }))
      .filter((ns) => ns.elements.length > 0),
  };
}

/** Response.refs: every data element a response holds. */
export const responseRefs = (r: WalletResponse): ElementRef[] => r.documents.flatMap((d) => mdocRefs(d.mdoc));

/** expectedTranscript: the session transcript a relying party expects, in the request's profile. */
export function expectedTranscript(x: IsoTranscripts, q: PresentationRequest): SessionTranscript {
  if (q.profile === 'openid4vp') return { handover: { origin: q.origin, nonce: q.nonce, encryptionKey: q.encryptionKey } };
  return q.profile === 'mdocOverDcApi' ? x.annexC(q) : x.proximity(q);
}

export type { Finding };
