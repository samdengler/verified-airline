import { Component, inject, input } from '@angular/core';
import { LeanModel } from '../lean-model';
import { wording } from './data';

/** The band under the header on each One ID screen, with the Lean model button and its legend. */
@Component({
  selector: 'va-one-id-band',
  template: `
    <section class="band"><div class="wrap">
      @if (crumbs().length) {
        <nav class="crumbs" [attr.aria-label]="crumbLabel()">
          @for (c of crumbs(); track c; let last = $last) {
            <span>{{ c }}</span>
            @if (!last) { <span aria-hidden="true">/</span> }
          }
        </nav>
      }
      <div class="band-row">
        <div class="band-text">
          <h1>{{ title() }}</h1>
          <p class="lede">{{ lede() }}</p>
        </div>
        <button type="button" class="lean-toggle" [attr.aria-pressed]="lean.shown()" (click)="lean.toggle()">
          <span class="when-off">{{ toggle.show }}</span><span class="when-on">{{ toggle.hide }}</span>
        </button>
      </div>
    </div></section>
    <div class="lean-legend" data-lean><div class="wrap oid-legend">
      <p class="oid-legend-keys">
        <span><span class="lean-marker proven" aria-hidden="true">∀</span> {{ legend.proven }}</span>
        <span><span class="lean-marker open" aria-hidden="true">∀</span> {{ legend.open }}</span>
        <span><span class="lean-marker partial" aria-hidden="true">∀</span> {{ legend.grey }}</span>
      </p>
      <p>{{ legend.text }}</p>
    </div></div>
  `,
})
export class Band {
  readonly title = input.required<string>();
  readonly lede = input.required<string>();
  readonly crumbs = input<readonly string[]>([]);
  readonly crumbLabel = input('');

  protected readonly lean = inject(LeanModel);
  protected readonly toggle = wording.traveler.toggle;
  protected readonly legend = wording.lean.legend;
}
