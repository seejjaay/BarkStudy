import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createControlHandlers, MAX_BACKUP_CHARS, type ControlHandlers, type FileAccess } from '../../src/main/controlHandlers';
import { createLeaveIt } from '../../src/main/leaveIt';
import { createLibrary, type Library } from '../../src/main/library';
import { createSessionController, type SessionController } from '../../src/main/session';
import { createStorage } from '../../src/main/storage/io';
import type { LibrarySnapshot, Result } from '../../src/shared/control';
import { parseDeck } from '../../src/shared/deckParse';
import { SAMPLE_DECK } from '../../src/shared/sampleDeck';
import { sampleDiagnosticsInput } from './diagnosticsFixture';

let dir: string;
let lib: Library;
let session: SessionController;
let h: ControlHandlers;
let order: string[];
let backupPick: Result<{ path: string; text: string } | null>;
let backupSaves: { name: string; json: string }[];
let backupSaveResult: { path: string } | null;
let openPathResult: string;
let practice: boolean[];
let copied: string[];
let copyResult: Promise<void>;

const files: FileAccess = {
  pickImport: () => Promise.resolve({ ok: true, value: null }),
  saveExport: () => Promise.resolve(null),
  pickBackup: () => Promise.resolve(backupPick),
  saveBackup: (name, json) => {
    backupSaves.push({ name, json });
    return Promise.resolve(backupSaveResult);
  },
};
const call = <T = unknown>(op: string, args?: unknown) => h.handle(op, args) as Promise<T>;
const ok = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r.value;
};
const codeOf = (r: Result<unknown>): string | undefined => (r.ok ? undefined : r.error.code);
const names = () => lib.listDecks().map((d) => d.name);

beforeEach(async () => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-dataops-'));
  order = [];
  backupPick = { ok: true, value: null };
  backupSaves = [];
  backupSaveResult = { path: 'C:/out/backup.json' };
  openPathResult = '';
  practice = [];
  copied = [];
  copyResult = Promise.resolve();
  lib = await createLibrary({ storage: createStorage(dir) });
  session = createSessionController({ library: lib, seed: 1, publish: () => undefined });
  h = createControlHandlers({
    library: lib,
    session,
    files,
    status: () => ({ trackerDown: false, batterySaver: false, leaveItConflict: false, leaveItLabel: 'Ctrl+Alt+L' }),
    platform: {
      loginItem: { get: () => ({ available: false, on: false }), set: () => undefined },
      openApps: () => [],
      dataDir: 'C:/data',
      openLink: () => undefined,
      applyReducedMotion: () => undefined,
      version: '1.2.3',
      openPath: (path) => {
        order.push(`open:${path}`);
        return Promise.resolve(openPathResult);
      },
      afterReplace: () => void order.push('after'),
      setPractice: (on) => void practice.push(on),
      diagnostics: () => sampleDiagnosticsInput({ app: { version: '9.9.9', electron: '1', chrome: '2', node: '3' } }),
      copyText: (text) => {
        copied.push(text);
        return copyResult;
      },
    },
    hotkeys: { leaveIt: { rebind: () => true }, bubble: { rebind: () => true } },
  });
});
afterEach(() => {
  session.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function startSession(): Promise<void> {
  const deck = ok(await lib.importAsNewDeck('Running', 'a,b'));
  ok(await call<Result<unknown>>('session:start', { deckId: deck.deckId, topic: '', checkinMinMinutes: 5, checkinMaxMinutes: 15 }));
}

describe('app:snapshot', () => {
  it('says whether onboarding is done and which version this is', async () => {
    const snap = await call<LibrarySnapshot>('app:snapshot');
    expect(snap.onboarded).toBe(false);
    expect(snap.version).toBe('1.2.3');
  });
});

describe('data:open-folder', () => {
  it('opens the data folder', async () => {
    ok(await call<Result<void>>('data:open-folder'));
    expect(order).toEqual(['open:C:/data']);
  });

  it('reports a folder that could not be opened', async () => {
    openPathResult = 'access denied';
    expect(codeOf(await call<Result<void>>('data:open-folder'))).toBe('file-unreadable');
  });
});

describe('data:export-all', () => {
  it('saves a dated backup file that holds the whole library', async () => {
    ok(await lib.createDeck('French'));
    expect(ok(await call<Result<{ path: string } | null>>('data:export-all'))).toEqual({ path: 'C:/out/backup.json' });
    expect(backupSaves[0]!.name).toMatch(/^barkstudy-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(backupSaves[0]!.json)).toMatchObject({ app: 'barkstudy', kind: 'backup' });
  });

  it('cancelling the save dialog is a quiet success', async () => {
    backupSaveResult = null;
    expect(ok(await call<Result<unknown>>('data:export-all'))).toBeNull();
  });

  it('passes on a refusal to export, and writes no file', async () => {
    vi.spyOn(lib, 'exportAll').mockReturnValueOnce({ ok: false, error: { code: 'store-unavailable', message: 'decks' } });
    expect(codeOf(await call<Result<unknown>>('data:export-all'))).toBe('store-unavailable');
    expect(backupSaves).toEqual([]);
  });
});

describe('data:import-all', () => {
  it('replaces everything with the backup, and re-applies the settings only after the write has landed', async () => {
    ok(await lib.createDeck('Kept'));
    const json = ok(lib.exportAll());
    ok(await lib.createDeck('Extra'));
    const replace = lib.replaceAll.bind(lib);
    vi.spyOn(lib, 'replaceAll').mockImplementation(async (text) => {
      const r = await replace(text);
      order.push('replaced');
      return r;
    });
    backupPick = { ok: true, value: { path: 'C:/in/b.json', text: json } };
    expect(ok(await call<Result<{ path: string } | null>>('data:import-all'))).toEqual({ path: 'C:/in/b.json' });
    expect(names()).toEqual(['Kept']);
    expect(order).toEqual(['replaced', 'after']);
  });

  it('is refused while a session is running, and touches nothing', async () => {
    await startSession();
    const replaceAll = vi.spyOn(lib, 'replaceAll');
    backupPick = { ok: true, value: { path: 'x', text: ok(lib.exportAll()) } };
    expect(codeOf(await call<Result<unknown>>('data:import-all'))).toBe('session-running');
    expect(replaceAll).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('cancelling the open dialog changes nothing', async () => {
    const replaceAll = vi.spyOn(lib, 'replaceAll');
    expect(ok(await call<Result<unknown>>('data:import-all'))).toBeNull();
    expect(replaceAll).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('passes on a file the picker could not read or found too large', async () => {
    backupPick = { ok: false, error: { code: 'file-too-large', message: 'big' } };
    expect(codeOf(await call<Result<unknown>>('data:import-all'))).toBe('file-too-large');
  });

  it('refuses text beyond the size limit before it is even parsed', async () => {
    const replaceAll = vi.spyOn(lib, 'replaceAll');
    backupPick = { ok: true, value: { path: 'x', text: 'x'.repeat(MAX_BACKUP_CHARS + 1) } };
    expect(codeOf(await call<Result<unknown>>('data:import-all'))).toBe('file-too-large');
    expect(replaceAll).not.toHaveBeenCalled();
  });

  it('a file that is not a backup is refused, nothing changes and nothing is re-applied', async () => {
    ok(await lib.createDeck('Safe'));
    backupPick = { ok: true, value: { path: 'x', text: 'chat,cat\nchien,dog' } };
    expect(codeOf(await call<Result<unknown>>('data:import-all'))).toBe('not-a-backup');
    expect(names()).toEqual(['Safe']);
    expect(order).toEqual([]);
  });
});

describe('re-applying settings after a failed restore or reset', () => {
  it.each([
    ['partly-replaced', ['after']],
    ['write-failed', []],
    ['not-a-backup', []],
  ] as const)('a %s from the library re-applies the settings: %j', async (errorCode, expected) => {
    vi.spyOn(lib, 'resetAll').mockResolvedValueOnce({ ok: false, error: { code: errorCode, message: 'x' } });
    expect(codeOf(await call<Result<void>>('data:reset'))).toBe(errorCode);
    expect(order).toEqual(expected);
  });
});

describe('data:reset', () => {
  it('empties the library, puts onboarding back, and re-applies the settings', async () => {
    ok(await lib.createDeck('Gone'));
    ok(await lib.updateSettings({ onboarded: true }));
    ok(await call<Result<void>>('data:reset'));
    expect(names()).toEqual([]);
    expect(lib.getSettings().onboarded).toBe(false);
    expect(order).toEqual(['after']);
  });

  it('is refused while a session is running', async () => {
    await startSession();
    expect(codeOf(await call<Result<void>>('data:reset'))).toBe('session-running');
    expect(names()).toEqual(['Running']);
  });
});

describe('onboarding:practice', () => {
  it('switches the Leave it practice on and off', async () => {
    await call('onboarding:practice', { on: true });
    await call('onboarding:practice', { on: false });
    expect(practice).toEqual([true, false]);
  });

  it.each([[undefined], [{}], [{ on: 'yes' }]])('rejects %j', async (args) => {
    expect(codeOf(await call<Result<void>>('onboarding:practice', args))).toBe('invalid-request');
    expect(practice).toEqual([]);
  });
});

describe('onboarding:finish', () => {
  const finish = (over: Record<string, unknown> = {}) => call<Result<{ deckId: string | null }>>('onboarding:finish', { cap: 3, preset: 'calm', updateChecks: false, sampleDeck: true, ...over });

  it('saves the choices, marks onboarding done and adds the starter deck', async () => {
    const { deckId } = ok(await finish());
    expect(lib.getSettings()).toMatchObject({ cap: 3, preset: 'calm', updateChecks: false, onboarded: true });
    expect(names()).toEqual([SAMPLE_DECK.name]);
    expect(lib.getDeck(deckId!)!.cards).toHaveLength(parseDeck(SAMPLE_DECK.text).cards.length);
  });

  it('adds the starter deck once, however many times it runs, and hands back the same one', async () => {
    const first = ok(await finish());
    const second = ok(await finish());
    expect(names()).toEqual([SAMPLE_DECK.name]);
    expect(second.deckId).toBe(first.deckId);
  });

  it('reuses a deck the user already has under that name', async () => {
    const mine = ok(await lib.createDeck(SAMPLE_DECK.name.toUpperCase()));
    expect(ok(await finish()).deckId).toBe(mine.id);
    expect(lib.listDecks()).toHaveLength(1);
  });

  it('leaves the library alone when the starter deck is declined', async () => {
    expect(ok(await finish({ sampleDeck: false })).deckId).toBeNull();
    expect(names()).toEqual([]);
    expect(lib.getSettings().onboarded).toBe(true);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['an empty object', {}],
    ['a cap that is not 2, 3 or 4', { cap: 5, preset: 'calm', updateChecks: true, sampleDeck: true }],
    ['a preset that is not text', { cap: 3, preset: 1, updateChecks: true, sampleDeck: true }],
    ['an unknown preset', { cap: 3, preset: 'feral', updateChecks: true, sampleDeck: true }],
    ['updateChecks that is not a boolean', { cap: 3, preset: 'calm', updateChecks: 'y', sampleDeck: true }],
    ['sampleDeck that is not a boolean', { cap: 3, preset: 'calm', updateChecks: true, sampleDeck: 'y' }],
  ])('rejects %s and leaves onboarding undone and the library empty', async (_name, args) => {
    expect(codeOf(await call<Result<unknown>>('onboarding:finish', args))).toBe('invalid-request');
    expect(lib.getSettings().onboarded).toBe(false);
    expect(names()).toEqual([]);
  });
});

describe('afterReplace and a taken Leave it shortcut', () => {
  it('publishes the conflict and the saved shortcut as the label, and lets the old one go', async () => {
    const taken = new Set<string>();
    const held = new Set<string>();
    const leave = createLeaveIt({
      session,
      hotkeys: {
        register: (accel) => {
          if (taken.has(accel) || held.has(accel)) return false;
          held.add(accel);
          return true;
        },
        unregister: (accel) => void held.delete(accel),
      },
      notify: () => undefined,
      onConflictChange: () => undefined,
    });
    leave.register('Ctrl+Alt+K'); // what the user had bound before the reset
    taken.add('Ctrl+Alt+L'); // another app owns the saved (default) one
    const published: { leaveItConflict: boolean; leaveItLabel: string }[] = [];
    const statusNow = () => ({ trackerDown: false, batterySaver: false, leaveItConflict: leave.conflict, leaveItLabel: leave.accelerator ?? '' });
    const reset = createControlHandlers({
      library: lib,
      session,
      files,
      status: statusNow,
      platform: {
        loginItem: { get: () => ({ available: false, on: false }), set: () => undefined },
        openApps: () => [],
        dataDir: 'C:/data',
        openLink: () => undefined,
        applyReducedMotion: () => undefined,
        version: '1.2.3',
        openPath: () => Promise.resolve(''),
        afterReplace: () => {
          leave.restore(lib.getSettings().leaveItHotkey);
          const { leaveItConflict, leaveItLabel } = statusNow(); // built the way index.ts's appStatus() builds it
          published.push({ leaveItConflict, leaveItLabel });
        },
        setPractice: () => undefined,
        diagnostics: () => sampleDiagnosticsInput(),
        copyText: () => Promise.resolve(),
      },
      hotkeys: { leaveIt: { rebind: () => true }, bubble: { rebind: () => true } },
    });
    ok((await reset.handle('data:reset', undefined)) as Result<void>);
    expect(published).toEqual([{ leaveItConflict: true, leaveItLabel: 'Ctrl+Alt+L' }]);
    expect([...held]).toEqual([]); // the old shortcut is not left live unseen
  });
});

describe('diagnostics:get and diagnostics:copy', () => {
  it('copy before get is not-found and copies nothing', async () => {
    expect(codeOf(await call<Result<void>>('diagnostics:copy'))).toBe('not-found');
    expect(copied).toEqual([]);
  });

  it('get builds the bundle from the platform input and copy writes exactly that text', async () => {
    const text = await call<string>('diagnostics:get');
    expect(text).toContain('BarkStudy 9.9.9');
    expect(copied).toEqual([]); // looking is not copying
    ok(await call<Result<void>>('diagnostics:copy'));
    expect(copied).toEqual([text]);
  });

  it('reports a clipboard that could not be written', async () => {
    await call<string>('diagnostics:get');
    copyResult = Promise.reject(new Error('clipboard busy'));
    expect(codeOf(await call<Result<void>>('diagnostics:copy'))).toBe('write-failed');
  });

  it('ignores whatever arguments the renderer sends, and never takes text from it', async () => {
    const text = await call<string>('diagnostics:get', { text: 'smuggled', home: 'x' });
    expect(text).not.toContain('smuggled');
    ok(await call<Result<void>>('diagnostics:copy', { text: 'smuggled' }));
    expect(copied).toEqual([text]);
  });
});
