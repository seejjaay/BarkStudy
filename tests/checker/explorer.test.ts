import { describe, expect, it } from 'vitest';
import { INVARIANTS } from '../../src/engine/invariants';
import { applyIntent, ruleStep } from '../../src/engine/rules';
import { canAlwaysReach, explore, reachableStates } from './explorer';

describe('rule-layer explorer', () => {
  it('explores every reachable rule state with zero violations', () => {
    const r = explore(ruleStep, applyIntent, INVARIANTS);
    expect(r.violation, JSON.stringify(r.violation, null, 1)).toBeNull();
    // Sanity floor against a degenerate explorer; the real rule layer reaches 808 states.
    expect(r.states).toBeGreaterThan(500);
    expect(r.transitions).toBeGreaterThan(r.states);
  });

  it('canAlwaysReach(level 0 && effect null) from every reachable state', () => {
    const r = canAlwaysReach(ruleStep, applyIntent, (s) => s.level === 0 && s.effect === null);
    expect(r.stuck).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('PAUSE from any reachable state yields no effect', () => {
    for (const s of reachableStates(ruleStep, applyIntent)) {
      const r = ruleStep(s, { type: 'PAUSE' });
      expect(r.state.effect).toBeNull();
      expect(r.required.some((a) => a.type === 'END_EFFECT')).toBe(s.effect !== null);
    }
  });

  it('every invariant has a distinct id', () => {
    const ids = INVARIANTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'QUIET',
      'LEVEL_BOUNDS',
      'CAP',
      'DIG_ONCE',
      'WRONG_NO_RAISE',
      'ESC_ENDS',
      'AWAY_NO_RAISE',
      'NO_SESSION_QUIET',
    ]);
  });
});
