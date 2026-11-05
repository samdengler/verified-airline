import { element } from './element';
import type { Mdoc, Value } from './support/types';

export interface RequestedItem {
  nameSpace: string;
  identifier: string;
}

export interface Consent {
  /** What the wallet shares if the holder agrees: the requested items the credential holds. */
  shared: (RequestedItem & { value: Value })[];
  /** What the credential holds that was not requested. */
  kept: RequestedItem[];
}

/**
 * The consent sheet's lists: what a request would share and what stays in the
 * wallet.  This is ordinary code.  The site does not hold this step to the
 * model yet, and the screen shows it with a grey marker.
 *
 * not in the model: G-01
 */
export function consent(requested: readonly RequestedItem[], m: Mdoc): Consent {
  const shared = requested.flatMap((item) => {
    const value = element(m, item.nameSpace, item.identifier);
    return value === undefined ? [] : [{ ...item, value }];
  });
  const kept = m.nameSpaces.flatMap((ns) =>
    ns.elements
      .filter((e) => !requested.some((r) => r.nameSpace === ns.name && r.identifier === e.identifier))
      .map((e) => ({ nameSpace: ns.name, identifier: e.identifier })),
  );
  return { shared, kept };
}
