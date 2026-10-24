import { describe, expect, it } from 'vitest';
import { INVARIANTS } from '../../src/engine/invariants';
import { applyIntent } from '../../src/engine/rules';
import { explore } from './explorer';
import { MUTANTS } from './mutants';

const EXPECTED = {
  'wrong-answer-escalates': 'WRONG_NO_RAISE',
  'dig-ignores-cooldown': 'DIG_ONCE',
  'esc-ignored': 'ESC_ENDS',
  'cap-ignored': 'CAP',
} as const;

describe('deliberate mutants are caught', () => {
  it.each(Object.entries(EXPECTED))('%s is caught by %s with a trace <= 8', (id, invariant) => {
    const mutant = MUTANTS[id as keyof typeof MUTANTS];
    const r = explore(mutant, applyIntent, INVARIANTS);
    expect(r.violation?.invariant).toBe(invariant);
    expect(r.violation?.trace.length).toBeLessThanOrEqual(8);
  });

  it('every registered mutant has an expectation', () => {
    expect(Object.keys(MUTANTS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});
