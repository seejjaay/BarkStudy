import type { UpdaterView } from '../shared/control';
import type { Log } from './logs';

/** The first check waits this long after launch, so starting up is never slowed. */
export const FIRST_CHECK_MS = 30_000;
/** After that, a check every six hours. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/**
 * After Restart to update is clicked, the app says it is installing and waits this long before closing, so the person sees
 * that something is happening. The install itself then takes about twenty seconds with no window of ours.
 */
export const INSTALL_DELAY_MS = 1500;
/** An install that has not closed the app this long after starting has failed, and the person gets Restart to update back. */
export const INSTALL_TIMEOUT_MS = 30_000;

export type ClientEvent =
  | { type: 'available'; version: string }
  | { type: 'none' }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string };

/** The part of electron-updater this file uses, so the rules can be tested without it. */
export interface UpdateClient {
  allowPrerelease: boolean;
  autoInstallOnAppQuit: boolean;
  /** Asks the release host whether there is a newer version. A download, if any, carries on in the background and is reported by an event. */
  check: () => Promise<void>;
  quitAndInstall: () => void;
  onEvent: (cb: (event: ClientEvent) => void) => void;
}

export interface UpdaterOptions {
  /** False outside the installed app (a development run, a test): the updater never starts and nothing is requested. */
  enabled: boolean;
  settings: () => { updateChecks: boolean; betaChannel: boolean };
  /** Built on the first check, inside the failure path, so a module that will not load leaves the app running. */
  createClient: () => Promise<UpdateClient>;
  sessionRunning: () => boolean;
  /** Called once per version, when it has finished downloading. */
  announce: (version: string) => void;
  /** Called when the restart is under way, while the app is still open: the notification outlives the gap that follows. */
  announceInstalling: (version: string) => void;
  onChange: () => void;
  log: Pick<Log, 'info' | 'warn' | 'error'>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type RestartResult = 'ok' | 'not-ready' | 'session-running';

export interface Updater {
  /** Starts the first-check timer (or settles on `unavailable` / `off`). */
  start: () => void;
  /** The update settings changed or were swapped by a restore: apply them. */
  settingsChanged: () => void;
  view: () => UpdaterView;
  /** Restarts into the downloaded version. Refused during a study session: it waits until the session ends. */
  restart: () => RestartResult;
  dispose: () => void;
}

export function createUpdater(opts: UpdaterOptions): Updater {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let state: UpdaterView['state'] = opts.enabled ? 'waiting' : 'unavailable';
  let version: string | null = null;
  let client: UpdateClient | null = null;
  let timer: unknown = null;
  let started = false;
  let disposed = false;
  let wasOn = opts.settings().updateChecks;
  let wasBeta = opts.settings().betaChannel;
  const announced = new Set<string>();
  // A beta the person opted out of after it was found. electron-updater still holds its installer, so install-on-quit stays
  // off until a version they do want has downloaded in its place.
  let droppedBeta = false;
  // So one failed check is one warning: electron-updater both emits 'error' and rejects the check.
  let failureLogged = false;

  // Read through a function: events change `state` while an await is pending, which flow analysis cannot see.
  const current = (): UpdaterView['state'] => state;

  function set(next: UpdaterView['state'], v: string | null = null): void {
    if (state === next && version === v) return;
    state = next;
    version = v;
    opts.onChange();
  }

  function cancelTimer(): void {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule(ms: number): void {
    cancelTimer();
    if (disposed || state === 'unavailable' || state === 'off' || state === 'ready' || state === 'installing') return;
    timer = setTimer(() => {
      timer = null;
      void check();
    }, ms);
  }

  async function getClient(): Promise<UpdateClient | null> {
    if (client) return client;
    try {
      const made = await opts.createClient();
      made.onEvent(onEvent);
      client = made;
      applyToClient();
      return client;
    } catch (err) {
      opts.log.error('updater', 'the updater could not start, so updates are unavailable', err);
      set('unavailable');
      return null;
    }
  }

  function applyToClient(): void {
    if (!client) return;
    const s = opts.settings();
    client.allowPrerelease = s.betaChannel;
    // With checks off, even an update that already finished downloading must not be installed behind the person's back;
    // nor a beta they turned down.
    client.autoInstallOnAppQuit = s.updateChecks && !droppedBeta;
  }

  /** A version the person does not want right now: a beta (semver prerelease, "1.2.0-beta.1") with the beta channel off. */
  const unwanted = (v: string): boolean => v.includes('-') && !opts.settings().betaChannel;

  function onEvent(event: ClientEvent): void {
    if (state === 'installing') {
      // electron-updater reports a failed install as an error event, never by throwing from quitAndInstall.
      if (event.type === 'error') installFailed(event.message);
      return;
    }
    if (state === 'off' || state === 'unavailable') return;
    switch (event.type) {
      case 'available':
        if (unwanted(event.version)) return;
        opts.log.info('updater', `update ${event.version} found, downloading`);
        set('downloading', event.version);
        return;
      case 'none':
        set('idle');
        return;
      case 'downloaded':
        // A beta that finishes downloading after the beta channel was turned off stays dropped.
        if (unwanted(event.version)) return;
        opts.log.info('updater', `update ${event.version} downloaded`);
        droppedBeta = false;
        applyToClient();
        set('ready', event.version);
        if (!announced.has(event.version)) {
          announced.add(event.version);
          opts.announce(event.version);
        }
        return;
      case 'error':
        // Quiet (no notification): the next cycle tries again.
        failed(event.message);
        return;
    }
  }

  function failed(message: string): void {
    if (!failureLogged) opts.log.warn('updater', `update check failed: ${message}`);
    failureLogged = true;
    set('failed');
  }

  /** The install did not start or did not close the app: back to ready, so the person can try again. */
  function installFailed(why: string): void {
    if (state !== 'installing') return;
    cancelTimer();
    opts.log.error('updater', `could not install the update: ${why}`);
    leaveInstalling();
  }

  /** Out of `installing` without a restart. The settings held back during the install apply now: checks off means off. */
  function leaveInstalling(): void {
    applyToClient();
    if (opts.settings().updateChecks) set('ready', version);
    else set('off');
  }

  async function check(): Promise<void> {
    if (disposed || !opts.settings().updateChecks) return;
    // One at a time, and nothing to look for once a newer version is already waiting.
    if (state === 'checking' || state === 'downloading' || state === 'ready' || state === 'installing' || state === 'unavailable') {
      schedule(CHECK_EVERY_MS);
      return;
    }
    failureLogged = false;
    set('checking');
    const c = await getClient();
    if (!c) return;
    let threw = false;
    try {
      await c.check();
    } catch (err) {
      threw = true;
      if (current() === 'checking' || current() === 'failed') failed(err instanceof Error ? err.message : String(err));
    }
    // A check that reported nothing back (an event normally does) is over; downloading and ready carry on.
    if (current() === 'checking') set(threw ? 'failed' : 'idle');
    schedule(CHECK_EVERY_MS);
  }

  return {
    start() {
      if (started || state === 'unavailable') return;
      started = true;
      if (!opts.settings().updateChecks) {
        set('off');
        return;
      }
      schedule(FIRST_CHECK_MS);
    },

    settingsChanged() {
      const s = opts.settings();
      const on = wasOn;
      const beta = wasBeta;
      wasOn = s.updateChecks;
      wasBeta = s.betaChannel;
      // Once the restart is under way it carries on whatever the settings say; they are applied at the next start.
      if (state === 'unavailable' || state === 'installing' || !started) return;
      applyToClient();
      if (!s.updateChecks) {
        cancelTimer();
        set('off');
        return;
      }
      // Beta turned off while a beta is downloading or waiting: drop it, keep it from installing on quit, look again.
      if (beta && !s.betaChannel && (state === 'downloading' || state === 'ready') && version !== null && version.includes('-')) {
        opts.log.info('updater', `beta ${version} dropped: the beta channel was turned off`);
        droppedBeta = true;
        applyToClient();
        set('waiting');
      }
      if (!on || beta !== s.betaChannel) {
        if (state === 'off') set('waiting');
        cancelTimer();
        void check();
      }
    },

    view: () => ({ state, version }),

    restart() {
      if (state === 'installing') return 'ok'; // a second click while it is under way
      if (state !== 'ready' || !client || version === null) return 'not-ready';
      if (opts.sessionRunning()) return 'session-running';
      const c = client;
      // The pending check timer goes: if it fired during the delay its reschedule would cancel the install.
      cancelTimer();
      set('installing', version);
      opts.announceInstalling(version);
      timer = setTimer(() => {
        timer = null;
        // A session started during the delay is not cut off: the update waits for it, as it would have at the click.
        if (opts.sessionRunning()) {
          opts.log.info('updater', 'a session started before the restart, so the update waits for it');
          leaveInstalling();
          return;
        }
        try {
          c.quitAndInstall();
        } catch (err) {
          installFailed(err instanceof Error ? err.message : String(err));
          return;
        }
        // If the app is still here long after, the install never took over (it reports most failures as an error event).
        timer = setTimer(() => {
          timer = null;
          installFailed('the app did not close for the install');
        }, INSTALL_TIMEOUT_MS);
      }, INSTALL_DELAY_MS);
      return 'ok';
    },

    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
