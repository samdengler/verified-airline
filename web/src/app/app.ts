import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Chat } from './chat/chat';
import { site } from './content';
import { Theme } from './theme';

/** The site's header and footer, the same as on the static pages, around the page the router shows. */
@Component({
  selector: 'va-root',
  imports: [RouterOutlet, RouterLink, Chat],
  template: `
    <a class="skip" [attr.href]="path() + '#content'">Skip to content</a>
    <header class="site"><div class="wrap">
      <a class="brand" routerLink="/"><svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path transform="rotate(-30 12 12)" fill="currentColor" d="M21.6 12c0-.85-.7-1.45-1.55-1.45H14.3L9.4 3.2H7.6l2.35 7.35H5.5L3.75 8.1H2.4l1.05 3.9-1.05 3.9h1.35l1.75-2.45h4.45L7.6 20.8h1.8l4.9-7.35h5.75c.85 0 1.55-.6 1.55-1.45z"/></svg><span class="wordmark">{{ site.airline }}</span></a>
      <nav aria-label="Main">
        <a routerLink="/">Book</a><a routerLink="/">My trips</a><a routerLink="/check-in" [attr.aria-current]="path() === '/check-in' ? 'page' : null">Check in</a><a routerLink="/policies" [attr.aria-current]="current()">Travel policies</a>
      </nav>
      <va-chat />
      <button type="button" class="theme-toggle" [attr.aria-pressed]="theme.dark()" aria-label="Dark mode" title="Dark mode" (click)="theme.toggle()"><svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg><svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g></svg></button>
    </div></header>
    <router-outlet />
    <footer class="site"><div class="wrap">
      <p>{{ site.footer }}</p>
      <nav aria-label="Footer"><a routerLink="/policies">Travel policies</a><a [href]="site.modelSite">The Verified Air model</a></nav>
    </div></footer>
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
    { initialValue: this.router.url },
  );
  protected readonly path = computed(() => this.url().split(/[?#]/)[0]);
  /** As on the static pages: the hub is the current page, and a policy page is within it. */
  protected readonly current = computed(() => {
    const p = this.path();
    return p === '/policies' ? 'page' : p.startsWith('/policies/') ? 'true' : null;
  });
}
