import type { Card, DecksFile, Deck, FsrsState, HistoryFile } from './model';
import type { Settings } from './settings';

// These guard stored files against crashes, not against every wrong value: they check shape and types, and stay
// lenient about extra fields so a harmless addition never gets a user's data treated as corrupt.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isArrayOf = <T>(v: unknown, guard: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(guard);

function isFsrsState(v: unknown): v is FsrsState {
  return (
    isRecord(v) &&
    isNum(v['due']) &&
    isNum(v['stability']) &&
    isNum(v['difficulty']) &&
    isNum(v['scheduledDays']) &&
    isNum(v['learningSteps']) &&
    isNum(v['reps']) &&
    isNum(v['lapses']) &&
    (v['state'] === 0 || v['state'] === 1 || v['state'] === 2 || v['state'] === 3) &&
    (v['lastReview'] === null || isNum(v['lastReview']))
  );
}

function isCard(v: unknown): v is Card {
  return isRecord(v) && isStr(v['id']) && isStr(v['front']) && isStr(v['back']) && isNum(v['createdAt']) && isFsrsState(v['fsrs']);
}

function isDeck(v: unknown): v is Deck {
  return isRecord(v) && isStr(v['id']) && isStr(v['name']) && isNum(v['createdAt']) && isArrayOf(v['cards'], isCard);
}

export function isDecksFile(v: unknown): v is DecksFile {
  return isRecord(v) && isArrayOf(v['decks'], isDeck);
}

export function isSettings(v: unknown): v is Settings {
  return (
    isRecord(v) &&
    (v['cap'] === 2 || v['cap'] === 3 || v['cap'] === 4) &&
    isStr(v['preset']) &&
    isNum(v['checkinMinMinutes']) &&
    isNum(v['checkinMaxMinutes']) &&
    isArrayOf(v['excludedApps'], isStr) &&
    isStr(v['leaveItHotkey'])
  );
}

const isSession = (v: unknown): boolean =>
  isRecord(v) &&
  isStr(v['id']) &&
  isStr(v['deckId']) &&
  isStr(v['topic']) &&
  isNum(v['startedAt']) &&
  isNum(v['endedAt']) &&
  isNum(v['answered']) &&
  isNum(v['treats']) &&
  isNum(v['longestWaitMs']) &&
  isNum(v['guiltTrips']);

const isGuiltTrip = (v: unknown): boolean => isRecord(v) && isNum(v['at']) && isNum(v['waitedMs']);

export function isHistoryFile(v: unknown): v is HistoryFile {
  return (
    isRecord(v) &&
    Array.isArray(v['sessions']) &&
    v['sessions'].every(isSession) &&
    Array.isArray(v['guiltTrips']) &&
    v['guiltTrips'].every(isGuiltTrip) &&
    isNum(v['treats'])
  );
}
