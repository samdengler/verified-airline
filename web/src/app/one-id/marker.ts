import { Component, ElementRef, HostListener, computed, inject, input, signal } from '@angular/core';
import { openQuestions, requirements, wording } from './data';

/**
 * A ∀ button and its popover, as on the policy pages: blue when every criterion
 * behind it is proven, amber when any is open, grey for something the model does
 * not cover yet, such as the relay between devices.  Everything it says about the
 * model comes from the model's files.  Requirements show every criterion;
 * `criteria` shows the open ones it names.
 */
@Component({
  selector: 'va-marker',
  template: `
    <span class="lean-anchor" data-lean>
      <button type="button" class="lean-marker" [class.open]="tone() === 'open'" [class.partial]="tone() === 'partial'" [attr.aria-expanded]="isOpen()" [attr.aria-controls]="popId()" [attr.aria-label]="label()" (click)="toggle()">∀</button>
      <div class="lean-pop" [class.amber]="tone() === 'open'" [id]="popId()" role="dialog" [attr.aria-label]="label()" [hidden]="!isOpen()">
        @if (grey(); as g) {
          <div class="lean-req">
            <p class="lean-head"><strong>{{ g.title }}</strong></p>
            <p>{{ g.text }}</p>
          </div>
        }
        @for (r of rows(); track r.id) {
          <div class="lean-req">
            <p class="lean-head">
              <strong>{{ w.requirement }} {{ r.id }}</strong>
              <span class="lean-count">{{ r.total }} {{ r.total === 1 ? w.criterion : w.criteria }}</span>
              @for (b of r.badges; track b.status) {
                <span class="badge" [class.proven]="b.status === 'proven'" [class.open]="b.status === 'open'" [class.example]="b.status === 'example'" [class.not-checked]="b.status === 'not checked'">{{ b.count }} {{ b.word }}</span>
              }
            </p>
            <p class="lean-ears">{{ r.ears }}</p>
            <p class="lean-name">{{ w.name }} <code>{{ r.name }}</code></p>
            <ul class="lean-criteria">
              @for (c of r.criteria; track c.id) {
                <li>
                  <span class="badge" [class.proven]="c.status === 'proven'" [class.open]="c.status === 'open'" [class.example]="c.status === 'example'" [class.not-checked]="c.status === 'not checked'">{{ c.word }}</span>
                  <code>{{ c.id }}</code> {{ c.ears }}
                  @if (c.theorem) { <p class="lean-name">{{ w.proof }} <code>{{ c.theorem }}</code></p> }
                  @for (q of c.questions; track q.theorem) {
                    <p class="lean-question">{{ q.question }}</p>
                    <p class="lean-name">{{ w.theorem }} <code>{{ q.theorem }}</code></p>
                    @if (q.example) {
                      <p class="lean-name">{{ w.example }} <code>{{ q.example }}</code></p>
                    }
                  }
                </li>
              }
            </ul>
          </div>
        }
        @if (isTrip()) {
          <p class="lean-name"><a [href]="trip.source">{{ trip.sourceText }}</a></p>
        } @else if (rows().length) {
          <p class="lean-name">{{ w.noLink }}</p>
        }
      </div>
    </span>
  `,
})
export class Marker {
  /** Requirement IDs, shown whole. */
  readonly requirements = input<readonly string[]>([]);
  /** Criterion IDs, shown alone under their requirement. */
  readonly criteria = input<readonly string[]>([]);
  /** The words for something the model does not cover. */
  readonly grey = input<{ title: string; text: string } | null>(null);
  /** Makes the popover's id unique on the page. */
  readonly key = input.required<string>();

  protected readonly w = wording.lean.popover;
  protected readonly trip = wording.lean.trip;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly isOpen = signal(false);
  protected readonly popId = computed(() => `one-id-pop-${this.key()}`);

  protected readonly rows = computed(() => {
    const only = this.criteria();
    const ids = only.length ? [...new Set(only.map((c) => c.replace(/\.\d+$/, '')))] : this.requirements();
    return ids.map((id) => {
      const r = requirements[id];
      const shown = r.criteria.filter((c) => !only.length || only.includes(c.id));
      const counts = new Map<string, number>();
      for (const c of r.criteria) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
      return {
        id,
        ears: r.ears,
        name: r.name,
        total: r.criteria.length,
        badges: [...counts].map(([status, count]) => ({ status, count, word: this.word(status) })),
        criteria: shown.map((c) => ({ ...c, word: this.word(c.status), questions: openQuestions[c.id] ?? [] })),
      };
    });
  });

  protected readonly tone = computed<'proven' | 'open' | 'partial'>(() => {
    if (this.grey()) return 'partial';
    const statuses = this.rows().flatMap((r) => (this.criteria().length ? r.criteria : requirements[r.id].criteria).map((c) => c.status));
    return statuses.includes('open') ? 'open' : statuses.every((s) => s === 'proven') ? 'proven' : 'partial';
  });

  protected readonly label = computed(() => this.grey()?.title ?? `${this.w.requirement} ${this.rows().map((r) => r.id).join(', ')}`);
  /** The trip's model is in this repository, unlike verified-id's, so its popover can link to it. */
  protected readonly isTrip = computed(() => this.rows().length > 0 && this.rows().every((r) => r.id.startsWith('TRIP-')));

  private word(status: string): string {
    return (this.w.status as Record<string, string>)[status] ?? status;
  }

  protected toggle(): void {
    this.isOpen.update((open) => !open);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.isOpen() && event.target instanceof Node && !this.host.contains(event.target)) this.isOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.host.querySelector('button')?.focus();
  }
}
