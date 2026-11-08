import { Component, computed, inject } from '@angular/core';
import { site } from '../content';
import { CredentialCard, passNameLine, photoidNames } from './credential-card';
import { credentialOf, dataElements, fill, formatInstant, itemLabels, type PresentationScenario, wording } from './data';
import { viewChecks } from './decide';
import { LeanToggle } from './lean-toggle';
import { Marker } from './marker';
import { checkInPresentation, gatePresentation } from './presentation-checks';
import { Relay, joinFromLink } from './relay';
import { latest, Signatures } from './signatures';
import { hasRef, mdocRefs, type WalletResponse } from './rules/support/exchange';
import { bcbpStringId } from './rules/support/identifiers';
import { PASS_HELD, Trip } from './trip';
import { TripMap } from './trip-map';

/** A consent sheet: what the request in front of the holder asks, and what the wallet would send. */
interface Sheet {
  forGate: boolean;
  /** The request came from another device, through the relay, and the answer goes back there. */
  relayed: boolean;
  items: { nameSpace: string; identifier: string; label: string; text: string | null }[];
  kept: string[];
  asks: string;
  why: string;
  share: string;
  response: WalletResponse;
  requestState: string;
  requestWord: string;
}

/**
 * /wallet: a demo of a wallet, which in real life is a separate app from a separate
 * party.  Opened from a code's link, /wallet?session=<id>, it answers a request from
 * another device through the relay, with the same consent sheet.
 */
@Component({
  selector: 'va-wallet',
  imports: [CredentialCard, LeanToggle, Marker, TripMap],
  // The same events as the policy pages, so Angular writes the same inline script and the live policy's hash allows it.
  host: { '(submit)': '$event.preventDefault()' },
  template: `
    <div class="one-id surface-wallet">
      <main class="oid-wallet" id="content">
        <header class="oid-wallet-head">
          <div class="oid-grow">
            <h1>{{ w.title }}</h1>
            <p class="oid-small">{{ w.lede }}</p>
          </div>
          <va-lean-toggle />
        </header>

        <va-trip-map surface="wallet" />

        @if (relay.joined(); as j) {
          <section class="oid-card oid-stack oid-relay" data-panel="relay-wallet" [attr.data-state]="j.state" [attr.data-for]="j.request?.for">
            <div class="heading-row"><h2>{{ rw.title }}</h2><va-marker key="relay-wallet" [grey]="relayGrey" /></div>
            <p>{{ relayLine() }}</p>
          </section>
        }

        @if (sheet(); as s) {
          <section class="oid-sheet" data-sheet="consent" [attr.data-for]="s.forGate ? 'gate' : 'check-in'" [attr.data-relayed]="s.relayed">
            <h2>{{ s.asks }}</h2>
            <p>{{ s.why }}</p>
            <div class="oid-row marked oid-plain" data-lean data-check="walletFindings" [attr.data-status]="s.requestState">
              <span class="oid-grow oid-small">{{ leanWords.wallet.requestChecked }}</span>
              <span class="badge" [class.proven]="s.requestState === 'passed'" [class.open]="s.requestState !== 'passed'">{{ s.requestWord }}</span>
              <va-marker key="wallet-findings" [requirements]="checks.walletFindings.requirements" />
            </div>
            <div class="heading-row"><h3>{{ w.willShare }}</h3><va-marker key="consent" [requirements]="leanWords.wallet.consentMarker.requirements" /></div>
            @if (s.items.length) {
              <div class="oid-card oid-list">
                @for (item of s.items; track item.identifier) {
                  <div class="oid-row">
                    <span class="oid-grow">{{ item.label }}</span>
                    @if (item.text !== null) {
                      <span class="oid-strong">{{ item.text }}</span>
                    } @else {
                      <svg class="oid-portrait small" viewBox="0 0 24 24" role="img" [attr.aria-label]="t.labels.portraitPlaceholder"><circle cx="12" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 21c1-4 4-6 7.500-6s6.500 2 7.500 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    }
                    <code class="oid-id" data-lean>{{ item.nameSpace }} / {{ item.identifier }}</code>
                  </div>
                }
              </div>
            } @else {
              <p>{{ w.nothingToShare }}</p>
            }
            @if (s.kept.length) {
              <h3>{{ w.stays }}</h3>
              <div class="oid-card oid-list">
                @for (item of s.kept; track item) {
                  <div class="oid-row"><code class="oid-id">{{ item }}</code></div>
                }
              </div>
            }
            @if (s.items.length) {
              @if (s.forGate && !s.relayed) {
                <a class="oid-button" href="/gate" target="va-gate" data-action="share-gate" (click)="trip.act('shareGate')">{{ s.share }}</a>
              } @else {
                <button type="button" class="oid-button" [attr.data-action]="s.forGate ? 'share-gate' : 'share'" (click)="share(s)">{{ s.share }}</button>
              }
            }
            <button type="button" class="oid-button secondary" data-action="decline" (click)="decline(s)">{{ w.decline }}</button>
          </section>
        }

        @if (trip.step() === 'gateDeclined') { <p data-state="gate-declined">{{ w.gateDeclined }}</p> }
        @if (presented()) {
          <p class="oid-strong" data-state="presented">{{ w.presented }}</p>
          <a class="oid-button secondary" href="/gate" target="va-gate">{{ gateTitle }}</a>
        } @else if (showPass() && !sheet()) {
          <button type="button" class="oid-button" data-action="present" (click)="trip.act('present')">{{ w.present }}</button>
        }

        <section class="oid-stack">
          <h2>{{ w.credentials }}</h2>
          @if (photoid(); as p) {
            <va-credential role="photoid" [mdoc]="p" [issuer]="issuers().photoid" [signature]="photoidSignature()">
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
            <va-credential role="boardingPass" [mdoc]="b" [issuer]="issuers().boardingPass" [signature]="passSignature()">
              <div class="oid-between">
                <div><p class="oid-label">{{ airline }}</p><p class="oid-big">{{ t.flight.number }}</p></div>
                @if (departs(); as d) { <div class="oid-right"><p class="oid-label">{{ t.labels.departs }}</p><p class="oid-big">{{ d }}</p></div> }
              </div>
              <p>{{ t.flight.route }}</p>
              <div><p class="oid-label">{{ t.labels.passengerOnPass }}</p><p class="oid-name">{{ passName() }}</p></div>
              <p class="oid-small">{{ t.labels.validUntil }} {{ validUntil() }}</p>
            </va-credential>
            <div class="oid-card oid-row marked" data-check="pass-on-arrival">
              <div class="oid-grow"><p class="oid-strong">{{ w.passChecked }}</p><p class="oid-small" data-state="pass-check">{{ passLine() }}</p></div>
              <va-marker key="pass-on-arrival" [requirements]="checks.boardingPass.requirements" />
            </div>
          }
        </section>

        @if (!sheet() && !showPass()) {
          <p class="oid-small" data-state="wallet-idle">{{ w.empty }}</p>
        }
        <p class="oid-note">{{ w.note }}</p>
      </main>
    </div>
  `,
})
export class Wallet {
  protected readonly trip = inject(Trip);
  protected readonly relay = inject(Relay);
  private readonly signatures = inject(Signatures);
  protected readonly t = wording.traveler;
  protected readonly w = wording.traveler.wallet;
  protected readonly rw = wording.traveler.relay.wallet;
  protected readonly relayGrey = wording.lean.relay.grey;
  protected readonly leanWords = wording.lean;
  protected readonly checks = wording.lean.checks;
  protected readonly airline = site.airline;
  protected readonly gateTitle = wording.traveler.gate.title;

  protected readonly presented = computed(() => this.trip.step() === 'presented');
  protected readonly photoid = computed(() => credentialOf(this.trip.scenario(), 'photoid'));
  private readonly pass = computed(() => credentialOf(this.trip.scenario(), 'boardingPass'));
  protected readonly showPass = computed(() => (PASS_HELD.includes(this.trip.step()) ? this.pass() : undefined));
  protected readonly names = computed(() => photoidNames(this.photoid()!));
  protected readonly passName = computed(() => passNameLine(this.pass()!));
  protected readonly validUntil = computed(() => formatInstant(this.pass()!.validUntil));
  protected readonly departs = computed(() => {
    const j = this.trip.scenario().journey;
    return j ? formatInstant(j.scheduledDeparture).split(', ')[1] : null;
  });
  protected readonly source = computed(() => (this.trip.scenario().sourceDocument?.kind === 'passport' ? this.w.derivedFromPassport : this.w.derivedFromOther));
  protected readonly passLine = computed(() => {
    const state = viewChecks(this.trip.scenario(), this.trip.decisions()).find((c) => c.result.key === 'boardingPass')?.state;
    return state === 'depends' ? wording.lean.decision.walletDepends : state === 'passed' ? this.w.passOk : this.w.passFailed;
  });
  /** Each credential's signature, checked by the wallet when it holds it. */
  protected readonly photoidSignature = latest(
    () => (this.photoid() ? { scenario: this.trip.scenario() } : undefined),
    ({ scenario }) => this.signatures.checkHeld(scenario, 'photoid'),
  );
  protected readonly passSignature = latest(
    () => (this.showPass() ? { scenario: this.trip.scenario() } : undefined),
    ({ scenario }) => this.signatures.checkHeld(scenario, 'boardingPass'),
  );
  /** Who issued each credential, from the default presentation. */
  protected readonly issuers = computed(() => {
    const held = gatePresentation(this.trip.scenario()).held;
    const of = (m: { docType: string } | undefined) => held.find((h) => h.mdoc.docType === m?.docType)?.issuer.name ?? null;
    return { photoid: of(this.photoid()), boardingPass: of(this.pass()) };
  });

  /** What the wallet says about a request from another device. */
  protected readonly relayLine = computed(() => {
    const j = this.relay.joined();
    if (!j) return '';
    const gate = j.request?.for === 'gate';
    switch (j.state) {
      case 'open': return gate ? this.rw.openGate : fill(this.rw.openCheckIn, { airline: this.airline });
      case 'sent': return gate ? this.rw.sentGate : this.rw.sentCheckIn;
      case 'unconfigured': return wording.traveler.relay.notConfigured;
      default: return this.rw[j.state];
    }
  });

  /**
   * The sheet for the request in front of the holder.  Its lists are what the model's
   * Wallet.respond would send if they agree.  A request from another device is the
   * one the wallet received, and its checks run on it.
   */
  protected readonly sheet = computed<Sheet | null>(() => {
    const step = this.trip.step();
    if ((step !== 'asked' || !this.photoid()) && step !== 'gateAsked') return null;
    const forGate = step === 'gateAsked';
    const joined = this.relay.joined();
    const received = joined?.state === 'open' && joined.request?.for === (forGate ? 'gate' : 'check-in') ? joined.request : null;
    const presentation = forGate
      ? gatePresentation(this.trip.scenario(), received ? { seen: received.request } : {})
      : checkInPresentation(this.trip.scenario(), received ? { seen: received.request, authorization: received.authorization } : {});
    const items = this.itemsOf(presentation);
    const heldRefs = presentation.held.flatMap((h) => mdocRefs(h.mdoc));
    const sharedRefs = presentation.response!.documents.flatMap((d) => mdocRefs(d.mdoc));
    const request = viewChecks(presentation, this.trip.decisions()).find((c) => c.result.key === 'walletFindings');
    const requestState = request?.state ?? 'passed';
    return {
      forGate,
      relayed: !!received,
      items,
      kept: heldRefs.filter((r) => !hasRef(sharedRefs, r)).map((r) => `${r.nameSpace} / ${r.identifier}`),
      asks: forGate ? fill(this.w.asksGate, { count: items.length }) : fill(this.w.asks, { airline: this.airline, count: items.length }),
      why: fill(forGate ? this.w.forGate : this.w.forCheckIn, { flight: this.t.flight.number }),
      share: fill(this.w.share, { count: items.length }),
      response: presentation.response!,
      requestState,
      requestWord: wording.lean.gate.status[requestState === 'depends' ? 'decide' : requestState],
    };
  });

  constructor() {
    joinFromLink();
  }

  /** Share, by the trip's step; a request from another device gets the wallet's response back, with the signed credentials. */
  protected share(s: Sheet): void {
    const scenario = this.trip.scenario();
    this.trip.act(s.forGate ? 'shareGate' : 'share');
    if (s.relayed) {
      void this.signatures
        .present(scenario, s.response)
        .catch(() => s.response.documents.map(() => null))
        .then((credentials) => this.relay.answer('shared', s.response, credentials));
    }
  }

  /** Decline, which sends no credential; the other device only learns of the decline. */
  protected decline(s: Sheet): void {
    this.trip.act(s.forGate ? 'declineGate' : 'decline');
    if (s.relayed) void this.relay.answer('declined', null);
  }

  private itemsOf(p: PresentationScenario) {
    return p.response!.documents.flatMap((d) =>
      d.mdoc.nameSpaces.flatMap((ns) =>
        ns.elements.map((e) => ({
          nameSpace: ns.name,
          identifier: e.identifier,
          label: itemLabels.find((i) => i.identifier === e.identifier)?.label ?? dataElements.find((x) => x.value === e.identifier)?.name ?? e.identifier,
          text: e.identifier === bcbpStringId ? passNameLine(d.mdoc) : 'text' in e.value ? e.value.text : null,
        })),
      ),
    );
  }
}
