import { allowed } from './rules';
import type { Action, Intent, RuleEvent, RuleState } from './types';

export type Transition = {
  prev: RuleState;
  event: RuleEvent;
  intent: Intent | null;
  next: RuleState;
  actions: Action[];
};

export type Invariant = { id: string; holds: (t: Transition) => boolean };

const PROMPT_OR_EFFECT = new Set<Action['type']>(['SHOW_FLASHCARD', 'RUN_LAPS', 'START_DIG_IN']);
const has = (t: Transition, type: Action['type']) => t.actions.some((a) => a.type === type);
const startsPromptOrEffect = (t: Transition) => t.actions.some((a) => PROMPT_OR_EFFECT.has(a.type));

export const INVARIANTS: readonly Invariant[] = [
  {
    // Paused or in Stay: nothing prompts, nothing runs, nothing escalates.
    id: 'QUIET',
    holds: (t) => {
      const quietBefore = t.prev.paused || t.prev.stay;
      const quietAfter = t.next.paused || t.next.stay;
      if (!quietBefore || !quietAfter) return true;
      return !startsPromptOrEffect(t) && t.next.effect === null && t.next.level <= t.prev.level;
    },
  },
  {
    id: 'LEVEL_BOUNDS',
    holds: (t) => t.prev.level >= 0 && t.next.level >= 0 && t.next.level <= 4,
  },
  {
    id: 'CAP',
    holds: (t) => t.next.level <= t.next.cap && allowed(t.next.effect, t.next.cap),
  },
  {
    id: 'DIG_ONCE',
    holds: (t) => !has(t, 'START_DIG_IN') || (!t.prev.digCooling && t.next.digCooling),
  },
  {
    id: 'WRONG_NO_RAISE',
    holds: (t) => t.event.type !== 'ANSWER_SUBMITTED' || t.next.level <= t.prev.level,
  },
  {
    id: 'ESC_ENDS',
    holds: (t) => {
      if (t.event.type !== 'ESC_PRESSED' && t.event.type !== 'EFFECT_EXPIRED') return true;
      return t.next.effect === null && has(t, 'END_EFFECT') === (t.prev.effect !== null);
    },
  },
  {
    // The level only rises when a card is shown or times out, and only when escalation is allowed.
    id: 'AWAY_NO_RAISE',
    holds: (t) => {
      if (t.next.level <= t.prev.level) return true;
      const p = t.prev;
      const mayEscalate = p.activity === 'active' && !p.suppressed && !p.paused && !p.stay;
      return (t.event.type === 'CHECKIN_TIMEOUT' || t.event.type === 'CHECKIN_DUE') && mayEscalate;
    },
  },
  {
    id: 'NO_SESSION_QUIET',
    holds: (t) => (t.prev.session && t.next.session) || (!startsPromptOrEffect(t) && t.next.effect === null),
  },
];
