// The tables of data elements, from Rules/OneId/Photoid.lean.
import { elementIn } from './mdoc';
import type { DataElement, ElementTable, Encoding, NameSpace, TableEntry, Value } from './types';

/** ElementTable.mandatory. */
export const mandatory = (t: ElementTable): string[] => t.entries.filter((e) => e.presence === 'mandatory').map((e) => e.identifier);

/** ElementTable.entry?. */
export const entryOf = (t: ElementTable, identifier: string): TableEntry | undefined => t.entries.find((e) => e.identifier === identifier);

/** Encoding.accepts: an encoding the model does not tell apart accepts every value. */
export function accepts(encoding: Encoding, value: Value): boolean {
  switch (encoding) {
    case 'text':
      return 'text' in value;
    case 'bytes':
      return 'bytes' in value;
    case 'flag':
      return 'flag' in value;
    case 'other':
      return true;
  }
}

/** missingMandatory: the identifiers a table marks mandatory that a namespace lacks. */
export const missingMandatory = (t: ElementTable, ns: NameSpace): string[] =>
  mandatory(t).filter((id) => elementIn(ns, id) === undefined);

/** wronglyEncoded: the data elements of a namespace whose value does not have the encoding its table gives. */
export const wronglyEncoded = (t: ElementTable, ns: NameSpace): DataElement[] =>
  ns.elements.filter((e) => {
    const entry = entryOf(t, e.identifier);
    return entry ? !accepts(entry.encoding, e.value) : false;
  });
