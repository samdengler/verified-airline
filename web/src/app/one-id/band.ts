import { Component, input } from '@angular/core';
import { LeanToggle } from './lean-toggle';
import { ModelLegend } from './model-legend';

/** The band under the website's header on the check-in screen, with the Lean model button and its legend. */
@Component({
  selector: 'va-one-id-band',
  imports: [LeanToggle, ModelLegend],
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
        <va-lean-toggle />
      </div>
    </div></section>
    <va-model-legend />
  `,
})
export class Band {
  readonly title = input.required<string>();
  readonly lede = input.required<string>();
  readonly crumbs = input<readonly string[]>([]);
  readonly crumbLabel = input('');

}
