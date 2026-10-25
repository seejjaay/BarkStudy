import type { Match } from './matching';

/**
 * The flashcard bubble that sits next to Pandesal. The main process owns what is asked and what counts as an answer;
 * the overlay only draws it and relays keystrokes, so the answer to a card stays in main until it is revealed.
 */

/** `open` is false after Esc: the question is still pending, and a click on Pandesal (or Ctrl+Alt+A) reopens it. */
export interface BubbleState {
  cardId: string;
  front: string;
  open: boolean;
}

export type SelfGrade = 'good' | 'again';

export type SubmitResult = { ok: true; match: Match; expected: string } | { ok: false };
export type RevealResult = { ok: true; back: string } | { ok: false };

export const MAX_TYPED_ANSWER = 2000;
export const FEEDBACK_MS = 6000;
export const BUBBLE_HOTKEY = 'Control+Alt+A';
export const BUBBLE_HOTKEY_LABEL = 'Ctrl+Alt+A';

export const isTypedAnswer = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TYPED_ANSWER;
export const isSelfGrade = (v: unknown): v is SelfGrade => v === 'good' || v === 'again';

export interface Feedback {
  /** The word is in the text, so the result never rests on colour alone. */
  tone: 'right' | 'close' | 'wrong';
  text: string;
}

export function feedbackFor(match: Match, expected: string): Feedback {
  switch (match) {
    case 'exact':
      return { tone: 'right', text: 'Correct! Pandesal got a treat.' };
    case 'fuzzy':
      return { tone: 'close', text: `Close enough. It is “${expected}”.` };
    case 'wrong':
      return { tone: 'wrong', text: `Not quite. It is “${expected}”.` };
  }
}

export function selfGradeFeedback(grade: SelfGrade): Feedback {
  return grade === 'good'
    ? { tone: 'right', text: 'Nice, you got it. Pandesal got a treat.' }
    : { tone: 'wrong', text: 'Missed it. Pandesal will bring it back later.' };
}
