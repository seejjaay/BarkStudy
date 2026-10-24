import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { scenarioArb, type Scenario } from './arbitraries';
import { PROPERTIES, simulate, type Property } from './scenario';

const REGRESSIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'regressions');
const RUNS = 2000;

/** Runs one property; on failure, writes the shrunk scenario to tests/regressions and fails with its path. */
function checkProperty(prop: Property): void {
  const details = fc.check(
    fc.property(scenarioArb, (scenario: Scenario) => prop.check(simulate(scenario), scenario) === null),
    { numRuns: RUNS },
  );
  if (!details.failed) return;

  const scenario = details.counterexample?.[0];
  if (!scenario) throw new Error(`property "${prop.name}" failed: ${String(details.errorInstance)}`);
  const violation = prop.check(simulate(scenario), scenario);
  const id = violation?.id ?? 'UNKNOWN';
  const file = join(REGRESSIONS, `${id}-${details.seed}.json`);
  mkdirSync(REGRESSIONS, { recursive: true });
  writeFileSync(file, JSON.stringify({ property: prop.name, violation, scenario }, null, 2) + '\n');
  throw new Error(`property "${prop.name}" failed (${id}, ${scenario.steps.length} events): ${violation?.message}\nregression saved to ${file}`);
}

describe('engine properties', () => {
  for (const prop of PROPERTIES) {
    it(prop.name, () => checkProperty(prop), 120_000);
  }
});
