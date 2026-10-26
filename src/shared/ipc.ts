import type { BubbleState, RevealResult, SelfGrade, SubmitResult } from './bubble';
import type { Rect } from './geometry';
import type { Mood } from './mood';
import type { SoundName } from './sounds';

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
  /** main → overlays: something for Pandesal to say. Every overlay gets it; only the one that has him shows it. */
  speechSay: 'speech:say',
  /** main → overlays: a sound for Pandesal to make. Every overlay gets it; only the one that has him plays it. */
  soundPlay: 'sound:play',
} as const;

/** How the renderer draws the body. A renderer that does not know a pose draws `walk`. */
export type DogPose = 'walk' | 'sit' | 'fall' | 'run' | 'hop' | 'dig' | 'curl';

/** Which edge of the target window he is on during laps. */
export type LapSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * A running effect (laps round a window, or digging in), in the same coordinate space as the frame. `rect` is the target
 * window's live rect; for laps it is the loop he runs round it, which is pulled inside the frame on a side that meets the
 * screen edge (see lapRect).
 */
export interface EffectState {
  kind: 'laps' | 'dig';
  seed: number;
  elapsedMs: number;
  rect: Rect;
}

/** What one overlay draws. Coordinates are DIP, relative to that display's top-left corner. `x`/`y` are the centre of the feet. */
export interface DogFrame {
  x: number;
  y: number;
  facing: 1 | -1;
  pose: DogPose;
  mood: Mood;
  /** Only during laps. */
  side?: LapSide;
  /** Only while an effect runs. */
  effect?: EffectState;
  /** The parts of the sprite rectangle that are not hidden behind windows (same coordinate space). */
  clip: Rect[];
  reducedMotion: boolean;
}

/** How long a line stays up, in the balloon or in the bubble's eyebrow. */
export const SPEECH_SHOW_MS = 4000;

/** One thing Pandesal says. `key` is an i18n line key, never display text; `id` tells one saying from the next. */
export interface SpeechLine {
  key: string;
  params?: Record<string, number>;
  id: number;
}

/** One sound for the overlay to play, already past main's sound gate. `volume` is 0..1. */
export interface SoundCue {
  name: SoundName;
  volume: number;
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
  onSpeech: (cb: (line: SpeechLine) => void) => void;
  onSound: (cb: (cue: SoundCue) => void) => void;
}
