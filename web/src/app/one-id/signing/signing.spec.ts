// The issuer's signature, outside the Lean model: COSE_Sign1 with ES256 over this
// project's own credential format.  These tests sign and check with WebCrypto.
import { scenarios } from '../data';
import { disclose, mdocRefs, hasRef } from '../rules/support/exchange';
import type { Mdoc } from '../rules/support/types';
import { cbor, fromBase64Url, headersOf, importVerifyingKey, readSign1, sign1, toBase64Url, verify1 } from './cose';
import { check, docTypeOf, flipPayloadByte, issue, present, presentAll, type TrustedKey } from './credential';
import { demoIssuers, issuerFor, signingIssuer, trustList } from './issuers';

const hex = (s: string): Uint8Array => Uint8Array.from(s.replace(/\s+/g, '').match(/../g)!.map((b) => parseInt(b, 16)));
const b64url = (bytes: Uint8Array): string => toBase64Url(bytes);

/** Issues a credential with the demo issuer of its kind, as the demo does. */
async function issued(role: 'photoid' | 'boardingPass', m: Mdoc): Promise<Uint8Array> {
  return issue(m, await signingIssuer(role));
}

const everyCredential = scenarios.flatMap((s) => s.credentials.map((c) => ({ scenario: s.id, role: c.role, mdoc: c.mdoc })));

describe('COSE_Sign1 with ES256', () => {
  it('verifies the single ECDSA signature example of RFC 9052 Appendix C.2.1 with its key from C.7.1', async () => {
    // The example's message, and the public key with kid "11" from the example key set.
    const message = hex(`d28443a10126a10442313154546869732069732074686520636f6e74656e742e5840
      8eb33e4ca31d1c465ab05aac34cc6b23d58fef5c083106c4d25a91aef0b0117e2af9a291aa32e14ab834dc56ed2a223444547e01f11d3b0916e5a4c345cacb36`);
    const key = await importVerifyingKey({
      kty: 'EC', crv: 'P-256',
      x: b64url(hex('bac5b11cad8f99f9c72b05cf4b9e26d244dc189f745228255a219a86d6a09eff')),
      y: b64url(hex('20138bf82dc1b6d562be0fa54ab7804a3a64b6d72ccfed6b6fb6ed28bbfc117e')),
    });
    const m = readSign1(message);
    expect(headersOf(m).kid).toBe('11');
    expect(new TextDecoder().decode(m.payload)).toBe('This is the content.');
    expect(await verify1(m, key)).toBe(true);
    const wrong = message.slice();
    wrong[wrong.length - 1] ^= 0x01;
    expect(await verify1(readSign1(wrong), key)).toBe(false);
  });

  it('signs with alg, kid and the issuer in the protected header, and verifies', async () => {
    const issuer = await signingIssuer('boardingPass');
    const message = readSign1(await sign1(cbor('payload'), issuer.key, issuer.kid, issuer.name));
    expect(headersOf(message)).toEqual({ alg: -7, kid: issuerFor('boardingPass').kid, issuer: 'Verified Airline' });
    expect(message.unprotectedHeader.size).toBe(0);
    expect(message.signature.length).toBe(64);
    const [trusted] = (await trustList()).filter((t) => t.kid === issuer.kid);
    expect(await verify1(message, trusted.key)).toBe(true);
  });

  it('round-trips bytes through base64url', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(fromBase64Url('not base64url!')).toBeNull();
  });
});

describe("the project's signed credential", () => {
  it('signed by its demo issuer, checks with the trusted keys and gives back the credential as the model has it', async () => {
    const trusted = await trustList();
    for (const c of everyCredential) {
      const held = await issued(c.role, c.mdoc);
      expect(docTypeOf(held)).toBe(c.mdoc.docType);
      const got = await check(presentAll(held), trusted);
      expect({ scenario: c.scenario, role: c.role, state: got.state, issuer: got.issuer, kid: got.kid }).toEqual({ scenario: c.scenario, role: c.role, state: 'checked', issuer: issuerFor(c.role).name, kid: issuerFor(c.role).kid });
      expect(got.mdoc).toEqual(c.mdoc);
    }
  });

  it('presented in part, gives back exactly what Mdoc.disclose keeps', async () => {
    const trusted = await trustList();
    for (const c of everyCredential) {
      const refs = mdocRefs(c.mdoc);
      // Every element of the first namespace, and every other element after it.
      const keep = refs.filter((r, i) => r.nameSpace === c.mdoc.nameSpaces[0].name || i % 2 === 0);
      const held = await issued(c.role, c.mdoc);
      const got = await check(present(held, (nameSpace, identifier) => hasRef(keep, { docType: c.mdoc.docType, nameSpace, identifier })), trusted);
      expect(got.state).toBe('checked');
      expect(got.mdoc).toEqual(disclose(c.mdoc, keep));
    }
  });

  it('refuses a credential with any one byte flipped', async () => {
    const trusted = await trustList();
    const pass = scenarios.find((s) => s.default)!.credentials.find((c) => c.role === 'boardingPass')!;
    const presented = presentAll(await issued('boardingPass', pass.mdoc));
    const accepted: number[] = [];
    for (let i = 0; i < presented.length; i++) {
      for (const bit of [0x01, 0x80]) {
        const changed = presented.slice();
        changed[i] ^= bit;
        if ((await check(changed, trusted)).state === 'checked') accepted.push(i);
      }
    }
    expect(accepted).toEqual([]);
  });

  it("the presenter's tamper control flips one byte, and the signature no longer matches", async () => {
    const trusted = await trustList();
    const pass = scenarios.find((s) => s.default)!.credentials.find((c) => c.role === 'boardingPass')!;
    const presented = presentAll(await issued('boardingPass', pass.mdoc));
    const tampered = flipPayloadByte(presented);
    expect(tampered.length).toBe(presented.length);
    expect(tampered.filter((b, i) => b !== presented[i]).length).toBe(1);
    expect(await check(tampered, trusted)).toEqual({ state: 'mismatch', issuer: 'Verified Airline', kid: issuerFor('boardingPass').kid, mdoc: null });
  });

  it('refuses a credential signed by a key that is not on the list', async () => {
    const trusted = await trustList();
    const pass = scenarios.find((s) => s.default)!.credentials.find((c) => c.role === 'boardingPass')!;
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    // A key of its own, under its own name.
    const unlisted = await issue(pass.mdoc, { kid: 'someone-else-1', name: 'Someone Else', key: other.privateKey });
    expect((await check(presentAll(unlisted), trusted)).state).toBe('unknownKey');
    // A key of its own, under Verified Airline's name and kid.
    const impostor = await issue(pass.mdoc, { kid: issuerFor('boardingPass').kid, name: 'Verified Airline', key: other.privateKey });
    expect((await check(presentAll(impostor), trusted)).state).toBe('mismatch');
    // Verified Airline's key under another issuer's name.
    const borrowed = await issue(pass.mdoc, { ...(await signingIssuer('boardingPass')), name: 'Utopia passport office' });
    expect((await check(presentAll(borrowed), trusted)).state).toBe('unknownKey');
    // And with no list at all, nothing checks.
    const listed = await issued('boardingPass', pass.mdoc);
    expect((await check(presentAll(listed), [] as TrustedKey[])).state).toBe('unknownKey');
  });

  it('says a credential is missing or unreadable', async () => {
    const trusted = await trustList();
    expect((await check(null, trusted)).state).toBe('missing');
    expect((await check(new Uint8Array([1, 2, 3]), trusted)).state).toBe('unreadable');
    expect((await check(cbor(new Map<string, unknown>([['signed', cbor('not a message')], ['disclosed', []]])), trusted)).state).toBe('unreadable');
  });

  it('is small: a credential with the placeholder portrait is well under a kilobyte', async () => {
    const trip = scenarios.find((s) => s.default)!;
    for (const c of trip.credentials) {
      const held = await issued(c.role, c.mdoc);
      expect(held.length).toBeLessThan(1024);
      expect(toBase64Url(presentAll(held)).length).toBeLessThan(1024);
    }
  });

  it('ships demo keys that say they are demo keys', () => {
    expect(demoIssuers.map((i) => i.signs).sort()).toEqual(['boardingPass', 'photoid']);
    expect(demoIssuers.every((i) => i.publicKey.x === i.privateKey.x && i.publicKey.y === i.privateKey.y && !('d' in i.publicKey))).toBe(true);
  });
});
