import type { ErrorCode, Notice } from '../../control';
import type { SkipReason } from '../../deckParse';
import type { SettingsReason } from '../../settings';

/** Words every screen shares: navigation, banners, buttons, failures, skipped rows, numbers and dates. */

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const ERROR_TEXT: Record<ErrorCode, string> = {
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
  'hotkey-invalid': 'That shortcut cannot be used. It needs Ctrl and Alt together with a key, and the two shortcuts must differ.',
  'session-running': 'End the session first, then try again.',
  'partly-replaced': 'Part of your data was replaced before a save failed, so what you see may be a mix. Your earlier files are in the backups folder.',
};

const SKIP_TEXT: Record<SkipReason, string> = {
  'no-separator': 'No comma, tab or semicolon between the two sides',
  'empty-front': 'The front is empty',
  'empty-back': 'The back is empty',
  'header-row': 'Looks like a header row',
};

const NOTICE_TEXT: Record<Notice['kind'], string> = {
  recovered: 'A saved file was damaged. The damaged copy was set aside and the newest good backup was used instead.',
  migrated: 'Your saved data was upgraded to the new format. A backup of the old one was kept.',
  unavailable: 'A saved file could not be read safely, so changes to it are switched off to protect it. Nothing was overwritten.',
  repaired: 'A setting that could not be used was put back to its default.',
};

const STORE_NAME: Record<Notice['store'], string> = { decks: 'Decks', settings: 'Settings', history: 'History' };

/** Why a settings change was refused, so the page can say which part to fix. */
const SETTINGS_REASON: Record<SettingsReason, string> = {
  'too-many-apps': 'The list can hold up to 100 apps. Remove some before adding more.',
  'bad-interval': 'Check-in gaps are whole minutes from 1 to 240, and the longest cannot be shorter than the shortest.',
  'same-shortcut': 'The two shortcuts must be different from each other.',
  'bad-shortcut': 'That shortcut cannot be used. It needs Ctrl and Alt together with a key.',
  'bad-preset': 'That personality is not one that exists.',
  'bad-app-name': 'An app name cannot be blank or longer than 260 characters.',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export const COMMON = {
  appName: 'BarkStudy',
  pageTitle: (section: string) => `${section} · BarkStudy`,

  nav: { study: 'Study', decks: 'Decks', history: 'History', settings: 'Settings', about: 'About' },
  navLive: ' · live',
  sections: 'Sections',
  skipToContent: 'Skip to content',

  trackerDownLead: 'Window tracking is off.',
  trackerDownBody: "Pandesal can't see your other windows, so he roams the edges of your screen instead. Restart BarkStudy to try again.",
  shortcutTakenLead: (label: string) => `${label} is used by another app,`,
  shortcutTakenBody: "so Leave it won't work from the keyboard. You can still pause from the tray icon or the Study page.",
  chooseShortcut: 'Choose another shortcut',
  stripLead: 'Studying ',
  stripTail: (status: string) => ` — ${status}`,
  backToSession: 'Back to the session',
  loadingDecks: 'Loading your decks…',
  loadFailed: "Couldn't load your data",

  noticeStore: (store: Notice['store']) => STORE_NAME[store],
  notice: NOTICE_TEXT,

  tryAgain: 'Try again',
  dismiss: 'Dismiss',
  dismissMessage: 'Dismiss message',
  close: 'Close',
  cancel: 'Cancel',
  save: 'Save',
  undo: 'Undo',
  done: 'Done',
  back: 'Back',
  next: 'Next',

  answered: 'Answered',
  treats: 'Treats',
  longestWait: 'Longest wait',
  guiltTrips: 'Guilt trips',

  dogAlt: 'Pandesal, a small dog, sitting and wagging his tail',

  cards: (n: number) => plural(n, 'card'),
  rows: (n: number) => plural(n, 'row'),

  errors: ERROR_TEXT,
  skipped: SKIP_TEXT,
  settingsReason: SETTINGS_REASON,

  /** Durations: "45 s", "2 min 10 s", "1 h 05 min". */
  hoursMinutes: (h: number, mm: string) => `${h} h ${mm} min`,
  minutes: (m: number) => `${m} min`,
  minutesSeconds: (m: number, s: number) => `${m} min ${s} s`,
  seconds: (s: number) => `${s} s`,

  /** "Today 14:05", "Yesterday 09:12", "12 Oct 14:05". */
  today: (time: string) => `Today ${time}`,
  yesterday: (time: string) => `Yesterday ${time}`,
  date: (day: number, month: number, year: string, time: string) => `${day} ${MONTHS[month]}${year} ${time}`,

  importedTo: (added: string, deck: string) => `Added ${added} to ${deck}.`,
  importedDuplicates: (rows: string) => `${rows} already there.`,
  importedSkipped: (rows: string) => `${rows} skipped.`,
} as const;
