import { describe, expect, it } from 'vitest';
import { createSoundGate, SOUND_MIN_GAP_MS } from '../../src/main/soundGate';

function fakeClock(start = 1_000_000) {
  let now = start;
  return { clock: { now: () => now }, advance: (ms: number) => (now += ms) };
}

const open = { soundOn: true, volume: 0.4, quiet: false };

describe('soundGate', () => {
  it('the gap is 3 s', () => {
    expect(SOUND_MIN_GAP_MS).toBe(3000);
  });

  it('lets a sound through when sound is on, loud enough and not quiet', () => {
    const { clock } = fakeClock();
    expect(createSoundGate(clock).pass('bark', open)).toBe(true);
  });

  it('sound off plays nothing', () => {
    const { clock } = fakeClock();
    expect(createSoundGate(clock).pass('bark', { ...open, soundOn: false })).toBe(false);
  });

  it('quiet plays nothing', () => {
    const { clock } = fakeClock();
    expect(createSoundGate(clock).pass('bark', { ...open, quiet: true })).toBe(false);
  });

  it('volume 0 plays nothing', () => {
    const { clock } = fakeClock();
    expect(createSoundGate(clock).pass('bark', { ...open, volume: 0 })).toBe(false);
  });

  it('a second sound within 3 s is dropped, and after 3 s it plays', () => {
    const { clock, advance } = fakeClock();
    const gate = createSoundGate(clock);
    expect(gate.pass('bark', open)).toBe(true);
    advance(1000);
    expect(gate.pass('yip', open)).toBe(false);
    advance(1999);
    expect(gate.pass('yip', open)).toBe(false);
    advance(1); // exactly 3 s since the bark
    expect(gate.pass('yip', open)).toBe(true);
  });

  it('a dropped sound does not push the gap out', () => {
    const { clock, advance } = fakeClock();
    const gate = createSoundGate(clock);
    expect(gate.pass('bark', open)).toBe(true);
    advance(2000);
    expect(gate.pass('whine', open)).toBe(false);
    advance(1000); // 3 s after the bark, 1 s after the dropped whine
    expect(gate.pass('whine', open)).toBe(true);
  });

  it('a sound refused for being quiet, off or silent does not use up the gap', () => {
    const { clock } = fakeClock();
    const gate = createSoundGate(clock);
    expect(gate.pass('bark', { ...open, quiet: true })).toBe(false);
    expect(gate.pass('bark', { ...open, soundOn: false })).toBe(false);
    expect(gate.pass('bark', { ...open, volume: 0 })).toBe(false);
    expect(gate.pass('bark', open)).toBe(true);
  });

  it('works on the real clock when none is given', () => {
    const gate = createSoundGate();
    expect(gate.pass('bark', open)).toBe(true);
    expect(gate.pass('bark', open)).toBe(false);
  });
});
