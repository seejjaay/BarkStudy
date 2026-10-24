import { GUILT_LINES, INTENT_LINES, LAST_GUILT_LINES } from './lines';
import { nextInt, weightedPick, type RngState } from './rng';
import type { Action, Context, Intent, RuleState, Traits } from './types';

/** Starting appetite for each intent before traits are applied. */
const BASE: Record<Intent, number> = {
  'idle-wander': 1,
  nap: 1,
  'show-card': 1,
  're-ask': 1,
  'follow-cursor': 1,
  whine: 1,
  laps: 1,
  'dig-in': 1,
  'celebrate-small': 1,
  'celebrate-big': 1,
  calm: 1,
  sulk: 1,
  'curl-up': 1,
  'greet-return': 1,
  'sit-stay': 1,
};

/** Keeps a zero trait from zeroing out the only intent on offer. */
const MIN_WEIGHT = 0.01;

function traitMultiplier(i: Intent, t: Traits): number {
  switch (i) {
    case 'celebrate-big':
      return 0.5 + t.zoominess;
    case 'celebrate-small':
      return 1.5 - t.zoominess;
    case 'whine':
    case 'follow-cursor':
      return 0.5 + t.neediness;
    case 'sulk':
      return t.drama;
    default:
      return 1;
  }
}

const weight = (i: Intent, t: Traits) => Math.max(MIN_WEIGHT, BASE[i] * traitMultiplier(i, t));

const needsWindow = (i: Intent) => i === 'laps' || i === 'dig-in';

/** Picks one of the allowed intents, weighted by traits. Intents that need a window degrade to whine without one. */
export function chooseIntent(
  intents: readonly Intent[],
  _rules: RuleState,
  ctx: Context,
  rng: RngState,
): [Intent, RngState] {
  const usable = ctx.activeWindowId === null ? intents.filter((i) => !needsWindow(i)) : intents;
  const pool: readonly Intent[] = usable.length > 0 ? usable : ['whine'];
  return weightedPick(
    rng,
    pool.map((item) => ({ item, weight: weight(item, ctx.traits) })),
  );
}

const EXPRESSION: Partial<Record<Intent, string>> = {
  'idle-wander': 'wander',
  nap: 'nap',
  'show-card': 'curious',
  're-ask': 'pleading',
  'follow-cursor': 'follow-cursor',
  whine: 'whine',
  laps: 'zoomies',
  'dig-in': 'dig',
  'celebrate-small': 'happy',
  'celebrate-big': 'ecstatic',
  calm: 'calm',
  sulk: 'sulk',
  'greet-return': 'greet',
  'sit-stay': 'sit',
};

const ANSWER_INTENTS = new Set<Intent>(['celebrate-small', 'celebrate-big', 'calm']);
const minutes = (ms: number) => Math.round(ms / 60_000);

/** Turns a chosen intent into the actions the renderer plays. `waitedMs` is set only on answers. */
export function intentToActions(
  i: Intent,
  rules: RuleState,
  ctx: Context,
  rng: RngState,
  waitedMs: number | null,
): [Action[], RngState] {
  if (needsWindow(i) && ctx.activeWindowId === null) return intentToActions('whine', rules, ctx, rng, waitedMs);

  let r = rng;
  const pick = (keys: readonly string[]): string => {
    const [n, next] = nextInt(r, 0, keys.length);
    r = next;
    return keys[n] ?? keys[0] ?? '';
  };

  const actions: Action[] = [];
  switch (i) {
    case 'show-card':
      actions.push({ type: 'SHOW_FLASHCARD' });
      break;
    case 'laps':
      if (ctx.activeWindowId !== null) actions.push({ type: 'RUN_LAPS', windowId: ctx.activeWindowId });
      break;
    case 'dig-in':
      if (ctx.activeWindowId !== null) actions.push({ type: 'START_DIG_IN', windowId: ctx.activeWindowId });
      break;
    case 'idle-wander':
      if (ctx.activeWindowId !== null) actions.push({ type: 'WALK_TO', windowId: ctx.activeWindowId });
      break;
    case 'curl-up':
      actions.push({ type: 'CURL_UP' });
      break;
    default:
      break;
  }

  const expression = EXPRESSION[i];
  if (expression !== undefined) actions.push({ type: 'SET_EXPRESSION', name: expression });

  if (waitedMs !== null && waitedMs >= ctx.tuning.guiltThresholdMs && ANSWER_INTENTS.has(i)) {
    actions.push({ type: 'SAY', line: pick(GUILT_LINES), params: { minutes: minutes(waitedMs) } });
  } else if (i === 'greet-return' && ctx.lastGuiltMs !== null) {
    actions.push({ type: 'SAY', line: pick(LAST_GUILT_LINES), params: { minutes: minutes(ctx.lastGuiltMs) } });
  } else {
    actions.push({ type: 'SAY', line: pick(INTENT_LINES[i]) });
  }
  return [actions, r];
}
