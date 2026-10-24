import type { Rect } from '../../shared/geometry';
import type { DogFrame } from '../../shared/ipc';
import { DOG } from '../../shared/physics';

export function dogHitRect(f: DogFrame): Rect {
  return { x: f.x - DOG.width / 2, y: f.y - DOG.height, width: DOG.width, height: DOG.height };
}

export function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

/** True only over the part of the dog that is actually visible, so a dog hidden behind a window never grabs the mouse. */
export function dogHit(f: DogFrame | null, x: number, y: number): boolean {
  return f !== null && f.clip.some((r) => inside(r, x, y));
}
