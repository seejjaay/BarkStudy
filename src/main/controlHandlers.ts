import {
  OP_NAMES,
  type AppError,
  type AppStatus,
  type CardUndo,
  type LoginItemState,
  type OnboardingFinish,
  type LibrarySnapshot,
  type OpName,
  type Result,
  type SessionAction,
  type SessionRow,
  type SettingsPatch,
  type SettingsView,
  type StartRequest,
  type UndoToken,
} from '../shared/control';
import { TRAIT_PRESETS } from '../engine/tuning';
import { isAccelerator, sameAccelerator } from '../shared/accelerator';
import { SAMPLE_DECK } from '../shared/sampleDeck';
import type { Settings } from '../shared/settings';
import { isDecksFile } from '../shared/validate';
import type { Grade } from '../shared/srs';
import type { Library } from './library';
import { MAX_DECK_NAME } from './library';
import { resolveLink } from './links';
import type { SessionController } from './session';

/**
 * The renderer is not trusted to send well-formed requests, so every operation checks its own arguments before
 * touching anything. A malformed request gets `invalid-request`; an operation that does not exist is an error.
 */

export const MAX_IMPORT_CHARS = 5_000_000;
/** A backup holds every deck, card state and session, so it may be much larger than a deck import. */
export const MAX_BACKUP_CHARS = 50_000_000;
export const SNAPSHOT_SESSIONS = 200;

export interface PickedFile {
  /** File name without folders or extension. */
  name: string;
  text: string;
}

/** The native dialogs and file reads, supplied by the Electron side so this module stays testable. */
export interface FileAccess {
  /** Null means the user cancelled. Errors are returned, not thrown. */
  pickImport: () => Promise<Result<PickedFile | null>>;
  /** Null means the user cancelled. Throws if the file cannot be written. */
  saveExport: (suggestedName: string, csv: string) => Promise<{ path: string } | null>;
  /** Null means the user cancelled. Errors (unreadable, too large) are returned, not thrown. */
  pickBackup: () => Promise<Result<{ path: string; text: string } | null>>;
  /** Null means the user cancelled. Throws if the file cannot be written. */
  saveBackup: (suggestedName: string, json: string) => Promise<{ path: string } | null>;
}

/** What the handlers need from the operating system, supplied by the Electron side so this module stays testable. */
export interface PlatformAccess {
  loginItem: { get: () => LoginItemState; set: (on: boolean) => void };
  /** Process names of the windows open right now. */
  openApps: () => string[];
  dataDir: string;
  /** Opens an address in the browser. Only ever called with an address from the link allowlist. */
  openLink: (url: string) => void;
  /** Makes the dog follow the reduced-motion setting now. */
  applyReducedMotion: (mode: Settings['reducedMotion']) => void;
  version: string;
  /** Opens a folder in Explorer. Resolves to an error message, or an empty string on success (Electron's `shell.openPath`). */
  openPath: (path: string) => Promise<string>;
  /** Called once the stored settings have been replaced wholesale (restore or reset): re-bind the shortcuts, reduced motion and tray from them. */
  afterReplace: () => void;
  /** Turns the onboarding Leave it practice on or off. */
  setPractice: (on: boolean) => void;
}

/** The global shortcuts that can be moved. `rebind` returns false, with the old shortcut still working, if another app owns the new one. */
export interface HotkeyTargets {
  leaveIt: { rebind: (accelerator: string) => boolean };
  bubble: { rebind: (accelerator: string) => boolean };
}

export interface ControlHandlerOptions {
  library: Library;
  session: SessionController;
  files: FileAccess;
  status: () => AppStatus;
  platform: PlatformAccess;
  hotkeys: HotkeyTargets;
}

export interface ControlHandlers {
  handle: (op: unknown, args: unknown) => Promise<unknown>;
}

const fail = (code: AppError['code'], message: string): { ok: false; error: AppError } => ({ ok: false, error: { code, message } });
const bad = () => fail('invalid-request', 'that request was not understood');
const IN_USE = fail('deck-in-use', 'a session is using that deck right now');
const isOp = (v: unknown): v is OpName => typeof v === 'string' && (OP_NAMES as readonly string[]).includes(v);
const rec = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const GRADES: readonly string[] = ['again', 'hard', 'good'];

/** A file name Windows will accept. */
export function safeFileName(name: string): string {
  const forbidden = '<>:"/\\|?*';
  const replaced = [...name].map((ch) => (ch.charCodeAt(0) < 32 || forbidden.includes(ch) ? '_' : ch)).join('');
  const cleaned = replaced.replace(/[. ]+$/, '').trim();
  return cleaned.length > 0 ? cleaned : 'deck';
}

function parseCardUndo(v: unknown): CardUndo | null {
  const a = rec(v);
  if (!a || typeof a['deckId'] !== 'string' || typeof a['index'] !== 'number' || !Number.isInteger(a['index']) || a['index'] < 0) return null;
  const candidate = { decks: [{ id: a['deckId'], name: 'x', createdAt: 0, cards: [a['card']] }] };
  return isDecksFile(candidate) ? { deckId: a['deckId'], card: candidate.decks[0]!.cards[0]!, index: a['index'] } : null;
}

function parseToken(v: unknown): UndoToken | null {
  const a = rec(v);
  if (!a || typeof a['index'] !== 'number' || !Number.isInteger(a['index']) || a['index'] < 0) return null;
  const candidate = { decks: [a['deck']] };
  return isDecksFile(candidate) ? { deck: candidate.decks[0]!, index: a['index'] } : null;
}

function parseStart(v: unknown): StartRequest | null {
  const a = rec(v);
  if (!a) return null;
  const { deckId, topic, checkinMinMinutes, checkinMaxMinutes } = a;
  if (typeof deckId !== 'string' || typeof topic !== 'string' || typeof checkinMinMinutes !== 'number' || typeof checkinMaxMinutes !== 'number') return null;
  return { deckId, topic, checkinMinMinutes, checkinMaxMinutes };
}

const MAX_PATCH_APPS = 1000;

/** Only the settings the settings page may change; anything else, an empty patch, or a wrong type is refused. */
function parsePatch(v: unknown): SettingsPatch | null {
  const a = rec(v);
  if (!a || Object.keys(a).length === 0) return null;
  for (const [key, x] of Object.entries(a)) {
    switch (key) {
      case 'cap':
        if (x !== 2 && x !== 3 && x !== 4) return null;
        break;
      case 'preset':
        if (typeof x !== 'string') return null;
        break;
      case 'checkinMinMinutes':
      case 'checkinMaxMinutes':
      case 'volume':
        if (typeof x !== 'number') return null;
        break;
      case 'excludedApps':
        // Far past the 100 that can be saved: refused here so a huge list is never normalised just to be refused.
        if (!Array.isArray(x) || x.length > MAX_PATCH_APPS || !x.every((item) => typeof item === 'string')) return null;
        break;
      case 'soundOn':
      case 'updateChecks':
      case 'betaChannel':
        if (typeof x !== 'boolean') return null;
        break;
      case 'reducedMotion':
        if (x !== 'system' && x !== 'on' && x !== 'off') return null;
        break;
      default:
        return null;
    }
  }
  return a;
}

function parseFinish(v: unknown): OnboardingFinish | null {
  const a = rec(v);
  if (!a) return null;
  const { cap, preset, updateChecks, sampleDeck } = a;
  if (cap !== 2 && cap !== 3 && cap !== 4) return null;
  if (typeof preset !== 'string' || !Object.hasOwn(TRAIT_PRESETS, preset)) return null;
  if (typeof updateChecks !== 'boolean' || typeof sampleDeck !== 'boolean') return null;
  return { cap, preset: preset as OnboardingFinish['preset'], updateChecks, sampleDeck };
}

function parseAction(v: unknown): SessionAction | null {
  const a = rec(v);
  if (!a) return null;
  switch (a['action']) {
    case 'pause':
    case 'resume':
    case 'stay-off':
      return { action: a['action'] };
    case 'stay-on':
      return typeof a['minutes'] === 'number' ? { action: 'stay-on', minutes: a['minutes'] as 15 | 25 | 50 } : null;
    default:
      return null;
  }
}

export function createControlHandlers(opts: ControlHandlerOptions): ControlHandlers {
  const { library, session, files, platform, hotkeys } = opts;

  function snapshot(): LibrarySnapshot {
    const decks = library.listDecks();
    const names = new Map(decks.map((d) => [d.id, d.name]));
    const sessions: SessionRow[] = library
      .listSessions()
      .slice(0, SNAPSHOT_SESSIONS)
      .map((s) => ({ ...s, deckName: names.get(s.deckId) ?? null }));
    const { cap, checkinMinMinutes, checkinMaxMinutes } = library.getSettings();
    const { onboarded } = library.getSettings();
    return { decks, sessions, notices: library.notices(), defaults: { cap, checkinMinMinutes, checkinMaxMinutes }, ...opts.status(), onboarded, version: platform.version };
  }

  async function updateSettings(patch: SettingsPatch): Promise<unknown> {
    const r = await library.updateSettings(patch);
    if (r.ok && patch.reducedMotion !== undefined) platform.applyReducedMotion(r.value.reducedMotion);
    return r;
  }

  /** Binds the new shortcut before saving it, so one that cannot be bound is never stored; a failed save puts the old one back. */
  async function setHotkey(which: 'leaveIt' | 'bubble', accelerator: string): Promise<unknown> {
    if (!isAccelerator(accelerator)) return fail('hotkey-invalid', 'that is not a usable shortcut');
    const current = library.getSettings();
    const key = which === 'leaveIt' ? 'leaveItHotkey' : 'bubbleHotkey';
    const other = which === 'leaveIt' ? current.bubbleHotkey : current.leaveItHotkey;
    if (sameAccelerator(accelerator, other)) return fail('hotkey-invalid', 'the two shortcuts must differ');
    const old = current[key];
    if (sameAccelerator(accelerator, old)) return { ok: true, value: current };
    if (!hotkeys[which].rebind(accelerator)) return fail('hotkey-taken', 'another app is using that shortcut');
    const saved = await library.updateSettings({ [key]: accelerator });
    if (!saved.ok) hotkeys[which].rebind(old);
    return saved;
  }

  function setLoginItem(on: boolean): unknown {
    if (!platform.loginItem.get().available) return { ok: true, value: { available: false, on: false } };
    platform.loginItem.set(on);
    return { ok: true, value: platform.loginItem.get() };
  }

  function settingsView(): SettingsView {
    return { settings: library.getSettings(), loginItem: platform.loginItem.get(), openApps: platform.openApps(), dataDir: platform.dataDir };
  }

  const running = () => session.view().phase === 'running';
  const RUNNING = fail('session-running', 'a session is running');

  async function openDataFolder(): Promise<unknown> {
    const error = await platform.openPath(platform.dataDir);
    return error === '' ? { ok: true, value: undefined } : fail('file-unreadable', error);
  }

  async function exportAll(): Promise<unknown> {
    const out = library.exportAll();
    if (!out.ok) return out;
    try {
      return { ok: true, value: await files.saveBackup(`barkstudy-backup-${new Date().toISOString().slice(0, 10)}.json`, out.value) };
    } catch (e) {
      return fail('write-failed', e instanceof Error ? e.message : String(e));
    }
  }

  /** After a wholesale replace the stored settings may differ from what is bound, so re-apply them. A refused or wholly failed replace changed nothing; a partial one changed some. */
  function settled(r: Result<void>): Result<void> {
    if (r.ok || r.error.code === 'partly-replaced') platform.afterReplace();
    return r;
  }

  async function importAll(): Promise<unknown> {
    if (running()) return RUNNING;
    const picked = await files.pickBackup();
    if (!picked.ok) return picked;
    if (picked.value === null) return { ok: true, value: null };
    if (picked.value.text.length > MAX_BACKUP_CHARS) return fail('file-too-large', 'that file is too large to be a backup');
    if (running()) return RUNNING; // a session may have started while the dialog was open
    const r = settled(await library.replaceAll(picked.value.text));
    return r.ok ? { ok: true, value: { path: picked.value.path } } : r;
  }

  async function reset(): Promise<unknown> {
    return running() ? RUNNING : settled(await library.resetAll());
  }

  /** The starter deck goes first and is found by name, so finishing twice (or "Run setup again") never adds a second copy. */
  async function finishOnboarding(req: OnboardingFinish): Promise<unknown> {
    let deckId: string | null = null;
    if (req.sampleDeck) {
      const existing = library.listDecks().find((d) => d.name.trim().toLowerCase() === SAMPLE_DECK.name.toLowerCase());
      if (existing) deckId = existing.id;
      else {
        const made = await library.importAsNewDeck(SAMPLE_DECK.name, SAMPLE_DECK.text);
        if (!made.ok) return made;
        deckId = made.value.deckId;
      }
    }
    const saved = await library.updateSettings({ cap: req.cap, preset: req.preset, updateChecks: req.updateChecks, onboarded: true });
    return saved.ok ? { ok: true, value: { deckId } } : saved;
  }

  async function importFile(deckId: string | null): Promise<unknown> {
    const picked = await files.pickImport();
    if (!picked.ok) return picked;
    if (picked.value === null) return { ok: true, value: null };
    const { name, text } = picked.value;
    const r = deckId === null ? await library.importAsNewDeck(name.trim().slice(0, MAX_DECK_NAME), text) : await library.importInto(deckId, text);
    return r;
  }

  async function exportDeck(id: string): Promise<unknown> {
    const out = library.exportDeck(id);
    if (!out.ok) return out;
    try {
      return { ok: true, value: await files.saveExport(`${safeFileName(out.value.name)}.csv`, out.value.csv) };
    } catch (e) {
      return fail('write-failed', e instanceof Error ? e.message : String(e));
    }
  }

  return {
    async handle(op, args) {
      if (!isOp(op)) throw new Error('unknown operation');
      const a = rec(args);
      // The running session holds its own copy of the deck's cards, so the deck is frozen while it runs.
      const inUse = (deckId: unknown) => (typeof deckId === 'string' && deckId === session.activeDeckId() ? IN_USE : null);
      switch (op) {
        case 'app:snapshot':
          return snapshot();
        case 'session:view':
          return session.view();
        case 'deck:create':
          return a && typeof a['name'] === 'string' ? library.createDeck(a['name']) : bad();
        case 'deck:rename':
          return a && typeof a['id'] === 'string' && typeof a['name'] === 'string' ? (inUse(a['id']) ?? library.renameDeck(a['id'], a['name'])) : bad();
        case 'deck:delete':
          return a && typeof a['id'] === 'string' ? (inUse(a['id']) ?? library.deleteDeck(a['id'])) : bad();
        case 'card:list':
          return a && typeof a['deckId'] === 'string' ? library.listCards(a['deckId']) : bad();
        case 'card:add':
          return a && typeof a['deckId'] === 'string' && typeof a['front'] === 'string' && typeof a['back'] === 'string'
            ? (inUse(a['deckId']) ?? library.addCard(a['deckId'], a['front'], a['back']))
            : bad();
        case 'card:edit':
          return a && typeof a['deckId'] === 'string' && typeof a['cardId'] === 'string' && typeof a['front'] === 'string' && typeof a['back'] === 'string'
            ? (inUse(a['deckId']) ?? library.editCard(a['deckId'], a['cardId'], a['front'], a['back']))
            : bad();
        case 'card:delete':
          return a && typeof a['deckId'] === 'string' && typeof a['cardId'] === 'string'
            ? (inUse(a['deckId']) ?? library.deleteCard(a['deckId'], a['cardId']))
            : bad();
        case 'card:restore': {
          const undo = parseCardUndo(args);
          return undo ? (inUse(undo.deckId) ?? library.restoreCard(undo)) : bad();
        }
        case 'deck:restore': {
          const token = parseToken(args);
          return token ? library.restoreDeck(token) : bad();
        }
        case 'deck:import-text': {
          if (!a || typeof a['text'] !== 'string' || typeof a['name'] !== 'string' || !(a['deckId'] === null || typeof a['deckId'] === 'string')) return bad();
          if (a['text'].length > MAX_IMPORT_CHARS) return fail('file-too-large', 'that text is too large to import');
          return a['deckId'] === null ? library.importAsNewDeck(a['name'], a['text']) : library.importInto(a['deckId'], a['text']);
        }
        case 'deck:import-file':
          return a && (a['deckId'] === null || typeof a['deckId'] === 'string') ? importFile(a['deckId']) : bad();
        case 'deck:export':
          return a && typeof a['id'] === 'string' ? exportDeck(a['id']) : bad();
        case 'session:start': {
          const req = parseStart(args);
          return req ? session.start(req) : bad();
        }
        case 'session:end':
          return session.end();
        case 'session:answer':
          return a && typeof a['grade'] === 'string' && GRADES.includes(a['grade']) ? session.answer(a['grade'] as Grade) : bad();
        case 'session:control': {
          const action = parseAction(args);
          return action ? session.control(action) : bad();
        }
        case 'session:dismiss-summary':
          session.dismissSummary();
          return undefined;
        case 'settings:get':
          return settingsView();
        case 'settings:update': {
          const patch = parsePatch(args);
          return patch ? updateSettings(patch) : bad();
        }
        case 'settings:hotkey':
          return a && (a['which'] === 'leaveIt' || a['which'] === 'bubble') && typeof a['accelerator'] === 'string' ? setHotkey(a['which'], a['accelerator']) : bad();
        case 'settings:login-item':
          return a && typeof a['on'] === 'boolean' ? setLoginItem(a['on']) : bad();
        case 'data:open-folder':
          return openDataFolder();
        case 'data:export-all':
          return exportAll();
        case 'data:import-all':
          return importAll();
        case 'data:reset':
          return reset();
        case 'onboarding:practice':
          if (!a || typeof a['on'] !== 'boolean') return bad();
          platform.setPractice(a['on']);
          return undefined;
        case 'onboarding:finish': {
          const req = parseFinish(args);
          return req ? finishOnboarding(req) : bad();
        }
        case 'link:open': {
          const url = resolveLink(a?.['id']);
          if (url === null) return bad();
          platform.openLink(url);
          return { ok: true, value: undefined };
        }
      }
    },
  };
}
