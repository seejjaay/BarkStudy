import type { Rect } from '../../shared/geometry';

export interface Size {
  width: number;
  height: number;
}

export const BUBBLE_MARGIN = 8;
export const BUBBLE_GAP = 10;

export interface Placement {
  x: number;
  y: number;
  side: 'above' | 'below';
}

/**
 * Puts a box of `size` next to the dog: above its head if there is room, otherwise below its feet, otherwise squeezed
 * to the top edge. It is always kept inside the viewport, at least `BUBBLE_MARGIN` from every side where it can be.
 */
export function placeBubble(dog: Rect, size: Size, viewport: Size): Placement {
  const maxX = Math.max(BUBBLE_MARGIN, viewport.width - size.width - BUBBLE_MARGIN);
  const maxY = Math.max(BUBBLE_MARGIN, viewport.height - size.height - BUBBLE_MARGIN);
  const x = Math.min(maxX, Math.max(BUBBLE_MARGIN, dog.x + dog.width / 2 - size.width / 2));

  const above = dog.y - BUBBLE_GAP - size.height;
  if (above >= BUBBLE_MARGIN) return { x, y: above, side: 'above' };
  const below = dog.y + dog.height + BUBBLE_GAP;
  if (below <= maxY) return { x, y: below, side: 'below' };
  return { x, y: Math.min(maxY, Math.max(BUBBLE_MARGIN, above)), side: 'above' };
}
