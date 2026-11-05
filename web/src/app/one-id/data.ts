// Everything about the model that the screens show, read from model/one-id/.
// Nothing here is typed by hand: statuses, questions, scenarios and settings
// are the build's files, and results are computed by the checks in rules/.
import modelFile from '../../../../model/one-id/model.json';
import readingsFile from '../../../../model/one-id/readings.json';
import scenariosFile from '../../../../model/one-id/scenarios.json';
import { oneIdWording } from '../content';
import type { Setting, Settings } from './rules/support/readings';
import type { Instant, Journey, Mdoc, PhotoidTables, SourceDocument } from './rules/support/types';

export interface Credential {
  role: 'photoid' | 'boardingPass';
  about: string;
  mdoc: Mdoc;
}

export interface Scenario {
  id: string;
  title: string;
  default: boolean;
  credentials: Credential[];
  journey: Journey | null;
  checkedAt: Instant;
  sourceDocument: { kind: SourceDocument; expires: Instant } | null;
  standIns: boolean;
  example: string | null;
}

export interface Reading {
  id: string;
  lean: string;
  label: string;
  description: string;
  settings: { value: Setting; label: string; description?: string; lean?: string }[];
  asWritten: Setting | null;
  checks: string[];
  criteria: string[];
  questions: { theorem: string; criteria: string[]; question: string; examples: string[] }[];
}

export interface Requirement {
  name: string;
  ears: string;
  review: string | null;
  criteria: { id: string; status: string; ears: string }[];
}

export interface OpenQuestion {
  theorem: string;
  question: string;
  example: string | null;
  review: string | null;
}

export interface Identifier {
  name: string;
  lean: string;
  value: string;
  description: string;
  nameSpace?: string;
}

export const wording = oneIdWording;
export const scenarios = scenariosFile.scenarios as unknown as Scenario[];
export const tables = scenariosFile.standIns.tables.value as unknown as PhotoidTables;
export const standInsInvented: boolean = scenariosFile.standIns.invented;
export const readings = readingsFile.readings as unknown as Reading[];
export const requirements = modelFile.requirements as unknown as Record<string, Requirement>;
export const openQuestions = modelFile.openQuestions as unknown as Record<string, OpenQuestion[]>;
export const dataElements = modelFile.identifiers.dataElements as unknown as Identifier[];

/** The scenario the build marks as the default trip.  Every reading gives it the same result, and verified-id's build checks that. */
export const defaultScenario: Scenario = scenarios.filter((s) => s.default)[0];

/** Where each switch starts: the guide as written where the model marks one, or else the first setting it lists. */
export const startingSettings: Settings = Object.fromEntries(readings.map((r) => [r.id, r.asWritten ?? r.settings[0].value]));

/** The items the airline asks for, with their identifiers from the model. */
export const requestedItems = wording.traveler.request.map((item) => {
  const id = dataElements.find((e) => e.name === item.element);
  if (!id?.nameSpace) throw new Error(`model/one-id/model.json has no data element ${item.element} with a namespace`);
  return { label: item.label, nameSpace: id.nameSpace, identifier: id.value };
});

export const credentialOf = (s: Scenario, role: Credential['role']): Mdoc | undefined => s.credentials.find((c) => c.role === role)?.mdoc;

/** Replaces each {name} in a piece of wording. */
export const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));

const pad = (n: number): string => String(n).padStart(2, '0');

/** An instant in UTC, as in "10:00 UTC". */
export function formatTime(t: Instant): string {
  const d = new Date(t * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

/** An instant in UTC, as in "1 March 2027, 10:00 UTC". */
export const formatInstant = (t: Instant): string => `${dateFormat.format(new Date(t * 1000))}, ${formatTime(t)}`;

/** "JOSÉ MARÍA" as "José María", for a greeting. */
export const titleCase = (s: string): string =>
  s
    .toLocaleLowerCase('en')
    .split(' ')
    .map((w) => w.charAt(0).toLocaleUpperCase('en') + w.slice(1))
    .join(' ');
