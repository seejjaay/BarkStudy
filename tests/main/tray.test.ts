import { describe, expect, it, vi } from 'vitest';
import type { DeckSummary, Result, SessionView, StartRequest } from '../../src/shared/control';
import { makeIcon } from '../../src/main/icon';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings';
import {
  MAX_TRAY_DECKS,
  buildTrayMenu,
  parseTrayAction,
  runTrayAction,
  statusLine,
  toggleLeaveIt,
  trayTooltip,
  type MenuItemSpec,
  type TrayActionDeps,
  type TrayInputs,
} from '../../src/main/trayModel';

type Running = Extract<SessionView, { phase: 'running' }>;
const running = (over: Partial<Running> = {}): SessionView => ({
  phase: 'running',
  deckId: 'd1',
  deckName: 'French',
  topic: '',
  startedAt: 0,
  paused: false,
  stay: false,
  stayLeftMs: null,
  away: false,
  suppressed: false,
  card: null,
  answered: 0,
  treats: 0,
  saveProblem: false,
  ...over,
});
const deck = (id: string, cardCount = 5): DeckSummary => ({ id, name: `Deck ${id}`, createdAt: 0, cardCount });
const inputs = (over: Partial<TrayInputs> = {}): TrayInputs => ({
  view: { phase: 'idle' },
  decks: [deck('a'), deck('b', 1), deck('empty', 0)],
  leaveItLabel: 'Ctrl+Alt+L',
  leaveItConflict: false,
  trackerDown: false,
  soundOn: true,
  volume: 0.4,
  ...over,
});
const flat = (items: MenuItemSpec[]): MenuItemSpec[] => items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu) : [])]);
const labels = (items: MenuItemSpec[]) => items.filter((i) => !i.separator).map((i) => i.label);
const ids = (items: MenuItemSpec[]) => flat(items).flatMap((i) => (i.id ? [i.id] : []));

describe('statusLine', () => {
  it('says each state in words', () => {
    expect(statusLine({ phase: 'idle' })).toBe('No session running');
    expect(statusLine(running())).toBe('Studying French');
    expect(statusLine(running({ paused: true }))).toContain('paused');
    expect(statusLine(running({ stay: true, stayLeftMs: 12 * 60_000 + 30_000 }))).toBe('Studying French: staying, about 13 min left');
    expect(statusLine(running({ stay: true, stayLeftMs: 5 }))).toContain('about 1 min left');
    expect(statusLine(running({ away: true }))).toContain('away');
    expect(statusLine(running({ suppressed: true }))).toContain('quiet');
    expect(statusLine({ phase: 'ended', deckName: 'F', topic: '', startedAt: 0, endedAt: 1, answered: 4, treats: 3, longestWaitMs: 0, guiltTrips: 0, saved: true })).toBe(
      'Session finished: 4 answered, 3 treats',
    );
  });

  it('puts the same line in the tooltip', () => {
    expect(trayTooltip(running())).toBe('BarkStudy\nStudying French');
  });
});

describe('the menu when nothing is running', () => {
  it('offers Start with only the decks that have cards, then Open and Quit last', () => {
    const menu = buildTrayMenu(inputs());
    expect(labels(menu)[0]).toBe('No session running');
    const start = menu.find((i) => i.label === 'Start session');
    expect(start?.submenu?.map((i) => [i.id, i.label])).toEqual([
      ['start:a', 'Deck a (5 cards)'],
      ['start:b', 'Deck b (1 card)'],
    ]);
    expect(ids(menu).slice(-2)).toEqual(['open', 'quit']);
    expect(ids(menu)).not.toContain('end');
    expect(ids(menu)).not.toContain('pause');
  });

  it('with no usable deck, Start is a disabled explanation, not a dead button', () => {
    const menu = buildTrayMenu(inputs({ decks: [deck('empty', 0)] }));
    const item = menu.find((i) => i.label.startsWith('Start session'));
    expect(item).toMatchObject({ enabled: false, label: 'Start session (add a deck with cards first)' });
    expect(item?.id).toBeUndefined();
  });

  it('lists at most a dozen decks', () => {
    const many = Array.from({ length: 40 }, (_, i) => deck(`d${i}`));
    const start = buildTrayMenu(inputs({ decks: many })).find((i) => i.label === 'Start session');
    expect(start?.submenu).toHaveLength(MAX_TRAY_DECKS);
  });

  it('a finished session still offers Start', () => {
    const view: SessionView = { phase: 'ended', deckName: 'F', topic: '', startedAt: 0, endedAt: 1, answered: 0, treats: 0, longestWaitMs: 0, guiltTrips: 0, saved: true };
    expect(buildTrayMenu(inputs({ view })).some((i) => i.label === 'Start session')).toBe(true);
  });
});

describe('the menu during a session', () => {
  it('offers pause, a stay, ending, and no Start', () => {
    const menu = buildTrayMenu(inputs({ view: running() }));
    expect(ids(menu)).toEqual(['pause', 'stay-on:15', 'stay-on:25', 'stay-on:50', 'end', 'sound:off', 'volume:0.4', 'volume:0.65', 'volume:0.9', 'open', 'quit']);
    expect(menu.find((i) => i.id === 'pause')).toMatchObject({ label: 'Leave it (pause)', hint: 'Ctrl+Alt+L' });
  });

  it('while paused it offers Resume, with the same shortcut shown', () => {
    const menu = buildTrayMenu(inputs({ view: running({ paused: true }) }));
    expect(menu.find((i) => i.id === 'resume')).toMatchObject({ label: 'Resume', hint: 'Ctrl+Alt+L' });
    expect(ids(menu)).not.toContain('pause');
  });

  it('during a stay it offers to end the stay instead of starting another', () => {
    const menu = buildTrayMenu(inputs({ view: running({ stay: true, stayLeftMs: 600_000 }) }));
    expect(ids(menu)).toContain('stay-off');
    expect(ids(menu).some((id) => id.startsWith('stay-on'))).toBe(false);
  });
});

describe('sound controls in the menu', () => {
  const sounds = (over: Partial<TrayInputs> = {}) => buildTrayMenu(inputs(over)).find((i) => i.label === 'Sounds');
  const volume = (over: Partial<TrayInputs> = {}) => buildTrayMenu(inputs(over)).find((i) => i.label === 'Volume');

  it('the menu shows Sounds checked or unchecked', () => {
    expect(sounds({ soundOn: true })).toMatchObject({ kind: 'checkbox', checked: true, id: 'sound:off' });
    expect(sounds({ soundOn: false })).toMatchObject({ kind: 'checkbox', checked: false, id: 'sound:on' });
  });

  it('the volume radio has the current level checked', () => {
    expect(volume({ volume: 0.4 })?.submenu?.map((i) => [i.id, i.label, i.kind, i.checked])).toEqual([
      ['volume:0.4', 'Low', 'radio', true],
      ['volume:0.65', 'Medium', 'radio', false],
      ['volume:0.9', 'High', 'radio', false],
    ]);
    expect(volume({ volume: 0.65 })?.submenu?.map((i) => i.checked)).toEqual([false, true, false]);
    expect(volume({ volume: 0.9 })?.submenu?.map((i) => i.checked)).toEqual([false, false, true]);
  });

  it('a volume that is none of the three leaves the radio unchecked rather than claiming one', () => {
    expect(volume({ volume: 0.5 })?.submenu?.map((i) => i.checked)).toEqual([false, false, false]);
  });

  it('they are there in every state of the session, and sit above Open and Quit', () => {
    const ended: SessionView = { phase: 'ended', deckName: 'F', topic: '', startedAt: 0, endedAt: 1, answered: 0, treats: 0, longestWaitMs: 0, guiltTrips: 0, saved: true };
    for (const view of [{ phase: 'idle' } as SessionView, running(), running({ paused: true }), ended]) {
      const menu = buildTrayMenu(inputs({ view }));
      const at = (label: string) => menu.findIndex((i) => i.label === label);
      expect(at('Sounds'), JSON.stringify(view)).toBeGreaterThan(-1);
      expect(at('Volume'), JSON.stringify(view)).toBe(at('Sounds') + 1);
      expect(at('Open BarkStudy'), JSON.stringify(view)).toBeGreaterThan(at('Volume'));
    }
  });
});

describe('warnings in the menu', () => {
  it('a shortcut taken by another app is named, as plain text that does nothing', () => {
    const note = buildTrayMenu(inputs({ leaveItConflict: true })).find((i) => i.label.includes('used by another app'));
    expect(note).toMatchObject({ enabled: false });
    expect(note?.label).toContain('Ctrl+Alt+L');
    expect(note?.id).toBeUndefined();
  });

  it('a tracker that is down is named too', () => {
    expect(labels(buildTrayMenu(inputs({ trackerDown: true }))).some((l) => l.startsWith('Window tracking is off'))).toBe(true);
  });

  it('no warning when nothing is wrong', () => {
    const l = labels(buildTrayMenu(inputs()));
    expect(l.some((x) => x.includes('another app') || x.includes('tracking'))).toBe(false);
  });
});

describe('parseTrayAction', () => {
  it.each([
    ['open', { kind: 'open' }],
    ['quit', { kind: 'quit' }],
    ['end', { kind: 'end' }],
    ['pause', { kind: 'pause' }],
    ['resume', { kind: 'resume' }],
    ['stay-off', { kind: 'stay-off' }],
    ['stay-on:25', { kind: 'stay-on', minutes: 25 }],
    ['start:abc-123', { kind: 'start', deckId: 'abc-123' }],
    ['sound:on', { kind: 'sound', on: true }],
    ['sound:off', { kind: 'sound', on: false }],
    ['volume:0.4', { kind: 'volume', level: 0.4 }],
    ['volume:0.65', { kind: 'volume', level: 0.65 }],
    ['volume:0.9', { kind: 'volume', level: 0.9 }],
  ])('%s', (id, action) => {
    expect(parseTrayAction(id)).toEqual(action);
  });

  it.each([
    '',
    'stay-on:7',
    'stay-on:',
    'start:',
    'start:' + 'x'.repeat(201),
    'rm -rf',
    'OPEN',
    'open ',
    'stay-on:15;x',
    'volume:0.5',
    'volume:1',
    'volume:0.40',
    'volume:',
    'volume:0.4 ',
    'sound:',
    'sound:maybe',
    'sound:on ',
  ])('%j is refused', (id) => {
    expect(parseTrayAction(id)).toBeNull();
  });

  it('every id the menu can produce parses back', () => {
    const all = [...ids(buildTrayMenu(inputs({ view: running() }))), ...ids(buildTrayMenu(inputs({ view: running({ paused: true, stay: true }) }))), ...ids(buildTrayMenu(inputs()))];
    for (const id of all) expect(parseTrayAction(id), id).not.toBeNull();
  });
});

describe('runTrayAction', () => {
  const okVoid: Result<void> = { ok: true, value: undefined };
  function setup(over: { start?: Result<unknown>; end?: Result<unknown>; control?: Result<unknown>; update?: Result<unknown> } = {}) {
    const calls: string[] = [];
    const notify = vi.fn();
    const deps: TrayActionDeps = {
      session: {
        start: vi.fn((req: StartRequest) => {
          calls.push(`start:${req.deckId}:${req.checkinMinMinutes}-${req.checkinMaxMinutes}:${JSON.stringify(req.topic)}`);
          return over.start ?? { ok: true, value: { phase: 'idle' } };
        }) as unknown as TrayActionDeps['session']['start'],
        end: vi.fn(() => {
          calls.push('end');
          return Promise.resolve(over.end ?? { ok: true, value: { phase: 'idle' } });
        }) as unknown as TrayActionDeps['session']['end'],
        control: vi.fn((a) => {
          calls.push(`control:${JSON.stringify(a)}`);
          return (over.control ?? okVoid) as Result<void>;
        }),
      },
      library: {
        getSettings: () => ({ ...DEFAULT_SETTINGS, checkinMinMinutes: 7, checkinMaxMinutes: 21, excludedApps: [] }),
        updateSettings: vi.fn((patch: Partial<Settings>) => {
          calls.push(`settings:${JSON.stringify(patch)}`);
          return Promise.resolve((over.update ?? { ok: true, value: {} }) as Result<Settings>);
        }),
      },
      openControl: () => calls.push('open'),
      quit: () => calls.push('quit'),
      notify,
    };
    return { deps, calls, notify };
  }

  it('starts a session from a deck using the saved check-in gap and no topic', async () => {
    const { deps, calls } = setup();
    await runTrayAction({ kind: 'start', deckId: 'a' }, deps);
    expect(calls).toEqual(['start:a:7-21:""']);
  });

  it('pause, resume and stay go to the session as controls', async () => {
    const { deps, calls } = setup();
    for (const a of [{ kind: 'pause' }, { kind: 'resume' }, { kind: 'stay-on', minutes: 50 }, { kind: 'stay-off' }] as const) await runTrayAction(a, deps);
    expect(calls).toEqual([
      'control:{"action":"pause"}',
      'control:{"action":"resume"}',
      'control:{"action":"stay-on","minutes":50}',
      'control:{"action":"stay-off"}',
    ]);
  });

  it('end, open and quit do what they say', async () => {
    const { deps, calls } = setup();
    for (const a of [{ kind: 'end' }, { kind: 'open' }, { kind: 'quit' }] as const) await runTrayAction(a, deps);
    expect(calls).toEqual(['end', 'open', 'quit']);
  });

  it('sound and volume go to the library as a settings patch', async () => {
    const { deps, calls } = setup();
    for (const a of [{ kind: 'sound', on: false }, { kind: 'sound', on: true }, { kind: 'volume', level: 0.65 }] as const) await runTrayAction(a, deps);
    expect(calls).toEqual(['settings:{"soundOn":false}', 'settings:{"soundOn":true}', 'settings:{"volume":0.65}']);
  });

  it('a settings change that cannot be saved tells the user instead of failing silently', async () => {
    const { deps, notify } = setup({ update: { ok: false, error: { code: 'write-failed', message: 'x' } } });
    await runTrayAction({ kind: 'sound', on: false }, deps);
    expect(notify).toHaveBeenCalledWith('That did not work. Open BarkStudy for details.');
  });

  it('a start that cannot happen tells the user why instead of failing silently', async () => {
    const { deps, notify } = setup({ start: { ok: false, error: { code: 'empty-deck', message: 'x' } } });
    await runTrayAction({ kind: 'start', deckId: 'a' }, deps);
    expect(notify).toHaveBeenCalledWith('That deck has no cards yet.');
  });

  it('an unexpected failure still produces a readable message', async () => {
    const { deps, notify } = setup({ end: { ok: false, error: { code: 'write-failed', message: 'x' } } });
    await runTrayAction({ kind: 'end' }, deps);
    expect(notify).toHaveBeenCalledWith('That did not work. Open BarkStudy for details.');
  });

  it('a success says nothing', async () => {
    const { deps, notify } = setup();
    await runTrayAction({ kind: 'pause' }, deps);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('toggleLeaveIt', () => {
  const session = (view: SessionView) => {
    const control = vi.fn();
    return { s: { view: () => view, control }, control };
  };

  it('pauses a running session and resumes a paused one', () => {
    const a = session(running());
    expect(toggleLeaveIt(a.s)).toBe('paused');
    expect(a.control).toHaveBeenCalledWith({ action: 'pause' });
    const b = session(running({ paused: true }));
    expect(toggleLeaveIt(b.s)).toBe('resumed');
    expect(b.control).toHaveBeenCalledWith({ action: 'resume' });
  });

  it('does nothing without a session', () => {
    const c = session({ phase: 'idle' });
    expect(toggleLeaveIt(c.s)).toBe('no-session');
    expect(c.control).not.toHaveBeenCalled();
  });
});

describe('the tray icon', () => {
  it('is a transparent square with an opaque roll in the middle and ears', () => {
    const size = 32;
    const px = makeIcon(size);
    expect(px.length).toBe(size * size * 4);
    const alphaAt = (x: number, y: number) => px[(y * size + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(size - 1, size - 1)).toBe(0);
    expect(alphaAt(16, 18)).toBe(255);
    expect(alphaAt(6, 6)).toBe(255); // an ear
    const opaque = [...px].filter((_, i) => i % 4 === 3 && px[i] === 255).length;
    expect(opaque).toBeGreaterThan(size * size * 0.3);
    expect(opaque).toBeLessThan(size * size * 0.8);
  });

  it('works at the other sizes Windows asks for', () => {
    for (const size of [16, 24, 48]) expect(makeIcon(size).length).toBe(size * size * 4);
  });
});
