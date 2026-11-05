import { elementIn, nameSpaceNamed } from './support/mdoc';
import type { Mdoc, Value } from './support/types';

/**
 * The value of a data element, by the name of its namespace and its
 * identifier: the first match, or undefined.
 *
 * requirement: OID-106
 * lean: Rules.OneId.Mdoc.element?
 */
export function element(m: Mdoc, nameSpace: string, identifier: string): Value | undefined {
  const ns = nameSpaceNamed(m, nameSpace);
  return ns && elementIn(ns, identifier);
}
