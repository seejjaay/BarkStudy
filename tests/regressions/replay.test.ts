import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../property/arbitraries';
import { firstViolation } from '../property/scenario';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('regression replay', () => {
  it(`replays every saved scenario (${files.length} on disk)`, () => {
    for (const file of files) {
      const { scenario } = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { scenario: Scenario };
      expect(firstViolation(scenario), file).toBeNull();
    }
  });
});
