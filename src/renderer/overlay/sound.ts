import { MAX_SOUND_MS, RECIPES, type SoundName, type SoundPart } from '../../shared/sounds';

/**
 * Where Pandesal's sounds come out. The synthesizer below is a placeholder: it builds each recipe from oscillators and
 * noise, so real audio can replace it by implementing `SoundBank` and nothing else needs to change.
 *
 * The caller decides whether a sound should play at all (main's sound gate, and only the overlay that has him); this
 * file just plays what it is told, and never makes a noise or an error it was not asked for.
 */
export interface SoundBank {
  /** Plays the sound once at `volume` (0..1). Never throws; if audio is unavailable it does nothing. */
  play: (name: SoundName, volume: number) => void;
}

const ATTACK_S = 0.01;

/** The one context, made on the first play. Overlays are created with `autoplayPolicy: 'no-user-gesture-required'`, so it starts running. */
export function createSynthSoundBank(makeContext: () => AudioContext = () => new AudioContext()): SoundBank {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let broken = false;

  function giveUp(e: unknown): void {
    if (broken) return;
    broken = true; // silent from here on, and said once
    console.warn('overlay: sound is unavailable', e);
  }

  /** White noise from a fixed seed, as long as the longest sound allows. Each noise part plays it once from the start. */
  function noiseBuffer(c: AudioContext): AudioBuffer {
    if (noise) return noise;
    const length = Math.ceil((c.sampleRate * MAX_SOUND_MS) / 1000);
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    let x = 0x2545f491;
    for (let i = 0; i < length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      data[i] = ((x >>> 0) / 4294967296) * 2 - 1;
    }
    noise = buffer;
    return buffer;
  }

  /** One part as a one-shot source through its own envelope. It is stopped at its end, never loops, and is freed when it ends. */
  function schedule(c: AudioContext, part: SoundPart, peak: number, origin: number): void {
    const start = origin + part.startMs / 1000;
    const end = start + part.durationMs / 1000;

    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peak, start + Math.min(ATTACK_S, (end - start) / 4));
    envelope.gain.linearRampToValueAtTime(0, end);
    envelope.connect(c.destination);

    let source: OscillatorNode | AudioBufferSourceNode;
    let filter: BiquadFilterNode | null = null;
    if (part.kind === 'tone') {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(part.freqHz ?? 440, start);
      if (part.freqEndHz !== undefined) osc.frequency.linearRampToValueAtTime(part.freqEndHz, end);
      source = osc;
    } else {
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c);
      if (part.freqHz !== undefined) {
        filter = c.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.setValueAtTime(1.2, start);
        filter.frequency.setValueAtTime(part.freqHz, start);
        if (part.freqEndHz !== undefined) filter.frequency.linearRampToValueAtTime(part.freqEndHz, end);
      }
      source = src;
    }

    if (filter) {
      source.connect(filter);
      filter.connect(envelope);
    } else {
      source.connect(envelope);
    }
    source.onended = () => {
      source.disconnect();
      filter?.disconnect();
      envelope.disconnect();
    };
    source.start(start);
    source.stop(end);
  }

  return {
    play(name, volume) {
      if (broken) return;
      try {
        ctx ??= makeContext();
        if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
        const level = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
        const origin = ctx.currentTime;
        for (const part of RECIPES[name].parts) schedule(ctx, part, part.gain * level, origin);
      } catch (e) {
        giveUp(e);
      }
    },
  };
}
