// The switches check.  The panel has to match readings.json as the file stands:
// an expert who settles a question removes its reading, and this fails until the
// switch and the setting are gone from the TypeScript as well.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { readFileSync } from 'node:fs';
import { Gate } from './gate';
import { Presenter } from './presenter';
import { READING_POINTS } from './rules/support/readings';
import { Trip } from './trip';

interface FileReading {
  id: string;
  label: string;
  settings: { value: unknown; label: string }[];
  questions: { theorem: string; question: string }[];
  criteria: string[];
}

const fileReadings: FileReading[] = JSON.parse(readFileSync('../model/one-id/readings.json', 'utf8')).readings;
const fileScenarios: { id: string; title: string; default: boolean }[] = JSON.parse(readFileSync('../model/one-id/scenarios.json', 'utf8')).scenarios;

/** What the panel on the screen shows of each switch. */
function panelSwitches(el: Element) {
  return [...el.querySelectorAll('[data-reading]')].map((s) => ({
    id: s.getAttribute('data-reading'),
    label: s.querySelector('legend')?.textContent?.trim(),
    settings: [...s.querySelectorAll('[data-setting]')].map((b) => b.getAttribute('data-setting')),
    questions: [...s.querySelectorAll('[data-question]')].map((q) => [q.getAttribute('data-question'), q.textContent?.trim()]),
  }));
}

/** Everything on which the panel and readings.json differ; empty when they agree. */
function disagreements(el: Element, file: FileReading[]): string[] {
  const panel = panelSwitches(el);
  const out: string[] = [];
  for (const r of file) {
    const s = panel.find((p) => p.id === r.id);
    if (!s) out.push(`the file has ${r.id}, and the panel has no switch for it`);
    else {
      if (s.label !== r.label) out.push(`${r.id}: its label differs`);
      if (JSON.stringify(s.settings) !== JSON.stringify(r.settings.map((x) => String(x.value)))) out.push(`${r.id}: its settings differ`);
      if (JSON.stringify(s.questions) !== JSON.stringify(r.questions.map((q) => [q.theorem, q.question]))) out.push(`${r.id}: its questions differ`);
    }
  }
  for (const s of panel) if (!file.some((r) => r.id === s.id)) out.push(`the panel has ${s.id}, and the file does not`);
  return out;
}

describe('the presenter panel', () => {
  let el: HTMLElement;

  beforeEach(async () => {
    document.documentElement.classList.add('lean-on');
    await TestBed.configureTestingModule({ imports: [Presenter], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(Presenter);
    await fixture.whenStable();
    el = fixture.nativeElement;
  });

  afterEach(() => document.documentElement.classList.remove('lean-on'));

  it('agrees with readings.json on every switch, its settings and its open questions', () => {
    expect(disagreements(el, fileReadings)).toEqual([]);
    expect(el.querySelectorAll('[data-reading]').length).toBe(fileReadings.length);
  });

  it('fails on a reading the file adds, one it removes, and a setting that changes', () => {
    const extra = { ...fileReadings[0], id: 'NewReading.point' };
    expect(disagreements(el, [...fileReadings, extra])).toEqual(['the file has NewReading.point, and the panel has no switch for it']);
    expect(disagreements(el, fileReadings.slice(1))).toEqual([`the panel has ${fileReadings[0].id}, and the file does not`]);
    const changed = fileReadings.map((r, i) => (i === 0 ? { ...r, settings: r.settings.slice(1) } : r));
    expect(disagreements(el, changed)).toEqual([`${fileReadings[0].id}: its settings differ`]);
  });

  it('takes only points the TypeScript reads', () => {
    expect(panelSwitches(el).map((s) => s.id).sort()).toEqual(Object.keys(READING_POINTS).sort());
  });

  it('offers every traveler in scenarios.json, by its title', () => {
    const travelers = [...el.querySelectorAll('[data-scenario]')].map((b) => [b.getAttribute('data-scenario'), b.textContent]);
    expect(travelers).toEqual(fileScenarios.map((s) => [s.id, s.title]));
  });

  it('is shown only with the model, through data-lean', () => {
    expect(el.querySelector('[data-panel="presenter"]')?.hasAttribute('data-lean')).toBe(true);
  });

  it('turns the result when the matching switch changes, and marks the switch that does', async () => {
    const trip = TestBed.inject(Trip);
    const gate = TestBed.createComponent(Gate);
    const gateEl = gate.nativeElement as HTMLElement;
    const word = () => gateEl.querySelector('.oid-banner-word')?.textContent;
    trip.pick('accented-name');
    trip.set('MatchReading', 'notChecked');
    await gate.whenStable();
    expect(word()).toBe('Board');
    trip.set('MatchReading', 'namesAgree');
    await gate.whenStable();
    expect(word()).toBe('Refer to agent');
    expect(gateEl.querySelector('.oid-banner-line')?.textContent).toContain('names');
    expect(gateEl.querySelector('[data-reading="MatchReading"] [data-affects]')).not.toBeNull();
    expect(gateEl.querySelector('[data-state="cannot-see"]')?.textContent).toContain('Refused, though both credentials are about the same traveler');
  });
});
