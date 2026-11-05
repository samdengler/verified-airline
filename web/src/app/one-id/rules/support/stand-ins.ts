// The invented boarding pass format of Rules/OneId/Examples.lean.  Resolution
// 792 is not modelled; every scenario in model/one-id/scenarios.json uses this
// stand-in and says so.
import type { IsoTranscripts } from './exchange';
import type { Resolution792 } from './types';

export const STAND_IN_FORMAT = 'exampleResolution792';

function parts(s: string): string | undefined {
  const p = s.split(':');
  return p.length === 2 && p[0] === 'EXAMPLE' ? p[1] : undefined;
}

export const exampleResolution792: Resolution792 = {
  follows: (s) => parts(s) !== undefined,
  passenger: (s) => {
    const name = parts(s)?.split('/');
    return name?.length === 2 ? [name[0], name[1]] : undefined;
  },
};

// The invented session transcripts of Rules/OneId/PresentationExamples.lean.
// The ISO documents that define them were not read.

export const exampleIsoTranscripts: IsoTranscripts = {
  annexC: (q) => ({ iso: `example mdoc profile|${q.origin.value}|${q.nonce.value}|${q.encryptionKey.name}` }),
  proximity: (q) => ({ iso: `example proximity|${q.origin.value}|${q.encryptionKey.name}` }),
};

export const transcriptsWithoutNonce: IsoTranscripts = {
  annexC: (q) => ({ iso: `example mdoc profile without a nonce|${q.origin.value}|${q.encryptionKey.name}` }),
  proximity: exampleIsoTranscripts.proximity,
};

/** The stand-ins a scenario or a request may name. */
export const ISO_TRANSCRIPTS: Readonly<Record<string, IsoTranscripts>> = { exampleIsoTranscripts, transcriptsWithoutNonce };
