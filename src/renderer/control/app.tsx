import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibrarySnapshot, Notice, SessionView } from '../../shared/control';
import { api } from './api';
import { DecksView } from './decks';
import { HistoryView } from './history';
import { badgeFor } from './sessionState';
import { StudyView } from './study';
import { ToastProvider } from './toast';

type View = 'study' | 'decks' | 'history';
type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; snapshot: LibrarySnapshot };

const NAV: { id: View; label: string }[] = [
  { id: 'study', label: 'Study' },
  { id: 'decks', label: 'Decks' },
  { id: 'history', label: 'History' },
];
const TITLES: Record<View, string> = { study: 'Study', decks: 'Decks', history: 'History' };

const NOTICE_TEXT: Record<Notice['kind'], string> = {
  recovered: 'A saved file was damaged. The damaged copy was set aside and the newest good backup was used instead.',
  migrated: 'Your saved data was upgraded to the new format. A backup of the old one was kept.',
  unavailable: 'A saved file could not be read safely, so changes to it are switched off to protect it. Nothing was overwritten.',
};
const STORE_NAME: Record<Notice['store'], string> = { decks: 'Decks', settings: 'Settings', history: 'History' };

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [view, setView] = useState<View>('study');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [session, setSession] = useState<SessionView>({ phase: 'idle' });
  const [trackerDown, setTrackerDown] = useState(false);
  const [leaveIt, setLeaveIt] = useState({ conflict: false, label: 'Ctrl+Alt+L' });
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [studyDeckId, setStudyDeckId] = useState<string | null>(null);
  const sawEvent = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await api.call('app:snapshot', undefined);
      setLoad({ status: 'ready', snapshot });
      setTrackerDown(snapshot.trackerDown);
      setLeaveIt({ conflict: snapshot.leaveItConflict, label: snapshot.leaveItLabel });
    } catch (e) {
      setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    api.onEvent((e) => {
      sawEvent.current = true;
      if (e.type === 'session') setSession(e.view);
      else if (e.type === 'status') {
        setTrackerDown(e.trackerDown);
        setLeaveIt({ conflict: e.leaveItConflict, label: e.leaveItLabel });
      }
    });
    void api.call('session:view', undefined).then((v) => {
      if (!sawEvent.current) setSession(v);
    });
    void refresh();
  }, [refresh]);

  // A finished session adds a history row, so the lists are refreshed whenever the session changes phase.
  const phase = session.phase;
  useEffect(() => {
    void refresh();
  }, [phase, refresh]);

  useEffect(() => {
    document.title = `${TITLES[view]} · BarkStudy`;
  }, [view]);

  const notices = load.status === 'ready' ? load.snapshot.notices.filter((n) => !dismissed.has(`${n.store}:${n.kind}`)) : [];

  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <nav className="side" aria-label="Sections">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            🐾
          </span>
          <span className="brand-name">BarkStudy</span>
        </div>
        <ul>
          {NAV.map((n) => (
            <li key={n.id}>
              <button type="button" className="nav-item" aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}>
                {n.label}
                {n.id === 'study' && session.phase === 'running' && <span className="nav-live"> · live</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        {trackerDown && (
          <div className="banner banner-warn" role="status">
            <strong>Window tracking is off.</strong> Pandesal can&apos;t see your other windows, so he roams the edges of your screen instead. Restart BarkStudy to try again.
          </div>
        )}
        {leaveIt.conflict && (
          <div className="banner banner-warn" role="status">
            <span>
              <strong>{leaveIt.label} is used by another app,</strong> so Leave it won&apos;t work from the keyboard. You can still pause from the tray icon or the Study page.
              Choosing a different shortcut arrives with Settings.
            </span>
          </div>
        )}
        {notices.map((n) => (
          <div key={`${n.store}:${n.kind}`} className="banner banner-warn" role="status">
            <span>
              <strong>{STORE_NAME[n.store]}:</strong> {NOTICE_TEXT[n.kind]}
            </span>
            <button type="button" className="btn btn-quiet" onClick={() => setDismissed((s) => new Set(s).add(`${n.store}:${n.kind}`))}>
              Dismiss
            </button>
          </div>
        ))}
        {session.phase === 'running' && view !== 'study' && (
          <div className="strip" role="status">
            <span>
              Studying <strong>{session.deckName}</strong> — {badgeFor(session).label}
            </span>
            <button type="button" className="btn btn-quiet" onClick={() => setView('study')}>
              Back to the session
            </button>
          </div>
        )}

        {load.status === 'loading' && (
          <p className="muted" role="status">
            Loading your decks…
          </p>
        )}
        {load.status === 'error' && (
          <div className="empty" role="alert">
            <h1>Couldn&apos;t load your data</h1>
            <p className="muted">{load.message}</p>
            <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}
        {load.status === 'ready' && view === 'study' && (
          <StudyView
            snapshot={load.snapshot}
            session={session}
            presetDeckId={studyDeckId}
            goDecks={() => setView('decks')}
          />
        )}
        {load.status === 'ready' && view === 'decks' && (
          <DecksView
            snapshot={load.snapshot}
            refresh={refresh}
            study={(id) => {
              setStudyDeckId(id);
              setView('study');
            }}
            runningDeckId={session.phase === 'running' ? session.deckId : null}
          />
        )}
        {load.status === 'ready' && view === 'history' && <HistoryView snapshot={load.snapshot} />}
      </main>
    </div>
  );
}
