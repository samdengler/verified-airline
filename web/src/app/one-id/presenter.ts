import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { presentationReadings, presentationScenarios, readings, scenarios, standInsInvented, wording } from './data';
import { affects, type Subject, isPresentation, sameTravelerOf, viewGate } from './decide';
import { Marker } from './marker';
import { Trip } from './trip';

/**
 * The presenter's panel on /gate, shown only with the Lean model.  The pickers
 * come from the two scenarios files, and each switch and its open questions from
 * the two readings files, so a scenario the model adds appears here with no code.
 * Every switch starts undecided: the site chooses nothing for the business.
 */
@Component({
  selector: 'va-presenter',
  imports: [Marker, NgTemplateOutlet],
  template: `
    <aside class="oid-presenter" data-lean data-panel="presenter">
      <header>
        <p class="oid-eyebrow">{{ w.eyebrow }}</p>
        <h2>{{ w.title }}</h2>
      </header>

      <section class="oid-stack">
        <h3>{{ w.traveler }}</h3>
        <details class="oid-group" open>
          <summary>{{ w.travelerCredentials }}</summary>
          <div class="oid-stack oid-pickers">
            @for (s of travelers; track s.id) {
              <button type="button" class="oid-choice" [attr.data-scenario]="s.id" [attr.aria-pressed]="s.id === subject().id" (click)="trip.pick(s.id)">{{ s.title }}</button>
            }
          </div>
        </details>
        <details class="oid-group" open>
          <summary>{{ w.travelerPresentations }}</summary>
          <div class="oid-stack oid-pickers">
            @for (s of presentations; track s.id) {
              <button type="button" class="oid-choice" [attr.data-scenario]="s.id" [attr.aria-pressed]="s.id === subject().id" (click)="trip.pick(s.id)">{{ s.title }}</button>
            }
          </div>
        </details>
      </section>

      <section class="oid-truth" data-state="cannot-see">
        <p class="oid-label">{{ w.cannotSee }}</p>
        <p class="oid-truth-line">{{ truth() }}</p>
        <p class="oid-small">{{ subject().example ? w.example : w.noExample }} @if (subject().example; as e) { <code>{{ e }}</code> }</p>
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
        <details class="oid-group" data-switches="credentials" [open]="!onPresentation()">
          <summary>{{ w.travelerCredentials }}</summary>
          <div class="oid-stack">
            @for (r of points; track r.id) {
              <ng-container *ngTemplateOutlet="switchRow; context: { $implicit: r }" />
            }
          </div>
        </details>
        <details class="oid-group" data-switches="presentations" [open]="onPresentation()">
          <summary>{{ w.readingsPresentations }}</summary>
          <div class="oid-stack">
            @for (r of presentationPoints; track r.id) {
              <ng-container *ngTemplateOutlet="switchRow; context: { $implicit: r }" />
            }
          </div>
        </details>
      </section>
    </aside>
    <ng-template #switchRow let-r>
          <fieldset class="oid-switch" [attr.data-reading]="r.id" [class.affects]="affecting().has(r.id)">
            <legend>{{ r.label }}</legend>
            @if (affecting().has(r.id)) { <p class="oid-affects" data-affects>{{ w.affects }}</p> }
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
    </ng-template>
  `,
})
export class Presenter {
  protected readonly trip = inject(Trip);
  protected readonly w = wording.lean.presenter;
  private readonly none = wording.lean.decision.none;
  protected readonly travelers = scenarios;
  protected readonly presentations = presentationScenarios;
  protected readonly points = readings;
  /** The presentation rules' points, leaving out the one both sets read. */
  protected readonly presentationPoints = presentationReadings.filter((p) => !readings.some((r) => r.id === p.id));
  protected readonly invented = standInsInvented;
  protected readonly subject = this.trip.subject;
  protected readonly onPresentation = computed(() => isPresentation(this.subject()));
  protected readonly decisions = this.trip.decisions;

  protected readonly trail = computed(() => {
    const d = this.decisions();
    return [...this.points, ...this.presentationPoints]
      .filter((r) => d[r.id] !== undefined)
      .map((r) => ({ id: r.id, label: r.label, chosen: d[r.id] === null ? this.none : r.settings.find((s) => s.value === d[r.id])?.label ?? '' }));
  });

  /** The reader cannot see who each credential is about.  The issuer knows, and the scenarios record it. */
  protected readonly truth = computed(() => {
    const s: Subject = this.subject();
    const same = sameTravelerOf(s);
    if (same === null) return isPresentation(s) ? this.w.notAPair : this.w.single;
    const outcome = viewGate(s, this.decisions()).outcome;
    if (outcome === 'depends') return same ? this.w.dependsSame : this.w.dependsDifferent;
    if (outcome === 'board') return same ? this.w.acceptedSame : this.w.acceptedDifferent;
    return same ? this.w.refusedSame : this.w.refusedDifferent;
  });

  /** The points whose setting changes the gate's answer for this subject. */
  protected readonly affecting = computed(() => {
    const s = this.subject();
    const d = this.decisions();
    return new Set([...this.points, ...this.presentationPoints].filter((r) => affects(s, r, d)).map((r) => r.id));
  });
}
