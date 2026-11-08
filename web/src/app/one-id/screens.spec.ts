import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { site } from '../content';
import { CheckIn } from './check-in';
import { defaultScenario, requirements, scenarios, wording } from './data';
import { Gate } from './gate';
import { Marker } from './marker';
import { Signatures } from './signatures';
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

/** Waits for a screen to draw what a signature check, which WebCrypto answers asynchronously, leads to. */
async function until(fixture: { detectChanges(): void }, done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) {
    TestBed.tick();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(done()).toBe(true);
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

    trip.act('openWallet');
    const wallet = await render(Wallet);
    expect(wallet.el.querySelector('h1')?.textContent).toBe('Demo wallet');
    expect(wallet.el.querySelector('[data-sheet="consent"]')).not.toBeNull();
    expect(hiddenText(wallet.el)).not.toMatch(BANNED);

    trip.act('share');
    await until(checkIn.fixture, () => /checked in, Alice/.test(checkIn.el.querySelector('h1')?.textContent ?? ''));
    expect(checkIn.el.querySelector('[data-check="signature"]')?.textContent).toContain('Signed by Utopia passport office (demo key)');
    expect(hiddenText(checkIn.el)).not.toMatch(BANNED);

    trip.act('addPass');
    await until(wallet.fixture, () => wallet.el.querySelectorAll('[data-signature="checked"]').length === 2);
    expect(wallet.el.querySelectorAll('[data-credential]').length).toBe(2);
    expect(wallet.el.querySelectorAll('.oid-specimen').length).toBe(2);
    expect(wallet.el.querySelector('[data-credential="boardingPass"] [data-signature]')?.textContent).toContain('Signed by Verified Airline (demo key)');
    expect(wallet.el.querySelector('[data-credential="photoid"] [data-signature]')?.textContent).toContain('Signature checked');
    expect(hiddenText(wallet.el)).not.toMatch(BANNED);

    trip.act('present');
    await wallet.fixture.whenStable();
    expect(wallet.el.querySelector('[data-sheet="consent"]')?.getAttribute('data-for')).toBe('gate');
    expect(wallet.el.querySelector('[data-action="share-gate"]')?.textContent).toMatch(/4/);
    expect(hiddenText(wallet.el)).not.toMatch(BANNED);

    const gate = await render(Gate);
    expect(gate.el.querySelector('[data-state="gate-waiting"]')).not.toBeNull();
    trip.act('shareGate');
    await until(gate.fixture, () => gate.el.querySelector('[data-state="gate-result"]') !== null);
    expect(gate.el.querySelector('.oid-banner-word')?.textContent).toBe(wording.traveler.gate.board);
    expect(gate.el.querySelectorAll('[data-panel="signatures"] [data-signature="checked"]').length).toBe(2);
    expect(hiddenText(gate.el)).not.toMatch(BANNED);
    expect(hiddenText(gate.el)).not.toMatch(/\bmdoc\b|\bISO\b/i);

    // The tamper control is the presenter's, behind the model toggle: with the model hidden it changes nothing.
    TestBed.inject(Signatures).setTampered(true);
    await gate.fixture.whenStable();
    expect(gate.el.querySelector('.oid-banner-word')?.textContent).toBe(wording.traveler.gate.board);
  });

  it("refuses the default trip at the gate once the presenter's tamper control flips a byte of the boarding pass", async () => {
    document.documentElement.classList.add('lean-on');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ providers: [provideRouter([])] }).compileComponents();
    const trip = TestBed.inject(Trip);
    const gate = await render(Gate);
    trip.pick(defaultScenario.id);
    const banner = () => gate.el.querySelector('[data-state="gate-result"] .oid-banner-word')?.textContent;
    await until(gate.fixture, () => banner() === wording.traveler.gate.board);
    const tamper = gate.el.querySelector<HTMLButtonElement>('[data-panel="tamper"] [data-action="tamper"]')!;
    expect(tamper.disabled).toBe(false);
    tamper.click();
    await until(gate.fixture, () => banner() === wording.traveler.gate.refer);
    expect(gate.el.querySelector('[data-state="gate-result"] .oid-banner-line')?.textContent).toBe('The signature on the boarding pass does not match.');
    expect(gate.el.querySelector('[data-panel="signatures"] [data-credential="boardingPass"]')?.getAttribute('data-signature')).toBe('mismatch');
    expect(gate.el.querySelector('[data-panel="signatures"] [data-credential="photoid"]')?.getAttribute('data-signature')).toBe('checked');
    expect(gate.el.querySelector('[data-check="refusals"]')?.getAttribute('data-status')).toBe('failed');
    expect(gate.el.querySelector('[data-check="refusals"] code')?.textContent).toContain('issuerSignatureInvalid');
    // Putting the byte back boards the traveler again; another pick puts it back too.
    tamper.click();
    await until(gate.fixture, () => banner() === wording.traveler.gate.board);
    tamper.click();
    await until(gate.fixture, () => banner() === wording.traveler.gate.refer);
    trip.pick('two-john-smiths');
    await gate.fixture.whenStable();
    trip.pick(defaultScenario.id);
    await until(gate.fixture, () => banner() === wording.traveler.gate.board);
    // Another traveler's presentation is not checked at the gate, so the control is off for them.
    trip.pick('accented-name');
    await gate.fixture.whenStable();
    expect(gate.el.querySelector<HTMLButtonElement>('[data-panel="tamper"] [data-action="tamper"]')!.disabled).toBe(true);
    document.documentElement.classList.remove('lean-on');
  });

  it('shows the wallet as its own app, with no sign of the airline brand', async () => {
    const { el } = await render(Wallet);
    expect(el.querySelector('.surface-wallet')).not.toBeNull();
    expect(el.querySelector('.brand')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toBe('Demo wallet');
  });

  it('heads the gate reader with the airline brand and its own title', async () => {
    const { el } = await render(Gate);
    expect(el.querySelector('.gate-bar .wordmark')?.textContent).toBe(site.airline);
    expect(el.querySelector('.gate-bar h1')?.textContent).toBe(wording.traveler.gate.title);
    expect(el.querySelector('.gate-bar [data-state="gate-status"]')).not.toBeNull();
  });

  it('uses the default scenario with the model hidden, whichever traveler was picked', () => {
    const trip = TestBed.inject(Trip);
    trip.pick(scenarios.find((s) => !s.default)!.id);
    expect(trip.scenario().id).toBe(defaultScenario.id);
  });

  it('declining in the wallet returns check-in to its start', async () => {
    const trip = TestBed.inject(Trip);
    const checkIn = await render(CheckIn);
    trip.act('openWallet');
    await checkIn.fixture.whenStable();
    expect(checkIn.el.querySelector('[data-state="waiting"]')).not.toBeNull();
    trip.act('decline');
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

    fixture.componentRef.setInput('requirements', ['TRIP-003']);
    await fixture.whenStable();
    expect(button.classList.contains('open')).toBe(false);
    expect(el.querySelector('.lean-req')?.textContent).toContain('TRIP-003');
    expect(el.querySelector('.lean-pop a')?.getAttribute('href')).toBe(wording.lean.trip.source);

    // The relay is outside the model: its marker is grey and says so.
    fixture.componentRef.setInput('requirements', []);
    fixture.componentRef.setInput('grey', wording.lean.relay.grey);
    await fixture.whenStable();
    expect(button.classList.contains('partial')).toBe(true);
    expect(el.querySelector('.lean-req')?.textContent).toContain(wording.lean.relay.grey.title);
    expect(el.querySelector('.lean-pop')?.textContent).not.toContain(wording.lean.popover.noLink);
  });
});
