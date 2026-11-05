import { Component, computed, inject } from '@angular/core';
import { site } from '../content';
import { CredentialCard, passNameLine, photoidNames } from './credential-card';
import { credentialOf, dataElements, fill, formatInstant, requestedItems, wording } from './data';
import { Marker } from './marker';
import { boardingPassViolations } from './rules/boarding-pass-violations';
import { consent } from './rules/consent';
import { boardingPassReading } from './rules/support/readings';
import { exampleResolution792 } from './rules/support/stand-ins';
import { Trip } from './trip';
import { LeanModel } from '../lean-model';

/** /wallet: a demo of a wallet, which in real life is a separate app from a separate party. */
@Component({
  selector: 'va-wallet',
  imports: [CredentialCard, Marker],
  template: `
    <div class="one-id">
      <main class="oid-wallet" id="content">
        <header class="oid-wallet-head">
          <div class="oid-grow">
            <h1>{{ w.title }}</h1>
            <p class="oid-small">{{ w.lede }}</p>
          </div>
          <button type="button" class="lean-toggle" [attr.aria-pressed]="lean.shown()" (click)="lean.toggle()">
            <span class="when-off">{{ t.toggle.show }}</span><span class="when-on">{{ t.toggle.hide }}</span>
          </button>
        </header>

        @if (asked()) {
          <section class="oid-sheet" data-sheet="consent">
            <h2>{{ asksLine() }}</h2>
            <p>{{ forLine }}</p>
            <div class="heading-row"><h3>{{ w.willShare }}</h3><va-marker key="consent" [grey]="grey.consent" /></div>
            <div class="oid-card oid-list">
              @for (item of sheet().shared; track item.identifier) {
                <div class="oid-row">
                  <span class="oid-grow">{{ labelOf(item.identifier) }}</span>
                  @if ('text' in item.value) {
                    <span class="oid-strong">{{ item.value.text }}</span>
                  } @else {
                    <svg class="oid-portrait small" viewBox="0 0 24 24" role="img" [attr.aria-label]="t.labels.portraitPlaceholder"><circle cx="12" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 21c1-4 4-6 7.500-6s6.500 2 7.500 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                  }
                  <code class="oid-id" data-lean>{{ item.nameSpace }} / {{ item.identifier }}</code>
                </div>
              }
            </div>
            @if (sheet().kept.length) {
              <h3>{{ w.stays }}</h3>
              <div class="oid-card oid-list">
                @for (item of sheet().kept; track item.nameSpace + item.identifier) {
                  <div class="oid-row"><code class="oid-id">{{ item.nameSpace }} / {{ item.identifier }}</code></div>
                }
              </div>
            }
            <button type="button" class="oid-button" data-action="share" (click)="trip.go('shared')">{{ shareLine() }}</button>
            <button type="button" class="oid-button secondary" data-action="decline" (click)="trip.go('declined')">{{ w.decline }}</button>
          </section>
        }

        <section class="oid-stack">
          <h2>{{ w.credentials }}</h2>
          @if (photoid(); as p) {
            <va-credential role="photoid" [mdoc]="p">
              <div class="oid-person">
                <svg class="oid-portrait" viewBox="0 0 24 24" role="img" [attr.aria-label]="t.labels.portraitPlaceholder"><circle cx="12" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 21c1-4 4-6 7.500-6s6.500 2 7.500 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                <div>
                  <p class="oid-big">{{ names().family }}</p>
                  <p class="oid-strong">{{ names().given }}</p>
                  <p class="oid-small">{{ source() }}</p>
                </div>
              </div>
            </va-credential>
          }
          @if (showPass(); as b) {
            <va-credential role="boardingPass" [mdoc]="b">
              <div class="oid-between">
                <div><p class="oid-label">{{ airline }}</p><p class="oid-big">{{ t.flight.number }}</p></div>
                @if (departs(); as d) { <div class="oid-right"><p class="oid-label">{{ t.labels.departs }}</p><p class="oid-big">{{ d }}</p></div> }
              </div>
              <p>{{ t.flight.route }}</p>
              <div><p class="oid-label">{{ t.labels.passengerOnPass }}</p><p class="oid-name">{{ passName() }}</p></div>
              <p class="oid-small">{{ t.labels.validUntil }} {{ validUntil() }}</p>
            </va-credential>
            <div class="oid-card oid-row marked" data-check="pass-on-arrival">
              <div class="oid-grow"><p class="oid-strong">{{ w.passChecked }}</p><p class="oid-small" data-state="pass-check">{{ passOk() ? w.passOk : w.passFailed }}</p></div>
              <va-marker key="pass-on-arrival" [requirements]="checks.boardingPass.requirements" />
            </div>
          }
        </section>

        @if (presented()) {
          <p class="oid-strong" data-state="presented">{{ w.presented }}</p>
          <a class="oid-button secondary" href="/gate" target="va-gate">{{ gateTitle }}</a>
        } @else if (showPass()) {
          <a class="oid-button" href="/gate" target="va-gate" data-action="present" (click)="trip.go('presented')">{{ w.present }}</a>
        }
        @if (!asked() && !showPass()) {
          <p class="oid-small" data-state="wallet-idle">{{ w.empty }}</p>
        }
        <p class="oid-note">{{ t.note }}</p>
      </main>
    </div>
  `,
})
export class Wallet {
  protected readonly trip = inject(Trip);
  protected readonly lean = inject(LeanModel);
  protected readonly t = wording.traveler;
  protected readonly w = wording.traveler.wallet;
  protected readonly grey = wording.lean.grey;
  protected readonly checks = wording.lean.checks;
  protected readonly airline = site.airline;
  protected readonly gateTitle = wording.traveler.gate.title;

  protected readonly asked = computed(() => this.trip.step() === 'asked' && !!this.photoid());
  protected readonly presented = computed(() => this.trip.step() === 'presented');
  protected readonly photoid = computed(() => credentialOf(this.trip.scenario(), 'photoid'));
  private readonly pass = computed(() => credentialOf(this.trip.scenario(), 'boardingPass'));
  protected readonly showPass = computed(() => (['passAdded', 'presented'].includes(this.trip.step()) ? this.pass() : undefined));
  protected readonly names = computed(() => photoidNames(this.photoid()!));
  protected readonly passName = computed(() => passNameLine(this.pass()!));
  protected readonly validUntil = computed(() => formatInstant(this.pass()!.validUntil));
  protected readonly departs = computed(() => {
    const j = this.trip.scenario().journey;
    return j ? formatInstant(j.scheduledDeparture).split(', ')[1] : null;
  });
  protected readonly source = computed(() => (this.trip.scenario().sourceDocument?.kind === 'passport' ? this.w.derivedFromPassport : this.w.derivedFromOther));
  protected readonly passOk = computed(() => boardingPassViolations(boardingPassReading(this.trip.settings()), exampleResolution792, this.pass()!).length === 0);

  protected readonly sheet = computed(() => consent(requestedItems, this.photoid()!));
  protected readonly asksLine = computed(() => fill(this.w.asks, { airline: this.airline, count: this.sheet().shared.length }));
  protected readonly shareLine = computed(() => fill(this.w.share, { count: this.sheet().shared.length }));
  protected readonly forLine = fill(this.w.forCheckIn, { flight: this.t.flight.number });

  protected labelOf(identifier: string): string {
    return requestedItems.find((i) => i.identifier === identifier)?.label ?? dataElements.find((e) => e.value === identifier)?.name ?? identifier;
  }
}
