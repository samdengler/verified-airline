import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { LeanModel } from '../lean-model';
import { Band } from './band';
import { type CheckKey, type CheckResult, decisionName, describeFinding, firstFailure, runChecks, sameAnswer } from './checks';
import { passNameLine, photoidNameLine } from './credential-card';
import { credentialOf, fill, formatTime, wording } from './data';
import { Marker } from './marker';
import { Presenter } from './presenter';
import { Trip } from './trip';

interface Row {
  key: CheckKey;
  title: string;
  when: string;
  requirements: readonly string[];
  status: 'passed' | 'failed' | 'notChecked' | 'advisory';
  statusWord: string;
  /** What the check found, or nothing. */
  found: string;
  /** The model's answer from its table, once loaded. */
  model: { text: string; same: boolean } | null;
}

/** /gate: the gate reader.  The agent sees "Board" or "Refer to agent" with one plain reason; with the Lean model, the checks that ran and the presenter's panel. */
@Component({
  selector: 'va-gate',
  imports: [Band, Marker, Presenter],
  template: `
    <div class="one-id">
      <va-one-id-band [title]="w.title" [lede]="w.lede" [crumbs]="w.crumbs" [crumbLabel]="w.title" />
      <div class="wrap oid-gate" id="content">
        <main class="oid-main">
          <p class="oid-strong" data-state="gate-status">{{ statusLine() }}</p>
          @if (!presented()) {
            <p class="oid-card oid-waiting" data-state="gate-waiting">{{ w.waiting }}</p>
          } @else {
            <div class="oid-banner" [class.board]="board()" [class.refer]="!board()" data-state="gate-result" role="status">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.75"/>
                @if (board()) {
                  <path d="M7.500 12.500l3 3 6-6.500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                } @else {
                  <path d="M12 7v6.500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.750" r="1.100" fill="currentColor"/>
                }
              </svg>
              <div class="oid-grow">
                <p class="oid-banner-word">{{ board() ? w.board : w.refer }}</p>
                <p class="oid-banner-line">{{ bannerLine() }}</p>
              </div>
              <va-marker key="decision" [grey]="lean.grey.decision" />
            </div>
            <div class="oid-names">
              @if (photoidName(); as n) { <div class="oid-card"><p class="oid-label">{{ labels.nameInPhotoid }}</p><p class="oid-name">{{ n }}</p></div> }
              @if (passName(); as n) { <div class="oid-card"><p class="oid-label">{{ labels.nameInPass }}</p><p class="oid-name">{{ n }}</p></div> }
            </div>
            <section class="oid-section" data-lean>
              <h2>{{ lean.gate.checks }}</h2>
              @for (note of missing(); track note) { <p class="oid-small">{{ note }}</p> }
              <div class="oid-card oid-list">
                @for (row of rows(); track row.key) {
                  <div class="oid-row marked" [attr.data-check]="row.key" [attr.data-status]="row.status">
                    <div class="oid-grow">
                      <p class="oid-strong">{{ row.title }}</p>
                      <p class="oid-small">{{ row.when }}</p>
                      @if (row.found) { <p class="oid-small"><code>{{ row.found }}</code></p> }
                      @if (row.model; as m) {
                        <p class="oid-small" data-model-answer [attr.data-same]="m.same">{{ lean.gate.modelAnswer }} <code>{{ m.text }}</code>, {{ m.same ? lean.gate.sameAnswer : lean.gate.otherAnswer }}</p>
                      }
                    </div>
                    <span class="badge" [class.proven]="row.status === 'passed'" [class.open]="row.status === 'failed'" [class.not-checked]="row.status === 'notChecked' || row.status === 'advisory'">{{ row.statusWord }}</span>
                    <code class="oid-id">{{ row.requirements[0] }}</code>
                    <va-marker [key]="'check-' + row.key" [requirements]="row.requirements" />
                  </div>
                }
              </div>
            </section>
            <button type="button" class="oid-link" (click)="trip.reset()">{{ t.startAgain }}</button>
          }
          <p class="oid-note">{{ t.note }}</p>
        </main>
        <va-presenter />
      </div>
    </div>
  `,
})
export class Gate {
  protected readonly trip = inject(Trip);
  private readonly leanModel = inject(LeanModel);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly t = wording.traveler;
  protected readonly w = wording.traveler.gate;
  protected readonly labels = wording.traveler.labels;
  protected readonly lean = wording.lean;

  /** The model's answers, by decision name: a display beside the computed result, loaded only with the model shown. */
  private readonly decisions = signal<Record<string, unknown> | null>(null);
  private loading = false;

  protected readonly presented = computed(() => this.trip.step() === 'presented');
  private readonly results = computed(() => runChecks(this.trip.scenario(), this.trip.settings()));
  private readonly failure = computed(() => firstFailure(this.results()));
  protected readonly board = computed(() => !this.failure());

  protected readonly statusLine = computed(() => fill(this.w.status, { flight: this.t.flight.number, time: formatTime(this.trip.scenario().checkedAt) }));
  protected readonly bannerLine = computed(() => {
    const f = this.failure();
    return f ? (this.t.reasons as Record<string, string>)[f.key] : fill(this.w.boardLine, { flight: this.t.flight.number, destination: this.t.flight.destination });
  });
  protected readonly photoidName = computed(() => {
    const m = credentialOf(this.trip.scenario(), 'photoid');
    return m ? photoidNameLine(m) : null;
  });
  protected readonly passName = computed(() => {
    const m = credentialOf(this.trip.scenario(), 'boardingPass');
    return m ? passNameLine(m) : null;
  });
  protected readonly missing = computed(() => {
    const s = this.trip.scenario();
    return (['photoid', 'boardingPass'] as const)
      .filter((role) => !credentialOf(s, role))
      .map((role) => fill(this.lean.gate.noCredential, { credential: role === 'photoid' ? this.labels.photoid : this.labels.boardingPass }));
  });

  protected readonly rows = computed<Row[]>(() => this.results().map((r) => this.row(r)));

  constructor() {
    effect(() => {
      if (this.isBrowser && this.leanModel.shown() && !this.decisions() && !this.loading) {
        this.loading = true;
        void fetch('/one-id-decisions.json')
          .then((res) => (res.ok ? res.json() : null))
          .then((table) => this.decisions.set(table))
          .catch(() => undefined);
      }
    });
  }

  private row(r: CheckResult): Row {
    const c = this.lean.checks[r.key];
    const status = this.statusOf(r);
    return {
      key: r.key,
      title: c.title,
      when: (this.lean.gate.when as Record<string, string>)[c.when],
      requirements: c.requirements,
      status,
      statusWord: this.lean.gate.status[status],
      found: Array.isArray(r.answer) ? r.answer.map(describeFinding).join(', ') : '',
      model: this.modelAnswer(r),
    };
  }

  private statusOf(r: CheckResult): Row['status'] {
    if (r.key === 'match' && r.points['MatchReading'] === 'notChecked') return 'notChecked';
    if (!r.blocks) return r.passed ? 'passed' : 'advisory';
    return r.passed ? 'passed' : 'failed';
  }

  private modelAnswer(r: CheckResult): Row['model'] {
    const table = this.decisions();
    if (!table) return null;
    const answer = table[decisionName(this.trip.scenario(), r)];
    if (answer === undefined) return null;
    const words = this.lean.gate;
    const text = Array.isArray(answer)
      ? answer.length ? answer.map(describeFinding).join(', ') : words.noFindings
      : answer ? words.yes : words.no;
    return { text, same: sameAnswer(answer, r.answer) };
  }
}
