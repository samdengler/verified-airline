import routeFile from '../../../../model/trip/route.json';
import type { Action, Step } from './trip-steps';

/** The three apps a trip moves between. */
export type App = 'website' | 'wallet' | 'gate';

export const APPS: readonly App[] = ['website', 'wallet', 'gate'];

export type StopId = 'openWallet' | 'share' | 'addPass' | 'present' | 'shareGate' | 'answer';

/** The trip's route, from the model: its stops in order, each in the app where it happens. */
export const STOPS = routeFile.stops as readonly { id: StopId; app: App; action: Action | null }[];

const STOP_AFTER = routeFile.stopAfter as Record<Step, StopId>;

/** Where in the route the trip stands after a step. */
export const stopIndex = (step: Step): number => STOPS.findIndex((s) => s.id === STOP_AFTER[step]);

/**
 * What the website can do next for this traveler.  None of these sends anything:
 * sharing happens only on the wallet's consent sheet, so nothing here can skip it.
 */
export function websiteAction(step: Step, traveler: { photoid: boolean; pass: boolean; accepted: boolean }): Action | null {
  if (step === 'start' || step === 'declined') return traveler.photoid ? 'openWallet' : null;
  if (!traveler.photoid || !traveler.pass || !traveler.accepted) return null;
  if (step === 'shared') return 'addPass';
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
