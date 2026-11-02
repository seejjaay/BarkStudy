/**
 * Packs square BGRA bitmaps (top row first, as `makeIcon` draws them) into a Windows .ico file. Each image is stored as an
 * uncompressed 32-bit DIB with an all-zero AND mask, which every tool that reads icons accepts (NSIS and rcedit included),
 * so there is no PNG encoder to carry. Used by `scripts/make-icon.ts` to write the installer and executable icon.
 */

export interface IcoImage {
  size: number;
  /** size * size * 4 bytes, BGRA, top row first. */
  bgra: Buffer;
}

const HEADER = 6;
const ENTRY = 16;
const DIB_HEADER = 40;

export function encodeIco(images: readonly IcoImage[]): Buffer {
  if (images.length === 0) throw new Error('an icon needs at least one image');
  const blobs = images.map(dib);
  const head = Buffer.alloc(HEADER + ENTRY * images.length);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((img, i) => {
    const at = HEADER + ENTRY * i;
    const blob = blobs[i] as Buffer;
    head[at] = img.size === 256 ? 0 : img.size; // 0 means 256
    head[at + 1] = img.size === 256 ? 0 : img.size;
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(blob.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += blob.length;
  });
  return Buffer.concat([head, ...blobs]);
}

function dib({ size, bgra }: IcoImage): Buffer {
  if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`icon size ${size} is not 1..256`);
  if (bgra.length !== size * size * 4) throw new Error(`a ${size}px icon needs ${size * size * 4} bytes, got ${bgra.length}`);
  const header = Buffer.alloc(DIB_HEADER);
  header.writeUInt32LE(DIB_HEADER, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // the height counts the colour rows and the mask rows
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  // DIB rows run bottom-up.
  const rows = Buffer.alloc(bgra.length);
  for (let y = 0; y < size; y++) bgra.copy(rows, (size - 1 - y) * size * 4, y * size * 4, (y + 1) * size * 4);
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([header, rows, mask]);
}
