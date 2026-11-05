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
import { travelerMatch } from '../traveler-match';
import { boardingPassReading, expiryReading, matchReading, photoidReading, photoidValidityReading, validityReading, type Settings } from './readings';
import { STAND_IN_FORMAT, exampleResolution792 } from './stand-ins';
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
    default:
      throw new Error(`unknown rule ${q.rule}`);
  }
}
