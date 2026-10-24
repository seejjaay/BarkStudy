# M2: Overlay and Window Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pandesal appears on the desktop, stands on real title bars, rides along when a window is dragged, falls when it disappears, lets clicks through everywhere except the dog, and falls back to edge-roaming if window tracking fails.

**Architecture:** Pure geometry and physics live in `src/shared` (no Electron, no Node, fully unit-tested). The main process owns a koffi window tracker (WinEvent hooks + 1 s reconciliation poll), a `dogHost` that runs physics at 60 Hz only while something moves, and one click-through overlay window per display. Overlays are dumb: they draw the frame main sends and report whether the cursor is over the dog. The engine is not wired in yet (M3); the dog roams on its own.

**Tech Stack:** Electron 45 + electron-vite, koffi, TypeScript strict, Vitest, Playwright (`_electron`) for the acceptance e2e.

**Spec:** `docs/SPEC.md` (vision) + `PLAN.md` (decisions; Milestone 2 outline) + `docs/spike-results.md` (M0 evidence and decisions).

## Global Constraints

- `src/engine/**` **and `src/shared/**`** import nothing from `electron`, `react`, `react-dom`, `node:*` or DOM APIs; enforced by ESLint `no-restricted-imports` and by `tsconfig.engine.json` (whose `include` gains `src/shared`).
- No `Math.random()` in `src/`; randomness goes through `src/engine/rng.ts`.
- Win32 reads are limited to window bounds, z-order, foreground hwnd, minimized/cloaked flags and process image name. Never `GetWindowText`, window contents or screenshots. Never move, close, resize, focus or send input to another window.
- Bounds come from `DWMWA_EXTENDED_FRAME_BOUNDS`, never `GetWindowRect` (spike: 16 px wider / 8 px taller even for frameless windows). Physical → DIP via `screen.screenToDipRect(null, rect)` (spike-verified to ±1 DIP).
- One overlay window per display (spike decision 2). Overlay: transparent, frameless, `alwaysOnTop('screen-saver')`, `skipTaskbar`, `focusable:false`, `setIgnoreMouseEvents(true,{forward:true})`, toggled by a renderer hit-test over IPC.
- Electron hardening: `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, narrow `contextBridge` API, CSP `default-src 'self'`.
- Network: the renderer makes zero requests. The session cancels everything except `file:`, `devtools:` and the electron-vite dev-server origin (http + ws). No `window.open`, no navigation.
- Anything that launches Electron (scripts, Playwright) must strip `ELECTRON_RUN_AS_NODE` (VS Code sets it; Electron then runs as plain Node).
- npm 12 blocks install scripts: after installing `electron`, run `node node_modules/electron/install.js` (or `npm install-scripts approve electron`).
- Every task ends with `npm run typecheck && npm run lint && npm test` green. Commits are at the commit steps below.

## Decisions this plan makes

1. **Physics runs in main**, not the renderer. With one overlay per display, the dog crosses displays; main owns one `DogBody` and sends a frame only to the overlay the dog is on.
2. **Tracker = hooks + reconciliation.** WinEvent hooks drive updates (coalesced 16 ms); a 1 s poll re-reads the window list and emits only on change, covering missed events and a silently dead hook. Any FFI throw → `onDown` → edge-roaming for the rest of the run.
3. **Platform clamp.** A top edge closer than `DOG.height` to the work-area top (maximised windows) becomes a platform at `workArea.y + DOG.height`, so the dog stays visible standing "in" the title bar.
4. **Fullscreen foreground hides the dog** on that display (frame `null`, no hit region). Prompts/effects suppression is M3.
5. **Overlay renderer is plain TypeScript + canvas** (no React; React arrives with the control window in M3). Placeholder dog drawn with canvas paths until M4 art.
6. **No pure `toDip(rect, scale)`** (PLAN.md T2.1 listed one). Electron's `screen.screenToDipRect` handles mixed-DPI layouts correctly and the spike verified it; geometry takes the converter as a parameter so tests can inject per-scale fixtures pinned to spike output.
7. **Own windows are never platforms** (excluded by pid). E2E sets `BARKSTUDY_E2E=1` (dev builds only) to track own windows except overlays, so tests can drag a window they control without touching other apps.

## Review Focus

1. **A ridden window dragged off-screen or to another display.** The dog must end on a visible platform, never off-screen. → Task 2 test `riding window moved to x=-5000 ends on the nearest floor`.
2. **Display change while running** (scale change, dock/undock, display removed). Overlays rebuild and the dog respawns on a remaining display. → Task 4 test `display removed respawns the dog on a remaining display`; Task 5 wires `screen` events.
3. **Maximised and fullscreen windows.** Maximised: dog visible on the clamped platform. Fullscreen foreground: dog hidden, clicks pass everywhere. → Task 1 tests `maximised window top edge clamps to headroom`, `fullscreen foreground hides its display`; Task 4 `fullscreen foreground on the dog's display sends null`.
4. **Garbage from Win32** (zero/negative size, NaN, absurd coordinates). Filtered, never a crash or a NaN dog. → Task 1 test `drops non-finite and non-positive windows`.
5. **Forged or malformed IPC** (`overlay:hit` with a non-boolean, or from a non-overlay sender). Ignored. → Task 5 test `isHitMessage accepts only booleans`, sender check via `ownsSender`.

---

## File structure

```text
src/shared/geometry.ts        Rect/Display/Window/Platform types, toDipWindows, visibleTopEdges, occludersFor, clipSprite, hiddenDisplayIds
src/shared/physics.ts         DOG, constants, DogBody, spawnDog, stepDog, edgeContact
src/shared/roam.ts            RoamState, roamStep (seeded)
src/shared/ipc.ts             IPC channel names, DogFrame
src/main/tracker/win32.ts     koffi bindings (read-only), realWin32(): Win32Api
src/main/tracker/tracker.ts   createTracker(api, opts)
src/main/dogHost.ts           createDogHost(opts): body + roam + 60 Hz tick while moving
src/main/network.ts           isAllowedUrl, installNetworkGuard
src/main/overlay.ts           createOverlayManager, isHitMessage
src/main/debug.ts             E2E-only debug surface (BARKSTUDY_E2E=1 && !app.isPackaged)
src/main/index.ts             wiring
src/preload/overlay.ts        contextBridge: onFrame, hit
src/renderer/overlay/         index.html, main.ts, draw.ts, hit.ts
electron.vite.config.ts  playwright.config.ts
tests/shared/  tests/main/  tests/renderer/  tests/e2e/
docs/test-matrix.md
```

---

### Task 1: Geometry

**Files:**
- Create: `src/shared/geometry.ts`
- Modify: `eslint.config.js` (engine purity block's `files` → `['src/engine/**/*.ts', 'src/shared/**/*.ts']`), `tsconfig.engine.json` (`include: ["src/engine", "src/shared"]`)
- Test: `tests/shared/geometry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Rect { x: number; y: number; width: number; height: number }
  interface DisplayInfo { id: number; bounds: Rect; workArea: Rect; scaleFactor: number }        // DIP
  interface RawWindow { id: number; bounds: Rect; processName: string; isForeground: boolean } // physical px, z-order top first
  interface TrackedWindow { id: number; bounds: Rect; z: number; processName: string; isForeground: boolean; fullscreen: boolean } // DIP, z 0 = top
  interface Platform { windowId: number | null; displayId: number; x1: number; x2: number; y: number; originX: number } // floor: windowId null, originX = workArea.x
  const MIN_PLATFORM_WIDTH = 32;
  toDipWindows(raw: readonly RawWindow[], toDip: (r: Rect) => Rect, displays: readonly DisplayInfo[]): TrackedWindow[]
  visibleTopEdges(windows: readonly TrackedWindow[], displays: readonly DisplayInfo[], headroom: number): Platform[]
  occludersFor(windowId: number | null, windows: readonly TrackedWindow[]): Rect[]
  clipSprite(sprite: Rect, occluders: readonly Rect[]): Rect[]
  hiddenDisplayIds(windows: readonly TrackedWindow[], displays: readonly DisplayInfo[]): Set<number>
  ```

Fixture used throughout: `D1 = { id: 1, bounds: {x:0,y:0,width:1536,height:864}, workArea: {x:0,y:0,width:1536,height:824}, scaleFactor: 1.25 }`, headroom `48`.

- [ ] **Step 1: Write the failing tests** (`tests/shared/geometry.test.ts`)
  - `test helper dipAt(1.25) reproduces the spike's Electron conversion`: `dipAt(1.25)({x:499,y:325,width:632,height:381})` → `{x:399,y:260,width:506,height:305}` (helper rounds left/top/right/bottom edges separately; this pins the fixtures to real Electron output).
  - `toDipWindows assigns z in input order and marks fullscreen`: two raws → `z` 0 and 1; a raw whose DIP bounds equal `D1.bounds` (±1) → `fullscreen: true`.
  - `drops non-finite and non-positive windows`: raws with `width: 0`, `height: -5`, `x: NaN`, `y: Infinity` are absent from the result; `z` of survivors stays contiguous.
  - `overlapping stack: lower window's edge is cut where the upper one covers it`: A `{100,100,400,300}` z0, B `{300,200,500,300}` z1 → contains `{windowId:A, x1:100, x2:500, y:100}` and `{windowId:B, x1:500, x2:800, y:200}`, and the floor `{windowId:null, displayId:1, x1:0, x2:1536, y:824, originX:0}`.
  - `maximised window top edge clamps to headroom`: `{0,0,1536,824}` → platform `y: 48`, `x1: 0`, `x2: 1536`.
  - `edge segments shorter than MIN_PLATFORM_WIDTH are dropped`.
  - `window partly off-screen is clipped to the work area`: `{-200,300,500,200}` → `x1: 0, x2: 300`.
  - `fullscreen windows give no platform` and `fullscreen foreground hides its display`: `hiddenDisplayIds` → `Set{1}`; non-foreground fullscreen → empty set.
  - `platform y matches window top at scales 1.0, 1.25, 1.5`: build windows with `dipAt(s)` from the same physical rect; each platform `y` equals that window's DIP `y`.
  - `occludersFor returns windows above; floor returns all`.
  - `clipSprite`: no occluders → `[sprite]`; occluder `{32,-10,100,100}` on sprite `{0,0,64,48}` → `[{0,0,32,48}]`; middle occluder `{20,10,10,10}` → pieces pairwise non-overlapping, none intersecting the occluder, total area `64*48-100`; fully covered → `[]`.

- [ ] **Step 2: Run** `npx vitest run tests/shared/geometry.test.ts`. Expected: FAIL, cannot find `src/shared/geometry`.
- [ ] **Step 3: Implement `src/shared/geometry.ts`** with the Interfaces above. Occlusion at the edge line: occluder covers `(x, y)` iff `o.x <= x < o.x+o.width && o.y <= y < o.y+o.height`; subtract covered intervals from the edge segment. Platforms are per display: intersect each segment with each display's work area horizontally, and keep it only if `workArea.y + headroom <= y < workArea.y + workArea.height`. `clipSprite` is rectangle subtraction (split into up to four bands per occluder).
- [ ] **Step 4: Run** the test file, then `npm run typecheck && npm run lint && npm test`. Expected: all PASS; adding `src/shared` to the purity rules raises no errors.
- [ ] **Step 5: Commit** `feat(shared): window geometry and platforms`.

### Task 2: Physics and roaming

**Files:**
- Create: `src/shared/physics.ts`, `src/shared/roam.ts`
- Test: `tests/shared/physics.test.ts`, `tests/shared/roam.test.ts`

**Interfaces:**
- Consumes: `Platform`, `DisplayInfo` (Task 1); `RngState`, `nextFloat`, `nextInt` (`src/engine/rng.ts`).
- Produces:
  ```ts
  const DOG = { width: 64, height: 48 };
  const GRAVITY = 0.0025;            // px/ms²
  const MAX_FALL_SPEED = 1.5;        // px/ms
  const WALK_SPEED = 0.06;           // px/ms
  const REDUCED_WALK_SPEED = 0.03;   // px/ms
  const MAX_STEP_MS = 50;            // dt is clamped to this
  type Walk = -1 | 0 | 1;
  interface Anchor { windowId: number | null; displayId: number; dx: number } // dx = feet x - platform.originX
  interface DogBody { x: number; y: number; vy: number; facing: 1 | -1; anchor: Anchor | null } // x = feet centre, y = feet, DIP
  spawnDog(platforms: readonly Platform[], displays: readonly DisplayInfo[]): DogBody   // centre of the first display's floor, anchored
  stepDog(dog: DogBody, platforms: readonly Platform[], displays: readonly DisplayInfo[], dtMs: number, walk: Walk, speed?: number): DogBody
  edgeContact(dog: DogBody, platforms: readonly Platform[]): Walk   // -1 at left end, 1 at right end, 0 otherwise
  // roam.ts
  interface RoamState { walk: Walk; untilMs: number }
  roamStep(s: RoamState, nowMs: number, atEdge: Walk, rng: RngState): [RoamState, RngState]
  ```

- [ ] **Step 1: Write the failing physics tests**
  - `anchored dog rides a window moved 300 px over 30 steps`: platform `originX` advances 10 px per step; final `x` = start + 300, `anchor.windowId` unchanged.
  - `a 100 px/frame drag in any direction does not shake the dog off` (right, left, up, down, 10 steps each).
  - `platform vanishes → dog falls and lands on the next platform below`: lands with `y` = that platform's `y`, `vy` 0, anchored to it.
  - `falling at max speed onto a thin platform does not tunnel` (dt `MAX_STEP_MS`, travel per step > distance to the platform).
  - `dt is clamped to MAX_STEP_MS` (a 10 s step falls no further than one 50 ms step).
  - `walking stops at the segment end`; `edgeContact` reports `1` there.
  - `walk speed: 1000 ms of walk 1 moves 60 px; REDUCED_WALK_SPEED moves 30 px`.
  - `riding window moved to x=-5000 ends on the nearest floor` (dog ends anchored to `windowId: null` of the display nearest its x, within that work area).
  - `spawnDog stands on the first display's floor centre`.
  - `stepDog does not mutate its input`.
- [ ] **Step 2: Write the failing roam tests**
  - `after untilMs it picks sit about 40% and walk about 60% over 10k draws` (±3 %).
  - `sit lasts 3000–10000 ms, walk 2000–6000 ms` (fast-check over seeds).
  - `walking into an edge reverses direction and keeps untilMs`.
  - `deterministic for the same rng`.
- [ ] **Step 3: Run** `npx vitest run tests/shared`. Expected: FAIL, modules missing.
- [ ] **Step 4: Implement** both files. Falling is a swept test: land on the smallest `p.y` with `x1 <= x <= x2` and `prevY <= p.y <= newY`. Anchored: find the anchor window's segment containing `originX + dx (+ walk move)`; none → unanchor with `vy = 0`. Lost (x outside every display, or below every floor) → anchor to the nearest display's floor, x clamped into its work area.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(shared): dog physics and roaming`.

### Task 3: Window tracker

**Files:**
- Create: `src/main/tracker/win32.ts`, `src/main/tracker/tracker.ts`
- Modify: `package.json` (`npm i -E koffi`)
- Test: `tests/main/tracker.test.ts`, `tests/main/forbidden-win32.test.ts`

**Interfaces:**
- Consumes: `RawWindow`, `Rect` (Task 1).
- Produces:
  ```ts
  interface Win32Window { id: number; pid: number; bounds: Rect; processName: string } // physical, z-order top first, already filtered: visible, not tool window, not cloaked, not minimized, non-empty
  interface Win32Api { listWindows(): Win32Window[]; foreground(): number; hook(onEvent: () => void): () => void } // hook returns unhook
  realWin32(): Win32Api                                  // win32.ts, koffi (port of spike/win32.js, read-only calls only)
  interface TrackerOptions { excludePid: number | null; excludeIds: () => ReadonlySet<number>; onChange: (w: RawWindow[]) => void; onDown: (err: unknown) => void; coalesceMs?: number /* 16 */; reconcileMs?: number /* 1000 */ }
  interface Tracker { start(): void; stop(): void; kill(reason: string): void; readonly running: boolean }
  createTracker(api: Win32Api, opts: TrackerOptions): Tracker
  ```
  `realWin32().hook` registers `SetWinEventHook(WINEVENT_OUTOFCONTEXT)` for foreground (0x3), move/size start/end (0xA–0xB), minimize start/end (0x16–0x17), destroy/show/hide (0x8001–0x8003), location change (0x800B), and calls `onEvent` only for `idObject === 0 && idChild === 0`.

- [ ] **Step 1: Write the failing tests** (fake `Win32Api`, `vi.useFakeTimers()`):
  - `start emits the current windows once`.
  - `a burst of 50 hook events within 16 ms emits one change`.
  - `own pid and excluded ids are skipped`.
  - `isForeground is set from api.foreground()`.
  - `reconcile poll emits a change no hook reported` (advance 1000 ms after mutating the fake list).
  - `no emit when the list is unchanged`.
  - `an api throw stops the tracker and calls onDown once` (throw from `listWindows`; then advancing time calls nothing more).
  - `kill() behaves like a failure` (`onDown` once, `running` false).
  - `stop unhooks and clears timers`.
  - `forbidden-win32.test.ts`: recursively read `src/**/*.ts`; no match for `/GetWindowText|SetWindowPos|MoveWindow|ShowWindow|SetForegroundWindow|SendInput|keybd_event|mouse_event|PostMessage|SendMessage|PrintWindow|BitBlt/`.
- [ ] **Step 2: Run** `npx vitest run tests/main`. Expected: tracker tests FAIL (module missing); forbidden test PASS (nothing in `src/main` yet). That's expected: it is a guard.
- [ ] **Step 3: Implement** `tracker.ts` (coalesce with one pending `setTimeout(coalesceMs)`; dedupe by comparing a JSON key of the emitted list; wrap every api call in try/catch → fail once) and `win32.ts` (port `spike/win32.js` bindings for `EnumWindows`, `IsWindowVisible`, `IsIconic`, `GetWindowLongPtrW`, `DwmGetWindowAttribute` (cloaked 14, frame bounds 9), `GetWindowThreadProcessId`, `OpenProcess`/`QueryFullProcessImageNameW`/`CloseHandle`, `GetForegroundWindow`, `SetWinEventHook`, `UnhookWinEvent`; register koffi callbacks once).
- [ ] **Step 4: Smoke the real binding** (Windows only): `npx tsx -e "import('./src/main/tracker/win32.ts').then(m => console.log(m.realWin32().listWindows().length))"`. Expected: a number ≥ 1, no throw.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(main): window tracker`.

### Task 4: Dog host

**Files:**
- Create: `src/shared/ipc.ts`, `src/main/dogHost.ts`
- Test: `tests/main/dogHost.test.ts`

**Interfaces:**
- Consumes: Task 1 (`TrackedWindow`, `DisplayInfo`, `visibleTopEdges`, `occludersFor`, `clipSprite`, `hiddenDisplayIds`), Task 2 (`DOG`, `spawnDog`, `stepDog`, `edgeContact`, `WALK_SPEED`, `REDUCED_WALK_SPEED`, `roamStep`), `createRng`.
- Produces:
  ```ts
  // src/shared/ipc.ts
  const IPC = { overlayFrame: 'overlay:frame', overlayHit: 'overlay:hit' } as const;
  interface DogFrame { x: number; y: number; facing: 1 | -1; pose: 'walk' | 'sit' | 'fall'; clip: Rect[]; reducedMotion: boolean } // relative to the display's bounds origin, DIP
  // src/main/dogHost.ts
  interface FrameSink { send(displayId: number, frame: DogFrame | null): void }
  interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
  interface DogHost {
    setWorld(windows: readonly TrackedWindow[], displays: readonly DisplayInfo[]): void;
    setTrackerDown(): void;
    setReducedMotion(on: boolean): void;
    placeOn(windowId: number): boolean;      // debug/e2e
    readonly mode: 'tracking' | 'edge-roaming';
    body(): DogBody;
    dispose(): void;
  }
  createDogHost(opts: { seed: number; sink: FrameSink; clock?: Clock }): DogHost
  const TICK_MS = 16; const SETTLE_MS = 250;
  ```
  Ticks every `TICK_MS` while the dog walks or falls, or within `SETTLE_MS` of the last `setWorld`; otherwise sleeps until the roam state's `untilMs`. Sends a frame only to the dog's display; sends `null` once to a display the dog left; sends `null` to the dog's display while it is in `hiddenDisplayIds`. `clip` = `clipSprite(spriteRect, occludersFor(anchor.windowId))`, `[]`-occluders while falling. In `edge-roaming`, `setWorld` keeps displays and ignores windows.

- [ ] **Step 1: Write the failing tests** (fake clock + recording sink):
  - `spawns on a floor and sends a frame to that display only`.
  - `rides a window moved 300 px in 30 setWorld updates`.
  - `falls to the floor when its window disappears`.
  - `tracker down → edge-roaming: windows ignored, dog on a floor, mode reported`.
  - `display removed respawns the dog on a remaining display` (sink got `null` for the removed display id).
  - `fullscreen foreground on the dog's display sends null`.
  - `goes idle: fewer than 5 frames over 5 s while sitting and the world is still`.
  - `reduced motion walks at REDUCED_WALK_SPEED`.
  - `placeOn anchors to that window's platform and returns false for an unknown id`.
- [ ] **Step 2: Run** `npx vitest run tests/main/dogHost.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** `src/shared/ipc.ts` and `src/main/dogHost.ts` (no `electron` import; the clock defaults to global timers and `Date.now`).
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(main): dog host`.

### Task 5: Electron shell, overlays and network guard

**Files:**
- Create: `electron.vite.config.ts`, `src/main/index.ts`, `src/main/overlay.ts`, `src/main/network.ts`, `src/preload/overlay.ts`, `src/renderer/overlay/index.html` (minimal: canvas + script tag; Task 6 fills it)
- Modify: `package.json` (`"main": "out/main/index.js"`; scripts `dev: electron-vite dev`, `build: electron-vite build`, `start: electron-vite preview`; `npm i -E -D electron electron-vite`, then `node node_modules/electron/install.js`), `.gitignore` (`out/` already present), `eslint.config.js` (`src/renderer/**` and `src/preload/**`: also ban `node:*`; preload may import `electron` only)
- Test: `tests/main/network.test.ts`, `tests/main/overlay.test.ts`

**Interfaces:**
- Consumes: Task 3 `createTracker`, `realWin32`; Task 4 `createDogHost`, `IPC`, `DogFrame`; Task 1 `toDipWindows`.
- Produces:
  ```ts
  // network.ts
  isAllowedUrl(url: string, devOrigin: string | null): boolean   // file:, devtools:, and devOrigin's host:port over http(s)/ws(s)
  installNetworkGuard(session: Electron.Session, devOrigin: string | null): void  // + deny window.open, block will-navigate to disallowed URLs
  // overlay.ts
  isHitMessage(v: unknown): v is boolean
  interface OverlayManager { sync(displays: Electron.Display[]): void; send(displayId: number, frame: DogFrame | null): void; ownsSender(wc: Electron.WebContents): boolean; hwnds(): Set<number>; count(): number; dispose(): void }
  createOverlayManager(opts: { preload: string; load: (w: Electron.BrowserWindow) => Promise<void> }): OverlayManager
  // preload/overlay.ts → window.barkOverlay
  { onFrame(cb: (f: DogFrame | null) => void): void; hit(over: boolean): void }
  ```
  `index.ts`: `whenReady` → `installNetworkGuard` (devOrigin = `process.env.ELECTRON_RENDERER_URL` origin or null) → overlays for `screen.getAllDisplays()` → `createDogHost({ seed: Date.now(), sink: overlays })` → `createTracker(realWin32(), { excludePid: process.pid, excludeIds: overlays.hwnds, onChange: raw => dogHost.setWorld(toDipWindows(raw, r => screen.screenToDipRect(null, r), displays), displays), onDown: err => { console.error(err); dogHost.setTrackerDown(); } })`. `screen` `display-added/removed/metrics-changed` → `overlays.sync` + `dogHost.setWorld`. `systemPreferences.getAnimationSettings().prefersReducedMotion` → `setReducedMotion`. IPC `overlay:hit`: ignore unless `ownsSender(e.sender) && isHitMessage(v)`, then `setIgnoreMouseEvents(!v, {forward:true})` on that window. Preload must build to CommonJS (sandboxed preloads cannot load ESM); `koffi` is externalized, never bundled.

- [ ] **Step 1: Write the failing tests**
  - `network.test.ts`: `file:///C:/x/index.html` allowed; with devOrigin `http://localhost:5173`: `http://localhost:5173/overlay/index.html` and `ws://localhost:5173/` allowed, `http://localhost:5174/` denied; `https://example.com/` denied; devOrigin `null` denies `http://localhost:5173/`; `data:text/html,x` denied; `devtools://devtools/bundled/x` allowed.
  - `overlay.test.ts`: `isHitMessage accepts only booleans` (`true`, `false` yes; `1`, `'true'`, `null`, `{}` no).
- [ ] **Step 2: Run** `npx vitest run tests/main/network.test.ts tests/main/overlay.test.ts`. Expected: FAIL, modules missing. (`overlay.ts` must not import `electron` at module scope in a way that breaks Vitest: import types only, or keep `isHitMessage` importable without Electron.)
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Build and launch:** `npm run build`, then `env -u ELECTRON_RUN_AS_NODE npx electron . ` for 10 s. Expected: build succeeds; no error in the console; one overlay per display (`count()` logged once at startup in dev); kill the process afterwards.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(main): electron shell, per-display overlays, network guard`.

### Task 6: Overlay renderer

**Files:**
- Create: `src/renderer/overlay/main.ts`, `src/renderer/overlay/draw.ts`, `src/renderer/overlay/hit.ts`
- Modify: `src/renderer/overlay/index.html` (CSP meta `default-src 'self'`, full-window canvas, transparent background)
- Test: `tests/renderer/hit.test.ts`

**Interfaces:**
- Consumes: `DogFrame`, `DOG`, `Rect`; `window.barkOverlay` (Task 5).
- Produces:
  ```ts
  dogHitRect(f: DogFrame): Rect          // { x: f.x - DOG.width/2, y: f.y - DOG.height, width: DOG.width, height: DOG.height }
  inside(r: Rect, x: number, y: number): boolean
  drawDog(ctx: CanvasRenderingContext2D, f: DogFrame, tMs: number): void   // placeholder art, clipped to f.clip
  ```
  `main.ts`: on each frame, schedule one `requestAnimationFrame` draw (coalesced); no loop when no frames arrive. Forwarded `mousemove` → `inside(dogHitRect(frame), x, y)`; send `hit` only on change; `mouseleave` or a `null` frame → `hit(false)`. Reduced motion = `frame.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches` → no walk bob. Canvas sized by `devicePixelRatio`.

- [ ] **Step 1: Write the failing tests:** `dogHitRect centres on the feet`, `inside includes edges and excludes outside points`.
- [ ] **Step 2: Run** `npx vitest run tests/renderer`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** the three files. Placeholder dog: bread-brown (`#C98B4B`) body ellipse, head, ears, tail, 4 legs; `walk` bobs ±2 px at 4 Hz (none when reduced); `sit` tucked legs; `fall` legs up; mirrored when `facing === -1`.
- [ ] **Step 4: Run** `npm run build && npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): overlay canvas and hit-test`.

### Task 7: Acceptance e2e

**Files:**
- Create: `src/main/debug.ts`, `playwright.config.ts`, `tests/e2e/overlay.spec.ts`
- Modify: `src/main/index.ts` (call `installDebug` when `process.env.BARKSTUDY_E2E === '1' && !app.isPackaged`; in that mode `excludePid: null`), `package.json` (`npm i -E -D @playwright/test`; script `e2e: electron-vite build && playwright test`)

**Interfaces:**
- Consumes: `DogHost`, `Tracker`, `OverlayManager`.
- Produces: `installDebug(deps: { dogHost: DogHost; tracker: Tracker; overlays: OverlayManager }): void` → `globalThis.__barkDebug = { body(): DogBody; mode(): string; placeOn(id: number): boolean; killTracker(): void; overlayCount(): number }`.
  Playwright launches `_electron.launch({ args: ['.'], env: { ...process.env, BARKSTUDY_E2E: '1', ELECTRON_RUN_AS_NODE: undefined } })`; teardown closes the app in `afterEach` so a failing test exits in seconds.

- [ ] **Step 1: Write the failing e2e tests** (`tests/e2e/overlay.spec.ts`):
  - `one overlay per display`: `overlayCount()` equals `screen.getAllDisplays().length` (via `electronApp.evaluate`).
  - `dragging a window carries Pandesal along`: in main, create a frameless `BrowserWindow` at `{x:300,y:300,width:500,height:300}`, wait 300 ms, `placeOn(its hwnd)` → true; move it +300 px in 30 `setPosition` steps 16 ms apart; wait 300 ms; `body().x` moved by `300 ± 2` and `body().anchor.windowId` is still that hwnd.
  - `the dog falls when its window closes`: close that window; within 1500 ms `anchor.windowId !== hwnd` and `anchor !== null`.
  - `killing the tracker drops to edge-roaming without a crash`: `killTracker()`; within 2000 ms `mode() === 'edge-roaming'` and `anchor.windowId === null`; `overlayCount()` unchanged; the app still answers `evaluate`.
  - `the overlay renderer cannot reach the network`: `overlay.webContents.executeJavaScript("fetch('https://example.com').then(() => 'ok', () => 'blocked')")` → `'blocked'`.
- [ ] **Step 2: Run** `npm run e2e`. Expected: FAIL (`__barkDebug` undefined).
- [ ] **Step 3: Implement** `debug.ts` and the `index.ts` hook.
- [ ] **Step 4: Run** `npm run e2e`. Expected: 5 passed.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `test(e2e): overlay acceptance`.

### Task 8: Manual matrix, spike removal, docs

**Files:**
- Create: `docs/test-matrix.md`
- Modify: `PLAN.md` (M2 heading links this plan; Decision 10 → "one overlay per display (M0)"), `README.md` (Development: `npm run dev`, `npm run e2e`)
- Delete: `spike/`

- [ ] **Step 1: Write `docs/test-matrix.md`**: a table of scales (100 / 125 / 150 %) × monitors (1, 2 mixed-DPI) × cases (title-bar alignment, drag carries the dog, maximised window, fullscreen foreground hides the dog, minimise the ridden window, fast drag, click-through everywhere but the dog, tracker-down edge-roaming). Pre-fill the 125 % single-monitor rows from Task 7 e2e and the spike; leave the others unchecked with "manual".
- [ ] **Step 2: Delete** `spike/` (`git rm -r spike`) and edit `PLAN.md` / `README.md`.
- [ ] **Step 3: Run** `npm run typecheck && npm run lint && npm test && npm run e2e`. Expected: all PASS.
- [ ] **Step 4: Commit** `docs: M2 test matrix; remove spike`.
