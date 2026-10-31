import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

let app: ElectronApplication;

test.beforeEach(async () => {
  // VS Code sets ELECTRON_RUN_AS_NODE, which would make Electron behave as plain Node.
  const env = { ...process.env, BARKSTUDY_E2E: '1', BARKSTUDY_NO_CONTROL: '1' } as Record<string, string>;
  delete env['ELECTRON_RUN_AS_NODE'];
  app = await electron.launch({ args: ['.'], env });
  // The debug surface appears once main has finished starting up (koffi loading takes a moment).
  await expect
    .poll(() => debug<number>('overlayCount').catch(() => 0), { timeout: 15_000 })
    .toBeGreaterThan(0);
});

// Closing the app first means a failing test still exits in seconds.
test.afterEach(async () => {
  await app.close();
});

type Body = { x: number; y: number; anchor: { windowId: number | null; displayId: number; dx: number } | null };

/** Calls a function on `globalThis.__barkDebug` inside the main process (installed only when BARKSTUDY_E2E=1). */
function debug<T>(method: string, ...args: unknown[]): Promise<T> {
  return app.evaluate(
    (_electron, p: { method: string; args: unknown[] }) => {
      const d = (globalThis as unknown as { __barkDebug: Record<string, (...a: unknown[]) => unknown> }).__barkDebug;
      return d[p.method]!(...p.args);
    },
    { method, args },
  ) as Promise<T>;
}

/** A plain frameless window we control, shown without taking focus. Returns its native handle. */
function openTestWindow(): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = new BrowserWindow({ x: 300, y: 300, width: 500, height: 300, frame: false, resizable: false, show: false });
    void win.loadURL('data:text/html,<body style="background:%234fc3f7">e2e</body>');
    win.showInactive();
    (globalThis as unknown as { __testWin: unknown }).__testWin = win;
    return Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  });
}

function moveTestWindow(dx: number, steps: number): Promise<void> {
  return app.evaluate(
    (_electron, p: { dx: number; steps: number }) =>
      new Promise<void>((resolve) => {
        const win = (globalThis as unknown as { __testWin: { getPosition(): number[]; setPosition(x: number, y: number): void } }).__testWin;
        const [x0 = 0, y0 = 0] = win.getPosition();
        let i = 0;
        const id = setInterval(() => {
          i++;
          win.setPosition(x0 + Math.round((p.dx * i) / p.steps), y0);
          if (i >= p.steps) {
            clearInterval(id);
            resolve();
          }
        }, 16);
      }),
    { dx, steps },
  );
}

const closeTestWindow = () =>
  app.evaluate(() => {
    (globalThis as unknown as { __testWin: { destroy(): void } }).__testWin.destroy();
  });

test('one overlay per display', async () => {
  const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
  expect(await debug<number>('overlayCount')).toBe(displays);
});

test('dragging a window carries Pandesal along', async () => {
  await debug('freeze', true);
  const hwnd = await openTestWindow();
  await expect.poll(() => debug<boolean>('placeOn', hwnd), { timeout: 5000 }).toBe(true);
  const before = await debug<Body>('body');
  expect(before.anchor?.windowId).toBe(hwnd);

  await moveTestWindow(300, 30);
  await new Promise((r) => setTimeout(r, 400));

  const after = await debug<Body>('body');
  expect(after.anchor?.windowId).toBe(hwnd);
  expect(Math.abs(after.x - before.x - 300)).toBeLessThanOrEqual(2);
  expect(after.y).toBe(before.y);
});

test('the dog falls when its window closes', async () => {
  await debug('freeze', true);
  const hwnd = await openTestWindow();
  await expect.poll(() => debug<boolean>('placeOn', hwnd), { timeout: 5000 }).toBe(true);
  await closeTestWindow();
  await expect
    .poll(async () => {
      const b = await debug<Body>('body');
      return b.anchor !== null && b.anchor.windowId !== hwnd;
    }, { timeout: 3000 })
    .toBe(true);
});

test('killing the tracker drops to edge-roaming without a crash', async () => {
  const overlaysBefore = await debug<number>('overlayCount');
  await debug('killTracker');
  await expect.poll(() => debug<string>('mode'), { timeout: 2000 }).toBe('edge-roaming');
  await expect
    .poll(async () => (await debug<Body>('body')).anchor?.windowId === null, { timeout: 4000 })
    .toBe(true);
  expect(await debug<number>('overlayCount')).toBe(overlaysBefore);
  expect(await app.evaluate(({ app: a }) => a.isReady())).toBe(true);
});

test('battery saver makes him nap where he is, and turning it off gets him up', async () => {
  type MoodChange = { mood: string; pose: string; effect: string | null };
  const lastPose = async () => (await debug<MoodChange[]>('moodLog')).at(-1)?.pose;
  // Landed first, so a fall from the spawn point is not taken for movement.
  await expect.poll(async () => (await debug<Body>('body')).anchor !== null, { timeout: 5000 }).toBe(true);
  await debug('setBatterySaver', true);
  try {
    await expect.poll(lastPose, { timeout: 2000 }).toBe('curl');
    const before = await debug<Body>('body');
    await new Promise((r) => setTimeout(r, 3000));
    expect((await debug<Body>('body')).x).toBe(before.x);
    expect(await lastPose()).toBe('curl');
    const header = (await debug<{ label: string }[]>('trayMenu'))[0]?.label;
    expect(header?.endsWith('(napping: battery saver)')).toBe(true);
  } finally {
    // Back to the e2e default even when an assertion above fails.
    await debug('setBatterySaver', false);
  }
  await expect.poll(lastPose, { timeout: 2000 }).not.toBe('curl');
  expect((await debug<{ label: string }[]>('trayMenu'))[0]?.label).not.toContain('napping');
});

test('the overlay renderer cannot reach the network', async () => {
  const result = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('no overlay window');
    return win.webContents.executeJavaScript("fetch('https://example.com').then(() => 'ok', () => 'blocked')") as Promise<string>;
  });
  expect(result).toBe('blocked');
});
