import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLibrary, type Library } from '../../src/main/library';
import { createStorage, nodeFs } from '../../src/main/storage/io';
import { parseDeck } from '../../src/shared/deckParse';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings';
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

describe('settings', () => {
  // The settings file as the app wrote it before the sound fields existed.
  const preM4Data = { cap: 3, preset: 'drama-queen', checkinMinMinutes: 7, checkinMaxMinutes: 20, excludedApps: ['zoom.exe'], leaveItHotkey: 'Ctrl+Alt+K' };
  const preM4 = JSON.stringify({ schemaVersion: 1, data: preM4Data });

  it('a settings.json from before M4 loads with every newer setting at its default and is not set aside', async () => {
    fs.writeFileSync(join(dir, 'settings.json'), preM4);
    const lib = await open();
    expect(lib.notices()).toEqual([]);
    expect(lib.getSettings()).toEqual({
      cap: 3,
      preset: 'drama-queen',
      checkinMinMinutes: 7,
      checkinMaxMinutes: 20,
      excludedApps: ['zoom.exe'],
      leaveItHotkey: 'Ctrl+Alt+K',
      soundOn: true,
      volume: 0.4,
      onboarded: false,
      reducedMotion: 'system',
      updateChecks: true,
      betaChannel: false,
      bubbleHotkey: 'Control+Alt+A',
    });
    expect(fs.readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(preM4);
    const backups = join(dir, 'backups');
    expect(fs.existsSync(backups) ? fs.readdirSync(backups).filter((f) => f.startsWith('settings')) : []).toEqual([]);
  });

  it('a fresh folder has the sound defaults', async () => {
    expect(await open().then((l) => l.getSettings())).toMatchObject({ soundOn: true, volume: 0.4 });
  });

  it('updateSettings saves and survives reopening', async () => {
    fs.writeFileSync(join(dir, 'settings.json'), preM4);
    const a = await open();
    const saved = ok(await a.updateSettings({ soundOn: false, volume: 0.9 }));
    expect(saved).toMatchObject({ soundOn: false, volume: 0.9, cap: 3, leaveItHotkey: 'Ctrl+Alt+K' });
    expect(a.getSettings()).toEqual(saved);
    const b = await open();
    expect(b.notices()).toEqual([]);
    expect(b.getSettings()).toMatchObject({ soundOn: false, volume: 0.9, cap: 3, excludedApps: ['zoom.exe'] });
  });

  it('updateSettings changes only what the patch names', async () => {
    const lib = await open();
    ok(await lib.updateSettings({ volume: 0.65 }));
    expect(lib.getSettings()).toMatchObject({ soundOn: true, volume: 0.65, cap: 4 });
    ok(await lib.updateSettings({ soundOn: false }));
    expect(lib.getSettings()).toMatchObject({ soundOn: false, volume: 0.65 });
  });

  it('updateSettings refuses volume 1.5, -0.1 and a non-boolean soundOn, and keeps what was saved', async () => {
    const lib = await open();
    ok(await lib.updateSettings({ volume: 0.65 }));
    expect(code(await lib.updateSettings({ volume: 1.5 }))).toBe('invalid-request');
    expect(code(await lib.updateSettings({ volume: -0.1 }))).toBe('invalid-request');
    expect(code(await lib.updateSettings({ volume: Number.NaN }))).toBe('invalid-request');
    expect(code(await lib.updateSettings({ soundOn: 'yes' as unknown as boolean }))).toBe('invalid-request');
    expect(code(await lib.updateSettings({ cap: 9 as unknown as 2 }))).toBe('invalid-request');
    expect(lib.getSettings()).toMatchObject({ soundOn: true, volume: 0.65 });
    expect((await open()).getSettings()).toMatchObject({ soundOn: true, volume: 0.65 });
  });

  it('updateSettings refuses a whole that is not usable and keeps what was saved', async () => {
    const lib = await open();
    ok(await lib.updateSettings({ cap: 3 }));
    for (const bad of [{ preset: 'x' }, { checkinMinMinutes: 30, checkinMaxMinutes: 10 }, { checkinMaxMinutes: 241 }, { leaveItHotkey: 'Control+Alt+A' }, { bubbleHotkey: 'L' }]) {
      expect(code(await lib.updateSettings(bad as Partial<Settings>)), JSON.stringify(bad)).toBe('invalid-request');
    }
    expect(lib.getSettings()).toMatchObject({ cap: 3, preset: 'classic', checkinMinMinutes: 5, checkinMaxMinutes: 15 });
  });

  it('updateSettings stores excluded apps in their normal form', async () => {
    const lib = await open();
    expect(ok(await lib.updateSettings({ excludedApps: ['Game.EXE', ' game.exe', ''] })).excludedApps).toEqual(['game.exe']);
  });

  it('updateSettings ignores a field that is not a setting', async () => {
    const lib = await open();
    ok(await lib.updateSettings({ volume: 0.9, extra: 1 } as Partial<Settings>));
    expect(Object.keys(lib.getSettings())).not.toContain('extra');
    const onDisk = JSON.parse(fs.readFileSync(join(dir, 'settings.json'), 'utf8')) as { data: Record<string, unknown> };
    expect(Object.keys(onDisk.data)).not.toContain('extra');
  });

  it('a settings file with a sound field of the wrong type is set aside like any other bad file', async () => {
    fs.writeFileSync(join(dir, 'settings.json'), JSON.stringify({ schemaVersion: 1, data: { ...preM4Data, volume: 7 } }));
    const lib = await open();
    expect(lib.notices()).toEqual([expect.objectContaining({ store: 'settings', kind: 'recovered' })]);
    expect(lib.getSettings()).toMatchObject({ soundOn: true, volume: 0.4 });
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

describe('whole-data backup', () => {
  interface Bundle {
    app: string;
    kind: string;
    exportedAt: string;
    stores: Record<string, { schemaVersion: number; data: unknown }>;
  }
  const FIXTURE = join(__dirname, '..', 'fixtures', 'backups', 'v1-export.json');

  async function populated(): Promise<Library> {
    const lib = await open();
    const deck = ok(await lib.createDeck('French'));
    ok(await lib.importInto(deck.id, 'chat,cat\nchien,dog'));
    ok(await lib.recordSession({ deckId: deck.id, topic: 'Verbs', summary: summary() }));
    ok(await lib.updateSettings({ cap: 3, preset: 'calm', onboarded: true }));
    return lib;
  }
  const stateOf = (lib: Library) => ({
    decks: lib.listDecks().map((d) => lib.getDeck(d.id)),
    sessions: lib.listSessions(),
    settings: lib.getSettings(),
    history: lib.history(),
  });
  const filesOf = () => ['decks', 'settings', 'history'].map((n) => (fs.existsSync(join(dir, `${n}.json`)) ? fs.readFileSync(join(dir, `${n}.json`), 'utf8') : null));
  const backupFiles = () => (fs.existsSync(join(dir, 'backups')) ? fs.readdirSync(join(dir, 'backups')) : []);
  const edited = (json: string, edit: (b: Bundle) => void): string => {
    const b = JSON.parse(json) as Bundle;
    edit(b);
    return JSON.stringify(b);
  };

  it('exports a bundle that names the app and carries all three stores', async () => {
    const b = JSON.parse(ok((await populated()).exportAll())) as Bundle;
    expect(b).toMatchObject({ app: 'barkstudy', kind: 'backup' });
    expect(Object.keys(b.stores).sort()).toEqual(['decks', 'history', 'settings']);
    expect(b.stores['settings']).toMatchObject({ schemaVersion: 1, data: { cap: 3, onboarded: true } });
  });

  it('exporting then replacing gives back exactly what was exported, now and after reopening', async () => {
    const lib = await populated();
    const before = stateOf(lib);
    const json = ok(lib.exportAll());
    ok(await lib.createDeck('Extra'));
    ok(await lib.updateSettings({ cap: 2, onboarded: false }));
    ok(await lib.replaceAll(json));
    expect(stateOf(lib)).toEqual(before);
    expect(stateOf(await open())).toEqual(before);
  });

  it('refuses to export while a store is unavailable, so a blank is never passed off as the user data', async () => {
    fs.writeFileSync(join(dir, 'decks.json'), JSON.stringify({ schemaVersion: 99, data: {} }));
    expect(code((await open()).exportAll())).toBe('store-unavailable');
  });

  it.each<[string, string, (b: Bundle) => void, string]>([
    ['a bundle missing the history store', 'not-a-backup', (b) => void delete b.stores['history'], ''],
    ['a store that fails validation', 'not-a-backup', (b) => void (b.stores['history']!.data = { sessions: 'x' }), ''],
    ['settings that are valid on disk but not usable (both shortcuts the same)', 'not-a-backup', (b) => void (b.stores['settings']!.data = { ...(b.stores['settings']!.data as object), leaveItHotkey: 'Ctrl+Alt+A' }), ''],
    ['a file from another kind of export', 'not-a-backup', (b) => void (b.kind = 'deck'), ''],
    ['a store written by a newer app', 'newer-version', (b) => void (b.stores['settings']!.schemaVersion = 99), ''],
  ])('refuses %s and changes nothing', async (_name, expected, edit) => {
    const lib = await populated();
    const good = ok(lib.exportAll());
    ok(await lib.updateSettings({ cap: 2 }));
    const before = stateOf(lib);
    const files = filesOf();
    const backupsBefore = backupFiles();
    expect(code(await lib.replaceAll(edited(good, edit)))).toBe(expected);
    expect(stateOf(lib)).toEqual(before);
    expect(filesOf()).toEqual(files);
    expect(backupFiles()).toEqual(backupsBefore);
  });

  it.each([['truncated JSON', '{"app":"barkstudy"'], ['a JSON array', '[]'], ['a deck CSV', 'chat,cat\nchien,dog'], ['nothing', '']])('refuses %s', async (_name, text) => {
    const lib = await populated();
    const before = stateOf(lib);
    expect(code(await lib.replaceAll(text))).toBe('not-a-backup');
    expect(stateOf(lib)).toEqual(before);
  });

  it('copies each current file into backups/ before it overwrites it', async () => {
    const lib = await populated();
    const json = ok(lib.exportAll());
    ok(await lib.replaceAll(json));
    for (const name of ['decks', 'settings', 'history']) {
      expect(backupFiles().some((f) => f.startsWith(`${name}.before-replace-v1-`)), name).toBe(true);
    }
  });

  it('brings back a store that opened unavailable, keeps its unreadable file in backups/, and drops its notice', async () => {
    const future = JSON.stringify({ schemaVersion: 99, data: { decks: 'from the future' } });
    const good = ok((await populated()).exportAll());
    fs.writeFileSync(join(dir, 'decks.json'), future);
    const lib = await open();
    expect(lib.notices()).toEqual([expect.objectContaining({ store: 'decks', kind: 'unavailable' })]);
    ok(await lib.replaceAll(good));
    expect(lib.notices()).toEqual([]);
    ok(await lib.createDeck('Works again'));
    expect(backupFiles().some((f) => f.startsWith('decks.before-replace-v99-'))).toBe(true);
    expect(fs.readFileSync(join(dir, 'backups', backupFiles().find((f) => f.startsWith('decks.before-replace-v99-'))!), 'utf8')).toBe(future);
  });

  it('reset leaves no decks or history, default settings with onboarding to do, and backups of what was there', async () => {
    const lib = await populated();
    ok(await lib.resetAll());
    expect(lib.listDecks()).toEqual([]);
    expect(lib.listSessions()).toEqual([]);
    expect(lib.history()).toEqual({ sessions: [], guiltTrips: [], treats: 0 });
    expect(lib.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(backupFiles().some((f) => f.startsWith('decks.before-replace-v1-'))).toBe(true);
    expect(stateOf(await open())).toEqual(stateOf(lib));
  });

  it('a write that fails part way says part of the data was replaced, and names what', async () => {
    const lib = await populated();
    const json = ok(lib.exportAll());
    let renames = 0;
    const flaky = await open({ fs: { ...nodeFs, rename: (a, b) => (++renames > 1 ? Promise.reject(Object.assign(new Error('disk'), { code: 'EIO' })) : nodeFs.rename(a, b)) } });
    const r = await flaky.replaceAll(json);
    expect(code(r)).toBe('partly-replaced');
    expect(r.ok ? '' : r.error.message).toContain('decks');
  });

  it('a save that fails on the very first store is a plain write-failed, because nothing was replaced', async () => {
    const lib = await populated();
    const json = ok(lib.exportAll());
    const before = stateOf(lib);
    const flaky = await open({ fs: { ...nodeFs, rename: () => Promise.reject(Object.assign(new Error('disk'), { code: 'EIO' })) } });
    expect(code(await flaky.replaceAll(json))).toBe('write-failed');
    expect(stateOf(await open())).toEqual(before);
  });

  it('a backup that cannot be made stops everything before any store is overwritten', async () => {
    const lib = await populated();
    const json = ok(lib.exportAll());
    ok(await lib.createDeck('Added after the export'));
    let blocked = false;
    const guarded = await open({
      fs: { ...nodeFs, readFile: (p) => (blocked && p.endsWith('settings.json') ? Promise.reject(Object.assign(new Error('locked'), { code: 'EPERM' })) : nodeFs.readFile(p)) },
    });
    const before = stateOf(guarded);
    const files = filesOf();
    blocked = true;
    expect(code(await guarded.replaceAll(json))).toBe('write-failed');
    expect(stateOf(guarded)).toEqual(before);
    expect(filesOf()).toEqual(files);
  });

  it('many restores and resets in a row never push out the data that was there first', async () => {
    const lib = await populated();
    ok(await lib.resetAll());
    for (let i = 0; i < 7; i++) {
      ok(await lib.createDeck(`Scratch ${i}`));
      ok(await lib.resetAll());
    }
    const kept = backupFiles().filter((f) => f.startsWith('decks.before-replace-'));
    expect(kept.some((f) => fs.readFileSync(join(dir, 'backups', f), 'utf8').includes('French'))).toBe(true);
  });

  it('resetting a library that is already empty does not spend a backup on nothing', async () => {
    const lib = await open();
    ok(await lib.createDeck('One'));
    ok(await lib.resetAll());
    const count = backupFiles().length;
    ok(await lib.resetAll());
    expect(backupFiles()).toHaveLength(count);
  });

  it('restore and reset backups are not what a damaged file is repaired from', async () => {
    const lib = await populated();
    ok(await lib.resetAll());
    fs.writeFileSync(join(dir, 'decks.json'), '{"half');
    const reopened = await open();
    expect(reopened.notices()).toEqual([expect.objectContaining({ store: 'decks', kind: 'recovered' })]);
    expect(reopened.listDecks()).toEqual([]);
  });

  it('the committed v1 backup still imports', async () => {
    const lib = await open();
    ok(await lib.replaceAll(fs.readFileSync(FIXTURE, 'utf8')));
    expect(lib.listDecks().map((d) => d.name)).toEqual(['French']);
    expect(lib.listSessions()).toHaveLength(1);
    expect(lib.getSettings()).toMatchObject({ cap: 3, preset: 'calm', onboarded: true });
  });

  it.runIf(process.env['WRITE_FIXTURES'] === '1')('regenerates the committed v1 backup (run once when the shape is meant to change)', async () => {
    fs.mkdirSync(join(__dirname, '..', 'fixtures', 'backups'), { recursive: true });
    fs.writeFileSync(FIXTURE, ok((await populated()).exportAll()));
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
