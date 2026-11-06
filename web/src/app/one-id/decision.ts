import { Component, computed, inject, input } from '@angular/core';
import { consequences, type GateView, viewGate } from './decide';
import { allReadings, fill, wording } from './data';
import { Marker } from './marker';
import type { Setting } from './rules/support/readings';
import { Trip } from './trip';

/**
 * One point the trip stops at: its open questions, each setting with what it
 * leads to, and what each setting does to the travelers it changes.  Choosing
 * records the decision in every tab; "none of these" keeps the trip stopped.
 */
@Component({
  selector: 'va-decision',
  imports: [Marker],
  template: `
    @if (reading(); as r) {
      <section class="oid-decision" data-lean [attr.data-decision]="r.id">
        <div class="marked oid-question-row">
          <div class="oid-grow">
            <h3 class="oid-decision-label">{{ r.label }}</h3>
            @for (q of r.questions; track q.theorem) { <p class="oid-decision-question">{{ q.question }}</p> }
          </div>
          <va-marker [key]="'decision-' + r.id" [criteria]="r.criteria" />
        </div>
        @if (leftOpen()) { <p class="oid-affects" data-state="left-open">{{ w.leftOpen }}</p> }
        <p class="oid-label">{{ w.choose }}</p>
        <div class="oid-settings">
          @for (s of r.settings; track s.value) {
            <button type="button" class="oid-choice small" [attr.data-option]="s.value" (click)="trip.set(r.id, s.value)">
              {{ s.label }}
              @if (r.asWritten === s.value) { <span class="oid-tag">{{ presenter.asWritten }}</span> }
              <span class="oid-preview" [attr.data-preview]="s.value">{{ preview(s.value) }}</span>
            </button>
          }
          <button type="button" class="oid-choice small" data-option-none (click)="trip.set(r.id, null)">
            {{ w.none }}
            <span class="oid-tag">{{ w.noneNote }}</span>
          </button>
        </div>

        <h4>{{ w.consequences }}</h4>
        <div class="table-wrap" tabindex="0" role="region" [attr.aria-label]="w.consequences">
          <table class="oid-consequences">
            <thead>
              <tr>
                <th scope="col">{{ w.travelerColumn }}</th>
                <th scope="col">{{ w.aboutColumn }}</th>
                @for (s of r.settings; track s.value) { <th scope="col">{{ s.label }}</th> }
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.scenario.id) {
                <tr [attr.data-consequence]="row.scenario.id">
                  <th scope="row">{{ row.scenario.title }}</th>
                  <td>{{ row.sameTraveler === null ? w.oneCredential : row.sameTraveler ? w.oneTraveler : w.twoTravelers }}</td>
                  @for (c of row.cells; track c.value) {
                    <td [class.oid-wrong]="c.wrong" [attr.data-wrong]="c.wrong">{{ word(c.view) }}@if (c.wrong) { <span class="oid-tag">{{ w.wrong }}</span> }</td>
                  }
                </tr>
              }
            </tbody>
            @if (wrongCounts(); as counts) {
              <tfoot>
                <tr>
                  <td colspan="2"></td>
                  @for (line of counts; track $index) { <td class="oid-small" data-wrong-count>{{ line }}</td> }
                </tr>
              </tfoot>
            }
          </table>
        </div>
        <p class="oid-small">{{ w.consequencesNote }}</p>

        @if (considerations(); as list) {
          <h4>{{ w.considerTitle }}</h4>
          <ul class="oid-considerations">
            @for (item of list; track item) { <li>{{ item }}</li> }
          </ul>
        }
      </section>
    }
  `,
})
export class Decision {
  readonly point = input.required<string>();

  protected readonly trip = inject(Trip);
  protected readonly w = wording.lean.decision;
  protected readonly presenter = wording.lean.presenter;

  protected readonly reading = computed(() => allReadings.find((r) => r.id === this.point()));
  protected readonly leftOpen = computed(() => this.trip.decisions()[this.point()] === null);
  protected readonly rows = computed(() => consequences(this.reading()!, this.trip.decisions()));
  protected readonly considerations = computed(() => (this.w.considerations as Record<string, string[]>)[this.point()]);

  /** For each setting, how many travelers holding both credentials it gets wrong, when any of these rows hold both. */
  protected readonly wrongCounts = computed(() => {
    const pairs = this.rows().filter((row) => row.sameTraveler !== null);
    if (pairs.length < 2) return null;
    return this.reading()!.settings.map((_, i) => fill(this.w.wrongCount, { wrong: pairs.filter((row) => row.cells[i].wrong).length, total: pairs.length }));
  });

  protected word(view: GateView): string {
    const p = this.w.preview;
    if (view.outcome === 'depends') return p.depends;
    if (view.kind !== 'pair') return view.outcome === 'board' ? p.accepted : p.refused;
    return view.outcome === 'board' ? p.board : p.refer;
  }

  /** What a setting leads to for the traveler at the gate. */
  protected preview(value: Setting): string {
    return this.word(viewGate(this.trip.subject(), { ...this.trip.decisions(), [this.point()]: value }));
  }
}
