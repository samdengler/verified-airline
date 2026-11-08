import { Component, computed, input } from '@angular/core';
import { Marker } from './marker';
import { element } from './rules/element';
import { baseNameSpace, bcbpNameSpace, bcbpStringId, familyNameId, givenNameId } from './rules/support/identifiers';
import { exampleResolution792 } from './rules/support/stand-ins';
import type { Mdoc } from './rules/support/types';
import { wording } from './data';
import { type SignatureView, signatureWords } from './signatures';

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

/** A credential in the demo: always marked as a specimen, and with who signed it once its signature is checked. */
@Component({
  selector: 'va-credential',
  imports: [Marker],
  template: `
    <article class="oid-credential" [class.pass]="role() === 'boardingPass'" [attr.data-credential]="role()">
      <header class="oid-credential-head">
        <span class="oid-credential-title">{{ role() === 'photoid' ? labels.photoid : labels.boardingPass }}</span>
        <span class="oid-specimen">{{ specimen }}</span>
      </header>
      <ng-content />
      @if (signed(); as s) {
        <div class="oid-signed marked" [attr.data-signature]="s.state">
          <p class="oid-grow oid-small">@if (s.signer) { <span>{{ s.signer }}</span> · }<span class="oid-strong">{{ s.text }}</span></p>
          <va-marker [key]="'signature-' + role()" [grey]="signatureGrey" />
        </div>
      }
      <dl class="oid-lean-ids" data-lean>
        <dt>{{ lean.docType }}</dt><dd><code>{{ mdoc().docType }}</code></dd>
        <dt>{{ lean.nameSpaces }}</dt><dd>@for (n of nameSpaces(); track $index) { <code>{{ n }}</code> }</dd>
        @if (issuer(); as i) { <dt>{{ lean.issuer }}</dt><dd><code>{{ i }}</code></dd> }
        @if (signature()?.kid; as k) { <dt>{{ signatureLean.key }}</dt><dd><code>{{ k }}</code></dd> }
      </dl>
    </article>
  `,
})
export class CredentialCard {
  readonly role = input.required<'photoid' | 'boardingPass'>();
  readonly mdoc = input.required<Mdoc>();
  /** Who issued it, from the model's scenario. */
  readonly issuer = input<string | null>(null);
  /** Its signature, once checked: who signed it, from the protected header, and whether it holds. */
  readonly signature = input<SignatureView | null>(null);
  protected readonly labels = wording.traveler.labels;
  protected readonly specimen = wording.traveler.specimen;
  protected readonly lean = wording.lean.wallet;
  protected readonly nameSpaces = computed(() => this.mdoc().nameSpaces.map((ns) => ns.name));
  protected readonly signatureLean = wording.lean.signature;
  /** The list of trusted keys is a stand-in, outside the model: the marker is grey. */
  protected readonly signatureGrey = wording.lean.signature.grey;
  protected readonly signed = computed(() => {
    const s = this.signature();
    if (!s) return null;
    const words = signatureWords(s);
    return { state: s.state, signer: words.signer, text: words.state };
  });
}
