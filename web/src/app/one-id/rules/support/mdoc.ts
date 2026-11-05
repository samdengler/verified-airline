// What every check of a credential shares, from Rules/OneId/Mdoc.lean.
import type { DataElement, Finding, Mdoc, NameSpace, Value } from './types';

/** Mdoc.nameSpace?: the first namespace with a name. */
export const nameSpaceNamed = (m: Mdoc, name: string): NameSpace | undefined => m.nameSpaces.find((ns) => ns.name === name);

/** Mdoc.nameSpacesNamed: every namespace with a name. */
export const nameSpacesNamed = (m: Mdoc, name: string): NameSpace[] => m.nameSpaces.filter((ns) => ns.name === name);

/** NameSpace.element?: the value of the first data element with an identifier. */
export const elementIn = (ns: NameSpace, identifier: string): Value | undefined =>
  ns.elements.find((e) => e.identifier === identifier)?.value;

/** Mdoc.values: every value a credential holds under a namespace name and an identifier. */
export const values = (m: Mdoc, name: string, identifier: string): Value[] =>
  nameSpacesNamed(m, name).flatMap((ns) => ns.elements.filter((e) => e.identifier === identifier).map((e) => e.value));

const distinct = (xs: string[]): boolean => new Set(xs).size === xs.length;

/** Mdoc.wellFormed: no two namespaces share a name, and no two data elements of one namespace share an identifier. */
export const wellFormed = (m: Mdoc): boolean =>
  distinct(m.nameSpaces.map((ns) => ns.name)) && m.nameSpaces.every((ns) => distinct(ns.elements.map((e: DataElement) => e.identifier)));

/** docTypeFindings. */
export const docTypeFindings = (expected: string, m: Mdoc): Finding[] =>
  m.docType === expected ? [] : [{ code: 'wrongDocType', expected, found: m.docType }];

/** nameFindings. */
export const nameFindings = (refused: boolean, m: Mdoc): Finding[] => (refused && !wellFormed(m) ? [{ code: 'repeatedName' }] : []);

/** Equality of two values: `!=` on Value in the Lean. */
export function sameValue(a: Value, b: Value): boolean {
  if ('text' in a) return 'text' in b && a.text === b.text;
  if ('flag' in a) return 'flag' in b && a.flag === b.flag;
  if ('other' in a) return 'other' in b && a.other === b.other;
  return 'bytes' in b && a.bytes.length === b.bytes.length && a.bytes.every((x, i) => x === b.bytes[i]);
}
