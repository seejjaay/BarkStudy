import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSynthSoundBank } from '../../src/renderer/overlay/sound';
import { MAX_SOUND_MS, RECIPES, type SoundName } from '../../src/shared/sounds';

// A stand-in for the Web Audio nodes that records what was scheduled. It stands in for the whole API surface the
// synthesizer touches, so what is checked here is the rules (one context, one-shot nodes, hard stops, no loops, silent
// on failure), not how it sounds.

interface FakeNode {
  kind: 'osc' | 'noise' | 'gain' | 'filter';
  started: number[];
  stopped: number[];
  loop: unknown;
  connected: unknown[];
  disconnected: boolean;
  onended: (() => void) | null;
  type?: string;
  buffer?: { length: number } | null;
  gain: { ramps: number[] };
}

function fakeAudio() {
  const nodes: FakeNode[] = [];
  const param = () => {
    const p = { ramps: [] as number[], setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn((v: number) => p.ramps.push(v)), value: 0 };
    return p;
  };
  const node = (kind: FakeNode['kind']): FakeNode & Record<string, unknown> => {
    const n: FakeNode & Record<string, unknown> = {
      kind,
      started: [],
      stopped: [],
      loop: undefined,
      connected: [],
      disconnected: false,
      onended: null,
      connect: vi.fn((to: unknown) => n.connected.push(to)),
      disconnect: vi.fn(() => (n.disconnected = true)),
      start: vi.fn((t: number) => n.started.push(t)),
      stop: vi.fn((t: number) => n.stopped.push(t)),
      gain: param(),
      frequency: param(),
      Q: param(),
    };
    nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: 10,
    sampleRate: 1000,
    state: 'running' as string,
    destination: { dest: true },
    createGain: () => node('gain'),
    createOscillator: () => node('osc'),
    createBufferSource: () => node('noise'),
    createBiquadFilter: () => node('filter'),
    createBuffer: vi.fn((_channels: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) })),
    resume: vi.fn(() => Promise.resolve()),
  };
  return { ctx, nodes, make: vi.fn(() => ctx as unknown as AudioContext) };
}

const sources = (nodes: FakeNode[]) => nodes.filter((n) => n.kind === 'osc' || n.kind === 'noise');

afterEach(() => vi.restoreAllMocks());

describe('createSynthSoundBank', () => {
  it('makes no audio context until the first play, and only one for all of them', () => {
    const { make } = fakeAudio();
    const bank = createSynthSoundBank(make);
    expect(make).not.toHaveBeenCalled();
    bank.play('bark', 0.4);
    bank.play('yip', 0.4);
    bank.play('scratch', 0.4);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it.each(['bark', 'whine', 'yip', 'scratch'] as SoundName[])('%s: every part is a one-shot source that is started and then hard-stopped at its end, with no loop', (name) => {
    const { nodes, make, ctx } = fakeAudio();
    createSynthSoundBank(make).play(name, 0.5);
    const src = sources(nodes);
    expect(src).toHaveLength(RECIPES[name].parts.length);
    src.forEach((n, i) => {
      const part = RECIPES[name].parts[i]!;
      expect(n.started, name).toEqual([ctx.currentTime + part.startMs / 1000]);
      expect(n.stopped, name).toHaveLength(1);
      expect(n.stopped[0]! - n.started[0]!, name).toBeCloseTo(part.durationMs / 1000, 6);
      expect(n.stopped[0]! - ctx.currentTime, name).toBeLessThan(MAX_SOUND_MS / 1000);
      expect(n.loop, name).toBeUndefined();
    });
  });

  it('scales every part by the volume, and clamps a volume outside 0..1', () => {
    const peaks = (volume: number) => {
      const { nodes, make } = fakeAudio();
      createSynthSoundBank(make).play('bark', volume);
      return nodes.filter((n) => n.kind === 'gain').map((n) => Math.max(...n.gain.ramps));
    };
    const half = peaks(0.5);
    const full = peaks(1);
    half.forEach((p, i) => expect(p).toBeCloseTo(full[i]! / 2, 6));
    expect(peaks(7)).toEqual(full);
    expect(peaks(-1).every((p) => p === 0)).toBe(true);
    expect(peaks(Number.NaN).every((p) => p === 0)).toBe(true);
  });

  it('frees a source and its envelope once it ends', () => {
    const { nodes, make } = fakeAudio();
    createSynthSoundBank(make).play('yip', 0.4);
    const first = sources(nodes)[0]!;
    expect(first.disconnected).toBe(false);
    first.onended?.();
    expect(first.disconnected).toBe(true);
  });

  it('nudges a suspended context awake', () => {
    const { ctx, make } = fakeAudio();
    ctx.state = 'suspended';
    createSynthSoundBank(make).play('bark', 0.4);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('a context that cannot be made is logged once, never throws, and stays silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const make = vi.fn(() => {
      throw new Error('no audio device');
    });
    const bank = createSynthSoundBank(make);
    expect(() => bank.play('bark', 0.4)).not.toThrow();
    expect(() => bank.play('yip', 0.4)).not.toThrow();
    expect(() => bank.play('whine', 0.4)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledTimes(1); // it does not keep retrying
  });

  it('a context that breaks while scheduling is logged once, never throws, and stays silent after', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { ctx, make } = fakeAudio();
    ctx.createOscillator = () => {
      throw new Error('InvalidStateError');
    };
    const bank = createSynthSoundBank(make);
    expect(() => bank.play('bark', 0.4)).not.toThrow();
    expect(() => bank.play('bark', 0.4)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
