import { Component, ElementRef, OnDestroy, afterNextRender, isDevMode, signal, viewChild } from '@angular/core';
import { chatWording, modelRepository } from '../content';
import { ChatSession, type Incoming } from './chat-session';
import { confidence, contradicted, findingRows, tone, turnFor, versionOf, type Mode, type Turn } from './turns';

/**
 * The support chat: a button in the header and a panel over the page.  Each
 * reply shows how it was checked.  In verified mode a verified reply carries a
 * ∀ Verified mark that opens its answer certificate, and Compare shows the
 * draft beside what the traveler was shown.  New chat in the panel's header
 * ends the chat and starts an empty one.  Switching Verified answers also
 * starts a new chat, since a chat's mode is fixed when it starts.
 *
 * Under `npm start` the proxy sends /api to chat/scripts/dev_api.py; on
 * air.dengler.io CloudFront sends it to the chat's functions.  PUBLISHED
 * turns the button on; with it off, ?chat in the address still shows it.
 */
const PUBLISHED = true;
const GREETING_WAIT_MS = 15000;

interface Line {
  key: string;
  kind: 'traveler' | 'airline' | 'note';
  text: string;
  /** For a reply: the question it answers and the chat's mode. */
  question?: string;
  mode?: Mode;
  /** undefined while the record loads; null when there is none. */
  turn?: Turn | null;
  open?: 'certificate' | 'compare' | null;
}

type Status = 'idle' | 'starting' | 'ready' | 'waiting' | 'failed' | 'ended';

@Component({
  selector: 'va-chat',
  template: `
    @if (enabled()) {
      <button type="button" class="chat-open" [attr.aria-expanded]="open()" aria-controls="va-chat-panel" (click)="toggleOpen()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 5h16v11H9l-5 4z"/></svg>
        <span>{{ w.open }}</span>
      </button>
    }
    @if (open()) {
      <section id="va-chat-panel" class="chat-panel" role="dialog" [attr.aria-label]="w.title">
        <header class="chat-head">
          <h2>{{ w.title }}</h2>
          <button type="button" class="chat-switch" role="switch" [attr.aria-checked]="verified()" [disabled]="status() === 'starting' || status() === 'waiting'" (click)="toggleVerified()">
            <span class="track" aria-hidden="true"><span class="thumb"></span></span>{{ w.verifiedToggle }}
          </button>
          <button type="button" class="chat-new" [attr.aria-label]="w.newChat" [title]="w.newChat" [disabled]="status() === 'starting'" (click)="restart()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" d="M4 5h16v11H9l-5 4zM12 7.5v5M9.5 10h5"/></svg>
          </button>
          <button type="button" class="chat-close" [attr.aria-label]="w.close" (click)="open.set(false)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </header>
        <p class="chat-mode" [class.on]="verified()">{{ verified() ? w.modeVerified : w.modeKb }}</p>
        <div class="chat-log" #log aria-live="polite">
          @for (line of lines(); track line.key) {
            @if (line.kind === 'traveler') {
              <p class="msg traveler">{{ line.text }}</p>
            } @else if (line.kind === 'note') {
              <p class="chat-note">{{ line.text }}</p>
            } @else {
              <div class="msg airline" [class.held]="line.turn?.state === 'withheld'">
                <p>{{ line.text }}</p>
                @if (line.question !== undefined) {
                  <div class="msg-status">
                    @if (line.mode === 'kb') {
                      <span class="badge not-checked">{{ w.notChecked }}</span>
                    } @else if (line.turn) {
                      @switch (line.turn.state) {
                        @case ('verified') {
                          <button type="button" class="chat-verified" [attr.aria-expanded]="line.open === 'certificate'" (click)="toggle(line, 'certificate')">
                            <span class="lean-marker proven" aria-hidden="true">∀</span>{{ w.verified }}
                          </button>
                        }
                        @case ('withheld') { <span class="badge open">{{ w.heldBack }}</span> }
                        @default { <span class="badge not-checked">{{ w.notChecked }}</span> }
                      }
                      <button type="button" class="chat-compare" [attr.aria-expanded]="line.open === 'compare'" (click)="toggle(line, 'compare')">{{ w.compare }}</button>
                    }
                  </div>
                  @if (line.mode === 'kb') {
                    <p class="msg-why">{{ w.notCheckedKb }}</p>
                  } @else if (line.turn?.state === 'not checked') {
                    <p class="msg-why">{{ w.notCheckedVerified }}</p>
                  }
                }
              </div>
              @if (line.turn && line.open === 'certificate') {
                <div class="chat-detail cert" [attr.data-line]="line.key" role="region" [attr.aria-label]="lean.certificate">
                  <p class="detail-title">{{ lean.certificate }}</p>
                  <div class="cert-findings" role="table">
                    <div role="row"><span role="columnheader">{{ lean.checkedFor }}</span><span role="columnheader">{{ lean.answerSays }}</span></div>
                    @for (row of rows(line.turn); track $index) {
                      <div role="row">
                        <span role="cell">@for (p of row.premises; track p) { <code>{{ p }}</code> }</span>
                        <span role="cell">@for (c of row.claims; track c) { <code>{{ c }}</code> }</span>
                      </div>
                    }
                  </div>
                  <p><span class="cert-label">{{ lean.result }}</span> {{ lean.valid }}@if (sureness(line.turn); as c) { ({{ lean.confidence }} {{ c }})}</p>
                  <p class="detail-sub">{{ lean.restsOn }}</p>
                  <ul class="cert-rules">
                    @for (r of rulesOf(line.turn); track r.id) {
                      <li>
                        <span class="lean-marker" [class.open]="r.tone === 'open'" aria-hidden="true">∀</span>
                        <div>
                          <p>{{ r.statement }}</p>
                          @for (t of r.theorems; track t.name) {
                            <p class="cert-theorem"><span class="badge proven">{{ lean.provenBadge }}</span> {{ lean.theorem }} <a [href]="t.url"><code>{{ t.name }}</code></a></p>
                          }
                          <p class="cert-lean"><code>{{ r.lean }}</code> · {{ r.ids }} · {{ r.proven }} of {{ r.total }} {{ lean.proven }}</p>
                        </div>
                      </li>
                    }
                  </ul>
                  <p class="detail-sub">{{ lean.whatThisShows }}</p>
                  <p>{{ lean.explanation }}</p>
                  <p class="cert-meta">{{ meta(line.turn) }}@if (line.turn.provenance?.leanModelCommit; as commit) { · verified-air <a [href]="repository + '/commit/' + commit"><code>{{ commit.slice(0, 7) }}</code></a>}</p>
                </div>
              }
              @if (line.turn && line.open === 'compare') {
                <div class="chat-detail compare" [attr.data-line]="line.key" role="region" [attr.aria-label]="w.compare">
                  <div><p class="detail-sub">{{ lean.drafted }}</p><p>{{ line.turn.draft }}</p></div>
                  <div><p class="detail-sub">{{ lean.shown }}</p><p>{{ line.text }}</p></div>
                  <div class="full">
                    <p class="detail-sub">{{ lean.check }}</p>
                    @if (line.turn.check; as check) {
                      <p><code>{{ check.result }}</code>@for (f of check.findings; track $index) { <code>{{ f.kind }}</code>}</p>
                      @for (r of broken(line.turn); track r) { <p>{{ lean.contradicts }}: {{ r }}</p> }
                    } @else {
                      <p>{{ lean.noFindings }}</p>
                    }
                  </div>
                </div>
              }
            }
          }
          @switch (status()) {
            @case ('starting') { <p class="chat-note">{{ w.starting }}</p> }
            @case ('waiting') { <p class="chat-thinking">{{ verified() ? w.thinkingVerified : w.thinkingKb }}</p> }
            @case ('failed') { <p class="chat-note">{{ w.startFailed }}</p> }
            @case ('ended') { <p class="chat-note">{{ w.ended }} <button type="button" class="chat-link" (click)="restart()">{{ w.newChat }}</button></p> }
          }
        </div>
        @if (status() === 'ready' && !asked()) {
          <div class="chat-suggestions">
            @for (s of w.suggestions; track s) { <button type="button" (click)="ask(s)">{{ s }}</button> }
          </div>
        }
        <form class="chat-input" (submit)="submit($event)">
          <textarea rows="2" [attr.aria-label]="w.placeholder" [placeholder]="w.placeholder" [value]="draft()"
            (input)="draft.set($any($event.target).value)" (keydown.enter)="enter($any($event))"></textarea>
          <button type="submit" [disabled]="status() !== 'ready' || !draft().trim()">{{ w.send }}</button>
        </form>
      </section>
    }
  `,
})
export class Chat implements OnDestroy {
  protected readonly w = chatWording.traveler;
  protected readonly lean = chatWording.lean;
  protected readonly repository = modelRepository;
  protected readonly enabled = signal(false);
  protected readonly open = signal(false);
  protected readonly verified = signal(true);
  protected readonly lines = signal<Line[]>([]);
  protected readonly status = signal<Status>('idle');
  protected readonly draft = signal('');
  protected readonly asked = signal(false);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private chat: ChatSession | null = null;
  private pending: string | null = null;
  private taken = new Set<number>();
  private keys = 0;

  constructor() {
    // After hydration, so the prerendered header is the same with or without the chat.
    afterNextRender(() => this.enabled.set(PUBLISHED || isDevMode() || new URLSearchParams(location.search).has('chat')));
  }

  ngOnDestroy(): void {
    this.chat?.end();
  }

  protected toggleOpen(): void {
    this.open.update((o) => !o);
    if (this.open() && this.status() === 'idle') this.start();
  }

  protected toggleVerified(): void {
    this.verified.update((v) => !v);
    this.add({ kind: 'note', text: this.verified() ? this.w.switchedOn : this.w.switchedOff });
    this.start();
  }

  protected restart(): void {
    this.lines.set([]);
    this.start();
  }

  protected ask(text: string): void {
    this.draft.set(text);
    this.send();
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.send();
  }

  protected enter(event: KeyboardEvent): void {
    if (event.shiftKey) return;
    event.preventDefault();
    this.send();
  }

  protected toggle(line: Line, what: 'certificate' | 'compare'): void {
    const open = line.open === what ? null : what;
    this.update(line.key, { open });
    if (open) {
      setTimeout(() => this.log()?.nativeElement.querySelector(`[data-line="${line.key}"]`)?.scrollIntoView({ block: 'nearest' }));
    }
  }

  protected rows(turn: Turn) {
    return findingRows(turn);
  }

  protected sureness(turn: Turn): string | null {
    const c = confidence(turn);
    return c === null ? null : c.toFixed(2);
  }

  protected rulesOf(turn: Turn) {
    return Object.entries(turn.rules).map(([id, r]) => ({
      id,
      statement: r.statement,
      lean: r.lean,
      ids: r.requirements.map((q) => q.id).join(', '),
      proven: r.requirements.reduce((n, q) => n + q.proven, 0),
      total: r.requirements.reduce((n, q) => n + q.total, 0),
      tone: tone(r.requirements),
      theorems: r.theorems ?? [],
    }));
  }

  protected broken(turn: Turn): string[] {
    return contradicted(turn).map((id) => turn.rules[id]?.statement ?? id);
  }

  protected meta(turn: Turn): string {
    const p = turn.provenance ?? {};
    const when = new Date(turn.at * 1000).toISOString().slice(0, 16).replace('T', ' ');
    return [
      `${this.lean.policy} v${versionOf(p.policyVersion) ?? '?'}`,
      `${this.lean.guardrail} v${p.guardrailVersion ?? '?'}`,
      `${when} UTC`,
      `${this.lean.turn} ${turn.contact.slice(0, 8)}/${turn.turn}`,
    ].join(' · ');
  }

  private async start(): Promise<void> {
    await this.chat?.end();
    this.chat = null;
    this.pending = null;
    this.taken = new Set();
    this.asked.set(false);
    this.status.set('starting');
    const mode: Mode = this.verified() ? 'verified' : 'kb';
    try {
      const chat = await ChatSession.start(
        mode,
        (c, m) => this.reply(c, m),
        (c) => {
          if (this.chat === c) this.status.set('ended');
        },
      );
      this.chat = chat;
      // Ready once the greeting comes, so a question is never paired with it;
      // a greeting that never comes does not hold the chat up for long.
      setTimeout(() => {
        if (this.chat === chat && this.status() === 'starting') this.status.set('ready');
      }, GREETING_WAIT_MS);
    } catch {
      this.status.set('failed');
    }
  }

  private async send(): Promise<void> {
    const text = this.draft().trim();
    if (!text || this.status() !== 'ready' || !this.chat) return;
    this.add({ kind: 'traveler', text });
    this.draft.set('');
    this.asked.set(true);
    this.pending = text;
    this.status.set('waiting');
    try {
      await this.chat.send(text);
    } catch {
      this.status.set('failed');
    }
  }

  private reply(chat: ChatSession, m: Incoming): void {
    // A chat ended by a switch of mode may still deliver a line; it no longer counts.
    if (chat.ended) return;
    if (!chat.greeted) {
      chat.greeted = true;
      this.add({ kind: 'airline', text: m.text });
      if (this.status() === 'starting') this.status.set('ready');
      return;
    }
    const question = this.pending;
    if (question === null) {
      this.add({ kind: 'airline', text: m.text });
      return;
    }
    this.pending = null;
    this.status.set('ready');
    const key = this.add({ kind: 'airline', text: m.text, question, mode: chat.mode });
    if (m.text !== this.w.unreachable) this.findTurn(chat, key, question);
    else this.update(key, { turn: null });
  }

  /** The reply's turn record; the agent writes it before it replies, so one retry covers a slow read. */
  private async findTurn(chat: ChatSession, key: string, question: string): Promise<void> {
    for (const wait of [0, 1500]) {
      await new Promise((r) => setTimeout(r, wait));
      const turn = turnFor(await chat.turns().catch(() => []), question, this.taken);
      if (turn) {
        this.taken.add(turn.turn);
        this.update(key, { turn });
        return;
      }
    }
    this.update(key, { turn: null });
  }

  private add(line: Omit<Line, 'key'>): string {
    const key = `l${++this.keys}`;
    this.lines.update((ls) => [...ls, { ...line, key }]);
    this.scroll();
    return key;
  }

  private update(key: string, change: Partial<Line>): void {
    this.lines.update((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));
    if (!('open' in change)) this.scroll();
  }

  private scroll(): void {
    setTimeout(() => {
      const el = this.log()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
