import type { Rect } from './geometry';

export const IPC = {
  overlayFrame: 'overlay:frame',
  overlayHit: 'overlay:hit',
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
