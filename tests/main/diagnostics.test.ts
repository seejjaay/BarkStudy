import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../src/engine/engine';
import { ENGINE_LOG_FENCE, extractEngineLog, replayLog, toEvents, type EngineLog, type LogEntry } from '../../src/engine/replay';
import type { Action } from '../../src/engine/types';
import { DEFAULT_TUNING } from '../../src/engine/tuning';
import { accountName, buildDiagnostics, scrub, type DiagnosticsInput } from '../../src/main/diagnostics';
import { createEngineHost, type HostSink } from '../../src/main/engineHost';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { newCard } from '../../src/shared/srs';

const HOME = 'C:\\Users\\CJ Nicko Rosales';
const USER = 'CJ Nicko Rosales';
const MIN = 60_000;

const logOf = (entries: LogEntry[], over: Partial<EngineLog> = {}): EngineLog => ({
  version: 1,
  seed: 7,
  preset: 'classic',
  tuning: { ...DEFAULT_TUNING },
  lastGuiltMs: null,
  startState: createEngine(7),
  truncated: false,
  entries,
  ...over,
});

const sessionLog = (): EngineLog =>
  logOf([
    { type: 'WINDOW', at: 0, detail: 'on' },
    { type: 'BUSY', at: 0, detail: 'off' },
    { type: 'SESSION_START', at: 0, detail: '4' },
    { type: 'TICK', at: 10 * MIN, dtMs: 10 * MIN, count: 2400 },
  ]);

const input = (over: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  app: { version: '1.0.0', electron: '33.0.0', chrome: '130.0.1', node: '20.18.0' },
  os: { release: '10.0.26300', arch: 'x64' },
  displays: [
    { width: 1920, height: 1080, scale: 1.25 },
    { width: 2560, height: 1440, scale: 1 },
  ],
  settings: { ...DEFAULT_SETTINGS, excludedApps: ['secret-game.exe', 'private-notes.exe', 'zoom.exe'] },
  state: { trackerDown: false, leaveItConflict: true, batterySaver: false, phase: 'idle' },
  crashes: { count: 2, newest: Date.UTC(2026, 9, 30, 12, 0, 0) },
  problems: ['write failed: disk full', 'tracker hiccup'],
  engine: sessionLog(),
  home: HOME,
  user: USER,
  ...over,
});

describe('buildDiagnostics', () => {
  it('has each section, in order, and counts excluded apps without naming them', () => {
    const text = buildDiagnostics(input());
    const headings = ['## App', '## OS', '## Displays', '## Settings', '## State', '## Crash dumps', '## Recent problems', '## Engine log'];
    const at = headings.map((h) => text.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain('Excluded apps: 3');
    for (const name of ['secret-game', 'private-notes', 'zoom.exe']) expect(text).not.toContain(name);
    expect(text).toContain('1920x1080');
    expect(text).toContain('Leave it shortcut conflict: yes');
    expect(text).toContain('2026-10-30');
    expect(text).toContain('```' + ENGINE_LOG_FENCE);
  });

  it('says so when there is no engine log, and when there are no problems or dumps', () => {
    const text = buildDiagnostics(input({ engine: null, problems: [], crashes: { count: 0, newest: null } }));
    expect(text).not.toContain('```' + ENGINE_LOG_FENCE);
    expect(extractEngineLog(text)).toBeNull();
    expect(text).toContain('## Engine log');
  });

  it('carries the engine log so extractEngineLog reads the same log back', () => {
    const log = sessionLog();
    expect(extractEngineLog(buildDiagnostics(input({ engine: log })))).toEqual(log);
  });

  it('leaves the engine log intact even when the account name is a word that appears in it', () => {
    const log = sessionLog();
    const text = buildDiagnostics(input({ engine: log, user: 'classic', home: 'C:\\Users\\classic' }));
    expect(extractEngineLog(text)).toEqual(log);
  });

  it('scrubs the problems', () => {
    const text = buildDiagnostics(input({ problems: [`Error: EPERM, open '${HOME}\\AppData\\Roaming\\BarkStudy\\data\\decks.json'\n    at C:\\Users\\CJNICK~1\\x.js:1`] }));
    expect(text).not.toContain('CJ Nicko');
    expect(text).not.toContain('CJNICK');
    expect(text).toContain('%USERPROFILE%\\AppData');
  });

  describe('renderer errors', () => {
    const header = '2026-11-01T10:00:00.000Z ERROR renderer: ';
    const render = (problem: string): string => buildDiagnostics(input({ problems: [problem] }));

    it('keeps the error type and the stack frames but withholds the message, which can quote a card or deck', () => {
      const text = render(`${header}Cannot read properties of undefined (reading 'Paris')
  TypeError: Cannot read properties of undefined (reading 'Paris')
    at render (app://bark/assets/control.js:1:2)
    at flush (app://bark/assets/control.js:3:4)`);
      expect(text).not.toContain('Paris');
      expect(text).not.toContain('Capitals');
      expect(text).toContain('renderer: TypeError (message withheld)');
      expect(text).toContain('at render (app://bark/assets/control.js:1:2)');
    });

    it('withholds the message when there is no stack to take a type from', () => {
      const text = render(`${header}the deck "Capitals" could not be shown`);
      expect(text).not.toContain('Capitals');
      expect(text).toContain('renderer: (message withheld)');
    });

    it('leaves our own dropped-count line and other areas alone', () => {
      const text = buildDiagnostics(input({ problems: ['2026-11-01T10:00:00.000Z WARN  renderer: 980 more renderer errors dropped', '2026-11-01T10:00:01.000Z ERROR main: could not write the settings file'] }));
      expect(text).toContain('renderer: 980 more renderer errors dropped');
      expect(text).toContain('main: could not write the settings file');
    });
  });

  it('cannot be tricked into a second engine-log block by a problem line', () => {
    const log = sessionLog();
    const text = buildDiagnostics(input({ engine: log, problems: ['```' + ENGINE_LOG_FENCE + '\n{"version":1}\n```'] }));
    expect(extractEngineLog(text)).toEqual(log);
  });

  it('a real engine log from a host round-trips and replays without a broken invariant', () => {
    vi.useFakeTimers();
    try {
      const noop = new Proxy({}, { get: () => () => undefined }) as unknown as HostSink;
      const host = createEngineHost({ seed: 31, sink: noop });
      host.setActiveWindow(5);
      host.start({ cards: [newCard('c1', 'front', 'back', 0)], cap: 4, preset: 'classic', checkinMinMinutes: 1, checkinMaxMinutes: 1 });
      host.setBusy(true);
      vi.advanceTimersByTime(30_000);
      host.setBusy(false);
      vi.advanceTimersByTime(8 * MIN);
      host.end();
      const log = host.diagnostics()!;
      expect(log.entries[0]!.type).not.toBe('SESSION_START');
      const back = extractEngineLog(buildDiagnostics(input({ engine: log })));
      expect(back).toEqual(log);
      expect(replayLog(back!).violation).toBeNull();
      host.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('scrub', () => {
  const cases: [string, string][] = [
    ['C:\\Users\\CJ Nicko Rosales\\AppData\\x.json', 'home, backslashes'],
    ['c:/users/CJ Nicko Rosales/x', 'home, forward slashes, any case'],
    ['C:\\Users\\CJNICK~1\\AppData\\Local\\Temp\\y', 'the 8.3 short name'],
    ['at file:///C:/Users/CJ%20Nicko%20Rosales/AppData/main.js:3', 'a file URL'],
    ['at file:///c:/users/cj%20nicko%20rosales/x', 'a file URL, any case'],
    ['signed in as CJ Nicko Rosales today', 'the bare name'],
    ['D:\\Users\\SomeoneElse\\Documents', 'another drive and another account'],
  ];

  it.each(cases)('replaces %s (%s)', (text) => {
    const out = scrub(text, HOME, USER);
    expect(out).not.toMatch(/CJ.?Nicko|Rosales|CJNICK|%20Nicko|SomeoneElse/i);
    expect(out).not.toMatch(/Users[\\/][^%]/i);
  });

  it('writes %USERPROFILE% for a path and <user> for a bare name', () => {
    expect(scrub('C:\\Users\\CJ Nicko Rosales\\AppData\\x.json', HOME, USER)).toBe('%USERPROFILE%\\AppData\\x.json');
    expect(scrub('c:/users/CJ Nicko Rosales/x', HOME, USER)).toBe('%USERPROFILE%/x');
    expect(scrub('C:\\Users\\CJNICK~1\\AppData\\Local\\Temp\\y', HOME, USER)).toBe('%USERPROFILE%\\AppData\\Local\\Temp\\y');
    expect(scrub('hello CJ Nicko Rosales!', HOME, USER)).toBe('hello <user>!');
  });

  it('catches JSON-escaped paths, where every backslash is doubled', () => {
    expect(scrub('{"path":"C:\\\\Users\\\\CJNICK~1\\\\AppData"}', HOME, USER)).toBe('{"path":"%USERPROFILE%\\\\AppData"}');
    // The account name here is not the folder name, so only the home pass can save it.
    const out = scrub('open C:\\\\Users\\\\CJ Nicko Rosales\\\\x failed', HOME, 'rosal');
    expect(out).toBe('open %USERPROFILE%\\\\x failed');
    expect(scrub('file:///C://Users//CJNICK~1/x', HOME, USER)).toBe('file:///%USERPROFILE%/x');
  });

  it('does not leave half of a profile folder name that has a space', () => {
    const out = scrub('D:\\Users\\Ann Lee\\x', 'C:\\Users\\Ann Lee', 'ann');
    expect(out).toBe('%USERPROFILE%\\x');
    expect(out).not.toMatch(/Ann|Lee/);
    expect(scrub('D:\\\\Users\\\\Ann Lee\\\\x', 'C:\\Users\\Ann Lee', 'ann')).toBe('%USERPROFILE%\\\\x');
  });

  it('scrubs the profile folder name too when the account name is different', () => {
    expect(scrub('hello CJ Nicko Rosales!', HOME, 'rosal')).toBe('hello <user>!');
    expect(scrub('hello rosal!', HOME, 'rosal')).toBe('hello <user>!');
    expect(scrub('D:\\Users\\CJ Nicko Rosales\\x', HOME, 'rosal')).toBe('%USERPROFILE%\\x');
  });

  it('does not use a profile folder name shorter than three characters', () => {
    expect(scrub('go to the ab shop', 'C:\\Users\\ab', 'someone')).toBe('go to the ab shop');
  });

  it('matches the name as a whole word only', () => {
    expect(scrub('cjay and cj', 'C:\\Users\\cj', 'cj')).toBe('cjay and <user>');
    expect(scrub('Nick-nicknames', 'C:\\Users\\Nick', 'Nick')).toBe('<user>-nicknames');
  });

  it('copes with names that are regex syntax, and with empty input', () => {
    expect(scrub('a (b)+ c', 'C:\\Users\\(b)+', '(b)+')).toBe('a <user> c');
    expect(scrub('plain text', '', '')).toBe('plain text');
  });

  it('home and user appear nowhere in a whole bundle', () => {
    const text = buildDiagnostics(
      input({
        problems: ['C:\\Users\\CJ Nicko Rosales\\a', 'c:/users/cj nicko rosales/b', 'file:///C:/Users/CJ%20Nicko%20Rosales/c', 'CJ Nicko Rosales was here'],
      }),
    );
    expect(text.toLowerCase()).not.toContain('nicko');
    expect(text.toLowerCase()).not.toContain('rosales');
  });
});

describe('accountName', () => {
  it('uses the name Windows reports', () => {
    expect(accountName(() => 'rosal', HOME)).toBe('rosal');
  });

  it('falls back to the profile folder name when reading it throws, or it is blank', () => {
    const boom = (): string => {
      throw Object.assign(new Error('uv_os_get_passwd returned ENOENT'), { code: 'ERR_SYSTEM_ERROR' });
    };
    expect(accountName(boom, HOME)).toBe('CJ Nicko Rosales');
    expect(accountName(() => '  ', 'C:\\Users\\Ann Lee\\')).toBe('Ann Lee');
    expect(accountName(boom, '')).toBe('');
  });
});

describe('size cap', () => {
  const manyProblems = Array.from({ length: 10_000 }, (_, i) => `problem number ${i} with some words in it`);
  const bigLog = (): EngineLog =>
    logOf([
      { type: 'SESSION_START', at: 0, detail: '4' },
      ...Array.from({ length: 4_999 }, (_, i): LogEntry => ({ type: 'TICK', at: 1000 + i, dtMs: 250, count: 1 })),
    ]);

  it('keeps 10,000 problem lines and a 5,000-entry log within 60,000 characters', () => {
    const text = buildDiagnostics(input({ problems: manyProblems, engine: bigLog() }));
    expect(text.length).toBeLessThanOrEqual(60_000);
  });

  it('drops the oldest problems first and says how many', () => {
    const text = buildDiagnostics(input({ problems: manyProblems, engine: null }));
    expect(text.length).toBeLessThanOrEqual(60_000);
    expect(text).toContain('problem number 9999 ');
    expect(text).not.toContain('problem number 0 ');
    expect(text).toMatch(/older problems? left out/);
  });

  it('once the problems are all gone, trims the log from its end and marks it truncated', () => {
    const log = bigLog();
    const text = buildDiagnostics(input({ engine: log }));
    expect(text.length).toBeLessThanOrEqual(60_000);
    expect(text).toContain('2 older problems left out');
    const back = extractEngineLog(text);
    expect(back).not.toBeNull();
    expect(back!.truncated).toBe(true);
    expect(back!.entries.length).toBeGreaterThan(0);
    expect(back!.entries.length).toBeLessThan(log.entries.length);
    expect(back!.entries).toEqual(log.entries.slice(0, back!.entries.length));
    expect(back!.startState).toEqual(log.startState);
  });

  it('a capped bundle from a real host log still replays, and gives the same actions as the run it was cut from', () => {
    vi.useFakeTimers();
    try {
      const actions: Action[] = [];
      const sink = new Proxy({}, { get: () => () => undefined }) as unknown as HostSink;
      const record: HostSink = {
        ...sink,
        showCard: () => void actions.push({ type: 'SHOW_FLASHCARD' }),
        hideCard: () => undefined,
        say: (line, params) => void actions.push(params ? { type: 'SAY', line, params } : { type: 'SAY', line }),
        expression: (name) => void actions.push({ type: 'SET_EXPRESSION', name }),
        walkTo: () => void actions.push({ type: 'WALK_TO', windowId: 1 }),
        effect: (a) => void actions.push('windowId' in a ? { ...a, windowId: 1 } : a),
        treat: () => void actions.push({ type: 'AWARD_TREAT' }),
        guiltTrip: (waitedMs) => void actions.push({ type: 'RECORD_GUILT_TRIP', waitedMs }),
      };
      const host = createEngineHost({ seed: 31, sink: record });
      host.setActiveWindow(5);
      host.start({ cards: [newCard('c1', 'front', 'back', 0)], cap: 4, preset: 'classic', checkinMinMinutes: 1, checkinMaxMinutes: 1 });
      // Every busy flip is its own entry and breaks up the merged ticks, so this log is thousands of entries long.
      for (let i = 0; i < 2_000; i++) {
        host.setBusy(i % 2 === 0);
        vi.advanceTimersByTime(250);
      }
      host.end();
      const full = host.diagnostics()!;
      host.dispose();
      expect(JSON.stringify(full).length).toBeGreaterThan(100_000);

      const bundle = buildDiagnostics(input({ engine: full }));
      expect(bundle.length).toBeLessThanOrEqual(60_000);
      const back = extractEngineLog(bundle)!;
      expect(back.truncated).toBe(true);
      expect(back.entries.length).toBeGreaterThan(0);
      expect(back.entries.length).toBeLessThan(full.entries.length);
      expect(back.entries).toEqual(full.entries.slice(0, back.entries.length));

      const replayed = replayLog(back);
      expect(replayed.violation).toBeNull();
      const steps = toEvents(back).length;
      expect(replayed.actions).toEqual(replayLog(full).actions.slice(0, steps));
      const flat = replayed.actions.flat();
      expect(flat.length).toBeGreaterThan(0);
      expect(actions.slice(0, flat.length)).toEqual(flat);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not touch a small bundle', () => {
    const log = sessionLog();
    const back = extractEngineLog(buildDiagnostics(input({ engine: log })));
    expect(back!.truncated).toBe(false);
    expect(back!.entries).toHaveLength(log.entries.length);
  });

  it('shortens one enormous problem rather than losing the others', () => {
    const text = buildDiagnostics(input({ problems: ['x'.repeat(500_000), 'second'] }));
    expect(text.length).toBeLessThanOrEqual(60_000);
    expect(text).toContain('second');
  });

  it('honours a smaller cap', () => {
    expect(buildDiagnostics(input({ problems: manyProblems, engine: bigLog() }), 12_000).length).toBeLessThanOrEqual(12_000);
  });
});

afterEach(() => vi.useRealTimers());
