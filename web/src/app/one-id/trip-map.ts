import { isPlatformBrowser } from '@angular/common';
import { Component, OnInit, PLATFORM_ID, computed, inject, input } from '@angular/core';
import { wording } from './data';
import { Marker } from './marker';
import { type Step, Trip } from './trip';
import { APPS, type App, STOPS, legsOf, stopIndex } from './trip-route';

/** Each app's page, and the tab it opens in, so going back to an app finds its tab. */
const PAGES: Record<App, { href: string; target: string }> = {
  website: { href: '/check-in', target: 'va-website' },
  wallet: { href: '/wallet', target: 'va-wallet' },
  gate: { href: '/gate', target: 'va-gate' },
};

/** The next step when this screen can run it, offered by the screen that owns it. */
export interface NextAction {
  label: string;
  step: Step;
  opensWallet: boolean;
}

/**
 * The map on each app: the trip's route across the three apps, this app's lane and
 * the stop the trip waits at.  That stop and the button under the map run the next
 * action if the screen offers one, and otherwise go to the app where the stop is.
 */
@Component({
  selector: 'va-trip-map',
  imports: [Marker],
  template: `
    <section class="oid-map" data-state="trip-map" [attr.data-at]="stop().id" [attr.data-here]="here()" [attr.aria-label]="m.title">
      <div class="heading-row"><h2>{{ m.title }}</h2><va-marker key="trip-map" [grey]="grey" /></div>
      <p class="oid-small">{{ m.lede }}</p>
      <div class="oid-map-grid">
        @for (lane of lanes; track lane) {
          <div class="oid-map-lane" [attr.data-app]="lane" [class.this-screen]="lane === surface()">
            <span class="oid-map-app">{{ m.apps[lane] }}</span>
            @if (lane === surface()) { <span class="oid-map-tag">{{ m.thisScreen }}</span> }
          </div>
        }
        <svg class="oid-map-route" viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden="true">
          @for (leg of legs(); track leg.d) { <path [attr.d]="leg.d" [class.done]="leg.done" /> }
        </svg>
        <ol class="oid-map-stops">
          @for (s of stops(); track s.id) {
            <li class="oid-map-stop" [attr.data-app]="s.app" [attr.data-col]="s.number" [class.done]="s.done" [class.current]="s.current" [attr.aria-current]="s.current ? 'step' : null">
              @if (s.current && cta(); as c) {
                <a class="oid-map-stop-link" [href]="c.href" [attr.target]="c.target" (click)="act($event)">
                  <span class="oid-map-dot">{{ s.number }}</span>
                  <span class="oid-map-name">{{ s.name }}</span>
                </a>
              } @else {
                <span class="oid-map-dot">{{ s.number }}</span>
                <span class="oid-map-name">{{ s.name }}</span>
              }
              @if (s.current) { <span class="oid-map-pin">{{ here() ? m.here : m.next }}</span> }
            </li>
          }
        </ol>
      </div>
      <div class="oid-map-next">
        <p class="oid-map-line oid-grow" data-state="trip-map-line">
          <span class="oid-strong">{{ here() ? m.here + '.' : m.inApp[stop().app] }}</span>
          {{ m.stops[stop().id].line }}
        </p>
        @if (cta(); as c) {
          <a class="oid-button oid-map-cta" [class.secondary]="!c.action" [href]="c.href" [attr.target]="c.target" [attr.data-action]="c.action ? 'map-next' : 'map-go'" (click)="act($event)">{{ c.label }}</a>
        }
      </div>
    </section>
  `,
})
export class TripMap implements OnInit {
  /** The app this map is on. */
  readonly surface = input.required<App>();
  /** What this screen can run next, if anything. */
  readonly next = input<NextAction | null>(null);

  private readonly trip = inject(Trip);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly m = wording.traveler.map;
  protected readonly grey = wording.lean.grey.map;
  protected readonly lanes = APPS;

  private readonly current = computed(() => stopIndex(this.trip.step()));
  protected readonly stop = computed(() => STOPS[this.current()]);
  protected readonly here = computed(() => this.stop().app === this.surface());
  protected readonly cta = computed(() => {
    const next = this.next();
    if (next) {
      const page = PAGES[next.opensWallet ? 'wallet' : this.surface()];
      return { label: next.label, action: true, href: page.href, target: next.opensWallet ? page.target : null };
    }
    if (this.here()) return null;
    const page = PAGES[this.stop().app];
    return { label: this.m.go[this.stop().app], action: false, href: page.href, target: page.target };
  });
  protected readonly legs = computed(() => legsOf(this.current()));
  protected readonly stops = computed(() =>
    STOPS.map((s, i) => ({ ...s, number: i + 1, name: this.m.stops[s.id].name, done: i < this.current(), current: i === this.current() })),
  );

  /** Runs the screen's next action.  One that opens the wallet also follows its link. */
  protected act(event: Event): void {
    const next = this.next();
    if (!next) return;
    if (!next.opensWallet) event.preventDefault();
    this.trip.go(next.step);
  }

  ngOnInit(): void {
    // Names this tab, so a link from another app comes back to it.
    if (this.isBrowser) window.name = PAGES[this.surface()].target;
  }
}
