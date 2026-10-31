import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { pages, policySlugs } from './content';
import { Page } from './page';

async function render(slug: string) {
  const fixture = TestBed.createComponent(Page);
  fixture.componentRef.setInput('slug', slug);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('Page', () => {
  beforeEach(async () => {
    document.documentElement.classList.remove('lean-on');
    await TestBed.configureTestingModule({ imports: [Page], providers: [provideRouter([])] }).compileComponents();
  });

  it('has the six policy pages, each under /policies/', () => {
    expect(policySlugs.length).toBe(6);
    for (const slug of policySlugs) expect(pages[slug].path).toBe(`/policies/${slug}/`);
  });

  it("draws a policy page's band and sections", async () => {
    const { el } = await render('changes');
    expect(pages['changes'].title.startsWith(el.querySelector('h1')!.textContent!)).toBe(true);
    expect(el.querySelectorAll('#content section').length).toBeGreaterThan(3);
    expect(el.querySelectorAll('button.lean-marker').length).toBeGreaterThan(0);
  });

  it('shows the not-found page for a slug with no page', async () => {
    const { el } = await render('no-such-policy');
    expect(el.querySelector('h1')?.textContent).toBe('Page not found');
  });

  it('sends a link within the site through the router, without the final slash', async () => {
    const { el } = await render('changes');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const link = el.querySelector<HTMLAnchorElement>('.toc a')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/policies/changes' + new URL(link.href).hash);
  });

  it('shows the Lean model and opens a marker\'s popover', async () => {
    const { el } = await render('paying');
    document.body.appendChild(el);
    el.querySelector<HTMLButtonElement>('.lean-toggle')!.click();
    expect(document.documentElement.classList.contains('lean-on')).toBe(true);
    expect(el.querySelector('.lean-toggle')?.getAttribute('aria-pressed')).toBe('true');
    const marker = el.querySelector<HTMLButtonElement>('button.lean-marker')!;
    marker.click();
    expect(marker.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(marker.getAttribute('aria-controls')!)?.hidden).toBe(false);
    el.remove();
  });
});
