// Throwaway M0 spike. Modes: s1 s2 s3 s4 all pack. Add --keep to leave the overlay up for manual checks.
const { app, BrowserWindow, screen, ipcMain, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const w32 = require('./win32');

const args = process.argv.slice(1);
const mode = ['s1', 's2', 's3', 's4', 'all', 'pack'].find((m) => args.includes(m)) || 's1';
const keep = args.includes('--keep');
const outDir = process.env.SPIKE_OUT || path.join(__dirname, 'out');

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
const pct = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
const nameOf = (hwnd) => (hwnd ? w32.processName(w32.pidOf(hwnd)) || `pid ${w32.pidOf(hwnd)}` : 'none');

let overlay;
let display;
let ovHwnd = 0;
let ovRoot = 0;
let dog;
let bubble;
let dogClicks = 0;
const submitted = [];
let tracker = () => {};

function createOverlay() {
  display = screen.getPrimaryDisplay();
  const W = display.bounds.width;
  const H = display.bounds.height;
  dog = { x: W - 220, y: H - 200, w: 140, h: 90 };
  bubble = { x: dog.x - 140, y: H - 290, w: 280, h: 64 };
  overlay = new BrowserWindow({
    ...display.bounds,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  ovHwnd = Number(overlay.getNativeWindowHandle().readBigUInt64LE(0));
  ovRoot = w32.rootOf(ovHwnd);
  overlay.loadFile(path.join(__dirname, 'overlay.html'));
  return new Promise((resolve) => overlay.webContents.once('did-finish-load', () => (overlay.showInactive(), resolve())));
}

const toPhys = (dx, dy) => screen.dipToScreenPoint({ x: Math.round(dx + display.bounds.x), y: Math.round(dy + display.bounds.y) });
function toRel(phys) {
  const d = screen.screenToDipRect(null, phys);
  return { x: d.x - display.bounds.x, y: d.y - display.bounds.y, w: d.width, h: d.height };
}
function draw(list, extra = '') {
  const fg = w32.GetForegroundWindow();
  overlay.webContents.send('draw', {
    dog,
    bubble,
    info: `${mode} | scale ${display.scaleFactor} | ${extra}`,
    windows: list.map((w) => ({ rect: toRel(w.bounds), fg: w.hwnd === fg, process: w.process })),
  });
}
const redraw = (extra) => draw(w32.listWindows(process.pid), extra);

ipcMain.on('hit', (_e, over) => overlay.setIgnoreMouseEvents(!over, { forward: true }));
ipcMain.on('dog-click', () => dogClicks++);
ipcMain.on('focus-bubble', (e) => {
  overlay.setFocusable(true);
  overlay.focus();
  e.sender.send('focus-input');
});
ipcMain.on('submit', (_e, v) => {
  submitted.push(v);
  overlay.blur();
  overlay.setFocusable(false);
});

function probeWindow(dipBounds, extra = {}) {
  const win = new BrowserWindow({ ...dipBounds, frame: false, resizable: false, show: true, focusable: false, ...extra });
  win.loadURL('data:text/html,<body style="background:#4fc3f7;margin:0">probe</body>');
  return { win, hwnd: Number(win.getNativeWindowHandle().readBigUInt64LE(0)) };
}

// ---------------------------------------------------------------- S1
async function testS1() {
  record('S1 display', null, `scaleFactor=${display.scaleFactor} dip=${display.bounds.width}x${display.bounds.height} physical=${Math.round(display.size.width * display.scaleFactor)}x${Math.round(display.size.height * display.scaleFactor)}`);
  const top = w32.listWindows(0)[0];
  record('S1 overlay is the topmost visible window', top && w32.rootOf(top.hwnd) === ovRoot, `top=${top ? top.process : 'none'}`);

  const saved = screen.dipToScreenPoint(screen.getCursorScreenPoint());
  const away = toPhys(display.bounds.width / 2, display.bounds.height / 3);
  const dogC = toPhys(dog.x + dog.w / 2, dog.y + dog.h / 2);

  w32.moveMouse(away.x - 20, away.y);
  await sleep(150);
  w32.moveMouse(away.x, away.y);
  await sleep(300);
  const a = w32.windowAt(away.x, away.y);
  record('S1 click-through away from the dog', w32.rootOf(a) !== ovRoot, `window under cursor: ${nameOf(w32.rootOf(a))}`);

  w32.moveMouse(dogC.x - 30, dogC.y);
  await sleep(150);
  w32.moveMouse(dogC.x, dogC.y);
  await sleep(400);
  const d = w32.windowAt(dogC.x, dogC.y);
  const captured = w32.rootOf(d) === ovRoot;
  record('S1 overlay captures the mouse over the dog', captured, `window under cursor: ${nameOf(w32.rootOf(d))}`);
  if (captured) {
    w32.mouseDown();
    w32.mouseUp();
    await sleep(250);
    record('S1 click lands on the dog', dogClicks === 1, `dogClicks=${dogClicks}`);
  } else {
    record('S1 click lands on the dog', false, 'skipped: overlay did not capture, so no click was sent');
  }

  w32.moveMouse(away.x, away.y);
  await sleep(400);
  const r = w32.windowAt(dogC.x, dogC.y);
  record('S1 mouse passes through again after leaving the dog', w32.rootOf(r) !== ovRoot, `window at dog spot: ${nameOf(w32.rootOf(r))}`);
  w32.moveMouse(saved.x, saved.y);
}

// ---------------------------------------------------------------- S2
async function testS2() {
  const { win, hwnd } = probeWindow({ x: 400, y: 260, width: 500, height: 300 });
  await sleep(500);
  const found = w32.listWindows(0).find((w) => w.hwnd === hwnd);
  if (!found) {
    record('S2 probe window found by enumeration', false);
  } else {
    const dip = screen.screenToDipRect(null, found.bounds);
    const want = win.getBounds();
    const off = Math.max(Math.abs(dip.x - want.x), Math.abs(dip.y - want.y), Math.abs(dip.width - want.width), Math.abs(dip.height - want.height));
    record('S2 DWM frame bounds convert to the DIP bounds Electron set', off <= 1, `physical=${JSON.stringify(found.bounds)} dip=${JSON.stringify(dip)} electron=${JSON.stringify(want)} maxOff=${off}`);
    const raw = w32.rawWindowRect(hwnd);
    record('S2 GetWindowRect vs DWM frame (frameless: should match)', null, `raw=${JSON.stringify(raw)}`);
  }
  const own = w32.listWindows(process.pid);
  record('S2 own windows are skipped', !own.some((w) => w.hwnd === hwnd || w.hwnd === ovHwnd), `${own.length} other windows listed`);
  const fg = w32.GetForegroundWindow();
  const fgRoot = w32.rootOf(fg);
  if (w32.pidOf(fg) !== process.pid) {
    record('S2 foreground window is in the list', own.some((w) => w.hwnd === fgRoot), `foreground=${nameOf(fg)}`);
  }
  const t0 = nowMs();
  for (let i = 0; i < 100; i++) w32.listWindows(process.pid);
  const mean = (nowMs() - t0) / 100;
  record('S2 enumeration cost per refresh', mean < 5, `${mean.toFixed(2)} ms mean over 100 (${own.length} windows)`);
  record('S2 process names resolved', own.every((w) => w.process !== ''), own.map((w) => w.process).join(', '));
  win.destroy();
}

// ---------------------------------------------------------------- S3
function startHooks(onEvent) {
  const cb = w32.koffi.register((_hook, event, hwnd, idObject, idChild) => onEvent(event, Number(hwnd), idObject, idChild), w32.koffi.pointer(w32.WinEventProc));
  const ranges = [[0x3, 0x3], [0xa, 0xb], [0x16, 0x17], [0x8001, 0x8003], [0x800b, 0x800b]];
  const hooks = ranges.map(([lo, hi]) => w32.SetWinEventHook(lo, hi, 0, cb, 0, 0, 0 /* WINEVENT_OUTOFCONTEXT */));
  return {
    ok: hooks.every((h) => Number(h) !== 0),
    stop() {
      hooks.forEach((h) => w32.UnhookWinEvent(h));
      w32.koffi.unregister(cb);
    },
  };
}

const EVENT_NAMES = { 3: 'foreground', 10: 'movesizestart', 11: 'movesizeend', 22: 'minimizestart', 23: 'minimizeend', 0x8001: 'destroy', 0x8002: 'show', 0x8003: 'hide', 0x800b: 'locationchange' };
const hookStats = { counts: {}, cbMs: [], flushMs: [], locTimes: [], watch: 0 };
let flushScheduled = false;

function installHookTracker() {
  const hooks = startHooks((event, hwnd, idObject, idChild) => {
    const t = nowMs();
    if (idObject !== 0 || idChild !== 0) return;
    const name = EVENT_NAMES[event] || String(event);
    hookStats.counts[name] = (hookStats.counts[name] || 0) + 1;
    if (event === 0x800b && hwnd === hookStats.watch) hookStats.locTimes.push(t);
    if (!flushScheduled) {
      flushScheduled = true;
      setImmediate(() => {
        flushScheduled = false;
        const f0 = nowMs();
        redraw('hooks');
        hookStats.flushMs.push(nowMs() - f0);
      });
    }
    hookStats.cbMs.push(nowMs() - t);
  });
  tracker = () => hooks.stop();
  return hooks.ok;
}

async function testS3() {
  const { win, hwnd } = probeWindow({ x: 300, y: 200, width: 400, height: 250 });
  await sleep(300);
  hookStats.watch = hwnd;
  hookStats.locTimes.length = 0;
  hookStats.flushMs.length = 0;
  hookStats.cbMs.length = 0;
  const frames = 150;
  const start = win.getPosition();
  await new Promise((resolve) => {
    let i = 0;
    const id = setInterval(() => {
      win.setPosition(start[0] + i * 3, start[1] + Math.round(Math.sin(i / 10) * 40));
      if (++i >= frames) (clearInterval(id), resolve());
    }, 16);
  });
  await sleep(300);
  const times = hookStats.locTimes;
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  record('S3 hook delivers location changes for a moving window', times.length >= 100, `${times.length} events for ${frames} moves`);
  record('S3 largest gap between location events', pct(gaps, 1) <= 100, `max ${pct(gaps, 1).toFixed(1)} ms, p95 ${pct(gaps, 0.95).toFixed(1)} ms`);
  record('S3 callback cost (runs on the main thread)', pct(hookStats.cbMs, 1) < 5, `max ${pct(hookStats.cbMs, 1).toFixed(2)} ms over ${hookStats.cbMs.length} calls`);
  record('S3 redraw flush cost', pct(hookStats.flushMs, 0.95) < 8, `p95 ${pct(hookStats.flushMs, 0.95).toFixed(2)} ms, max ${pct(hookStats.flushMs, 1).toFixed(2)} ms over ${hookStats.flushMs.length} flushes`);
  const final = w32.listWindows(0).find((w) => w.hwnd === hwnd);
  const want = screen.dipToScreenPoint({ x: win.getBounds().x, y: win.getBounds().y });
  record('S3 tracked position equals the window after the last event', !!final && Math.abs(final.bounds.x - want.x) <= 1 && Math.abs(final.bounds.y - want.y) <= 1, final ? `tracked ${final.bounds.x},${final.bounds.y} window ${want.x},${want.y}` : 'not found');
  record('S3 event counts', null, JSON.stringify(hookStats.counts));
  win.destroy();
}

// ---------------------------------------------------------------- S4
async function testS4() {
  const prevFg = w32.GetForegroundWindow();
  const bc = toPhys(bubble.x + bubble.w / 2, bubble.y + bubble.h / 2);
  const saved = screen.dipToScreenPoint(screen.getCursorScreenPoint());
  w32.moveMouse(bc.x - 40, bc.y);
  await sleep(150);
  w32.moveMouse(bc.x, bc.y);
  await sleep(400);
  if (w32.rootOf(w32.windowAt(bc.x, bc.y)) !== ovRoot) {
    record('S4 bubble reachable', false, 'overlay did not own the bubble, so no click or keys were sent');
    w32.moveMouse(saved.x, saved.y);
    return;
  }
  w32.mouseDown();
  w32.mouseUp();
  await sleep(700);
  const fg = w32.GetForegroundWindow();
  const focused = w32.rootOf(fg) === ovRoot;
  record('S4 overlay takes keyboard focus on a bubble click', focused, `foreground=${nameOf(fg)}`);
  w32.moveMouse(saved.x, saved.y);
  if (!focused) return;

  w32.tapKey(0x48);
  w32.tapKey(0x49);
  await sleep(150);
  w32.tapKey(0x0d);
  await sleep(700);
  record('S4 typed text reaches the bubble input', submitted[0] === 'hi', `submitted=${JSON.stringify(submitted)}`);
  await sleep(400);
  const after = w32.GetForegroundWindow();
  record('S4 focus returns to the previous app after submit (without us calling SetForegroundWindow)', after === prevFg, `before=${nameOf(prevFg)} after=${nameOf(after)}`);

  // Esc: registered only while an effect runs, then released.
  const probe = new BrowserWindow({ width: 300, height: 140, x: 600, y: 300, title: 'esc probe', show: true });
  probe.loadURL('data:text/html,<body>esc probe</body>');
  let probeEsc = 0;
  let escHits = 0;
  probe.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') probeEsc++;
  });
  await sleep(500);
  probe.focus();
  await sleep(500);
  const probeHwnd = Number(probe.getNativeWindowHandle().readBigUInt64LE(0));
  if (w32.rootOf(w32.GetForegroundWindow()) !== probeHwnd) {
    record('S4 Esc test', null, 'skipped: could not put the probe window in the foreground, so no Esc was sent');
  } else {
    const ok = globalShortcut.register('Escape', () => escHits++);
    w32.tapKey(0x1b);
    await sleep(400);
    record('S4 registered Esc is captured globally', ok && escHits === 1 && probeEsc === 0, `registered=${ok} hits=${escHits} reachedFocusedWindow=${probeEsc}`);
    globalShortcut.unregister('Escape');
    w32.tapKey(0x1b);
    await sleep(400);
    record('S4 after unregister, Esc reaches the focused window normally', escHits === 1 && probeEsc === 1, `hits=${escHits} reachedFocusedWindow=${probeEsc}`);
  }
  probe.destroy();
}

// ---------------------------------------------------------------- pack (S5 installed-app smoke test)
async function testPack() {
  const list = w32.listWindows(process.pid);
  record('PACK koffi loads and enumerates windows inside the packaged app', list.length >= 0, `${list.length} windows; electron ${process.versions.electron}`);
  record('PACK overlay window created and page loaded', !!overlay && !overlay.isDestroyed());
  const hooks = startHooks(() => {});
  record('PACK SetWinEventHook works inside the packaged app', hooks.ok);
  hooks.stop();
  record('PACK running from', null, app.getAppPath());
}

async function main() {
  await app.whenReady();
  await createOverlay();
  await sleep(300);
  if (mode === 's3' || mode === 'all') {
    if (!installHookTracker()) record('hooks installed', false);
  } else {
    const id = setInterval(() => redraw('poll 20Hz'), 50);
    tracker = () => clearInterval(id);
  }
  redraw();

  if (mode === 's1' || mode === 'all') await testS1();
  if (mode === 's2' || mode === 'all') await testS2();
  if (mode === 's3' || mode === 'all') await testS3();
  if (mode === 's4' || mode === 'all') await testS4();
  if (mode === 'pack') await testPack();

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${mode}.json`), JSON.stringify({ mode, scaleFactor: display.scaleFactor, results }, null, 2));
  const failed = results.filter((r) => r.pass === false).length;
  console.log(`\n${mode}: ${results.filter((r) => r.pass === true).length} pass, ${failed} fail, ${results.filter((r) => r.pass === null).length} info`);
  if (keep) {
    console.log('--keep: overlay stays up. Close it with Ctrl+C in the terminal that launched it.');
    return;
  }
  tracker();
  app.exit(failed ? 1 : 0);
}

app.on('window-all-closed', () => {});
main().catch((e) => {
  console.error('SPIKE ERROR', e);
  app.exit(2);
});
