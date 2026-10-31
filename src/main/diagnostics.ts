import { ENGINE_LOG_FENCE, type EngineLog } from '../engine/replay';
import type { SessionView } from '../shared/control';
import type { Settings } from '../shared/settings';

/**
 * The text a user pastes into a bug report. Pure: `index.ts` gathers the input. It holds versions, counts and the
 * engine log, and never card text, deck names, topics, excluded-app names, the home folder or the account name.
 */

export interface DiagnosticsInput {
  app: { version: string; electron: string; chrome: string; node: string };
  os: { release: string; arch: string };
  displays: { width: number; height: number; scale: number }[];
  settings: Settings;
  state: { trackerDown: boolean; leaveItConflict: boolean; batterySaver: boolean; phase: SessionView['phase'] };
  crashes: { count: number; newest: number | null };
  /** `log.tail(50, 'warn')`, oldest first. An entry with a stack is one string with newlines. */
  problems: string[];
  engine: EngineLog | null;
  home: string;
  user: string;
}

/** GitHub's issue body limit is 65,536 characters. */
export const MAX_DIAGNOSTICS_CHARS = 60_000;
/** One runaway message must not crowd out the rest. */
const MAX_PROBLEM_CHARS = 2_000;

/** The text of `name` as a pattern: either slash, and a space written plainly or as `%20` (a file URL). */
function looseSource(name: string): string {
  return [...name.replace(/[\\/]+$/, '')]
    .map((ch) => (ch === '\\' || ch === '/' ? '[\\\\/]' : ch === ' ' ? '(?: |%20)' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
}

/** Takes the home folder and the account name out of `text`. */
export function scrub(text: string, home: string, user: string): string {
  let out = text;
  if (home.trim() !== '') out = out.replace(new RegExp(looseSource(home), 'gi'), () => '%USERPROFILE%');
  out = out.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s'"]+/gi, () => '%USERPROFILE%');
  if (user.trim() !== '') out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${looseSource(user)}(?![\\p{L}\\p{N}_])`, 'giu'), () => '<user>');
  return out;
}

const yesNo = (v: boolean): string => (v ? 'yes' : 'no');
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Everything except the problems and the engine log, scrubbed line by line (the headings are ours, so they are left alone). */
function summary(i: DiagnosticsInput): string {
  const s = (text: string): string => scrub(text, i.home, i.user);
  const section = (heading: string, lines: string[]): string => `## ${heading}\n${s(lines.join('\n'))}\n`;
  const { app, os, settings, state, crashes } = i;
  return [
    '# BarkStudy diagnostics\n',
    section('App', [`BarkStudy ${app.version}`, `Electron ${app.electron}`, `Chrome ${app.chrome}`, `Node ${app.node}`]),
    section('OS', [`Windows ${os.release}`, `Architecture: ${os.arch}`]),
    section('Displays', [`Count: ${i.displays.length}`, ...i.displays.map((d, n) => `${n + 1}: ${d.width}x${d.height} at ${d.scale}x`)]),
    section('Settings', [
      `Cap: ${settings.cap}`,
      `Preset: ${settings.preset}`,
      `Reduced motion: ${settings.reducedMotion}`,
      `Sound: ${settings.soundOn ? 'on' : 'off'}`,
      `Excluded apps: ${settings.excludedApps.length}`,
    ]),
    section('State', [
      `Window tracker down: ${yesNo(state.trackerDown)}`,
      `Leave it shortcut conflict: ${yesNo(state.leaveItConflict)}`,
      `Battery saver: ${yesNo(state.batterySaver)}`,
      `Session phase: ${state.phase}`,
    ]),
    section('Crash dumps', [`Count: ${crashes.count}`, `Newest: ${crashes.newest === null ? 'none' : day(crashes.newest)}`]),
  ].join('\n');
}

function problemsSection(problems: string[], omitted: number): string {
  const note = omitted > 0 ? `(${omitted} older ${omitted === 1 ? 'problem' : 'problems'} left out to fit)\n` : '';
  return `\n## Recent problems\n${problems.length === 0 && omitted === 0 ? 'None.\n' : `${note}\`\`\`text\n${problems.join('\n')}\n\`\`\`\n`}`;
}

function engineSection(engine: EngineLog | null): string {
  // The log holds numbers and fixed words only, so it is not scrubbed: an account named "classic" or "4" would otherwise break its JSON.
  return `\n## Engine log\n${engine === null ? 'No session has run since BarkStudy started.\n' : `\`\`\`${ENGINE_LOG_FENCE}\n${JSON.stringify(engine)}\n\`\`\`\n`}`;
}

/** The largest `n` in 0..total with `fits(n)`, or -1 if not even 0 fits. `fits` must get harder as `n` grows. */
function largestFit(total: number, fits: (n: number) => boolean): number {
  if (!fits(0)) return -1;
  let lo = 0;
  let hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function buildDiagnostics(input: DiagnosticsInput, maxChars = MAX_DIAGNOSTICS_CHARS): string {
  const head = summary(input);
  // A fence in a message must not open a second engine-log block.
  const problems = input.problems.map((p) => scrub(p, input.home, input.user).replace(/`{3,}/g, "'''").slice(0, MAX_PROBLEM_CHARS));
  const total = problems.length;
  const build = (keep: number, engine: EngineLog | null): string => head + problemsSection(problems.slice(total - keep), total - keep) + engineSection(engine);

  // First the oldest problems go...
  const keep = largestFit(total, (n) => build(n, input.engine).length <= maxChars);
  if (keep >= 0) return build(keep, input.engine);

  // ...then the newest engine entries, with every problem gone. The log keeps its start (replay runs forward from startState), so what is left still replays.
  const log = input.engine;
  if (log === null) return build(0, null);
  const trimmed = (n: number): EngineLog => ({ ...log, truncated: true, entries: log.entries.slice(0, n) });
  const kept = Math.max(0, largestFit(log.entries.length, (n) => build(0, trimmed(n)).length <= maxChars));
  return build(0, trimmed(kept));
}
