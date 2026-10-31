import type { AppError, DeckSummary, ImportReport } from '../../shared/control';
import { COMMON, plural } from '../../shared/i18n/en';

/** Formatting for the control window: counts, durations, dates and the failure sentence. The words themselves are in src/shared/i18n/en/. */

export { plural };
export const ERROR_TEXT = COMMON.errors;
export const SKIP_TEXT = COMMON.skipped;

/** The sentence for a failure: the part of a settings change that was wrong when main says so, else what the code means. */
export function errorText(e: AppError): string {
  return e.reason ? COMMON.settingsReason[e.reason] : COMMON.errors[e.code];
}

/** "45 s", "2 min 10 s", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return COMMON.hoursMinutes(h, String(m).padStart(2, '0'));
  if (m > 0) return s === 0 ? COMMON.minutes(m) : COMMON.minutesSeconds(m, s);
  return COMMON.seconds(s);
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

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today 14:05", "Yesterday 09:12", "12 Oct 14:05" (with the year when it is not this year). Local time. */
export function formatWhen(ts: number, now: number): string {
  const d = new Date(ts);
  const n = new Date(now);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay(d, n)) return COMMON.today(time);
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (sameDay(d, yesterday)) return COMMON.yesterday(time);
  const year = d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return COMMON.date(d.getDate(), d.getMonth(), year, time);
}

/** The toast after an import. */
export function importMessage(r: ImportReport, deckName: string): string {
  const parts = [COMMON.importedTo(COMMON.cards(r.added), deckName)];
  if (r.duplicates > 0) parts.push(COMMON.importedDuplicates(COMMON.rows(r.duplicates)));
  if (r.skipped.length > 0) parts.push(COMMON.importedSkipped(COMMON.rows(r.skipped.length)));
  return parts.join(' ');
}

export function deckLabel(d: Pick<DeckSummary, 'name' | 'cardCount'>): string {
  return `${d.name} (${COMMON.cards(d.cardCount)})`;
}
