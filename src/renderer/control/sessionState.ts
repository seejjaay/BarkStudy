import type { SessionView, StartRequest, DeckSummary } from '../../shared/control';
import { formatClock } from './text';

type Running = Extract<SessionView, { phase: 'running' }>;

export type BadgeKind = 'running' | 'paused' | 'stay' | 'away' | 'quiet';

/** The state is always named in words; colour only reinforces it. */
export interface Badge {
  kind: BadgeKind;
  label: string;
  detail: string;
}

/** What is holding Pandesal back, most binding first: Leave it, then a Stay, then the user being away, then a quiet app in front. */
export function badgeFor(v: Running): Badge {
  if (v.paused) return { kind: 'paused', label: 'Paused', detail: 'Pandesal is on Leave it. Nothing will interrupt you until you resume.' };
  if (v.stay) {
    const left = v.stayLeftMs === null ? '' : `${formatClock(v.stayLeftMs)} left. `;
    return { kind: 'stay', label: 'Staying', detail: `${left}Pandesal is sitting quietly for your focus block.` };
  }
  if (v.away) return { kind: 'away', label: 'Away', detail: 'You look idle or the screen is locked, so check-ins wait for you.' };
  if (v.suppressed) return { kind: 'quiet', label: 'Quiet', detail: 'A full-screen or excluded app is in front, so Pandesal is staying out of the way.' };
  return { kind: 'running', label: 'Running', detail: v.card ? 'Pandesal is waiting for your answer.' : 'The next check-in comes on its own.' };
}

export const MIN_GAP = 1;
export const MAX_GAP = 240;
export const MAX_TOPIC = 80;

export interface StartDraft {
  deckId: string;
  topic: string;
  min: string;
  max: string;
}

export type StartParse = { ok: true; request: StartRequest } | { ok: false; reason: string };

const wholeMinutes = (s: string): number | null => (/^\s*\d{1,4}\s*$/.test(s) ? Number(s) : null);

/** Why Start is disabled, or the request to send. */
export function parseStart(draft: StartDraft, decks: readonly DeckSummary[]): StartParse {
  if (decks.length === 0) return { ok: false, reason: 'Create or import a deck first.' };
  const deck = decks.find((d) => d.id === draft.deckId);
  if (!deck) return { ok: false, reason: 'Pick a deck to study.' };
  if (deck.cardCount === 0) return { ok: false, reason: 'That deck has no cards yet. Add or import some first.' };
  const lo = wholeMinutes(draft.min);
  const hi = wholeMinutes(draft.max);
  if (lo === null || hi === null || lo < MIN_GAP || hi > MAX_GAP || hi < lo) {
    return { ok: false, reason: `Check-in gaps are whole minutes from ${MIN_GAP} to ${MAX_GAP}, and the longest cannot be shorter than the shortest.` };
  }
  const topic = draft.topic.trim();
  if (topic.length > MAX_TOPIC) return { ok: false, reason: `Keep the topic to ${MAX_TOPIC} characters or fewer.` };
  return { ok: true, request: { deckId: deck.id, topic, checkinMinMinutes: lo, checkinMaxMinutes: hi } };
}
