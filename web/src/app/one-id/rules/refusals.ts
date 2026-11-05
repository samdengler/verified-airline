import { expired } from './expired';
import { type AcceptanceReading, expectedTranscript, hasRef, type IsoTranscripts, type Issuer, mdocRefs, type Presented, type PresentationRequest, type Profile, type Refusal, responseRefs, sameIssuer, sameKey, sameTranscript, type WalletResponse } from './support/exchange';
import type { ExpiryReading, Instant } from './support/types';

const checksValidity = (r: AcceptanceReading, p: Profile): boolean =>
  p === 'mdocOverDcApi' ? true : p === 'openid4vp' ? r.validityCheckedInOpenId4Vp : r.validityCheckedInProximity;

const checksTranscript = (r: AcceptanceReading, p: Profile): boolean => (p === 'proximity' ? r.proximityRebuildsTranscript : true);

const refusesExtras = (r: AcceptanceReading, p: Profile): boolean =>
  p === 'mdocOverDcApi' ? r.extrasRefusedInMdocProfile : p === 'openid4vp' ? r.extrasRefusedInOpenId4Vp : r.extrasRefusedInProximity;

const refusesMissing = (r: AcceptanceReading, p: Profile): boolean =>
  p === 'openid4vp' ? true : p === 'mdocOverDcApi' ? r.missingRefusedInMdocProfile : r.missingRefusedInProximity;

function presentedRefusals(r: AcceptanceReading, e: ExpiryReading, x: IsoTranscripts, trusted: readonly Issuer[], q: PresentationRequest, now: Instant, d: Presented): Refusal[] {
  const docType = d.mdoc.docType;
  const out: Refusal[] = [];
  if (!trusted.some((i) => sameIssuer(i, d.issuer))) out.push({ code: 'untrustedIssuer', issuer: d.issuer });
  if (!d.issuerSignatureValid) out.push({ code: 'issuerSignatureInvalid', docType });
  if (checksValidity(r, q.profile) && expired(e, d.mdoc, now)) out.push({ code: 'expired', docType });
  if (d.deviceSignature == null) {
    out.push({ code: 'noDeviceSignature', docType });
  } else {
    if (!sameKey(d.deviceSignature.key, d.deviceKey)) out.push({ code: 'wrongDeviceKey', docType });
    if (checksTranscript(r, q.profile) && !sameTranscript(d.deviceSignature.transcript, expectedTranscript(x, q))) out.push({ code: 'otherRequest', docType });
  }
  if (refusesExtras(r, q.profile)) {
    for (const element of mdocRefs(d.mdoc)) if (!hasRef(q.elements, element)) out.push({ code: 'notRequested', element });
  }
  return out;
}

/**
 * The reasons a relying party refuses a response to its request; empty when it
 * accepts.  A signature's outcome is a field here: no cryptography is modelled.
 *
 * requirement: OID-202
 * lean: Rules.OneId.refusals
 */
export function refusals(r: AcceptanceReading, e: ExpiryReading, x: IsoTranscripts, trusted: readonly Issuer[], q: PresentationRequest, response: WalletResponse, now: Instant): Refusal[] {
  const held = responseRefs(response);
  return [
    ...response.documents.flatMap((d) => presentedRefusals(r, e, x, trusted, q, now, d)),
    ...(refusesMissing(r, q.profile) ? q.elements.filter((ref) => !hasRef(held, ref)).map((element): Refusal => ({ code: 'missing', element })) : []),
  ];
}
