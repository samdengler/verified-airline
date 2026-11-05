import type { Key } from './support/exchange';

export interface Session {
  deviceKey: Key;
  readerKey: Key;
  retrieval: 'bluetoothLowEnergy' | 'nfc' | 'wifiAware' | 'server';
}

export type SessionFinding = { code: 'serverRetrieval' } | { code: 'readerKeyReused' } | { code: 'deviceKeyReused' };

const distinct = (xs: string[]): boolean => new Set(xs).size === xs.length;

/**
 * What the proximity sessions of one deployment break: each must use keys made
 * for it and retrieve data from the device only.
 *
 * requirement: OID-301
 * lean: Rules.OneId.Proximity.sessionFindings
 */
export function proximitySessionFindings(sessions: readonly Session[]): SessionFinding[] {
  return [
    ...(sessions.every((s) => s.retrieval !== 'server') ? [] : [{ code: 'serverRetrieval' } as SessionFinding]),
    ...(distinct(sessions.map((s) => s.readerKey.name)) ? [] : [{ code: 'readerKeyReused' } as SessionFinding]),
    ...(distinct(sessions.map((s) => s.deviceKey.name)) ? [] : [{ code: 'deviceKeyReused' } as SessionFinding]),
  ];
}
