import type { LibrarySnapshot } from '../../shared/control';
import { formatDuration, formatWhen } from './text';

export function HistoryView({ snapshot }: { snapshot: LibrarySnapshot }) {
  const { sessions } = snapshot;
  const now = Date.now();
  return (
    <section aria-labelledby="history-title">
      <header className="page-head">
        <h1 id="history-title">History</h1>
      </header>
      {sessions.length === 0 ? (
        <div className="empty">
          <h2>No sessions yet</h2>
          <p className="muted">When you finish a study session it shows up here, with how many cards you answered and how long Pandesal waited.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Deck</th>
                <th scope="col">Topic</th>
                <th scope="col">Length</th>
                <th scope="col" className="num">
                  Answered
                </th>
                <th scope="col" className="num">
                  Treats
                </th>
                <th scope="col">Longest wait</th>
                <th scope="col" className="num">
                  Guilt trips
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{formatWhen(s.startedAt, now)}</td>
                  <td>{s.deckName ?? <span className="muted">Deleted deck</span>}</td>
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
