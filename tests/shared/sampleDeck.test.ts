import { describe, expect, it } from 'vitest';
import { parseDeck } from '../../src/shared/deckParse';
import { SAMPLE_DECK } from '../../src/shared/sampleDeck';

describe('the starter deck', () => {
  const parsed = parseDeck(SAMPLE_DECK.text);

  it('reads cleanly: about a dozen cards and no skipped rows', () => {
    expect(parsed.skipped).toEqual([]);
    expect(parsed.cards.length).toBeGreaterThanOrEqual(10);
    expect(parsed.cards.length).toBeLessThanOrEqual(15);
  });

  it('has no repeated fronts, and every answer is short enough to type', () => {
    const fronts = parsed.cards.map((c) => c.front.toLowerCase());
    expect(new Set(fronts).size).toBe(fronts.length);
    for (const c of parsed.cards) expect(c.back.length, c.back).toBeLessThanOrEqual(30);
  });

  it('has a name a deck can have', () => {
    expect(SAMPLE_DECK.name.length).toBeGreaterThan(0);
    expect(SAMPLE_DECK.name.length).toBeLessThanOrEqual(80);
  });
});
