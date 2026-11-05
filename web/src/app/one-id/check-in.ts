import { Component, computed, inject } from '@angular/core';
import { Band } from './band';
import { CredentialCard, passNameLine, photoidNames } from './credential-card';
import { credentialOf, fill, formatInstant, requestedItems, titleCase, wording } from './data';
import { viewChecks } from './decide';
import { Marker } from './marker';
import { Trip } from './trip';

/** /check-in: the airline's website.  It asks the wallet for three items, checks the photoid, and issues the boarding pass. */
@Component({
  selector: 'va-check-in',
  imports: [Band, CredentialCard, Marker],
  // The same events as the policy pages, so Angular writes the same inline script and the live policy's hash allows it.
  host: { '(submit)': '$event.preventDefault()' },
  template: `
    <div class="one-id">
      <va-one-id-band [title]="title()" [lede]="lede()" [crumbs]="w.crumbs" [crumbLabel]="flight.number" />
      <main class="wrap oid-columns" id="content">
        <div class="oid-main">
          @if (!done()) {
            <section class="oid-section">
              <h2>{{ w.trip }}</h2>
              <dl class="oid-facts oid-card">
                <div><dt>{{ labels.flight }}</dt><dd class="oid-strong">{{ flight.number }}</dd><dd>{{ flight.route }}</dd></div>
                @if (departure(); as d) { <div><dt>{{ labels.scheduledDeparture }}</dt><dd class="oid-strong">{{ d }}</dd></div> }
                <div><dt>{{ labels.passenger }}</dt><dd class="oid-strong">{{ passenger() }}</dd></div>
              </dl>
            </section>
            <section class="oid-section">
              <div class="heading-row"><h2>{{ w.asks }}</h2><va-marker key="request" [grey]="lean.grey.request" /></div>
              <div class="oid-card oid-list">
                @for (item of items; track item.identifier) {
                  <div class="oid-row">
                    <span class="oid-strong">{{ item.label }}</span>
                    <code class="oid-id" data-lean>{{ item.nameSpace }} / {{ item.identifier }}</code>
                  </div>
                }
              </div>
              <div class="marked" data-lean>
                <p class="oid-small">{{ fromDocType() }}</p>
                <va-marker key="items" [requirements]="lean.checkIn.itemsMarker.requirements" />
              </div>
            </section>
          } @else {
            <section class="oid-section">
              <h2>{{ w.checked }}</h2>
              <div class="oid-card oid-list">
                <div class="oid-row marked" data-check="photoid">
                  <span class="oid-strong oid-grow">{{ photoidLine() }}</span>
                  <code class="oid-id" data-lean>{{ checks.photoid.requirements[0] }}</code>
                  <va-marker key="photoid" [requirements]="checks.photoid.requirements" />
                </div>
                <div class="oid-row marked" data-check="source">
                  <span class="oid-strong oid-grow">{{ fromPassport() ? w.sourcePassport : w.sourceOther }}</span>
                  <code class="oid-id" data-lean>{{ checks.source.requirements[0] }}</code>
                  <va-marker key="source" [requirements]="checks.source.requirements" />
                </div>
                <div class="oid-row marked" data-lean data-check="advisories">
                  <span class="oid-grow"><span class="oid-strong">{{ advisoriesLine() }}</span><br><span class="oid-small">{{ lean.checkIn.advisoriesNote }}</span></span>
                  <code class="oid-id">{{ checks.advisories.requirements[0] }}</code>
                  <va-marker key="advisories" [requirements]="checks.advisories.requirements" />
                </div>
              </div>
              <p class="oid-small">{{ w.received }}</p>
              <p class="oid-small" data-lean>{{ lean.checkIn.standIns }}</p>
            </section>
          }
        </div>
        <aside class="oid-side">
          @if (!done()) {
            <section class="oid-card oid-stack">
              <h2>{{ w.present }}</h2>
              @if (!photoid()) {
                <p>{{ w.noPhotoid }}</p>
              } @else if (trip.step() === 'asked') {
                <p class="oid-strong" data-state="waiting">{{ w.waiting }}</p>
                <p class="oid-small">{{ w.waitingNote }}</p>
              } @else {
                @if (trip.step() === 'declined') { <p data-state="declined">{{ w.declined }}</p> }
                <a class="oid-button" href="/wallet" target="va-wallet" data-action="open-wallet" (click)="ask()">{{ w.open }}</a>
                <p class="oid-small">{{ w.openNote }}</p>
              }
              <p class="oid-small">{{ w.noWallet }}</p>
            </section>
          } @else if (pass(); as p) {
            <va-credential role="boardingPass" [mdoc]="p">
              <div class="oid-between">
                <div><p class="oid-label">{{ labels.flight }}</p><p class="oid-big">{{ flight.number }}</p></div>
                @if (departureTime(); as t) { <div class="oid-right"><p class="oid-label">{{ labels.departs }}</p><p class="oid-big">{{ t }}</p></div> }
              </div>
              <div><p class="oid-label">{{ labels.passengerOnPass }}</p><p class="oid-name">{{ passName() }}</p></div>
              <div class="marked">
                <div class="oid-grow"><p class="oid-label">{{ labels.validUntil }}</p><p class="oid-strong">{{ validUntil() }}</p></div>
                <va-marker key="pass-validity" [requirements]="checks.passValidity.requirements" />
              </div>
              <p class="oid-small" data-lean>{{ lean.deciding.validity.text }}</p>
              @if (accepted()) {
                @if (added()) {
                  <p class="oid-strong" data-state="added">{{ w.added }}</p>
                  <a class="oid-link" href="/wallet" target="va-wallet">{{ w.openWallet }}</a>
                } @else {
                  <button type="button" class="oid-button" data-action="add-pass" (click)="add()">{{ w.add }}</button>
                }
              }
            </va-credential>
            <button type="button" class="oid-link" (click)="trip.reset()">{{ t.startAgain }}</button>
          } @else {
            <section class="oid-card oid-stack">
              <p>{{ w.noPass }}</p>
              <button type="button" class="oid-link" (click)="trip.reset()">{{ t.startAgain }}</button>
            </section>
          }
        </aside>
      </main>
      <div class="wrap"><p class="oid-note">{{ t.note }}</p></div>
    </div>
  `,
})
export class CheckIn {
  protected readonly trip = inject(Trip);
  protected readonly t = wording.traveler;
  protected readonly w = wording.traveler.checkIn;
  protected readonly labels = wording.traveler.labels;
  protected readonly flight = wording.traveler.flight;
  protected readonly lean = wording.lean;
  protected readonly checks = wording.lean.checks;
  protected readonly items = requestedItems;

  protected readonly photoid = computed(() => credentialOf(this.trip.scenario(), 'photoid'));
  protected readonly pass = computed(() => credentialOf(this.trip.scenario(), 'boardingPass'));
  protected readonly checksFor = computed(() => viewChecks(this.trip.scenario(), this.trip.decisions()));
  private readonly check = (key: string) => this.checksFor().find((c) => c.result.key === key);

  /** The website has the wallet's answer once the holder has shared, and stays past that. */
  protected readonly done = computed(() => ['shared', 'passAdded', 'presented'].includes(this.trip.step()) && !!this.photoid());
  protected readonly added = computed(() => ['passAdded', 'presented'].includes(this.trip.step()));
  protected readonly photoidLine = computed(() => {
    const state = this.check('photoid')?.state;
    return state === 'depends' ? this.lean.decision.needs : state === 'passed' ? this.w.photoidOk : this.w.photoidFailed;
  });
  protected readonly fromPassport = computed(() => this.trip.scenario().sourceDocument?.kind === 'passport');
  private readonly issueChecks = computed(() => this.checksFor().filter((c) => ['photoid', 'source', 'passValidity'].includes(c.result.key)));
  private readonly issueFailure = computed(() => this.issueChecks().find((c) => c.state === 'failed'));
  private readonly issueDepends = computed(() => this.issueChecks().some((c) => c.state === 'depends'));
  protected readonly accepted = computed(() => !this.issueFailure() && !this.issueDepends());

  protected readonly title = computed(() => {
    if (!this.done()) return this.w.title;
    if (this.issueFailure()) return this.w.refusedTitle;
    if (this.issueDepends()) return this.lean.decision.checkInTitle;
    return fill(this.w.doneTitle, { name: titleCase(photoidNames(this.photoid()!).given ?? '') });
  });
  protected readonly lede = computed(() => {
    if (!this.done()) return this.w.lede;
    const failure = this.issueFailure();
    if (failure) return fill(this.w.refusedLede, { reason: (this.t.reasons as Record<string, string>)[failure.result.key] });
    return this.issueDepends() ? this.lean.decision.checkInLede : this.w.doneLede;
  });

  protected readonly departure = computed(() => {
    const j = this.trip.scenario().journey;
    return j ? formatInstant(j.scheduledDeparture) : null;
  });
  protected readonly departureTime = computed(() => {
    const j = this.trip.scenario().journey;
    return j ? formatInstant(j.scheduledDeparture).split(', ')[1] : null;
  });
  protected readonly passenger = computed(() => {
    const p = this.photoid();
    if (p) {
      const { given, family } = photoidNames(p);
      return [given, family].filter(Boolean).join(' ');
    }
    const b = this.pass();
    return b ? passNameLine(b) : '';
  });
  protected readonly passName = computed(() => passNameLine(this.pass()!));
  protected readonly validUntil = computed(() => formatInstant(this.pass()!.validUntil));
  protected readonly fromDocType = computed(() => fill(this.lean.checkIn.fromDocType, { docType: this.photoid()?.docType ?? '' }));
  protected readonly advisoriesLine = computed(() => {
    const answer = this.check('advisories')?.result.answer;
    return fill(this.lean.checkIn.advisories, { count: Array.isArray(answer) ? answer.length : 0 });
  });

  protected ask(): void {
    this.trip.go('asked');
  }

  protected add(): void {
    this.trip.go('passAdded');
  }
}
