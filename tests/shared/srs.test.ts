import { describe, expect, it } from 'vitest';
import type { Card } from '../../src/shared/model';
import { newCard, nextCard, review } from '../../src/shared/srs';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

const fresh = (n: number, now = T0): Card[] => Array.from({ length: n }, (_, i) => newCard(`c${i}`, `front ${i}`, `back ${i}`, now));
const deck = (cards: Card[]) => ({ cards });

/** Reviews a new card "Good" at each due time until it leaves the learning steps. */
function graduate(card: Card): Card {
  let c = card;
  for (let i = 0; i < 6 && c.fsrs.state !== 2; i++) c = review(c, 'good', c.fsrs.due);
  return c;
}

describe('newCard', () => {
  it('is a New card due now', () => {
    const c = newCard('x', 'q', 'a', T0);
    expect(c).toMatchObject({ id: 'x', front: 'q', back: 'a', createdAt: T0 });
    expect(c.fsrs).toMatchObject({ state: 0, reps: 0, lapses: 0, lastReview: null, due: T0 });
  });
});

describe('review', () => {
  it('Again on a new card brings it back within the next check-in window', () => {
    const c = review(fresh(1)[0]!, 'again', T0);
    expect(c.fsrs.due - T0).toBeGreaterThanOrEqual(MIN);
    expect(c.fsrs.due - T0).toBeLessThanOrEqual(10 * MIN);
    expect(c.fsrs.lastReview).toBe(T0);
    expect(c.fsrs.reps).toBe(1);
  });

  it('a card that keeps getting Good leaves the learning steps and is scheduled days out', () => {
    const c = graduate(fresh(1)[0]!);
    expect(c.fsrs.state).toBe(2);
    expect(c.fsrs.due - (c.fsrs.lastReview ?? 0)).toBeGreaterThanOrEqual(DAY);
  });

  it('Again < Hard < Good for the next due date of a mature card', () => {
    const mature = graduate(fresh(1)[0]!);
    const at = mature.fsrs.due;
    const due = (g: 'again' | 'hard' | 'good') => review(mature, g, at).fsrs.due;
    expect(due('again')).toBeLessThan(due('hard'));
    expect(due('hard')).toBeLessThan(due('good'));
  });

  it('Again on a mature card counts a lapse', () => {
    const mature = graduate(fresh(1)[0]!);
    expect(review(mature, 'again', mature.fsrs.due).fsrs.lapses).toBe(mature.fsrs.lapses + 1);
  });

  it('does not mutate the card it was given, and the result survives JSON', () => {
    const c = fresh(1)[0]!;
    const frozen = JSON.stringify(c);
    const r = review(c, 'good', T0);
    expect(JSON.stringify(c)).toBe(frozen);
    expect(r).not.toBe(c);
    const again = review(JSON.parse(JSON.stringify(r)) as Card, 'good', r.fsrs.due);
    expect(again.fsrs.reps).toBe(2);
  });

  it('is deterministic for a fixed time', () => {
    const c = graduate(fresh(1)[0]!);
    expect(review(c, 'good', c.fsrs.due)).toEqual(review(c, 'good', c.fsrs.due));
  });
});

describe('nextCard', () => {
  it('an empty deck has no next card', () => {
    expect(nextCard(deck([]), T0)).toBeNull();
  });

  it('a new deck serves its new cards in deck order', () => {
    let cards = fresh(3);
    expect(nextCard(deck(cards), T0)?.id).toBe('c0');
    cards = [review(cards[0]!, 'good', T0), cards[1]!, cards[2]!];
    expect(nextCard(deck(cards), T0)?.id).toBe('c1');
  });

  it('Again re-queues the card ahead of new cards by the next check-in', () => {
    const cards = fresh(3);
    const asked = [review(cards[0]!, 'again', T0), cards[1]!, cards[2]!];
    expect(nextCard(deck(asked), T0 + 15 * MIN)?.id).toBe('c0');
  });

  it('a card that is not due yet does not jump the queue', () => {
    const cards = fresh(2);
    const asked = [review(cards[0]!, 'good', T0), cards[1]!];
    expect(nextCard(deck(asked), T0)?.id).toBe('c1');
  });

  it('due cards come before new cards, most overdue first', () => {
    const a = review(newCard('a', 'a', 'a', T0), 'again', T0); // due T0 + ~1 min
    const b = review(newCard('b', 'b', 'b', T0), 'again', T0 + 5 * MIN); // due later
    const newOne = newCard('n', 'n', 'n', T0);
    expect(nextCard(deck([newOne, b, a]), T0 + 3 * DAY)?.id).toBe('a');
    expect(nextCard(deck([newOne, a]), T0 + 3 * DAY)?.id).toBe('a');
  });

  it('with nothing due and nothing new it serves the least recently seen card, so a session never stalls', () => {
    const a = graduate(newCard('a', 'a', 'a', T0));
    const b = review(graduate(newCard('b', 'b', 'b', T0 + DAY)), 'good', T0 + 30 * DAY);
    const now = Math.min(a.fsrs.due, b.fsrs.due) - 1; // neither is due yet
    expect(a.fsrs.lastReview).toBeLessThan(b.fsrs.lastReview ?? 0);
    expect(nextCard(deck([b, a]), now)?.id).toBe('a');
  });

  it('is deterministic and does not mutate the deck', () => {
    const d = deck(fresh(4));
    const frozen = JSON.stringify(d);
    expect(nextCard(d, T0)).toEqual(nextCard(d, T0));
    expect(JSON.stringify(d)).toBe(frozen);
  });
});
