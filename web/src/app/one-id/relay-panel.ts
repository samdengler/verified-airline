import { Component, computed, inject, input, output } from '@angular/core';
import { wording } from './data';
import { Marker } from './marker';
import { qrCode } from './qr';
import { Relay, type RelayFor } from './relay';

/**
 * "Present from your phone" on the check-in page and the gate reader: a code for a
 * wallet on another device, and the same address as a link.  The screen that shows
 * it starts the session when asked to (`show`), and goes on as it does with the
 * wallet on the same device once the answer comes back.  With the model shown, its
 * marker is grey: the relay is transport, which the model does not cover.
 */
@Component({
  selector: 'va-relay-panel',
  imports: [Marker],
  template: `
    <section class="oid-card oid-stack oid-relay" data-panel="relay" [attr.data-for]="kind()" [attr.data-state]="asking().state">
      <div class="heading-row"><h2>{{ w().title }}</h2><va-marker [key]="'relay-' + kind()" [grey]="grey" /></div>
      @switch (view()) {
        @case ('waiting') {
          @if (code(); as c) {
            <svg class="oid-qr" data-qr [attr.viewBox]="'0 0 ' + c.size + ' ' + c.size" role="img" [attr.aria-label]="r.codeLabel" shape-rendering="crispEdges">
              <rect [attr.width]="c.size" [attr.height]="c.size" />
              <path [attr.d]="c.d" />
            </svg>
          }
          <p class="oid-small">{{ w().scan }}</p>
          <a class="oid-relay-link" data-relay-link [href]="asking().link" target="va-wallet">{{ asking().link }}</a>
          <p class="oid-strong" data-state="relay-waiting">{{ w().waiting }}</p>
        }
        @case ('starting') {
          <p class="oid-small" data-state="relay-starting">{{ r.starting }}</p>
        }
        @case ('unconfigured') {
          <p data-state="relay-unconfigured">{{ r.notConfigured }}</p>
        }
        @default {
          @if (asking().state === 'expired') { <p data-state="relay-expired">{{ r.expired }}</p> }
          @if (asking().state === 'failed') { <p data-state="relay-failed">{{ r.failed }}</p> }
          <p>{{ w().line }}</p>
          <button type="button" class="oid-button secondary" data-action="show-code" (click)="show.emit()">{{ asking().state === 'expired' ? r.again : r.show }}</button>
        }
      }
    </section>
  `,
})
export class RelayPanel {
  /** The screen it is on, which is the screen that asks. */
  readonly kind = input.required<RelayFor>();
  /** The screen starts a session with its own request. */
  readonly show = output<void>();

  private readonly relay = inject(Relay);
  protected readonly r = wording.traveler.relay;
  protected readonly grey = wording.lean.relay.grey;
  protected readonly w = computed(() => (this.kind() === 'gate' ? this.r.gate : this.r.checkIn));
  protected readonly asking = computed(() => this.relay.asking[this.kind()]());
  protected readonly view = computed(() => {
    const state = this.asking().state;
    return state === 'waiting' || state === 'starting' || state === 'unconfigured' ? state : 'ask';
  });
  protected readonly code = computed(() => {
    const link = this.asking().link;
    return link ? qrCode(link) : null;
  });
}
