import { createEmptyCard, fsrs, generatorParameters, Rating, type Card as FsrsCard } from 'ts-fsrs';
import type { Card, FsrsState } from './model';

/** Hard = a close typo (fuzzy match), Good = right, Again = wrong or "Missed it". */
export type Grade = 'again' | 'hard' | 'good';

// Fuzzing off: scheduling is then a pure function of (card, grade, time).
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

const RATINGS = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good } as const;

const toFsrs = (s: FsrsState): FsrsCard => ({
  due: new Date(s.due),
  stability: s.stability,
  difficulty: s.difficulty,
  elapsed_days: 0, // deprecated and recomputed by ts-fsrs from last_review
  scheduled_days: s.scheduledDays,
  learning_steps: s.learningSteps,
  reps: s.reps,
  lapses: s.lapses,
  state: s.state,
  ...(s.lastReview === null ? {} : { last_review: new Date(s.lastReview) }),
});

const fromFsrs = (c: FsrsCard): FsrsState => ({
  due: c.due.getTime(),
  stability: c.stability,
  difficulty: c.difficulty,
  scheduledDays: c.scheduled_days,
  learningSteps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state,
  lastReview: c.last_review ? c.last_review.getTime() : null,
});

export function newCard(id: string, front: string, back: string, now: number): Card {
  return { id, front, back, createdAt: now, fsrs: fromFsrs(createEmptyCard(new Date(now))) };
}

/** The card after one review at `now`. The input is not changed. */
export function review(card: Card, grade: Grade, now: number): Card {
  const { card: next } = scheduler.next(toFsrs(card.fsrs), new Date(now), RATINGS[grade]);
  return { ...card, fsrs: fromFsrs(next) };
}

const NEW = 0;

/**
 * Which card to ask next: the most overdue due card, else the first new card in deck order, else the least
 * recently seen card (so a session never stalls). Null only for an empty deck.
 */
export function nextCard(deck: { cards: readonly Card[] }, now: number): Card | null {
  const cards = deck.cards;
  let due: Card | null = null;
  let firstNew: Card | null = null;
  let leastRecent: Card | null = null;
  for (const c of cards) {
    if (c.fsrs.state === NEW) {
      firstNew ??= c;
    } else if (c.fsrs.due <= now && (due === null || c.fsrs.due < due.fsrs.due)) {
      due = c;
    }
    if (leastRecent === null || (c.fsrs.lastReview ?? -Infinity) < (leastRecent.fsrs.lastReview ?? -Infinity)) leastRecent = c;
  }
  return due ?? firstNew ?? leastRecent;
}
