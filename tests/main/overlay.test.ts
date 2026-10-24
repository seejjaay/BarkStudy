import { describe, expect, it } from 'vitest';
import { isHitMessage } from '../../src/shared/ipc';

describe('isHitMessage', () => {
  it('accepts only booleans', () => {
    expect(isHitMessage(true)).toBe(true);
    expect(isHitMessage(false)).toBe(true);
    for (const bad of [1, 0, 'true', null, undefined, {}, [], { over: true }]) expect(isHitMessage(bad)).toBe(false);
  });
});
