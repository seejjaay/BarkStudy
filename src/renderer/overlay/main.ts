import type { DogFrame } from '../../shared/ipc';
import { drawDog } from './draw';
import { dogHit } from './hit';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const ctx = canvas?.getContext('2d');
if (!canvas || !ctx) throw new Error('overlay: no canvas');

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
let frame: DogFrame | null = null;
let pointer: { x: number; y: number } | null = null;
let over = false;
let drawQueued = false;

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

// There is no animation loop: a frame is drawn when main sends one, so an idle dog costs nothing.
function queueDraw(): void {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame((t) => {
    drawQueued = false;
    ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (frame) drawDog(ctx!, { ...frame, reducedMotion: frame.reducedMotion || prefersReduced.matches }, t);
  });
}

// Tell main whether the cursor is over the visible dog; main then stops or resumes ignoring mouse events.
function updateOver(): void {
  const now = pointer !== null && dogHit(frame, pointer.x, pointer.y);
  if (now === over) return;
  over = now;
  window.barkOverlay.hit(over);
}

window.barkOverlay.onFrame((f) => {
  frame = f;
  queueDraw();
  updateOver(); // the dog may have walked out from under a still cursor
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
