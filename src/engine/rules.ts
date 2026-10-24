import type { Action, Cap, EffectKind, Intent, Level, RuleEvent, RuleState } from './types';

export const INITIAL_RULES: RuleState = {
  session: false,
  level: 0,
  cap: 4,
  paused: false,
  stay: false,
  activity: 'active',
  suppressed: false,
  card: false,
  effect: null,
  digCooling: false,
  missedWhileAway: false,
};

export interface RuleResult {
  state: RuleState;
  /** Actions the rules demand regardless of what the personality picks. */
  required: Action[];
  /** The intents the personality layer may choose from. Empty means "nothing to say". */
  intents: Intent[];
}

/** Laps need cap >= 3, dig-in needs cap 4. */
export function allowed(effect: EffectKind | null, cap: Cap): boolean {
  if (effect === 'laps') return cap >= 3;
  if (effect === 'dig-in') return cap === 4;
  return true;
}

const END_EFFECT: Action = { type: 'END_EFFECT' };

/** Clears the running effect and returns END_EFFECT only if one was running. */
function clearEffect(s: RuleState): { state: RuleState; required: Action[] } {
  return s.effect === null ? { state: s, required: [] } : { state: { ...s, effect: null }, required: [END_EFFECT] };
}

const result = (state: RuleState, required: Action[] = [], intents: Intent[] = []): RuleResult => ({
  state,
  required,
  intents,
});

export function ruleStep(s: RuleState, e: RuleEvent): RuleResult {
  switch (e.type) {
    case 'CHECKIN_DUE': {
      if (!s.session || s.paused || s.stay || s.card || s.activity !== 'active' || s.suppressed) return result(s);
      return result({ ...s, card: true, level: Math.max(s.level, 1) as Level }, [], ['show-card']);
    }

    case 'CHECKIN_TIMEOUT': {
      if (!s.card) return result(s);
      if (s.activity !== 'active' || s.suppressed) {
        return result({ ...s, missedWhileAway: true }, [], ['curl-up']);
      }
      if (s.paused || s.stay) return result(s);
      if (s.level >= s.cap) return result(s, [], ['re-ask', 'whine']);
      const level = (s.level + 1) as Level;
      const next = { ...s, level };
      switch (level) {
        case 3:
          return result(next, [], ['laps', 'whine']);
        case 4:
          return result(next, [], s.digCooling ? ['laps', 'whine'] : ['dig-in']);
        default:
          return result(next, [], ['re-ask', 'follow-cursor', 'whine']);
      }
    }

    case 'ANSWER_SUBMITTED': {
      if (!s.card) return result(s);
      const cleared = clearEffect({ ...s, level: 0, card: false });
      return e.correct
        ? result(cleared.state, [...cleared.required, { type: 'AWARD_TREAT' }], ['celebrate-small', 'celebrate-big'])
        : result(cleared.state, cleared.required, ['calm']);
    }

    case 'USER_ACTIVITY': {
      const next = { ...s, activity: e.state };
      if (e.state !== 'active') {
        const cleared = clearEffect(next);
        return result(cleared.state, cleared.required, ['curl-up']);
      }
      if (!s.missedWhileAway) return result(next);
      // Re-show the card only when nothing is holding prompts back.
      const reshow = s.card && !s.paused && !s.stay && !s.suppressed;
      return result({ ...next, missedWhileAway: false }, reshow ? [{ type: 'SHOW_FLASHCARD' }] : [], ['greet-return']);
    }

    case 'STAY_ON': {
      const cleared = clearEffect({ ...s, stay: true, card: false, level: 0 });
      return result(cleared.state, cleared.required, ['sit-stay']);
    }

    case 'STAY_OFF':
    case 'STAY_EXPIRED':
      return s.stay ? result({ ...s, stay: false }) : result(s);

    case 'PAUSE': {
      const cleared = clearEffect({ ...s, paused: true });
      return result(cleared.state, cleared.required);
    }

    case 'RESUME':
      return result({ ...s, paused: false });

    case 'ESC_PRESSED':
    case 'EFFECT_EXPIRED': {
      const cleared = clearEffect(s);
      return result(cleared.state, cleared.required);
    }

    case 'DIG_COOLDOWN_EXPIRED':
      return result({ ...s, digCooling: false });

    case 'SUPPRESS_CHANGED': {
      const cleared = e.on ? clearEffect({ ...s, suppressed: true }) : { state: { ...s, suppressed: false }, required: [] };
      return result(cleared.state, cleared.required);
    }

    case 'CAP_CHANGED': {
      const next = { ...s, cap: e.cap, level: Math.min(s.level, e.cap) as Level };
      if (allowed(next.effect, e.cap)) return result(next);
      const cleared = clearEffect(next);
      return result(cleared.state, cleared.required);
    }

    // The dig-in cooldown outlives the session, or restarting would be a way round it.
    case 'SESSION_START':
      return result(
        { ...INITIAL_RULES, session: true, cap: e.cap, digCooling: s.digCooling },
        clearEffect(s).required,
      );

    case 'SESSION_END':
      return result({ ...INITIAL_RULES, digCooling: s.digCooling }, clearEffect(s).required);

    default:
      return result(s);
  }
}

export function applyIntent(s: RuleState, i: Intent): RuleState {
  switch (i) {
    case 'laps':
      return { ...s, effect: 'laps' };
    case 'dig-in':
      return { ...s, effect: 'dig-in', digCooling: true };
    default:
      return s;
  }
}
