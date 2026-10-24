import { describe, expect, it } from 'vitest';
import { allowed, applyIntent, INITIAL_RULES, ruleStep } from '../../src/engine/rules';
import type { Cap, RuleEvent, RuleState } from '../../src/engine/types';

const live: RuleState = { ...INITIAL_RULES, session: true };
const withCard = (over: Partial<RuleState> = {}): RuleState => ({ ...live, card: true, level: 1, ...over });
const run = (s: RuleState, e: RuleEvent) => ruleStep(s, e);
const unchanged = (s: RuleState, e: RuleEvent) => {
  const r = run(s, e);
  expect(r.state).toEqual(s);
  expect(r.required).toEqual([]);
  expect(r.intents).toEqual([]);
};

describe('CHECKIN_DUE', () => {
  it('CHECKIN_DUE shows a card and raises level 0 to 1', () => {
    const r = run(live, { type: 'CHECKIN_DUE' });
    expect(r.state).toMatchObject({ card: true, level: 1 });
    expect(r.intents).toEqual(['show-card']);
  });
  it('CHECKIN_DUE keeps a higher level', () => {
    expect(run({ ...live, level: 3 }, { type: 'CHECKIN_DUE' }).state.level).toBe(3);
  });
  it.each<[string, Partial<RuleState>]>([
    ['no session', { session: false }],
    ['paused', { paused: true }],
    ['stay', { stay: true }],
    ['card already showing', { card: true }],
    ['away', { activity: 'away' }],
    ['locked', { activity: 'locked' }],
    ['suppressed', { suppressed: true }],
  ])('CHECKIN_DUE ignored when %s', (_n, over) => {
    unchanged({ ...live, ...over }, { type: 'CHECKIN_DUE' });
  });
});

describe('CHECKIN_TIMEOUT', () => {
  it('CHECKIN_TIMEOUT 1 to 2 offers re-ask, follow-cursor, whine', () => {
    const r = run(withCard(), { type: 'CHECKIN_TIMEOUT' });
    expect(r.state.level).toBe(2);
    expect(r.intents).toEqual(['re-ask', 'follow-cursor', 'whine']);
  });
  it('CHECKIN_TIMEOUT 2 to 3 offers laps, whine', () => {
    const r = run(withCard({ level: 2 }), { type: 'CHECKIN_TIMEOUT' });
    expect(r.state.level).toBe(3);
    expect(r.intents).toEqual(['laps', 'whine']);
  });
  it('CHECKIN_TIMEOUT 3 to 4 offers dig-in', () => {
    const r = run(withCard({ level: 3 }), { type: 'CHECKIN_TIMEOUT' });
    expect(r.state.level).toBe(4);
    expect(r.intents).toEqual(['dig-in']);
  });
  it('CHECKIN_TIMEOUT 3 to 4 while dig-in is cooling offers laps, whine', () => {
    const r = run(withCard({ level: 3, digCooling: true }), { type: 'CHECKIN_TIMEOUT' });
    expect(r.state.level).toBe(4);
    expect(r.intents).toEqual(['laps', 'whine']);
  });
  it.each<[Cap, 2 | 3 | 4]>([
    [2, 2],
    [3, 3],
    [4, 4],
  ])('CHECKIN_TIMEOUT at the cap %i holds level and offers re-ask, whine', (cap, level) => {
    const r = run(withCard({ cap, level }), { type: 'CHECKIN_TIMEOUT' });
    expect(r.state.level).toBe(level);
    expect(r.intents).toEqual(['re-ask', 'whine']);
  });
  it('CHECKIN_TIMEOUT never raises above a cap of 2', () => {
    const r = run(withCard({ cap: 2 }), { type: 'CHECKIN_TIMEOUT' });
    expect(r.state.level).toBe(2);
    expect(r.intents).not.toContain('laps');
    expect(r.intents).not.toContain('dig-in');
  });
  it.each<[string, Partial<RuleState>]>([
    ['away', { activity: 'away' }],
    ['locked', { activity: 'locked' }],
    ['suppressed', { suppressed: true }],
  ])('CHECKIN_TIMEOUT while %s holds level, flags missedWhileAway, curls up', (_n, over) => {
    const r = run(withCard({ level: 2, ...over }), { type: 'CHECKIN_TIMEOUT' });
    expect(r.state).toMatchObject({ level: 2, missedWhileAway: true });
    expect(r.intents).toEqual(['curl-up']);
  });
  it.each<[string, Partial<RuleState>]>([
    ['no card', { card: false }],
    ['paused', { paused: true }],
    ['stay', { stay: true }],
  ])('CHECKIN_TIMEOUT ignored when %s', (_n, over) => {
    unchanged(withCard({ ...over }), { type: 'CHECKIN_TIMEOUT' });
  });
});

describe('ANSWER_SUBMITTED', () => {
  it('ANSWER_SUBMITTED correct resets level, ends the effect, awards a treat', () => {
    const r = run(withCard({ level: 3, effect: 'laps' }), { type: 'ANSWER_SUBMITTED', correct: true });
    expect(r.state).toMatchObject({ level: 0, card: false, effect: null });
    expect(r.required).toEqual([{ type: 'END_EFFECT' }, { type: 'AWARD_TREAT' }]);
    expect(r.intents).toEqual(['celebrate-small', 'celebrate-big']);
  });
  it('ANSWER_SUBMITTED correct with no effect emits no END_EFFECT', () => {
    const r = run(withCard(), { type: 'ANSWER_SUBMITTED', correct: true });
    expect(r.required).toEqual([{ type: 'AWARD_TREAT' }]);
  });
  it('wrong answer at level 3 -> level 0, no AWARD_TREAT', () => {
    const r = run(withCard({ level: 3 }), { type: 'ANSWER_SUBMITTED', correct: false });
    expect(r.state.level).toBe(0);
    expect(r.required).toEqual([]);
    expect(r.intents).toEqual(['calm']);
  });
  it('ANSWER_SUBMITTED ignored with no card', () => {
    unchanged(live, { type: 'ANSWER_SUBMITTED', correct: true });
  });
});

describe('USER_ACTIVITY', () => {
  it.each(['away', 'locked'] as const)('USER_ACTIVITY %s ends the effect and curls up', (state) => {
    const r = run(withCard({ level: 3, effect: 'laps' }), { type: 'USER_ACTIVITY', state });
    expect(r.state).toMatchObject({ activity: state, effect: null, level: 3 });
    expect(r.required).toEqual([{ type: 'END_EFFECT' }]);
    expect(r.intents).toEqual(['curl-up']);
  });
  it('USER_ACTIVITY away with no effect emits no END_EFFECT', () => {
    const r = run(live, { type: 'USER_ACTIVITY', state: 'away' });
    expect(r.required).toEqual([]);
  });
  it('USER_ACTIVITY active after a missed card greets and re-shows the card', () => {
    const r = run(withCard({ activity: 'away', missedWhileAway: true }), { type: 'USER_ACTIVITY', state: 'active' });
    expect(r.state).toMatchObject({ activity: 'active', missedWhileAway: false });
    expect(r.required).toEqual([{ type: 'SHOW_FLASHCARD' }]);
    expect(r.intents).toEqual(['greet-return']);
  });
  it('USER_ACTIVITY active after a missed card with no card just greets', () => {
    const r = run({ ...live, activity: 'away', missedWhileAway: true }, { type: 'USER_ACTIVITY', state: 'active' });
    expect(r.required).toEqual([]);
    expect(r.intents).toEqual(['greet-return']);
  });
  it('USER_ACTIVITY active while paused greets without re-showing the card', () => {
    const r = run(withCard({ activity: 'away', missedWhileAway: true, paused: true }), {
      type: 'USER_ACTIVITY',
      state: 'active',
    });
    expect(r.required).toEqual([]);
  });
  it('USER_ACTIVITY active while suppressed greets without re-showing the card', () => {
    const r = run(withCard({ activity: 'away', missedWhileAway: true, suppressed: true }), {
      type: 'USER_ACTIVITY',
      state: 'active',
    });
    expect(r.required).toEqual([]);
  });
  it('USER_ACTIVITY active with nothing missed only records activity', () => {
    const r = run({ ...live, activity: 'away' }, { type: 'USER_ACTIVITY', state: 'active' });
    expect(r.state).toEqual({ ...live, activity: 'active' });
    expect(r.required).toEqual([]);
    expect(r.intents).toEqual([]);
  });
});

describe('STAY / PAUSE', () => {
  it('STAY_ON clears the card, effect and level and sits', () => {
    const r = run(withCard({ level: 3, effect: 'laps' }), { type: 'STAY_ON', durationMs: 60_000 });
    expect(r.state).toMatchObject({ stay: true, card: false, effect: null, level: 0 });
    expect(r.required).toEqual([{ type: 'END_EFFECT' }]);
    expect(r.intents).toEqual(['sit-stay']);
  });
  it.each(['STAY_OFF', 'STAY_EXPIRED'] as const)('%s clears stay', (type) => {
    const r = run({ ...live, stay: true }, { type });
    expect(r.state.stay).toBe(false);
  });
  it.each(['STAY_OFF', 'STAY_EXPIRED'] as const)('%s without stay changes nothing', (type) => {
    unchanged(live, { type });
  });
  it('PAUSE ends the effect and keeps the level', () => {
    const r = run(withCard({ level: 3, effect: 'laps' }), { type: 'PAUSE' });
    expect(r.state).toMatchObject({ paused: true, effect: null, level: 3 });
    expect(r.required).toEqual([{ type: 'END_EFFECT' }]);
  });
  it('RESUME clears pause', () => {
    expect(run({ ...live, paused: true }, { type: 'RESUME' }).state.paused).toBe(false);
  });
});

describe('effect lifecycle', () => {
  it.each(['ESC_PRESSED', 'EFFECT_EXPIRED'] as const)('%s ends a running effect and keeps the level', (type) => {
    const r = run(withCard({ level: 4, effect: 'dig-in', digCooling: true }), { type });
    expect(r.state).toMatchObject({ effect: null, level: 4, digCooling: true });
    expect(r.required).toEqual([{ type: 'END_EFFECT' }]);
  });
  it.each(['ESC_PRESSED', 'EFFECT_EXPIRED'] as const)('%s with no effect changes nothing', (type) => {
    unchanged(withCard(), { type });
  });
  it('DIG_COOLDOWN_EXPIRED clears digCooling', () => {
    expect(run({ ...live, digCooling: true }, { type: 'DIG_COOLDOWN_EXPIRED' }).state.digCooling).toBe(false);
  });
  it('SUPPRESS_CHANGED on ends the effect', () => {
    const r = run(withCard({ effect: 'laps', level: 3 }), { type: 'SUPPRESS_CHANGED', on: true });
    expect(r.state).toMatchObject({ suppressed: true, effect: null, level: 3 });
    expect(r.required).toEqual([{ type: 'END_EFFECT' }]);
  });
  it('SUPPRESS_CHANGED off lifts suppression', () => {
    const r = run({ ...live, suppressed: true }, { type: 'SUPPRESS_CHANGED', on: false });
    expect(r.state.suppressed).toBe(false);
    expect(r.required).toEqual([]);
  });
});

describe('CAP_CHANGED', () => {
  it('CAP_CHANGED clamps the level', () => {
    expect(run(withCard({ level: 4 }), { type: 'CAP_CHANGED', cap: 2 }).state).toMatchObject({ cap: 2, level: 2 });
  });
  it('CAP_CHANGED clears a dig-in the new cap forbids', () => {
    const r = run(withCard({ level: 4, effect: 'dig-in' }), { type: 'CAP_CHANGED', cap: 3 });
    expect(r.state).toMatchObject({ cap: 3, level: 3, effect: null });
    expect(r.required).toEqual([{ type: 'END_EFFECT' }]);
  });
  it('CAP_CHANGED keeps laps when the new cap still allows them', () => {
    const r = run(withCard({ level: 3, effect: 'laps' }), { type: 'CAP_CHANGED', cap: 3 });
    expect(r.state.effect).toBe('laps');
    expect(r.required).toEqual([]);
  });
  it('CAP_CHANGED to 2 clears laps', () => {
    expect(run(withCard({ level: 3, effect: 'laps' }), { type: 'CAP_CHANGED', cap: 2 }).state.effect).toBeNull();
  });
});

describe('SESSION_START / END', () => {
  it('SESSION_START resets to initial with the cap from the event', () => {
    const r = run({ ...INITIAL_RULES, level: 3, paused: true }, { type: 'SESSION_START', cap: 2 });
    expect(r.state).toEqual({ ...INITIAL_RULES, session: true, cap: 2 });
  });
  it('SESSION_START over a running effect ends it', () => {
    const r = run(withCard({ level: 3, effect: 'laps' }), { type: 'SESSION_START', cap: 4 });
    expect(r.state.effect).toBeNull();
    expect(r.required).toEqual([{ type: 'END_EFFECT' }]);
  });
  it('SESSION_END resets to initial and ends a running effect', () => {
    const r = run(withCard({ level: 3, effect: 'laps' }), { type: 'SESSION_END' });
    expect(r.state).toEqual(INITIAL_RULES);
    expect(r.required).toEqual([{ type: 'END_EFFECT' }]);
  });
});

describe('applyIntent and allowed', () => {
  it('applyIntent laps starts laps', () => {
    expect(applyIntent(live, 'laps').effect).toBe('laps');
  });
  it('applyIntent dig-in starts dig-in and the cooldown', () => {
    expect(applyIntent(live, 'dig-in')).toMatchObject({ effect: 'dig-in', digCooling: true });
  });
  it('applyIntent leaves state alone for other intents', () => {
    expect(applyIntent(live, 'whine')).toEqual(live);
  });
  it('cap 2 never offers laps or dig-in', () => {
    // Walk repeated timeouts from level 1 under cap 2.
    let s = withCard({ cap: 2 });
    for (let i = 0; i < 6; i++) {
      const r = run(s, { type: 'CHECKIN_TIMEOUT' });
      expect(r.intents).not.toContain('laps');
      expect(r.intents).not.toContain('dig-in');
      s = r.state;
    }
  });
  it('allowed: laps needs cap >= 3, dig-in needs cap 4, null always', () => {
    expect([allowed('laps', 2), allowed('laps', 3), allowed('dig-in', 3), allowed('dig-in', 4), allowed(null, 2)]).toEqual([
      false,
      true,
      false,
      true,
      true,
    ]);
  });
});
