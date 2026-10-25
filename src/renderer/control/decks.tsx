import { useId, useRef, useState, type FormEvent } from 'react';
import type { DeckSummary, LibrarySnapshot } from '../../shared/control';
import { api, attempt } from './api';
import { CardsView } from './cards';
import { ImportDialog } from './import-dialog';
import { useToast } from './toast';
import { errorText, importMessage, plural } from './text';

export function DecksView({
  snapshot,
  refresh,
  study,
  runningDeckId,
}: {
  snapshot: LibrarySnapshot;
  refresh: () => Promise<void>;
  study: (deckId: string) => void;
  /** The deck a live session is using; it cannot be renamed or deleted underneath it. */
  runningDeckId: string | null;
}) {
  const toast = useToast();
  const { decks } = snapshot;
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ deckId: string | null } | null>(null);
  const [openDeckId, setOpenDeckId] = useState<string | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const createId = useId();
  const renameId = useId();

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault();
    const r = await attempt(api.call('deck:create', { name: newName }));
    if (!r.ok) {
      setCreateError(errorText(r.error));
      return;
    }
    setCreating(false);
    setNewName('');
    setCreateError(null);
    toast(`Created the deck “${r.value.name}”.`);
    await refresh();
    newButton.current?.focus();
  }

  async function rename(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!renaming) return;
    const r = await attempt(api.call('deck:rename', { id: renaming.id, name: renaming.name }));
    if (!r.ok) {
      setRenameError(errorText(r.error));
      return;
    }
    setRenaming(null);
    setRenameError(null);
    toast(`Renamed to “${r.value.name}”.`);
    await refresh();
  }

  async function remove(deck: DeckSummary): Promise<void> {
    const r = await attempt(api.call('deck:delete', { id: deck.id }));
    if (!r.ok) {
      toast(errorText(r.error), { kind: 'error' });
      return;
    }
    await refresh();
    const token = r.value;
    toast(`Deleted “${deck.name}” (${plural(deck.cardCount, 'card')}).`, {
      action: {
        label: 'Undo',
        run: () => {
          void (async () => {
            const back = await attempt(api.call('deck:restore', token));
            if (back.ok) toast(`Restored “${deck.name}”.`);
            else toast(errorText(back.error), { kind: 'error' });
            await refresh();
          })();
        },
      },
    });
  }

  async function exportDeck(deck: DeckSummary): Promise<void> {
    const r = await attempt(api.call('deck:export', { id: deck.id }));
    if (!r.ok) toast(errorText(r.error), { kind: 'error' });
    else if (r.value) toast(`Exported “${deck.name}” to ${r.value.path}.`);
  }

  const dialog = importing && (
    <ImportDialog
      decks={decks}
      initialDeckId={importing.deckId}
      onClose={() => setImporting(null)}
      onImported={(report, deckName) => {
        toast(importMessage(report, deckName));
        void refresh();
      }}
    />
  );

  const openDeck = decks.find((d) => d.id === openDeckId);
  if (openDeck) {
    return (
      <>
        <CardsView
          deck={openDeck}
          inUse={openDeck.id === runningDeckId}
          onBack={() => setOpenDeckId(null)}
          refresh={refresh}
          onImport={() => setImporting({ deckId: openDeck.id })}
        />
        {dialog}
      </>
    );
  }

  return (
    <section aria-labelledby="decks-title">
      <header className="page-head">
        <h1 id="decks-title">Decks</h1>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setImporting({ deckId: null })}>
            Import cards…
          </button>
          <button
            type="button"
            className="btn btn-primary"
            ref={newButton}
            onClick={() => {
              setCreating(true);
              setCreateError(null);
            }}
          >
            New deck
          </button>
        </div>
      </header>

      {creating && (
        <form className="inline-form" onSubmit={(e) => void create(e)}>
          <label htmlFor={createId}>Deck name</label>
          <input
            id={createId}
            type="text"
            value={newName}
            maxLength={80}
            autoFocus
            autoComplete="off"
            aria-invalid={createError ? true : undefined}
            aria-describedby={createError ? `${createId}-err` : undefined}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
          />
          <button type="submit" className="btn btn-primary" disabled={newName.trim() === ''}>
            Create
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setCreating(false)}>
            Cancel
          </button>
          {createError && (
            <p id={`${createId}-err`} className="field-error" role="alert">
              {createError}
            </p>
          )}
        </form>
      )}

      {decks.length === 0 && !creating ? (
        <div className="empty">
          <h2>No decks yet</h2>
          <p className="muted">A deck is a set of flashcards. Start an empty one, or bring in cards from a spreadsheet, Quizlet or Anki.</p>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              New deck
            </button>
            <button type="button" className="btn" onClick={() => setImporting({ deckId: null })}>
              Import cards…
            </button>
          </div>
        </div>
      ) : (
        <ul className="rows">
          {decks.map((d) => {
            const inUse = d.id === runningDeckId;
            return (
              <li key={d.id} className="row">
                {renaming?.id === d.id ? (
                  <form className="inline-form grow" onSubmit={(e) => void rename(e)}>
                    <label htmlFor={renameId} className="sr-only">
                      New name for {d.name}
                    </label>
                    <input
                      id={renameId}
                      type="text"
                      value={renaming.name}
                      maxLength={80}
                      autoFocus
                      autoComplete="off"
                      aria-invalid={renameError ? true : undefined}
                      onChange={(e) => setRenaming({ id: d.id, name: e.target.value })}
                      onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                    />
                    <button type="submit" className="btn btn-primary" disabled={renaming.name.trim() === '' || renaming.name.trim() === d.name}>
                      Save
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                    {renameError && (
                      <p className="field-error" role="alert">
                        {renameError}
                      </p>
                    )}
                  </form>
                ) : (
                  <div className="grow">
                    <div className="row-title">{d.name}</div>
                    <div className="muted">
                      {plural(d.cardCount, 'card')}
                      {inUse && ' · in use by the running session'}
                    </div>
                  </div>
                )}
                <div className="actions">
                  <button type="button" className="btn btn-quiet" onClick={() => setOpenDeckId(d.id)}>
                    Cards
                  </button>
                  <button type="button" className="btn btn-quiet" disabled={d.cardCount === 0} title={d.cardCount === 0 ? 'Add cards first' : undefined} onClick={() => study(d.id)}>
                    Study
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => setImporting({ deckId: d.id })}>
                    Import
                  </button>
                  <button type="button" className="btn btn-quiet" disabled={d.cardCount === 0} onClick={() => void exportDeck(d)}>
                    Export
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={inUse}
                    title={inUse ? 'End the session first' : undefined}
                    onClick={() => {
                      setRenaming({ id: d.id, name: d.name });
                      setRenameError(null);
                    }}
                  >
                    Rename
                  </button>
                  <button type="button" className="btn btn-quiet btn-danger" disabled={inUse} title={inUse ? 'End the session first' : undefined} onClick={() => void remove(d)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog}
    </section>
  );
}
