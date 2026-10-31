import {
  MAX_CARD_TEXT,
  type AppError,
  type CardUndo,
  type DeckSummary,
  type ErrorCode,
  type ImportReport,
  type Notice,
  type Result,
  type UndoToken,
  type ViewCard,
} from '../shared/control';
import { exportDeck as exportCsv, parseDeck } from '../shared/deckParse';
import type { Card, Deck, DecksFile, GuiltTripRecord, HistoryFile, SessionRecord } from '../shared/model';
import { DEFAULT_SETTINGS, checkSettings, fillSettings, normalizeExcluded, type Settings } from '../shared/settings';
import { newCard } from '../shared/srs';
import { isSettings } from '../shared/validate';
import type { SessionSummary } from './engineHost';
import { upgrade, type ReadResult, type Storage, type StoreDef } from './storage/io';
import { decksStore, historyStore, settingsStore } from './storage/stores';

/**
 * Everything the control window reads and changes: decks, session history, settings. The data lives in memory and each
 * change is applied to a copy, written, and only then adopted, so a failed write never leaves memory ahead of disk
 * and two changes at once cannot lose each other. A store that could not be read safely is left alone and its changes
 * are refused; the rest of the library keeps working.
 */

export const MAX_DECK_NAME = 80;

export interface SessionInput {
  deckId: string;
  topic: string;
  summary: SessionSummary;
}

export interface Library {
  listDecks: () => DeckSummary[];
  getDeck: (id: string) => Deck | undefined;
  createDeck: (name: string) => Promise<Result<DeckSummary>>;
  renameDeck: (id: string, name: string) => Promise<Result<DeckSummary>>;
  deleteDeck: (id: string) => Promise<Result<UndoToken>>;
  restoreDeck: (token: UndoToken) => Promise<Result<DeckSummary>>;
  importAsNewDeck: (name: string, text: string) => Promise<Result<ImportReport>>;
  importInto: (deckId: string, text: string) => Promise<Result<ImportReport>>;
  exportDeck: (id: string) => Result<{ name: string; csv: string }>;
  listCards: (deckId: string) => Result<ViewCard[]>;
  addCard: (deckId: string, front: string, back: string) => Promise<Result<ViewCard>>;
  /** Changes the words only; the card keeps its review history and its place. */
  editCard: (deckId: string, cardId: string, front: string, back: string) => Promise<Result<ViewCard>>;
  deleteCard: (deckId: string, cardId: string) => Promise<Result<CardUndo>>;
  restoreCard: (undo: CardUndo) => Promise<Result<ViewCard>>;
  /** Replaces the stored card with the same id. */
  updateCard: (deckId: string, card: Card) => Promise<Result<void>>;
  recordSession: (input: SessionInput) => Promise<Result<SessionRecord>>;
  /** Newest first. */
  listSessions: () => SessionRecord[];
  history: () => HistoryFile;
  /** How long the most recent guilt trip waited, for Pandesal's greeting. */
  lastGuiltMs: () => number | null;
  getSettings: () => Settings;
  /** Changes the named settings and leaves the rest. A value that is not valid for its setting is refused with `invalid-request`. */
  updateSettings: (patch: Partial<Settings>) => Promise<Result<Settings>>;
  /** What went wrong, or was quietly repaired, while opening. */
  notices: () => Notice[];
  /** Every store as one JSON bundle. Refused while a store is unavailable, so a blank is never passed off as the user's data. */
  exportAll: () => Result<string>;
  /** Replaces every store with the bundle's. All three parts are checked before any file is touched, and each current file is copied to backups/ first. */
  replaceAll: (json: string) => Promise<Result<void>>;
  /** Replaces every store with its empty/default form, after copying the current files to backups/. */
  resetAll: () => Promise<Result<void>>;
}

export interface LibraryOptions {
  storage: Storage;
  now?: () => number;
  newId?: () => string;
}

interface Slot<T> {
  def: StoreDef<T>;
  value: T;
  available: boolean;
  /** Changes to this store run one after another. */
  chain: Promise<unknown>;
}

const fail = (code: ErrorCode, message: string, extra: Partial<AppError> = {}): { ok: false; error: AppError } => ({
  ok: false,
  error: { code, message, ...extra },
});
const good = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nameKey = (name: string) => name.trim().toLowerCase();
const cardKey = (front: string, back: string) => `${front.trim().replace(/\s+/g, ' ').toLowerCase()}\u0000${back.trim().replace(/\s+/g, ' ').toLowerCase()}`;

const summarize = (d: Deck): DeckSummary => ({ id: d.id, name: d.name, createdAt: d.createdAt, cardCount: d.cards.length });

export async function createLibrary(opts: LibraryOptions): Promise<Library> {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const notices: Notice[] = [];

  async function load<T>(def: StoreDef<T>, store: Notice['store']): Promise<Slot<T>> {
    const r: ReadResult<T> = await opts.storage.read(def);
    const slot = { def, value: def.fallback(), available: true, chain: Promise.resolve() } satisfies Slot<T>;
    switch (r.status) {
      case 'ok':
      case 'created':
        return { ...slot, value: r.value };
      case 'migrated':
        notices.push({ store, kind: 'migrated', detail: `upgraded from version ${r.from}` });
        return { ...slot, value: r.value };
      case 'recovered':
        notices.push({ store, kind: 'recovered', detail: `${r.reason}; restored from ${r.source}` });
        return { ...slot, value: r.value };
      case 'error':
        notices.push({ store, kind: 'unavailable', detail: `${r.error}: ${r.detail}` });
        return { ...slot, available: false };
    }
  }

  const decks = await load<DecksFile>(decksStore, 'decks');
  const settings = await load<Settings>(settingsStore, 'settings');
  settings.value = fillSettings(settings.value); // a file saved before the sound settings existed has no such fields
  const hist = await load<HistoryFile>(historyStore, 'history');

  function mutate<T, R>(slot: Slot<T>, fn: (draft: T) => Result<R>): Promise<Result<R>> {
    const job = async (): Promise<Result<R>> => {
      if (!slot.available) return fail('store-unavailable', `${slot.def.name} could not be read safely, so it is left untouched`);
      const draft = structuredClone(slot.value);
      const r = fn(draft);
      if (!r.ok) return r;
      try {
        await opts.storage.write(slot.def, draft);
      } catch (e) {
        return fail('write-failed', messageOf(e));
      }
      slot.value = draft;
      return r;
    };
    const run = slot.chain.then(job, job);
    slot.chain = run.catch(() => undefined);
    return run;
  }


  const asRecord = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

  interface Everything {
    decks: DecksFile;
    settings: Settings;
    history: HistoryFile;
  }

  function parseBackup(json: string): Result<Everything> {
    const notBackup = (why: string) => fail('not-a-backup', why);
    let v: unknown;
    try {
      v = JSON.parse(json);
    } catch {
      return notBackup('that is not a BarkStudy backup file');
    }
    const root = asRecord(v);
    const stores = asRecord(root?.['stores']);
    if (!root || !stores || root['app'] !== 'barkstudy' || root['kind'] !== 'backup') return notBackup('that is not a BarkStudy backup file');
    const part = <T>(def: StoreDef<T>): Result<T> => {
      const p = asRecord(stores[def.name]);
      if (!p || typeof p['schemaVersion'] !== 'number' || !('data' in p)) return notBackup(`the ${def.name} part is missing from that backup`);
      const u = upgrade(def, p['schemaVersion'], p['data']);
      if (u.ok) return good(u.value);
      return u.reason === 'newer-version'
        ? fail('newer-version', `the ${def.name} part was saved by a newer BarkStudy`)
        : notBackup(`the ${def.name} part of that backup is damaged`);
    };
    const d = part(decksStore);
    if (!d.ok) return d;
    const st = part(settingsStore);
    if (!st.ok) return st;
    const h = part(historyStore);
    if (!h.ok) return h;
    const filled = fillSettings(st.value);
    const settingsValue: Settings = { ...filled, excludedApps: normalizeExcluded(filled.excludedApps) };
    const problem = checkSettings(settingsValue);
    if (problem !== null) return notBackup(`the settings in that backup are not usable: ${problem}`);
    return good({ decks: d.value, settings: settingsValue, history: h.value });
  }

  function replaceSlot<T>(slot: Slot<T>, value: T): Promise<Result<void>> {
    const job = async (): Promise<Result<void>> => {
      try {
        await opts.storage.backup(slot.def);
        await opts.storage.write(slot.def, value);
      } catch (e) {
        return fail('write-failed', messageOf(e));
      }
      slot.value = structuredClone(value);
      slot.available = true;
      for (let i = notices.length - 1; i >= 0; i--) if (notices[i]!.store === slot.def.name) notices.splice(i, 1);
      return good(undefined);
    };
    const run = slot.chain.then(job, job);
    slot.chain = run.catch(() => undefined);
    return run;
  }

  async function applyAll(all: Everything): Promise<Result<void>> {
    const done: string[] = [];
    const steps: [string, () => Promise<Result<void>>][] = [
      ['decks', () => replaceSlot(decks, all.decks)],
      ['settings', () => replaceSlot(settings, all.settings)],
      ['history', () => replaceSlot(hist, all.history)],
    ];
    for (const [name, run] of steps) {
      const r = await run();
      if (!r.ok) return fail('write-failed', `${r.error.message}; already replaced: ${done.length > 0 ? done.join(', ') : 'nothing'}. The old files are in the backups folder.`);
      done.push(name);
    }
    return good(undefined);
  }

  function checkName(file: DecksFile, name: string, selfId?: string): { ok: true; name: string } | { ok: false; error: AppError } {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_DECK_NAME) return fail('invalid-name', `a deck name is 1 to ${MAX_DECK_NAME} characters`);
    if (file.decks.some((d) => d.id !== selfId && nameKey(d.name) === nameKey(trimmed))) return fail('duplicate-name', 'a deck with that name already exists');
    return { ok: true, name: trimmed };
  }

  function checkCardText(front: string, back: string): { ok: true; front: string; back: string } | { ok: false; error: AppError } {
    const f = front.trim();
    const b = back.trim();
    if (f.length === 0 || b.length === 0 || f.length > MAX_CARD_TEXT || b.length > MAX_CARD_TEXT) {
      return fail('invalid-card', `each side of a card is 1 to ${MAX_CARD_TEXT} characters`);
    }
    return { ok: true, front: f, back: b };
  }
  const hasCard = (deck: Deck, front: string, back: string, exceptId?: string) =>
    deck.cards.some((c) => c.id !== exceptId && cardKey(c.front, c.back) === cardKey(front, back));
  const viewOf = (c: Card): ViewCard => ({ id: c.id, front: c.front, back: c.back });
  const dupCard = () => fail('duplicate-card', 'that deck already has a card with the same front and back');

  const findDeck = (file: DecksFile, id: string) => file.decks.find((d) => d.id === id);
  const deckNotFound = () => fail('not-found', 'that deck no longer exists');

  return {
    listDecks: () => decks.value.decks.map(summarize),
    getDeck: (id) => {
      const d = findDeck(decks.value, id);
      return d ? structuredClone(d) : undefined;
    },

    createDeck: (name) =>
      mutate(decks, (file) => {
        const n = checkName(file, name);
        if (!n.ok) return n;
        const deck: Deck = { id: newId(), name: n.name, createdAt: now(), cards: [] };
        file.decks.push(deck);
        return good(summarize(deck));
      }),

    renameDeck: (id, name) =>
      mutate(decks, (file) => {
        const deck = findDeck(file, id);
        if (!deck) return deckNotFound();
        const n = checkName(file, name, id);
        if (!n.ok) return n;
        deck.name = n.name;
        return good(summarize(deck));
      }),

    deleteDeck: (id) =>
      mutate(decks, (file) => {
        const index = file.decks.findIndex((d) => d.id === id);
        if (index < 0) return deckNotFound();
        const [deck] = file.decks.splice(index, 1);
        return good({ deck: deck!, index });
      }),

    restoreDeck: ({ deck, index }) =>
      mutate(decks, (file) => {
        if (file.decks.some((d) => d.id === deck.id)) return fail('already-exists', 'that deck is already back');
        const n = checkName(file, deck.name);
        if (!n.ok) return n;
        file.decks.splice(Math.min(index, file.decks.length), 0, structuredClone(deck));
        return good(summarize(deck));
      }),

    importAsNewDeck: (name, text) =>
      mutate(decks, (file) => {
        const n = checkName(file, name);
        if (!n.ok) return n;
        const parsed = parseDeck(text);
        if (parsed.cards.length === 0) return fail('no-valid-rows', 'no row could be read as a card', { skipped: parsed.skipped });
        const at = now();
        const deck: Deck = { id: newId(), name: n.name, createdAt: at, cards: [] };
        const seen = new Set<string>();
        let duplicates = 0;
        for (const c of parsed.cards) {
          const key = cardKey(c.front, c.back);
          if (seen.has(key)) duplicates++;
          else {
            seen.add(key);
            deck.cards.push(newCard(newId(), c.front, c.back, at));
          }
        }
        file.decks.push(deck);
        return good({ deckId: deck.id, added: deck.cards.length, duplicates, skipped: parsed.skipped });
      }),

    importInto: (deckId, text) =>
      mutate(decks, (file) => {
        const deck = findDeck(file, deckId);
        if (!deck) return deckNotFound();
        const parsed = parseDeck(text);
        if (parsed.cards.length === 0) return fail('no-valid-rows', 'no row could be read as a card', { skipped: parsed.skipped });
        const at = now();
        const seen = new Set(deck.cards.map((c) => cardKey(c.front, c.back)));
        let added = 0;
        let duplicates = 0;
        for (const c of parsed.cards) {
          const key = cardKey(c.front, c.back);
          if (seen.has(key)) {
            duplicates++;
            continue;
          }
          seen.add(key);
          deck.cards.push(newCard(newId(), c.front, c.back, at));
          added++;
        }
        return good({ deckId, added, duplicates, skipped: parsed.skipped });
      }),

    exportDeck: (id) => {
      const deck = findDeck(decks.value, id);
      return deck ? good({ name: deck.name, csv: exportCsv(deck.cards) }) : deckNotFound();
    },

    listCards: (deckId) => {
      const deck = findDeck(decks.value, deckId);
      return deck ? good(deck.cards.map(viewOf)) : deckNotFound();
    },

    addCard: (deckId, front, back) =>
      mutate(decks, (file) => {
        const deck = findDeck(file, deckId);
        if (!deck) return deckNotFound();
        const text = checkCardText(front, back);
        if (!text.ok) return text;
        if (hasCard(deck, text.front, text.back)) return dupCard();
        const card = newCard(newId(), text.front, text.back, now());
        deck.cards.push(card);
        return good(viewOf(card));
      }),

    editCard: (deckId, cardId, front, back) =>
      mutate(decks, (file) => {
        const deck = findDeck(file, deckId);
        const card = deck?.cards.find((c) => c.id === cardId);
        if (!deck || !card) return fail('not-found', 'that card no longer exists');
        const text = checkCardText(front, back);
        if (!text.ok) return text;
        if (hasCard(deck, text.front, text.back, cardId)) return dupCard();
        card.front = text.front;
        card.back = text.back;
        return good(viewOf(card));
      }),

    deleteCard: (deckId, cardId) =>
      mutate(decks, (file) => {
        const deck = findDeck(file, deckId);
        const index = deck ? deck.cards.findIndex((c) => c.id === cardId) : -1;
        if (!deck || index < 0) return fail('not-found', 'that card no longer exists');
        const [card] = deck.cards.splice(index, 1);
        return good({ deckId, card: card!, index });
      }),

    restoreCard: ({ deckId, card, index }) =>
      mutate(decks, (file) => {
        const deck = findDeck(file, deckId);
        if (!deck) return deckNotFound();
        if (deck.cards.some((c) => c.id === card.id)) return fail('already-exists', 'that card is already back');
        if (hasCard(deck, card.front, card.back)) return dupCard();
        deck.cards.splice(Math.min(index, deck.cards.length), 0, structuredClone(card));
        return good(viewOf(card));
      }),

    updateCard: (deckId, card) =>
      mutate(decks, (file) => {
        const deck = findDeck(file, deckId);
        if (!deck) return deckNotFound();
        const i = deck.cards.findIndex((c) => c.id === card.id);
        if (i < 0) return fail('not-found', 'that card no longer exists');
        deck.cards[i] = structuredClone(card);
        return good(undefined);
      }),

    recordSession: ({ deckId, topic, summary }) =>
      mutate(hist, (file) => {
        const record: SessionRecord = {
          id: newId(),
          deckId,
          topic,
          startedAt: summary.startedAt,
          endedAt: summary.endedAt,
          answered: summary.answered,
          treats: summary.treats,
          longestWaitMs: summary.longestWaitMs,
          guiltTrips: summary.guiltTrips.length,
        };
        file.sessions.push(record);
        file.guiltTrips.push(...summary.guiltTrips.map((g): GuiltTripRecord => ({ at: g.at, waitedMs: g.waitedMs })));
        file.treats += summary.treats;
        return good(record);
      }),

    listSessions: () => [...hist.value.sessions].reverse().map((s) => ({ ...s })),
    history: () => structuredClone(hist.value),
    lastGuiltMs: () => hist.value.guiltTrips.at(-1)?.waitedMs ?? null,
    getSettings: () => structuredClone(settings.value),

    updateSettings: (patch) =>
      mutate(settings, (draft) => {
        // Only the named settings are taken, and the result must be a valid whole before anything is written.
        const next: Record<string, unknown> = { ...draft };
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          const value = (patch as Record<string, unknown>)[key];
          if (value !== undefined) next[key] = value;
        }
        if (!isSettings(next)) return fail('invalid-request', 'that setting is not usable');
        const whole: Settings = { ...fillSettings(next), excludedApps: normalizeExcluded(next.excludedApps) };
        const problem = checkSettings(whole);
        if (problem !== null) return fail('invalid-request', problem);
        Object.assign(draft, whole);
        return good(structuredClone(draft));
      }),
    notices: () => notices.map((n) => ({ ...n })),

    exportAll: () => {
      const unavailable = [decks, settings, hist].find((slot) => !slot.available);
      if (unavailable) return fail('store-unavailable', `${unavailable.def.name} could not be read safely, so there is nothing trustworthy to export`);
      const part = <T>(slot: Slot<T>) => ({ schemaVersion: slot.def.migrations.length + 1, data: slot.value });
      return good(
        JSON.stringify({
          app: 'barkstudy',
          kind: 'backup',
          exportedAt: new Date(now()).toISOString(),
          stores: { decks: part(decks), settings: part(settings), history: part(hist) },
        }),
      );
    },
    replaceAll: async (json) => {
      const parsed = parseBackup(json);
      return parsed.ok ? applyAll(parsed.value) : parsed;
    },
    resetAll: () => applyAll({ decks: decksStore.fallback(), settings: settingsStore.fallback(), history: historyStore.fallback() }),
  };
}
