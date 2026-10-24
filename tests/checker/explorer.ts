import type { Invariant, Transition } from '../../src/engine/invariants';
import { INITIAL_RULES, type applyIntent, type ruleStep } from '../../src/engine/rules';
import type { Action, Activity, Cap, Intent, RuleEvent, RuleState } from '../../src/engine/types';

type Step = typeof ruleStep;
type Apply = typeof applyIntent;

const CAPS: Cap[] = [2, 3, 4];
const ACTIVITIES: Activity[] = ['active', 'away', 'locked'];

/** Every rule event, with each parameter taking each distinct value. */
export const EVENT_ALPHABET: readonly RuleEvent[] = [
  ...CAPS.map((cap): RuleEvent => ({ type: 'SESSION_START', cap })),
  { type: 'SESSION_END' },
  { type: 'CHECKIN_DUE' },
  { type: 'CHECKIN_TIMEOUT' },
  { type: 'ANSWER_SUBMITTED', correct: true },
  { type: 'ANSWER_SUBMITTED', correct: false },
  ...ACTIVITIES.map((state): RuleEvent => ({ type: 'USER_ACTIVITY', state })),
  { type: 'STAY_ON', durationMs: 60_000 },
  { type: 'STAY_OFF' },
  { type: 'PAUSE' },
  { type: 'RESUME' },
  { type: 'ESC_PRESSED' },
  { type: 'SUPPRESS_CHANGED', on: true },
  { type: 'SUPPRESS_CHANGED', on: false },
  ...CAPS.map((cap): RuleEvent => ({ type: 'CAP_CHANGED', cap })),
  { type: 'EFFECT_EXPIRED' },
  { type: 'DIG_COOLDOWN_EXPIRED' },
  { type: 'STAY_EXPIRED' },
];

/** Stand-in for the personality layer: just enough to expose which actions an intent causes. */
function placeholderActions(i: Intent | null): Action[] {
  switch (i) {
    case 'show-card':
      return [{ type: 'SHOW_FLASHCARD' }];
    case 'laps':
      return [{ type: 'RUN_LAPS', windowId: 1 }];
    case 'dig-in':
      return [{ type: 'START_DIG_IN', windowId: 1 }];
    case 'curl-up':
      return [{ type: 'CURL_UP' }];
    default:
      return [];
  }
}

interface Graph {
  states: Map<string, RuleState>;
  /** edges.get(key) = keys reachable in one transition. */
  edges: Map<string, Set<string>>;
  transitions: number;
  violation: null | { invariant: string; trace: Transition[] };
}

const keyOf = (s: RuleState) => JSON.stringify(s);

/** BFS over every (state, event, intent). Stops at the first violation, which has the shortest trace. */
function walk(step: Step, apply: Apply, invariants: readonly Invariant[]): Graph {
  const initialKey = keyOf(INITIAL_RULES);
  const states = new Map<string, RuleState>([[initialKey, INITIAL_RULES]]);
  const edges = new Map<string, Set<string>>();
  const parent = new Map<string, { from: string; via: Transition }>();
  const queue: string[] = [initialKey];
  let transitions = 0;

  const traceTo = (key: string, last: Transition): Transition[] => {
    const trace = [last];
    for (let k = key; parent.has(k); ) {
      const p = parent.get(k)!;
      trace.unshift(p.via);
      k = p.from;
    }
    return trace;
  };

  for (let head = 0; head < queue.length; head++) {
    const key = queue[head]!;
    const prev = states.get(key)!;
    const out = new Set<string>();
    edges.set(key, out);
    for (const event of EVENT_ALPHABET) {
      const r = step(prev, event);
      const intents: (Intent | null)[] = r.intents.length > 0 ? r.intents : [null];
      for (const intent of intents) {
        const next = intent === null ? r.state : apply(r.state, intent);
        const t: Transition = {
          prev,
          event,
          intent,
          next,
          actions: [...r.required, ...placeholderActions(intent)],
        };
        transitions++;
        const broken = invariants.find((inv) => !inv.holds(t));
        if (broken) return { states, edges, transitions, violation: { invariant: broken.id, trace: traceTo(key, t) } };
        const nextKey = keyOf(next);
        out.add(nextKey);
        if (!states.has(nextKey)) {
          states.set(nextKey, next);
          parent.set(nextKey, { from: key, via: t });
          queue.push(nextKey);
        }
      }
    }
  }
  return { states, edges, transitions, violation: null };
}

export function explore(step: Step, apply: Apply, invariants: readonly Invariant[]) {
  const g = walk(step, apply, invariants);
  return { states: g.states.size, transitions: g.transitions, violation: g.violation };
}

export function reachableStates(step: Step, apply: Apply): RuleState[] {
  return [...walk(step, apply, []).states.values()];
}

/** True if, from every reachable state, some event sequence reaches a state satisfying `goal`. */
export function canAlwaysReach(step: Step, apply: Apply, goal: (s: RuleState) => boolean) {
  const g = walk(step, apply, []);
  const reverse = new Map<string, string[]>();
  for (const [from, tos] of g.edges) for (const to of tos) (reverse.get(to) ?? reverse.set(to, []).get(to)!).push(from);
  const good = new Set<string>();
  const queue: string[] = [];
  const mark = (key: string) => {
    if (good.has(key)) return;
    good.add(key);
    queue.push(key);
  };
  for (const [key, s] of g.states) if (goal(s)) mark(key);
  for (let head = 0; head < queue.length; head++) {
    for (const from of reverse.get(queue[head]!) ?? []) mark(from);
  }
  const stuck = [...g.states].filter(([key]) => !good.has(key)).map(([, s]) => s);
  return { ok: stuck.length === 0, stuck };
}
