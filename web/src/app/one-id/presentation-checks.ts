// The model's rules for one presentation, as Exports/PresentationDecisions.lean
// in verified-id evaluates them.  A field a scenario does not use is null or empty,
// and the rules that need it are not run for it.  The default trip runs on these:
// the website's request is the default OpenID4VP presentation narrowed to the
// photoid, since the boarding pass is issued after it, and the gate's is the
// default proximity presentation.
import { findingsCheck, type PlannedCheck } from './checks';
import { credentialOf, defaultPresentation, type PresentationScenario, type Scenario } from './data';
import { mdocProfileRequestFindings } from './rules/mdoc-profile-request-findings';
import { openId4VpRequestFindings } from './rules/openid4vp-request-findings';
import { openId4VpTokenFindings } from './rules/openid4vp-token-findings';
import { openId4VpTranscript } from './rules/openid4vp-transcript';
import { openId4VpWalletFindings } from './rules/openid4vp-wallet-findings';
import { pairRefusals } from './rules/pair-refusals';
import { proximitySessionFindings } from './rules/proximity-session-findings';
import { refusals } from './rules/refusals';
import type { ElementRef, Held, PresentationRequest, Profile, WalletResponse } from './rules/support/exchange';
import type { AuthorizationRequest } from './rules/support/openid4vp';
import { boardingPassDocType, photoidDocType } from './rules/support/identifiers';
import { acceptanceReading, consentReading, expiryReading, pairReading, requestReading, walletReading } from './rules/support/readings';
import { exampleResolution792, ISO_TRANSCRIPTS } from './rules/support/stand-ins';
import { walletRespond } from './rules/wallet-respond';

const ACCEPTANCE_POINTS: Readonly<Record<Profile, readonly string[]>> = {
  mdocOverDcApi: ['AcceptanceReading.extrasRefusedInMdocProfile', 'AcceptanceReading.missingRefusedInMdocProfile'],
  openid4vp: ['AcceptanceReading.extrasRefusedInOpenId4Vp', 'AcceptanceReading.validityCheckedInOpenId4Vp'],
  proximity: ['AcceptanceReading.extrasRefusedInProximity', 'AcceptanceReading.missingRefusedInProximity', 'AcceptanceReading.validityCheckedInProximity', 'AcceptanceReading.proximityRebuildsTranscript'],
};

const STATE = 'OpenId4Vp.RequestReading.stateRequired';

/** Every rule this presentation's fields allow. */
export function planPresentationChecks(p: PresentationScenario): PlannedCheck[] {
  const x = ISO_TRANSCRIPTS[p.isoTranscripts];
  const out: PlannedCheck[] = [];
  if (p.seen && p.consent) {
    const { seen, consent } = p;
    out.push({
      key: 'walletRespond',
      blocks: true,
      decisionCase: 'Wallet.respond',
      reads: ['ConsentReading'],
      run: (s) => {
        const answer = walletRespond(consentReading(s), x, p.held, seen, consent);
        return { passed: answer.documents.length > 0, answer };
      },
    });
  }
  if (p.request && p.response) {
    const { request: q, response } = p;
    const deciding = [...ACCEPTANCE_POINTS[q.profile], 'ExpiryReading.validAtEnd'];
    out.push(findingsCheck('refusals', 'refusals', deciding, (s) => refusals(acceptanceReading(s), expiryReading(s), x, p.trustedIssuers, q, response, p.checkedAt)));
    const photoid = response.documents.find((d) => d.mdoc.docType === photoidDocType);
    const pass = response.documents.find((d) => d.mdoc.docType === boardingPassDocType);
    if (photoid && pass) {
      out.push(findingsCheck('pairRefusals', 'pairRefusals', [...deciding, 'PairReading.content', 'PairReading.sameDeviceKey'], (s) =>
        pairRefusals(acceptanceReading(s), expiryReading(s), x, p.trustedIssuers, pairReading(s), exampleResolution792, q, photoid, pass, p.checkedAt)));
    }
    if (q.profile === 'openid4vp') {
      out.push({ key: 'transcript', blocks: false, decisionCase: 'OpenId4Vp.transcript', reads: [], run: () => ({ passed: true, answer: openId4VpTranscript(q.origin, q.nonce, q.encryptionKey) }) });
      out.push(findingsCheck('tokenFindings', 'OpenId4Vp.tokenFindings', [], () => openId4VpTokenFindings(response.documents.map((d) => [d]))));
    }
  }
  if (p.authorization) {
    const a = p.authorization;
    out.push(findingsCheck('requestFindings', 'OpenId4Vp.requestFindings', [STATE], (s) => openId4VpRequestFindings(requestReading(s), a)));
    if (p.seenOrigin) {
      const origin = p.seenOrigin;
      out.push(findingsCheck('walletFindings', 'OpenId4Vp.walletFindings', [STATE, 'OpenId4Vp.WalletReading.signatureChecked', 'OpenId4Vp.WalletReading.verifierListChecked'], (s) =>
        openId4VpWalletFindings(requestReading(s), walletReading(s), p.trustedVerifiers, origin, a)));
    }
  }
  if (p.deviceRequest) {
    const d = p.deviceRequest;
    out.push(findingsCheck('deviceRequest', 'MdocProfile.requestFindings', [], () => mdocProfileRequestFindings(d)));
  }
  if (p.sessions.length) out.push(findingsCheck('sessions', 'Proximity.sessionFindings', [], () => proximitySessionFindings(p.sessions)));
  return out;
}

/** A traveler's credentials as a wallet holds them: the issuer and device of the default presentation, since a credential scenario names neither. */
function heldFor(scenario: Scenario, base: PresentationScenario): Held[] {
  return scenario.credentials.map((c) => ({ ...base.held.find((h) => h.mdoc.docType === c.mdoc.docType)!, mdoc: c.mdoc, subject: { id: c.about } }));
}

/** The wallet's answer when the holder approves everything asked, under which the two consent readings agree. */
function respondToAll(base: PresentationScenario, held: Held[], seen: PresentationRequest): WalletResponse {
  return walletRespond('perElement', ISO_TRANSCRIPTS[base.isoTranscripts], held, seen, { approved: seen.elements });
}

const asksForPhotoid = (ref: ElementRef): boolean => ref.docType === photoidDocType;

/**
 * What one device received from the other through the relay (relay.ts), used in
 * place of what it would compute on one device: the wallet takes the request it
 * received as the request it saw, and the relying party takes the response it
 * received.  The same checks then run on them, so a request or a response changed
 * on the way is the checks' to refuse.
 */
export interface Relayed {
  seen?: PresentationRequest;
  authorization?: AuthorizationRequest | null;
  response?: WalletResponse;
}

/** What the website asks of this traveler's wallet at check-in: the default OpenID4VP presentation, for the photoid alone. */
export function checkInPresentation(scenario: Scenario, relayed: Relayed = {}): PresentationScenario {
  const base = defaultPresentation('openid4vp');
  const narrow = (q: PresentationRequest): PresentationRequest => ({ ...q, elements: q.elements.filter(asksForPhotoid) });
  const seen = relayed.seen ?? narrow(base.seen!);
  const held = heldFor(scenario, base).filter((h) => h.mdoc.docType === photoidDocType);
  const authorization = base.authorization && { ...base.authorization, credentials: base.authorization.credentials.filter((c) => c.docType === photoidDocType) };
  return {
    ...base,
    id: `check-in ${scenario.id}`,
    held,
    seen,
    consent: { approved: seen.elements },
    request: narrow(base.request!),
    response: relayed.response ?? respondToAll(base, held, seen),
    authorization: relayed.authorization !== undefined ? relayed.authorization : authorization,
  };
}

/** What the gate reader asks of this traveler's wallet: the default proximity presentation, with what this traveler holds. */
export function gatePresentation(scenario: Scenario, relayed: Relayed = {}): PresentationScenario {
  const base = defaultPresentation('proximity');
  const held = heldFor(scenario, base);
  const seen = relayed.seen ?? base.seen!;
  return { ...base, held, seen, consent: { approved: seen.elements }, response: relayed.response ?? respondToAll(base, held, seen) };
}

/** The request a screen sends to a wallet on another device: the relying party's own, and for OpenID4VP its authorization request. */
export function requestToSend(p: PresentationScenario): { request: PresentationRequest; authorization: AuthorizationRequest | null } {
  return { request: p.request!, authorization: p.authorization };
}

/** Whether a scenario's traveler holds a credential of a kind. */
export const holds = (scenario: Scenario, role: 'photoid' | 'boardingPass'): boolean => !!credentialOf(scenario, role);
