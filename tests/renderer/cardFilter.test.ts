import { describe, expect, it } from 'vitest';
import { filterCards } from '../../src/renderer/control/cardFilter';

const cards = [
  { id: '1', front: 'café', back: 'coffee' },
  { id: '2', front: 'chat', back: 'cat' },
  { id: '3', front: 'Le Chien', back: 'the dog' },
];
const ids = (q: string) => filterCards(cards, q).map((c) => c.id);

describe('filterCards', () => {
  it('an empty or blank query keeps everything, as a copy', () => {
    expect(ids('')).toEqual(['1', '2', '3']);
    expect(ids('   ')).toEqual(['1', '2', '3']);
    expect(filterCards(cards, '')).not.toBe(cards);
  });

  it('matches either side, ignoring case and accents', () => {
    expect(ids('CAFE')).toEqual(['1']);
    expect(ids('dog')).toEqual(['3']);
    expect(ids('chien')).toEqual(['3']);
  });

  it('every word has to match, in any order and on either side', () => {
    expect(ids('dog le')).toEqual(['3']);
    expect(ids('chat dog')).toEqual([]);
    expect(ids('ca')).toEqual(['1', '2']);
  });

  it('no match gives an empty list', () => {
    expect(ids('zebra')).toEqual([]);
  });
});
