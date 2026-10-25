import type { DecksFile, HistoryFile } from '../../shared/model';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { isDecksFile, isHistoryFile, isSettings } from '../../shared/validate';
import type { StoreDef } from './io';

// To change a stored shape: add a migration to the END of that store's `migrations` (one pure function from the old
// data to the new), and add tests/fixtures/schemas/v<old>/<name>.json. The "every past fixture migrates to current"
// test fails until every older version has a fixture. v1 may still change freely until the first beta ships.

export const decksStore: StoreDef<DecksFile> = {
  name: 'decks',
  migrations: [],
  fallback: () => ({ decks: [] }),
  validate: isDecksFile,
};

export const settingsStore: StoreDef<Settings> = {
  name: 'settings',
  migrations: [],
  fallback: () => ({ ...DEFAULT_SETTINGS, excludedApps: [...DEFAULT_SETTINGS.excludedApps] }),
  validate: isSettings,
};

export const historyStore: StoreDef<HistoryFile> = {
  name: 'history',
  migrations: [],
  fallback: () => ({ sessions: [], guiltTrips: [], treats: 0 }),
  validate: isHistoryFile,
};

export const allStores = [decksStore, settingsStore, historyStore] as readonly StoreDef<unknown>[];
