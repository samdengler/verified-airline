import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { site } from './content';

describe('App', () => {
  beforeEach(async () => {
    // The page starts light; another spec may leave the shared document dark.
    localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'light');
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }));
    await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([])] }).compileComponents();
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
});
