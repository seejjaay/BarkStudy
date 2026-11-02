import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHECK_EVERY_MS, FIRST_CHECK_MS, INSTALL_DELAY_MS, INSTALL_TIMEOUT_MS, createUpdater, type ClientEvent, type UpdateClient, type UpdaterOptions } from '../../src/main/updater';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      expect(Number.isFinite(ms) && ms >= 1 && ms < 2 ** 31 - 1).toBe(true);
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    pending: () => timers.size,
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await settle();
      }
      now = end;
    },
  };
}

interface FakeClient extends UpdateClient {
  checks: number;
  installs: number;
  /** What a check does when it runs: report these events, or fail. */
  onCheck: ClientEvent[];
  failWith: Error | null;
  /** quitAndInstall throws this. */
  installError: Error | null;
}

function setup(over: Partial<UpdaterOptions> = {}, initial = { updateChecks: true, betaChannel: false }) {
  const clock = fakeClock();
  const settings = { ...initial };
  let listener: (e: ClientEvent) => void = () => undefined;
  const client: FakeClient = {
    allowPrerelease: false,
    autoInstallOnAppQuit: true,
    checks: 0,
    installs: 0,
    onCheck: [],
    failWith: null,
    installError: null,
    check: () => {
      client.checks++;
      if (client.failWith) return Promise.reject(client.failWith);
      for (const e of client.onCheck) listener(e);
      return Promise.resolve();
    },
    quitAndInstall: () => {
      client.installs++;
      if (client.installError) throw client.installError;
    },
    onEvent: (cb: (e: ClientEvent) => void) => {
      listener = cb;
    },
  };
  const calls = { created: 0, installing: [] as string[], announced: [] as string[], changes: 0, errors: 0, warns: [] as string[] };
  let session = false;
  const updater = createUpdater({
    enabled: true,
    settings: () => settings,
    createClient: () => {
      calls.created++;
      return Promise.resolve(client);
    },
    sessionRunning: () => session,
    announce: (v) => calls.announced.push(v),
    announceInstalling: (v) => calls.installing.push(v),
    onChange: () => calls.changes++,
    log: { info: () => undefined, warn: (_a, m) => calls.warns.push(m), error: () => calls.errors++ },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...over,
  });
  return {
    updater,
    clock,
    settings,
    client,
    calls,
    emit: (e: ClientEvent) => listener(e),
    setSession: (on: boolean) => {
      session = on;
    },
  };
}

describe('when it checks', () => {
  it('waits 30 s after launch, then checks every 6 h', async () => {
    const t = setup();
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS - 1);
    expect(t.client.checks).toBe(0);
    await t.clock.advance(1);
    expect(t.client.checks).toBe(1);
    await t.clock.advance(CHECK_EVERY_MS - 1);
    expect(t.client.checks).toBe(1);
    await t.clock.advance(1);
    expect(t.client.checks).toBe(2);
  });

  it('with checks off at launch it asks for nothing and builds no client', async () => {
    const t = setup({}, { updateChecks: false, betaChannel: false });
    t.updater.start();
    await t.clock.advance(CHECK_EVERY_MS * 3);
    expect(t.client.checks).toBe(0);
    expect(t.calls.created).toBe(0);
    expect(t.updater.view().state).toBe('off');
  });

  it('outside the installed app it is unavailable and never builds a client', async () => {
    const t = setup({ enabled: false });
    t.updater.start();
    t.updater.settingsChanged();
    await t.clock.advance(CHECK_EVERY_MS * 2);
    expect(t.calls.created).toBe(0);
    expect(t.updater.view()).toEqual({ state: 'unavailable', version: null });
  });

  it('a client that will not build leaves the app running and the updater unavailable', async () => {
    const t = setup({ createClient: () => Promise.reject(new Error('cannot load')) });
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    expect(t.updater.view().state).toBe('unavailable');
    expect(t.calls.errors).toBe(1);
    await t.clock.advance(CHECK_EVERY_MS * 2);
    expect(t.calls.errors).toBe(1);
  });

  it('before the first check it is waiting, not up to date', () => {
    const t = setup();
    t.updater.start();
    expect(t.updater.view().state).toBe('waiting');
  });

  it('one failed check is one warning, even though electron-updater both reports an error and rejects', async () => {
    const t = setup();
    t.client.onCheck = [{ type: 'error', message: 'offline' }];
    t.client.failWith = new Error('offline');
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    expect(t.updater.view().state).toBe('failed');
    expect(t.calls.warns).toHaveLength(1);
    await t.clock.advance(CHECK_EVERY_MS);
    expect(t.calls.warns).toHaveLength(2);
  });

  it('a failed check is quiet, says it failed (not up to date), and is tried again next cycle', async () => {
    const t = setup();
    t.client.failWith = new Error('offline');
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    expect(t.updater.view().state).toBe('failed');
    expect(t.calls.announced).toEqual([]);
    expect(t.calls.warns.some((w) => w.includes('offline'))).toBe(true);
    t.client.failWith = null;
    await t.clock.advance(CHECK_EVERY_MS);
    expect(t.client.checks).toBe(2);
  });
});

describe('finding and downloading', () => {
  it('reports downloading, then ready, and announces each version once', async () => {
    const t = setup();
    t.client.onCheck = [{ type: 'available', version: '0.2.0' }];
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    expect(t.updater.view()).toEqual({ state: 'downloading', version: '0.2.0' });
    t.emit({ type: 'downloaded', version: '0.2.0' });
    t.emit({ type: 'downloaded', version: '0.2.0' });
    expect(t.updater.view()).toEqual({ state: 'ready', version: '0.2.0' });
    expect(t.calls.announced).toEqual(['0.2.0']);
  });

  it('does not check again while a newer version is already waiting', async () => {
    const t = setup();
    t.client.onCheck = [{ type: 'available', version: '0.2.0' }];
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    t.emit({ type: 'downloaded', version: '0.2.0' });
    await t.clock.advance(CHECK_EVERY_MS * 2);
    expect(t.client.checks).toBe(1);
  });

  it('nothing newer goes back to idle', async () => {
    const t = setup();
    t.client.onCheck = [{ type: 'none' }];
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    expect(t.updater.view()).toEqual({ state: 'idle', version: null });
  });
});

describe('restarting into the update', () => {
  async function ready() {
    const t = setup();
    t.client.onCheck = [{ type: 'available', version: '0.2.0' }];
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    t.emit({ type: 'downloaded', version: '0.2.0' });
    return t;
  }

  it('is refused while a study session runs, and goes through once it ends', async () => {
    const t = await ready();
    t.setSession(true);
    expect(t.updater.restart()).toBe('session-running');
    expect(t.updater.view().state).toBe('ready');
    expect(t.calls.installing).toEqual([]);
    t.setSession(false);
    expect(t.updater.restart()).toBe('ok');
    await t.clock.advance(INSTALL_DELAY_MS);
    expect(t.client.installs).toBe(1);
  });

  it('says it is installing at once, and closes only after a short delay so that can be seen', async () => {
    const t = await ready();
    expect(t.updater.restart()).toBe('ok');
    expect(t.updater.view()).toEqual({ state: 'installing', version: '0.2.0' });
    expect(t.calls.installing).toEqual(['0.2.0']);
    expect(t.client.installs).toBe(0);
    await t.clock.advance(INSTALL_DELAY_MS - 1);
    expect(t.client.installs).toBe(0);
    await t.clock.advance(1);
    expect(t.client.installs).toBe(1);
  });

  it('a second click while it is installing changes nothing and starts nothing more', async () => {
    const t = await ready();
    t.updater.restart();
    expect(t.updater.restart()).toBe('ok');
    await t.clock.advance(INSTALL_DELAY_MS * 3);
    expect(t.client.installs).toBe(1);
    expect(t.calls.installing).toEqual(['0.2.0']);
  });

  it('while installing, no new check runs, no check event moves it, and the settings do not stop it', async () => {
    const t = await ready();
    t.updater.restart();
    const checks = t.client.checks;
    t.emit({ type: 'none' });
    t.emit({ type: 'available', version: '0.3.0' });
    t.settings.updateChecks = false;
    t.updater.settingsChanged();
    // Up to the install timeout; in real use the app has quit long before then.
    await t.clock.advance(INSTALL_DELAY_MS + INSTALL_TIMEOUT_MS - 1);
    expect(t.client.checks).toBe(checks);
    expect(t.updater.view().state).toBe('installing');
    expect(t.client.installs).toBe(1);
  });

  it('an install that fails the way electron-updater reports it (an error event) goes back to ready', async () => {
    const t = await ready();
    t.updater.restart();
    await t.clock.advance(INSTALL_DELAY_MS);
    t.emit({ type: 'error', message: 'installer missing' });
    expect(t.updater.view()).toEqual({ state: 'ready', version: '0.2.0' });
    expect(t.calls.errors).toBe(1);
    expect(t.updater.restart()).toBe('ok');
    expect(t.updater.view().state).toBe('installing');
  });

  it('an app still running long after the install started gets Restart to update back', async () => {
    const t = await ready();
    t.updater.restart();
    await t.clock.advance(INSTALL_DELAY_MS + INSTALL_TIMEOUT_MS - 1);
    expect(t.updater.view().state).toBe('installing');
    await t.clock.advance(1);
    expect(t.updater.view()).toEqual({ state: 'ready', version: '0.2.0' });
  });

  it('a failed install with checks turned off meanwhile ends off, and will not install on quit', async () => {
    const t = await ready();
    t.updater.restart();
    t.settings.updateChecks = false;
    t.updater.settingsChanged();
    await t.clock.advance(INSTALL_DELAY_MS);
    t.emit({ type: 'error', message: 'x' });
    expect(t.updater.view().state).toBe('off');
    expect(t.client.autoInstallOnAppQuit).toBe(false);
  });

  it('the pending check timer is cancelled at the click, so it cannot cancel the install', async () => {
    const t = setup();
    t.client.onCheck = [{ type: 'available', version: '0.2.0' }];
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS); // the check ends while downloading and arms the next check
    t.emit({ type: 'downloaded', version: '0.2.0' });
    expect(t.clock.pending()).toBe(1);
    t.updater.restart();
    expect(t.clock.pending()).toBe(1); // only the install timer
    await t.clock.advance(INSTALL_DELAY_MS);
    expect(t.client.installs).toBe(1);
  });

  it('a session started during the short delay is not cut off: back to ready, nothing installed', async () => {
    const t = await ready();
    t.updater.restart();
    t.setSession(true);
    await t.clock.advance(INSTALL_DELAY_MS);
    expect(t.client.installs).toBe(0);
    expect(t.updater.view()).toEqual({ state: 'ready', version: '0.2.0' });
    expect(t.updater.restart()).toBe('session-running');
  });

  it('an install that cannot start goes back to ready, so it can be tried again', async () => {
    const t = await ready();
    t.client.installError = new Error('no installer');
    t.updater.restart();
    await t.clock.advance(INSTALL_DELAY_MS);
    expect(t.updater.view()).toEqual({ state: 'ready', version: '0.2.0' });
    expect(t.calls.errors).toBe(1);
    t.client.installError = null;
    expect(t.updater.restart()).toBe('ok');
    await t.clock.advance(INSTALL_DELAY_MS);
    expect(t.client.installs).toBe(2);
  });

  it('is refused when nothing is ready', () => {
    const t = setup();
    t.updater.start();
    expect(t.updater.restart()).toBe('not-ready');
  });

  it('turning checks off from ready drops the update and stops install-on-quit', async () => {
    const t = await ready();
    t.settings.updateChecks = false;
    t.updater.settingsChanged();
    expect(t.updater.view()).toEqual({ state: 'off', version: null });
    expect(t.client.autoInstallOnAppQuit).toBe(false);
    expect(t.updater.restart()).toBe('not-ready');
  });

  it('turning checks back on checks at once and allows install-on-quit again', async () => {
    const t = await ready();
    t.settings.updateChecks = false;
    t.updater.settingsChanged();
    const before = t.client.checks;
    t.settings.updateChecks = true;
    t.updater.settingsChanged();
    await settle();
    expect(t.client.checks).toBe(before + 1);
    expect(t.client.autoInstallOnAppQuit).toBe(true);
  });
});

describe('turning the beta channel off', () => {
  async function betaReady() {
    const t = setup({}, { updateChecks: true, betaChannel: true });
    t.client.onCheck = [{ type: 'available', version: '0.2.0-beta.1' }];
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    t.emit({ type: 'downloaded', version: '0.2.0-beta.1' });
    t.client.onCheck = [{ type: 'none' }];
    return t;
  }

  it('drops a beta that is waiting: no Restart to update, no install on quit, and it looks again', async () => {
    const t = await betaReady();
    expect(t.updater.view().state).toBe('ready');
    const checks = t.client.checks;
    t.settings.betaChannel = false;
    t.updater.settingsChanged();
    await settle();
    expect(t.updater.view()).toEqual({ state: 'idle', version: null });
    expect(t.client.autoInstallOnAppQuit).toBe(false);
    expect(t.client.allowPrerelease).toBe(false);
    expect(t.client.checks).toBe(checks + 1);
    expect(t.updater.restart()).toBe('not-ready');
  });

  it('a beta that finishes downloading after that is ignored; a stable one replaces it and may install again', async () => {
    const t = await betaReady();
    t.settings.betaChannel = false;
    t.updater.settingsChanged();
    await settle();
    t.emit({ type: 'downloaded', version: '0.2.0-beta.1' });
    expect(t.updater.view().state).toBe('idle');
    t.emit({ type: 'downloaded', version: '0.2.0' });
    expect(t.updater.view()).toEqual({ state: 'ready', version: '0.2.0' });
    expect(t.client.autoInstallOnAppQuit).toBe(true);
  });

  it('a stable version waiting is kept when beta goes off', async () => {
    const t = setup({}, { updateChecks: true, betaChannel: true });
    t.client.onCheck = [{ type: 'available', version: '0.2.0' }];
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    t.emit({ type: 'downloaded', version: '0.2.0' });
    t.settings.betaChannel = false;
    t.updater.settingsChanged();
    await settle();
    expect(t.updater.view()).toEqual({ state: 'ready', version: '0.2.0' });
    expect(t.client.autoInstallOnAppQuit).toBe(true);
  });
});

describe('the settings', () => {
  it('the beta flag reaches the client and rechecks at once', async () => {
    const t = setup();
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    expect(t.client.allowPrerelease).toBe(false);
    t.settings.betaChannel = true;
    t.updater.settingsChanged();
    await settle();
    expect(t.client.allowPrerelease).toBe(true);
    expect(t.client.checks).toBe(2);
  });

  it('a change to something else rechecks nothing', async () => {
    const t = setup();
    t.updater.start();
    await t.clock.advance(FIRST_CHECK_MS);
    t.updater.settingsChanged();
    await settle();
    expect(t.client.checks).toBe(1);
  });

  it('turning checks off clears the timer, so nothing is asked for later', async () => {
    const t = setup();
    t.updater.start();
    expect(t.clock.pending()).toBe(1);
    t.settings.updateChecks = false;
    t.updater.settingsChanged();
    expect(t.clock.pending()).toBe(0);
    await t.clock.advance(CHECK_EVERY_MS * 2);
    expect(t.client.checks).toBe(0);
  });
});

describe('property: the updater never asks for anything while checks are off', () => {
  type Op = { kind: 'advance'; ms: number } | { kind: 'checks'; on: boolean } | { kind: 'beta'; on: boolean } | { kind: 'event'; ev: ClientEvent } | { kind: 'restart' } | { kind: 'session'; on: boolean };
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant('advance' as const), ms: fc.integer({ min: 1, max: CHECK_EVERY_MS * 2 }) }),
    fc.record({ kind: fc.constant('checks' as const), on: fc.boolean() }),
    fc.record({ kind: fc.constant('beta' as const), on: fc.boolean() }),
    fc.record({
      kind: fc.constant('event' as const),
      ev: fc.oneof(
        fc.constant<ClientEvent>({ type: 'none' }),
        fc.constant<ClientEvent>({ type: 'available', version: '0.2.0' }),
        fc.constant<ClientEvent>({ type: 'downloaded', version: '0.2.0' }),
        fc.constant<ClientEvent>({ type: 'error', message: 'x' }),
      ),
    }),
    fc.constant<Op>({ kind: 'restart' }),
    fc.record({ kind: fc.constant('session' as const), on: fc.boolean() }),
  );

  async function run(ops: Op[], reached?: Set<string>): Promise<void> {
    const t = setup();
    t.updater.start();
    for (const op of ops) {
      const checksBefore = t.client.checks;
      const installsBefore = t.client.installs;
      const wasOff = !t.settings.updateChecks;
      const wasInstalling = t.updater.view().state === 'installing';
      switch (op.kind) {
        case 'advance':
          await t.clock.advance(op.ms);
          break;
        case 'checks':
          t.settings.updateChecks = op.on;
          t.updater.settingsChanged();
          await settle();
          break;
        case 'beta':
          t.settings.betaChannel = op.on;
          t.updater.settingsChanged();
          await settle();
          break;
        case 'event':
          t.emit(op.ev);
          break;
        case 'restart':
          t.updater.restart();
          break;
        case 'session':
          t.setSession(op.on);
          break;
      }
      if (wasOff && !t.settings.updateChecks) {
        // Still off after this step: no request. Nor an install, unless the restart was already under way.
        expect(t.client.checks).toBe(checksBefore);
        if (!wasInstalling) expect(t.client.installs).toBe(installsBefore);
      }
      // A restart under way carries on whatever the settings say; its one timer is the delayed install.
      if (!t.settings.updateChecks && t.updater.view().state !== 'installing') {
        expect(t.updater.view().state).toBe('off');
        expect(t.clock.pending()).toBe(0);
      }
      if (t.updater.view().state === 'ready') expect(t.updater.view().version).not.toBeNull();
      reached?.add(`${t.updater.view().state}${t.settings.updateChecks ? '' : '/off-setting'}`);
    }
  }

  it('holds over random sequences', async () => {
    await fc.assert(fc.asyncProperty(fc.array(opArb, { maxLength: 30 }), (ops) => run(ops)), { numRuns: 200 });
  });

  it('the generator reaches off, checking, downloading and ready', async () => {
    const reached = new Set<string>();
    await fc.assert(fc.asyncProperty(fc.array(opArb, { minLength: 5, maxLength: 30 }), (ops) => run(ops, reached)), { numRuns: 200 });
    for (const state of ['off', 'idle', 'downloading', 'ready', 'installing']) expect(reached.has(state) || reached.has(`${state}/off-setting`)).toBe(true);
  });
});
