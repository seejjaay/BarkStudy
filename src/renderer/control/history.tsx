import type { LibrarySnapshot } from '../../shared/control';
import { COMMON as C, HISTORY as T } from '../../shared/i18n/en';
import { formatDuration, formatWhen } from './text';

export function HistoryView({ snapshot }: { snapshot: LibrarySnapshot }) {
  const { sessions } = snapshot;
  const now = Date.now();
  return (
    <section aria-labelledby="history-title">
      <header className="page-head">
        <h1 id="history-title">{T.title}</h1>
      </header>
      {sessions.length === 0 ? (
        <div className="empty">
          <h2>{T.emptyTitle}</h2>
          <p className="muted">{T.emptyBody}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{T.when}</th>
                <th scope="col">{T.deck}</th>
                <th scope="col">{T.topic}</th>
                <th scope="col">{T.length}</th>
                <th scope="col" className="num">
                  {C.answered}
                </th>
                <th scope="col" className="num">
                  {C.treats}
                </th>
                <th scope="col">{C.longestWait}</th>
                <th scope="col" className="num">
                  {C.guiltTrips}
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{formatWhen(s.startedAt, now)}</td>
                  <td>{s.deckName ?? <span className="muted">{T.deletedDeck}</span>}</td>
                  <td>{s.topic || <span className="muted">—</span>}</td>
                  <td>{formatDuration(s.endedAt - s.startedAt)}</td>
                  <td className="num">{s.answered}</td>
                  <td className="num">{s.treats}</td>
                  <td>{s.answered === 0 ? <span className="muted">—</span> : formatDuration(s.longestWaitMs)}</td>
                  <td className="num">{s.guiltTrips}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
