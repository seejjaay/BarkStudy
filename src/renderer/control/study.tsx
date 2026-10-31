import { useEffect, useId, useRef, useState } from 'react';
import type { Grade } from '../../shared/srs';
import type { LibrarySnapshot, SessionView } from '../../shared/control';
import { COMMON as C, STUDY as T } from '../../shared/i18n/en';
import { api, attempt } from './api';
import { badgeFor, parseStart, type BadgeKind } from './sessionState';
import { formatDuration, errorText } from './text';
import { useToast } from './toast';

type Running = Extract<SessionView, { phase: 'running' }>;
type Ended = Extract<SessionView, { phase: 'ended' }>;

const GLYPH: Record<BadgeKind, string> = { running: '●', paused: '❚❚', stay: '◔', away: '☾', quiet: '◐' };

export function StudyView({
  snapshot,
  session,
  presetDeckId,
  goDecks,
}: {
  snapshot: LibrarySnapshot;
  session: SessionView;
  presetDeckId: string | null;
  goDecks: () => void;
}) {
  return (
    <section aria-labelledby="study-title">
      <header className="page-head">
        <h1 id="study-title">{T.title}</h1>
      </header>
      {session.phase === 'idle' && <StartForm snapshot={snapshot} presetDeckId={presetDeckId} goDecks={goDecks} />}
      {session.phase === 'running' && <RunningPanel session={session} />}
      {session.phase === 'ended' && <Summary session={session} />}
    </section>
  );
}

function StartForm({ snapshot, presetDeckId, goDecks }: { snapshot: LibrarySnapshot; presetDeckId: string | null; goDecks: () => void }) {
  const toast = useToast();
  const { decks, defaults } = snapshot;
  const ids = { deck: useId(), topic: useId(), min: useId(), max: useId(), why: useId() };
  const firstUsable = decks.find((d) => d.cardCount > 0) ?? decks[0];
  const [draft, setDraft] = useState({
    deckId: presetDeckId ?? firstUsable?.id ?? '',
    topic: '',
    min: String(defaults.checkinMinMinutes),
    max: String(defaults.checkinMaxMinutes),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseStart(draft, decks);

  if (decks.length === 0) {
    return (
      <div className="empty">
        <h2>{T.emptyTitle}</h2>
        <p className="muted">{T.emptyBody}</p>
        <button type="button" className="btn btn-primary" onClick={goDecks}>
          {T.goDecks}
        </button>
        <p className="reason">{T.startOffNoDeck}</p>
      </div>
    );
  }

  async function start(): Promise<void> {
    if (!parsed.ok) return;
    setBusy(true);
    setError(null);
    const r = await attempt(api.call('session:start', parsed.request));
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    toast(T.started(parsed.request.checkinMinMinutes, parsed.request.checkinMaxMinutes));
  }

  return (
    <form
      className="card-panel form"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <h2>{T.startTitle}</h2>
      <div className="field">
        <label htmlFor={ids.deck}>{T.deck}</label>
        <select id={ids.deck} value={draft.deckId} onChange={(e) => setDraft({ ...draft, deckId: e.target.value })}>
          <option value="" disabled>
            {T.chooseDeck}
          </option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({C.cards(d.cardCount)})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={ids.topic}>
          {T.topic} <span className="muted">{T.topicNote}</span>
        </label>
        <input id={ids.topic} type="text" value={draft.topic} maxLength={80} autoComplete="off" onChange={(e) => setDraft({ ...draft, topic: e.target.value })} />
      </div>
      <fieldset className="field-group">
        <legend>{T.checkinEvery}</legend>
        <div className="pair">
          <label htmlFor={ids.min} className="sr-only">
            {T.shortestGap}
          </label>
          <input id={ids.min} type="text" inputMode="numeric" className="num" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} />
          <span aria-hidden="true">{T.to}</span>
          <label htmlFor={ids.max} className="sr-only">
            {T.longestGap}
          </label>
          <input id={ids.max} type="text" inputMode="numeric" className="num" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} />
          <span>{T.minutes}</span>
        </div>
      </fieldset>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={!parsed.ok || busy} aria-describedby={parsed.ok ? undefined : ids.why}>
          {busy ? T.starting : T.startSession}
        </button>
        {!parsed.ok && (
          <span id={ids.why} className="reason">
            {T.startOffBecause(parsed.reason)}
          </span>
        )}
      </div>
    </form>
  );
}

function RunningPanel({ session }: { session: Running }) {
  const toast = useToast();
  const badge = badgeFor(session);
  const [revealed, setRevealed] = useState<string | null>(null);
  const goodButton = useRef<HTMLButtonElement>(null);
  const showing = session.card !== null && revealed === session.card.id;

  useEffect(() => {
    if (showing) goodButton.current?.focus();
  }, [showing]);

  async function answer(grade: Grade): Promise<void> {
    const r = await attempt(api.call('session:answer', { grade }));
    if (!r.ok) toast(errorText(r.error), { kind: 'error' });
    else toast(grade === 'again' ? T.missed : T.gotIt);
  }

  async function control(action: Parameters<typeof api.call<'session:control'>>[1], done: string): Promise<void> {
    const r = await attempt(api.call('session:control', action));
    if (!r.ok) toast(errorText(r.error), { kind: 'error' });
    else toast(done);
  }

  async function end(): Promise<void> {
    const r = await attempt(api.call('session:end', undefined));
    if (!r.ok) toast(errorText(r.error), { kind: 'error' });
    else if (r.value.phase === 'ended' && !r.value.saved) toast(T.sessionNotSaved, { kind: 'error' });
    else toast(T.sessionSaved);
  }

  return (
    <div className="stack">
      <div className="card-panel">
        <div className="running-head">
          <div>
            <h2>{session.deckName}</h2>
            {session.topic && <p className="muted">{session.topic}</p>}
          </div>
          <div className={`badge badge-${badge.kind}`} role="status">
            <span aria-hidden="true">{GLYPH[badge.kind]}</span> <strong>{badge.label}</strong>
          </div>
        </div>
        <p className="muted">{badge.detail}</p>
        <dl className="counters">
          <div>
            <dt>{C.answered}</dt>
            <dd>{session.answered}</dd>
          </div>
          <div>
            <dt>{C.treats}</dt>
            <dd>{session.treats}</dd>
          </div>
        </dl>
      </div>

      {session.saveProblem && (
        <div className="banner banner-warn" role="alert">
          <strong>{T.saveProblemLead}</strong> {T.saveProblemBody}
        </div>
      )}

      <div className="card-panel" aria-live="polite">
        {session.card ? (
          <>
            <p className="eyebrow">{T.asks}</p>
            <p className="question">{session.card.front}</p>
            {showing ? (
              <>
                <p className="eyebrow">{T.answerLabel}</p>
                <p className="answer">{session.card.back}</p>
                <div className="actions">
                  <button type="button" className="btn btn-primary" ref={goodButton} onClick={() => void answer('good')}>
                    {T.gotItButton}
                  </button>
                  <button type="button" className="btn" onClick={() => void answer('again')}>
                    {T.missedButton}
                  </button>
                </div>
              </>
            ) : (
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={() => setRevealed(session.card?.id ?? null)}>
                  {T.showAnswer}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="muted">{T.noQuestion}</p>
        )}
      </div>

      <div className="card-panel">
        <h3>{T.controls}</h3>
        <div className="actions wrap">
          {session.paused ? (
            <button type="button" className="btn btn-primary" onClick={() => void control({ action: 'resume' }, T.resumed)}>
              {T.resume}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void control({ action: 'pause' }, T.paused)}>
              {T.leaveIt}
            </button>
          )}
          {session.stay ? (
            <button type="button" className="btn" onClick={() => void control({ action: 'stay-off' }, T.stayEnded)}>
              {T.endStay}
            </button>
          ) : (
            ([15, 25, 50] as const).map((m) => (
              <button key={m} type="button" className="btn" onClick={() => void control({ action: 'stay-on', minutes: m }, T.stayStarted(m))}>
                {T.stay(m)}
              </button>
            ))
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-danger" onClick={() => void end()}>
            {T.endSession}
          </button>
        </div>
      </div>
    </div>
  );
}

function Summary({ session }: { session: Ended }) {
  const dismiss = () => void api.call('session:dismiss-summary', undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="card-panel">
      <h2 tabIndex={-1} ref={heading}>
        {T.finished}
      </h2>
      <p className="muted">
        {session.deckName}
        {session.topic && ` · ${session.topic}`} · {formatDuration(session.endedAt - session.startedAt)}
      </p>
      {!session.saved && (
        <div className="banner banner-warn" role="alert">
          <strong>{T.notSavedLead}</strong> {T.notSavedBody}
        </div>
      )}
      <dl className="counters">
        <div>
          <dt>{C.answered}</dt>
          <dd>{session.answered}</dd>
        </div>
        <div>
          <dt>{C.treats}</dt>
          <dd>{session.treats}</dd>
        </div>
        <div>
          <dt>{C.longestWait}</dt>
          <dd>{session.answered === 0 ? '—' : formatDuration(session.longestWaitMs)}</dd>
        </div>
        <div>
          <dt>{C.guiltTrips}</dt>
          <dd>{session.guiltTrips}</dd>
        </div>
      </dl>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={dismiss}>
          {T.startAnother}
        </button>
      </div>
    </div>
  );
}
