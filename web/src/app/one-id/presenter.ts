import { Component, computed, inject } from '@angular/core';
import { credentialOf, type Reading, readings, scenarios, standInsInvented, wording } from './data';
import { viewGate } from './decide';
import { Marker } from './marker';
import { Trip } from './trip';

/**
 * The presenter's panel on /gate, shown only with the Lean model.  The traveler
 * picker comes from scenarios.json, and each switch and its open questions from
 * readings.json, so a scenario the model adds appears here with no code.  Every
 * switch starts undecided: the site chooses nothing for the business.
 */
@Component({
  selector: 'va-presenter',
  imports: [Marker],
  template: `
    <aside class="oid-presenter" data-lean data-panel="presenter">
      <header>
        <p class="oid-eyebrow">{{ w.eyebrow }}</p>
        <h2>{{ w.title }}</h2>
      </header>

      <section class="oid-stack">
        <h3>{{ w.traveler }}</h3>
        @for (s of travelers; track s.id) {
          <button type="button" class="oid-choice" [attr.data-scenario]="s.id" [attr.aria-pressed]="s.id === scenario().id" (click)="trip.pick(s.id)">{{ s.title }}</button>
        }
      </section>

      <section class="oid-truth" data-state="cannot-see">
        <p class="oid-label">{{ w.cannotSee }}</p>
        <p class="oid-truth-line">{{ truth() }}</p>
        <p class="oid-small">{{ scenario().example ? w.example : w.noExample }} @if (scenario().example; as e) { <code>{{ e }}</code> }</p>
      </section>

      <section class="oid-stack" data-state="trail">
        <h3>{{ w.trail }}</h3>
        @if (trail().length) {
          <ul class="oid-trail">
            @for (entry of trail(); track entry.id) {
              <li [attr.data-trail]="entry.id">
                <span class="oid-grow"><span class="oid-strong">{{ entry.label }}</span><br><span class="oid-small">{{ entry.chosen }}</span></span>
                <button type="button" class="oid-link" (click)="trip.undo(entry.id)">{{ w.undo }}</button>
              </li>
            }
          </ul>
          <button type="button" class="oid-link" data-action="clear-decisions" (click)="trip.clearDecisions()">{{ w.clear }}</button>
        } @else {
          <p class="oid-small">{{ w.noTrail }}</p>
        }
      </section>

      <section class="oid-stack">
        <h3>{{ w.readings }}</h3>
        <p class="oid-small">{{ w.startNote }}</p>
        @if (invented) { <p class="oid-small">{{ w.standIns }}</p> }
        @for (r of points; track r.id) {
          <fieldset class="oid-switch" [attr.data-reading]="r.id" [class.affects]="affects(r)">
            <legend>{{ r.label }}</legend>
            @if (affects(r)) { <p class="oid-affects" data-affects>{{ w.affects }}</p> }
            <div class="oid-settings">
              @for (s of r.settings; track s.value) {
                <button type="button" class="oid-choice small" [attr.data-setting]="s.value" [attr.aria-pressed]="decisions()[r.id] === s.value" (click)="trip.set(r.id, s.value)">
                  {{ s.label }}
                  @if (r.asWritten === s.value) { <span class="oid-tag">{{ w.asWritten }}</span> }
                </button>
              }
              <button type="button" class="oid-choice small" data-undecided [attr.aria-pressed]="decisions()[r.id] === undefined || decisions()[r.id] === null" (click)="trip.undo(r.id)">{{ w.undecided }}</button>
            </div>
            <div class="marked oid-question-row">
              <div class="oid-grow">
                @for (q of r.questions; track q.theorem) { <p class="oid-question" [attr.data-question]="q.theorem">{{ q.question }}</p> }
              </div>
              <va-marker [key]="'reading-' + r.id" [criteria]="r.criteria" />
            </div>
          </fieldset>
        }
      </section>
    </aside>
  `,
})
export class Presenter {
  protected readonly trip = inject(Trip);
  protected readonly w = wording.lean.presenter;
  private readonly none = wording.lean.decision.none;
  protected readonly travelers = scenarios;
  protected readonly points = readings;
  protected readonly invented = standInsInvented;
  protected readonly scenario = this.trip.scenario;
  protected readonly decisions = this.trip.decisions;

  protected readonly trail = computed(() => {
    const d = this.decisions();
    return readings
      .filter((r) => d[r.id] !== undefined)
      .map((r) => ({ id: r.id, label: r.label, chosen: d[r.id] === null ? this.none : r.settings.find((s) => s.value === d[r.id])?.label ?? '' }));
  });

  /** The reader cannot see who each credential is about.  The issuer knows, and the scenarios record it. */
  protected readonly truth = computed(() => {
    const s = this.scenario();
    const about = (role: 'photoid' | 'boardingPass') => s.credentials.find((c) => c.role === role)?.about;
    if (!credentialOf(s, 'photoid') || !credentialOf(s, 'boardingPass')) return this.w.single;
    const same = about('photoid') === about('boardingPass');
    const outcome = viewGate(s, this.decisions()).outcome;
    if (outcome === 'depends') return same ? this.w.dependsSame : this.w.dependsDifferent;
    if (outcome === 'board') return same ? this.w.acceptedSame : this.w.acceptedDifferent;
    return same ? this.w.refusedSame : this.w.refusedDifferent;
  });

  /** Whether a setting of this point changes the gate's answer for this traveler. */
  protected affects(r: Reading): boolean {
    const s = this.scenario();
    const d = this.decisions();
    return new Set(r.settings.map((option) => viewGate(s, { ...d, [r.id]: option.value }).outcome)).size > 1;
  }
}
