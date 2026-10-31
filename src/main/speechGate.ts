import { GUILT_LINES, INTENT_LINES, LAST_GUILT_LINES } from '../engine/lines';

/** Every line that is not a priority line waits at least this long after the last one that was let through. */
export const SPEECH_MIN_GAP_MS = 30_000;

/** Guilt, the greeting and the reactions to an answer are never held back: they answer something the user just did. */
const PRIORITY: ReadonlySet<string> = new Set([
  ...GUILT_LINES,
  ...LAST_GUILT_LINES,
  ...INTENT_LINES['greet-return'],
  ...INTENT_LINES['celebrate-small'],
  ...INTENT_LINES['celebrate-big'],
  ...INTENT_LINES['calm'],
]);

export interface SpeechGate {
  /** True if this line may be said now. Asking is what counts: a line that passes starts the gap for the others. */
  pass: (key: string) => boolean;
}

export function createSpeechGate(clock: { now(): number } = { now: () => Date.now() }): SpeechGate {
  let lastAt = -Infinity;
  return {
    pass(key) {
      if (PRIORITY.has(key)) return true;
      const now = clock.now();
      if (now - lastAt < SPEECH_MIN_GAP_MS) return false;
      lastAt = now;
      return true;
    },
  };
}
