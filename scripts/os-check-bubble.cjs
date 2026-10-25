// Manual OS-level check of the flashcard bubble (Windows only). It drives your REAL mouse and keyboard for about 15 seconds:
// run it on an idle desktop with `npm run build` done first:  node scripts/os-check-bubble.cjs
// Prints PASS/FAIL for click-through, pointer capture, keyboard focus in and out, Esc, and the Ctrl+Alt+A hotkey.
// Drives the REAL mouse and keyboard, so it only sends input when the OS confirms our overlay is where it should be.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { _electron: electron } = require(`${ROOT}/node_modules/@playwright/test`);
const koffi = require(`${ROOT}/node_modules/koffi`);

const user32 = koffi.load('user32.dll');
koffi.struct('POINT', { x: 'long', y: 'long' });
const SetProcessDpiAwarenessContext = user32.func('bool __stdcall SetProcessDpiAwarenessContext(intptr_t v)');
const WindowFromPoint = user32.func('void* __stdcall WindowFromPoint(POINT pt)');
const GetAncestor = user32.func('void* __stdcall GetAncestor(void* h, uint32 flags)');
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int x, int y)');
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ POINT* p)');
const mouse_event = user32.func('void __stdcall mouse_event(uint32 flags, uint32 dx, uint32 dy, uint32 data, uintptr_t extra)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)');
SetProcessDpiAwarenessContext(-4); // per-monitor v2, so coordinates are physical pixels like the OS reports them

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hwndOf = (p) => (p ? koffi.address(p) : 0n);
const rootAt = (x, y) => hwndOf(GetAncestor(WindowFromPoint({ x: Math.round(x), y: Math.round(y) }), 2));
const fg = () => hwndOf(GetForegroundWindow());
const hex = (h) => '0x' + h.toString(16);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
async function until(fn, ms = 2500, step = 60) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return false;
    await sleep(step);
  }
}
function key(vk, down) {
  keybd_event(vk, 0, down ? 0 : 2, 0);
}
async function tap(vk) {
  key(vk, true);
  await sleep(40);
  key(vk, false);
}
async function moveTo(x, y) {
  // A tiny wiggle makes sure the page sees a real mousemove at the destination.
  SetCursorPos(Math.round(x) - 2, Math.round(y) - 2);
  await sleep(40);
  SetCursorPos(Math.round(x), Math.round(y));
  // SetCursorPos alone does not always produce the mouse-move message windows listen for; a one-pixel nudge of real input does.
  mouse_event(0x0001, 1, 0, 0, 0);
  await sleep(30);
  mouse_event(0x0001, (-1) >>> 0, 0, 0, 0);
  await sleep(120);
}
async function click() {
  mouse_event(0x0002, 0, 0, 0, 0);
  await sleep(50);
  mouse_event(0x0004, 0, 0, 0, 0);
}

(async () => {
  const startCursor = (() => {
    const p = {};
    GetCursorPos(p);
    return p;
  })();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'barkstudy-os-check-'));
  const env = { ...process.env, BARKSTUDY_E2E: '1', BARKSTUDY_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  let app = null;
  try {
    app = await electron.launch({ args: ['.'], cwd: ROOT, env });
    const control = await until(() => app.windows().find((w) => w.url().includes('control')), 20000);
    if (!control) throw new Error('control window never appeared');
    await control.getByRole('heading', { level: 1 }).waitFor();

    // A deck and a session, through the app's own API.
    await control.evaluate(async () => {
      const api = window.barkControl;
      await api.call('deck:import-text', { deckId: null, name: 'Capitals', text: 'France,Paris\nPeru,Lima' });
      const snap = await api.call('app:snapshot', undefined);
      await api.call('session:start', { deckId: snap.decks[0].id, topic: '', checkinMinMinutes: 5, checkinMaxMinutes: 15 });
    });
    const dbg = (m) =>
      app.evaluate((_e, name) => globalThis.__barkDebug[name](), m);
    await dbg('checkin');

    // Which overlay is showing the bubble, and where is it on the real screen?
    const overlayPage = await until(async () => {
      for (const w of app.windows().filter((x) => x.url().includes('overlay'))) {
        if (await w.locator('#bubble').isVisible()) return w;
      }
      return null;
    }, 8000);
    if (!overlayPage) throw new Error('no overlay is showing the bubble');

    const origin = await overlayPage.evaluate(() => ({ x: window.screenX, y: window.screenY }));
    const overlays = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.webContents.getURL().includes('overlay'))
        .map((w) => ({ hwnd: Number(w.getNativeWindowHandle().readBigUInt64LE(0)), x: w.getBounds().x, y: w.getBounds().y })),
    );
    const mine = overlays.find((o) => o.x === origin.x && o.y === origin.y);
    if (!mine) throw new Error('could not match the overlay window to its handle');
    const overlayHwnd = BigInt(mine.hwnd);

    async function rectOnScreen(selector) {
      const r = await overlayPage.locator(selector).evaluate((n) => {
        const b = n.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      });
      const tl = await app.evaluate(({ screen }, p) => screen.dipToScreenPoint(p), { x: origin.x + r.x, y: origin.y + r.y });
      const br = await app.evaluate(({ screen }, p) => screen.dipToScreenPoint(p), { x: origin.x + r.x + r.w, y: origin.y + r.y + r.h });
      return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    }
    const bubble = await rectOnScreen('#bubble');
    const input = await rectOnScreen('#bubble-input');
    console.log(`overlay ${hex(overlayHwnd)}, bubble at ${Math.round(bubble.x)},${Math.round(bubble.y)} ${Math.round(bubble.w)}x${Math.round(bubble.h)} (physical px)`);

    // 1. Capture over the bubble.
    await moveTo(bubble.x + bubble.w / 2, bubble.y + 12);
    const over = await until(() => rootAt(bubble.x + bubble.w / 2, bubble.y + 12) === overlayHwnd);
    check('the pointer over the bubble is captured by the overlay', !!over);

    // 2. Click-through well away from it.
    const screenW = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().size.width * screen.getPrimaryDisplay().scaleFactor);
    const screenH = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().size.height * screen.getPrimaryDisplay().scaleFactor);
    const candidates = [[screenW * 0.5, screenH * 0.5], [screenW * 0.2, screenH * 0.5], [screenW * 0.8, screenH * 0.5], [screenW * 0.5, screenH * 0.2], [screenW * 0.5, screenH * 0.8]];
    const far = candidates.find(([x, y]) => Math.abs(x - (bubble.x + bubble.w / 2)) > 400 || Math.abs(y - (bubble.y + bubble.h / 2)) > 400);
    await moveTo(far[0], far[1]);
    await sleep(300);
    const through = rootAt(far[0], far[1]) !== overlayHwnd;
    check('away from the dog and bubble, clicks pass through the overlay', through, `root ${hex(rootAt(far[0], far[1]))}`);

    // 3. A click inside the bubble gives the overlay the keyboard.
    const before = fg();
    await moveTo(input.x + input.w / 2, input.y + input.h / 2);
    if (rootAt(input.x + input.w / 2, input.y + input.h / 2) !== overlayHwnd) {
      check('the input is under the pointer (needed to click it)', false);
    } else {
      await click();
      const gotFocus = await until(() => fg() === overlayHwnd);
      check('a click in the bubble makes the overlay the foreground window', !!gotFocus, `was ${hex(before)}, now ${hex(fg())}`);

      if (gotFocus) {
        // 4. Typing reaches the input.
        await tap(0x50); // P
        await tap(0x41); // A
        await sleep(150);
        const typed = await overlayPage.locator('#bubble-input').inputValue();
        check('typing reaches the answer box', typed.toLowerCase() === 'pa', `got "${typed}"`);

        // 5. Esc dismisses, does not answer, and focus goes back.
        await tap(0x1b);
        const dismissed = await until(async () => (await dbg('bubbleState'))?.open === false);
        const view = await dbg('sessionView');
        check('Esc hides the bubble but the question stays pending and unanswered', !!dismissed && view.answered === 0 && view.card !== null);
        const released = await until(() => fg() !== overlayHwnd);
        check('focus leaves the overlay after Esc', !!released, `foreground now ${hex(fg())}`);
        check('the overlay is not focusable again until asked', fg() !== overlayHwnd);
      }
    }

    // 6. The hotkey brings the question back and puts the cursor in the box.
    const registered = await dbg('bubbleHotkeyRegistered');
    check('Ctrl+Alt+A is registered while a question is waiting', registered === true);
    if (registered) {
      key(0x11, true);
      key(0x12, true);
      await sleep(40);
      await tap(0x41);
      key(0x12, false);
      key(0x11, false);
      const reopened = await until(async () => (await dbg('bubbleState'))?.open === true);
      check('Ctrl+Alt+A reopens the dismissed bubble', !!reopened);
      const focused = await until(() => fg() === overlayHwnd);
      check('Ctrl+Alt+A gives the overlay the keyboard', !!focused, `foreground ${hex(fg())}`);
      const inBox = await until(() => overlayPage.evaluate(() => document.activeElement && document.activeElement.id === 'bubble-input'));
      check('and the cursor is in the answer box', !!inBox);

      // 7. Answer from the keyboard alone: type, Enter.
      if (focused && inBox) {
        // The half-typed "pa" from before survives Esc (a draft is kept), so replace it: Ctrl+A, then type over it.
        key(0x11, true);
        await tap(0x41);
        key(0x11, false);
        for (const vk of [0x50, 0x41, 0x52, 0x49, 0x53]) await tap(vk); // PARIS
        await tap(0x0d);
        const verdict = await until(async () => (await overlayPage.locator('#bubble-fb').textContent())?.includes('Correct'));
        check('typing PARIS and pressing Enter is graded correct', !!verdict);
        const releasedAfter = await until(() => fg() !== overlayHwnd);
        check('focus is handed back once the answer is in', !!releasedAfter);
      }
    }

    // 8. After the question is gone the hotkey is free again and the overlay no longer swallows the pointer.
    await sleep(200);
    await dbg('bubbleHotkeyRegistered').then((v) => check('Ctrl+Alt+A is released once nothing is waiting', v === false));
    await moveTo(bubble.x + bubble.w / 2, bubble.y + 12);
    await overlayPage.keyboard.press('Enter'); // clear the verdict
    await sleep(400);
    await moveTo(bubble.x + bubble.w / 2 + 3, bubble.y + 14);
    await sleep(300);
    check('with no bubble the old bubble area is click-through again', rootAt(bubble.x + bubble.w / 2, bubble.y + 12) !== overlayHwnd);
  } catch (e) {
    check('script ran to the end', false, String(e && e.stack ? e.stack.split('\n')[0] : e));
  } finally {
    for (const vk of [0x11, 0x12, 0x10, 0x1b]) key(vk, false); // never leave a key held
    SetCursorPos(startCursor.x, startCursor.y);
    if (app) await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  }
})();
