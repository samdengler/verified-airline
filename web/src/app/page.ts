import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, HostListener, afterRenderEffect, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { pages } from './content';
import { LeanModel } from './lean-model';
import { NotFound } from './not-found';

/**
 * One page from content.json: its band and its body, as the renderer wrote
 * them.  The ∀ markers, their popovers and the Lean model button are in that
 * HTML; this component works them as assets/airline.js does on the static
 * pages, and sends links within the site through the router.
 */
@Component({
  selector: 'va-page',
  imports: [NotFound],
  template: `
    @if (page()) {
      <div [innerHTML]="band()"></div>
      <div id="content" [innerHTML]="body()"></div>
    } @else {
      <va-not-found />
    }
  `,
})
export class Page {
  /** From the route's data, or its :slug. */
  readonly slug = input('index');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly lean = inject(LeanModel);
  private readonly sanitizer = inject(DomSanitizer);
  private current: HTMLButtonElement | null = null;

  protected readonly page = computed(() => pages[this.slug()]);
  // The renderer built this HTML at build time from the repository's own files
  // and checked it, so it is trusted as it stands.  Angular's sanitizer would
  // remove the markers' buttons and the sections' ids.
  protected readonly band = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.page()?.band ?? ''));
  protected readonly body = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.page()?.body ?? ''));

  constructor() {
    afterRenderEffect(() => {
      this.page();
      this.current = null;
      this.syncToggles();
    });
  }

  @HostListener('document:click', ['$event'])
  onClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (this.host.contains(target)) {
      if (target.closest('.lean-toggle')) {
        if (!this.lean.toggle()) this.close(false);
        this.syncToggles();
        return;
      }
      const marker = target.closest<HTMLButtonElement>('button.lean-marker');
      if (marker) {
        if (marker === this.current) this.close(true);
        else this.open(marker);
        return;
      }
      const link = target.closest<HTMLAnchorElement>('a[href]');
      if (link && this.route(link, event)) return;
    }
    if (this.current && !target.closest('.lean-pop')) this.close(false);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.current) return;
    event.preventDefault();
    this.close(true);
  }

  /** The home page's search form sells nothing; it stays on the page. */
  @HostListener('submit', ['$event'])
  onSubmit(event: Event): void {
    event.preventDefault();
  }

  /** A link to a page of this site goes through the router; files such as facts.json and other sites load as usual. */
  private route(link: HTMLAnchorElement, event: MouseEvent): boolean {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.target) return false;
    const url = new URL(link.getAttribute('href')!, this.doc.location.href);
    if (url.origin !== this.doc.location.origin || /\.[a-z0-9]+$/i.test(url.pathname)) return false;
    event.preventDefault();
    this.close(false);
    void this.router.navigateByUrl((url.pathname.replace(/\/+$/, '') || '/') + url.hash);
    return true;
  }

  private open(button: HTMLButtonElement): void {
    this.close(false);
    button.setAttribute('aria-expanded', 'true');
    this.popover(button)?.removeAttribute('hidden');
    this.current = button;
  }

  private close(returnFocus: boolean): void {
    const button = this.current;
    if (!button) return;
    this.current = null;
    button.setAttribute('aria-expanded', 'false');
    this.popover(button)?.setAttribute('hidden', '');
    if (returnFocus) button.focus();
  }

  private popover(button: HTMLButtonElement): HTMLElement | null {
    return this.doc.getElementById(button.getAttribute('aria-controls') ?? '');
  }

  private syncToggles(): void {
    const on = String(this.lean.on);
    this.host.querySelectorAll('.lean-toggle').forEach((b) => b.setAttribute('aria-pressed', on));
  }
}
