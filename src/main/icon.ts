import { nativeImage, type NativeImage } from 'electron';

/**
 * The app icon, drawn in code so there is no image file to ship: a bread-brown roll with two darker ears, in BGRA
 * byte order as `nativeImage.createFromBitmap` expects on Windows. It is the tray icon and the window icon.
 */

const FUR = [0x4b, 0x8b, 0xc9]; // B, G, R of #C98B4B
const EAR = [0x2b, 0x5a, 0x8a]; // #8A5A2B
const RIM = [0x12, 0x24, 0x3b]; // #3B2412

export function makeIcon(size: number): Buffer {
  const buf = Buffer.alloc(size * size * 4); // fully transparent to begin with
  const c = (size - 1) / 2;
  const body = size * 0.36;
  const ears = [
    { x: c - size * 0.26, y: c - size * 0.26, r: size * 0.15 },
    { x: c + size * 0.26, y: c - size * 0.26, r: size * 0.15 },
  ];
  const set = (x: number, y: number, rgb: number[]): void => {
    const i = (y * size + x) * 4;
    buf[i] = rgb[0] ?? 0;
    buf[i + 1] = rgb[1] ?? 0;
    buf[i + 2] = rgb[2] ?? 0;
    buf[i + 3] = 0xff;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dBody = Math.hypot(x - c, y - (c + size * 0.06));
      const inEar = ears.some((e) => Math.hypot(x - e.x, y - e.y) <= e.r);
      if (dBody <= body) set(x, y, dBody >= body - Math.max(1, size * 0.06) ? RIM : FUR);
      else if (inEar) set(x, y, EAR);
    }
  }
  return buf;
}

let windowImage: NativeImage | undefined;

/** The icon for the control window and the overlays, made once. */
export function windowIcon(): NativeImage {
  windowImage ??= nativeImage.createFromBitmap(makeIcon(256), { width: 256, height: 256 });
  return windowImage;
}
