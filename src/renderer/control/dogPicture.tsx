import { useEffect, useRef } from 'react';
import { COMMON as C } from '../../shared/i18n/en';
import type { DogFrame } from '../../shared/ipc';
import { drawDog } from '../overlay/procedural';

const WIDTH = 240;
const HEIGHT = 180;
/** The dog is drawn at overlay size; the picture is that much bigger. */
const ZOOM = 2;

/** Pandesal sitting and wagging, drawn by the same code as the overlay. Still when motion is reduced. */
export function DogPicture({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    const frame: DogFrame = {
      x: WIDTH / ZOOM / 2,
      y: HEIGHT / ZOOM - 12,
      facing: 1,
      pose: 'sit',
      mood: 'greet',
      clip: [{ x: 0, y: 0, width: WIDTH / ZOOM, height: HEIGHT / ZOOM }],
      reducedMotion: still,
    };
    const start = performance.now();
    let raf = 0;
    const paint = (now: number): void => {
      ctx.setTransform(dpr * ZOOM, 0, 0, dpr * ZOOM, 0, 0);
      ctx.clearRect(0, 0, WIDTH / ZOOM, HEIGHT / ZOOM);
      drawDog(ctx, frame, now - start);
      if (!still) raf = requestAnimationFrame(paint);
    };
    paint(start);
    return () => cancelAnimationFrame(raf);
  }, [still]);

  return <canvas ref={ref} className="dog-picture" style={{ width: WIDTH, height: HEIGHT }} role="img" aria-label={C.dogAlt} />;
}
