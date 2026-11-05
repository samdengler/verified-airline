import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

const KEY = 'verified-airline-lean';

/**
 * Whether the Lean model shows.  The script in index.html sets the lean-on
 * class on the root before the page draws (?lean=1 or the remembered choice);
 * this changes it and remembers the new choice.  The One ID screens read
 * `shown`, which also follows a choice made in another tab of the same browser.
 */
@Injectable({ providedIn: 'root' })
export class LeanModel {
  private readonly root = inject(DOCUMENT).documentElement;
  readonly shown = signal(this.root.classList.contains('lean-on'));

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      const on = e.newValue === '1';
      this.root.classList.toggle('lean-on', on);
      this.shown.set(on);
    });
  }

  get on(): boolean {
    return this.root.classList.contains('lean-on');
  }

  toggle(): boolean {
    const on = !this.on;
    this.root.classList.toggle('lean-on', on);
    this.shown.set(on);
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // private browsing
    }
    return on;
  }
}
