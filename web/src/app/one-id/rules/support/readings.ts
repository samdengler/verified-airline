// The reading points the TypeScript checks take, keyed as readings.json and
// the oracle key them.  An expert who settles a question removes the point
// from the model; the switches test then fails until it goes from here and
// from the check that reads it.
import type {
  BoardingPassReading,
  DepartureReading,
  ExpiryReading,
  MatchReading,
  PhotoidReading,
  PhotoidValidityReading,
  ValidityReading,
} from './types';

export type Setting = boolean | number | string;
export type Settings = Readonly<Record<string, Setting>>;

/** Every point, with the checks that read it, as readings.json lists them. */
export const READING_POINTS: Readonly<Record<string, readonly string[]>> = {
  'PhotoidReading.portraitRequired': ['Photoid.violations'],
  'PhotoidReading.unlistedDataAllowed': ['Photoid.violations'],
  'PhotoidReading.portraitIsDg2': ['Photoid.violations'],
  'PhotoidReading.photoidTableBinds': ['Photoid.violations'],
  'PhotoidReading.dataGroupsTableBinds': ['Photoid.violations'],
  'PhotoidReading.repeatedNamesRefused': ['Photoid.violations'],
  'PhotoidReading.passportRequired': ['Photoid.sourceFindings'],
  'BoardingPassReading.unlistedDataAllowed': ['BoardingPass.violations'],
  'BoardingPassReading.repeatedNamesRefused': ['BoardingPass.violations'],
  'ExpiryReading.validAtEnd': ['expired'],
  'ValidityReading.departure': ['BoardingPass.validityFindings'],
  'ValidityReading.soonAfter': ['BoardingPass.validityFindings'],
  MatchReading: ['travelerMatch'],
  PhotoidValidityReading: ['Photoid.validityFindings'],
};

export const photoidReading = (s: Settings): PhotoidReading => ({
  portraitRequired: s['PhotoidReading.portraitRequired'] === true,
  unlistedDataAllowed: s['PhotoidReading.unlistedDataAllowed'] === true,
  portraitIsDg2: s['PhotoidReading.portraitIsDg2'] === true,
  photoidTableBinds: s['PhotoidReading.photoidTableBinds'] === true,
  dataGroupsTableBinds: s['PhotoidReading.dataGroupsTableBinds'] === true,
  repeatedNamesRefused: s['PhotoidReading.repeatedNamesRefused'] === true,
  passportRequired: s['PhotoidReading.passportRequired'] === true,
});

export const boardingPassReading = (s: Settings): BoardingPassReading => ({
  unlistedDataAllowed: s['BoardingPassReading.unlistedDataAllowed'] === true,
  repeatedNamesRefused: s['BoardingPassReading.repeatedNamesRefused'] === true,
});

export const expiryReading = (s: Settings): ExpiryReading => ({ validAtEnd: s['ExpiryReading.validAtEnd'] === true });

export const validityReading = (s: Settings): ValidityReading => ({
  departure: s['ValidityReading.departure'] as DepartureReading,
  soonAfter: s['ValidityReading.soonAfter'] as number,
});

export const matchReading = (s: Settings): MatchReading => s['MatchReading'] as MatchReading;

export const photoidValidityReading = (s: Settings): PhotoidValidityReading => s['PhotoidValidityReading'] as PhotoidValidityReading;
