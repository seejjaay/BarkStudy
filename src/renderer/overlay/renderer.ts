import type { DogFrame } from '../../shared/ipc';

/**
 * How Pandesal is drawn. The overlay only ever draws him through this, so the placeholder in `procedural.ts` can be
 * swapped for real art without touching anything else. `tMs` is a steadily increasing clock for animation.
 */
export interface DogRenderer {
  draw(ctx: CanvasRenderingContext2D, frame: DogFrame, tMs: number): void;
}
