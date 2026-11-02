import { autoUpdater } from 'electron-updater';
import type { Log } from './logs';
import type { ClientEvent, UpdateClient } from './updater';

/**
 * The electron-updater side of the updater: checks the GitHub Releases named in resources/app-update.yml, downloads in the
 * background, and installs on the next quit. This is the one place the app makes a request of its own (Global Constraints):
 * nothing but the release metadata is asked for, and nothing about the person is sent. Loaded only when the updater first
 * checks (see `createClient` in updater.ts), so a failure to load it cannot stop the app starting.
 */
export function createElectronUpdaterClient(log: Pick<Log, 'info' | 'warn' | 'error'>): UpdateClient {
  autoUpdater.autoDownload = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m?: unknown) => log.info('updater', String(m)),
    warn: (m?: unknown) => log.warn('updater', String(m)),
    error: (m?: unknown) => log.warn('updater', String(m)),
    debug: () => undefined,
  };

  return {
    get allowPrerelease() {
      return autoUpdater.allowPrerelease;
    },
    set allowPrerelease(on: boolean) {
      autoUpdater.allowPrerelease = on;
    },
    get autoInstallOnAppQuit() {
      return autoUpdater.autoInstallOnAppQuit;
    },
    set autoInstallOnAppQuit(on: boolean) {
      autoUpdater.autoInstallOnAppQuit = on;
    },
    check: async () => {
      await autoUpdater.checkForUpdates();
    },
    // Not silent: the installer shows its progress, then the app starts again.
    quitAndInstall: () => autoUpdater.quitAndInstall(false, true),
    onEvent: (cb: (event: ClientEvent) => void) => {
      autoUpdater.on('update-available', (info) => cb({ type: 'available', version: info.version }));
      autoUpdater.on('update-not-available', () => cb({ type: 'none' }));
      autoUpdater.on('update-downloaded', (info) => cb({ type: 'downloaded', version: info.version }));
      autoUpdater.on('error', (err) => cb({ type: 'error', message: err.message }));
    },
  };
}
