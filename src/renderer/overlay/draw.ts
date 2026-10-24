import type { DogFrame } from '../../shared/ipc';

const FUR = '#C98B4B';
const DARK = '#8A5A2B';
const NOSE = '#3B2412';
const BOB_HZ = 4;

function blob(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, rx: number, ry: number, rotation = 0): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fill();
}

function leg(ctx: CanvasRenderingContext2D, x: number, top: number, length: number): void {
  ctx.fillStyle = DARK;
  ctx.beginPath();
  ctx.roundRect(x - 3, top, 6, length, 3);
  ctx.fill();
}

/**
 * Placeholder Pandesal (real art arrives in M4). Origin is the centre of the feet, facing +x; the frame's `facing`
 * mirrors it. Only the parts listed in `frame.clip` are painted, so windows above the dog hide it.
 */
export function drawDog(ctx: CanvasRenderingContext2D, f: DogFrame, tMs: number): void {
  if (f.clip.length === 0) return;
  ctx.save();
  ctx.beginPath();
  for (const r of f.clip) ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  ctx.translate(f.x, f.y);
  ctx.scale(f.facing, 1);

  const phase = (tMs / 1000) * Math.PI * 2 * BOB_HZ;
  const moving = f.pose === 'walk' && !f.reducedMotion;
  const bob = moving ? Math.sin(phase) * 2 : 0;

  if (f.pose === 'sit') {
    leg(ctx, 12, -16, 16);
    blob(ctx, FUR, -4, -18, 18, 10, -0.5);
    blob(ctx, DARK, -12, -8, 8, 7);
    blob(ctx, FUR, -24, -10, 4, 7, 0.9);
    blob(ctx, FUR, 11, -33, 9, 9);
    blob(ctx, DARK, 7, -42, 3, 6, -0.3);
    blob(ctx, NOSE, 19, -31, 3, 2.5);
  } else if (f.pose === 'fall') {
    for (const x of [-12, -4, 6, 14]) leg(ctx, x, -48, 12);
    blob(ctx, FUR, 0, -28, 20, 11);
    blob(ctx, FUR, 18, -22, 9, 9);
    blob(ctx, DARK, 14, -14, 3, 6, 0.3);
    blob(ctx, NOSE, 25, -20, 3, 2.5);
    blob(ctx, FUR, -22, -34, 4, 8, -0.6);
  } else {
    [-14, -6, 6, 14].forEach((x, i) => leg(ctx, x + (moving ? Math.sin(phase + (i * Math.PI) / 2) * 3 : 0), -12 + bob, 12 - bob));
    blob(ctx, FUR, 0, -22 + bob, 20, 11);
    blob(ctx, FUR, 18, -30 + bob, 9, 9);
    blob(ctx, DARK, 14, -38 + bob, 3, 6, -0.3);
    blob(ctx, NOSE, 25, -28 + bob, 3, 2.5);
    blob(ctx, FUR, -22, -30 + bob, 4, 8, -0.6);
  }
  // Eye.
  const eyeY = f.pose === 'sit' ? -35 : f.pose === 'fall' ? -22 : -32 + bob;
  const eyeX = f.pose === 'sit' ? 14 : 21;
  blob(ctx, NOSE, eyeX, eyeY, 1.5, 1.5);
  ctx.restore();
}
