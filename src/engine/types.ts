export type Level = 0 | 1 | 2 | 3 | 4;
/** Highest level the user allows: Gentle (2), Playful (3) or Full dog (4). */
export type Cap = 2 | 3 | 4;
export type Activity = 'active' | 'away' | 'locked';
export type EffectKind = 'laps' | 'dig-in';

export type Event =
  | { type: 'SESSION_START'; cap: Cap }
  | { type: 'SESSION_END' }
  | { type: 'TICK'; dtMs: number }
  | { type: 'CHECKIN_DUE' }
  | { type: 'CHECKIN_TIMEOUT' }
  | { type: 'ANSWER_SUBMITTED'; correct: boolean }
  | { type: 'USER_ACTIVITY'; state: Activity }
  | { type: 'STAY_ON'; durationMs: number }
  | { type: 'STAY_OFF' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'ESC_PRESSED' }
  | { type: 'WINDOW_FOCUS_CHANGED'; windowId: number | null }
  | { type: 'SUPPRESS_CHANGED'; on: boolean }
  | { type: 'CAP_CHANGED'; cap: Cap };

export type Action =
  | { type: 'SHOW_FLASHCARD' }
  | { type: 'SET_EXPRESSION'; name: string }
  | { type: 'WALK_TO'; windowId: number }
  | { type: 'RUN_LAPS'; windowId: number }
  | { type: 'START_DIG_IN'; windowId: number }
  | { type: 'END_EFFECT' }
  /** `line` is an i18n key (see lines.ts), not display text. */
  | { type: 'SAY'; line: string; params?: Record<string, number> }
  | { type: 'AWARD_TREAT' }
  | { type: 'RECORD_GUILT_TRIP'; waitedMs: number }
  | { type: 'CURL_UP' };

export interface RuleState {
  session: boolean;
  level: Level;
  cap: Cap;
  paused: boolean;
  stay: boolean;
  activity: Activity;
  suppressed: boolean;
  card: boolean;
  effect: EffectKind | null;
  digCooling: boolean;
  missedWhileAway: boolean;
}

/** Events the rule layer sees. TICK is consumed by the clock; focus changes only feed context. */
export type RuleEvent =
  | Exclude<Event, { type: 'TICK' } | { type: 'WINDOW_FOCUS_CHANGED' }>
  | { type: 'EFFECT_EXPIRED' }
  | { type: 'DIG_COOLDOWN_EXPIRED' }
  | { type: 'STAY_EXPIRED' };

export type Intent =
  | 'idle-wander'
  | 'nap'
  | 'show-card'
  | 're-ask'
  | 'follow-cursor'
  | 'whine'
  | 'laps'
  | 'dig-in'
  | 'celebrate-small'
  | 'celebrate-big'
  | 'calm'
  | 'sulk'
  | 'curl-up'
  | 'greet-return'
  | 'sit-stay';

/** Each trait is 0..1. */
export interface Traits {
  neediness: number;
  drama: number;
  patience: number;
  zoominess: number;
}

export interface Tuning {
  checkinMinMs: number;
  checkinMaxMs: number;
  firstEscalationMs: number;
  escalationStepMs: number;
  activeSlowdown: number;
  digInCooldownMs: number;
  lapsMaxMs: number;
  digInMaxMs: number;
  guiltThresholdMs: number;
  awayIdleMs: number;
  busyIdleMs: number;
}

export interface Context {
  traits: Traits;
  tuning: Tuning;
  activeWindowId: number | null;
  /** User is typing right now (idle < busyIdleMs), so escalation slows down. */
  busy: boolean;
  lastGuiltMs: number | null;
}
