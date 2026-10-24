import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ALL_LINE_KEYS, GUILT_LINES, INTENT_LINES, LAST_GUILT_LINES } from '../../src/engine/lines';
import { chooseIntent, intentToActions } from '../../src/engine/personality';
import { createRng, type RngState } from '../../src/engine/rng';
import { INITIAL_RULES } from '../../src/engine/rules';
import { DEFAULT_TRAITS, DEFAULT_TUNING } from '../../src/engine/tuning';
import type { Action, Context, Intent, Traits } from '../../src/engine/types';

const ALL_INTENTS = Object.keys(INTENT_LINES) as Intent[];
const rules = { ...INITIAL_RULES, session: true };
const ctx: Context = {
  traits: DEFAULT_TRAITS,
  tuning: DEFAULT_TUNING,
  activeWindowId: 100,
  busy: false,
  lastGuiltMs: null,
};
const withTraits = (t: Partial<Traits>): Context => ({ ...ctx, traits: { ...DEFAULT_TRAITS, ...t } });

/** Share of `draws` picks that equal `target`. */
function share(intents: Intent[], target: Intent, c: Context, draws = 10_000, seed = 11): number {
  let rng: RngState = createRng(seed);
  let hits = 0;
  for (let i = 0; i < draws; i++) {
    const [picked, next] = chooseIntent(intents, rules, c, rng);
    if (picked === target) hits++;
    rng = next;
  }
  return hits / draws;
}

const traitArb = fc.record({
  neediness: fc.double({ min: 0, max: 1, noNaN: true }),
  drama: fc.double({ min: 0, max: 1, noNaN: true }),
  patience: fc.double({ min: 0, max: 1, noNaN: true }),
  zoominess: fc.double({ min: 0, max: 1, noNaN: true }),
});

describe('chooseIntent', () => {
  it('chosen intent always ∈ intents', () => {
    fc.assert(
      fc.property(
        fc.subarray(ALL_INTENTS, { minLength: 1 }),
        traitArb,
        fc.integer(),
        fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
        (intents, traits, seed, windowId) => {
          const c: Context = { ...ctx, traits, activeWindowId: windowId };
          const [picked] = chooseIntent(intents, rules, c, createRng(seed));
          if (windowId !== null) {
            expect(intents).toContain(picked);
          } else {
            expect(picked === 'laps' || picked === 'dig-in').toBe(false);
            const rest = intents.filter((i) => i !== 'laps' && i !== 'dig-in');
            // Anything that cannot run degrades to whine.
            expect(rest.length > 0 ? rest : ['whine']).toContain(picked);
          }
        },
      ),
    );
  });

  it('zoominess 1 → celebrate-big ≥ 70% over 10k; zoominess 0 → ≤ 30%', () => {
    const both: Intent[] = ['celebrate-small', 'celebrate-big'];
    expect(share(both, 'celebrate-big', withTraits({ zoominess: 1 }))).toBeGreaterThanOrEqual(0.7);
    expect(share(both, 'celebrate-big', withTraits({ zoominess: 0 }))).toBeLessThanOrEqual(0.3);
  });

  it('neediness favours whine and follow-cursor over re-ask', () => {
    const three: Intent[] = ['re-ask', 'follow-cursor', 'whine'];
    expect(share(three, 're-ask', withTraits({ neediness: 1 }))).toBeLessThan(0.3);
    expect(share(three, 're-ask', withTraits({ neediness: 0 }))).toBeGreaterThan(0.45);
  });

  it('drama favours sulk', () => {
    const two: Intent[] = ['calm', 'sulk'];
    expect(share(two, 'sulk', withTraits({ drama: 1 }))).toBeGreaterThan(share(two, 'sulk', withTraits({ drama: 0 })) + 0.3);
  });

  it('a zero-weight trait combination still picks something', () => {
    const [picked] = chooseIntent(['sulk'], rules, withTraits({ drama: 0 }), createRng(1));
    expect(picked).toBe('sulk');
  });

  it('same rng gives the same pick and does not mutate it', () => {
    const rng = createRng(3);
    const before = { ...rng };
    const a = chooseIntent(['re-ask', 'whine'], rules, ctx, rng);
    const b = chooseIntent(['re-ask', 'whine'], rules, ctx, rng);
    expect(a).toEqual(b);
    expect(rng).toEqual(before);
  });
});

describe('intentToActions', () => {
  const act = (i: Intent, c: Context = ctx, waited: number | null = null): Action[] =>
    intentToActions(i, rules, c, createRng(5), waited)[0];

  it('null activeWindowId emits no RUN_LAPS/START_DIG_IN', () => {
    const noWindow = { ...ctx, activeWindowId: null };
    for (const i of ALL_INTENTS) {
      const types = act(i, noWindow).map((a) => a.type);
      expect(types).not.toContain('RUN_LAPS');
      expect(types).not.toContain('START_DIG_IN');
    }
  });

  it('laps and dig-in target the active window', () => {
    expect(act('laps')).toContainEqual({ type: 'RUN_LAPS', windowId: 100 });
    expect(act('dig-in')).toContainEqual({ type: 'START_DIG_IN', windowId: 100 });
  });

  it('show-card shows the flashcard', () => {
    expect(act('show-card')).toContainEqual({ type: 'SHOW_FLASHCARD' });
  });

  it('curl-up curls up', () => {
    expect(act('curl-up')).toContainEqual({ type: 'CURL_UP' });
  });

  it('guilt line params: 360000ms → {minutes: 6}', () => {
    const say = act('celebrate-small', ctx, 360_000).find((a) => a.type === 'SAY');
    expect(say).toBeDefined();
    expect(GUILT_LINES).toContain((say as Extract<Action, { type: 'SAY' }>).line);
    expect((say as Extract<Action, { type: 'SAY' }>).params).toEqual({ minutes: 6 });
  });

  it('no guilt line when waited is under the threshold', () => {
    const say = act('celebrate-small', ctx, DEFAULT_TUNING.guiltThresholdMs - 1).find((a) => a.type === 'SAY');
    expect(GUILT_LINES).not.toContain((say as Extract<Action, { type: 'SAY' }>).line);
  });

  it('greeting after a guilt trip mentions how long the user was gone', () => {
    const say = act('greet-return', { ...ctx, lastGuiltMs: 360_000 }).find((a) => a.type === 'SAY');
    expect(LAST_GUILT_LINES).toContain((say as Extract<Action, { type: 'SAY' }>).line);
    expect((say as Extract<Action, { type: 'SAY' }>).params).toEqual({ minutes: 6 });
  });

  it('same rng gives the same actions and does not mutate it', () => {
    const rng = createRng(8);
    const before = { ...rng };
    expect(intentToActions('whine', rules, ctx, rng, null)).toEqual(intentToActions('whine', rules, ctx, rng, null));
    expect(rng).toEqual(before);
  });
});

describe('lines', () => {
  it('every intent has at least 3 distinct line variants', () => {
    for (const i of ALL_INTENTS) {
      expect(new Set(INTENT_LINES[i]).size, i).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(GUILT_LINES).size).toBeGreaterThanOrEqual(3);
    expect(new Set(LAST_GUILT_LINES).size).toBeGreaterThanOrEqual(3);
  });

  it('line keys are unique and namespaced', () => {
    expect(new Set(ALL_LINE_KEYS).size).toBe(ALL_LINE_KEYS.length);
    expect(ALL_LINE_KEYS.every((k) => k.startsWith('line.'))).toBe(true);
  });

  it('covers every Intent', () => {
    expect(ALL_INTENTS.length).toBe(15);
  });
});
