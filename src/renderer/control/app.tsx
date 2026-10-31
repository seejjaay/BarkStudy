import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibrarySnapshot, SessionView } from '../../shared/control';
import { COMMON as C } from '../../shared/i18n/en';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { api } from './api';
import { DecksView } from './decks';
import { AboutPage } from './about';
import { HistoryView } from './history';
import { Onboarding } from './onboarding';
import { shouldOnboard } from './onboardingFlow';
import { SettingsPage } from './settings';
import { badgeFor } from './sessionState';
import { StudyView } from './study';
import { ToastProvider } from './toast';

type View = 'study' | 'decks' | 'history' | 'settings' | 'about';
type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; snapshot: LibrarySnapshot };

const NAV: { id: View; label: string }[] = [
  { id: 'study', label: C.nav.study },
  { id: 'decks', label: C.nav.decks },
  { id: 'history', label: C.nav.history },
];
// Below the main sections, so they are one gesture away from everywhere but never in the way.
const NAV_FOOT: { id: View; label: string }[] = [
  { id: 'settings', label: C.nav.settings },
  { id: 'about', label: C.nav.about },
];

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
  const [leaveIt, setLeaveIt] = useState({ conflict: false, label: DEFAULT_SETTINGS.leaveItHotkey });
  // Bumped whenever main reports a status change, so the settings page re-reads what a shortcut conflict or restore changed.
  const [statusTick, setStatusTick] = useState(0);
  // Each Leave it press main reports while the onboarding practice step is up, and whether setup was reopened from About.
  const [presses, setPresses] = useState(0);
  const [setupAgain, setSetupAgain] = useState(false);
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
        setStatusTick((n) => n + 1);
      } else {
        setPresses((n) => n + 1);
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
    document.title = C.pageTitle(C.nav[view]);
  }, [view]);

  const snapshot = load.status === 'ready' ? load.snapshot : null;
  if (setupAgain || shouldOnboard(load, snapshot)) {
    return snapshot ? (
      <Onboarding
        snapshot={snapshot}
        leaveIt={leaveIt}
        presses={presses}
        again={setupAgain}
        onFinished={async (deckId) => {
          setStudyDeckId(deckId);
          setView('study');
          await refresh();
          setSetupAgain(false);
        }}
        onCancel={() => setSetupAgain(false)}
      />
    ) : null;
  }

  const notices = load.status === 'ready' ? load.snapshot.notices.filter((n) => !dismissed.has(`${n.store}:${n.kind}`)) : [];

  return (
    <div className="shell">
      <a className="skip" href="#main">
        {C.skipToContent}
      </a>
      <nav className="side" aria-label={C.sections}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            🐾
          </span>
          <span className="brand-name">{C.appName}</span>
        </div>
        <ul>
          {NAV.map((n) => (
            <li key={n.id}>
              <button type="button" className="nav-item" aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}>
                {n.label}
                {n.id === 'study' && session.phase === 'running' && <span className="nav-live">{C.navLive}</span>}
              </button>
            </li>
          ))}
        </ul>
        <ul className="nav-foot">
          {NAV_FOOT.map((n) => (
            <li key={n.id}>
              <button type="button" className="nav-item" aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}>
                {n.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main id="main" className="main" tabIndex={-1}>
        {trackerDown && (
          <div className="banner banner-warn" role="status">
            <strong>{C.trackerDownLead}</strong> {C.trackerDownBody}
          </div>
        )}
        {leaveIt.conflict && (
          <div className="banner banner-warn" role="status">
            <span>
              <strong>{C.shortcutTakenLead(leaveIt.label)}</strong> {C.shortcutTakenBody}
            </span>
            <button type="button" className="btn btn-quiet" onClick={() => setView('settings')}>
              {C.chooseShortcut}
            </button>
          </div>
        )}
        {notices.map((n) => (
          <div key={`${n.store}:${n.kind}`} className="banner banner-warn" role="status">
            <span>
              <strong>{C.noticeStore(n.store)}:</strong> {C.notice[n.kind]}
            </span>
            <button type="button" className="btn btn-quiet" onClick={() => setDismissed((s) => new Set(s).add(`${n.store}:${n.kind}`))}>
              {C.dismiss}
            </button>
          </div>
        ))}
        {session.phase === 'running' && view !== 'study' && (
          <div className="strip" role="status">
            <span>
              {C.stripLead}<strong>{session.deckName}</strong>
              {C.stripTail(badgeFor(session).label)}
            </span>
            <button type="button" className="btn btn-quiet" onClick={() => setView('study')}>
              {C.backToSession}
            </button>
          </div>
        )}

        {load.status === 'loading' && (
          <p className="muted" role="status">
            {C.loadingDecks}
          </p>
        )}
        {load.status === 'error' && (
          <div className="empty" role="alert">
            <h1>{C.loadFailed}</h1>
            <p className="muted">{load.message}</p>
            <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
              {C.tryAgain}
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
        {load.status === 'ready' && view === 'settings' && <SettingsPage reloadKey={statusTick} onDataChanged={() => void refresh()} />}
        {load.status === 'ready' && view === 'about' && <AboutPage version={load.snapshot.version} onRunSetup={() => setSetupAgain(true)} />}
      </main>
    </div>
  );
}
