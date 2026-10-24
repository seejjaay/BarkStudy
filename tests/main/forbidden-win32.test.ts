import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The product may only read window bounds, z-order, foreground, flags and process names. Never read titles or contents, and never act on other windows. */
const FORBIDDEN =
  /GetWindowText|SetWindowPos|MoveWindow|ShowWindow|SetForegroundWindow|SendInput|keybd_event|mouse_event|PostMessage|SendMessage|PrintWindow|BitBlt|CloseWindow|DestroyWindow|SetFocus|SetActiveWindow/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx|js)$/.test(name) ? [p] : [];
  });
}

describe('forbidden Win32 calls', () => {
  it('the guard regex matches what it should', () => {
    for (const bad of ['GetWindowTextW', 'user32.SetWindowPos', 'SendInput(', 'SetForegroundWindow']) expect(bad).toMatch(FORBIDDEN);
    for (const ok of ['GetWindowThreadProcessId', 'GetForegroundWindow', 'DwmGetWindowAttribute', 'IsIconic']) expect(ok).not.toMatch(FORBIDDEN);
  });

  it('nothing under src/ uses them', () => {
    const offenders = sources('src').filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
