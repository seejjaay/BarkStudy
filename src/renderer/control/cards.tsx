import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MAX_CARD_TEXT, type DeckSummary, type ViewCard } from '../../shared/control';
import { COMMON as C, DECKS } from '../../shared/i18n/en';
import { api, attempt } from './api';
import { PAGE_SIZE, filterCards } from './cardFilter';
import { errorText } from './text';
import { useToast } from './toast';

const T = DECKS.cards;

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; cards: ViewCard[] };

/** Ctrl+Enter submits from inside a text area, since plain Enter has to make a new line. */
const submitOnCtrlEnter = (submit: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    submit();
  }
};

export function CardsView({
  deck,
  inUse,
  onBack,
  refresh,
  onImport,
}: {
  deck: DeckSummary;
  /** A running session has this deck, so its cards are read-only. */
  inUse: boolean;
  onBack: () => void;
  refresh: () => Promise<void>;
  onImport: () => void;
}) {
  const toast = useToast();
  const ids = { front: useId(), back: useId(), search: useId() };
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [editing, setEditing] = useState<{ id: string; front: string; back: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const frontField = useRef<HTMLTextAreaElement>(null);

  const reload = useCallback(async () => {
    const r = await attempt(api.call('card:list', { deckId: deck.id }));
    setLoad(r.ok ? { status: 'ready', cards: r.value } : { status: 'error', message: errorText(r.error) });
  }, [deck.id]);

  useEffect(() => heading.current?.focus(), []);
  // Loads on open, and again whenever the deck's card count changes (adding, deleting, restoring or importing).
  useEffect(() => {
    void reload();
  }, [deck.cardCount, reload]);

  async function add(e?: FormEvent): Promise<void> {
    e?.preventDefault();
    if (front.trim() === '' || back.trim() === '') return;
    const r = await attempt(api.call('card:add', { deckId: deck.id, front, back }));
    if (!r.ok) {
      setAddError(errorText(r.error));
      return;
    }
    setAddError(null);
    setFront('');
    setBack('');
    toast(T.added(r.value.front));
    frontField.current?.focus();
    await refresh();
  }

  async function save(e?: FormEvent): Promise<void> {
    e?.preventDefault();
    if (!editing) return;
    const r = await attempt(api.call('card:edit', { deckId: deck.id, cardId: editing.id, front: editing.front, back: editing.back }));
    if (!r.ok) {
      setEditError(errorText(r.error));
      return;
    }
    setEditing(null);
    setEditError(null);
    toast(T.saved);
    await reload();
  }

  async function remove(card: ViewCard): Promise<void> {
    const r = await attempt(api.call('card:delete', { deckId: deck.id, cardId: card.id }));
    if (!r.ok) {
      toast(errorText(r.error), { kind: 'error' });
      return;
    }
    await refresh();
    const undo = r.value;
    toast(T.deleted(card.front), {
      action: {
        label: C.undo,
        run: () => {
          void (async () => {
            const back = await attempt(api.call('card:restore', undo));
            if (back.ok) toast(T.restored(card.front));
            else toast(errorText(back.error), { kind: 'error' });
            await refresh();
          })();
        },
      },
    });
  }

  const matches = load.status === 'ready' ? filterCards(load.cards, query) : [];

  return (
    <section aria-labelledby="cards-title">
      <header className="page-head">
        <div>
          <button type="button" className="btn btn-quiet" onClick={onBack}>
            {T.allDecks}
          </button>
          <h1 id="cards-title" tabIndex={-1} ref={heading}>
            {deck.name}
          </h1>
          <p className="muted">{C.cards(deck.cardCount)}</p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={onImport}>
            {DECKS.importCards}
          </button>
        </div>
      </header>

      {inUse && (
        <div className="banner banner-warn" role="status">
          <span>
            <strong>{T.inUseLead}</strong> {T.inUseBody}
          </span>
        </div>
      )}

      <form className="card-panel form wide" onSubmit={(e) => void add(e)}>
        <h2>{T.addTitle}</h2>
        <div className="two-col">
          <div className="field">
            <label htmlFor={ids.front}>{T.front}</label>
            <textarea
              id={ids.front}
              ref={frontField}
              rows={2}
              value={front}
              maxLength={MAX_CARD_TEXT}
              disabled={inUse}
              onChange={(e) => setFront(e.target.value)}
              onKeyDown={submitOnCtrlEnter(() => void add())}
              aria-invalid={addError ? true : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.back}>{T.back}</label>
            <textarea
              id={ids.back}
              rows={2}
              value={back}
              maxLength={MAX_CARD_TEXT}
              disabled={inUse}
              onChange={(e) => setBack(e.target.value)}
              onKeyDown={submitOnCtrlEnter(() => void add())}
              aria-invalid={addError ? true : undefined}
            />
          </div>
        </div>
        {addError && (
          <p className="field-error" role="alert">
            {addError}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={inUse || front.trim() === '' || back.trim() === ''}>
            {T.addCard}
          </button>
          <span className="hint">{T.ctrlEnter}</span>
        </div>
      </form>

      {load.status === 'loading' && (
        <p className="muted" role="status">
          {T.loading}
        </p>
      )}
      {load.status === 'error' && (
        <div className="empty" role="alert">
          <h2>{T.loadFailed}</h2>
          <p className="muted">{load.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => void reload()}>
            {C.tryAgain}
          </button>
        </div>
      )}
      {load.status === 'ready' && load.cards.length === 0 && (
        <div className="empty">
          <h2>{T.emptyTitle}</h2>
          <p className="muted">{T.emptyBody}</p>
        </div>
      )}
      {load.status === 'ready' && load.cards.length > 0 && (
        <>
          <div className="field search">
            <label htmlFor={ids.search}>{T.search}</label>
            <input
              id={ids.search}
              type="text"
              value={query}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE_SIZE);
              }}
            />
          </div>
          {matches.length === 0 ? (
            <div className="empty">
              <h2>{T.noMatch(query.trim())}</h2>
            </div>
          ) : (
            <>
              <p className="muted" role="status">
                {query.trim() === '' ? T.showing(Math.min(shown, matches.length), C.cards(matches.length)) : T.matching(C.cards(matches.length))}
              </p>
              <ul className="rows">
                {matches.slice(0, shown).map((c) => (
                  <li key={c.id} className="row card-row">
                    {editing?.id === c.id ? (
                      <form className="grow edit-form" onSubmit={(e) => void save(e)}>
                        <div className="two-col">
                          <div className="field">
                            <label htmlFor={`${ids.front}-e`}>{T.front}</label>
                            <textarea
                              id={`${ids.front}-e`}
                              rows={2}
                              autoFocus
                              value={editing.front}
                              maxLength={MAX_CARD_TEXT}
                              onChange={(e) => setEditing({ ...editing, front: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditing(null);
                                else submitOnCtrlEnter(() => void save())(e);
                              }}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`${ids.back}-e`}>{T.back}</label>
                            <textarea
                              id={`${ids.back}-e`}
                              rows={2}
                              value={editing.back}
                              maxLength={MAX_CARD_TEXT}
                              onChange={(e) => setEditing({ ...editing, back: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditing(null);
                                else submitOnCtrlEnter(() => void save())(e);
                              }}
                            />
                          </div>
                        </div>
                        {editError && (
                          <p className="field-error" role="alert">
                            {editError}
                          </p>
                        )}
                        <div className="actions">
                          <button type="submit" className="btn btn-primary" disabled={editing.front.trim() === '' || editing.back.trim() === ''}>
                            {C.save}
                          </button>
                          <button type="button" className="btn btn-quiet" onClick={() => setEditing(null)}>
                            {C.cancel}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="two-col grow">
                          <div className="card-text">{c.front}</div>
                          <div className="card-text muted">{c.back}</div>
                        </div>
                        <div className="actions">
                          <button
                            type="button"
                            className="btn btn-quiet"
                            disabled={inUse}
                            aria-label={T.editLabel(c.front)}
                            onClick={() => {
                              setEditing({ id: c.id, front: c.front, back: c.back });
                              setEditError(null);
                            }}
                          >
                            {T.edit}
                          </button>
                          <button type="button" className="btn btn-quiet btn-danger" disabled={inUse} aria-label={T.deleteLabel(c.front)} onClick={() => void remove(c)}>
                            {T.delete}
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {matches.length > shown && (
                <button type="button" className="btn" onClick={() => setShown(shown + PAGE_SIZE)}>
                  {T.showMore(Math.min(PAGE_SIZE, matches.length - shown))}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
