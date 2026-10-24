// Dev tool: exhaustively explores the rule layer and prints the stats.
//   npm run explore                      -> real rules, exit 1 on any violation
//   npm run explore -- --mutant <id>     -> a deliberately broken copy; prints the counterexample, exits 1
import { INVARIANTS } from '../src/engine/invariants';
import { applyIntent, ruleStep } from '../src/engine/rules';
import { explore } from '../tests/checker/explorer';
import { MUTANTS, type MutantId } from '../tests/checker/mutants';

const flag = process.argv.indexOf('--mutant');
const mutantId = flag >= 0 ? process.argv[flag + 1] : undefined;

if (mutantId !== undefined && !(mutantId in MUTANTS)) {
  console.error(`unknown mutant "${mutantId}". Known: ${Object.keys(MUTANTS).join(', ')}`);
  process.exit(2);
}

const step = mutantId === undefined ? ruleStep : MUTANTS[mutantId as MutantId];
const r = explore(step, applyIntent, INVARIANTS);
console.log(`${r.states} states, ${r.transitions} transitions, ${INVARIANTS.length} invariants`);

if (r.violation) {
  console.log(`VIOLATION ${r.violation.invariant} after ${r.violation.trace.length} steps:`);
  r.violation.trace.forEach((t, i) => {
    console.log(`  ${i + 1}. ${JSON.stringify(t.event)} intent=${t.intent ?? '-'} actions=${JSON.stringify(t.actions)}`);
  });
  process.exit(1);
}
console.log('0 violations');
