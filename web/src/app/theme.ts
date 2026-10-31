import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

const KEY = 'verified-airline-theme';

/**
 * The dark mode button.  The script in index.html sets data-theme on the root
 * before the page draws, from the remembered choice or the system setting;
 * this keeps following the system while no choice is remembered.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly system = isPlatformBrowser(inject(PLATFORM_ID))
    ? matchMedia('(prefers-color-scheme: dark)')
    : null;
  readonly dark = signal(false);

  constructor() {
    if (!this.system) return;
    this.dark.set(this.root.getAttribute('data-theme') === 'dark');
    this.system.addEventListener('change', () => {
      const t = remembered();
      if (t !== 'light' && t !== 'dark') this.set(this.system!.matches);
    });
  }

  /** A choice that matches the system setting is forgotten, so the page follows the system again. */
  toggle(): void {
    const dark = !this.dark();
    try {
      if (dark === this.system?.matches) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, dark ? 'dark' : 'light');
    } catch {
      // private browsing
    }
    this.set(dark);
  }

  private set(dark: boolean): void {
    this.root.setAttribute('data-theme', dark ? 'dark' : 'light');
    this.dark.set(dark);
  }
}

function remembered(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
