// Dev tool: replays the engine log from a diagnostics bundle (or bare log JSON) and checks every invariant on the way.
//   npm run replay -- <bundle.txt>       -> reads the file
//   npm run replay < bundle.txt          -> reads stdin
// Prints the actions of each step that had any, then the verdict. Exits 1 on a broken invariant or an unreadable input.
import { readFileSync } from 'node:fs';
import { extractEngineLog, replayLog } from '../src/engine/replay';

const path = process.argv[2];
let text: string;
try {
  text = readFileSync(path ?? 0, 'utf8');
} catch (err) {
  console.error(`could not read ${path ?? 'stdin'}: ${(err as Error).message}`);
  process.exit(1);
}

const log = extractEngineLog(text);
if (!log) {
  console.error('no valid barkstudy-engine-log block or log JSON in the input');
  process.exit(1);
}

const { actions, violation } = replayLog(log);
actions.forEach((step, i) => {
  if (step.length > 0) console.log(`step ${i}: ${step.map((a) => a.type).join(', ')}`);
});
if (log.truncated) console.log(`The log was truncated; this replay covers its first ${log.entries.length} entries.`);

if (violation) {
  console.log(`Invariant ${violation.invariant} broken at step ${violation.step}.`);
  process.exit(1);
}
console.log('No invariant broken.');
