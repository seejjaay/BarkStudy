import { describe, expect, it } from 'vitest';
import { createDebugRecorder } from '../../src/main/debug';
import type { DogFrame } from '../../src/shared/ipc';

const frame = (over: Partial<DogFrame> = {}): DogFrame => ({ x: 0, y: 0, facing: 1, pose: 'sit', mood: 'idle', clip: [], reducedMotion: false, ...over });
const effect = (kind: 'laps' | 'dig') => ({ kind, seed: 1, elapsedMs: 0, rect: { x: 0, y: 0, width: 10, height: 10 } });

describe('the e2e debug recorder', () => {
  it('logs only changes of mood, pose or effect, skipping null frames', () => {
    const r = createDebugRecorder();
    r.frame(frame());
    r.frame(frame({ x: 50 })); // moved, nothing else changed
    r.frame(null);
    r.frame(frame({ mood: 'zoomies', pose: 'run', effect: effect('laps') }));
    r.frame(frame({ mood: 'zoomies', pose: 'run', effect: { ...effect('laps'), elapsedMs: 16 } }));
    r.frame(frame({ mood: 'dig', pose: 'dig', effect: effect('dig') }));
    r.frame(frame());
    expect(r.moodLog()).toEqual([
      { mood: 'idle', pose: 'sit', effect: null },
      { mood: 'zoomies', pose: 'run', effect: 'laps' },
      { mood: 'dig', pose: 'dig', effect: 'dig' },
      { mood: 'idle', pose: 'sit', effect: null },
    ]);
  });

  it('keeps the last entries up to its capacity', () => {
    const r = createDebugRecorder(3);
    for (const mood of ['idle', 'curious', 'whine', 'happy'] as const) r.frame(frame({ mood }));
    for (let id = 1; id <= 5; id++) r.speech({ key: 'line', id });
    expect(r.moodLog().map((m) => m.mood)).toEqual(['curious', 'whine', 'happy']);
    expect(r.speechLog().map((l) => l.id)).toEqual([3, 4, 5]);
  });

  it('presses a registered shortcut, and nothing once it is released or if it could not be registered', () => {
    const r = createDebugRecorder();
    const taken = new Set(['Ctrl+Taken']);
    const inner = { register: (a: string) => !taken.has(a), unregister: () => undefined };
    const keys = r.hotkeys(inner);
    let presses = 0;
    expect(keys.register('Escape', () => presses++)).toBe(true);
    expect(keys.register('Ctrl+Taken', () => presses++)).toBe(false);
    expect(r.press('Escape')).toBe(true);
    expect(r.press('Ctrl+Taken')).toBe(false);
    keys.unregister('Escape');
    expect(r.press('Escape')).toBe(false);
    expect(presses).toBe(1);
  });
});
