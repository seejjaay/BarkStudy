import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTROL_CHANNEL } from '../../src/shared/control';
import { IPC } from '../../src/shared/ipc';

describe('renderer error channel', () => {
  it('is one channel under two names, so the control preload need not import shared/ipc', () => {
    expect(CONTROL_CHANNEL.logRenderer).toBe(IPC.logRenderer);
  });
});

describe('preloads', () => {
  // Both preloads are built together, and a module they both import becomes a separate chunk that a sandboxed preload cannot load.
  const dir = resolve(__dirname, '../../src/preload');
  const valueImports = (file: string): string[] =>
    [...fs.readFileSync(join(dir, file), 'utf8').matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]!).filter((s) => s.startsWith('.'));

  it('share no module', () => {
    const control = valueImports('control.ts');
    const overlay = valueImports('overlay.ts');
    expect(control.length + overlay.length).toBeGreaterThan(0);
    expect(control.filter((s) => overlay.includes(s))).toEqual([]);
  });
});
