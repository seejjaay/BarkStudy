import { describe, expect, it } from 'vitest';
import { BUBBLE_GAP, BUBBLE_MARGIN, placeBubble, unionRects } from '../../src/renderer/overlay/bubbleLayout';

const viewport = { width: 1920, height: 1080 };
const size = { width: 320, height: 200 };
const dog = (x: number, y: number) => ({ x, y, width: 64, height: 48 });

describe('placeBubble', () => {
  it('sits above the dog, centred on it', () => {
    const p = placeBubble(dog(900, 600), size, viewport);
    expect(p.side).toBe('above');
    expect(p.x).toBe(900 + 32 - 160);
    expect(p.y).toBe(600 - BUBBLE_GAP - 200);
  });

  it('goes below the dog when there is no room above', () => {
    const p = placeBubble(dog(900, 100), size, viewport);
    expect(p.side).toBe('below');
    expect(p.y).toBe(100 + 48 + BUBBLE_GAP);
  });

  it('is kept inside the left and right edges', () => {
    expect(placeBubble(dog(0, 600), size, viewport).x).toBe(BUBBLE_MARGIN);
    expect(placeBubble(dog(1900, 600), size, viewport).x).toBe(1920 - 320 - BUBBLE_MARGIN);
  });

  it('squeezes to the top edge when neither side has room', () => {
    const tall = { width: 320, height: 900 };
    const p = placeBubble(dog(900, 500), tall, viewport);
    expect(p.y).toBeGreaterThanOrEqual(BUBBLE_MARGIN);
    expect(p.y + tall.height).toBeLessThanOrEqual(viewport.height - BUBBLE_MARGIN);
  });

  it('a box bigger than the viewport still gets a sane position', () => {
    const p = placeBubble(dog(10, 10), { width: 3000, height: 3000 }, viewport);
    expect(p.x).toBe(BUBBLE_MARGIN);
    expect(p.y).toBe(BUBBLE_MARGIN);
  });
});

describe('unionRects', () => {
  it('holds every rect', () => {
    expect(unionRects([dog(100, 200), { x: 80, y: 120, width: 150, height: 30 }])).toEqual({ x: 80, y: 120, width: 150, height: 128 });
  });

  it('is the rect itself for one', () => {
    expect(unionRects([dog(10, 20)])).toEqual(dog(10, 20));
  });

  it('is empty for none', () => {
    expect(unionRects([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
