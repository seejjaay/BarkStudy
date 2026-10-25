import type { DogFrame } from '../../shared/ipc';
import type { Mood } from '../../shared/mood';
import { SIDE_HEADING } from './effects';
import type { DogRenderer } from './renderer';

type Ctx = CanvasRenderingContext2D;

const FUR = '#C98B4B';
const DARK = '#8A5A2B';
const NOSE = '#3B2412';
const TONGUE = '#D9707A';
const GLINT = '#FFF8EC';
const DIRT = '#6B4423';
const PRINT = '#5A3A1E';
const PRINT_RIM = 'rgba(255, 248, 236, 0.85)';
const BOB_HZ = 4;
const RUN_HZ = 8;
const DIG_HZ = 7;
const LEG = 12; // length of a standing leg

/** What a mood changes about the way he is drawn. Each change is a shape, so the moods can be told apart without colour. */
interface Look {
  /** Head rotation in radians; negative lifts the nose. */
  tilt: number;
  ears: 'up' | 'droop' | 'back';
  eyes: 'dot' | 'big' | 'closed' | 'joy';
  grin: boolean;
  /** Tail wag in Hz; 0 keeps it still. */
  wagHz: number;
  /** One full spin takes this long; 0 for none. */
  spinMs: number;
  /** His back to us: no face, and he faces away from where he was heading. */
  turned: boolean;
  /** Sits tall, with a straight front leg and his head high. */
  upright: boolean;
}

const PLAIN: Look = { tilt: 0, ears: 'up', eyes: 'dot', grin: false, wagHz: 0, spinMs: 0, turned: false, upright: false };

const LOOKS: Partial<Record<Mood, Partial<Look>>> = {
  curious: { tilt: -0.45 },
  pleading: { eyes: 'big', ears: 'droop' },
  whine: { ears: 'droop' },
  zoomies: { grin: true, ears: 'back' },
  happy: { eyes: 'joy', grin: true, wagHz: 10, spinMs: 800 },
  ecstatic: { eyes: 'joy', grin: true, wagHz: 16, spinMs: 450 },
  greet: { grin: true },
  sulk: { turned: true, ears: 'droop' },
  nap: { eyes: 'closed' },
  sit: { upright: true },
};

function lookFor(f: DogFrame): Look {
  const look = { ...PLAIN, ...LOOKS[f.mood] };
  if (f.pose === 'curl') look.eyes = 'closed';
  return look;
}

function blob(ctx: Ctx, color: string, x: number, y: number, rx: number, ry: number, rotation = 0): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fill();
}

/** A leg hanging from (x, top), swung about its top by `angle` (positive swings the foot back). */
function leg(ctx: Ctx, x: number, top: number, length: number, angle = 0): void {
  ctx.save();
  ctx.translate(x, top);
  ctx.rotate(angle);
  ctx.fillStyle = DARK;
  ctx.beginPath();
  ctx.roundRect(-3, 0, 6, length, 3);
  ctx.fill();
  ctx.restore();
}

/** The tail, centred on (x, y) and leaning `rot`, wagging about the end that joins the body. */
function tail(ctx: Ctx, x: number, y: number, rot: number, wag: number): void {
  const rootX = x - Math.sin(rot) * 8;
  const rootY = y + Math.cos(rot) * 8;
  const a = rot + wag;
  blob(ctx, FUR, rootX + Math.sin(a) * 8, rootY - Math.cos(a) * 8, 4, 8, a);
}

function line(ctx: Ctx, draw: () => void): void {
  ctx.strokeStyle = NOSE;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  draw();
  ctx.stroke();
}

/** The head centred on (x, y), facing +x. `flip` is for a dog on his back, whose ear then hangs the other way. */
function head(ctx: Ctx, x: number, y: number, look: Look, flip = false): void {
  const s = flip ? -1 : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(look.tilt);
  blob(ctx, FUR, 0, 0, 9, 9);
  if (look.ears === 'up') blob(ctx, DARK, -4, -8 * s, 3, 6, -0.3 * s);
  else if (look.ears === 'droop') blob(ctx, DARK, -5, 4 * s, 3, 7, 0.2 * s);
  else blob(ctx, DARK, -9, -3 * s, 7, 2.5, -0.15 * s);
  if (!look.turned) {
    blob(ctx, NOSE, 7, 2, 3, 2.5);
    if (look.grin) {
      blob(ctx, TONGUE, 6, 8, 2, 3);
      line(ctx, () => ctx.arc(6, 1, 5, 0.2, Math.PI - 0.6));
    }
    if (look.eyes === 'big') {
      blob(ctx, NOSE, 3, -2, 3.2, 3.6);
      blob(ctx, GLINT, 4, -3.4, 1.1, 1.1);
    } else if (look.eyes === 'closed') {
      line(ctx, () => {
        ctx.moveTo(1, -2);
        ctx.lineTo(5, -2);
      });
    } else if (look.eyes === 'joy') {
      line(ctx, () => ctx.arc(3, -1, 2.2, Math.PI, 0));
    } else {
      blob(ctx, NOSE, 3, -2, 1.5, 1.5);
    }
  }
  ctx.restore();
}

interface Parts {
  look: Look;
  /** Motion is reduced: nothing swings, and every pose holds its rest shape. */
  still: boolean;
  tMs: number;
  /** Tail swing for this instant, in radians. */
  wag: number;
}

function walking(ctx: Ctx, p: Parts): void {
  const phase = (p.tMs / 1000) * Math.PI * 2 * BOB_HZ;
  const bob = p.still ? 0 : Math.sin(phase) * 2;
  [-14, -6, 6, 14].forEach((x, i) => leg(ctx, x + (p.still ? 0 : Math.sin(phase + (i * Math.PI) / 2) * 3), -LEG + bob, LEG - bob));
  blob(ctx, FUR, 0, -22 + bob, 20, 11);
  head(ctx, 18, -30 + bob, p.look);
  tail(ctx, -22, -30 + bob, -0.6, p.wag);
}

/** Stretched out at a gallop: the front legs reach forward while the hind legs push back, and he bounces. */
function running(ctx: Ctx, p: Parts): void {
  const stride = p.still ? 0 : Math.sin((p.tMs / 1000) * Math.PI * 2 * RUN_HZ);
  const reach = 0.6 + 0.4 * stride;
  const lift = p.still ? 0 : -Math.abs(stride) * 3;
  ctx.translate(0, lift);
  for (const x of [8, 14]) leg(ctx, x, -17, 14, -reach);
  for (const x of [-16, -10]) leg(ctx, x, -17, 14, reach);
  blob(ctx, FUR, 0, -24, 22, 9);
  head(ctx, 24, -28, p.look);
  tail(ctx, -27, -26, -1.35, p.wag);
}

/** Mid-hop: front legs stretched out ahead, hind legs trailing, nose up. */
function hopping(ctx: Ctx, p: Parts): void {
  for (const x of [8, 14]) leg(ctx, x, -17, 13, -0.95);
  for (const x of [-16, -10]) leg(ctx, x, -17, 13, 0.95);
  blob(ctx, FUR, 0, -24, 21, 10, -0.18);
  head(ctx, 20, -34, p.look);
  tail(ctx, -24, -28, -1, p.wag);
}

/** Nose to the ground, hind end up, front paws scratching. */
function digging(ctx: Ctx, p: Parts): void {
  const scratch = p.still ? 0 : Math.sin((p.tMs / 1000) * Math.PI * 2 * DIG_HZ);
  for (const x of [-14, -6]) leg(ctx, x, -LEG - 2, LEG + 2);
  blob(ctx, FUR, -1, -26, 20, 11, 0.3);
  leg(ctx, 12, -16, 16, -0.4 + scratch * 0.7);
  leg(ctx, 18, -16, 16, -0.4 - scratch * 0.7);
  head(ctx, 21, -12, { ...p.look, tilt: 0.55 });
  tail(ctx, -21, -38, -0.25, p.wag);
}

function sitting(ctx: Ctx, p: Parts): void {
  const tall = p.look.upright;
  leg(ctx, 12, -16, 16);
  if (tall) leg(ctx, 6, -16, 16);
  blob(ctx, FUR, -4, -18, 18, 10, tall ? -0.85 : -0.5);
  blob(ctx, DARK, -12, -8, 8, 7);
  tail(ctx, -24, -10, 0.9, p.wag);
  head(ctx, 11, tall ? -38 : -33, p.look);
}

function falling(ctx: Ctx, p: Parts): void {
  for (const x of [-12, -4, 6, 14]) leg(ctx, x, -48, 12);
  blob(ctx, FUR, 0, -28, 20, 11);
  head(ctx, 18, -22, p.look, true);
  tail(ctx, -22, -34, -0.6, p.wag);
}

/** Curled into a ball with his nose tucked in; eyes closed comes from the look. */
function curled(ctx: Ctx, p: Parts): void {
  blob(ctx, FUR, 0, -13, 24, 13);
  blob(ctx, DARK, -10, -9, 9, 7);
  head(ctx, 16, -12, { ...p.look, tilt: 0.6 });
  blob(ctx, FUR, -2, -3, 17, 3.5, 0.05);
}

/** The spin as a turn about his own axis: his width swings through zero and back, never quite flat. */
function spinScale(tMs: number, spinMs: number): number {
  const c = Math.cos((tMs / spinMs) * Math.PI * 2);
  return (c < 0 ? -1 : 1) * Math.max(Math.abs(c), 0.2);
}

/**
 * Placeholder Pandesal (real art arrives later; see `DogRenderer`). Origin is the centre of the feet, facing +x; the
 * frame's `facing` mirrors it. On laps he is turned to the edge he is on instead, and runs clockwise. Only the parts
 * listed in `frame.clip` are painted, so windows above the dog hide it.
 */
export function drawDog(ctx: Ctx, f: DogFrame, tMs: number): void {
  if (f.clip.length === 0) return;
  const look = lookFor(f);
  const still = f.reducedMotion;
  ctx.save();
  ctx.beginPath();
  for (const r of f.clip) ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  ctx.translate(f.x, f.y);
  if (f.side) ctx.rotate(SIDE_HEADING[f.side]);
  else ctx.scale(look.turned ? -f.facing : f.facing, 1);
  if (look.spinMs > 0 && !still) ctx.scale(spinScale(tMs, look.spinMs), 1);

  const wag = look.wagHz > 0 && !still ? Math.sin((tMs / 1000) * Math.PI * 2 * look.wagHz) * 0.5 : 0;
  const parts: Parts = { look, still, tMs, wag };
  switch (f.pose) {
    case 'sit':
      sitting(ctx, parts);
      break;
    case 'fall':
      falling(ctx, parts);
      break;
    case 'run':
      running(ctx, parts);
      break;
    case 'hop':
      hopping(ctx, parts);
      break;
    case 'dig':
      digging(ctx, parts);
      break;
    case 'curl':
      curled(ctx, parts);
      break;
    default:
      walking(ctx, parts);
  }
  ctx.restore();
}

/** Dirt flung up by digging. Not clipped: it flies over whatever is on screen. */
export function paintDirt(ctx: Ctx, particles: readonly { x: number; y: number; size: number; alpha: number }[]): void {
  ctx.save();
  ctx.fillStyle = DIRT;
  for (const p of particles) {
    ctx.globalAlpha = p.alpha;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.restore();
}

/** Paw prints, each a pad and three toes pointing along `angle`. Not clipped. */
export function paintPrints(ctx: Ctx, prints: readonly { x: number; y: number; angle: number; alpha: number }[]): void {
  for (const p of prints) {
    if (p.alpha <= 0) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.globalAlpha = p.alpha;
    ctx.strokeStyle = PRINT_RIM;
    ctx.lineWidth = 1;
    blob(ctx, PRINT, -1.5, 0, 3.2, 2.8);
    for (const [x, y] of [[2.5, -3], [4, 0], [2.5, 3]] as const) blob(ctx, PRINT, x, y, 1.4, 1.4);
    ctx.restore();
  }
}

export const proceduralRenderer: DogRenderer = { draw: drawDog };
