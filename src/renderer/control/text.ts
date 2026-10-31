import type { AppError, DeckSummary, ErrorCode, ImportReport } from '../../shared/control';
import type { SkipReason } from '../../shared/deckParse';

/** All the words the control window says about failures, skipped rows and numbers. One place, so they can be read and checked together. */

export const ERROR_TEXT: Record<ErrorCode, string> = {
  'invalid-name': 'A deck name needs 1 to 80 characters.',
  'duplicate-name': 'You already have a deck with that name.',
  'not-found': 'That no longer exists. It may have been deleted.',
  'already-exists': 'That is already there.',
  'no-valid-rows': 'No row could be read as a card.',
  'store-unavailable': 'Your saved data could not be read safely, so changes are switched off to protect it.',
  'write-failed': 'It could not be saved to disk. Nothing was changed.',
  'empty-deck': 'That deck has no cards yet.',
  'already-running': 'A session is already running.',
  'not-running': 'No session is running.',
  'invalid-request': 'That did not look right. Check the fields and try again.',
  'duplicate-card': 'This deck already has a card with the same front and back.',
  'invalid-card': 'Both sides of a card need some text, up to 2000 characters each.',
  'deck-in-use': 'A session is using this deck right now. End the session first.',
  'file-unreadable': 'That file could not be read.',
  'file-too-large': 'That is too large to import.',
  'not-a-backup': 'That is not a BarkStudy backup, or part of it is damaged. Nothing was changed.',
  'newer-version': 'That backup was made by a newer BarkStudy. Update the app to restore it. Nothing was changed.',
  'hotkey-taken': 'Another app is using that shortcut. Pick a different one.',
  'hotkey-invalid': 'That shortcut cannot be used. It needs Ctrl or Alt plus a key, and the two shortcuts must differ.',
  'session-running': 'End the session first, then try again.',
};

export const SKIP_TEXT: Record<SkipReason, string> = {
  'no-separator': 'No comma, tab or semicolon between the two sides',
  'empty-front': 'The front is empty',
  'empty-back': 'The back is empty',
  'header-row': 'Looks like a header row',
};

export function errorText(e: AppError): string {
  return ERROR_TEXT[e.code];
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "45 s", "2 min 10 s", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return s === 0 ? `${m} min` : `${m} min ${s} s`;
  return `${s} s`;
}

/** A countdown: "14:32" (or "1:02:05" past an hour). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today 14:05", "Yesterday 09:12", "12 Oct 14:05" (with the year when it is not this year). Local time. */
export function formatWhen(ts: number, now: number): string {
  const d = new Date(ts);
  const n = new Date(now);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay(d, n)) return `Today ${time}`;
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (sameDay(d, yesterday)) return `Yesterday ${time}`;
  const year = d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${time}`;
}

/** The toast after an import. */
export function importMessage(r: ImportReport, deckName: string): string {
  const parts = [`Added ${plural(r.added, 'card')} to ${deckName}.`];
  if (r.duplicates > 0) parts.push(`${plural(r.duplicates, 'row')} already there.`);
  if (r.skipped.length > 0) parts.push(`${plural(r.skipped.length, 'row')} skipped.`);
  return parts.join(' ');
}

export function deckLabel(d: Pick<DeckSummary, 'name' | 'cardCount'>): string {
  return `${d.name} (${plural(d.cardCount, 'card')})`;
}

/** What the settings page says after a change, and what its confirmation dialogs warn about. */
export const SETTINGS_TEXT = {
  saved: 'Saved.',
  appliesNextSession: 'Saved. It applies from your next study session.',
  loginOn: 'Pandesal will start with Windows, quietly in the tray.',
  loginOff: 'Pandesal will no longer start with Windows.',
  loginUnavailable: 'Only the installed app can start with Windows.',
  exportDone: (path: string) => `Backup saved to ${path}.`,
  importDone: 'Restored from the backup. What you had before is in the backups folder.',
  resetDone: 'Everything was reset. A copy of the old data is in the backups folder.',
  importTitle: 'Restore from a backup?',
  importBody: 'This replaces all your decks, history and settings with what is in the backup file. Your current files are copied to the backups folder first.',
  resetTitle: 'Reset everything?',
  resetBody: 'This removes all your decks, your history and your settings, and Pandesal will walk you through setup again. A copy of your current data stays in the backups folder.',
  updatesNote: 'Update checking arrives in a later version. Your choice is saved for then.',
};

/** First-run onboarding and the About page. The dog is male: he/him. */
export const ONBOARDING_TEXT = {
  title: {
    meet: 'Meet Pandesal',
    personality: 'How much dog do you want?',
    escape: 'Two ways to make him stop',
    privacy: 'What he can see',
    login: 'Start with Windows?',
    sample: 'Something to study',
  },
  meet: [
    'Pandesal is a small, needy dog who lives on top of your windows. He quizzes you from your own flashcards, and when you ignore him he gets louder and sillier.',
    'He never goes beyond the limit you set. The next screens set that limit, and show you how to stop him.',
  ],
  escapeEsc: 'Esc ends zoomies or a dig-in at once, from any app. It always works and can’t be changed.',
  escapeLeaveIt: (label: string) => `${label} is Leave it: it pauses Pandesal until you press it again. Press it now, once, to see that it works.`,
  escapeWaiting: 'Waiting for you to press it…',
  escapeDone: 'That worked. Pandesal would be paused now.',
  escapeTaken: (label: string) => `${label} is used by another app, so Leave it can’t listen for it. Pick another shortcut, or go on and use the tray menu instead.`,
  continueAnyway: 'Go on without it',
  privacy: [
    'BarkStudy looks at where your windows are and which program owns each one, so Pandesal can walk along title bars. It never reads window titles or contents, and never takes screenshots.',
    'Your decks, history and settings stay on this PC. The only thing that can ever go online is a check for new versions, and you can switch that off.',
  ],
  login: 'Start BarkStudy when I sign in to Windows. It starts quietly in the tray; Pandesal is there, the window isn’t.',
  sample: 'Add Pandesal’s starter deck: twelve short cards, so your first session works straight away.',
  sampleHave: 'You already have the starter deck, so there is nothing to add.',
  skip: 'Skip setup',
  cancel: 'Cancel',
  finish: 'Start studying',
  failed: 'Setup could not be saved.',
  aboutBlurb: 'A study companion for Windows. Pandesal walks along your windows, quizzes you from your own flashcards with spaced repetition, and escalates, politely, when you ignore him.',
  aboutLicense: 'Free and open source under the MIT license.',
};
