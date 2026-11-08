import { Component } from '@angular/core';
import { wording } from './data';

/** What the markers mean, shown with the Lean model. */
@Component({
  selector: 'va-model-legend',
  template: `
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
export class ModelLegend {
  protected readonly legend = wording.lean.legend;
}
