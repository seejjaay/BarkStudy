import { describe, expect, it } from 'vitest';
import { createEngine, step, type EngineState, type TraceEntry } from '../../src/engine/engine';
import { DEFAULT_TRAITS, DEFAULT_TUNING } from '../../src/engine/tuning';
import type { Action, Context, Event } from '../../src/engine/types';

const MIN = 60_000;
const HOUR = 60 * MIN;

const ctx: Context = {
  traits: DEFAULT_TRAITS,
  tuning: DEFAULT_TUNING,
  activeWindowId: 100,
  busy: false,
  lastGuiltMs: null,
};
/** No timeouts within any test horizon, so only the deadline under test fires. */
const patientCtx: Context = {
  ...ctx,
  tuning: { ...DEFAULT_TUNING, firstEscalationMs: 1e12, escalationStepMs: 1e12 },
};

function run(s: EngineState, events: Event[], c: Context = ctx): { state: EngineState; actions: Action[] } {
  let state = s;
  const actions: Action[] = [];
  for (const e of events) {
    const r = step(state, e, c);
    state = r.state;
    actions.push(...r.actions);
  }
  return { state, actions };
}

const started = (c: Context = ctx, seed = 1) => run(createEngine(seed), [{ type: 'SESSION_START', cap: 4 }], c).state;
const count = (actions: Action[], type: Action['type']) => actions.filter((a) => a.type === type).length;

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('clock', () => {
  it('SESSION_START arms a check-in inside the configured window', () => {
    const s = started();
    expect(s.deadlines.checkin).toBeGreaterThanOrEqual(s.now + DEFAULT_TUNING.checkinMinMs);
    expect(s.deadlines.checkin).toBeLessThan(s.now + DEFAULT_TUNING.checkinMaxMs);
  });

  it('check-in fires exactly at its deadline', () => {
    const s = started();
    const wait = s.deadlines.checkin! - s.now;
    const before = step(s, { type: 'TICK', dtMs: wait - 1 }, ctx);
    expect(count(before.actions, 'SHOW_FLASHCARD')).toBe(0);
    const at = step(before.state, { type: 'TICK', dtMs: 1 }, ctx);
    expect(count(at.actions, 'SHOW_FLASHCARD')).toBe(1);
    expect(at.state.rules.card).toBe(true);
    expect(at.state.deadlines.checkin).toBeNull();
    expect(at.state.deadlines.timeout).not.toBeNull();
  });

  it('effect ends exactly at lapsMaxMs even with a single TICK of 1h', () => {
    // At level 3 the personality picks laps or whine; take the first seed that chooses laps.
    const toLevel3: Event[] = [{ type: 'CHECKIN_DUE' }, { type: 'CHECKIN_TIMEOUT' }, { type: 'CHECKIN_TIMEOUT' }];
    let lapsing = run(started(patientCtx, 1), toLevel3, patientCtx);
    for (let seed = 2; lapsing.state.rules.effect !== 'laps' && seed < 200; seed++) {
      lapsing = run(started(patientCtx, seed), toLevel3, patientCtx);
    }
    expect(count(lapsing.actions, 'RUN_LAPS')).toBe(1);
    expect(lapsing.state.rules.effect).toBe('laps');

    const early = step(lapsing.state, { type: 'TICK', dtMs: DEFAULT_TUNING.lapsMaxMs - 1 }, patientCtx);
    expect(count(early.actions, 'END_EFFECT')).toBe(0);
    expect(early.state.rules.effect).toBe('laps');
    const exact = step(early.state, { type: 'TICK', dtMs: 1 }, patientCtx);
    expect(count(exact.actions, 'END_EFFECT')).toBe(1);

    const oneBigTick = step(lapsing.state, { type: 'TICK', dtMs: HOUR }, patientCtx);
    expect(count(oneBigTick.actions, 'END_EFFECT')).toBe(1);
    expect(oneBigTick.state.rules.effect).toBeNull();
    expect(oneBigTick.state.now).toBe(lapsing.state.now + HOUR);
  });

  it('pause 30 min shifts deadlines by 30 min', () => {
    const idle = started();
    const idleResumed = run(idle, [{ type: 'PAUSE' }, { type: 'TICK', dtMs: 30 * MIN }, { type: 'RESUME' }]);
    expect(idleResumed.actions).toEqual([]);
    expect(idleResumed.state.deadlines.checkin).toBe(idle.deadlines.checkin! + 30 * MIN);

    const waiting = run(idle, [{ type: 'CHECKIN_DUE' }]).state;
    const waitingResumed = run(waiting, [{ type: 'PAUSE' }, { type: 'TICK', dtMs: 30 * MIN }, { type: 'RESUME' }]);
    expect(waitingResumed.actions).toEqual([]);
    expect(waitingResumed.state.deadlines.timeout).toBe(waiting.deadlines.timeout! + 30 * MIN);
    expect(waitingResumed.state.pausedAt).toBeNull();
  });

  it('a new session while paused clears the pause so the clock runs again', () => {
    const r = run(started(), [{ type: 'PAUSE' }, { type: 'SESSION_START', cap: 4 }]);
    expect(r.state.rules.paused).toBe(false);
    expect(r.state.pausedAt).toBeNull();
    const wait = r.state.deadlines.checkin! - r.state.now;
    expect(count(step(r.state, { type: 'TICK', dtMs: wait }, ctx).actions, 'SHOW_FLASHCARD')).toBe(1);
  });

  it('a dig-in cooldown survives ending and restarting the session', () => {
    const toDig: Event[] = [
      { type: 'CHECKIN_DUE' },
      { type: 'CHECKIN_TIMEOUT' },
      { type: 'CHECKIN_TIMEOUT' },
      { type: 'CHECKIN_TIMEOUT' },
    ];
    const first = run(started(), toDig);
    expect(count(first.actions, 'START_DIG_IN')).toBe(1);

    const restartedEarly = run(first.state, [{ type: 'SESSION_END' }, { type: 'SESSION_START', cap: 4 }, ...toDig]);
    expect(count(restartedEarly.actions, 'START_DIG_IN')).toBe(0);

    const restartedLater = run(first.state, [
      { type: 'SESSION_END' },
      { type: 'TICK', dtMs: DEFAULT_TUNING.digInCooldownMs },
      { type: 'SESSION_START', cap: 4 },
      ...toDig,
    ]);
    expect(count(restartedLater.actions, 'START_DIG_IN')).toBe(1);
  });

  it('SESSION_END disarms every deadline', () => {
    const r = run(started(), [{ type: 'CHECKIN_DUE' }, { type: 'SESSION_END' }]);
    expect(r.state.deadlines).toEqual({ checkin: null, timeout: null, effectEnd: null, digCooldownEnd: null, stayEnd: null });
    expect(r.state.pausedAt).toBeNull();
  });

  it('TICK of 6h fires at most one CHECKIN_DUE and does not escalate', () => {
    const r = step(started(), { type: 'TICK', dtMs: 6 * HOUR }, ctx);
    expect(count(r.actions, 'SHOW_FLASHCARD')).toBe(1);
    expect(count(r.actions, 'RUN_LAPS') + count(r.actions, 'START_DIG_IN')).toBe(0);
    expect(r.state.rules.level).toBe(1);
    expect(r.state.deadlines.timeout).toBeGreaterThan(r.state.now);
  });

  it('a missed card while away does not escalate and re-arms on return', () => {
    const waiting = run(started(), [{ type: 'CHECKIN_DUE' }, { type: 'USER_ACTIVITY', state: 'away' }]).state;
    const slept = run(waiting, [{ type: 'TICK', dtMs: 2 * HOUR }]);
    expect(count(slept.actions, 'CURL_UP')).toBe(1);
    expect(slept.state.rules).toMatchObject({ level: 1, missedWhileAway: true });
    expect(slept.state.deadlines.timeout).toBeNull();
    const back = run(slept.state, [{ type: 'USER_ACTIVITY', state: 'active' }]);
    expect(count(back.actions, 'SHOW_FLASHCARD')).toBe(1);
    expect(back.state.deadlines.timeout).toBeGreaterThan(back.state.now);
  });
});

describe('timeouts', () => {
  it('busy doubles time to first escalation', () => {
    const calm = run(started(), [{ type: 'CHECKIN_DUE' }]).state;
    const busy = run(started(), [{ type: 'CHECKIN_DUE' }], { ...ctx, busy: true }).state;
    const calmWait = calm.deadlines.timeout! - calm.now;
    const busyWait = busy.deadlines.timeout! - busy.now;
    expect(calmWait).toBe(DEFAULT_TUNING.firstEscalationMs);
    expect(busyWait).toBe(2 * calmWait);
  });

  it('first escalation scales with patience', () => {
    const wait = (patience: number) => {
      const c = { ...ctx, traits: { ...DEFAULT_TRAITS, patience } };
      const s = run(started(c), [{ type: 'CHECKIN_DUE' }], c).state;
      return s.deadlines.timeout! - s.now;
    };
    expect(wait(0)).toBe(1.5 * DEFAULT_TUNING.firstEscalationMs);
    expect(wait(1)).toBe(0.5 * DEFAULT_TUNING.firstEscalationMs);
  });

  it('later escalations scale with neediness', () => {
    const wait = (neediness: number) => {
      const c = { ...ctx, traits: { ...DEFAULT_TRAITS, neediness } };
      const s = run(started(c), [{ type: 'CHECKIN_DUE' }, { type: 'CHECKIN_TIMEOUT' }], c).state;
      return s.deadlines.timeout! - s.now;
    };
    expect(wait(0)).toBe(1.5 * DEFAULT_TUNING.escalationStepMs);
    expect(wait(1)).toBe(0.5 * DEFAULT_TUNING.escalationStepMs);
  });
});

describe('answers', () => {
  it('guilt trip only when waited >= threshold', () => {
    const T = DEFAULT_TUNING.guiltThresholdMs;
    const waiting = run(started(), [{ type: 'CHECKIN_DUE' }]).state;

    const quick = run(waiting, [{ type: 'TICK', dtMs: T - 1 }, { type: 'ANSWER_SUBMITTED', correct: true }]);
    expect(count(quick.actions, 'RECORD_GUILT_TRIP')).toBe(0);
    expect(quick.state.stats.guiltTrips).toEqual([]);

    const slow = run(waiting, [{ type: 'TICK', dtMs: T }, { type: 'ANSWER_SUBMITTED', correct: true }]);
    expect(slow.actions).toContainEqual({ type: 'RECORD_GUILT_TRIP', waitedMs: T });
    expect(slow.state.stats.guiltTrips).toEqual([T]);
  });

  it('an answer records stats, resets level, and schedules the next check-in', () => {
    const waiting = run(started(), [{ type: 'CHECKIN_DUE' }, { type: 'TICK', dtMs: 30_000 }]).state;
    const r = run(waiting, [{ type: 'ANSWER_SUBMITTED', correct: true }]);
    expect(r.state.stats).toMatchObject({ answered: 1, treats: 1, cardShownAt: null, longestWaitMs: 30_000 });
    expect(r.state.rules.level).toBe(0);
    expect(r.state.deadlines.timeout).toBeNull();
    expect(r.state.deadlines.checkin).toBeGreaterThanOrEqual(r.state.now + DEFAULT_TUNING.checkinMinMs);
  });

  it('a wrong answer earns no treat', () => {
    const r = run(started(), [{ type: 'CHECKIN_DUE' }, { type: 'ANSWER_SUBMITTED', correct: false }]);
    expect(r.state.stats).toMatchObject({ answered: 1, treats: 0 });
    expect(count(r.actions, 'AWARD_TREAT')).toBe(0);
  });
});

describe('engine hygiene', () => {
  it('step does not mutate its input', () => {
    const s = deepFreeze(started());
    const frozenCtx = deepFreeze({ ...ctx });
    const events: Event[] = [
      { type: 'CHECKIN_DUE' },
      { type: 'TICK', dtMs: 2 * HOUR },
      { type: 'CHECKIN_TIMEOUT' },
      { type: 'USER_ACTIVITY', state: 'away' },
      { type: 'PAUSE' },
      { type: 'RESUME' },
      { type: 'STAY_ON', durationMs: 5 * MIN },
      { type: 'WINDOW_FOCUS_CHANGED', windowId: 7 },
    ];
    let cur = s;
    for (const e of events) cur = deepFreeze(step(cur, e, frozenCtx).state);
    expect(cur).not.toBe(s);
  });

  it('same seed and events give identical actions', () => {
    const events: Event[] = [
      { type: 'TICK', dtMs: 20 * MIN },
      { type: 'TICK', dtMs: 5 * MIN },
      { type: 'ANSWER_SUBMITTED', correct: true },
      { type: 'TICK', dtMs: HOUR },
    ];
    const a = run(started(ctx, 5), events);
    const b = run(started(ctx, 5), events);
    expect(a).toEqual(b);
  });

  it('step records each rule transition, with its exact time, into an optional trace', () => {
    const s = started();
    const direct: TraceEntry[] = [];
    step(s, { type: 'CHECKIN_DUE' }, ctx, direct);
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ at: s.now, event: { type: 'CHECKIN_DUE' }, intent: 'show-card' });
    expect(direct[0]?.next.card).toBe(true);

    const viaClock: TraceEntry[] = [];
    step(s, { type: 'TICK', dtMs: s.deadlines.checkin! - s.now + 5_000 }, ctx, viaClock);
    expect(viaClock[0]).toMatchObject({ at: s.deadlines.checkin, event: { type: 'CHECKIN_DUE' } });
  });

  it('WINDOW_FOCUS_CHANGED alone changes nothing', () => {
    const s = started();
    const r = step(s, { type: 'WINDOW_FOCUS_CHANGED', windowId: 3 }, ctx);
    expect(r.state).toEqual(s);
    expect(r.actions).toEqual([]);
  });

  it('laps with no active window degrade instead of running', () => {
    const noWindow = { ...patientCtx, activeWindowId: null };
    const r = run(started(noWindow), [{ type: 'CHECKIN_DUE' }, { type: 'CHECKIN_TIMEOUT' }, { type: 'CHECKIN_TIMEOUT' }], noWindow);
    expect(count(r.actions, 'RUN_LAPS')).toBe(0);
    expect(r.state.rules.effect).toBeNull();
  });
});
