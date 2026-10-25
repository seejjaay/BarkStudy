import type { DogFrame, EffectState } from '../../shared/ipc';
import { createBubbleView } from './bubble';
import { PRINT_FADE_MS, dirtParticles, lapOrigin, needsAnimation, pawPrints } from './effects';
import { dogHit, inside } from './hit';
import { paintDirt, paintPrints, proceduralRenderer } from './procedural';
import type { DogRenderer } from './renderer';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const ctx = canvas?.getContext('2d');
if (!canvas || !ctx) throw new Error('overlay: no canvas');

const renderer: DogRenderer = proceduralRenderer;
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
  const reduced = isReduced();

  // Prints go under him; they are not clipped, so they show over the windows he ran round.
  if (trail) {
    const fadeMs = trail.endedAt === null ? 0 : Math.max(0, t - trail.endedAt);
    if (fadeMs >= PRINT_FADE_MS) trail = null;
    // Under reduced motion he does not run the lap, so he lays no prints.
    else paintPrints(c, pawPrints(trail.effect.seed, trail.effect.rect, reduced ? 0 : trail.effect.elapsedMs, fadeMs, trail.from));
  }
  if (frame) {
    renderer.draw(c, { ...frame, reducedMotion: reduced }, t);
    // Dirt flies from his front paws, over him and over the window.
    if (frame.effect?.kind === 'dig') {
      paintDirt(c, dirtParticles(frame.effect.seed, frame.effect.elapsedMs, { x: frame.x + frame.facing * 22, y: frame.y }, reduced));
    }
  }
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

const bubble = createBubbleView(updateOver);

window.barkOverlay.onFrame((f) => {
  frame = f;
  trackTrail(f);
  queueDraw();
  bubble.setFrame(f);
  updateOver(); // the dog may have walked out from under a still cursor
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
