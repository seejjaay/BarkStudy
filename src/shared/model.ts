/** FSRS memory state for one card, in plain JSON (dates are epoch milliseconds). Wraps ts-fsrs's Card; see srs.ts. */
export interface FsrsState {
  /** When the card is next due. */
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** 0 New, 1 Learning, 2 Review, 3 Relearning (ts-fsrs `State`). */
  state: 0 | 1 | 2 | 3;
  lastReview: number | null;
}

export interface Card {
  id: string;
  front: string;
  back: string;
  createdAt: number;
  fsrs: FsrsState;
}

export interface Deck {
  id: string;
  name: string;
  createdAt: number;
  cards: Card[];
}

export interface DecksFile {
  decks: Deck[];
}

export interface SessionRecord {
  id: string;
  deckId: string;
  topic: string;
  startedAt: number;
  endedAt: number;
  answered: number;
  treats: number;
  longestWaitMs: number;
  guiltTrips: number;
}

export interface GuiltTripRecord {
  at: number;
  waitedMs: number;
}

export interface HistoryFile {
  sessions: SessionRecord[];
  guiltTrips: GuiltTripRecord[];
  treats: number;
}
