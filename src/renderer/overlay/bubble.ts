import { FEEDBACK_MS, feedbackFor, selfGradeFeedback, type BubbleState, type Feedback } from '../../shared/bubble';
import type { Rect } from '../../shared/geometry';
import type { DogFrame } from '../../shared/ipc';
import { placeBubble } from './bubbleLayout';
import { dogHitRect } from './hit';

/**
 * The flashcard bubble, drawn as ordinary page elements next to the dog. It never decides anything: main matches
 * answers and owns what is pending; this file shows it, and turns keys and clicks into requests.
 *
 * Keyboard focus is requested only on a click inside the bubble or when main says the hotkey was pressed, and it is
 * handed back as soon as the question is answered, dismissed, or the window loses focus.
 */

type Phase = 'ask' | 'revealed' | 'feedback';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`overlay: missing #${id}`);
  return found as T;
}

export interface BubbleView {
  setFrame: (frame: DogFrame | null) => void;
  /** Visible bubble parts under the pointer count as "over the dog": clicks must reach them. */
  hitRects: () => Rect[];
  /** A click on the dog: reopens a dismissed question. */
  dogClicked: () => void;
}

export function createBubbleView(onLayoutChange: () => void): BubbleView {
  const root = el<HTMLDivElement>('bubble');
  const question = el<HTMLParagraphElement>('bubble-q');
  const form = el<HTMLFormElement>('bubble-form');
  const input = el<HTMLInputElement>('bubble-input');
  const revealRow = el<HTMLDivElement>('bubble-reveal-row');
  const revealButton = el<HTMLButtonElement>('bubble-reveal');
  const answerBox = el<HTMLDivElement>('bubble-answer-box');
  const answerText = el<HTMLParagraphElement>('bubble-a');
  const goodButton = el<HTMLButtonElement>('bubble-good');
  const againButton = el<HTMLButtonElement>('bubble-again');
  const feedbackLine = el<HTMLParagraphElement>('bubble-fb');
  const hint = el<HTMLParagraphElement>('bubble-hint');
  const chip = el<HTMLButtonElement>('bubble-chip');

  let state: BubbleState | null = null;
  let frame: DogFrame | null = null;
  let phase: Phase = 'ask';
  let feedback: Feedback | null = null;
  let feedbackTimer: number | null = null;
  let hasFocus = false;
  let busy = false;

  function takeFocus(): void {
    if (!hasFocus) {
      hasFocus = true;
      window.barkOverlay.focus(true);
    }
  }

  function releaseFocus(): void {
    if (hasFocus) {
      hasFocus = false;
      window.barkOverlay.focus(false);
    }
  }

  function clearFeedback(): void {
    if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
    feedbackTimer = null;
    feedback = null;
  }

  function showFeedback(f: Feedback): void {
    releaseFocus();
    feedback = f;
    phase = 'feedback';
    if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      clearFeedback();
      phase = 'ask';
      render();
    }, FEEDBACK_MS);
    render();
  }

  function show(node: HTMLElement, on: boolean): void {
    node.hidden = !on;
  }

  function render(): void {
    const dogHere = frame !== null;
    const showingFeedback = phase === 'feedback' && feedback !== null;
    const full = dogHere && (showingFeedback || (state !== null && state.open));
    const chipOnly = dogHere && !full && state !== null && !state.open;

    show(root, full);
    show(chip, chipOnly);
    if (state && !showingFeedback) question.textContent = state.front;

    // The question and its controls give way to the verdict, then everything folds away.
    show(question, !showingFeedback);
    show(form, !showingFeedback && phase === 'ask');
    show(revealRow, !showingFeedback && phase === 'ask');
    show(answerBox, !showingFeedback && phase === 'revealed');
    show(feedbackLine, showingFeedback);
    show(hint, !showingFeedback);
    if (showingFeedback && feedback) {
      feedbackLine.textContent = feedback.text;
      feedbackLine.dataset['tone'] = feedback.tone;
    }

    // While the user is typing the bubble holds still, even if the dog wanders off.
    const holdStill = hasFocus && full && root.style.left !== '';
    if (frame && (full || chipOnly) && !holdStill) {
      const target = full ? root : chip;
      const size = { width: target.offsetWidth, height: target.offsetHeight };
      const at = placeBubble(dogHitRect(frame), size, { width: window.innerWidth, height: window.innerHeight });
      target.style.left = `${Math.round(at.x)}px`;
      target.style.top = `${Math.round(at.y)}px`;
    }
    onLayoutChange();
  }

  async function submit(): Promise<void> {
    const text = input.value;
    if (busy || text.trim() === '') return;
    busy = true;
    try {
      const r = await window.barkOverlay.submit(text);
      if (r.ok) {
        input.value = '';
        showFeedback(feedbackFor(r.match, r.expected));
      }
    } finally {
      busy = false;
    }
  }

  async function reveal(): Promise<void> {
    const r = await window.barkOverlay.reveal();
    if (!r.ok) return;
    answerText.textContent = r.back;
    phase = 'revealed';
    render();
    goodButton.focus();
  }

  async function grade(g: 'good' | 'again'): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      if (await window.barkOverlay.grade(g)) showFeedback(selfGradeFeedback(g));
    } finally {
      busy = false;
    }
  }

  function dismiss(): void {
    releaseFocus();
    if (phase === 'feedback') {
      clearFeedback();
      phase = 'ask';
      render();
      return;
    }
    window.barkOverlay.dismiss();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  revealButton.addEventListener('click', () => void reveal());
  goodButton.addEventListener('click', () => void grade('good'));
  againButton.addEventListener('click', () => void grade('again'));
  chip.addEventListener('click', () => {
    takeFocus();
    window.barkOverlay.open();
  });
  // A click anywhere in the bubble is how a mouse user asks for the keyboard; Windows then lets typing reach the input.
  root.addEventListener('pointerdown', () => {
    takeFocus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (state !== null || phase === 'feedback')) {
      e.preventDefault();
      dismiss();
    } else if (e.key === 'Enter' && phase === 'feedback') {
      e.preventDefault();
      dismiss();
    }
  });
  window.addEventListener('blur', releaseFocus);

  window.barkOverlay.onBubble((next) => {
    // Main clears the question the moment it accepts an answer, a beat before the reply that carries the verdict. Wait
    // for the verdict instead of flashing the bubble away and back.
    if (next === null && busy) {
      state = null;
      return;
    }
    const sameCard = next !== null && state !== null && next.cardId === state.cardId;
    // A different question (or none) replaces the verdict, but the verdict of the question just answered stays up.
    if (!sameCard && phase !== 'feedback') phase = 'ask';
    if (next === null && phase !== 'feedback') releaseFocus();
    if (next !== null && !sameCard) {
      if (phase === 'feedback') {
        clearFeedback();
        phase = 'ask';
      }
      input.value = '';
    }
    state = next;
    render();
  });

  window.barkOverlay.onFocusInput(() => {
    if (frame === null) return; // another display has the dog, so it has the bubble
    takeFocus();
    window.requestAnimationFrame(() => (phase === 'revealed' ? goodButton : input).focus());
  });

  return {
    setFrame(next) {
      // Frames arrive many times a second; with nothing to show there is no reason to touch the page for them.
      const idle = state === null && phase !== 'feedback';
      frame = next;
      if (!idle) render();
    },
    hitRects() {
      return [root, chip].filter((n) => !n.hidden).map((n) => n.getBoundingClientRect());
    },
    dogClicked() {
      if (state !== null && !state.open) window.barkOverlay.open();
    },
  };
}
