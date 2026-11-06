import { Location } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Brand } from './brand';
import { Chat } from './chat/chat';
import { site } from './content';
import { Theme } from './theme';

/**
 * The site's header and footer, the same as on the static pages, around the page
 * the router shows.  The gate reader and the demo wallet are apps of their own, with
 * their own headers, so they take neither.
 *
 * The skip link's click listener does nothing and is here for its place.  Angular's
 * event replay writes an inline script that lists the events a page listens to, in
 * the order it meets them, and the live content security policy allows that script by
 * hash.  This puts click first on every page, so every page has the same script.
 */
@Component({
  selector: 'va-root',
  imports: [RouterOutlet, RouterLink, Chat, Brand],
  template: `
    <a class="skip" [attr.href]="(path() || '/') + '#content'" (click)="true">Skip to content</a>
    @if (onSite()) {
      <header class="site"><div class="wrap">
      <va-brand />
      <nav aria-label="Main">
        <a routerLink="/">Book</a><a routerLink="/">My trips</a><a routerLink="/check-in" [attr.aria-current]="path() === '/check-in' ? 'page' : null">Check in</a><a routerLink="/policies" [attr.aria-current]="current()">Travel policies</a>
      </nav>
      <va-chat />
      <button type="button" class="theme-toggle" [attr.aria-pressed]="theme.dark()" aria-label="Dark mode" title="Dark mode" (click)="theme.toggle()"><svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg><svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g></svg></button>
    </div></header>
    }
    <router-outlet />
    @if (onSite()) {
      <footer class="site"><div class="wrap">
      <p>{{ site.footer }}</p>
      <nav aria-label="Footer"><a routerLink="/policies">Travel policies</a><a [href]="site.modelSite">The Verified Air model</a></nav>
    </div></footer>
    }
  `,
})
export class App {
  protected readonly site = site;
  protected readonly theme = inject(Theme);
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    // The address the page was served at, so the first draw matches the prerendered page.
    { initialValue: inject(Location).path() },
  );
  protected readonly path = computed(() => this.url().split(/[?#]/)[0].replace(/\/+$/, ''));
  protected readonly onSite = computed(() => !['/gate', '/wallet'].includes(this.path()));
  /** As on the static pages: the hub is the current page, and a policy page is within it. */
  protected readonly current = computed(() => {
    const p = this.path();
    return p === '/policies' ? 'page' : p.startsWith('/policies/') ? 'true' : null;
  });
}
