import { say } from '../../shared/i18n/en';
import { SPEECH_SHOW_MS, type DogFrame, type SpeechLine } from '../../shared/ipc';
import type { BubbleView } from './bubble';
import { placeBubble, unionRects, type Size } from './bubbleLayout';
import { dogHitRect } from './hit';

/**
 * What Pandesal says, shown for SPEECH_SHOW_MS. It is a small balloon above him that follows him, or, while the
 * flashcard bubble is open, the bubble's eyebrow in place of "Pandesal asks" (the bubble owns that text; this file only
 * hands it over). It is for show only: the balloon is hidden from screen readers and the mouse goes through it.
 *
 * The caller shows a line only on the overlay that has him; this file does not know about other displays.
 */

const TAIL_INSET = 16;
const POP_MS = 140;

export interface SpeechView {
  /** Says a line. A key with no text is ignored, and so is a line already showing. */
  show: (line: SpeechLine) => void;
  /** Keeps the balloon on him; with no frame (he is on another display) it is hidden. */
  setFrame: (frame: DogFrame | null) => void;
  /** The bubble opened, closed or moved, so the words may belong in the other place now. */
  refresh: () => void;
}

export function createSpeechView(bubble: BubbleView): SpeechView {
  const found = document.getElementById('speech');
  if (!found) throw new Error('overlay: missing #speech');
  const balloon: HTMLElement = found;
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  let frame: DogFrame | null = null;
  let current: { id: number; text: string } | null = null;
  let timer: number | null = null;
  /** The balloon's size while it is shown; null means it is hidden or its words just changed. */
  let measured: Size | null = null;

  function hide(): void {
    measured = null;
    balloon.hidden = true;
  }

  function refresh(): void {
    // The bubble, when open, carries the words in its eyebrow; the balloon is only for when it is not.
    if (current === null || frame === null || bubble.isOpen()) {
      if (!balloon.hidden) hide();
      return;
    }
    if (measured === null) {
      balloon.hidden = false;
      measured = { width: balloon.offsetWidth, height: balloon.offsetHeight };
      if (!frame.reducedMotion && !reducedQuery.matches) {
        balloon.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], POP_MS);
      }
    }
    // Above him, or above the "question waiting" chip when that sits there, so the two never overlap.
    const dog = dogHitRect(frame);
    const at = placeBubble(unionRects([dog, ...bubble.hitRects()]), measured, { width: window.innerWidth, height: window.innerHeight });
    balloon.style.left = `${Math.round(at.x)}px`;
    balloon.style.top = `${Math.round(at.y)}px`;
    balloon.dataset['side'] = at.side;
    const tailX = Math.min(measured.width - TAIL_INSET, Math.max(TAIL_INSET, frame.x - at.x));
    balloon.style.setProperty('--tail-x', `${Math.round(tailX)}px`);
  }

  function end(): void {
    timer = null;
    current = null;
    bubble.setSpeech(null);
    refresh();
  }

  return {
    show(line) {
      const text = say(line.key, line.params);
      if (text === null || line.id === current?.id) return;
      if (timer !== null) window.clearTimeout(timer);
      current = { id: line.id, text };
      balloon.textContent = text;
      measured = null;
      timer = window.setTimeout(end, SPEECH_SHOW_MS);
      bubble.setSpeech(text);
      refresh();
    },
    setFrame(next) {
      frame = next;
      refresh();
    },
    refresh,
  };
}
