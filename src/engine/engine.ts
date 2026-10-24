import { DEADLINE_EVENT, lerp, nextDue, NO_DEADLINES, shiftDeadlines, type Deadlines } from './clock';
import { chooseIntent, intentToActions } from './personality';
import { createRng, nextInt, type RngState } from './rng';
import { applyIntent, INITIAL_RULES, ruleStep } from './rules';
import type { Action, Context, Event, Intent, RuleEvent, RuleState } from './types';

export interface Stats {
  answered: number;
  treats: number;
  cardShownAt: number | null;
  longestWaitMs: number;
  guiltTrips: number[];
}

export interface EngineState {
  rules: RuleState;
  now: number;
  deadlines: Deadlines;
  pausedAt: number | null;
  rng: RngState;
  stats: Stats;
}

export function createEngine(seed: number): EngineState {
  return {
    rules: INITIAL_RULES,
    now: 0,
    deadlines: NO_DEADLINES,
    pausedAt: null,
    rng: createRng(seed),
    stats: { answered: 0, treats: 0, cardShownAt: null, longestWaitMs: 0, guiltTrips: [] },
  };
}

/** Escalation delay in ms: the first one after a fresh card is patience-driven, later ones neediness-driven. */
function escalationDelay(rules: RuleState, ctx: Context): number {
  const { traits, tuning } = ctx;
  const slowdown = ctx.busy ? tuning.activeSlowdown : 1;
  const base =
    rules.level <= 1
      ? tuning.firstEscalationMs * lerp(1.5, 0.5, traits.patience)
      : tuning.escalationStepMs * lerp(1.5, 0.5, traits.neediness);
  return Math.max(1, base * slowdown);
}

/**
 * Re-derives every deadline from the rules after a transition. `armBase` is where check-in and timeout
 * deadlines count from: `now` for direct events, the end of the tick for events fired inside a TICK, so a
 * long sleep gives one catch-up event and never a burst.
 */
function settle(
  d: Deadlines,
  rules: RuleState,
  rng: RngState,
  e: RuleEvent,
  intent: Intent | null,
  now: number,
  armBase: number,
  ctx: Context,
): { deadlines: Deadlines; rng: RngState } {
  const out = { ...d };
  const { tuning } = ctx;

  if (rules.effect === null) out.effectEnd = null;
  else if (intent === 'laps') out.effectEnd = now + Math.max(1, tuning.lapsMaxMs);
  else if (intent === 'dig-in') out.effectEnd = now + Math.max(1, tuning.digInMaxMs);

  if (intent === 'dig-in') out.digCooldownEnd = now + Math.max(1, tuning.digInCooldownMs);
  if (!rules.digCooling) out.digCooldownEnd = null;

  if (e.type === 'STAY_ON') out.stayEnd = now + Math.max(1, e.durationMs);
  else if (!rules.stay) out.stayEnd = null;

  if (!rules.session || rules.card) {
    out.checkin = null;
  } else if (out.checkin === null) {
    const [wait, next] = nextInt(rng, tuning.checkinMinMs, tuning.checkinMaxMs);
    rng = next;
    out.checkin = armBase + Math.max(1, wait);
  }

  // A timeout armed before the user went away still fires once (the rules log the miss), but is only
  // re-armed while escalation is actually possible.
  if (!rules.card || rules.stay) {
    out.timeout = null;
  } else if (out.timeout === null && !rules.paused && rules.activity === 'active' && !rules.suppressed) {
    out.timeout = armBase + escalationDelay(rules, ctx);
  }

  return { deadlines: out, rng };
}

function transition(s: EngineState, e: RuleEvent, ctx: Context, armBase: number): { state: EngineState; actions: Action[] } {
  let deadlines = s.deadlines;
  let pausedAt = s.pausedAt;
  if (e.type === 'PAUSE' && pausedAt === null) pausedAt = s.now;
  if (e.type === 'RESUME' && pausedAt !== null) {
    deadlines = shiftDeadlines(deadlines, s.now - pausedAt);
    pausedAt = null;
  }

  // A check-in event handled directly (not fired from a deadline) consumes its own deadline.
  if (e.type === 'CHECKIN_DUE') deadlines = { ...deadlines, checkin: null };
  if (e.type === 'CHECKIN_TIMEOUT') deadlines = { ...deadlines, timeout: null };

  const r = ruleStep(s.rules, e);
  const actions: Action[] = [...r.required];
  const waitedMs =
    e.type === 'ANSWER_SUBMITTED' && s.rules.card && s.stats.cardShownAt !== null ? s.now - s.stats.cardShownAt : null;
  let rules = r.state;
  let rng = s.rng;
  let intent: Intent | null = null;

  if (r.intents.length > 0) {
    [intent, rng] = chooseIntent(r.intents, rules, ctx, rng);
    rules = applyIntent(rules, intent);
    const [more, next] = intentToActions(intent, rules, ctx, rng, waitedMs);
    actions.push(...more);
    rng = next;
  }

  const stats = { ...s.stats };
  if (!s.rules.card && rules.card) stats.cardShownAt = s.now;
  if (!rules.card) stats.cardShownAt = null;
  if (e.type === 'ANSWER_SUBMITTED' && s.rules.card) {
    stats.answered++;
    if (waitedMs !== null) {
      stats.longestWaitMs = Math.max(stats.longestWaitMs, waitedMs);
      if (waitedMs >= ctx.tuning.guiltThresholdMs) {
        actions.push({ type: 'RECORD_GUILT_TRIP', waitedMs });
        stats.guiltTrips = [...stats.guiltTrips, waitedMs];
      }
    }
  }
  if (r.required.some((a) => a.type === 'AWARD_TREAT')) stats.treats++;

  const settled = settle(deadlines, rules, rng, e, intent, s.now, armBase, ctx);
  return {
    state: { ...s, rules, deadlines: settled.deadlines, pausedAt, rng: settled.rng, stats },
    actions,
  };
}

function tick(s: EngineState, dtMs: number, ctx: Context): { state: EngineState; actions: Action[] } {
  const target = s.now + dtMs;
  if (s.pausedAt !== null) return { state: { ...s, now: target }, actions: [] };

  let cur = s;
  const actions: Action[] = [];
  for (let due = nextDue(cur.deadlines, target); due !== null; due = nextDue(cur.deadlines, target)) {
    cur = { ...cur, now: Math.max(cur.now, due.at), deadlines: { ...cur.deadlines, [due.key]: null } };
    const r = transition(cur, DEADLINE_EVENT[due.key], ctx, target);
    cur = r.state;
    actions.push(...r.actions);
  }
  return { state: { ...cur, now: target }, actions };
}

export function step(s: EngineState, e: Event, ctx: Context): { state: EngineState; actions: Action[] } {
  switch (e.type) {
    case 'TICK':
      return tick(s, e.dtMs, ctx);
    case 'WINDOW_FOCUS_CHANGED':
      return { state: s, actions: [] };
    default:
      return transition(s, e, ctx, s.now);
  }
}
