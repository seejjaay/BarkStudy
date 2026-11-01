import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineHost, type EngineHost, type HostSink } from '../../src/main/engineHost';
import { newCard } from '../../src/shared/srs';

// Only this file replaces `step`, so a throwing engine can be made on demand without touching the other host tests.
const control = vi.hoisted(() => ({ throwOn: null as string | null }));
vi.mock('../../src/engine/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/engine')>();
  return {
    ...actual,
    step: ((...args: Parameters<typeof actual.step>) => {
      if (control.throwOn !== null && args[1].type === control.throwOn) throw new Error('engine blew up');
      return actual.step(...args);
    }) as typeof actual.step,
  };
});

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const sink: HostSink = {
  showCard: () => undefined,
  hideCard: () => undefined,
  say: () => undefined,
  expression: () => undefined,
  walkTo: () => undefined,
  effect: () => undefined,
  treat: () => undefined,
  guiltTrip: () => undefined,
};

let host: EngineHost | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  control.throwOn = null;
  host?.dispose();
  host = null;
  vi.useRealTimers();
});

describe('a diagnostics log of a session whose engine throws', () => {
  it('still ends with the event that made it throw, so a replay can reach the crash', () => {
    host = createEngineHost({ seed: 7, sink, onReviewed: () => undefined });
    host.start({ cards: [newCard('c1', 'front', 'back', T0)], cap: 4, preset: 'classic', checkinMinMinutes: 60, checkinMaxMinutes: 60 });
    control.throwOn = 'PAUSE';
    expect(() => host!.dispatch({ type: 'PAUSE' })).toThrow('engine blew up');
    expect(host.diagnostics()!.entries.at(-1)?.type).toBe('PAUSE');
  });
});
