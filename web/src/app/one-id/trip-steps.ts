// The trip's steps and what the gate shows.  Each function mirrors one in
// trip-model/Trip/Model.lean, and the tests hold it to the model's answer on every
// input.  The proofs are about the Lean model.

export type Step = 'start' | 'asked' | 'declined' | 'shared' | 'passAdded' | 'gateAsked' | 'gateDeclined' | 'presented';
export type Action = 'openWallet' | 'share' | 'decline' | 'addPass' | 'present' | 'shareGate' | 'declineGate' | 'startAgain';
export type CheckState = 'passed' | 'failed' | 'depends';
export type Outcome = 'board' | 'refer' | 'depends';
export type Kind = 'pair' | 'credential' | 'presentation';
export type Shows = 'waiting' | 'decide' | 'credentialAccepted' | 'credentialRefused' | 'presentationAccepted' | 'presentationRefused' | 'board' | 'refer';

/**
 * The step an action leads to, or null when it is not allowed at this step.  The
 * only way to `presented` is the wallet's Share on the gate's consent sheet.
 *
 * requirement: TRIP-001
 * lean: Trip.next
 */
export function next(step: Step, action: Action): Step | null {
  if (action === 'startAgain') return 'start';
  switch (step) {
    case 'start':
    case 'declined':
      return action === 'openWallet' ? 'asked' : null;
    case 'asked':
      return action === 'share' ? 'shared' : action === 'decline' ? 'declined' : null;
    case 'shared':
      return action === 'addPass' ? 'passAdded' : null;
    case 'passAdded':
    case 'gateDeclined':
      return action === 'present' ? 'gateAsked' : null;
    case 'gateAsked':
      return action === 'shareGate' ? 'presented' : action === 'declineGate' ? 'gateDeclined' : null;
    case 'presented':
      return null;
  }
}

/**
 * The checks' results as one outcome.
 *
 * requirement: TRIP-004
 * lean: Trip.outcomeOf
 */
export function outcomeOf(checks: readonly CheckState[]): Outcome {
  if (checks.includes('failed')) return 'refer';
  return checks.includes('depends') ? 'depends' : 'board';
}

/**
 * A pair can be boarded.  One credential only gets a result for itself, since the
 * gate needs both.  A presentation is accepted or refused.
 *
 * part of requirement: TRIP-003
 * lean: Trip.kindOf
 */
export function kindFrom(subject: { presentation: boolean; photoid: boolean; pass: boolean }): Kind {
  if (subject.presentation) return 'presentation';
  return subject.photoid && subject.pass ? 'pair' : 'credential';
}

/**
 * What the gate shows, for any result of the checks.  `also` is the presentation the
 * default trip also makes at the gate.
 *
 * requirement: TRIP-003
 * lean: Trip.gateShows
 */
export function gateShows(step: Step, view: { kind: Kind; outcome: Outcome; stops: readonly string[] }, also: { outcome: Outcome } | null): Shows {
  if (step !== 'presented') return 'waiting';
  if (view.stops.length > 0 || view.outcome === 'depends' || also?.outcome === 'depends') return 'decide';
  const allowed = view.outcome === 'board';
  if (view.kind === 'credential') return allowed ? 'credentialAccepted' : 'credentialRefused';
  if (view.kind === 'presentation') return allowed ? 'presentationAccepted' : 'presentationRefused';
  return allowed && also?.outcome !== 'refer' ? 'board' : 'refer';
}
