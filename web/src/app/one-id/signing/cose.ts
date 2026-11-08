// COSE_Sign1 with ES256, written from RFC 9052 and RFC 9053, over CBOR (RFC 8949)
// encoded by cborg.  The Lean model holds no cryptography: this is the site's own
// check, outside the model, and its outcome is the model's field for a valid
// issuer signature (Presented.issuerSignatureValid).
//
// What each clause is used for, in our words:
// - RFC 9052 §2 and §4.2: a COSE_Sign1 message is a CBOR array of the protected
//   header (a byte string holding an encoded map), the unprotected header (a map),
//   the payload (a byte string) and the signature, tagged 18.
// - RFC 9052 §3: a label may not appear twice in a header map; a parameter is read
//   from the protected header first.  §1.5: a label is an integer or a text string.
// - RFC 9052 §3.1: alg is label 1 and must be protected where it can be; kid is
//   label 4, a byte string that only hints at the key, and kid values need not be
//   unique, so every key with the kid may have to be tried.
// - RFC 9052 §4.4: the signature covers the Sig_structure, an array of the text
//   "Signature1", the protected header's bytes, the external data (empty here) and
//   the payload.
// - RFC 9052 §9 and RFC 8949 §4.2.1: the Sig_structure is encoded with definite
//   lengths and the shortest arguments; cborg's rfc8949EncodeOptions does that and
//   also sorts map keys bytewise.
// - RFC 9053 §2.1: ES256 is algorithm -7, ECDSA with SHA-256 on P-256, and the
//   signature is r and s, each 32 bytes, concatenated.  WebCrypto's ECDSA produces
//   and expects exactly that form.  The RFC recommends deterministic ECDSA, which
//   WebCrypto does not offer, so each signing gives different bytes.
import { decode, encode, rfc8949EncodeOptions, Tagged } from 'cborg';

/** RFC 9052 §2, Table 1: the tag of a COSE_Sign1 message. */
export const COSE_SIGN1_TAG = 18;
/** RFC 9053 §2.1, Table 1: ECDSA with SHA-256. */
export const ES256 = -7;
/** RFC 9052 §3.1, Table 3. */
const ALG = 1;
const KID = 4;
/**
 * The issuer's name, under a text label of this project's own (RFC 9052 §1.5 allows
 * text labels).  It sits in the protected header, so the signature covers it.
 */
export const ISSUER = 'issuer';

const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ES256_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

export type Label = number | string;
export type HeaderMap = Map<Label, unknown>;

/** The same bytes as a plain Uint8Array.  Under Node, cborg may hand back a Buffer, which a test runner's Uint8Array need not recognize. */
const plain = (b: Uint8Array): Uint8Array => (b.constructor === Uint8Array ? b : new Uint8Array(b.buffer, b.byteOffset, b.byteLength));

/** Encodes a value with RFC 8949 §4.2.1 core deterministic encoding. */
export const cbor = (value: unknown): Uint8Array => plain(encode(value, rfc8949EncodeOptions));

/** Decodes one CBOR item strictly: shortest arguments, no repeated map keys, maps as Maps so integer labels stay integers. */
export const uncbor = (bytes: Uint8Array): unknown =>
  decode(plain(bytes), { tags: { [COSE_SIGN1_TAG]: Tagged.decoder(COSE_SIGN1_TAG) }, useMaps: true, rejectDuplicateMapKeys: true, strict: true, strictUtf8: true });

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available here');
  return s;
};

export const importSigningKey = (jwk: JsonWebKey): Promise<CryptoKey> => subtle().importKey('jwk', jwk, ECDSA_P256, false, ['sign']);
export const importVerifyingKey = (jwk: JsonWebKey): Promise<CryptoKey> => subtle().importKey('jwk', jwk, ECDSA_P256, false, ['verify']);

export const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => new Uint8Array(await subtle().digest('SHA-256', bytes as BufferSource));

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder('utf-8', { fatal: true });

/** RFC 9052 §4.4: the bytes a COSE_Sign1 signature covers. */
export const toBeSigned = (protectedBytes: Uint8Array, payload: Uint8Array): Uint8Array => cbor(['Signature1', protectedBytes, new Uint8Array(0), payload]);

/** Signs a payload as a tagged COSE_Sign1 message, with alg, kid and the issuer's name in the protected header. */
export async function sign1(payload: Uint8Array, key: CryptoKey, kid: string, issuer: string): Promise<Uint8Array> {
  const protectedBytes = cbor(new Map<Label, unknown>([[ALG, ES256], [KID, utf8.encode(kid)], [ISSUER, issuer]]));
  const signature = new Uint8Array(await subtle().sign(ES256_PARAMS, key, toBeSigned(protectedBytes, payload) as BufferSource));
  return cbor(new Tagged(COSE_SIGN1_TAG, [protectedBytes, new Map(), payload, signature]));
}

/** A COSE_Sign1 message, read but not yet verified. */
export interface Sign1 {
  protectedBytes: Uint8Array;
  protectedHeader: HeaderMap;
  unprotectedHeader: HeaderMap;
  payload: Uint8Array;
  signature: Uint8Array;
}

const isLabelMap = (v: unknown): v is HeaderMap => v instanceof Map && [...v.keys()].every((k) => typeof k === 'number' || typeof k === 'string');

/** Reads a tagged COSE_Sign1 message, or throws when it is not one. */
export function readSign1(bytes: Uint8Array): Sign1 {
  const item = uncbor(bytes);
  if (!(item instanceof Tagged) || item.tag !== COSE_SIGN1_TAG || !Array.isArray(item.value) || item.value.length !== 4) throw new Error('not a tagged COSE_Sign1 message');
  const [protectedBytes, unprotectedHeader, payload, signature] = item.value as unknown[];
  if (!(protectedBytes instanceof Uint8Array) || !isLabelMap(unprotectedHeader) || !(payload instanceof Uint8Array) || !(signature instanceof Uint8Array)) throw new Error('a COSE_Sign1 field has the wrong type');
  // RFC 9052 §3: an empty protected header may be a zero-length byte string.
  const protectedHeader = protectedBytes.length === 0 ? new Map() : uncbor(protectedBytes);
  if (!isLabelMap(protectedHeader)) throw new Error('the protected header is not a map of labels');
  for (const label of protectedHeader.keys()) if (unprotectedHeader.has(label)) throw new Error(`label ${label} is in both headers`);
  return { protectedBytes, protectedHeader, unprotectedHeader, payload, signature };
}

/** What the headers say: the algorithm, the key's id and the issuer's name.  alg and the issuer count only when protected. */
export function headersOf(m: Sign1): { alg: unknown; kid: string | null; issuer: string | null } {
  const kid = m.protectedHeader.get(KID) ?? m.unprotectedHeader.get(KID);
  const issuer = m.protectedHeader.get(ISSUER);
  let kidText: string | null = null;
  if (kid instanceof Uint8Array) {
    try {
      kidText = fromUtf8.decode(kid);
    } catch {
      kidText = null;
    }
  }
  return { alg: m.protectedHeader.get(ALG), kid: kidText, issuer: typeof issuer === 'string' ? issuer : null };
}

/** Whether the signature of a COSE_Sign1 message verifies with a key, under ES256. */
export async function verify1(m: Sign1, key: CryptoKey): Promise<boolean> {
  if (m.protectedHeader.get(ALG) !== ES256 || m.signature.length !== 64) return false;
  return subtle().verify(ES256_PARAMS, key, m.signature as BufferSource, toBeSigned(m.protectedBytes, m.payload) as BufferSource);
}

/** Bytes as base64url, for JSON. */
export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url as bytes, or null when it is not base64url. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
