import { describe, expect, it } from 'vitest';
import { MOOD_HOLD_MS, moodFromExpression } from '../../src/shared/mood';

const ENGINE_EXPRESSIONS = [
  'wander',
  'nap',
  'curious',
  'pleading',
  'follow-cursor',
  'whine',
  'zoomies',
  'dig',
  'happy',
  'ecstatic',
  'calm',
  'sulk',
  'greet',
  'sit',
] as const;

describe('moods', () => {
  it.each(ENGINE_EXPRESSIONS)('the engine expression %s maps to itself', (name) => {
    expect(moodFromExpression(name)).toBe(name);
  });

  it('maps an unknown or empty expression to idle', () => {
    expect(moodFromExpression('unknown')).toBe('idle');
    expect(moodFromExpression('')).toBe('idle');
  });

  it('holds the reaction moods for a fixed time', () => {
    expect(MOOD_HOLD_MS.sulk).toBe(4000);
    expect(MOOD_HOLD_MS.happy).toBe(2000);
    expect(MOOD_HOLD_MS.ecstatic).toBe(2000);
    expect(MOOD_HOLD_MS.greet).toBe(2000);
  });
});
