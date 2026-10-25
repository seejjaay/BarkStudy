import type { BubbleState, RevealResult, SelfGrade, SubmitResult } from './bubble';
import type { Rect } from './geometry';

export const IPC = {
  overlayFrame: 'overlay:frame',
  overlayHit: 'overlay:hit',
  /** main → overlays: the pending question, or null. */
  bubbleState: 'bubble:state',
  /** main → overlays: the hotkey was pressed, so the overlay showing the bubble should take keyboard focus. */
  bubbleFocusInput: 'bubble:focus-input',
  bubbleSubmit: 'bubble:submit',
  bubbleReveal: 'bubble:reveal',
  bubbleGrade: 'bubble:grade',
  bubbleDismiss: 'bubble:dismiss',
  bubbleOpen: 'bubble:open',
  bubbleFocus: 'bubble:focus',
} as const;

/** What one overlay draws. Coordinates are DIP, relative to that display's top-left corner. `x`/`y` are the centre of the feet. */
export interface DogFrame {
  x: number;
  y: number;
  facing: 1 | -1;
  pose: 'walk' | 'sit' | 'fall';
  /** The parts of the sprite rectangle that are not hidden behind windows (same coordinate space). */
  clip: Rect[];
  reducedMotion: boolean;
}

/** The only message the overlay renderer may send: is the cursor over the dog? */
export function isHitMessage(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

/** `window.barkOverlay`, exposed by the overlay preload. */
export interface BarkOverlayApi {
  onFrame: (cb: (frame: DogFrame | null) => void) => void;
  hit: (over: boolean) => void;
  onBubble: (cb: (state: BubbleState | null) => void) => void;
  onFocusInput: (cb: () => void) => void;
  /** A typed answer. Main matches it and answers with the verdict and the expected text. */
  submit: (text: string) => Promise<SubmitResult>;
  reveal: () => Promise<RevealResult>;
  grade: (grade: SelfGrade) => Promise<boolean>;
  /** Esc. */
  dismiss: () => void;
  /** A click on Pandesal while the bubble is hidden. */
  open: () => void;
  /** Asks main to give this overlay keyboard focus, or to hand it back. */
  focus: (on: boolean) => void;
}
