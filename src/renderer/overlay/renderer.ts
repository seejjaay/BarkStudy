import type { DogFrame, EffectState } from '../../shared/ipc';

/** What the overlay hands the renderer to draw the effects round him: its timing and state, never how they look. */
export interface EffectsView {
  /** The frame on show, or null when this overlay does not have the dog right now. A dig that is running is its `effect`. */
  frame: DogFrame | null;
  /**
   * The laps whose paw prints are on show: the ones running now, or the last ones while they fade. `from` is how far
   * round the frame the lap began, and `fadeMs` how long since the laps ended (0 while they run). The overlay owns
   * that clock; null when there are no prints.
   */
  prints: { effect: EffectState; from: number; fadeMs: number } | null;
  reducedMotion: boolean;
}

/**
 * How Pandesal and what he stirs up are drawn. The overlay draws him only through this, so the placeholder in
 * `procedural.ts` can be swapped for real art without touching anything else.
 */
export interface DogRenderer {
  /** The dog, clipped to `frame.clip`. `tMs` is a steadily increasing clock for animation. */
  draw(ctx: CanvasRenderingContext2D, frame: DogFrame, tMs: number): void;
  /**
   * The effects: paw prints from laps and dirt from digging. Not clipped, since they show over whatever is on screen.
   * The overlay calls it twice per draw: `behind` before the dog, `front` after, and the renderer decides what goes in each.
   */
  drawEffects(ctx: CanvasRenderingContext2D, view: EffectsView, layer: 'behind' | 'front'): void;
}
