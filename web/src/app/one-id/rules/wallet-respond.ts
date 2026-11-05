import { type Consent, type ConsentReading, disclose, expectedTranscript, type Held, hasRef, type IsoTranscripts, mdocRefs, type Presented, type PresentationRequest, type SessionTranscript, type WalletResponse } from './support/exchange';

function present(c: ConsentReading, q: PresentationRequest, consent: Consent, t: SessionTranscript, cred: Held): Presented | undefined {
  const wanted = q.elements.filter((ref) => ref.docType === cred.mdoc.docType);
  const view = disclose(cred.mdoc, wanted.filter((ref) => hasRef(consent.approved, ref)));
  if (view.nameSpaces.length === 0) return undefined;
  const holds = mdocRefs(cred.mdoc);
  if (q.profile === 'openid4vp' && !wanted.every((ref) => hasRef(holds, ref))) return undefined;
  if (c === 'wholeCredential' && !wanted.every((ref) => hasRef(consent.approved, ref))) return undefined;
  return { mdoc: view, issuer: cred.issuer, issuerSignatureValid: true, deviceKey: cred.deviceKey, deviceSignature: { key: cred.deviceKey, transcript: t } };
}

/**
 * A wallet's answer to a request as it received it: only data elements the
 * request names and the holder approved, each credential signed with its device
 * key over the session transcript.
 *
 * requirement: OID-201
 * lean: Rules.OneId.Wallet.respond
 */
export function walletRespond(c: ConsentReading, x: IsoTranscripts, held: readonly Held[], seen: PresentationRequest, consent: Consent): WalletResponse {
  const t = expectedTranscript(x, seen);
  return { documents: held.flatMap((cred) => present(c, seen, consent, t, cred) ?? []) };
}
