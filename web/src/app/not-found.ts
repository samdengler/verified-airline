import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'va-not-found',
  imports: [RouterLink],
  template: `
    <section class="band"><div class="wrap"><div class="band-row"><div class="band-text">
      <h1>Page not found</h1>
      <p class="lede">There is no page at this address. The <a routerLink="/policies">travel policies</a>
        answer questions about fares, paying, changes, refunds, extras and schedule changes.</p>
    </div></div></div></section>
    <div id="content"></div>
  `,
})
export class NotFound {}
