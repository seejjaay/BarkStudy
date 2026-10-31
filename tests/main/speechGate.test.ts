import { describe, expect, it } from 'vitest';
import { GUILT_LINES, INTENT_LINES, LAST_GUILT_LINES } from '../../src/engine/lines';
import { createSpeechGate, SPEECH_MIN_GAP_MS } from '../../src/main/speechGate';

function fakeClock(start = 1_000_000) {
  let now = start;
  return { clock: { now: () => now }, advance: (ms: number) => (now += ms) };
}

const PRIORITY = [
  ...GUILT_LINES,
  ...LAST_GUILT_LINES,
  ...INTENT_LINES['greet-return'],
  ...INTENT_LINES['celebrate-small'],
  ...INTENT_LINES['celebrate-big'],
  ...INTENT_LINES['calm'],
];

describe('speechGate', () => {
  it('the gap is 30 s', () => {
    expect(SPEECH_MIN_GAP_MS).toBe(30_000);
  });

  it('priority lines always pass', () => {
    const { clock } = fakeClock();
    const gate = createSpeechGate(clock);
    for (const key of PRIORITY) {
      expect(gate.pass(key), key).toBe(true);
      expect(gate.pass(key), `${key} again`).toBe(true);
    }
  });

  it('other lines pass at most once per 30 s', () => {
    const { clock, advance } = fakeClock();
    const gate = createSpeechGate(clock);
    expect(gate.pass('line.whine.1')).toBe(true);
    advance(10_000);
    expect(gate.pass('line.whine.1')).toBe(false);
    advance(21_000); // 31 s since the line that passed
    expect(gate.pass('line.whine.1')).toBe(true);
  });

  it('the gap is shared by every non-priority line', () => {
    const { clock, advance } = fakeClock();
    const gate = createSpeechGate(clock);
    expect(gate.pass('line.nap.1')).toBe(true);
    advance(5_000);
    expect(gate.pass('line.laps.2')).toBe(false);
    advance(25_000); // exactly 30 s
    expect(gate.pass('line.laps.2')).toBe(true);
  });

  it('a refused line does not push the gap out', () => {
    const { clock, advance } = fakeClock();
    const gate = createSpeechGate(clock);
    expect(gate.pass('line.nap.1')).toBe(true);
    advance(20_000);
    expect(gate.pass('line.nap.2')).toBe(false);
    advance(10_000); // 30 s after the line that passed, 10 s after the refused one
    expect(gate.pass('line.nap.3')).toBe(true);
  });

  it('a priority line does not use up the gap', () => {
    const { clock, advance } = fakeClock();
    const gate = createSpeechGate(clock);
    expect(gate.pass(GUILT_LINES[0]!)).toBe(true);
    advance(1_000);
    expect(gate.pass('line.whine.1')).toBe(true);
  });

  it('works on the real clock when none is given', () => {
    const gate = createSpeechGate();
    expect(gate.pass('line.whine.1')).toBe(true);
    expect(gate.pass('line.whine.1')).toBe(false);
  });
});
