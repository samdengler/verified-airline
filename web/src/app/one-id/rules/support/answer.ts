// The TypeScript checks behind the oracle's request format
// (Oracle/Handle.lean in verified-id), so each line of decisions.jsonl runs
// through them as it stands.
import { boardingPassValidityFindings } from '../boarding-pass-validity-findings';
import { boardingPassViolations } from '../boarding-pass-violations';
import { expired } from '../expired';
import { photoidAdvisories } from '../photoid-advisories';
import { photoidSourceFindings } from '../photoid-source-findings';
import { photoidValidityFindings } from '../photoid-validity-findings';
import { photoidViolations } from '../photoid-violations';
import { mdocProfileRequestFindings, type DeviceRequest } from '../mdoc-profile-request-findings';
import { openId4VpRequestFindings } from '../openid4vp-request-findings';
import { openId4VpReuseFindings } from '../openid4vp-reuse-findings';
import { openId4VpTokenFindings } from '../openid4vp-token-findings';
import { openId4VpTranscript } from '../openid4vp-transcript';
import { openId4VpWalletFindings } from '../openid4vp-wallet-findings';
import { pairRefusals } from '../pair-refusals';
import { proximitySessionFindings, type Session } from '../proximity-session-findings';
import { refusals } from '../refusals';
import { travelerMatch } from '../traveler-match';
import { walletRespond } from '../wallet-respond';
import type { Consent, Held, IsoTranscripts, Issuer, Key, Nonce, Origin, PresentationRequest, Presented, WalletResponse } from './exchange';
import type { AuthorizationRequest, Certificate } from './openid4vp';
import { acceptanceReading, boardingPassReading, consentReading, expiryReading, matchReading, pairReading, photoidReading, photoidValidityReading, requestReading, validityReading, walletReading, type Settings } from './readings';
import { ISO_TRANSCRIPTS, STAND_IN_FORMAT, exampleResolution792 } from './stand-ins';
import type { Instant, Journey, Mdoc, PhotoidTables, Resolution792, SourceDocument } from './types';

export interface OracleRequest {
  rule: string;
  reading: Settings;
  tables?: PhotoidTables;
  credential?: Mdoc;
  source?: SourceDocument;
  documentExpiry?: Instant;
  journey?: Journey;
  now?: Instant;
  resolution792?: string;
  photoid?: Mdoc;
  boardingPass?: Mdoc;
}

/** The inputs of the presentation rules (Oracle/Presentation.lean in verified-id). */
export interface PresentationOracleRequest {
  rule: string;
  reading: Settings;
  isoTranscripts?: string;
  held?: Held[];
  seen?: PresentationRequest;
  consent?: Consent;
  trustedIssuers?: Issuer[];
  request?: PresentationRequest;
  response?: WalletResponse;
  now?: Instant;
  resolution792?: string;
  photoid?: Presented;
  boardingPass?: Presented;
  authorization?: AuthorizationRequest;
  authorizations?: AuthorizationRequest[];
  trustedVerifiers?: Certificate[];
  seenOrigin?: Origin;
  origin?: Origin;
  nonce?: Nonce;
  encryptionKey?: Key;
  token?: Presented[][];
  deviceRequest?: DeviceRequest;
  sessions?: Session[];
}

function transcripts(name: string | undefined): IsoTranscripts {
  const found = name === undefined ? undefined : ISO_TRANSCRIPTS[name];
  if (!found) throw new Error(`unknown ISO transcripts ${name}`);
  return found;
}

/** The result the TypeScript checks give for one request for a presentation rule, or undefined for another rule. */
export function presentationAnswer(q: PresentationOracleRequest): unknown {
  const r = q.reading;
  switch (q.rule) {
    case 'Wallet.respond':
      return walletRespond(consentReading(r), transcripts(q.isoTranscripts), q.held!, q.seen!, q.consent!);
    case 'refusals':
      return refusals(acceptanceReading(r), expiryReading(r), transcripts(q.isoTranscripts), q.trustedIssuers!, q.request!, q.response!, q.now!);
    case 'pairRefusals':
      return pairRefusals(acceptanceReading(r), expiryReading(r), transcripts(q.isoTranscripts), q.trustedIssuers!, pairReading(r), format(q.resolution792), q.request!, q.photoid!, q.boardingPass!, q.now!);
    case 'OpenId4Vp.requestFindings':
      return openId4VpRequestFindings(requestReading(r), q.authorization!);
    case 'OpenId4Vp.reuseFindings':
      return openId4VpReuseFindings(q.authorizations!);
    case 'OpenId4Vp.walletFindings':
      return openId4VpWalletFindings(requestReading(r), walletReading(r), q.trustedVerifiers!, q.seenOrigin!, q.authorization!);
    case 'OpenId4Vp.transcript':
      return openId4VpTranscript(q.origin!, q.nonce!, q.encryptionKey!);
    case 'OpenId4Vp.tokenFindings':
      return openId4VpTokenFindings(q.token!);
    case 'MdocProfile.requestFindings':
      return mdocProfileRequestFindings(q.deviceRequest!);
    case 'Proximity.sessionFindings':
      return proximitySessionFindings(q.sessions!);
    default:
      return undefined;
  }
}

function format(name: string | undefined): Resolution792 {
  if (name !== STAND_IN_FORMAT) throw new Error(`unknown boarding pass format ${name}`);
  return exampleResolution792;
}

/** The result the TypeScript checks give for one oracle request. */
export function answer(q: OracleRequest): unknown {
  const r = q.reading;
  switch (q.rule) {
    case 'Photoid.violations':
      return photoidViolations(photoidReading(r), q.tables!, q.credential!);
    case 'Photoid.advisories':
      return photoidAdvisories(q.tables!, q.source!, q.credential!);
    case 'Photoid.sourceFindings':
      return photoidSourceFindings(photoidReading(r), q.source!);
    case 'Photoid.validityFindings':
      return photoidValidityFindings(photoidValidityReading(r), q.documentExpiry!, q.credential!);
    case 'BoardingPass.violations':
      return boardingPassViolations(boardingPassReading(r), format(q.resolution792), q.credential!);
    case 'BoardingPass.validityFindings':
      return boardingPassValidityFindings(validityReading(r), q.journey!, q.credential!);
    case 'expired':
      return expired(expiryReading(r), q.credential!, q.now!);
    case 'travelerMatch':
      return travelerMatch(matchReading(r), format(q.resolution792), q.photoid!, q.boardingPass!);
    default: {
      const presentation = presentationAnswer(q as unknown as PresentationOracleRequest);
      if (presentation === undefined) throw new Error(`unknown rule ${q.rule}`);
      return presentation;
    }
  }
}
