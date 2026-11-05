import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CheckIn } from './check-in';
import { defaultScenario, requirements, scenarios, wording } from './data';
import { Gate } from './gate';
import { Marker } from './marker';
import { Trip } from './trip';
import { Wallet } from './wallet';

const BANNED = /\b(rules?|theorems?|criterion|criteria)\b|\b(?:ONE|OO|OID)-\d{3}(?:\.\d+)?\b|\bG-\d{2}\b/i;

/** The text a traveler reads with the model hidden: everything outside data-lean. */
function hiddenText(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-lean]').forEach((n) => n.remove());
  return copy.textContent ?? '';
}

async function render<T>(component: new () => T) {
  const fixture = TestBed.createComponent(component);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('the One ID screens', () => {
  beforeEach(async () => {
    document.documentElement.classList.remove('lean-on');
    await TestBed.configureTestingModule({ providers: [provideRouter([])] }).compileComponents();
  });

  it('runs the default trip with the model hidden, from check-in to "Board"', async () => {
    const trip = TestBed.inject(Trip);
    expect(trip.scenario().id).toBe(defaultScenario.id);
    const checkIn = await render(CheckIn);
    expect(checkIn.el.querySelector('h1')?.textContent).toBe(wording.traveler.checkIn.title);
    expect(hiddenText(checkIn.el)).not.toMatch(BANNED);

    trip.go('asked');
    const wallet = await render(Wallet);
    expect(wallet.el.querySelector('h1')?.textContent).toBe('Demo wallet');
    expect(wallet.el.querySelector('[data-sheet="consent"]')).not.toBeNull();
    expect(hiddenText(wallet.el)).not.toMatch(BANNED);

    trip.go('shared');
    await checkIn.fixture.whenStable();
    expect(checkIn.el.querySelector('h1')?.textContent).toMatch(/checked in, Alice/);
    expect(hiddenText(checkIn.el)).not.toMatch(BANNED);

    trip.go('passAdded');
    await wallet.fixture.whenStable();
    expect(wallet.el.querySelectorAll('[data-credential]').length).toBe(2);
    expect(wallet.el.querySelectorAll('.oid-specimen').length).toBe(2);
    expect(hiddenText(wallet.el)).not.toMatch(BANNED);

    const gate = await render(Gate);
    expect(gate.el.querySelector('[data-state="gate-waiting"]')).not.toBeNull();
    trip.go('presented');
    await gate.fixture.whenStable();
    expect(gate.el.querySelector('.oid-banner-word')?.textContent).toBe(wording.traveler.gate.board);
    expect(hiddenText(gate.el)).not.toMatch(BANNED);
  });

  it('uses the default scenario with the model hidden, whichever traveler was picked', () => {
    const trip = TestBed.inject(Trip);
    trip.pick(scenarios.find((s) => !s.default)!.id);
    expect(trip.scenario().id).toBe(defaultScenario.id);
  });

  it('declining in the wallet returns check-in to its start', async () => {
    const trip = TestBed.inject(Trip);
    const checkIn = await render(CheckIn);
    trip.go('asked');
    await checkIn.fixture.whenStable();
    expect(checkIn.el.querySelector('[data-state="waiting"]')).not.toBeNull();
    trip.go('declined');
    await checkIn.fixture.whenStable();
    expect(checkIn.el.querySelector('[data-state="declined"]')).not.toBeNull();
    expect(checkIn.el.querySelector('[data-action="open-wallet"]')).not.toBeNull();
  });

  it('stops at a decision, and goes on once one is chosen in the banner', async () => {
    document.documentElement.classList.add('lean-on');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ providers: [provideRouter([])] }).compileComponents();
    const trip = TestBed.inject(Trip);
    const gate = await render(Gate);
    trip.pick('accented-name');
    await gate.fixture.whenStable();
    expect(gate.el.querySelector('[data-state="gate-decide"]')).not.toBeNull();
    expect(gate.el.querySelector('[data-state="gate-result"]')).toBeNull();
    expect(gate.el.querySelector('[data-decision="MatchReading"]')).not.toBeNull();
    gate.el.querySelector<HTMLButtonElement>('[data-decision="MatchReading"] [data-option="namesAgree"]')!.click();
    await gate.fixture.whenStable();
    expect(gate.el.querySelector('[data-state="gate-decide"]')).toBeNull();
    expect(gate.el.querySelector('.oid-banner-word')?.textContent).toBe(wording.traveler.gate.refer);
    expect(gate.el.querySelector('[data-trail="MatchReading"]')).not.toBeNull();
    document.documentElement.classList.remove('lean-on');
  });

  it('shows one credential as a credential check, never as Board', async () => {
    document.documentElement.classList.add('lean-on');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ providers: [provideRouter([])] }).compileComponents();
    const trip = TestBed.inject(Trip);
    const gate = await render(Gate);
    trip.pick('end-of-validity');
    trip.set('ExpiryReading.validAtEnd', true);
    await gate.fixture.whenStable();
    expect(gate.el.querySelector('.oid-banner.credential .oid-banner-word')?.textContent).toBe(wording.lean.decision.preview.accepted);
    expect(gate.el.querySelector('.oid-banner.board')).toBeNull();
    document.documentElement.classList.remove('lean-on');
  });

  it("draws a marker's popover from model.json, with its tone from the statuses", async () => {
    const fixture = TestBed.createComponent(Marker);
    fixture.componentRef.setInput('key', 'test');
    fixture.componentRef.setInput('requirements', ['OID-102']);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector('button')!;
    expect(button.classList.contains('open')).toBe(false);
    expect(button.classList.contains('partial')).toBe(false);
    expect(el.querySelector('.lean-pop')?.textContent).toContain(requirements['OID-102'].ears);

    fixture.componentRef.setInput('requirements', ['OID-107']);
    await fixture.whenStable();
    expect(button.classList.contains('open')).toBe(true);

    fixture.componentRef.setInput('requirements', []);
    fixture.componentRef.setInput('grey', wording.lean.grey.request);
    await fixture.whenStable();
    expect(button.classList.contains('partial')).toBe(true);
    expect(el.querySelector('.lean-req')?.textContent).toContain(wording.lean.grey.request.title);
  });
});
