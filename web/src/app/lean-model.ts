import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

const KEY = 'verified-airline-lean';

/**
 * Whether the Lean model shows.  The script in index.html sets the lean-on
 * class on the root before the page draws (?lean=1 or the remembered choice);
 * this changes it and remembers the new choice.
 */
@Injectable({ providedIn: 'root' })
export class LeanModel {
  private readonly root = inject(DOCUMENT).documentElement;

  get on(): boolean {
    return this.root.classList.contains('lean-on');
  }

  toggle(): boolean {
    const on = !this.on;
    this.root.classList.toggle('lean-on', on);
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // private browsing
    }
    return on;
  }
}
