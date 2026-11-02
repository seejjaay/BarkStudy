import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createControlHandlers, type ControlHandlers, type FileAccess } from '../../src/main/controlHandlers';
import { createLibrary, type Library } from '../../src/main/library';
import { LINKS } from '../../src/main/links';
import { createSessionController, type SessionController } from '../../src/main/session';
import { createStorage } from '../../src/main/storage/io';
import type { RestartResult } from '../../src/main/updater';
import type { Result, SettingsView } from '../../src/shared/control';
import type { Settings } from '../../src/shared/settings';
import { sampleDiagnosticsInput } from './diagnosticsFixture';

let dir: string;
let lib: Library;
let session: SessionController;
let h: ControlHandlers;
let loginItem: { available: boolean; on: boolean };
let loginCalls: boolean[];
let motion: string[];
let opened: string[];
let leaveItRebinds: string[];
let bubbleRebinds: string[];
let leaveItTaken: boolean;
let bubbleTaken: boolean;
let updateChanged: number;
let restartResult: RestartResult;

const files: FileAccess = {
  pickImport: () => Promise.resolve({ ok: true, value: null }),
  saveExport: () => Promise.resolve(null),
  pickBackup: () => Promise.resolve({ ok: true, value: null }),
  saveBackup: () => Promise.resolve(null),
};
const call = <T = unknown>(op: string, args?: unknown) => h.handle(op, args) as Promise<T>;
const ok = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r.value;
};
const codeOf = (r: Result<unknown>): string | undefined => (r.ok ? undefined : r.error.code);

beforeEach(async () => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-settingsops-'));
  loginItem = { available: true, on: false };
  loginCalls = [];
  motion = [];
  opened = [];
  leaveItRebinds = [];
  bubbleRebinds = [];
  leaveItTaken = false;
  bubbleTaken = false;
  updateChanged = 0;
  restartResult = 'not-ready';
  lib = await createLibrary({ storage: createStorage(dir) });
  session = createSessionController({ library: lib, seed: 1, publish: () => undefined });
  h = createControlHandlers({
    library: lib,
    session,
    files,
    status: () => ({ trackerDown: false, batterySaver: false, leaveItConflict: false, leaveItLabel: 'Ctrl+Alt+L', update: { state: 'idle', version: null } }),
    platform: {
      loginItem: {
        get: () => ({ ...loginItem }),
        set: (on) => {
          loginCalls.push(on);
          loginItem.on = on;
        },
      },
      updates: { view: () => ({ state: 'idle', version: null }), changed: () => void updateChanged++, restart: () => restartResult },
      openApps: () => ['chrome.exe', 'code.exe'],
      dataDir: 'C:/data',
      openLink: (url) => void opened.push(url),
      applyReducedMotion: (mode) => void motion.push(mode),
      version: '1.2.3',
      openPath: () => Promise.resolve(''),
      afterReplace: () => undefined,
      setPractice: () => undefined,
      diagnostics: () => sampleDiagnosticsInput(),
      copyText: () => Promise.resolve(),
    },
    hotkeys: {
      leaveIt: {
        rebind: (a) => {
          leaveItRebinds.push(a);
          return !leaveItTaken;
        },
      },
      bubble: {
        rebind: (a) => {
          bubbleRebinds.push(a);
          return !bubbleTaken;
        },
      },
    },
  });
});
afterEach(() => {
  session.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('settings:get', () => {
  it('hands back the settings, the login item, the open apps and the data folder', async () => {
    const view = await call<SettingsView>('settings:get');
    expect(view.settings.cap).toBe(4);
    expect(view.loginItem).toEqual({ available: true, on: false });
    expect(view.openApps).toEqual(['chrome.exe', 'code.exe']);
    expect(view.dataDir).toBe('C:/data');
  });
});

describe('malformed arguments to the settings, login and link operations', () => {
  it.each<[string, unknown]>([
    ['settings:update', undefined],
    ['settings:update', {}],
    ['settings:update', 'cap'],
    ['settings:update', { cap: 5 }],
    ['settings:update', { volume: 'loud' }],
    ['settings:update', { excludedApps: 'zoom.exe' }],
    ['settings:update', { excludedApps: [1] }],
    ['settings:update', { reducedMotion: 'sometimes' }],
    ['settings:update', { onboarded: true }],
    ['settings:update', { leaveItHotkey: 'Ctrl+Alt+K' }],
    ['settings:update', { bubbleHotkey: 'Ctrl+Alt+K' }],
    ['settings:update', { nope: 1 }],
    ['settings:hotkey', undefined],
    ['settings:hotkey', {}],
    ['settings:hotkey', { which: 'esc', accelerator: 'Ctrl+Alt+K' }],
    ['settings:hotkey', { which: 'leaveIt', accelerator: 5 }],
    ['settings:login-item', undefined],
    ['settings:login-item', {}],
    ['settings:login-item', { on: 'yes' }],
    ['link:open', undefined],
    ['link:open', {}],
    ['link:open', { id: 'evil' }],
    ['link:open', { id: '__proto__' }],
    ['link:open', { id: 'constructor' }],
  ])('%s rejects %j', async (op, args) => {
    const before = lib.getSettings();
    expect(codeOf(await call<Result<unknown>>(op, args))).toBe('invalid-request');
    expect(lib.getSettings()).toEqual(before);
    expect(opened).toEqual([]);
    expect(loginCalls).toEqual([]);
    expect(leaveItRebinds).toEqual([]);
    expect(bubbleRebinds).toEqual([]);
  });
});

describe('settings:update', () => {
  it('saves the named settings only', async () => {
    const saved = ok(await call<Result<Settings>>('settings:update', { cap: 3, preset: 'calm' }));
    expect(saved).toMatchObject({ cap: 3, preset: 'calm', soundOn: true });
    expect(lib.getSettings()).toMatchObject({ cap: 3, preset: 'calm' });
  });

  it('puts excluded apps in their normal form', async () => {
    const saved = ok(await call<Result<Settings>>('settings:update', { excludedApps: ['A.EXE', ' a.exe ', 'C:/Games/B.exe'] }));
    expect(saved.excludedApps).toEqual(['a.exe', 'b.exe']);
  });

  it('tells the dog about reduced motion, but only when that setting was part of the change', async () => {
    ok(await call<Result<Settings>>('settings:update', { cap: 2 }));
    expect(motion).toEqual([]);
    ok(await call<Result<Settings>>('settings:update', { reducedMotion: 'on' }));
    expect(motion).toEqual(['on']);
  });

  it('refuses check-in minutes that make no sense, saves nothing and tells nobody', async () => {
    const r = await call<Result<Settings>>('settings:update', { checkinMinMinutes: 30, checkinMaxMinutes: 10, reducedMotion: 'on' });
    expect(codeOf(r)).toBe('invalid-request');
    expect(lib.getSettings().checkinMinMinutes).toBe(5);
    expect(motion).toEqual([]);
  });

  it('says which setting was the problem', async () => {
    const r = await call<Result<Settings>>('settings:update', { checkinMinMinutes: 30, checkinMaxMinutes: 10 });
    expect(!r.ok && r.error.reason).toBe('bad-interval');
  });

  it('refuses an excluded-apps list too long to be worth checking', async () => {
    const r = await call<Result<Settings>>('settings:update', { excludedApps: Array(1001).fill('a.exe') });
    expect(codeOf(r)).toBe('invalid-request');
    expect(!r.ok && r.error.reason).toBeUndefined();
  });
});

describe('settings:hotkey', () => {
  it('rebinds Leave it first, then saves it', async () => {
    const saved = ok(await call<Result<Settings>>('settings:hotkey', { which: 'leaveIt', accelerator: 'Control+Alt+K' }));
    expect(saved.leaveItHotkey).toBe('Control+Alt+K');
    expect(leaveItRebinds).toEqual(['Control+Alt+K']);
  });

  it('keeps the old shortcut when another app owns the new one', async () => {
    leaveItTaken = true;
    const r = await call<Result<Settings>>('settings:hotkey', { which: 'leaveIt', accelerator: 'Control+Alt+K' });
    expect(codeOf(r)).toBe('hotkey-taken');
    expect(lib.getSettings().leaveItHotkey).toBe('Ctrl+Alt+L');
  });

  it('refuses text that is not a shortcut without trying to bind it', async () => {
    for (const accelerator of ['L', 'Control+Escape', '']) {
      expect(codeOf(await call<Result<Settings>>('settings:hotkey', { which: 'leaveIt', accelerator })), accelerator).toBe('hotkey-invalid');
    }
    expect(leaveItRebinds).toEqual([]);
  });

  it('refuses a shortcut the other action already has, however it is spelled', async () => {
    expect(codeOf(await call<Result<Settings>>('settings:hotkey', { which: 'leaveIt', accelerator: 'Ctrl+Alt+A' }))).toBe('hotkey-invalid');
    expect(codeOf(await call<Result<Settings>>('settings:hotkey', { which: 'bubble', accelerator: 'control+alt+l' }))).toBe('hotkey-invalid');
    expect(leaveItRebinds).toEqual([]);
    expect(bubbleRebinds).toEqual([]);
  });

  it('puts the old Leave it shortcut back when saving the new one fails', async () => {
    vi.spyOn(lib, 'updateSettings').mockResolvedValueOnce({ ok: false, error: { code: 'write-failed', message: 'disk' } });
    const r = await call<Result<Settings>>('settings:hotkey', { which: 'leaveIt', accelerator: 'Control+Alt+K' });
    expect(codeOf(r)).toBe('write-failed');
    expect(leaveItRebinds).toEqual(['Control+Alt+K', 'Ctrl+Alt+L']);
  });

  it('rebinds the focus shortcut the same way', async () => {
    expect(ok(await call<Result<Settings>>('settings:hotkey', { which: 'bubble', accelerator: 'Control+Alt+J' })).bubbleHotkey).toBe('Control+Alt+J');
    bubbleTaken = true;
    expect(codeOf(await call<Result<Settings>>('settings:hotkey', { which: 'bubble', accelerator: 'Control+Alt+H' }))).toBe('hotkey-taken');
    expect(lib.getSettings().bubbleHotkey).toBe('Control+Alt+J');
  });
});

describe('settings:login-item and link:open', () => {
  it('login item does nothing where start-with-Windows is not offered', async () => {
    loginItem = { available: false, on: false };
    expect(ok(await call<Result<{ available: boolean; on: boolean }>>('settings:login-item', { on: true }))).toEqual({ available: false, on: false });
    expect(loginCalls).toEqual([]);
  });

  it('login item turns on and reports the result', async () => {
    expect(ok(await call<Result<{ available: boolean; on: boolean }>>('settings:login-item', { on: true }))).toEqual({ available: true, on: true });
    expect(loginCalls).toEqual([true]);
  });

  it('opens only the fixed address for a known id', async () => {
    ok(await call<Result<void>>('link:open', { id: 'repo' }));
    expect(opened).toEqual([LINKS.repo]);
  });

  describe('updates', () => {
    it('tells the updater when the update checks or the beta channel change, and for nothing else', async () => {
      ok(await call<Result<Settings>>('settings:update', { updateChecks: false }));
      expect(updateChanged).toBe(1);
      ok(await call<Result<Settings>>('settings:update', { betaChannel: true }));
      expect(updateChanged).toBe(2);
      ok(await call<Result<Settings>>('settings:update', { soundOn: false }));
      expect(updateChanged).toBe(2);
    });

    it('a refused settings change does not reach the updater', async () => {
      await call('settings:update', { updateChecks: 'yes' });
      expect(updateChanged).toBe(0);
    });

    it('the settings view carries the updater state', async () => {
      expect((await call<SettingsView>('settings:get')).update).toEqual({ state: 'idle', version: null });
    });

    it('restart goes through, waits for a session, or says there is nothing to restart into', async () => {
      restartResult = 'ok';
      expect(ok(await call<Result<void>>('update:restart'))).toBeUndefined();
      restartResult = 'session-running';
      expect(codeOf(await call<Result<void>>('update:restart'))).toBe('session-running');
      restartResult = 'not-ready';
      expect(codeOf(await call<Result<void>>('update:restart'))).toBe('not-found');
    });
  });
});
