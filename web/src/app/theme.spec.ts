import { TestBed } from '@angular/core/testing';
import { Theme } from './theme';

describe('Theme', () => {
  let systemDark = false;
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'light');
    vi.stubGlobal('matchMedia', () => ({ get matches() { return systemDark; }, addEventListener: () => {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('remembers a choice that differs from the system setting', () => {
    systemDark = false;
    const theme = TestBed.inject(Theme);
    theme.toggle();
    expect(theme.dark()).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('verified-airline-theme')).toBe('dark');
  });

  it('forgets a choice that matches the system setting', () => {
    systemDark = true;
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('verified-airline-theme', 'light');
    const theme = TestBed.inject(Theme);
    expect(theme.dark()).toBe(true);
    theme.toggle();
    theme.toggle();
    expect(theme.dark()).toBe(true);
    expect(localStorage.getItem('verified-airline-theme')).toBeNull();
  });
});
