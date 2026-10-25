import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createControlHandlers, MAX_IMPORT_CHARS, safeFileName, type ControlHandlers, type FileAccess } from '../../src/main/controlHandlers';
import { createLibrary, type Library } from '../../src/main/library';
import { createSessionController, type SessionController } from '../../src/main/session';
import { createStorage } from '../../src/main/storage/io';
import type { LibrarySnapshot, Result } from '../../src/shared/control';

let dir: string;
let lib: Library;
let session: SessionController;
let h: ControlHandlers;
let picked: Result<{ name: string; text: string } | null>;
let saved: { name: string; csv: string }[];
let saveFails = false;
let trackerDown = false;
let leaveItConflict = false;
let ids = 0;

const files: FileAccess = {
  pickImport: () => Promise.resolve(picked),
  saveExport: (name, csv) => {
    if (saveFails) return Promise.reject(new Error('disk full'));
    saved.push({ name, csv });
    return Promise.resolve({ path: `C:\\out\\${name}` });
  },
};
const call = <T = unknown>(op: string, args?: unknown) => h.handle(op, args) as Promise<T>;
const ok = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r.value;
};

beforeEach(async () => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-handlers-'));
  ids = 0;
  saved = [];
  saveFails = false;
  trackerDown = false;
  leaveItConflict = false;
  picked = { ok: true, value: null };
  lib = await createLibrary({ storage: createStorage(dir), newId: () => `id${++ids}` });
  session = createSessionController({ library: lib, seed: 1, publish: () => undefined });
  h = createControlHandlers({ library: lib, session, files, status: () => ({ trackerDown, leaveItConflict: leaveItConflict, leaveItLabel: 'Ctrl+Alt+L' }) });
});
afterEach(() => {
  session.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('operations that do not exist', () => {
  it('reject instead of guessing', async () => {
    await expect(h.handle('deck:drop-everything', {})).rejects.toThrow(/unknown/);
    await expect(h.handle(42, {})).rejects.toThrow(/unknown/);
    await expect(h.handle(undefined, {})).rejects.toThrow(/unknown/);
  });
});

describe('malformed arguments', () => {
  const cases: [string, unknown][] = [
    ['deck:create', undefined],
    ['deck:create', { name: 5 }],
    ['deck:rename', { id: 'x' }],
    ['deck:rename', 'nope'],
    ['deck:delete', {}],
    ['deck:restore', { deck: { id: 1 }, index: 0 }],
    ['deck:restore', { deck: { id: 'a', name: 'n', createdAt: 1, cards: [] }, index: -1 }],
    ['deck:import-text', { deckId: 3, name: 'x', text: 'a,b' }],
    ['deck:import-text', { deckId: null, name: 'x' }],
    ['deck:import-file', { deckId: 7 }],
    ['deck:export', null],
    ['card:list', {}],
    ['card:add', { deckId: 'd', front: 'a' }],
    ['card:add', { deckId: 1, front: 'a', back: 'b' }],
    ['card:edit', { deckId: 'd', cardId: 'c', front: 'a' }],
    ['card:delete', { deckId: 'd' }],
    ['card:restore', { deckId: 'd', index: 0, card: { id: 5 } }],
    ['card:restore', { deckId: 'd', index: 1.5, card: {} }],
    ['session:start', { deckId: 'x' }],
    ['session:start', { deckId: 'x', topic: '', checkinMinMinutes: '1', checkinMaxMinutes: 2 }],
    ['session:answer', { grade: 'perfect' }],
    ['session:answer', {}],
    ['session:control', { action: 'explode' }],
    ['session:control', { action: 'stay-on' }],
  ];
  it.each(cases)('%s with %j is invalid-request', async (op, args) => {
    const r = await call<Result<unknown>>(op, args);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-request');
  });
});

describe('decks', () => {
  it('creates, renames, deletes and restores through the same results the library gives', async () => {
    const made = ok(await call<Result<{ id: string; name: string }>>('deck:create', { name: 'French' }));
    ok(await call('deck:rename', { id: made.id, name: 'Francais' }));
    const undo = ok(await call<Result<{ deck: unknown; index: number }>>('deck:delete', { id: made.id }));
    expect(lib.listDecks()).toEqual([]);
    ok(await call('deck:restore', undo));
    expect(lib.listDecks().map((d) => d.name)).toEqual(['Francais']);
  });

  it('an undo token that went through JSON still restores', async () => {
    const made = ok(await call<Result<{ id: string }>>('deck:create', { name: 'Deck' }));
    const undo = ok(await call<Result<unknown>>('deck:delete', { id: made.id }));
    ok(await call('deck:restore', JSON.parse(JSON.stringify(undo))));
    expect(lib.listDecks()).toHaveLength(1);
  });
});

describe('cards', () => {
  it('add, list, edit, delete and restore go through the library, including an undo token that went through JSON', async () => {
    const d = ok(await lib.createDeck('French'));
    const card = ok(await call<Result<{ id: string; front: string }>>('card:add', { deckId: d.id, front: 'chat', back: 'cat' }));
    expect(card.front).toBe('chat');
    ok(await call('card:edit', { deckId: d.id, cardId: card.id, front: 'le chat', back: 'the cat' }));
    expect(ok(await call<Result<{ front: string }[]>>('card:list', { deckId: d.id })).map((c) => c.front)).toEqual(['le chat']);
    const undo = ok(await call<Result<unknown>>('card:delete', { deckId: d.id, cardId: card.id }));
    expect(ok(await call<Result<unknown[]>>('card:list', { deckId: d.id }))).toEqual([]);
    ok(await call('card:restore', JSON.parse(JSON.stringify(undo))));
    expect(ok(await call<Result<unknown[]>>('card:list', { deckId: d.id }))).toHaveLength(1);
  });

  it('the deck a session is running on cannot be renamed, deleted or have its cards changed, but can still be read', async () => {
    const made = ok(await lib.importAsNewDeck('Live', 'a,b\nc,d'));
    const cardId = ok(lib.listCards(made.deckId))[0]!.id;
    const undo = ok(await lib.deleteCard(made.deckId, cardId));
    ok(session.start({ deckId: made.deckId, topic: '', checkinMinMinutes: 5, checkinMaxMinutes: 15 }));
    const blocked: [string, unknown][] = [
      ['deck:rename', { id: made.deckId, name: 'New' }],
      ['deck:delete', { id: made.deckId }],
      ['card:add', { deckId: made.deckId, front: 'x', back: 'y' }],
      ['card:edit', { deckId: made.deckId, cardId: 'c', front: 'x', back: 'y' }],
      ['card:delete', { deckId: made.deckId, cardId: 'c' }],
      ['card:restore', JSON.parse(JSON.stringify(undo))],
    ];
    for (const [op, args] of blocked) {
      const r = await call<Result<unknown>>(op, args);
      expect(r.ok, op).toBe(false);
      if (!r.ok) expect(r.error.code, op).toBe('deck-in-use');
    }
    expect(lib.listDecks()[0]?.name).toBe('Live');
    ok(await call('card:list', { deckId: made.deckId }));
    ok(await call('deck:import-text', { deckId: made.deckId, name: '', text: 'e,f' }));
    ok(await session.end());
    ok(await call('deck:rename', { id: made.deckId, name: 'Done' }));
  });
});

describe('import', () => {
  it('pasted text makes a new deck when no deck is named, or adds to one', async () => {
    const r = ok(await call<Result<{ deckId: string; added: number }>>('deck:import-text', { deckId: null, name: 'Pasted', text: 'a,b\nc,d' }));
    expect(r.added).toBe(2);
    const more = ok(await call<Result<{ added: number }>>('deck:import-text', { deckId: r.deckId, name: '', text: 'e,f' }));
    expect(more.added).toBe(1);
  });

  it('refuses text over the size limit before parsing it', async () => {
    const r = await call<Result<unknown>>('deck:import-text', { deckId: null, name: 'Big', text: 'a,b\n'.repeat(MAX_IMPORT_CHARS / 4 + 10) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('file-too-large');
    expect(lib.listDecks()).toEqual([]);
  });

  it('a picked file becomes a deck named after the file', async () => {
    picked = { ok: true, value: { name: 'spanish-verbs', text: 'hablar,to speak' } };
    const r = ok(await call<Result<{ added: number }>>('deck:import-file', { deckId: null }));
    expect(r).toMatchObject({ added: 1 });
    expect(lib.listDecks()[0]?.name).toBe('spanish-verbs');
  });

  it('a very long file name is cut to fit instead of failing the import', async () => {
    picked = { ok: true, value: { name: 'x'.repeat(200), text: 'a,b' } };
    ok(await call('deck:import-file', { deckId: null }));
    expect(lib.listDecks()[0]?.name).toHaveLength(80);
  });

  it('cancelling the dialog is a quiet success with nothing', async () => {
    picked = { ok: true, value: null };
    expect(await call('deck:import-file', { deckId: null })).toEqual({ ok: true, value: null });
    expect(lib.listDecks()).toEqual([]);
  });

  it('a file that could not be read passes its error through', async () => {
    picked = { ok: false, error: { code: 'file-unreadable', message: 'locked' } };
    const r = await call<Result<unknown>>('deck:import-file', { deckId: null });
    expect(r).toEqual(picked);
  });
});

describe('export', () => {
  it('saves a CSV under a safe file name and returns where', async () => {
    const d = ok(await lib.importAsNewDeck('What: is/this?', 'a,b'));
    const r = ok(await call<Result<{ path: string } | null>>('deck:export', { id: d.deckId }));
    expect(r?.path).toContain('What_ is_this_.csv');
    expect(saved[0]?.csv).toContain('a');
  });

  it('cancelling the save dialog is a quiet success', async () => {
    const d = ok(await lib.importAsNewDeck('X', 'a,b'));
    const files2: FileAccess = { ...files, saveExport: () => Promise.resolve(null) };
    const h2 = createControlHandlers({ library: lib, session, files: files2, status: () => ({ trackerDown: false, leaveItConflict: false, leaveItLabel: 'Ctrl+Alt+L' }) });
    expect(await h2.handle('deck:export', { id: d.deckId })).toEqual({ ok: true, value: null });
  });

  it('a write failure comes back as write-failed, not a thrown error', async () => {
    const d = ok(await lib.importAsNewDeck('X', 'a,b'));
    saveFails = true;
    const r = await call<Result<unknown>>('deck:export', { id: d.deckId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'write-failed', message: 'disk full' });
  });

  it('an unknown deck is not-found and no dialog is shown', async () => {
    const r = await call<Result<unknown>>('deck:export', { id: 'nope' });
    expect(r.ok).toBe(false);
    expect(saved).toEqual([]);
  });
});

describe('snapshot', () => {
  it('carries decks, sessions with their deck names, notices, defaults and the tracker state', async () => {
    const d = ok(await lib.importAsNewDeck('Capitals', 'a,b'));
    const gone = ok(await lib.importAsNewDeck('Gone', 'c,d'));
    const summary = { startedAt: 1, endedAt: 2, answered: 1, treats: 1, longestWaitMs: 0, guiltTrips: [] };
    ok(await lib.recordSession({ deckId: d.deckId, topic: 'T', summary }));
    ok(await lib.recordSession({ deckId: gone.deckId, topic: '', summary }));
    ok(await lib.deleteDeck(gone.deckId));
    trackerDown = true;
    leaveItConflict = true;
    const s = await call<LibrarySnapshot>('app:snapshot');
    expect(s.decks.map((x) => x.name)).toEqual(['Capitals']);
    expect(s.sessions.map((x) => x.deckName)).toEqual([null, 'Capitals']);
    expect(s.defaults).toEqual({ cap: 4, checkinMinMinutes: 5, checkinMaxMinutes: 15 });
    expect(s.trackerDown).toBe(true);
    expect(s.leaveItConflict).toBe(true);
    expect(s.leaveItLabel).toBe('Ctrl+Alt+L');
    expect(s.notices).toEqual([]);
  });
});

describe('session', () => {
  it('starts, reports the view, and ends through the handlers', async () => {
    const d = ok(await lib.importAsNewDeck('Capitals', 'a,b'));
    const started = ok(await call<Result<{ phase: string }>>('session:start', { deckId: d.deckId, topic: 'x', checkinMinMinutes: 5, checkinMaxMinutes: 15 }));
    expect(started.phase).toBe('running');
    expect(await call('session:view')).toMatchObject({ phase: 'running', deckName: 'Capitals' });
    ok(await call('session:control', { action: 'pause' }));
    const ended = ok(await call<Result<{ phase: string }>>('session:end'));
    expect(ended.phase).toBe('ended');
    await call('session:dismiss-summary');
    expect(await call('session:view')).toEqual({ phase: 'idle' });
  });
});

describe('safeFileName', () => {
  it.each([
    ['plain', 'plain'],
    ['a/b\\c:d', 'a_b_c_d'],
    ['trailing dots...', 'trailing dots'],
    ['   ', 'deck'],
    ['', 'deck'],
  ])('%j -> %j', (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });
});
