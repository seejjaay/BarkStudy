import type { Intent } from './types';

/**
 * Pandesal's lines as i18n keys, never display text. The renderer resolves them through
 * src/shared/i18n/en.ts. Guilt keys take a `{minutes}` param.
 */
const variants = (name: string, n = 3): readonly string[] =>
  Array.from({ length: n }, (_, i) => `line.${name}.${i + 1}`);

export const INTENT_LINES: Record<Intent, readonly string[]> = {
  'idle-wander': variants('idleWander'),
  nap: variants('nap'),
  'show-card': variants('showCard'),
  're-ask': variants('reAsk'),
  'follow-cursor': variants('followCursor'),
  whine: variants('whine'),
  laps: variants('laps'),
  'dig-in': variants('digIn'),
  'celebrate-small': variants('celebrateSmall'),
  'celebrate-big': variants('celebrateBig'),
  calm: variants('calm'),
  sulk: variants('sulk'),
  'curl-up': variants('curlUp'),
  'greet-return': variants('greetReturn'),
  'sit-stay': variants('sitStay'),
};

/** Said after a correct or wrong answer that took too long. Param: minutes waited. */
export const GUILT_LINES = variants('guilt');

/** Said on return when the last guilt trip is on record: "last time you left me for {minutes} minutes". */
export const LAST_GUILT_LINES = variants('lastGuilt');

export const ALL_LINE_KEYS: readonly string[] = [
  ...Object.values(INTENT_LINES).flat(),
  ...GUILT_LINES,
  ...LAST_GUILT_LINES,
];
