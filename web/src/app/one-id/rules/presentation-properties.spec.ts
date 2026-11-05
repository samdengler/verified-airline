// The proven theorems of Rules/OneId/PresentationTheorems.lean restated for the
// TypeScript, each tagged with the criterion it checks.  A pass means the code
// held on every input tried.  The proofs are about the Lean model.  Two theorems
// have no property here, since they say what no check can do and name no
// function: no_check_shows_consent and no_presentation_check_identifies_the_traveler.
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { expired } from './expired';
import { mdocProfileRequestFindings, type DeviceRequest } from './mdoc-profile-request-findings';
import { openId4VpRequestFindings } from './openid4vp-request-findings';
import { openId4VpReuseFindings } from './openid4vp-reuse-findings';
import { openId4VpTokenFindings } from './openid4vp-token-findings';
import { openId4VpTranscript } from './openid4vp-transcript';
import { openId4VpWalletFindings } from './openid4vp-wallet-findings';
import { pairRefusals } from './pair-refusals';
import { proximitySessionFindings, type Session } from './proximity-session-findings';
import { refusals } from './refusals';
import { type AcceptanceReading, type ConsentReading, type ElementRef, expectedTranscript, type Held, hasRef, type IsoTranscripts, type Issuer, type Key, type Nonce, type Origin, type Presented, type PresentationRequest, type Profile, responseRefs, sameKey, sameNonce, sameOrigin, sameTranscript, type WalletResponse } from './support/exchange';
import { baseNameSpace, bcbpNameSpace, bcbpStringId, boardingPassDocType, familyNameId, givenNameId, photoidDocType, portraitId } from './support/identifiers';
import type { AuthorizationRequest, Certificate, CredentialQuery } from './support/openid4vp';
import { CLIENT_ID_PREFIX, MDOC_FORMAT, PROTOCOL, RESPONSE_MODE, RESPONSE_TYPE } from './support/openid4vp';
import { exampleIsoTranscripts, exampleResolution792, transcriptsWithoutNonce } from './support/stand-ins';
import type { Mdoc, Resolution792 } from './support/types';
import { walletRespond } from './wallet-respond';

const model = JSON.parse(readFileSync('../model/one-id/model.json', 'utf8'));

const mostly = <T>(a: fc.Arbitrary<T>, b: fc.Arbitrary<T>): fc.Arbitrary<T> => fc.integer({ min: 0, max: 3 }).chain((i) => (i < 3 ? a : b));
const mostlyPresent = <T>(a: fc.Arbitrary<T>): fc.Arbitrary<T | null> => mostly<T | null>(a, fc.constant(null));

const ref = (docType: string, nameSpace: string, identifier: string): ElementRef => ({ docType, nameSpace, identifier });
const REFS: ElementRef[] = [ref(photoidDocType, baseNameSpace, familyNameId), ref(photoidDocType, baseNameSpace, givenNameId), ref(photoidDocType, baseNameSpace, portraitId), ref(boardingPassDocType, bcbpNameSpace, bcbpStringId)];

const instant = fc.integer({ min: 0, max: 20 });
const key: fc.Arbitrary<Key> = fc.constantFrom({ name: 'phone' }, { name: 'tablet' });
const nonce: fc.Arbitrary<Nonce> = fc.constantFrom({ value: 'n1', entropyBytes: 16 }, { value: 'n2', entropyBytes: 16 }, { value: 'n3', entropyBytes: 8 });
const origin: fc.Arbitrary<Origin> = fc.constantFrom({ value: 'https://a.example' }, { value: 'https://b.example' });
const issuer: fc.Arbitrary<Issuer> = fc.constantFrom({ name: 'issuer 1' }, { name: 'issuer 2' });
const profile = fc.constantFrom<Profile>('mdocOverDcApi', 'openid4vp', 'proximity');
const refs = fc.subarray(REFS);

const mdocOf = (docType: string, validUntil: number, names: string[]): Mdoc => ({
  docType,
  validUntil,
  nameSpaces:
    docType === photoidDocType
      ? [{ name: baseNameSpace, elements: [{ identifier: familyNameId, value: { text: names[0] } }, { identifier: givenNameId, value: { text: names[1] } }, { identifier: portraitId, value: { bytes: [1] } }] }]
      : [{ name: bcbpNameSpace, elements: [{ identifier: bcbpStringId, value: { text: `EXAMPLE:${names[0]}/${names[1]}` } }] }],
});
const names = fc.constantFrom<string[]>(['SMITH', 'JOHN'], ['MARTIN', 'ALICE']);
const heldOne = (docType: string): fc.Arbitrary<Held> =>
  fc.record({ mdoc: fc.tuple(instant, names).map(([until, n]) => mdocOf(docType, until, n)), subject: fc.constantFrom({ id: 'traveler 1' }, { id: 'traveler 2' }), issuer, deviceKey: key });
const held: fc.Arbitrary<Held[]> = fc.tuple(heldOne(photoidDocType), heldOne(boardingPassDocType)).chain(([p, b]) => fc.constantFrom([p, b], [p], [b], []));

const request: fc.Arbitrary<PresentationRequest> = fc.record({ profile, origin, nonce, encryptionKey: key, engagementKey: fc.option(key, { nil: null }), elements: refs });
const consent = fc.record({ approved: refs });
const consentReading = fc.constantFrom<ConsentReading>('perElement', 'wholeCredential');
const acceptance: fc.Arbitrary<AcceptanceReading> = fc.record({
  extrasRefusedInMdocProfile: fc.boolean(), extrasRefusedInOpenId4Vp: fc.boolean(), extrasRefusedInProximity: fc.boolean(),
  missingRefusedInMdocProfile: fc.boolean(), missingRefusedInProximity: fc.boolean(),
  validityCheckedInOpenId4Vp: fc.boolean(), validityCheckedInProximity: fc.boolean(), proximityRebuildsTranscript: fc.boolean(),
});
const expiry = fc.record({ validAtEnd: fc.boolean() });
// For every content the ISO transcripts could have, and the stand-ins.
const iso: fc.Arbitrary<IsoTranscripts> = mostly<IsoTranscripts>(
  fc.constantFrom(exampleIsoTranscripts, transcriptsWithoutNonce),
  fc.record({
    annexC: fc.func<[PresentationRequest], { iso: string }>(fc.constantFrom({ iso: 'a' }, { iso: 'b' })),
    proximity: fc.func<[PresentationRequest], { iso: string }>(fc.constantFrom({ iso: 'a' }, { iso: 'b' })),
  }),
);
const trustedOf = (hs: readonly Held[]): Issuer[] => hs.map((h) => h.issuer);

/** A relying party's case: mostly a response the wallet built for that very request, so accepted responses are common. */
const decided = fc.record({ a: acceptance, e: expiry, x: iso, q: request, c: consentReading, hs: held, now: instant, late: fc.boolean() }).chain((v) =>
  mostly<WalletResponse>(
    fc.constant(walletRespond(v.c, v.x, v.hs, v.q, { approved: v.q.elements })),
    fc.array(
      fc.record({ mdoc: fc.tuple(instant, names, fc.constantFrom(photoidDocType, boardingPassDocType)).map(([u, n, d]) => mdocOf(d, u, n)), issuer, issuerSignatureValid: fc.boolean(), deviceKey: key, deviceSignature: fc.option(fc.record({ key, transcript: fc.constant(expectedTranscript(v.x, v.q)) }), { nil: null }) }),
      { maxLength: 2 },
    ).map((documents) => ({ documents })),
  ).map((response) => ({ ...v, response, trusted: trustedOf(v.hs), now: v.late ? v.now : 0 })),
);
const accepted = (c: { a: AcceptanceReading; e: { validAtEnd: boolean }; x: IsoTranscripts; trusted: Issuer[]; q: PresentationRequest; response: WalletResponse; now: number }) =>
  refusals(c.a, c.e, c.x, c.trusted, c.q, c.response, c.now).length === 0;

const certificate: fc.Arbitrary<Certificate> = fc.constantFrom({ name: 'cert 1' }, { name: 'cert 2' });
const authorization: fc.Arbitrary<AuthorizationRequest> = fc.record({
  protocol: mostly(fc.constant(PROTOCOL), fc.constant('other')),
  responseType: mostly(fc.constant(RESPONSE_TYPE), fc.constant('other')),
  responseMode: mostly(fc.constant(RESPONSE_MODE), fc.constant('other')),
  clientIdPrefix: mostly(fc.constant(CLIENT_ID_PREFIX), fc.constant('other')),
  clientCertificate: fc.constant({ name: 'cert 1' }),
  signedWith: mostly(fc.constant<Certificate | null>({ name: 'cert 1' }), fc.option(certificate, { nil: null })),
  expectedOrigins: mostly(fc.constant([{ value: 'https://a.example' }]), fc.array(origin, { maxLength: 2 })),
  encryptionKey: mostlyPresent(key),
  credentials: mostly<CredentialQuery[]>(fc.constant([{ format: MDOC_FORMAT, docType: photoidDocType, claims: [[baseNameSpace, familyNameId]] }]), fc.array(fc.record({ format: fc.constantFrom(MDOC_FORMAT, 'jwt'), docType: fc.constant(photoidDocType), claims: fc.constant<(readonly [string, string])[]>([]) }), { maxLength: 2 })),
  nonce: mostlyPresent(nonce),
  state: fc.option(fc.constant('s'), { nil: null }),
});
const requestReading = fc.record({ stateRequired: fc.boolean() });
const walletReading = fc.record({ signatureChecked: fc.boolean(), verifierListChecked: fc.boolean() });
const verifiers = fc.array(certificate, { maxLength: 2 });

const registered: { criteria: string[]; theorem: string }[] = [];

function theorem<T>(criteria: string[], name: string, inputs: fc.Arbitrary<T>, premise: (x: T) => boolean, conclusion: (x: T) => boolean): void {
  registered.push({ criteria, theorem: name });
  it(`${criteria.length ? criteria.join(' ') : 'for one reading'}: ${name}`, () => {
    let met = 0;
    fc.assert(
      fc.property(inputs, (x) => {
        if (!premise(x)) return true;
        met++;
        return conclusion(x);
      }),
      { numRuns: 1000 },
    );
    expect(met).toBeGreaterThan(10);
  });
}

const everywhere = () => true;
const walletCase = fc.record({ c: consentReading, x: iso, hs: held, seen: request, consent });
const respond = (w: { c: ConsentReading; x: IsoTranscripts; hs: Held[]; seen: PresentationRequest; consent: { approved: ElementRef[] } }) => walletRespond(w.c, w.x, w.hs, w.seen, w.consent);

describe('the proven presentation theorems as properties', () => {
  describe("the wallet's answer", () => {
    theorem(['OID-201.1', 'OID-201.2'], 'wallet_discloses_only_requested_and_approved', walletCase, everywhere, (w) =>
      responseRefs(respond(w)).every((r) => hasRef(w.seen.elements, r) && hasRef(w.consent.approved, r)));
    theorem(['OID-201.3'], 'wallet_presents_nothing_without_consent', walletCase.map((w) => ({ ...w, consent: { approved: [] } })), everywhere, (w) => respond(w).documents.length === 0);
    theorem(['OID-201.4'], 'wallet_signs_with_device_key', walletCase, everywhere, (w) =>
      respond(w).documents.every((d) => w.hs.some((h) => h.issuer.name === d.issuer.name && sameKey(h.deviceKey, d.deviceKey) && d.deviceSignature !== null && sameKey(d.deviceSignature.key, h.deviceKey) && sameTranscript(d.deviceSignature.transcript, expectedTranscript(w.x, w.seen)))));
    theorem([], 'partial_consent_withholds_credential_of_wholeCredential', walletCase,
      (w) => w.hs.length === 1 && w.seen.elements.some((r) => r.docType === w.hs[0].mdoc.docType && !hasRef(w.consent.approved, r)),
      (w) => respond({ ...w, c: 'wholeCredential' }).documents.length === 0);
  });

  describe("the relying party's decision", () => {
    theorem(['OID-202.1', 'OID-202.2'], 'accepted_from_trusted_issuer', decided, accepted, (c) =>
      c.response.documents.every((d) => c.trusted.some((i) => i.name === d.issuer.name) && d.issuerSignatureValid));
    theorem(['OID-202.3'], 'accepted_signed_by_device_key', decided, accepted, (c) =>
      c.response.documents.every((d) => d.deviceSignature !== null && sameKey(d.deviceSignature.key, d.deviceKey)));
    const answers = (c: { x: IsoTranscripts; q: PresentationRequest; response: WalletResponse }) =>
      c.response.documents.every((d) => d.deviceSignature !== null && sameTranscript(d.deviceSignature.transcript, expectedTranscript(c.x, c.q)));
    theorem([], 'accepted_answers_this_request_of_proximityRebuildsTranscript', decided, (c) => c.a.proximityRebuildsTranscript && accepted(c), answers);
    theorem([], 'accepted_answers_this_request_in_remote_profiles', decided, (c) => c.q.profile !== 'proximity' && accepted(c), answers);
    theorem([], 'accepted_not_expired_of_validityChecked', decided, (c) => c.a.validityCheckedInOpenId4Vp && c.a.validityCheckedInProximity && accepted(c), (c) => c.response.documents.every((d) => !expired(c.e, d.mdoc, c.now)));
    theorem([], 'accepted_not_expired_in_mdocProfile', decided, (c) => c.q.profile === 'mdocOverDcApi' && accepted(c), (c) => c.response.documents.every((d) => !expired(c.e, d.mdoc, c.now)));
    theorem([], 'accepted_holds_only_requested_of_extrasRefused', decided, (c) => c.a.extrasRefusedInMdocProfile && c.a.extrasRefusedInOpenId4Vp && c.a.extrasRefusedInProximity && accepted(c), (c) => responseRefs(c.response).every((r) => hasRef(c.q.elements, r)));
    theorem([], 'accepted_holds_every_requested_of_missingRefused', decided, (c) => c.a.missingRefusedInMdocProfile && c.a.missingRefusedInProximity && accepted(c), (c) => c.q.elements.every((r) => hasRef(responseRefs(c.response), r)));
    theorem([], 'accepted_holds_every_requested_in_openid4vp', decided, (c) => c.q.profile === 'openid4vp' && accepted(c), (c) => c.q.elements.every((r) => hasRef(responseRefs(c.response), r)));
    const wallet = fc.record({ a: acceptance, e: expiry, x: iso, c: consentReading, hs: held, q: request, consent }).map((v) => ({ ...v, trusted: trustedOf(v.hs), now: 0, hs: v.hs.map((h) => ({ ...h, mdoc: { ...h.mdoc, validUntil: h.mdoc.validUntil + 1 } })) }));
    theorem([], 'wallet_response_refused_only_for_missing', wallet, everywhere, (v) =>
      refusals(v.a, v.e, v.x, v.trusted, v.q, walletRespond(v.c, v.x, v.hs, v.q, v.consent), v.now).every((r) => r.code === 'missing'));
    theorem([], 'wallet_response_accepted', wallet, (v) => v.q.elements.every((r) => hasRef(responseRefs(walletRespond(v.c, v.x, v.hs, v.q, v.consent)), r)), (v) =>
      refusals(v.a, v.e, v.x, v.trusted, v.q, walletRespond(v.c, v.x, v.hs, v.q, v.consent), v.now).length === 0);
  });

  describe('the OpenID4VP profile', () => {
    const asked = fc.record({ r: requestReading, a: authorization });
    const clean = ({ r, a }: { r: { stateRequired: boolean }; a: AuthorizationRequest }) => openId4VpRequestFindings(r, a).length === 0;
    theorem(['OID-203.1', 'OID-203.2', 'OID-203.3', 'OID-203.4', 'OID-203.5'], 'accepted_request_parts', asked, clean, ({ a }) =>
      a.protocol === PROTOCOL && a.responseType === RESPONSE_TYPE && a.responseMode === RESPONSE_MODE && a.clientIdPrefix === CLIENT_ID_PREFIX && a.signedWith?.name === a.clientCertificate.name && a.expectedOrigins.length > 0 && a.encryptionKey !== null && a.nonce !== null && a.credentials.every((c) => c.format === MDOC_FORMAT));
    theorem([], 'accepted_request_has_state_of_stateRequired', asked, (c) => c.r.stateRequired && clean(c), ({ a }) => a.state !== null);
    theorem(['OID-203.7', 'OID-203.8'], 'accepted_requests_fresh', fc.array(authorization, { maxLength: 3 }), (rs) => openId4VpReuseFindings(rs).length === 0, (rs) => {
      const ns = rs.flatMap((a) => (a.nonce ? [a.nonce.value + a.nonce.entropyBytes] : []));
      const ks = rs.flatMap((a) => (a.encryptionKey ? [a.encryptionKey.name] : []));
      return new Set(ns).size === ns.length && new Set(ks).size === ks.length;
    });
    const seen = fc.record({ r: requestReading, w: walletReading, tv: mostly<Certificate[]>(fc.constant([{ name: 'cert 1' }]), verifiers), o: mostly<Origin>(fc.constant({ value: 'https://a.example' }), origin), a: authorization });
    const answered = (c: { r: { stateRequired: boolean }; w: { signatureChecked: boolean; verifierListChecked: boolean }; tv: Certificate[]; o: Origin; a: AuthorizationRequest }) => openId4VpWalletFindings(c.r, c.w, c.tv, c.o, c.a).length === 0;
    theorem(['OID-204.1'], 'answered_from_expected_origin', seen, answered, (c) => c.a.expectedOrigins.some((o) => sameOrigin(o, c.o)));
    theorem([], 'answered_request_signed_of_signatureChecked', seen, (c) => c.w.signatureChecked && answered(c), (c) => c.a.signedWith?.name === c.a.clientCertificate.name);
    theorem([], 'answered_by_trusted_verifier_of_verifierListChecked', seen, (c) => c.w.verifierListChecked && answered(c), (c) => c.tv.some((v) => v.name === c.a.clientCertificate.name));
    const other = fc.record({ a: acceptance, e: expiry, x: iso, q: request.map((q) => ({ ...q, profile: 'openid4vp' as Profile })), o: origin, n: nonce, k: key, i: issuer, m: fc.tuple(instant, names).map(([u, n]) => mdocOf(photoidDocType, u, n)), now: instant, dk: key });
    theorem(['OID-205.1', 'OID-205.2', 'OID-205.3'], 'refuses_other_request', other, (c) => !sameOrigin(c.o, c.q.origin) || !sameNonce(c.n, c.q.nonce) || !sameKey(c.k, c.q.encryptionKey), (c) => {
      const response = { documents: [{ mdoc: c.m, issuer: c.i, issuerSignatureValid: true, deviceKey: c.dk, deviceSignature: { key: c.dk, transcript: openId4VpTranscript(c.o, c.n, c.k) } }] };
      return refusals(c.a, c.e, c.x, [c.i], c.q, response, c.now).length > 0;
    });
    const twice = fc.record({ a: acceptance, e: expiry, x: iso, q1: request, q2: request, same: fc.boolean(), i: issuer, dk: key, m: fc.tuple(instant, names).map(([u, n]) => mdocOf(photoidDocType, u, n)) }).map((c) => {
      const q1 = { ...c.q1, profile: 'openid4vp' as Profile };
      return { ...c, q1, q2: { ...(c.same ? q1 : c.q2), profile: 'openid4vp' as Profile }, response: { documents: [{ mdoc: c.m, issuer: c.i, issuerSignatureValid: true, deviceKey: c.dk, deviceSignature: { key: c.dk, transcript: expectedTranscript(c.x, q1) } }] } };
    });
    theorem([], 'accepted_for_one_request', twice, (c) => refusals(c.a, c.e, c.x, [c.i], c.q1, c.response, 0).length === 0 && refusals(c.a, c.e, c.x, [c.i], c.q2, c.response, 0).length === 0, (c) =>
      sameNonce(c.q1.nonce, c.q2.nonce) && sameOrigin(c.q1.origin, c.q2.origin) && sameKey(c.q1.encryptionKey, c.q2.encryptionKey));
    const anyPresented: fc.Arbitrary<Presented> = fc.record({ mdoc: fc.tuple(instant, names).map(([u, n]) => mdocOf(photoidDocType, u, n)), issuer, issuerSignatureValid: fc.boolean(), deviceKey: key, deviceSignature: fc.constant(null) });
    const token = fc.array(fc.array(anyPresented, { maxLength: 2 }), { maxLength: 3 });
    theorem(['OID-205.4'], 'accepted_token_one_mdoc_each', token, (t) => openId4VpTokenFindings(t).length === 0, (t) => t.every((dr) => dr.length <= 1));
    theorem([], 'wallet_token_accepted', fc.array(anyPresented, { maxLength: 3 }), everywhere, (docs) => openId4VpTokenFindings(docs.map((d) => [d])).length === 0);
  });

  describe('the mdoc profile', () => {
    const deviceRequest: fc.Arbitrary<DeviceRequest> = fc.record({
      protocol: mostly(fc.constant('org-iso-mdoc'), fc.constant('other')),
      encryptionProtocol: mostly(fc.constant('dcapi'), fc.constant('other')),
      nonce: mostlyPresent(nonce),
      recipientKey: mostlyPresent(key),
      elements: refs,
    });
    theorem(['OID-206.1', 'OID-206.2', 'OID-206.3'], 'accepted_deviceRequest_parts', deviceRequest, (d) => mdocProfileRequestFindings(d).length === 0, (d) =>
      d.protocol === 'org-iso-mdoc' && d.encryptionProtocol === 'dcapi' && d.nonce !== null && d.nonce.entropyBytes >= 16 && d.recipientKey !== null);
    const q = request.map((r) => ({ ...r, profile: 'mdocOverDcApi' as Profile }));
    const two = fc.record({ a: acceptance, e: expiry, q1: q, q2: q, i: issuer, dk: key, m: fc.tuple(instant, names).map(([u, n]) => mdocOf(photoidDocType, u, n)), sameQ: fc.boolean() }).map((c) => {
      const q2 = c.sameQ ? { ...c.q2, nonce: c.q1.nonce, origin: c.q1.origin, encryptionKey: c.q1.encryptionKey } : c.q2;
      return { ...c, q2, response: { documents: [{ mdoc: c.m, issuer: c.i, issuerSignatureValid: true, deviceKey: c.dk, deviceSignature: { key: c.dk, transcript: exampleIsoTranscripts.annexC(c.q1) } }] } };
    });
    // The stand-in's transcript holds the nonce, which is the theorem's hypothesis.
    theorem([], 'accepted_for_one_nonce_if_transcript_holds_nonce', two, (c) => refusals(c.a, c.e, exampleIsoTranscripts, [c.i], c.q1, c.response, 0).length === 0 && refusals(c.a, c.e, exampleIsoTranscripts, [c.i], c.q2, c.response, 0).length === 0, (c) => sameNonce(c.q1.nonce, c.q2.nonce));
  });

  describe('proximity', () => {
    const session: fc.Arbitrary<Session> = fc.record({
      deviceKey: fc.constantFrom({ name: 'd1' }, { name: 'd2' }, { name: 'd3' }),
      readerKey: fc.constantFrom({ name: 'r1' }, { name: 'r2' }, { name: 'r3' }),
      retrieval: mostly(fc.constantFrom<Session['retrieval']>('bluetoothLowEnergy', 'nfc', 'wifiAware'), fc.constant<Session['retrieval']>('server')),
    });
    theorem(['OID-301.1', 'OID-301.2', 'OID-301.3'], 'accepted_sessions', fc.array(session, { maxLength: 3 }), (ss) => proximitySessionFindings(ss).length === 0, (ss) =>
      ss.every((s) => s.retrieval !== 'server') && new Set(ss.map((s) => s.readerKey.name)).size === ss.length && new Set(ss.map((s) => s.deviceKey.name)).size === ss.length);
  });

  describe('a pair', () => {
    const x792: Resolution792 = exampleResolution792;
    const pair = fc.record({ a: acceptance, e: expiry, x: iso, q: request, dk: key, dk2: key, n1: names, n2: names, i: issuer, content: fc.constantFrom<'notChecked' | 'namesAgree'>('notChecked', 'namesAgree'), sameDeviceKey: fc.boolean(), swap: fc.boolean() }).map((c) => {
      const q = { ...c.q, elements: REFS };
      const signed = (m: Mdoc, k: Key): Presented => ({ mdoc: m, issuer: c.i, issuerSignatureValid: true, deviceKey: k, deviceSignature: { key: k, transcript: expectedTranscript(c.x, q) } });
      const photoid = signed(mdocOf(c.swap ? boardingPassDocType : photoidDocType, 5, c.n1), c.dk);
      const boardingPass = signed(mdocOf(boardingPassDocType, 5, c.n2), c.dk2);
      return { ...c, q, photoid, boardingPass, pr: { content: c.content, sameDeviceKey: c.sameDeviceKey } };
    });
    const result = (c: { a: AcceptanceReading; e: { validAtEnd: boolean }; x: IsoTranscripts; i: Issuer; pr: { content: 'notChecked' | 'namesAgree'; sameDeviceKey: boolean }; q: PresentationRequest; photoid: Presented; boardingPass: Presented }) =>
      pairRefusals(c.a, c.e, c.x, [c.i], c.pr, x792, c.q, c.photoid, c.boardingPass, 0);
    theorem(['OID-207.2'], 'accepted_pair_each_accepted', pair, (c) => result(c).length === 0, (c) =>
      refusals(c.a, c.e, c.x, [c.i], c.q, { documents: [c.photoid, c.boardingPass] }, 0).length === 0 && c.photoid.mdoc.docType === photoidDocType && c.boardingPass.mdoc.docType === boardingPassDocType);
    theorem([], 'same_traveler_pair_accepted_of_notChecked', pair.map((c) => ({ ...c, pr: { content: 'notChecked' as const, sameDeviceKey: false } })),
      (c) => c.photoid.mdoc.docType === photoidDocType && refusals(c.a, c.e, c.x, [c.i], c.q, { documents: [c.photoid, c.boardingPass] }, 0).length === 0, (c) => result(c).length === 0);
    theorem([], 'accepted_pair_same_traveler_if_one_traveler_per_key', pair.map((c) => ({ ...c, pr: { ...c.pr, sameDeviceKey: true } })), (c) => result(c).length === 0, (c) => sameKey(c.photoid.deviceKey, c.boardingPass.deviceKey));
  });

  it('has a property for every proven criterion of the presentation requirements', () => {
    const tagged = new Set(registered.flatMap((t) => t.criteria));
    const proven = Object.entries<{ criteria: { id: string; status: string }[] }>(model.requirements)
      .filter(([id]) => id.startsWith('OID-2') || id.startsWith('OID-3'))
      .flatMap(([, r]) => r.criteria.filter((c) => c.status === 'proven').map((c) => c.id));
    expect(proven.filter((c) => !tagged.has(c))).toEqual([]);
    expect([...tagged].filter((c) => !proven.includes(c))).toEqual([]);
  });
});
