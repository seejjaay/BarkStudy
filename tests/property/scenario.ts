import { createEngine, step, type EngineState, type TraceEntry } from '../../src/engine/engine';
import { INVARIANTS } from '../../src/engine/invariants';
import type { Action } from '../../src/engine/types';
import type { Scenario, Step } from './arbitraries';

export interface LogEntry {
  prev: EngineState;
  state: EngineState;
  step: Step;
  actions: Action[];
  trace: TraceEntry[];
}

export interface Violation {
  /** Short id used in the regression file name. */
  id: string;
  message: string;
}

export interface Property {
  name: string;
  check: (log: LogEntry[], scenario: Scenario) => Violation | null;
}

export function simulate(scenario: Scenario): LogEntry[] {
  let state = createEngine(scenario.seed);
  const log: LogEntry[] = [];
  for (const s of scenario.steps) {
    const trace: TraceEntry[] = [];
    const r = step(state, s.event, s.ctx, trace);
    log.push({ prev: state, state: r.state, step: s, actions: r.actions, trace });
    state = r.state;
  }
  return log;
}

const at = (i: number, log: LogEntry[]) => `step ${i} ${JSON.stringify(log[i]?.step.event)}`;
const has = (actions: Action[], type: Action['type']) => actions.some((a) => a.type === type);

export const PROPERTIES: readonly Property[] = [
  {
    name: 'rule invariants hold on every engine step',
    check: (log) => {
      for (let i = 0; i < log.length; i++) {
        for (const t of log[i]!.trace) {
          const broken = INVARIANTS.find((inv) => !inv.holds(t));
          if (broken) return { id: broken.id, message: `${at(i, log)} broke ${broken.id} via ${JSON.stringify(t.event)}` };
        }
      }
      return null;
    },
  },
  {
    name: 'effects never outlive their max',
    check: (log) => {
      for (let i = 0; i < log.length; i++) {
        const { state, step: s } = log[i]!;
        const effect = state.rules.effect;
        if (effect === null) continue;
        const max = effect === 'laps' ? s.ctx.tuning.lapsMaxMs : s.ctx.tuning.digInMaxMs;
        const end = state.deadlines.effectEnd;
        if (end === null || end <= state.now || end - state.now > max) {
          return { id: 'EFFECT_MAX', message: `${at(i, log)} left ${effect} running with effectEnd=${String(end)} now=${state.now}` };
        }
      }
      return null;
    },
  },
  {
    name: 'START_DIG_IN ≥ digInCooldownMs apart',
    check: (log) => {
      let last: number | null = null;
      for (let i = 0; i < log.length; i++) {
        for (const t of log[i]!.trace) {
          if (!has(t.actions, 'START_DIG_IN')) continue;
          const cooldown = log[i]!.step.ctx.tuning.digInCooldownMs;
          if (last !== null && t.at - last < cooldown) {
            return { id: 'DIG_COOLDOWN', message: `${at(i, log)} dug in ${t.at - last} ms after the previous dig-in` };
          }
          last = t.at;
        }
      }
      return null;
    },
  },
  {
    name: 'ESC always ends a running effect',
    check: (log) => {
      for (let i = 0; i < log.length; i++) {
        const { prev, state, step: s, actions } = log[i]!;
        if (s.event.type !== 'ESC_PRESSED' || prev.rules.effect === null) continue;
        if (state.rules.effect !== null || !has(actions, 'END_EFFECT')) {
          return { id: 'ESC', message: `${at(i, log)} did not end the ${prev.rules.effect}` };
        }
      }
      return null;
    },
  },
  {
    name: 'deterministic (same scenario twice → identical action log)',
    check: (log, scenario) => {
      const again = simulate(scenario);
      const same = JSON.stringify(again.map((l) => l.actions)) === JSON.stringify(log.map((l) => l.actions));
      const sameEnd = JSON.stringify(again.at(-1)?.state) === JSON.stringify(log.at(-1)?.state);
      return same && sameEnd ? null : { id: 'DETERMINISM', message: 'two runs of the same scenario diverged' };
    },
  },
  {
    name: 'no escalation while away or suppressed',
    check: (log) => {
      for (let i = 0; i < log.length; i++) {
        for (const t of log[i]!.trace) {
          const p = t.prev;
          if (t.next.level > p.level && (p.activity !== 'active' || p.suppressed || p.paused || p.stay)) {
            return { id: 'NO_ESCALATE', message: `${at(i, log)} raised the level from ${p.level} to ${t.next.level} while ${p.activity}` };
          }
        }
      }
      return null;
    },
  },
  {
    name: 'level never exceeds cap',
    check: (log) => {
      for (let i = 0; i < log.length; i++) {
        const r = log[i]!.state.rules;
        if (r.level > r.cap) return { id: 'LEVEL_CAP', message: `${at(i, log)} left level ${r.level} above cap ${r.cap}` };
      }
      return null;
    },
  },
  {
    // Review Focus 4: a TICK of hours is one catch-up, never a burst.
    name: 'a single TICK fires at most one check-in or escalation',
    check: (log) => {
      for (let i = 0; i < log.length; i++) {
        if (log[i]!.step.event.type !== 'TICK') continue;
        const fired = log[i]!.trace.filter((t) => t.event.type === 'CHECKIN_DUE' || t.event.type === 'CHECKIN_TIMEOUT');
        if (fired.length > 1) return { id: 'TICK_BURST', message: `${at(i, log)} fired ${fired.length} check-in events` };
      }
      return null;
    },
  },
];

export function firstViolation(scenario: Scenario, props: readonly Property[] = PROPERTIES): (Violation & { property: string }) | null {
  const log = simulate(scenario);
  for (const p of props) {
    const v = p.check(log, scenario);
    if (v) return { ...v, property: p.name };
  }
  return null;
}
