import type { SkippedRow } from './deckParse';
import type { Card, Deck, SessionRecord } from './model';
import type { Grade } from './srs';

/**
 * The control window's whole conversation with the main process. The renderer asks (`ControlOps`) and main answers or
 * pushes (`ControlEvent`); nothing else crosses. Everything is plain JSON.
 */

export type ErrorCode =
  | 'invalid-name'
  | 'duplicate-name'
  | 'not-found'
  | 'already-exists'
  | 'no-valid-rows'
  | 'store-unavailable'
  | 'write-failed'
  | 'empty-deck'
  | 'already-running'
  | 'not-running'
  | 'invalid-request'
  | 'duplicate-card'
  | 'invalid-card'
  | 'deck-in-use'
  | 'file-unreadable'
  | 'file-too-large';

export interface AppError {
  code: ErrorCode;
  message: string;
  /** `no-valid-rows` only: why each line was left out. */
  skipped?: SkippedRow[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface DeckSummary {
  id: string;
  name: string;
  createdAt: number;
  cardCount: number;
}

/** What deleting a deck hands back so it can be put back exactly where it was. */
export interface UndoToken {
  deck: Deck;
  index: number;
}

/** What deleting a card hands back so it can be put back in the same place with its review history. */
export interface CardUndo {
  deckId: string;
  card: Card;
  index: number;
}

export const MAX_CARD_TEXT = 2000;

export interface ImportReport {
  deckId: string;
  added: number;
  /** Rows that matched a card already in the deck (or earlier in the same text). */
  duplicates: number;
  skipped: SkippedRow[];
}

export interface Notice {
  store: 'decks' | 'settings' | 'history';
  kind: 'recovered' | 'migrated' | 'unavailable';
  detail: string;
}

export interface ViewCard {
  id: string;
  front: string;
  back: string;
}

export type SessionView =
  | { phase: 'idle' }
  | {
      phase: 'running';
      deckId: string;
      deckName: string;
      topic: string;
      startedAt: number;
      paused: boolean;
      stay: boolean;
      stayLeftMs: number | null;
      /** The user is idle or the screen is locked. */
      away: boolean;
      /** A fullscreen app or an excluded app is in front. */
      suppressed: boolean;
      card: ViewCard | null;
      answered: number;
      treats: number;
      /** A review could not be saved; the session carries on. */
      saveProblem: boolean;
    }
  | {
      phase: 'ended';
      deckName: string;
      topic: string;
      startedAt: number;
      endedAt: number;
      answered: number;
      treats: number;
      longestWaitMs: number;
      guiltTrips: number;
      /** False if the history could not be written. */
      saved: boolean;
    };

export interface SessionRow extends SessionRecord {
  /** Null once the deck has been deleted. */
  deckName: string | null;
}

export interface SessionDefaults {
  cap: 2 | 3 | 4;
  checkinMinMinutes: number;
  checkinMaxMinutes: number;
}

export interface LibrarySnapshot {
  decks: DeckSummary[];
  /** Newest first. */
  sessions: SessionRow[];
  notices: Notice[];
  defaults: SessionDefaults;
  trackerDown: boolean;
  /** The Leave it shortcut could not be registered because another app owns it. */
  leaveItConflict: boolean;
  /** How the Leave it shortcut is written, such as "Ctrl+Alt+L". */
  leaveItLabel: string;
}

export interface StartRequest {
  deckId: string;
  topic: string;
  checkinMinMinutes: number;
  checkinMaxMinutes: number;
}

export type SessionAction = { action: 'pause' } | { action: 'resume' } | { action: 'stay-on'; minutes: 15 | 25 | 50 } | { action: 'stay-off' };

/** `[request, response]` for each operation. */
export interface ControlOps {
  'app:snapshot': [void, LibrarySnapshot];
  'session:view': [void, SessionView];
  'deck:create': [{ name: string }, Result<DeckSummary>];
  'deck:rename': [{ id: string; name: string }, Result<DeckSummary>];
  'deck:delete': [{ id: string }, Result<UndoToken>];
  'deck:restore': [UndoToken, Result<DeckSummary>];
  /** `deckId` null makes a new deck called `name`. */
  'deck:import-text': [{ deckId: string | null; name: string; text: string }, Result<ImportReport>];
  /** Main opens the file dialog. `null` inside `ok` means the user cancelled. */
  'deck:import-file': [{ deckId: string | null }, Result<ImportReport | null>];
  /** Main opens the save dialog. `null` inside `ok` means the user cancelled. */
  'deck:export': [{ id: string }, Result<{ path: string } | null>];
  'card:list': [{ deckId: string }, Result<ViewCard[]>];
  'card:add': [{ deckId: string; front: string; back: string }, Result<ViewCard>];
  /** Changes the words only; the card keeps its review history. */
  'card:edit': [{ deckId: string; cardId: string; front: string; back: string }, Result<ViewCard>];
  'card:delete': [{ deckId: string; cardId: string }, Result<CardUndo>];
  'card:restore': [CardUndo, Result<ViewCard>];
  'session:start': [StartRequest, Result<SessionView>];
  'session:end': [void, Result<SessionView>];
  'session:answer': [{ grade: Grade }, Result<void>];
  'session:control': [SessionAction, Result<void>];
  'session:dismiss-summary': [void, void];
}

export type OpName = keyof ControlOps;
export type OpArgs<K extends OpName> = ControlOps[K][0];
export type OpResult<K extends OpName> = ControlOps[K][1];

export const OP_NAMES: readonly OpName[] = [
  'app:snapshot',
  'session:view',
  'deck:create',
  'deck:rename',
  'deck:delete',
  'deck:restore',
  'deck:import-text',
  'deck:import-file',
  'deck:export',
  'card:list',
  'card:add',
  'card:edit',
  'card:delete',
  'card:restore',
  'session:start',
  'session:end',
  'session:answer',
  'session:control',
  'session:dismiss-summary',
];

export interface AppStatus {
  trackerDown: boolean;
  leaveItConflict: boolean;
  leaveItLabel: string;
}

export type ControlEvent = { type: 'session'; view: SessionView } | ({ type: 'status' } & AppStatus);

/** `window.barkControl`, exposed by the control window's preload. */
export interface BarkControlApi {
  call: <K extends OpName>(op: K, args: OpArgs<K>) => Promise<OpResult<K>>;
  onEvent: (cb: (event: ControlEvent) => void) => void;
}

export const CONTROL_CHANNEL = { call: 'control:call', event: 'control:event' } as const;
