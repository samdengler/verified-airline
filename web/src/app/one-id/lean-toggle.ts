import { Component, inject } from '@angular/core';
import { LeanModel } from '../lean-model';
import { wording } from './data';

/** The Lean model button, the same on every surface. */
@Component({
  selector: 'va-lean-toggle',
  template: `
    <button type="button" class="lean-toggle" [attr.aria-pressed]="lean.shown()" (click)="lean.toggle()">
      <span class="when-off">{{ words.show }}</span><span class="when-on">{{ words.hide }}</span>
    </button>
  `,
})
export class LeanToggle {
  protected readonly lean = inject(LeanModel);
  protected readonly words = wording.traveler.toggle;
}
