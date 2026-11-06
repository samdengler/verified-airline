import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { SpyLocation } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { site } from './content';

describe('App', () => {
  beforeEach(async () => {
    // The page starts light; another spec may leave the shared document dark.
    localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'light');
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }));
    await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([]), { provide: SpyLocation, useFactory: () => new SpyLocation() }, { provide: Location, useExisting: SpyLocation }] }).compileComponents();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the header, the dark mode button and the footer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.wordmark')?.textContent).toBe(site.airline);
    expect(el.querySelector('.theme-toggle')?.getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('footer p')?.textContent).toBe(site.footer);
  });

  it('leaves the header and footer off the gate reader and the wallet', async () => {
    for (const path of ['/gate', '/wallet']) {
      TestBed.inject(SpyLocation).setInitialPath(path);
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('header.site'), path).toBeNull();
      expect(el.querySelector('footer.site'), path).toBeNull();
      fixture.destroy();
    }
  });
});
