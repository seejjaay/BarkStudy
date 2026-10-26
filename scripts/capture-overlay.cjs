// A real look at the effects: launches the app with fast tuning, lets an ignored card escalate to laps and to dig-in on a
// plain test window, and saves the dog's overlay (webContents.capturePage) at three moments of each into <outDir>.
// Each moment is saved twice: `<name>-overlay.png` is the overlay alone (transparent where nothing is drawn), and
// `<name>.png` puts it over a grey desktop with the test window drawn where it is (blue, with a darker title bar), the
// display's work area outlined in red, so you can see whether he is on the frame and on screen.
// Run after `npm run build`:  node scripts/capture-overlay.cjs <outDir> [laps|dig|laps-maximised]
// It does not touch the mouse or keyboard. Look at the images; the display's scale factor is printed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const ROOT = path.resolve(__dirname, '..');
const { _electron: electron } = require(`${ROOT}/node_modules/@playwright/test`);

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node scripts/capture-overlay.cjs <outDir>');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 50) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return false;
    await sleep(step);
  }
}

/**
 * One scenario: a fresh app, a card ignored until `effect` runs on the test window, captures `atMs` into it.
 * `cap` 3 keeps laps from being cut short by the dig-in; `maximise` runs it on a maximised window.
 */
async function scenario({ name, effect, cap, atMs, maximise = false }) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'barkstudy-capture-'));
  // The pinned seed makes level 3 laps (see tests/e2e/escalation.spec.ts); level 4 is always dig-in.
  const env = { ...process.env, BARKSTUDY_E2E: '1', BARKSTUDY_FAST_TUNING: '1', BARKSTUDY_SEED: '14', BARKSTUDY_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env });
  try {
    const control = await until(() => app.windows().find((w) => w.url().includes('control')), 20000);
    if (!control) throw new Error('control window never appeared');
    await control.getByRole('heading', { level: 1 }).waitFor();
    const dbg = (m, ...args) => app.evaluate((_e, p) => globalThis.__barkDebug[p.m](...p.args), { m, args });
    await dbg('updateSettings', { soundOn: false, cap });
    await control.evaluate(async () => {
      await window.barkControl.call('deck:import-text', { deckId: null, name: 'Capitals', text: 'France,Paris\nPeru,Lima' });
    });

    const info = await app.evaluate(({ BrowserWindow, screen }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('control')) w.hide();
      const win = new BrowserWindow({ x: 360, y: 260, width: 640, height: 420, show: false, title: 'Capture target' });
      void win.loadURL('data:text/html,<body style="background:%234fc3f7">capture target</body>');
      win.show();
      win.focus();
      globalThis.__captureWin = win;
      const d = screen.getDisplayMatching(win.getBounds());
      return { scaleFactor: d.scaleFactor, bounds: d.bounds, workArea: d.workArea };
    });
    // The effects play on the foreground window, so it has to be this one. Windows can refuse a plain focus() while
    // another app is in front; briefly going always-on-top usually gets it through.
    const focused = await until(() =>
      app.evaluate(() => {
        const w = globalThis.__captureWin;
        if (!w.isFocused()) {
          w.setAlwaysOnTop(true);
          w.focus();
          w.setAlwaysOnTop(false);
        }
        return w.isFocused();
      }),
      5000,
      250,
    );
    if (!focused) throw new Error('the test window could not be brought to the front; close whatever holds the focus and retry');
    if (maximise) {
      // Asked for once the window is up; a maximize() straight after creating it can be ignored.
      const maximised = await until(() =>
        app.evaluate(() => {
          if (!globalThis.__captureWin.isMaximized()) globalThis.__captureWin.maximize();
          return globalThis.__captureWin.isMaximized();
        }),
      );
      if (!maximised) throw new Error('the test window would not maximise');
      console.log(`  maximised to ${JSON.stringify(await app.evaluate(() => globalThis.__captureWin.getBounds()))}`);
    }
    console.log(`${name}: display ${info.bounds.width}x${info.bounds.height} at ${info.scaleFactor * 100}% scale, work area ${JSON.stringify(info.workArea)}`);
    await sleep(800); // the tracker sees the window and that it is in front

    await control.evaluate(async () => {
      const snap = await window.barkControl.call('app:snapshot', undefined);
      await window.barkControl.call('session:start', { deckId: snap.decks[0].id, topic: '', checkinMinMinutes: 5, checkinMaxMinutes: 15 });
    });
    await dbg('checkin');
    const started = await until(async () => ((await dbg('moodLog')).at(-1) || {}).effect === effect);
    if (!started) throw new Error(`${effect} never started`);
    const t0 = Date.now();

    for (const [i, at] of atMs.entries()) {
      await sleep(Math.max(0, t0 + at - Date.now()));
      const shot = await app.evaluate(async ({ BrowserWindow, screen }) => {
        const target = globalThis.__captureWin;
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.webContents.getURL().includes('overlay')) continue;
          const b = w.getBounds();
          const t = target.getBounds();
          if (t.x + t.width <= b.x || t.x >= b.x + b.width || t.y + t.height <= b.y || t.y >= b.y + b.height) continue;
          const img = await w.webContents.capturePage();
          // The tracker uses the frame without its invisible resize borders; so does this picture.
          const frame = target.isMaximized() ? screen.getDisplayMatching(t).workArea : t;
          return { png: img.toPNG().toString('base64'), size: img.getSize(), overlay: b, frame, content: target.getContentBounds() };
        }
        return null;
      });
      if (!shot) throw new Error('no overlay over the test window');
      const base = path.join(outDir, `${name}-${i + 1}`);
      fs.writeFileSync(`${base}-overlay.png`, Buffer.from(shot.png, 'base64'));
      fs.writeFileSync(`${base}.png`, Buffer.from(await composite(app, shot, info.workArea), 'base64'));
      const last = (await dbg('moodLog')).at(-1);
      const body = await dbg('body');
      console.log(`  ${path.basename(base)}.png at ${Date.now() - t0} ms: ${JSON.stringify(last)} feet ${Math.round(body.x)},${Math.round(body.y)}`);
    }
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

/** Draws the desktop, the test window and the work area under the overlay capture, in a hidden window of the app. */
async function composite(app, shot, workArea) {
  return app.evaluate(async ({ BrowserWindow }, s) => {
    const win = new BrowserWindow({ show: false, width: 200, height: 200 });
    try {
      await win.loadURL('about:blank');
      const code = `(async () => {
        const s = ${JSON.stringify(s)};
        const k = s.size.width / s.overlay.width;
        const c = document.createElement('canvas');
        c.width = s.size.width; c.height = s.size.height;
        const g = c.getContext('2d');
        const r = (x, y, w, h) => [(x - s.overlay.x) * k, (y - s.overlay.y) * k, w * k, h * k];
        g.fillStyle = '#5b6470'; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#4fc3f7'; g.fillRect(...r(s.frame.x, s.frame.y, s.frame.width, s.frame.height));
        g.fillStyle = '#1f6f99'; g.fillRect(...r(s.frame.x, s.frame.y, s.frame.width, Math.max(0, s.content.y - s.frame.y)));
        g.strokeStyle = '#ff3030'; g.lineWidth = 3; g.strokeRect(...r(s.workArea.x, s.workArea.y, s.workArea.width, s.workArea.height));
        const img = new Image();
        img.src = 'data:image/png;base64,' + s.png;
        await img.decode();
        g.drawImage(img, 0, 0);
        return c.toDataURL('image/png').split(',')[1];
      })()`;
      return await win.webContents.executeJavaScript(code);
    } finally {
      win.destroy();
    }
  }, { ...shot, workArea });
}

(async () => {
  let failed = false;
  const scenarios = [
    // A lap of this window is 2 x (640 + 420) px at 0.45 px/ms, about 4.7 s: these catch the top, the right and bottom, and the left.
    { name: 'laps', effect: 'laps', cap: 3, atMs: [500, 2200, 4200] },
    { name: 'dig', effect: 'dig', cap: 4, atMs: [500, 3000, 6500] },
    // A maximised window fills the work area, so his loop runs along the display's own edges.
    { name: 'laps-maximised', effect: 'laps', cap: 3, atMs: [1500, 4500, 5500], maximise: true },
  ];
  const only = process.argv[3]; // optional: one scenario by name
  for (const s of scenarios.filter((x) => !only || x.name === only)) {
    try {
      await scenario(s);
    } catch (e) {
      failed = true;
      console.error(`${s.name}: FAILED  ${e && e.stack ? e.stack.split('\n')[0] : e}`);
    }
  }
  console.log(failed ? 'some captures failed' : `captures saved in ${outDir}`);
  process.exit(failed ? 1 : 0);
})();
