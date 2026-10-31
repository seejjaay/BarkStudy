import { describe, expect, it } from 'vitest';
import { ALL_LINE_KEYS, GUILT_LINES, LAST_GUILT_LINES } from '../../src/engine/lines';
import { EN, say } from '../../src/shared/i18n/en';

describe('en', () => {
  it('every engine line key has text', () => {
    expect(ALL_LINE_KEYS).toHaveLength(51);
    for (const key of ALL_LINE_KEYS) {
      expect(typeof EN[key], key).toBe('string');
      expect(EN[key]!.trim(), key).not.toBe('');
    }
  });

  it('guilt lines take minutes', () => {
    for (const key of [...GUILT_LINES, ...LAST_GUILT_LINES]) expect(EN[key], key).toContain('{minutes}');
    const text = say(GUILT_LINES[0]!, { minutes: 6 });
    expect(text).toContain('6');
    expect(text).not.toContain('{');
  });

  it('only guilt lines carry a placeholder', () => {
    const guilt = new Set([...GUILT_LINES, ...LAST_GUILT_LINES]);
    for (const key of ALL_LINE_KEYS) if (!guilt.has(key)) expect(EN[key], key).not.toMatch(/[{}]/);
  });

  it('no line calls Pandesal she', () => {
    for (const [key, text] of Object.entries(EN)) expect(text, key).not.toMatch(/\b(she|her|hers)\b/i);
  });

  it('says a plain line as written', () => {
    const key = ALL_LINE_KEYS[0]!;
    expect(say(key)).toBe(EN[key]);
  });

  it('unknown key gives null', () => {
    expect(say('line.nope.1')).toBeNull();
    expect(say('')).toBeNull();
    // Object.prototype members are not lines.
    expect(say('toString')).toBeNull();
    expect(say('__proto__')).toBeNull();
  });
});
