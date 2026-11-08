// This project's own signed credential format.  The data in it is the stand-in
// credential of model/one-id/scenarios.json as it stands (its document type,
// namespaces, data elements and end of validity); the signing around it is ours.
// It follows no ISO document: the ISO documents on credentials were not read by
// this project, and nothing here says what they define.
//
// A wallet must be able to send some data elements and keep the rest, and a
// relying party must still be able to check what it received.  So the issuer
// signs a list of digests, not the values:
//
// - Each data element is encoded on its own as a CBOR map of a random 16-byte salt,
//   its identifier and its value.  Its digest is the SHA-256 of those bytes.  The
//   salt keeps a digest from giving away a value that is easy to guess.
// - The payload the issuer signs, as a COSE_Sign1 message (cose.ts), is a CBOR map
//   of the document type, the end of validity in seconds since 1970, and the
//   namespaces in order, each with its name and the digests of its data elements
//   in order.
// - The wallet holds the signed message and every encoded data element.  It
//   presents the signed message and only the data elements it shares, each list
//   marked with the index of its namespace.
// - The relying party verifies the signature, then hashes each data element it
//   received and finds the digest in its namespace, in order.  What it rebuilds is
//   exactly what the model's Mdoc.disclose keeps: the shared elements in the order
//   issued, and no namespace left empty.
//
// Every value the model's Value type allows round-trips: text as a text string,
// bytes as a byte string, a flag as a CBOR boolean, and an untyped value as a map
// {"other": text}.
import { cbor, fromBase64Url, headersOf, readSign1, sha256, sign1, toBase64Url, uncbor, verify1, ES256 } from './cose';
import type { DataElement, Mdoc, NameSpace, Value } from '../rules/support/types';

/** A key a relying party trusts, from its list. */
export interface TrustedKey {
  kid: string;
  name: string;
  key: CryptoKey;
}

/** How a signature check came out.  Only `checked` lets the checks take the issuer's signature as valid. */
export type SignatureState = 'checked' | 'mismatch' | 'unknownKey' | 'unreadable' | 'missing';

export interface CheckedCredential {
  state: SignatureState;
  /** The issuer's name and the key's id, from the protected header, when it can be read. */
  issuer: string | null;
  kid: string | null;
  /** The data the signature covers, rebuilt from what was received; null unless the signature checked. */
  mdoc: Mdoc | null;
}

const SALT_BYTES = 16;

const isMap = (v: unknown): v is Map<unknown, unknown> => v instanceof Map;

function field<T>(m: unknown, key: string, is: (v: unknown) => v is T): T {
  if (!isMap(m) || !m.has(key)) throw new Error(`no field ${key}`);
  const v = m.get(key);
  if (!is(v)) throw new Error(`field ${key} has the wrong type`);
  return v;
}

const isText = (v: unknown): v is string => typeof v === 'string';
const isBytes = (v: unknown): v is Uint8Array => v instanceof Uint8Array;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
const isAny = (v: unknown): v is unknown => true;

function encodeValue(v: Value): unknown {
  if ('text' in v) return v.text;
  if ('bytes' in v) return Uint8Array.from(v.bytes);
  if ('flag' in v) return v.flag;
  return new Map([['other', v.other]]);
}

function decodeValue(v: unknown): Value {
  if (typeof v === 'string') return { text: v };
  if (v instanceof Uint8Array) return { bytes: [...v] };
  if (typeof v === 'boolean') return { flag: v };
  if (isMap(v) && v.size === 1 && typeof v.get('other') === 'string') return { other: v.get('other') as string };
  throw new Error('a value the model has no form for');
}

/** One data element as issued: its salt, identifier and value, encoded. */
const encodeElement = (e: DataElement, salt: Uint8Array): Uint8Array => cbor(new Map<string, unknown>([['salt', salt], ['identifier', e.identifier], ['value', encodeValue(e.value)]]));

function decodeElement(bytes: Uint8Array): DataElement {
  const m = uncbor(bytes);
  field(m, 'salt', isBytes);
  return { identifier: field(m, 'identifier', isText), value: decodeValue(field(m, 'value', isAny)) };
}

interface Payload {
  docType: string;
  validUntil: number;
  nameSpaces: { name: string; digests: Uint8Array[] }[];
}

function decodePayload(bytes: Uint8Array): Payload {
  const m = uncbor(bytes);
  return {
    docType: field(m, 'docType', isText),
    validUntil: field(m, 'validUntil', isCount),
    nameSpaces: field(m, 'nameSpaces', isArray).map((ns) => ({
      name: field(ns, 'name', isText),
      digests: field(ns, 'digests', isArray).map((d) => {
        if (!isBytes(d) || d.length !== 32) throw new Error('a digest is not 32 bytes');
        return d;
      }),
    })),
  };
}

/** The issuer's side: what it needs to sign. */
export interface SigningIssuer {
  kid: string;
  name: string;
  key: CryptoKey;
}

/**
 * Issues a credential: salts and encodes each data element, signs the digests, and
 * returns what the wallet holds, encoded as a CBOR map of the signed message and the
 * encoded data elements of each namespace.
 */
export async function issue(m: Mdoc, issuer: SigningIssuer): Promise<Uint8Array> {
  const elements = m.nameSpaces.map((ns) => ns.elements.map((e) => encodeElement(e, crypto.getRandomValues(new Uint8Array(SALT_BYTES)))));
  const nameSpaces = await Promise.all(
    m.nameSpaces.map(async (ns, i) => new Map<string, unknown>([['name', ns.name], ['digests', await Promise.all(elements[i].map(sha256))]])),
  );
  const payload = cbor(new Map<string, unknown>([['docType', m.docType], ['validUntil', m.validUntil], ['nameSpaces', nameSpaces]]));
  const signed = await sign1(payload, issuer.key, issuer.kid, issuer.name);
  return cbor(new Map<string, unknown>([['signed', signed], ['elements', elements]]));
}

/** What a held credential says, read without checking its signature: what the wallet shows and narrows. */
function readHeld(held: Uint8Array): { signed: Uint8Array; payload: Payload; elements: Uint8Array[][] } {
  const m = uncbor(held);
  const signed = field(m, 'signed', isBytes);
  const payload = decodePayload(readSign1(signed).payload);
  const elements = field(m, 'elements', isArray).map((list) => {
    if (!isArray(list) || !list.every(isBytes)) throw new Error('elements are not byte strings');
    return list;
  });
  if (elements.length !== payload.nameSpaces.length) throw new Error('elements do not follow the namespaces');
  return { signed, payload, elements };
}

/** The document type a held or presented credential names, unchecked: for finding which credential a wallet holds. */
export function docTypeOf(credential: Uint8Array): string | null {
  try {
    return decodePayload(readSign1(field(uncbor(credential), 'signed', isBytes)).payload).docType;
  } catch {
    return null;
  }
}

/**
 * The wallet's side: a held credential narrowed to the data elements a test keeps,
 * as `Mdoc.disclose` narrows it.  The result is a CBOR map of the signed message
 * and, for each namespace with an element kept, its index and the kept elements.
 */
export function present(held: Uint8Array, keep: (nameSpace: string, identifier: string) => boolean): Uint8Array {
  const { signed, payload, elements } = readHeld(held);
  const disclosed = elements
    .map((list, i) => ({ i, list: list.filter((bytes) => keep(payload.nameSpaces[i].name, decodeElement(bytes).identifier)) }))
    .filter(({ list }) => list.length > 0)
    .map(({ i, list }) => new Map<string, unknown>([['nameSpace', i], ['elements', list]]));
  return cbor(new Map<string, unknown>([['signed', signed], ['disclosed', disclosed]]));
}

/** A held credential presented whole, as the wallet checks what it holds. */
export const presentAll = (held: Uint8Array): Uint8Array => present(held, () => true);

/** What a relying party received as a credential, checked against its trusted keys. */
export async function check(presented: Uint8Array | null, trusted: readonly TrustedKey[]): Promise<CheckedCredential> {
  if (!presented) return { state: 'missing', issuer: null, kid: null, mdoc: null };
  let message: ReturnType<typeof readSign1>;
  let disclosed: { nameSpace: number; elements: unknown[] }[];
  try {
    const m = uncbor(presented);
    message = readSign1(field(m, 'signed', isBytes));
    disclosed = field(m, 'disclosed', isArray).map((d) => ({ nameSpace: field(d, 'nameSpace', isCount), elements: field(d, 'elements', isArray) }));
  } catch {
    return { state: 'unreadable', issuer: null, kid: null, mdoc: null };
  }
  const headers = headersOf(message);
  const named = { issuer: headers.issuer, kid: headers.kid };
  if (headers.alg !== ES256) return { state: 'unreadable', ...named, mdoc: null };
  // RFC 9052 §3.1: a kid need not be unique, so try every listed key with this kid and this issuer's name.
  const keys = trusted.filter((t) => t.kid === headers.kid && t.name === headers.issuer);
  if (keys.length === 0) return { state: 'unknownKey', ...named, mdoc: null };
  let verified = false;
  for (const t of keys) if (!verified) verified = await verify1(message, t.key);
  if (!verified) return { state: 'mismatch', ...named, mdoc: null };
  let payload: Payload;
  try {
    payload = decodePayload(message.payload);
  } catch {
    return { state: 'unreadable', ...named, mdoc: null };
  }
  const nameSpaces: NameSpace[] = [];
  let lastNameSpace = -1;
  for (const d of disclosed) {
    const ns = payload.nameSpaces[d.nameSpace];
    if (!ns || d.nameSpace <= lastNameSpace || d.elements.length === 0) return { state: 'mismatch', ...named, mdoc: null };
    lastNameSpace = d.nameSpace;
    const elements: DataElement[] = [];
    let lastDigest = -1;
    for (const bytes of d.elements) {
      if (!isBytes(bytes)) return { state: 'unreadable', ...named, mdoc: null };
      const digest = await sha256(bytes);
      const at = ns.digests.findIndex((x, i) => i > lastDigest && x.length === digest.length && x.every((b, j) => b === digest[j]));
      if (at < 0) return { state: 'mismatch', ...named, mdoc: null };
      lastDigest = at;
      try {
        elements.push(decodeElement(bytes));
      } catch {
        return { state: 'unreadable', ...named, mdoc: null };
      }
    }
    nameSpaces.push({ name: ns.name, elements });
  }
  return { state: 'checked', ...named, mdoc: { docType: payload.docType, nameSpaces, validUntil: payload.validUntil } };
}

/**
 * The presenter's tamper control: flips the lowest bit of the last byte of the signed
 * payload in a presented credential.  The bytes still read, and the signature no
 * longer matches them.
 */
export function flipPayloadByte(presented: Uint8Array): Uint8Array {
  const payload = readSign1(field(uncbor(presented), 'signed', isBytes)).payload;
  const at = indexOf(presented, payload);
  if (at < 0) throw new Error('the payload is not in the credential');
  const out = presented.slice();
  out[at + payload.length - 1] ^= 0x01;
  return out;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export { fromBase64Url, toBase64Url };
