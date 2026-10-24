import fc from 'fast-check';
import { DEFAULT_TUNING } from '../../src/engine/tuning';
import type { Cap, Context, Event } from '../../src/engine/types';

export interface Step {
  event: Event;
  ctx: Context;
}

/** Everything needed to replay a run: the engine seed plus the exact events and contexts. */
export interface Scenario {
  seed: number;
  steps: Step[];
}

const HOUR = 3_600_000;
const unit = fc.double({ min: 0, max: 1, noNaN: true });
const capArb: fc.Arbitrary<Cap> = fc.constantFrom<Cap>(2, 3, 4);

/** Half frame-sized ticks (so effects are caught mid-flight), the rest up to 5 min, plus a 5 % tail of sleep/resume gaps up to 6 h. */
const dtArb = fc.oneof(
  { weight: 50, arbitrary: fc.integer({ min: 16, max: 2_000 }) },
  { weight: 45, arbitrary: fc.integer({ min: 2_001, max: 300_000 }) },
  { weight: 5, arbitrary: fc.integer({ min: 300_001, max: 6 * HOUR }) },
);

export const ctxArb: fc.Arbitrary<Context> = fc.record({
  traits: fc.record({ neediness: unit, drama: unit, patience: unit, zoominess: unit }),
  tuning: fc.constant(DEFAULT_TUNING),
  activeWindowId: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
  busy: fc.boolean(),
  lastGuiltMs: fc.option(fc.integer({ min: 0, max: HOUR }), { nil: null }),
});

export const eventArb: fc.Arbitrary<Event> = fc.oneof(
  { weight: 24, arbitrary: dtArb.map((dtMs): Event => ({ type: 'TICK', dtMs })) },
  { weight: 3, arbitrary: capArb.map((cap): Event => ({ type: 'SESSION_START', cap })) },
  { weight: 1, arbitrary: fc.constant<Event>({ type: 'SESSION_END' }) },
  { weight: 4, arbitrary: fc.constant<Event>({ type: 'CHECKIN_DUE' }) },
  { weight: 5, arbitrary: fc.constant<Event>({ type: 'CHECKIN_TIMEOUT' }) },
  { weight: 4, arbitrary: fc.boolean().map((correct): Event => ({ type: 'ANSWER_SUBMITTED', correct })) },
  {
    weight: 5,
    arbitrary: fc.constantFrom('active', 'away', 'locked').map((state): Event => ({ type: 'USER_ACTIVITY', state })),
  },
  { weight: 2, arbitrary: fc.integer({ min: 1_000, max: 600_000 }).map((durationMs): Event => ({ type: 'STAY_ON', durationMs })) },
  { weight: 1, arbitrary: fc.constant<Event>({ type: 'STAY_OFF' }) },
  { weight: 2, arbitrary: fc.constant<Event>({ type: 'PAUSE' }) },
  { weight: 2, arbitrary: fc.constant<Event>({ type: 'RESUME' }) },
  { weight: 5, arbitrary: fc.constant<Event>({ type: 'ESC_PRESSED' }) },
  {
    weight: 1,
    arbitrary: fc
      .option(fc.integer({ min: 1, max: 1000 }), { nil: null })
      .map((windowId): Event => ({ type: 'WINDOW_FOCUS_CHANGED', windowId })),
  },
  { weight: 2, arbitrary: fc.boolean().map((on): Event => ({ type: 'SUPPRESS_CHANGED', on })) },
  { weight: 2, arbitrary: capArb.map((cap): Event => ({ type: 'CAP_CHANGED', cap })) },
);

const stepArb: fc.Arbitrary<Step> = fc.record({ event: eventArb, ctx: ctxArb });

/** Scenarios of up to 300 events, always opening with a session so the interesting rules are live. */
export const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    seed: fc.integer(),
    cap: capArb,
    ctx: ctxArb,
    steps: fc.array(stepArb, { maxLength: 300, size: 'max' }),
  })
  .map(({ seed, cap, ctx, steps }): Scenario => ({
    seed,
    steps: [{ event: { type: 'SESSION_START', cap }, ctx }, ...steps],
  }));
