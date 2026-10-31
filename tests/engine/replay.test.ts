import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src/engine/engine';
import { extractEngineLog, replayLog, toEvents, type EngineLog, type LogEntry } from '../../src/engine/replay';
import { INITIAL_RULES } from '../../src/engine/rules';
import { DEFAULT_TUNING } from '../../src/engine/tuning';

const MIN = 60_000;

const logOf = (entries: LogEntry[], over: Partial<EngineLog> = {}): EngineLog => ({
  version: 1,
  seed: 7,
  preset: 'classic',
  tuning: { ...DEFAULT_TUNING, checkinMinMs: MIN, checkinMaxMs: MIN },
  lastGuiltMs: null,
  startState: createEngine(7),
  truncated: false,
  entries,
  ...over,
});

/** Ten minutes of unanswered card with a window to go to: card, then levels 2, 3 and 4. */
const escalating = (): EngineLog =>
  logOf([
    { type: 'WINDOW', at: 0, detail: 'on' },
    { type: 'SESSION_START', at: 0, detail: '4' },
    { type: 'TICK', at: 10 * MIN, dtMs: 10 * MIN, count: 2400 },
  ]);

const bundle = (log: EngineLog): string =>
  ['# BarkStudy diagnostics', '', 'Version: 1.0.0', '', '```barkstudy-engine-log', JSON.stringify(log, null, 2), '```', '', '## Settings', '{}'].join('\n');

describe('toEvents', () => {
  it('expands a merged tick into its ticks', () => {
    const steps = toEvents(logOf([{ type: 'TICK', at: 1000, dtMs: 1000, count: 4 }]));
    expect(steps).toEqual(Array.from({ length: 4 }, () => ({ event: { type: 'TICK', dtMs: 250 }, ctxPatch: null })));
  });

  it('keeps the stay length, and turns log-only entries into context patches', () => {
    const steps = toEvents(
      logOf([
        { type: 'STAY_ON', at: 0, durationMs: 900_000 },
        { type: 'BUSY', at: 0, detail: 'on' },
        { type: 'WINDOW', at: 0, detail: 'off' },
      ]),
    );
    expect(steps[0]).toEqual({ event: { type: 'STAY_ON', durationMs: 900_000 }, ctxPatch: null });
    expect(steps[1]).toEqual({ event: null, ctxPatch: { busy: true } });
    expect(steps[2]).toEqual({ event: null, ctxPatch: { activeWindowId: null } });
  });
});

describe('extractEngineLog', () => {
  it('finds the fenced block inside a full bundle', () => {
    const log = escalating();
    expect(extractEngineLog(bundle(log))).toEqual(log);
  });

  it('also reads bare JSON', () => {
    const log = escalating();
    expect(extractEngineLog(JSON.stringify(log))).toEqual(log);
  });

  it('returns null for garbage, a wrong version, or a malformed entry', () => {
    expect(extractEngineLog('not a log at all')).toBeNull();
    expect(extractEngineLog('```barkstudy-engine-log\n{ nope\n```')).toBeNull();
    expect(extractEngineLog(bundle({ ...escalating(), version: 2 as 1 }))).toBeNull();
    expect(extractEngineLog(bundle(logOf([{ type: 'BARK' as 'PAUSE', at: 0 }])))).toBeNull();
    expect(extractEngineLog(bundle(logOf([{ type: 'TICK', at: 0, dtMs: 250, count: 1e12 }])))).toBeNull();
  });
});

describe('replayLog', () => {
  it('replays a log that reaches level 4 without breaking an invariant', () => {
    const r = replayLog(escalating());
    expect(r.violation).toBeNull();
    const types = r.actions.flat().map((a) => a.type);
    expect(types).toContain('SHOW_FLASHCARD');
    expect(types).toContain('START_DIG_IN');
  });

  it('starts from the logged state, so a session that carried a pause over does not prompt', () => {
    const start = createEngine(7);
    const r = replayLog(
      logOf([{ type: 'CHECKIN_DUE', at: 0 }], {
        startState: { ...start, rules: { ...INITIAL_RULES, session: true, paused: true }, pausedAt: 0 },
      }),
    );
    expect(r.actions.flat().map((a) => a.type)).not.toContain('SHOW_FLASHCARD');
  });

  it('replays the sample written from the host round trip cleanly', () => {
    const log = extractEngineLog(readFileSync('tests/fixtures/replay/sample.txt', 'utf8'));
    expect(log).not.toBeNull();
    const r = replayLog(log!);
    expect(r.violation).toBeNull();
    expect(r.actions.flat().length).toBeGreaterThan(0);
  });
});
