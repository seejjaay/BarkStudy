import {
  OP_NAMES,
  type AppError,
  type CardUndo,
  type LibrarySnapshot,
  type OpName,
  type Result,
  type SessionAction,
  type SessionRow,
  type StartRequest,
  type UndoToken,
} from '../shared/control';
import { isDecksFile } from '../shared/validate';
import type { Grade } from '../shared/srs';
import type { Library } from './library';
import { MAX_DECK_NAME } from './library';
import type { SessionController } from './session';

/**
 * The renderer is not trusted to send well-formed requests, so every operation checks its own arguments before
 * touching anything. A malformed request gets `invalid-request`; an operation that does not exist is an error.
 */

export const MAX_IMPORT_CHARS = 5_000_000;
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
}

export interface ControlHandlerOptions {
  library: Library;
  session: SessionController;
  files: FileAccess;
  trackerDown: () => boolean;
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
  const { library, session, files } = opts;

  function snapshot(): LibrarySnapshot {
    const decks = library.listDecks();
    const names = new Map(decks.map((d) => [d.id, d.name]));
    const sessions: SessionRow[] = library
      .listSessions()
      .slice(0, SNAPSHOT_SESSIONS)
      .map((s) => ({ ...s, deckName: names.get(s.deckId) ?? null }));
    const { cap, checkinMinMinutes, checkinMaxMinutes } = library.getSettings();
    return { decks, sessions, notices: library.notices(), defaults: { cap, checkinMinMinutes, checkinMaxMinutes }, trackerDown: opts.trackerDown() };
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
      }
    },
  };
}
