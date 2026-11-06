import { isPlatformBrowser } from '@angular/common';
import { Injectable, OnDestroy, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { LeanModel } from '../lean-model';
import { defaultScenario, presentationScenarios, scenarios } from './data';
import type { Decisions, Subject } from './decide';
import type { Setting } from './rules/support/readings';

/** How far the trip has gone: the website asks, the wallet shares, the website issues, the gate asks, the wallet presents. */
export type Step = 'start' | 'asked' | 'declined' | 'shared' | 'passAdded' | 'gateAsked' | 'gateDeclined' | 'presented';

/** The steps at which the wallet holds the boarding pass. */
export const PASS_HELD: readonly Step[] = ['passAdded', 'gateAsked', 'gateDeclined', 'presented'];

interface TripState {
  /** Grows with each change, so a surface takes only news. */
  rev: number;
  step: Step;
  /** The traveler the presenter picked.  With the model hidden, the trip is always the default scenario. */
  scenarioId: string;
  /** What has been decided.  Nothing is, to begin with: the site chooses nothing for the business. */
  decisions: Decisions;
}

type Message = { type: 'hello' } | { type: 'state'; state: TripState };

const CHANNEL = 'verified-airline-one-id';

/**
 * The trip the three surfaces share.  They talk through a BroadcastChannel, so
 * a laptop can show the website, the wallet and the gate reader side by side in
 * one browser.  A new tab says hello and any tab further along answers with
 * where the trip stands.  Only the step, the traveler and the decisions travel;
 * each surface computes its own results from them.
 */
@Injectable({ providedIn: 'root' })
export class Trip implements OnDestroy {
  private readonly lean = inject(LeanModel);
  private readonly channel = isPlatformBrowser(inject(PLATFORM_ID)) && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  private readonly state = signal<TripState>({ rev: 0, step: 'start', scenarioId: defaultScenario.id, decisions: {} });

  readonly step = computed(() => this.state().step);
  readonly decisions = computed(() => this.state().decisions);
  readonly pickedId = computed(() => this.state().scenarioId);
  /** The traveler whose credentials the website and the wallet show.  A presentation picked on the panel leaves them on the default trip. */
  readonly scenario = computed(() => (this.lean.shown() ? (scenarios.find((s) => s.id === this.state().scenarioId) ?? defaultScenario) : defaultScenario));
  /** What the gate is asked about: the picked presentation, or the traveler. */
  readonly subject = computed<Subject>(() => (this.lean.shown() ? presentationScenarios.find((s) => s.id === this.state().scenarioId) : undefined) ?? this.scenario());

  constructor() {
    if (!this.channel) return;
    this.channel.onmessage = (event: MessageEvent<Message>) => {
      const message = event.data;
      if (message.type === 'hello') {
        if (this.state().rev > 0) this.post({ type: 'state', state: this.state() });
      } else if (message.state.rev > this.state().rev) {
        this.state.set(message.state);
      }
    };
    this.post({ type: 'hello' });
  }

  ngOnDestroy(): void {
    this.channel?.close();
  }

  private post(message: Message): void {
    this.channel?.postMessage(message);
  }

  private change(part: Partial<TripState>): void {
    const next = { ...this.state(), ...part, rev: this.state().rev + 1 };
    this.state.set(next);
    this.post({ type: 'state', state: next });
  }

  go(step: Step): void {
    this.change({ step });
  }

  /** Back to the start of the trip, keeping the traveler and the switches. */
  reset(): void {
    this.change({ step: 'start' });
  }

  /** The presenter's traveler or presentation goes straight to the gate reader. */
  pick(scenarioId: string): void {
    this.change({ scenarioId, step: 'presented' });
  }

  /** Records a setting of a point, or null for "none of these", which keeps the trip stopped there. */
  set(point: string, value: Setting | null): void {
    this.change({ decisions: { ...this.state().decisions, [point]: value } });
  }

  undo(point: string): void {
    const { [point]: _removed, ...rest } = this.state().decisions;
    this.change({ decisions: rest });
  }

  clearDecisions(): void {
    this.change({ decisions: {} });
  }
}
