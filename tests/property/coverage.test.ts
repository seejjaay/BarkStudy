import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scenarioArb } from './arbitraries';
import { simulate } from './scenario';

/** Guards against vacuous properties: the generator has to actually reach the states the properties talk about. */
describe('scenario coverage', () => {
  it('random scenarios reach every state the properties are about', () => {
    const reached = new Map<string, number>();
    const hit = (what: string) => reached.set(what, (reached.get(what) ?? 0) + 1);

    for (const scenario of fc.sample(scenarioArb, { numRuns: 500, seed: 1 })) {
      const seen = new Set<string>();
      for (const entry of simulate(scenario)) {
        const r = entry.state.rules;
        if (r.effect === 'laps') seen.add('laps running');
        if (r.effect === 'dig-in') seen.add('dig-in running');
        if (r.level === 4) seen.add('level 4');
        if (r.activity === 'away') seen.add('away');
        if (r.paused) seen.add('paused');
        if (r.stay) seen.add('stay');
        if (r.suppressed) seen.add('suppressed');
        if (r.missedWhileAway) seen.add('missed while away');
        if (entry.step.event.type === 'TICK' && entry.step.event.dtMs > 3_600_000) seen.add('multi-hour tick');
        if (entry.actions.some((a) => a.type === 'RECORD_GUILT_TRIP')) seen.add('guilt trip');
        if (entry.actions.some((a) => a.type === 'AWARD_TREAT')) seen.add('treat');
        if (entry.step.event.type === 'ESC_PRESSED' && entry.prev.rules.effect !== null) seen.add('esc during effect');
        if (entry.trace.filter((t) => t.actions.some((a) => a.type === 'START_DIG_IN')).length > 0) seen.add('dig-in started');
      }
      seen.forEach(hit);
    }

    const required = [
      'laps running',
      'dig-in running',
      'level 4',
      'away',
      'paused',
      'stay',
      'suppressed',
      'missed while away',
      'multi-hour tick',
      'guilt trip',
      'treat',
      'esc during effect',
      'dig-in started',
    ];
    for (const what of required) expect(reached.get(what) ?? 0, what).toBeGreaterThanOrEqual(10);
  });
});
