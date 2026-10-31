const MOODS = [
  'idle',
  'wander',
  'nap',
  'curious',
  'pleading',
  'follow-cursor',
  'whine',
  'zoomies',
  'dig',
  'happy',
  'ecstatic',
  'calm',
  'sulk',
  'greet',
  'sit',
] as const;

/** What Pandesal is feeling, for the renderer to pick a pose and for the sound and speech layers to react to. `idle` is "nothing in particular". */
export type Mood = (typeof MOODS)[number];

/** The engine names its expressions with the same words as the moods. Anything it does not know is `idle`. */
export function moodFromExpression(name: string): Mood {
  return MOODS.find((m) => m === name) ?? 'idle';
}

/** How long a reaction mood is held before he drops back to what he was doing. Moods not listed last as long as the engine says. */
export const MOOD_HOLD_MS: Partial<Record<Mood, number>> = {
  happy: 2000,
  ecstatic: 2000,
  greet: 2000,
  sulk: 4000,
};
