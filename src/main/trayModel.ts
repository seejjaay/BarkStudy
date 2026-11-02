import type { DeckSummary, Result, SessionAction, SessionView, StartRequest, UpdaterView } from '../shared/control';
import { TRAY } from '../shared/i18n/en';
import { sessionKind } from '../shared/sessionKind';
import type { Library } from './library';
import type { SessionController } from './session';
import type { RestartResult } from './updater';

/**
 * The tray is the always-there navigation. This file decides what its menu says and what each entry does, with no
 * Electron in it: `tray.ts` only turns the description into a real menu and hands clicks back.
 */

export const MAX_TRAY_DECKS = 12;

/** The volumes the tray offers, quietest first. */
export const TRAY_VOLUMES = [
  { label: TRAY.volumeLow, level: 0.4 },
  { label: TRAY.volumeMedium, level: 0.65 },
  { label: TRAY.volumeHigh, level: 0.9 },
] as const;

export interface MenuItemSpec {
  /** Clicking an item with an id runs that action. Items without one are labels, separators or submenus. */
  id?: string;
  label: string;
  enabled?: boolean;
  separator?: boolean;
  /** The shortcut shown beside the label (display only; the hotkey itself is registered elsewhere). */
  hint?: string;
  /** A checkbox or a radio item shows `checked`; without a kind the item is a plain entry. */
  kind?: 'checkbox' | 'radio';
  checked?: boolean;
  submenu?: MenuItemSpec[];
}

export interface TrayInputs {
  view: SessionView;
  decks: readonly DeckSummary[];
  /** How the Leave it shortcut is written, such as "Ctrl+Alt+L". */
  leaveItLabel: string;
  leaveItConflict: boolean;
  trackerDown: boolean;
  /** Battery saver is on, so he is napping. */
  batterySaver: boolean;
  soundOn: boolean;
  /** 0..1. */
  volume: number;
  update: UpdaterView;
}

export type TrayAction =
  | { kind: 'open' }
  | { kind: 'quit' }
  | { kind: 'restart-update' }
  | { kind: 'end' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'stay-on'; minutes: 15 | 25 | 50 }
  | { kind: 'stay-off' }
  | { kind: 'start'; deckId: string }
  | { kind: 'sound'; on: boolean }
  | { kind: 'volume'; level: (typeof TRAY_VOLUMES)[number]['level'] };

const sep: MenuItemSpec = { label: '', separator: true };
const minutesLeft = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** One line saying what Pandesal is doing, shared by the menu header and the tooltip. On battery saver it says he is napping. */
export function statusLine(view: SessionView, batterySaver = false): string {
  const line = sessionLine(view);
  return batterySaver ? `${line} ${TRAY.napping}` : line;
}

function sessionLine(view: SessionView): string {
  if (view.phase === 'idle') return TRAY.idle;
  if (view.phase === 'ended') return TRAY.ended(view.answered, view.treats);
  switch (sessionKind(view)) {
    case 'paused':
      return TRAY.paused(view.deckName);
    case 'stay':
      return TRAY.stay(view.deckName, view.stayLeftMs === null ? null : minutesLeft(view.stayLeftMs));
    case 'away':
      return TRAY.away(view.deckName);
    case 'quiet':
      return TRAY.quiet(view.deckName);
    case 'running':
      return TRAY.running(view.deckName);
  }
}

export const trayTooltip = (view: SessionView, batterySaver = false): string => TRAY.tooltip(statusLine(view, batterySaver));

export function buildTrayMenu(inputs: TrayInputs): MenuItemSpec[] {
  const { view, decks, leaveItLabel } = inputs;
  const items: MenuItemSpec[] = [{ label: statusLine(view, inputs.batterySaver), enabled: false }];

  if (inputs.trackerDown) items.push({ label: TRAY.trackerDown, enabled: false });
  if (inputs.leaveItConflict) items.push({ label: TRAY.shortcutTaken(leaveItLabel), enabled: false });
  items.push(sep);

  if (view.phase === 'running') {
    items.push(
      view.paused
        ? { id: 'resume', label: TRAY.resume, hint: leaveItLabel }
        : { id: 'pause', label: TRAY.pause, hint: leaveItLabel },
    );
    items.push(
      view.stay
        ? { id: 'stay-off', label: TRAY.endStay }
        : {
            label: TRAY.stayMenu,
            submenu: ([15, 25, 50] as const).map((m) => ({ id: `stay-on:${m}`, label: TRAY.stayFor(m) })),
          },
    );
    items.push({ id: 'end', label: TRAY.endSession });
  } else {
    const usable = decks.filter((d) => d.cardCount > 0);
    items.push(
      usable.length === 0
        ? { label: TRAY.startNoDecks, enabled: false }
        : {
            label: TRAY.startMenu,
            submenu: usable.slice(0, MAX_TRAY_DECKS).map((d) => ({ id: `start:${d.id}`, label: TRAY.deckItem(d.name, d.cardCount) })),
          },
    );
  }

  // The Sounds item's id says what a click does: it turns sound off while it is on, and on while it is off.
  items.push(
    sep,
    { id: inputs.soundOn ? 'sound:off' : 'sound:on', label: TRAY.sounds, kind: 'checkbox', checked: inputs.soundOn },
    { label: TRAY.volume, submenu: TRAY_VOLUMES.map((v) => ({ id: `volume:${v.level}`, label: v.label, kind: 'radio', checked: inputs.volume === v.level })) },
  );

  // A downloaded update waits for the end of a session; the item says so and cannot be clicked until then.
  if (inputs.update.state === 'ready' && inputs.update.version !== null) {
    items.push(
      sep,
      view.phase === 'running'
        ? { label: TRAY.updateAfterSession(inputs.update.version), enabled: false }
        : { id: 'restart-update', label: TRAY.restartToUpdate(inputs.update.version) },
    );
  }

  items.push(sep, { id: 'open', label: TRAY.open }, { id: 'quit', label: TRAY.quit });
  return items;
}

/** Reads a menu item id back into an action. Anything that is not exactly one of ours is refused. */
export function parseTrayAction(id: string): TrayAction | null {
  switch (id) {
    case 'open':
    case 'quit':
    case 'restart-update':
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
  if (id === 'sound:on' || id === 'sound:off') return { kind: 'sound', on: id === 'sound:on' };
  const volume = TRAY_VOLUMES.find((v) => id === `volume:${v.level}`);
  if (volume) return { kind: 'volume', level: volume.level };
  return null;
}

export interface TrayActionDeps {
  session: Pick<SessionController, 'start' | 'end' | 'control'>;
  library: Pick<Library, 'getSettings' | 'updateSettings'>;
  openControl: () => void;
  quit: () => void;
  /** A quiet message the user can read, such as a notification. Used when an action cannot be carried out. */
  notify: (message: string) => void;
  /** Restarts into the downloaded update, unless a session is running. */
  restartToUpdate: () => RestartResult;
}

export async function runTrayAction(action: TrayAction, deps: TrayActionDeps): Promise<void> {
  const report = (r: Result<unknown>): void => {
    if (!r.ok) deps.notify(TRAY.whyNot[r.error.code] ?? TRAY.failed);
  };
  switch (action.kind) {
    case 'open':
      deps.openControl();
      return;
    case 'quit':
      deps.quit();
      return;
    case 'restart-update':
      if (deps.restartToUpdate() === 'session-running') deps.notify(TRAY.updateWaits);
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
    case 'sound':
      report(await deps.library.updateSettings({ soundOn: action.on }));
      return;
    case 'volume':
      report(await deps.library.updateSettings({ volume: action.level }));
      return;
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
