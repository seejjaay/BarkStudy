import type { DogFrame, EffectState } from '../../shared/ipc';
import { createBubbleView } from './bubble';
import { PRINT_FADE_MS, lapOrigin, needsAnimation } from './effects';
import { dogHit, inside } from './hit';
import { proceduralRenderer } from './procedural';
import type { DogRenderer, EffectsView } from './renderer';
import { createSynthSoundBank, type SoundBank } from './sound';
import { createSpeechView } from './speech';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const ctx = canvas?.getContext('2d');
if (!canvas || !ctx) throw new Error('overlay: no canvas');

const renderer: DogRenderer = proceduralRenderer;
const sounds: SoundBank = createSynthSoundBank();
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
/** The last frame main sent, and the one place it is kept: null means this overlay does not have the dog right now. */
let frame: DogFrame | null = null;
let pointer: { x: number; y: number } | null = null;
let over = false;
let rafId = 0;
/**
 * The laps that last left prints here. While they run the prints are full; once they end (or the dog leaves this
 * display) `endedAt` is set and the prints fade for PRINT_FADE_MS. The fade is kept here only, main knows nothing of it.
 */
let trail: { effect: EffectState; from: number; endedAt: number | null } | null = null;

const isReduced = (): boolean => (frame?.reducedMotion ?? false) || prefersReduced.matches;
const isFading = (): boolean => trail !== null && trail.endedAt !== null;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas!.width = Math.round(window.innerWidth * dpr);
  canvas!.height = Math.round(window.innerHeight * dpr);
  // Backing store is in device pixels; the CSS box stays in DIP so drawing coordinates are DIP.
  canvas!.style.width = `${window.innerWidth}px`;
  canvas!.style.height = `${window.innerHeight}px`;
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  queueDraw();
}

// A frame is drawn when main sends one. The loop below only keeps going while something moves between frames
// (see needsAnimation), so an idle dog costs nothing.
function queueDraw(): void {
  if (rafId) return;
  rafId = requestAnimationFrame(tick);
}

function tick(t: number): void {
  rafId = 0;
  render(t);
  if (needsAnimation(frame, isFading(), isReduced())) queueDraw();
}

function render(t: number): void {
  const c = ctx!;
  c.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const reducedMotion = isReduced();

  let prints: EffectsView['prints'] = null;
  if (trail) {
    const fadeMs = trail.endedAt === null ? 0 : Math.max(0, t - trail.endedAt);
    if (fadeMs >= PRINT_FADE_MS) trail = null;
    else prints = { effect: trail.effect, from: trail.from, fadeMs };
  }
  // The renderer draws the effects behind him and in front of him, and him in between; only he is clipped.
  const view: EffectsView = { frame, prints, reducedMotion };
  renderer.drawEffects(c, view, 'behind');
  if (frame) renderer.draw(c, { ...frame, reducedMotion }, t);
  renderer.drawEffects(c, view, 'front');
}

/** Remembers a laps effect for its prints, or starts the fade once there is none. Call after `frame` is set. */
function trackTrail(f: DogFrame | null): void {
  if (f?.effect?.kind === 'laps' && f.side) {
    const elapsedMs = isReduced() ? 0 : f.effect.elapsedMs;
    trail = { effect: f.effect, from: lapOrigin(f.effect.rect, f, f.side, elapsedMs), endedAt: null };
  } else if (trail && trail.endedAt === null) {
    trail.endedAt = performance.now();
  }
}

// Tell main whether the cursor is over the visible dog or the bubble; main then stops or resumes ignoring mouse events.
function updateOver(): void {
  const now = pointer !== null && (dogHit(frame, pointer.x, pointer.y) || bubble.hitRects().some((r) => inside(r, pointer!.x, pointer!.y)));
  if (now === over) return;
  over = now;
  window.barkOverlay.hit(over);
}

// The bubble tells the speech view when it opens, closes or moves, so the words land in the right place.
const bubble = createBubbleView(() => {
  updateOver();
  speech.refresh();
});
const speech = createSpeechView(bubble);

window.barkOverlay.onFrame((f) => {
  frame = f;
  trackTrail(f);
  queueDraw();
  bubble.setFrame(f);
  speech.setFrame(f);
  updateOver(); // the dog may have walked out from under a still cursor
});
// Main tells every overlay what he says and does; only the overlay that has him right now acts on it. Anything else
// main broadcasts to all overlays gets a listener here with the same check.
window.barkOverlay.onSpeech((line) => {
  if (frame !== null) speech.show(line);
});
window.barkOverlay.onSound((cue) => {
  if (frame !== null) sounds.play(cue.name, cue.volume);
});
document.addEventListener('mousedown', (e) => {
  if (dogHit(frame, e.clientX, e.clientY)) bubble.dogClicked();
});
document.addEventListener('mousemove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  updateOver();
});
document.addEventListener('mouseleave', () => {
  pointer = null;
  updateOver();
});
window.addEventListener('resize', resize);
resize();
