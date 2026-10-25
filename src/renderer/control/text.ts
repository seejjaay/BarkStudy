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
  'file-unreadable': 'That file could not be read.',
  'file-too-large': 'That is too large to import.',
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
