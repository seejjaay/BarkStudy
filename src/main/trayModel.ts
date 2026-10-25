import type { DeckSummary, Result, SessionAction, SessionView, StartRequest } from '../shared/control';
import { sessionKind } from '../shared/sessionKind';
import type { Library } from './library';
import type { SessionController } from './session';

/**
 * The tray is the always-there navigation. This file decides what its menu says and what each entry does, with no
 * Electron in it: `tray.ts` only turns the description into a real menu and hands clicks back.
 */

export const MAX_TRAY_DECKS = 12;

export interface MenuItemSpec {
  /** Clicking an item with an id runs that action. Items without one are labels, separators or submenus. */
  id?: string;
  label: string;
  enabled?: boolean;
  separator?: boolean;
  /** The shortcut shown beside the label (display only; the hotkey itself is registered elsewhere). */
  hint?: string;
  submenu?: MenuItemSpec[];
}

export interface TrayInputs {
  view: SessionView;
  decks: readonly DeckSummary[];
  /** How the Leave it shortcut is written, such as "Ctrl+Alt+L". */
  leaveItLabel: string;
  leaveItConflict: boolean;
  trackerDown: boolean;
}

export type TrayAction =
  | { kind: 'open' }
  | { kind: 'quit' }
  | { kind: 'end' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'stay-on'; minutes: 15 | 25 | 50 }
  | { kind: 'stay-off' }
  | { kind: 'start'; deckId: string };

const sep: MenuItemSpec = { label: '', separator: true };
const minutesLeft = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** One line saying what Pandesal is doing, shared by the menu header and the tooltip. */
export function statusLine(view: SessionView): string {
  if (view.phase === 'idle') return 'No session running';
  if (view.phase === 'ended') return `Session finished: ${view.answered} answered, ${view.treats} treats`;
  switch (sessionKind(view)) {
    case 'paused':
      return `Studying ${view.deckName}: paused (Leave it)`;
    case 'stay':
      return `Studying ${view.deckName}: staying${view.stayLeftMs === null ? '' : `, about ${minutesLeft(view.stayLeftMs)} min left`}`;
    case 'away':
      return `Studying ${view.deckName}: you are away`;
    case 'quiet':
      return `Studying ${view.deckName}: quiet while another app is in front`;
    case 'running':
      return `Studying ${view.deckName}`;
  }
}

export const trayTooltip = (view: SessionView): string => `BarkStudy\n${statusLine(view)}`;

export function buildTrayMenu(inputs: TrayInputs): MenuItemSpec[] {
  const { view, decks, leaveItLabel } = inputs;
  const items: MenuItemSpec[] = [{ label: statusLine(view), enabled: false }];

  if (inputs.trackerDown) items.push({ label: 'Window tracking is off. Pandesal roams the screen edges.', enabled: false });
  if (inputs.leaveItConflict) items.push({ label: `${leaveItLabel} is used by another app, so Leave it works from this menu only.`, enabled: false });
  items.push(sep);

  if (view.phase === 'running') {
    items.push(
      view.paused
        ? { id: 'resume', label: 'Resume', hint: leaveItLabel }
        : { id: 'pause', label: 'Leave it (pause)', hint: leaveItLabel },
    );
    items.push(
      view.stay
        ? { id: 'stay-off', label: 'End stay' }
        : {
            label: 'Stay (focus block)',
            submenu: ([15, 25, 50] as const).map((m) => ({ id: `stay-on:${m}`, label: `Stay ${m} minutes` })),
          },
    );
    items.push({ id: 'end', label: 'End session' });
  } else {
    const usable = decks.filter((d) => d.cardCount > 0);
    items.push(
      usable.length === 0
        ? { label: 'Start session (add a deck with cards first)', enabled: false }
        : {
            label: 'Start session',
            submenu: usable.slice(0, MAX_TRAY_DECKS).map((d) => ({ id: `start:${d.id}`, label: `${d.name} (${d.cardCount} ${d.cardCount === 1 ? 'card' : 'cards'})` })),
          },
    );
  }

  items.push(sep, { id: 'open', label: 'Open BarkStudy' }, { id: 'quit', label: 'Quit BarkStudy' });
  return items;
}

/** Reads a menu item id back into an action. Anything that is not exactly one of ours is refused. */
export function parseTrayAction(id: string): TrayAction | null {
  switch (id) {
    case 'open':
    case 'quit':
    case 'end':
    case 'pause':
    case 'resume':
      return { kind: id };
    case 'stay-off':
      return { kind: 'stay-off' };
  }
  const stay = /^stay-on:(15|25|50)$/.exec(id);
  if (stay) return { kind: 'stay-on', minutes: Number(stay[1]) as 15 | 25 | 50 };
  const start = /^start:(.{1,200})$/.exec(id);
  if (start?.[1]) return { kind: 'start', deckId: start[1] };
  return null;
}

export interface TrayActionDeps {
  session: Pick<SessionController, 'start' | 'end' | 'control'>;
  library: Pick<Library, 'getSettings'>;
  openControl: () => void;
  quit: () => void;
  /** A quiet message the user can read, such as a notification. Used when an action cannot be carried out. */
  notify: (message: string) => void;
}

const WHY_NOT: Record<string, string> = {
  'empty-deck': 'That deck has no cards yet.',
  'not-found': 'That deck is gone.',
  'already-running': 'A session is already running.',
  'not-running': 'No session is running.',
};

export async function runTrayAction(action: TrayAction, deps: TrayActionDeps): Promise<void> {
  const report = (r: Result<unknown>): void => {
    if (!r.ok) deps.notify(WHY_NOT[r.error.code] ?? 'That did not work. Open BarkStudy for details.');
  };
  switch (action.kind) {
    case 'open':
      deps.openControl();
      return;
    case 'quit':
      deps.quit();
      return;
    case 'end':
      report(await deps.session.end());
      return;
    case 'start': {
      const s = deps.library.getSettings();
      const req: StartRequest = { deckId: action.deckId, topic: '', checkinMinMinutes: s.checkinMinMinutes, checkinMaxMinutes: s.checkinMaxMinutes };
      report(deps.session.start(req));
      return;
    }
    case 'pause':
    case 'resume':
    case 'stay-off':
    case 'stay-on': {
      const control: SessionAction =
        action.kind === 'stay-on' ? { action: 'stay-on', minutes: action.minutes } : { action: action.kind };
      report(deps.session.control(control));
      return;
    }
  }
}

/** Leave it: pauses a running session, or resumes a paused one. With no session it does nothing, and says so. */
export function toggleLeaveIt(session: Pick<SessionController, 'view' | 'control'>): 'paused' | 'resumed' | 'no-session' {
  const v = session.view();
  if (v.phase !== 'running') return 'no-session';
  session.control({ action: v.paused ? 'resume' : 'pause' });
  return v.paused ? 'resumed' : 'paused';
}
