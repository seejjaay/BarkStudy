// Build step: draws the app icon (the same code-drawn roll the tray uses) and writes build/icon.ico for electron-builder.
//   npx tsx scripts/make-icon.ts
// build/icon.ico is generated and not tracked. Final art later replaces it by changing what this writes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeIco } from '../src/main/ico';
import { makeIcon } from '../src/main/icon';

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.ico');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodeIco(SIZES.map((size) => ({ size, bgra: makeIcon(size) }))));
console.log(`wrote ${out}`);
