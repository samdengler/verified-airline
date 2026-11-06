import { wording } from './data';
import type { Step } from './trip';
import { STOPS, legsOf, stopIndex, websiteAction } from './trip-route';

describe('the trip route', () => {
  const at = (step: Step) => STOPS[stopIndex(step)];

  it('puts each step at the app that acts next', () => {
    expect(at('start').app).toBe('website');
    expect(at('asked').app).toBe('wallet');
    expect(at('shared').app).toBe('website');
    expect(at('passAdded').app).toBe('wallet');
    expect(at('gateAsked').app).toBe('wallet');
    expect(at('presented').app).toBe('gate');
  });

  it('moves forward along the default trip, one stop per step', () => {
    const trip: Step[] = ['start', 'asked', 'shared', 'passAdded', 'gateAsked', 'presented'];
    expect(trip.map(stopIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('goes back one stop on a decline', () => {
    expect(stopIndex('declined')).toBe(stopIndex('asked') - 1);
    expect(stopIndex('gateDeclined')).toBe(stopIndex('gateAsked') - 1);
  });

  it('has a name and a line for every stop, and words for every app', () => {
    const m = wording.traveler.map;
    for (const s of STOPS) {
      expect(m.stops[s.id].name).toBeTruthy();
      expect(m.stops[s.id].line).toBeTruthy();
      expect(m.apps[s.app]).toBeTruthy();
      expect(m.go[s.app]).toBeTruthy();
      expect(m.inApp[s.app]).toBeTruthy();
    }
  });

  it('offers the website the next action only for a traveler it can serve', () => {
    const fine = { photoid: true, pass: true, accepted: true };
    expect(websiteAction('start', fine)).toBe('openWallet');
    expect(websiteAction('declined', fine)).toBe('openWallet');
    expect(websiteAction('shared', fine)).toBe('addPass');
    expect(websiteAction('passAdded', fine)).toBe('present');
    expect(websiteAction('gateDeclined', fine)).toBe('present');
    expect(websiteAction('start', { ...fine, photoid: false })).toBeNull();
    expect(websiteAction('shared', { ...fine, accepted: false })).toBeNull();
    expect(websiteAction('shared', { ...fine, pass: false })).toBeNull();
  });

  it('never offers a step that sends something, so the consent sheets stay in the way', () => {
    const fine = { photoid: true, pass: true, accepted: true };
    expect(websiteAction('asked', fine)).toBeNull();
    expect(websiteAction('gateAsked', fine)).toBeNull();
    expect(websiteAction('presented', fine)).toBeNull();
  });

  it('draws a line between each pair of stops, solid up to where the trip stands', () => {
    const legs = legsOf(stopIndex('shared'));
    expect(legs.length).toBe(STOPS.length - 1);
    expect(legs.map((l) => l.done)).toEqual([true, true, false, false, false]);
    // A line stays in its lane between two stops of one app, and turns between columns otherwise.
    expect(legs[0].d).toBe('M50 50 H100 V150 H150');
    expect(legs[3].d).toBe('M350 150 H450');
  });
});
