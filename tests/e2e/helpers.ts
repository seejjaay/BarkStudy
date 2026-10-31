import * as fs from 'node:fs';
import { join } from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

/**
 * Writes settings.json as a user who has already been through onboarding, so a spec that is not about the first run
 * lands on the study page. The app has no switch for this on purpose: onboarding is skipped only because the saved
 * settings say it was done.
 */
export function seedOnboarded(userData: string, over: Record<string, unknown> = {}): void {
  const dir = join(userData, 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'settings.json'), JSON.stringify({ schemaVersion: 1, data: { ...DEFAULT_SETTINGS, onboarded: true, ...over } }));
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
}

/** Starts the app on this folder and returns it with its control window. */
export async function launchControl(userData: string): Promise<Launched> {
  // VS Code sets ELECTRON_RUN_AS_NODE, which would make Electron behave as plain Node.
  const env = { ...process.env, BARKSTUDY_E2E: '1', BARKSTUDY_USER_DATA: userData } as Record<string, string>;
  delete env['ELECTRON_RUN_AS_NODE'];
  const app = await electron.launch({ args: ['.'], env });
  await expect.poll(() => app.windows().some((w) => w.url().includes('control')), { timeout: 20_000 }).toBe(true);
  const page = app.windows().find((w) => w.url().includes('control'))!;
  return { app, page };
}

/** Calls a function on `globalThis.__barkDebug` inside the main process (installed only when BARKSTUDY_E2E=1). */
export function debug<T>(app: ElectronApplication, method: string, ...args: unknown[]): Promise<T> {
  return app.evaluate(
    (_electron, p: { method: string; args: unknown[] }) => {
      const d = (globalThis as unknown as { __barkDebug: Record<string, (...a: unknown[]) => unknown> }).__barkDebug;
      return d[p.method]!(...p.args);
    },
    { method, args },
  ) as Promise<T>;
}

/** The debug surface appears once main has finished starting up (koffi loading takes a moment). */
export async function waitForDebug(app: ElectronApplication): Promise<void> {
  await expect.poll(() => debug<number>(app, 'overlayCount').catch(() => 0), { timeout: 15_000 }).toBeGreaterThan(0);
}

/** Calls an operation the control window would, from inside its page. */
export function control<T>(page: Page, op: string, args?: unknown): Promise<T> {
  return page.evaluate(([o, a]) => (window as unknown as { barkControl: { call: (op: string, args: unknown) => Promise<unknown> } }).barkControl.call(o as string, a), [op, args]) as Promise<T>;
}
