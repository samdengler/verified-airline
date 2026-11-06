import { Component, computed, input } from '@angular/core';
import { element } from './rules/element';
import { baseNameSpace, bcbpNameSpace, bcbpStringId, familyNameId, givenNameId } from './rules/support/identifiers';
import { exampleResolution792 } from './rules/support/stand-ins';
import type { Mdoc } from './rules/support/types';
import { wording } from './data';

const text = (m: Mdoc, nameSpace: string, id: string): string | undefined => {
  const v = element(m, nameSpace, id);
  return v && 'text' in v ? v.text : undefined;
};

/** The family name and given name a photoid carries. */
export const photoidNames = (m: Mdoc): { family?: string; given?: string } => ({ family: text(m, baseNameSpace, familyNameId), given: text(m, baseNameSpace, givenNameId) });

/** A photoid's name as a reader shows it. */
export const photoidNameLine = (m: Mdoc): string => [photoidNames(m).family, photoidNames(m).given].filter(Boolean).join(' / ');

/** The name a boarding pass string carries, in the stand-in format, or else the string itself. */
export function passNameLine(m: Mdoc): string {
  const s = text(m, bcbpNameSpace, bcbpStringId) ?? '';
  const name = exampleResolution792.passenger(s);
  return name ? `${name[0]} / ${name[1]}` : s;
}

/** A credential in the demo: always marked as a specimen. */
@Component({
  selector: 'va-credential',
  template: `
    <article class="oid-credential" [class.pass]="role() === 'boardingPass'" [attr.data-credential]="role()">
      <header class="oid-credential-head">
        <span class="oid-credential-title">{{ role() === 'photoid' ? labels.photoid : labels.boardingPass }}</span>
        <span class="oid-specimen">{{ specimen }}</span>
      </header>
      <ng-content />
      <dl class="oid-lean-ids" data-lean>
        <dt>{{ lean.docType }}</dt><dd><code>{{ mdoc().docType }}</code></dd>
        <dt>{{ lean.nameSpaces }}</dt><dd>@for (n of nameSpaces(); track $index) { <code>{{ n }}</code> }</dd>
        @if (issuer(); as i) { <dt>{{ lean.issuer }}</dt><dd><code>{{ i }}</code></dd> }
      </dl>
    </article>
  `,
})
export class CredentialCard {
  readonly role = input.required<'photoid' | 'boardingPass'>();
  readonly mdoc = input.required<Mdoc>();
  /** Who issued it, from the model's scenario. */
  readonly issuer = input<string | null>(null);
  protected readonly labels = wording.traveler.labels;
  protected readonly specimen = wording.traveler.specimen;
  protected readonly lean = wording.lean.wallet;
  protected readonly nameSpaces = computed(() => this.mdoc().nameSpaces.map((ns) => ns.name));
}
