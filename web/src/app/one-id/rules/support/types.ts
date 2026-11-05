// The model's types, in the JSON form lake exe oracle reads and writes
// (Oracle/Handle.lean in verified-id), so a request or a response from
// decisions.jsonl is one of these values as it stands.

/** A point in time: whole seconds since 1970-01-01T00:00:00Z. */
export type Instant = number;

export type Value = { text: string } | { bytes: number[] } | { flag: boolean } | { other: string };

export interface DataElement {
  identifier: string;
  value: Value;
}

export interface NameSpace {
  name: string;
  elements: DataElement[];
}

export interface Mdoc {
  docType: string;
  nameSpaces: NameSpace[];
  validUntil: Instant;
}

/** A reason a credential is rejected. `code` is the name of the constructor of Finding in Rules/OneId/Mdoc.lean. */
export type Finding =
  | { code: 'wrongDocType'; expected: string; found: string }
  | { code: 'repeatedName' }
  | { code: 'missingNameSpace'; name: string }
  | { code: 'missingElement'; nameSpace: string; identifier: string }
  | { code: 'notText'; nameSpace: string; identifier: string }
  | { code: 'wrongEncoding'; nameSpace: string; identifier: string }
  | { code: 'notFromPassport' }
  | { code: 'notResolution792' }
  | { code: 'unlistedNameSpace'; name: string }
  | { code: 'unlistedElement'; nameSpace: string; identifier: string }
  | { code: 'portraitDiffersFromDg2' }
  | { code: 'endsBeforeLastDeparture' }
  | { code: 'endsLongAfterLastDeparture' }
  | { code: 'outlivesSourceDocument' };

/** A recommendation a credential does not follow. It does not make the credential unacceptable. */
export type Advisory =
  | { code: 'missingRecommendedNameSpace'; name: string }
  | { code: 'missingRecommendedElement'; nameSpace: string; identifier: string }
  | { code: 'notDerivedFromPassport' };

export type Presence = 'mandatory' | 'optional' | 'other';
export type Encoding = 'text' | 'bytes' | 'flag' | 'other';

export interface TableEntry {
  identifier: string;
  presence: Presence;
  encoding: Encoding;
}

export interface ElementTable {
  entries: TableEntry[];
}

/** Tables C.1, C.2 and C.3 of ISO/IEC TS 23220-4 Annex C, which verified-id has not read: a parameter of every photoid check. */
export interface PhotoidTables {
  base: ElementTable;
  photoid: ElementTable;
  dataGroups: ElementTable;
}

export type SourceDocument = 'passport' | 'other';

export interface Journey {
  scheduledDeparture: Instant;
  actualDeparture: Instant;
  completed: Instant;
}

/** What IATA Resolution 792 decides about a boarding pass string, which verified-id has not read: a parameter. */
export interface Resolution792 {
  follows(s: string): boolean;
  passenger(s: string): readonly [family: string, given: string] | undefined;
}

// The readings: what the guide leaves undecided, each a parameter of the check that reads it.

export interface PhotoidReading {
  portraitRequired: boolean;
  unlistedDataAllowed: boolean;
  portraitIsDg2: boolean;
  photoidTableBinds: boolean;
  dataGroupsTableBinds: boolean;
  repeatedNamesRefused: boolean;
  passportRequired: boolean;
}

export interface BoardingPassReading {
  unlistedDataAllowed: boolean;
  repeatedNamesRefused: boolean;
}

export interface ExpiryReading {
  validAtEnd: boolean;
}

export type DepartureReading = 'scheduled' | 'actual';

export interface ValidityReading {
  departure: DepartureReading;
  soonAfter: number;
}

export type MatchReading = 'notChecked' | 'namesAgree';
export type PhotoidValidityReading = 'unbounded' | 'endsWithDocument';
