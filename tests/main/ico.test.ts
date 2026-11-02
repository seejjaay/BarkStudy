import { describe, expect, it } from 'vitest';
import { encodeIco } from '../../src/main/ico';
import { makeIcon } from '../../src/main/icon';

describe('the .ico encoder', () => {
  const sizes = [16, 32, 256];
  const ico = encodeIco(sizes.map((size) => ({ size, bgra: makeIcon(size) })));

  it('writes an icon header with one entry per image', () => {
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(sizes.length);
  });

  it('each entry names its size (0 means 256), 32 bits, and a blob inside the file', () => {
    sizes.forEach((size, i) => {
      const at = 6 + 16 * i;
      expect(ico[at]).toBe(size === 256 ? 0 : size);
      expect(ico.readUInt16LE(at + 6)).toBe(32);
      const bytes = ico.readUInt32LE(at + 8);
      const offset = ico.readUInt32LE(at + 12);
      expect(offset + bytes).toBeLessThanOrEqual(ico.length);
      expect(ico.readUInt32LE(offset)).toBe(40); // BITMAPINFOHEADER
      expect(ico.readInt32LE(offset + 4)).toBe(size);
      expect(ico.readInt32LE(offset + 8)).toBe(size * 2);
    });
    const last = 6 + 16 * (sizes.length - 1);
    expect(ico.readUInt32LE(last + 12) + ico.readUInt32LE(last + 8)).toBe(ico.length);
  });

  it('stores rows bottom-up: the first stored row is the last drawn row', () => {
    const size = 32;
    const bgra = makeIcon(size);
    const one = encodeIco([{ size, bgra }]);
    const pixels = one.readUInt32LE(6 + 12) + 40;
    expect(one.subarray(pixels, pixels + size * 4).equals(bgra.subarray((size - 1) * size * 4))).toBe(true);
    const lastStored = pixels + (size - 1) * size * 4;
    expect(one.subarray(lastStored, lastStored + size * 4).equals(bgra.subarray(0, size * 4))).toBe(true);
  });

  it('refuses an empty list, a wrong-size buffer and an out-of-range size', () => {
    expect(() => encodeIco([])).toThrow();
    expect(() => encodeIco([{ size: 16, bgra: Buffer.alloc(10) }])).toThrow();
    expect(() => encodeIco([{ size: 257, bgra: Buffer.alloc(257 * 257 * 4) }])).toThrow();
  });
});
