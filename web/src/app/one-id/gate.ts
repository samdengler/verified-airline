import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { Brand } from '../brand';
import { LeanModel } from '../lean-model';
import { type CheckKey, decisionName, describeFinding, sameAnswer } from './checks';
import { passNameLine, photoidNameLine } from './credential-card';
import { fill, formatTime, wording } from './data';
import { type CheckView, isPresentation, mdocOf, type Subject, viewGate } from './decide';
import { Decision } from './decision';
import { LeanToggle } from './lean-toggle';
import { Marker } from './marker';
import { ModelLegend } from './model-legend';
import { gatePresentation } from './presentation-checks';
import { Presenter } from './presenter';
import { Trip, startFromTourLink } from './trip';
import { TripMap } from './trip-map';
import { gateShows } from './trip-steps';

interface Row {
  key: CheckKey;
  title: string;
  when: string;
  requirements: readonly string[];
  status: 'passed' | 'failed' | 'notChecked' | 'advisory' | 'decide';
  statusWord: string;
  /** What the check found, or nothing. */
  found: string;
  /** The model's answer from its table, once loaded. */
  model: { text: string; same: boolean } | null;
}

/**
 * /gate: the gate reader.  The agent sees "Board" or "Refer to agent" with one
 * plain reason.  With the Lean model, a trip that rests on an undecided point
 * stops here until it is decided, a traveler holding one credential gets a result
 * for that credential alone, and the checks that ran and the presenter's panel show.
 */
@Component({
  selector: 'va-gate',
  imports: [Brand, Decision, LeanToggle, Marker, ModelLegend, Presenter, TripMap],
  // The same events as the policy pages, so Angular writes the same inline script and the live policy's hash allows it.
  host: { '(submit)': '$event.preventDefault()' },
  template: `
    <div class="one-id surface-gate">
      <header class="gate-bar"><div class="wrap">
        <va-brand />
        <h1>{{ w.title }}</h1>
        <p class="gate-status" data-state="gate-status">{{ statusLine() }}</p>
        <va-lean-toggle />
      </div></header>
      <va-model-legend />
      <div class="oid-map-band"><div class="wrap"><va-trip-map surface="gate" /></div></div>
      <div class="wrap oid-gate" id="content">
        <main class="oid-main">
          @if (shows() === 'waiting') {
            <p class="oid-card oid-waiting" data-state="gate-waiting">{{ w.waiting }}</p>
          } @else {
            @if (shows() === 'decide') {
              <div class="oid-banner decide" data-state="gate-decide" role="status">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.500 16.500h-19z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M12 10v4.500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.100" fill="currentColor"/></svg>
                <div class="oid-grow">
                  <p class="oid-banner-word">{{ d.needs }}</p>
                  <p class="oid-banner-line">{{ d.line }}</p>
                </div>
              </div>
            } @else if (shows() === 'credentialAccepted' || shows() === 'credentialRefused') {
              <div class="oid-banner credential" [class.refused]="shows() === 'credentialRefused'" data-state="gate-result" role="status">
                <div class="oid-grow">
                  <p class="oid-eyebrow">{{ d.credentialCheck }}</p>
                  <p class="oid-banner-word">{{ shows() === 'credentialAccepted' ? d.preview.accepted : d.preview.refused }}</p>
                  <p class="oid-banner-line">{{ credentialLine() }}</p>
                </div>
                <va-marker key="pair-rule" [requirements]="lean.gate.pairMarker.requirements" />
              </div>
            } @else if (shows() === 'presentationAccepted' || shows() === 'presentationRefused') {
              <div class="oid-banner credential" [class.refused]="shows() === 'presentationRefused'" data-state="gate-result" role="status">
                <div class="oid-grow">
                  <p class="oid-eyebrow">{{ lean.presentation.eyebrow }}</p>
                  <p class="oid-banner-word">{{ shows() === 'presentationAccepted' ? d.preview.accepted : d.preview.refused }}</p>
                  <p class="oid-banner-line">{{ presentationLine() }}</p>
                </div>
                <va-marker key="presentation-rule" [requirements]="lean.checks.refusals.requirements" />
              </div>
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
                <va-marker key="decision" [requirements]="lean.gate.decisionMarker.requirements" />
                <va-marker key="pair-rule" [requirements]="lean.gate.pairMarker.requirements" />
              </div>
            }
            @for (point of view().stops; track point) { <va-decision [point]="point" /> }
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
                    <span class="badge" [class.proven]="row.status === 'passed'" [class.open]="row.status === 'failed' || row.status === 'decide'" [class.not-checked]="row.status === 'notChecked' || row.status === 'advisory'">{{ row.statusWord }}</span>
                    <code class="oid-id">{{ row.requirements[0] }}</code>
                    <va-marker [key]="'check-' + row.key" [requirements]="row.requirements" />
                  </div>
                }
              </div>
            </section>
            <button type="button" class="oid-link" (click)="trip.act('startAgain')">{{ t.startAgain }}</button>
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
  protected readonly d = wording.lean.decision;

  /** The model's answers, by decision name: a display beside the computed result, loaded only with the model shown. */
  private readonly decisions = signal<Record<string, unknown> | null>(null);
  private loading = false;

  private readonly subject = computed<Subject>(() => this.trip.subject());
  /** The default trip also presents at this gate, under the model's proximity rules. */
  private readonly presentation = computed(() => {
    const s = this.subject();
    return !isPresentation(s) && s.default ? gatePresentation(s) : null;
  });
  private readonly presentationView = computed(() => {
    const p = this.presentation();
    return p && viewGate(p, this.trip.decisions());
  });
  protected readonly view = computed(() => viewGate(this.subject(), this.trip.decisions()));
  /** What the reader shows, by the model's rule for the gate. */
  protected readonly shows = computed(() => gateShows(this.trip.step(), this.view(), this.presentationView()));
  protected readonly board = computed(() => this.shows() === 'board');

  protected readonly statusLine = computed(() => fill(this.w.status, { flight: this.t.flight.number, time: formatTime(this.subject().checkedAt) }));
  protected readonly bannerLine = computed(() => {
    const f = this.view().failure ?? this.presentationView()?.failure;
    return f ? (this.t.reasons as Record<string, string>)[f] : fill(this.w.boardLine, { flight: this.t.flight.number, destination: this.t.flight.destination });
  });
  protected readonly credentialLine = computed(() => {
    const held = mdocOf(this.subject(), 'photoid') ? this.labels.photoid : this.labels.boardingPass;
    return fill(this.d.credentialLine, { credential: held.toLowerCase() });
  });
  protected readonly presentationLine = computed(() => {
    const s = this.subject();
    return isPresentation(s) ? fill(this.lean.presentation.line, { profile: this.lean.presentation.profiles[s.profile] }) : '';
  });
  protected readonly photoidName = computed(() => {
    const m = mdocOf(this.subject(), 'photoid');
    return m ? photoidNameLine(m) : null;
  });
  protected readonly passName = computed(() => {
    const m = mdocOf(this.subject(), 'boardingPass');
    return m ? passNameLine(m) : null;
  });
  protected readonly missing = computed(() => {
    const s = this.subject();
    if (isPresentation(s)) return [];
    return (['photoid', 'boardingPass'] as const)
      .filter((role) => !mdocOf(s, role))
      .map((role) => fill(this.lean.gate.noCredential, { credential: (role === 'photoid' ? this.labels.photoid : this.labels.boardingPass).toLowerCase() }));
  });

  protected readonly rows = computed<Row[]>(() => [
    ...this.view().checks.map((c) => this.row(c, this.subject())),
    ...(this.presentationView()?.checks ?? []).map((c) => this.row(c, this.presentation()!)),
  ]);

  constructor() {
    startFromTourLink('presented');
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

  private row(c: CheckView, subject: Subject): Row {
    const r = c.result;
    const words = this.lean.checks[r.key];
    const status = this.statusOf(c);
    return {
      key: r.key,
      title: words.title,
      when: (this.lean.gate.when as Record<string, string>)[words.when],
      requirements: words.requirements,
      status,
      statusWord: this.lean.gate.status[status],
      found: c.state !== 'depends' && Array.isArray(r.answer) ? r.answer.map(describeFinding).join(', ') : '',
      model: c.state === 'depends' ? null : this.modelAnswer(c, subject),
    };
  }

  private answerText(answer: unknown): string {
    const words = this.lean.gate;
    if (Array.isArray(answer)) return answer.length ? answer.map(describeFinding).join(', ') : words.noFindings;
    if (typeof answer === 'boolean') return answer ? words.yes : words.no;
    const documents = (answer as { documents?: unknown[] }).documents;
    return documents ? fill(words.credentialsPresented, { count: documents.length }) : describeFinding(answer);
  }

  private statusOf(c: CheckView): Row['status'] {
    if (c.state === 'depends') return 'decide';
    const r = c.result;
    if (r.key === 'match' && this.trip.decisions()['MatchReading'] === 'notChecked') return 'notChecked';
    if (!r.blocks) return r.passed ? 'passed' : 'advisory';
    return c.state === 'passed' ? 'passed' : 'failed';
  }

  private modelAnswer(c: CheckView, subject: Subject): Row['model'] {
    const table = this.decisions();
    if (!table) return null;
    const answer = table[decisionName(subject, c.result)];
    if (answer === undefined) return null;
    const words = this.lean.gate;
    return { text: this.answerText(answer), same: sameAnswer(answer, c.result.answer) };
  }
}
