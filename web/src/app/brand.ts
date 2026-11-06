import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { site } from './content';

/** Verified Airline's mark and name, the same on the website and the gate reader. */
@Component({
  selector: 'va-brand',
  imports: [RouterLink],
  template: `<a class="brand" routerLink="/"><svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path transform="rotate(-30 12 12)" fill="currentColor" d="M21.6 12c0-.85-.7-1.45-1.55-1.45H14.3L9.4 3.2H7.6l2.35 7.35H5.5L3.75 8.1H2.4l1.05 3.9-1.05 3.9h1.35l1.75-2.45h4.45L7.6 20.8h1.8l4.9-7.35h5.75c.85 0 1.55-.6 1.55-1.45z"/></svg><span class="wordmark">{{ airline }}</span></a>`,
})
export class Brand {
  protected readonly airline = site.airline;
}
