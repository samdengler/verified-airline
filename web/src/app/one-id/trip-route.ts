import type { Step } from './trip';

/** The three apps a trip moves between. */
export type App = 'website' | 'wallet' | 'gate';

export const APPS: readonly App[] = ['website', 'wallet', 'gate'];

/**
 * The trip's route: its stops in order, each in the app where it happens, and the
 * stop the trip waits at after each step.  This is ordinary code, so the map marks
 * it as not in the model yet.  A model of the trip would export this same data, and
 * the map would then read that file and be unable to drift from the model.
 */
export const STOPS = [
  { id: 'openWallet', app: 'website' },
  { id: 'share', app: 'wallet' },
  { id: 'addPass', app: 'website' },
  { id: 'present', app: 'wallet' },
  { id: 'shareGate', app: 'wallet' },
  { id: 'answer', app: 'gate' },
] as const satisfies readonly { id: string; app: App }[];

export type StopId = (typeof STOPS)[number]['id'];

/** A decline goes back to the stop before the wallet asked. */
const STOP_AFTER: Record<Step, StopId> = {
  start: 'openWallet',
  declined: 'openWallet',
  asked: 'share',
  shared: 'addPass',
  passAdded: 'present',
  gateDeclined: 'present',
  gateAsked: 'shareGate',
  presented: 'answer',
};

/** Where in the route the trip stands after a step. */
export const stopIndex = (step: Step): number => STOPS.findIndex((s) => s.id === STOP_AFTER[step]);

export type WebsiteAction = 'open' | 'add' | 'present';

/**
 * What the website can do next for this traveler.  None of these sends anything:
 * sharing happens only on the wallet's consent sheet, so nothing here can skip it.
 */
export function websiteAction(step: Step, traveler: { photoid: boolean; pass: boolean; accepted: boolean }): WebsiteAction | null {
  if (step === 'start' || step === 'declined') return traveler.photoid ? 'open' : null;
  if (!traveler.photoid || !traveler.pass || !traveler.accepted) return null;
  if (step === 'shared') return 'add';
  return step === 'passAdded' || step === 'gateDeclined' ? 'present' : null;
}

const COLUMN_WIDTH = 100;
const LANE_HEIGHT = 100;

/**
 * The route's lines, one between each pair of stops, in a box of one column per
 * stop and one lane per app.  A line that changes lanes turns between two columns,
 * clear of the stops' names.
 */
export function legsOf(current: number): { d: string; done: boolean }[] {
  const x = (i: number) => COLUMN_WIDTH * (i + 0.5);
  const y = (app: App) => LANE_HEIGHT * (APPS.indexOf(app) + 0.5);
  return STOPS.slice(1).map((stop, i) => {
    const from = STOPS[i];
    const turn = from.app === stop.app ? '' : ` H${x(i) + COLUMN_WIDTH / 2} V${y(stop.app)}`;
    return { d: `M${x(i)} ${y(from.app)}${turn} H${x(i + 1)}`, done: i < current };
  });
}
