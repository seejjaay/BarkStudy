import { describe, expect, it } from 'vitest';
import type { Mood } from '../../src/shared/mood';
import { MAX_SOUND_MS, RECIPES, recipeLengthMs, soundFor, type SoundName } from '../../src/shared/sounds';

const NAMES: SoundName[] = ['bark', 'whine', 'yip', 'scratch'];

describe('sound recipes', () => {
  it('there is one recipe per sound name', () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...NAMES].sort());
  });

  it('every recipe is under 1.5 s and has parts', () => {
    expect(MAX_SOUND_MS).toBe(1500);
    for (const name of NAMES) {
      const r = RECIPES[name];
      expect(r.parts.length, name).toBeGreaterThan(0);
      expect(recipeLengthMs(r), name).toBeGreaterThan(0);
      expect(recipeLengthMs(r), name).toBeLessThan(MAX_SOUND_MS);
    }
  });

  it('every part is well formed: it starts at or after 0, lasts, is audible but not over full scale, and a tone has a pitch', () => {
    for (const name of NAMES) {
      for (const p of RECIPES[name].parts) {
        expect(p.startMs, name).toBeGreaterThanOrEqual(0);
        expect(p.durationMs, name).toBeGreaterThan(0);
        expect(p.gain, name).toBeGreaterThan(0);
        expect(p.gain, name).toBeLessThanOrEqual(1);
        if (p.kind === 'tone') expect(p.freqHz, name).toBeGreaterThan(0);
        if (p.freqHz !== undefined) expect(p.freqHz, name).toBeGreaterThan(0);
        if (p.freqEndHz !== undefined) expect(p.freqEndHz, name).toBeGreaterThan(0);
      }
    }
  });

  it('recipeLengthMs is when the last part ends', () => {
    expect(
      recipeLengthMs({
        parts: [
          { kind: 'tone', startMs: 0, durationMs: 100, freqHz: 400, gain: 0.5 },
          { kind: 'noise', startMs: 250, durationMs: 80, gain: 0.5 },
        ],
      }),
    ).toBe(330);
    expect(recipeLengthMs({ parts: [] })).toBe(0);
  });
});

describe('soundFor', () => {
  it('maps each trigger, and nothing else', () => {
    expect(soundFor({ kind: 'effect', effect: 'laps' })).toBe('bark');
    expect(soundFor({ kind: 'effect', effect: 'dig' })).toBe('scratch');
    const byMood: Record<Mood, SoundName | null> = {
      idle: null,
      wander: null,
      nap: null,
      curious: null,
      pleading: null,
      'follow-cursor': null,
      whine: 'whine',
      zoomies: null,
      dig: null,
      happy: 'yip',
      ecstatic: 'yip',
      calm: null,
      sulk: null,
      greet: null,
      sit: null,
    };
    for (const [mood, sound] of Object.entries(byMood) as [Mood, SoundName | null][]) {
      expect(soundFor({ kind: 'mood', mood }), mood).toBe(sound);
    }
  });
});
