import type { ViewCard } from '../../shared/control';

export const PAGE_SIZE = 100;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Cards whose front or back contains every word of the query, ignoring case and accents. An empty query keeps all. */
export function filterCards(cards: readonly ViewCard[], query: string): ViewCard[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...cards];
  return cards.filter((c) => {
    const text = `${fold(c.front)}\n${fold(c.back)}`;
    return words.every((w) => text.includes(w));
  });
}
