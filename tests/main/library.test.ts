import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLibrary, type Library } from '../../src/main/library';
import { createStorage, nodeFs } from '../../src/main/storage/io';
import { parseDeck } from '../../src/shared/deckParse';
import { newCard, review } from '../../src/shared/srs';

let dir: string;
let tick: number;
let ids: number;
const now = () => (tick += 1000);
const newId = () => `id${++ids}`;
const noSleep = () => Promise.resolve();

async function open(over: Parameters<typeof createStorage>[1] = {}): Promise<Library> {
  return createLibrary({ storage: createStorage(dir, { now, sleep: noSleep, ...over }), now, newId });
}
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
};
const code = (r: { ok: boolean; error?: { code: string } }): string | undefined => (r.ok ? undefined : r.error?.code);

beforeEach(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-lib-'));
  tick = 1_790_000_000_000;
  ids = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('opening', () => {
  it('a fresh folder opens empty with nothing to report', async () => {
    const lib = await open();
    expect(lib.listDecks()).toEqual([]);
    expect(lib.listSessions()).toEqual([]);
    expect(lib.notices()).toEqual([]);
    expect(lib.getSettings().cap).toBe(4);
  });

  it('what was saved is there after reopening', async () => {
    const a = await open();
    const deck = ok(await a.createDeck('French'));
    ok(await a.importInto(deck.id, 'chat,cat\nchien,dog'));
    const b = await open();
    expect(b.listDecks()).toEqual([{ id: deck.id, name: 'French', createdAt: deck.createdAt, cardCount: 2 }]);
  });

  it('a corrupt decks file is set aside, reported once, and the library still works', async () => {
    fs.writeFileSync(join(dir, 'decks.json'), '{"half');
    const lib = await open();
    expect(lib.listDecks()).toEqual([]);
    expect(lib.notices()).toEqual([expect.objectContaining({ store: 'decks', kind: 'recovered' })]);
    ok(await lib.createDeck('After'));
    expect((await open()).listDecks()).toHaveLength(1);
  });

  it('a decks file from a newer app is never touched: decks are unavailable, history still works', async () => {
    const text = JSON.stringify({ schemaVersion: 99, data: { decks: 'from the future' } });
    fs.writeFileSync(join(dir, 'decks.json'), text);
    const lib = await open();
    expect(lib.notices()).toEqual([expect.objectContaining({ store: 'decks', kind: 'unavailable' })]);
    expect(code(await lib.createDeck('Nope'))).toBe('store-unavailable');
    ok(await lib.recordSession({ deckId: 'x', topic: '', summary: summary() }));
    expect(fs.readFileSync(join(dir, 'decks.json'), 'utf8')).toBe(text);
  });
});

describe('decks', () => {
  it('creates decks in order, trimming the name', async () => {
    const lib = await open();
    const a = ok(await lib.createDeck('  Spanish  '));
    ok(await lib.createDeck('French'));
    expect(a).toMatchObject({ name: 'Spanish', cardCount: 0 });
    expect(lib.listDecks().map((d) => d.name)).toEqual(['Spanish', 'French']);
  });

  it('rejects an empty, overlong or duplicate name (ignoring case)', async () => {
    const lib = await open();
    ok(await lib.createDeck('Spanish'));
    expect(code(await lib.createDeck('   '))).toBe('invalid-name');
    expect(code(await lib.createDeck('x'.repeat(81)))).toBe('invalid-name');
    expect(code(await lib.createDeck(' spanish '))).toBe('duplicate-name');
    expect(lib.listDecks()).toHaveLength(1);
  });

  it('renames, allows changing only the case of its own name, and refuses another deck’s name', async () => {
    const lib = await open();
    const a = ok(await lib.createDeck('Spanish'));
    ok(await lib.createDeck('French'));
    expect(ok(await lib.renameDeck(a.id, 'SPANISH')).name).toBe('SPANISH');
    expect(code(await lib.renameDeck(a.id, 'french'))).toBe('duplicate-name');
    expect(code(await lib.renameDeck('nope', 'Anything'))).toBe('not-found');
    expect(lib.listDecks()[0]?.name).toBe('SPANISH');
  });

  it('delete returns an undo token that restores the deck, cards and place in the list', async () => {
    const lib = await open();
    ok(await lib.createDeck('One'));
    const two = ok(await lib.createDeck('Two'));
    ok(await lib.createDeck('Three'));
    ok(await lib.importInto(two.id, 'a,b\nc,d'));
    const undo = ok(await lib.deleteDeck(two.id));
    expect(lib.listDecks().map((d) => d.name)).toEqual(['One', 'Three']);
    ok(await lib.restoreDeck(undo));
    expect(lib.listDecks().map((d) => [d.name, d.cardCount])).toEqual([['One', 0], ['Two', 2], ['Three', 0]]);
    expect((await open()).listDecks().map((d) => d.name)).toEqual(['One', 'Two', 'Three']);
  });

  it('restoring twice, or into a name that has been taken since, is refused', async () => {
    const lib = await open();
    const a = ok(await lib.createDeck('Spanish'));
    const undo = ok(await lib.deleteDeck(a.id));
    ok(await lib.createDeck('spanish'));
    expect(code(await lib.restoreDeck(undo))).toBe('duplicate-name');
    const lib2 = await open();
    const b = lib2.listDecks()[0]!;
    const undo2 = ok(await lib2.deleteDeck(b.id));
    ok(await lib2.restoreDeck(undo2));
    expect(code(await lib2.restoreDeck(undo2))).toBe('already-exists');
  });

  it('deleting an unknown deck says so', async () => {
    expect(code(await (await open()).deleteDeck('nope'))).toBe('not-found');
  });
});

describe('import', () => {
  it('turns pasted text into a new deck and reports the rows it skipped', async () => {
    const lib = await open();
    const report = ok(await lib.importAsNewDeck('Capitals', 'France,Paris\nbroken line\nPeru,Lima'));
    expect(report).toMatchObject({ added: 2, duplicates: 0, skipped: [{ line: 2, reason: 'no-separator' }] });
    expect(lib.listDecks()).toEqual([expect.objectContaining({ id: report.deckId, name: 'Capitals', cardCount: 2 })]);
  });

  it('text with no valid rows creates nothing and returns the reasons', async () => {
    const lib = await open();
    const r = await lib.importAsNewDeck('Empty', 'no separator here\nnor here');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('no-valid-rows');
      expect(r.error.skipped).toHaveLength(2);
    }
    expect(lib.listDecks()).toEqual([]);
  });

  it('a bad name stops a new-deck import before anything is written', async () => {
    const lib = await open();
    expect(code(await lib.importAsNewDeck('', 'a,b'))).toBe('invalid-name');
    expect(lib.listDecks()).toEqual([]);
  });

  it('importing into a deck skips cards it already has, ignoring case and spacing', async () => {
    const lib = await open();
    const d = ok(await lib.createDeck('French'));
    ok(await lib.importInto(d.id, 'chat,cat'));
    const again = ok(await lib.importInto(d.id, ' Chat , CAT \nchien,dog\nchien,dog'));
    expect(again).toMatchObject({ added: 1, duplicates: 2 });
    expect(lib.listDecks()[0]?.cardCount).toBe(2);
  });

  it('imported cards are new, each with its own id', async () => {
    const lib = await open();
    const r = ok(await lib.importAsNewDeck('X', 'a,b\nc,d'));
    const cards = lib.getDeck(r.deckId)?.cards ?? [];
    expect(new Set(cards.map((c) => c.id)).size).toBe(2);
    expect(cards.every((c) => c.fsrs.state === 0 && c.fsrs.reps === 0)).toBe(true);
  });

  it('an unknown deck is not-found', async () => {
    expect(code(await (await open()).importInto('nope', 'a,b'))).toBe('not-found');
  });
});

describe('export', () => {
  it('exports a deck as CSV that reads back to the same cards', async () => {
    const lib = await open();
    const d = ok(await lib.importAsNewDeck('Tricky', '"Hello, world","a ""quoted"" answer"\nplain,text'));
    const out = ok(lib.exportDeck(d.deckId));
    expect(out.name).toBe('Tricky');
    expect(parseDeck(out.csv).cards).toEqual([
      { front: 'Hello, world', back: 'a "quoted" answer' },
      { front: 'plain', back: 'text' },
    ]);
  });

  it('an unknown deck is not-found', async () => {
    expect(code((await open()).exportDeck('nope'))).toBe('not-found');
  });
});

describe('reviews', () => {
  it('saves a reviewed card into its deck', async () => {
    const lib = await open();
    const d = ok(await lib.importAsNewDeck('X', 'a,b'));
    const card = lib.getDeck(d.deckId)!.cards[0]!;
    const after = review(card, 'good', tick + 5000);
    ok(await lib.updateCard(d.deckId, after));
    expect((await open()).getDeck(d.deckId)?.cards[0]?.fsrs.reps).toBe(1);
  });

  it('a card or deck that is gone is not-found, and nothing is written', async () => {
    const lib = await open();
    const d = ok(await lib.createDeck('X'));
    const stray = newCard('ghost', 'q', 'a', tick);
    expect(code(await lib.updateCard(d.id, stray))).toBe('not-found');
    expect(code(await lib.updateCard('nope', stray))).toBe('not-found');
  });
});

describe('cards', () => {
  async function deckWithCards() {
    const lib = await open();
    const d = ok(await lib.importAsNewDeck('French', 'chat,cat\nchien,dog\noiseau,bird'));
    return { lib, deckId: d.deckId };
  }

  it('lists a deck’s cards in order, as plain front and back', async () => {
    const { lib, deckId } = await deckWithCards();
    expect(ok(lib.listCards(deckId)).map((c) => [c.front, c.back])).toEqual([['chat', 'cat'], ['chien', 'dog'], ['oiseau', 'bird']]);
    expect(code(lib.listCards('nope'))).toBe('not-found');
  });

  it('adds a trimmed card as a new card at the end, and it survives reopening', async () => {
    const { lib, deckId } = await deckWithCards();
    const c = ok(await lib.addCard(deckId, '  cheval ', ' horse  '));
    expect(c).toMatchObject({ front: 'cheval', back: 'horse' });
    expect(lib.getDeck(deckId)?.cards.at(-1)).toMatchObject({ id: c.id, fsrs: { state: 0, reps: 0 } });
    expect(ok((await open()).listCards(deckId))).toHaveLength(4);
  });

  it('refuses empty, overlong and duplicate cards, and an unknown deck', async () => {
    const { lib, deckId } = await deckWithCards();
    expect(code(await lib.addCard(deckId, '  ', 'x'))).toBe('invalid-card');
    expect(code(await lib.addCard(deckId, 'x', ''))).toBe('invalid-card');
    expect(code(await lib.addCard(deckId, 'x'.repeat(2001), 'y'))).toBe('invalid-card');
    expect(code(await lib.addCard(deckId, ' CHAT ', 'Cat'))).toBe('duplicate-card');
    expect(code(await lib.addCard('nope', 'a', 'b'))).toBe('not-found');
    expect(ok(lib.listCards(deckId))).toHaveLength(3);
  });

  it('editing changes the words and keeps the review history and place', async () => {
    const { lib, deckId } = await deckWithCards();
    const target = lib.getDeck(deckId)!.cards[1]!;
    ok(await lib.updateCard(deckId, review(target, 'good', tick + 1)));
    const edited = ok(await lib.editCard(deckId, target.id, 'le chien', 'the dog'));
    expect(edited).toMatchObject({ id: target.id, front: 'le chien', back: 'the dog' });
    const after = lib.getDeck(deckId)!.cards;
    expect(after[1]).toMatchObject({ id: target.id, front: 'le chien' });
    expect(after[1]?.fsrs.reps).toBe(1);
    expect(after).toHaveLength(3);
  });

  it('editing refuses empty text, a duplicate of another card, and a missing card or deck; saving unchanged text is fine', async () => {
    const { lib, deckId } = await deckWithCards();
    const [a, b] = lib.getDeck(deckId)!.cards;
    expect(code(await lib.editCard(deckId, a!.id, '', 'x'))).toBe('invalid-card');
    expect(code(await lib.editCard(deckId, a!.id, b!.front, b!.back))).toBe('duplicate-card');
    ok(await lib.editCard(deckId, a!.id, a!.front, a!.back));
    expect(code(await lib.editCard(deckId, 'ghost', 'a', 'b'))).toBe('not-found');
    expect(code(await lib.editCard('nope', a!.id, 'a', 'b'))).toBe('not-found');
  });

  it('delete returns an undo token that restores the card, its history and its place', async () => {
    const { lib, deckId } = await deckWithCards();
    const middle = lib.getDeck(deckId)!.cards[1]!;
    ok(await lib.updateCard(deckId, review(middle, 'good', tick + 1)));
    const undo = ok(await lib.deleteCard(deckId, middle.id));
    expect(undo).toMatchObject({ deckId, index: 1 });
    expect(ok(lib.listCards(deckId)).map((c) => c.front)).toEqual(['chat', 'oiseau']);
    ok(await lib.restoreCard(undo));
    expect(ok(lib.listCards(deckId)).map((c) => c.front)).toEqual(['chat', 'chien', 'oiseau']);
    expect(lib.getDeck(deckId)!.cards[1]?.fsrs.reps).toBe(1);
  });

  it('restoring twice, into a deck that is gone, or over a duplicate that was added meanwhile is refused', async () => {
    const { lib, deckId } = await deckWithCards();
    const card = lib.getDeck(deckId)!.cards[0]!;
    const undo = ok(await lib.deleteCard(deckId, card.id));
    ok(await lib.addCard(deckId, card.front, card.back));
    expect(code(await lib.restoreCard(undo))).toBe('duplicate-card');
    const undo2 = ok(await lib.deleteCard(deckId, lib.getDeck(deckId)!.cards.at(-1)!.id));
    ok(await lib.restoreCard(undo2));
    expect(code(await lib.restoreCard(undo2))).toBe('already-exists');
    ok(await lib.deleteDeck(deckId));
    expect(code(await lib.restoreCard(undo))).toBe('not-found');
    expect(code(await lib.deleteCard('nope', 'x'))).toBe('not-found');
    expect(code(await lib.deleteCard(deckId, 'x'))).toBe('not-found');
  });
});

function summary(over: Partial<{ answered: number; treats: number; longestWaitMs: number; guilt: number[] }> = {}) {
  return {
    startedAt: 1_000,
    endedAt: 61_000,
    answered: over.answered ?? 3,
    treats: over.treats ?? 2,
    longestWaitMs: over.longestWaitMs ?? 130_000,
    guiltTrips: (over.guilt ?? [130_000]).map((waitedMs, i) => ({ at: 10_000 + i, waitedMs })),
  };
}

describe('history', () => {
  it('records a session, its guilt trips and treats, newest first, and keeps them across reopening', async () => {
    const lib = await open();
    const first = ok(await lib.recordSession({ deckId: 'd1', topic: 'Verbs', summary: summary() }));
    expect(first).toMatchObject({ deckId: 'd1', topic: 'Verbs', answered: 3, treats: 2, longestWaitMs: 130_000, guiltTrips: 1, startedAt: 1_000, endedAt: 61_000 });
    ok(await lib.recordSession({ deckId: 'd1', topic: '', summary: summary({ treats: 1, guilt: [] }) }));
    const again = await open();
    expect(again.listSessions().map((s) => s.treats)).toEqual([1, 2]);
    expect(again.history().treats).toBe(3);
    expect(again.history().guiltTrips).toEqual([{ at: 10_000, waitedMs: 130_000 }]);
  });

  it('the most recent guilt trip is available for the greeting', async () => {
    const lib = await open();
    expect(lib.lastGuiltMs()).toBeNull();
    ok(await lib.recordSession({ deckId: 'd', topic: '', summary: summary({ guilt: [150_000, 200_000] }) }));
    expect(lib.lastGuiltMs()).toBe(200_000);
  });
});

describe('failure and concurrency', () => {
  it('a write that fails reports it and leaves the library as it was', async () => {
    const lib = await open({ fs: { ...nodeFs, rename: () => Promise.reject(Object.assign(new Error('disk'), { code: 'EIO' })) } });
    expect(code(await lib.createDeck('Doomed'))).toBe('write-failed');
    expect(lib.listDecks()).toEqual([]);
  });

  it('twenty changes at once all land, and all survive reopening', async () => {
    const lib = await open();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => lib.createDeck(`Deck ${i}`)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(lib.listDecks()).toHaveLength(20);
    expect((await open()).listDecks()).toHaveLength(20);
  });

  it('the list a caller holds is a copy: changing it does not change the library', async () => {
    const lib = await open();
    ok(await lib.createDeck('Safe'));
    const list = lib.listDecks();
    list[0]!.name = 'Hacked';
    expect(lib.listDecks()[0]?.name).toBe('Safe');
  });
});
