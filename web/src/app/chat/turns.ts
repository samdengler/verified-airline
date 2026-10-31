// A turn as the chat API returns it (chat/airline_agent/turn_view.py), and the
// small decisions the widget makes from one.

export type Mode = 'kb' | 'verified';
export type State = 'verified' | 'withheld' | 'not checked';

export interface Finding {
  kind: string;
  premises?: string[];
  claims?: string[];
  confidence?: number;
  untranslated?: string[];
  rules?: string[];
  options?: { premises: string[]; claims: string[] }[];
}

export interface Requirement {
  id: string;
  proven: number;
  total: number;
}

export interface Turn {
  contact: string;
  turn: number;
  at: number;
  mode: Mode;
  state: State;
  question: string;
  draft: string;
  check: { result: string; findings: Finding[]; rulesApplied: string[]; untranslated: string[] } | null;
  rules: Record<string, { statement: string; lean: string; requirements: Requirement[] }>;
  provenance: { leanModelCommit?: string; policyVersion?: string; guardrailVersion?: string } | null;
}

/**
 * The turn behind a reply: the latest turn for this question that no earlier
 * reply took.  Matching by question keeps the pairing right when a turn never
 * reached the agent and so has no record.
 */
export function turnFor(turns: Turn[], question: string, taken: ReadonlySet<number>): Turn | null {
  const candidates = turns.filter((t) => t.question === question && !taken.has(t.turn));
  return candidates.reduce<Turn | null>((best, t) => (best && best.turn > t.turn ? best : t), null);
}

/** The check's logic as a reader can scan it: (= fare MAIN) reads fare = MAIN. */
export function readable(logic: string): string {
  const flat = logic.replace(/\s+/g, ' ').trim();
  const eq = /^\(= (\S+) (.+)\)$/.exec(flat);
  return eq ? `${eq[1]} = ${eq[2]}` : flat;
}

/**
 * One row per finding: what the check took as given and what it read the
 * answer as saying.  Kept apart, so an answer that covers each fare in turn
 * shows which amount goes with which fare.
 */
export function findingRows(turn: Turn): { premises: string[]; claims: string[] }[] {
  const rows = (turn.check?.findings ?? []).map((f) => ({
    premises: (f.premises ?? []).map(readable),
    claims: (f.claims ?? []).map(readable),
  }));
  const unique = new Map(rows.map((r) => [JSON.stringify(r), r]));
  return [...unique.values()];
}

/** The lowest confidence any finding's translation had, if any reported one. */
export function confidence(turn: Turn): number | null {
  const values = (turn.check?.findings ?? []).map((f) => f.confidence).filter((c): c is number => typeof c === 'number');
  return values.length ? Math.min(...values) : null;
}

/** Blue when every criterion behind a rule is proven, amber when any is open, as the site's markers are. */
export function tone(requirements: Requirement[]): 'proven' | 'open' {
  return requirements.every((r) => r.proven === r.total) ? 'proven' : 'open';
}

/** The rules a contradicted draft broke, in the order the check named them. */
export function contradicted(turn: Turn): string[] {
  const ids = (turn.check?.findings ?? []).filter((f) => f.kind === 'invalid').flatMap((f) => f.rules ?? []);
  return [...new Set(ids)];
}

/** Policy version 5 from the version's ARN, which ends in :5. */
export function versionOf(arn: string | undefined): string | null {
  const m = arn ? /:(\d+)$/.exec(arn) : null;
  return m ? m[1] : null;
}
