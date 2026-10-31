# M5b Product Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Milestone 5. The whole control window works keyboard-only and passes an axe scan, a bug report carries a diagnostics bundle that replays, battery saver makes Pandesal nap, and every UI string lives in `i18n`.

**Architecture:**
- **Strings:** typed string modules under `src/shared/i18n/en/`.
- **Engine log and replay:** the engine host's log becomes a per-session, replay-ready `EngineLog`, and a pure `replayLog` lives in the engine.
- **Main-process modules:** a small rolling file logger, a pure diagnostics builder, and a power watch over one `GetSystemPowerStatus` call.
- **Renderer:** gains error forwarding and an About diagnostics dialog.
- **Tests:** an axe and keyboard e2e layer guards the UI.

**Tech Stack:** TypeScript strict, Electron, React, koffi, Vitest (node env), Playwright `_electron`, `@axe-core/playwright` (new dev dependency).

**Spec:** `docs/superpowers/specs/2026-11-01-m5b-product-shell-design.md`. Read it first; this plan adds only what it leaves open.

## Global Constraints

- **Engine purity:** `src/engine/**` imports nothing from Electron, React, `node:*` or the DOM, and `Math.random()` is banned in `src/`. `src/engine/replay.ts` obeys both.
- **Win32 allowlist:** reads stay limited to the existing window reads, plus `kernel32.GetSystemPowerStatus` (Task 5), plus only if Task 6's spike says so `advapi32.RegGetValueW` for the one value `HKCU\Software\Microsoft\Accessibility\TextScaleFactor`. Never `GetWindowText`, never input, never moving windows.
- **Network:** zero requests from renderers. `shell.openExternal` is called only through `src/main/links.ts`, never with user data in the URL.
- **Untrusted input:** every new IPC channel checks its sender and its arguments.
- **What leaves the machine:** the diagnostics bundle never contains card text, deck names, topics, excluded-app names or an unscrubbed home path.
- **Strings:** all control-window and tray strings live in `src/shared/i18n/en/` once Task 1 lands. The dog is he/him.
- **Feedback on writes:** every user-triggered write gives a toast, on success and on failure.
- **Every task** ends with `npm run typecheck && npm run lint && npm test` green.
- **Commits** are CJ-confirmed, or covered by a standing OK given for this plan.

## Decisions this plan adds (spec gaps)

1. **The replay header is fuller than the spec says.** Engine state, including the RNG, carries over between sessions in one app run, so a replay must start from the state at `SESSION_START`, not from `createEngine(seed)`. `EngineLog` therefore carries:
   - `startState`, the `EngineState` at session start (plain data, no card text);
   - the full `tuning` object, not a normal/fast label;
   - `lastGuiltMs` as a number, not a boolean.

   All of these are numbers or flags.
2. **Mid-session context changes become log-only entries,** and `replayLog` applies them to the context: `BUSY`, `WINDOW` (`window` | `none`) and `PRESET` (preset name).
3. **Action comparisons in tests normalise `windowId` to 1**, because replay uses a fake active window.
4. **The new notice kind is `repaired`** (spec §7). It counts as a settings notice for `shouldOnboard`, which is correct, since it only arises from an existing file.

## Review Focus

1. **A bundle pasted from a real session replays the same actions.** This includes a second session in the same app run, a session that ran while busy typing, and one with a Stay. Pinned in Task 2.
2. **The diagnostics text never leaks a path or name,** whether in a stack trace with forward slashes, an 8.3 short path (`C:\Users\CJNICK~1\…`), or an error message quoting a file in the data folder. Pinned in Task 4.
3. **A flood of renderer errors** (an error thrown in every animation frame) never grows `app.log` past its cap and never blocks main. Pinned in Task 3.
4. **Battery saver turning on mid-effect, mid-curl from being away, or while paused** never strands him in curl after it turns off, and never cuts an effect short. Pinned in Task 5.
5. **Keyboard-only through every dialog:** focus is trapped, returns to the opener, and never lands on `<body>` after an action. Pinned in Task 7.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/i18n/en/*.ts` (new), `src/shared/i18n/en.ts` (modify) | All control-window and tray words, typed |
| `src/renderer/control/text.ts` (modify) | Formatting helpers only |
| `src/engine/replay.ts` (new) | `EngineLog` types and the pure `replayLog` |
| `src/main/engineHost.ts` (modify) | Per-session `EngineLog` recording |
| `scripts/replay.ts` (new) | CLI around `replayLog` |
| `src/main/logs.ts` (new) | Rolling file logger |
| `src/main/diagnostics.ts` (new) | Pure bundle builder and scrubber |
| `src/main/power.ts` (new), `src/main/system/power-win32.ts` (new) | Power watch, and the one native read |
| `src/main/dogHost.ts` (modify) | `setPowerSaving` |
| `src/main/index.ts`, `controlHandlers.ts`, `links.ts`, `files.ts`, `debug.ts`, `trayModel.ts` (modify) | Wiring, new ops, `new-issue` link, dialog override, debug hooks, tray line |
| `src/preload/control.ts`, `src/preload/overlay.ts` (modify) | Error forwarders |
| `src/renderer/control/about.tsx`, `study.tsx`, `app.tsx`, `onboarding.tsx`, `settings.tsx`, `formParts.tsx`, `decks.tsx`, `cards.tsx` (modify) | Diagnostics dialog, battery line, focus rules, minors |
| `tests/e2e/a11y.spec.ts`, `keyboard.spec.ts`, `decks-roundtrip.spec.ts` (new) | UI guards |

---

### Task 1: Strings into i18n, settings refusal reasons, settings repair

**Files:**
- Create: `src/shared/i18n/en/{common,study,decks,history,settings,onboarding,about,tray}.ts`
- Modify: `src/shared/i18n/en.ts` (re-export), `src/renderer/control/*.tsx`, `text.ts`, `app.tsx`, `src/main/trayModel.ts`, `src/shared/control.ts`, `src/main/library.ts`, `src/shared/settings.ts`, `src/main/controlHandlers.ts`
- Test: `tests/shared/i18n.test.ts` (extend), `tests/main/library.test.ts`, `tests/main/settingsOps.test.ts`

**Interfaces:**
- **i18n exports:** `src/shared/i18n/en.ts` re-exports `COMMON`, `STUDY`, `DECKS`, `HISTORY`, `SETTINGS`, `ONBOARDING`, `ABOUT`, `TRAY` as `as const` objects; parameterised phrases are functions. `ERROR_TEXT`, `SKIP_TEXT`, `NOTICE_TEXT` and `STORE_NAME` move into `COMMON`. `text.ts` keeps `plural`, `formatWhen`, `formatDuration`, `deckLabel`, `importMessage` and `errorText`, reading their words from i18n.
- **Refusal reasons:** `AppError` gains `reason?: SettingsReason`, where `SettingsReason = 'too-many-apps' | 'bad-interval' | 'same-shortcut' | 'bad-shortcut' | 'bad-preset' | 'bad-app-name'`.
- **`checkSettings`:** becomes `checkSettings(s): SettingsReason | null`. `library.updateSettings` puts that reason on its `invalid-request`, and `errorText(e)` prefers `COMMON.settingsReason[e.reason]` when it is present.
- **`repairSettings(s: Settings): { settings: Settings; repaired: boolean }`** in `settings.ts`: each field that fails its part of the check goes back to its default, in this order:
  1. A bad preset becomes the default preset.
  2. A bad interval becomes the default pair.
  3. Excluded apps are normalised and cut to 100.
  4. A bad or duplicate hotkey becomes its default. If both shortcuts are then the same, the bubble one goes back to its default.
- **The `repaired` notice:** `Notice['kind']` gains `'repaired'`. The library runs `repairSettings` on open and pushes `{ store: 'settings', kind: 'repaired' }` when anything changed, writing the repaired file.
- **`fillSettings` keeps only known keys,** so unknown keys from older files or imports are dropped.
- **`parsePatch`** refuses an `excludedApps` array longer than 1,000. `normalizeExcluded` dedupes with a `Set`.

- [ ] **Step 1: Write failing tests.**
  - **i18n guard** (`tests/shared/i18n.test.ts`): for each `src/renderer/control/**/*.tsx` file and `src/main/trayModel.ts`, a regex finds no JSX text node containing a letter (`>\s*[A-Za-z][^<{]*<`), and no `label:`, `title=`, `aria-label=`, `placeholder=` or `hint=` followed by a quoted string containing a letter. It allows a short list of symbols. Run it now: it fails, listing today's offenders.
  - **Settings:**
    - `checkSettings` returns `'too-many-apps'`, `'bad-interval'`, `'same-shortcut'` and `'bad-shortcut'` for the matching bad inputs.
    - `repairSettings` resets each bad field alone, keeps the good ones, and reports `repaired: false` for the defaults.
    - `fillSettings({...v1, extra: 1})` has no `extra`.
    - `normalizeExcluded` on 50,000 entries finishes in under 200 ms.
  - **Library:** a stored `settings.json` with `leaveItHotkey: 'L'` opens with the default hotkey, a `repaired` notice, and the file rewritten. After that, `updateSettings({ soundOn: false })` succeeds.
  - **settingsOps:**
    - `settings:update {checkinMinMinutes: 30, checkinMaxMinutes: 10}` returns `reason: 'bad-interval'`.
    - `{ excludedApps: Array(1001).fill('a.exe') }` returns `invalid-request`.
- [ ] **Step 2:** `npx vitest run tests/shared tests/main/library.test.ts tests/main/settingsOps.test.ts`. Expect failures: the guard lists offenders, and the new functions are not defined.
- [ ] **Step 3: Implement.** Move the strings screen by screen, keeping the wording identical except where a reason text is new. In `app.tsx`, the `repaired` notice gets `NOTICE_TEXT.repaired = 'A setting that could not be used was put back to its default.'`.
- [ ] **Step 4:** Rerun the same tests, then the full gate. `npm run build && npx playwright test` must stay green: the words did not change, so the e2e locators still match.
- [ ] **Step 5: Commit.** `refactor(i18n): control window and tray strings into i18n; settings refusal reasons and repair`

---

### Task 2: Replay-ready engine log and `replayLog`

**Files:**
- Create: `src/engine/replay.ts`, `scripts/replay.ts`
- Modify: `src/main/engineHost.ts`
- Test: `tests/engine/replay.test.ts`, `tests/main/engineHost.test.ts`

**Interfaces:**
- `src/engine/replay.ts` exports these types:
  - `LogEntry` (moved here from `engineHost.ts`, which re-imports it) = `{ type: Event['type'] | 'BUSY' | 'WINDOW' | 'PRESET'; at: number; detail?: string; dtMs?: number; count?: number; durationMs?: number }`
  - `EngineLog = { version: 1; seed: number; preset: TraitPreset; tuning: Tuning; lastGuiltMs: number | null; startState: EngineState; truncated: boolean; entries: LogEntry[] }`
- It also exports these functions:
  - `toEvents(log): { event: Event | null; ctxPatch: Partial<Context> | null }[]`. A merged `TICK` expands to `count` ticks of `dtMs / count`, and `STAY_ON` carries `durationMs`.
  - `replayLog(log: EngineLog): { actions: Action[][]; violation: { step: number; invariant: string } | null }`
  - `extractEngineLog(text: string): EngineLog | null`. It reads the fenced ```` ```barkstudy-engine-log ```` block, or bare JSON, and validates the shape.
- **`EngineHost`:**
  - `diagnostics(): EngineLog | null` returns the current session's log, or the last one after it ended. It is `null` before any session.
  - The capacity default becomes 5,000 and is per session; the old 500 ring goes.
  - `setBusy`, `setActiveWindow` (logged only when it changes between null and non-null) and `setPreset` each append their log-only entry while a session runs.

- [ ] **Step 1: Write failing tests.**
  - **`tests/engine/replay.test.ts`:**
    - `toEvents` expands `{type:'TICK', count: 4, dtMs: 1000}` into four `TICK 250`s.
    - `extractEngineLog` finds the block inside a full bundle, and returns `null` for garbage or for a block with the wrong `version`.
    - A hand-built log that reaches level 4 replays with `violation: null`.
    - A log whose `startState` has `rules.paused: true` followed by `CHECKIN_DUE` replays with no prompt action.
  - **`tests/main/engineHost.test.ts`, the replay round trip.** Use a fake clock and a sink that records every action, normalising `windowId` to 1.
    1. Run session A: start, 20 s of ticks.
    2. Run session B in the same host: start (preset `drama-queen`, `lastGuiltMs: 300000`), ticks through `CHECKIN_DUE`, then:
       - `setBusy(true)`, ticks, `setBusy(false)`;
       - escalation to laps;
       - `STAY_ON 900000`, then `STAY_OFF`;
       - an answer, then end.
    3. Assert that `replayLog(host.diagnostics()!).actions.flat()` equals session B's recorded actions.
  - **Also in `tests/main/engineHost.test.ts`:**
    - `diagnostics()` is `null` before the first session.
    - Past 5,000 entries, `truncated` is true and `entries.length === 5000`.
    - The JSON of a log contains no card front or back used in the test.
- [ ] **Step 2:** `npx vitest run tests/engine/replay.test.ts tests/main/engineHost.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Then update the existing `engineHost.test.ts` diagnostics tests to the new shape. For each one whose meaning changes, write a one-line `Ruling:` in the ledger.
- [ ] **Step 4:** `scripts/replay.ts` reads `process.argv[2]`, or stdin when there is no argument. It prints `step N: ACTION, ACTION…` per step, then `No invariant broken.` or `Invariant <id> broken at step <n>.`, and exits with code 1 on a violation or on an unreadable input. Smoke it: `npx tsx scripts/replay.ts tests/fixtures/replay/sample.txt`, with a fixture written by a test helper from the round-trip run. Expected output ends with `No invariant broken.`
- [ ] **Step 5:** Run the full gate, then commit `feat(engine): replay-ready session log and npm run replay`.

---

### Task 3: Rolling logger, renderer errors, crash log

**Files:**
- Create: `src/main/logs.ts`
- Modify: `src/main/index.ts`, `src/preload/control.ts`, `src/preload/overlay.ts`, `src/shared/ipc.ts`, `src/main/tracker/tracker.ts` (or wherever its `console.error` sits), `src/main/library.ts` (log the failures it already notices)
- Test: `tests/main/logs.test.ts`, `tests/main/rendererErrors.test.ts`

**Interfaces:**
- **`createLog(opts: { dir: string; maxBytes?: number; files?: number; now?: () => number; fs?: LogFs }): Log`**
  - `Log = { error(area, message, err?); warn(area, message); info(area, message); tail(n: number, min: 'warn' | 'error'): string[]; flush(): Promise<void> }`
  - Line format: `${iso} ${LEVEL.padEnd(5)} ${area}: ${message}`, then the stack lines indented by two spaces.
  - `tail` reads from an in-memory ring of the last 500 lines, so it never has to read the file.
- **`createRendererErrorGate({ log, isOwn: (sender) => boolean, now, perMinute = 20 })`**
  - `.handle(sender, payload)` drops an unknown sender or a bad payload, truncates each field to 2,000 characters, and rate-limits per sender id.
  - It writes `N more renderer errors dropped` once a minute when it dropped any.
- **IPC:** `IPC.logRenderer = 'log:renderer'`.
- **Both preloads:** add a `window.addEventListener('error' | 'unhandledrejection')` forwarder via `ipcRenderer.send(IPC.logRenderer, { message, stack })`. These sit outside the exposed API, so the page cannot call them.
- **`afterReplace` (from M5a):** when `leaveIt.rebind(saved.leaveItHotkey)` returns false, it registers the new accelerator through `leaveIt.register`, so the conflict state is set. Then it calls `publishStatus()`, so the banner, tray and Settings agree. (M5a review minor.)

- [ ] **Step 1: Write failing tests.** Use an in-memory `LogFs`.
  - Lines are written in order and the format matches exactly.
  - At `maxBytes: 200, files: 3`, writing 2,000 bytes leaves exactly `app.log`, `app.1.log` and `app.2.log`, each ≤ 200 bytes plus one line.
  - A write that rejects never throws to the caller and is retried on the next line.
  - `tail(2, 'warn')` returns only warn and error lines.
  - **Gate:**
    - 1,000 messages from one sender in one minute write 20 entries plus one "980 more" line.
    - An unknown sender writes nothing.
    - A 10,000-character message is cut to 2,000.
  - **`afterReplace`:** extend `dataOps.test.ts`. A fake rebind returns false, and the status published afterwards has `leaveItConflict: true`.
- [ ] **Step 2:** `npx vitest run tests/main/logs.test.ts tests/main/rendererErrors.test.ts tests/main/dataOps.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement and wire up in `index.ts`:**
  - Create the log first (`join(userData, 'logs')`).
  - Route the existing `console.error` calls through it.
  - Add the `process.on('uncaughtException' | 'unhandledRejection')` and `app.on('render-process-gone' | 'child-process-gone')` handlers.
  - `app.setPath('crashDumps', join(userData, 'logs', 'crashes'))`, then `crashReporter.start({ uploadToServer: false })`, before `app.whenReady()`.
  - Under e2e, also echo to the console.
- [ ] **Step 4:** Run the full gate, then commit `feat(main): rolling app log, renderer error forwarding, local crash dumps`.

---

### Task 4: Diagnostics bundle, About dialog, Report a bug

**Files:**
- Create: `src/main/diagnostics.ts`, `src/renderer/control/diagnosticsDialog.tsx`
- Modify: `src/shared/control.ts`, `src/main/controlHandlers.ts`, `src/main/links.ts`, `src/main/index.ts`, `src/renderer/control/about.tsx`, `src/shared/i18n/en/about.ts`
- Test: `tests/main/diagnostics.test.ts`, `tests/main/dataOps.test.ts` (extend), `tests/main/links.test.ts` (extend)

**Interfaces:**
- **`DiagnosticsInput`** = `{ app: { version; electron; chrome; node }; os: { release; arch }; displays: { width; height; scale }[]; settings: Settings; state: { trackerDown; leaveItConflict; batterySaver; phase: SessionView['phase'] }; crashes: { count: number; newest: number | null }; problems: string[]; engine: EngineLog | null; home: string; user: string }`
- **`buildDiagnostics(input: DiagnosticsInput, maxChars = 60_000): string`.** It holds the sections in spec order, `scrub(text, home, user)`, then the size cap. The cap drops `problems` oldest first, then engine entries oldest first, setting `truncated`.
- **`scrub(text: string, home: string, user: string): string`:**
  - Replaces `home` case-insensitively with either slash direction.
  - Replaces any `[A-Za-z]:[\\/]Users[\\/][^\\/\s'"]+` with `%USERPROFILE%`.
  - Replaces `user` as a whole word with `<user>`.
- **New ops:** `'diagnostics:get': [void, string]` builds the bundle and keeps it in main. `'diagnostics:copy': [void, Result<void>]` writes the kept text with `clipboard.writeText`, or returns `not-found` if `get` was never called. `PlatformAccess` gains `diagnostics: () => DiagnosticsInput` and `copyText: (text: string) => void`.
- **Links:** `LinkId` gains `'new-issue'`, and `LINKS['new-issue'] = 'https://github.com/seejjaay/BarkStudy/issues/new'`.

- [ ] **Step 1: Write failing tests.**
  - **Contents:** the bundle contains each section heading, `Excluded apps: 3` (never their names), and the `barkstudy-engine-log` fence. `extractEngineLog(bundle)` returns the same log.
  - **Scrub** (Review Focus 2): it replaces each of these, and `home` and `user` appear nowhere in the output.
    - `C:\Users\CJ Nicko Rosales\AppData\x.json`
    - `c:/users/CJ Nicko Rosales/x`
    - `C:\Users\CJNICK~1\AppData\Local\Temp\y`
    - `at file:///C:/Users/CJ%20Nicko%20Rosales/…`. Add a case that decodes `%20` before matching, so the URL-encoded form is caught too.
    - A bare `CJ Nicko Rosales`.
  - **Size:** a 10,000-line `problems` list and a 5,000-entry engine log yield ≤ 60,000 characters. The newest problems are kept, and the log is marked `truncated`.
  - **Ops:**
    - `diagnostics:copy` before `get` returns `not-found`.
    - After `get`, `copyText` receives exactly the text `get` returned.
    - Renderer arguments are ignored.
  - **Links:** `new-issue` resolves, and stays under the repo prefix.
- [ ] **Step 2:** `npx vitest run tests/main/diagnostics.test.ts tests/main/dataOps.test.ts tests/main/links.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** `index.ts` gathers `DiagnosticsInput`: `process.versions`, `os.release()`, `screen.getAllDisplays()`, the crash dir listing, `log.tail(50,'warn')`, `studySession` engine diagnostics (expose `diagnostics()` through the session controller), `os.homedir()` and `os.userInfo().username`.
  - **About:** **Copy diagnostics…** opens `DiagnosticsDialog`:
    - a `Modal` with a labelled read-only `<textarea>` (`aria-label`, rows 16);
    - **Copy**, which calls the op and toasts `ABOUT.copied`;
    - **Close**.
  - **Report a bug** calls `link:open {id:'new-issue'}`, and its hint says to paste the diagnostics.
- [ ] **Step 4:** Run the full gate. Manual: `npm run dev`, About, Copy diagnostics, paste into Notepad, read it, then `npm run replay` on the pasted file. It must print `No invariant broken.`
- [ ] **Step 5: Commit.** `feat(diagnostics): Copy diagnostics with preview and scrubbing, Report a bug`

---

### Task 5: Power awareness

**Files:**
- Create: `src/main/power.ts`, `src/main/system/power-win32.ts`
- Modify: `src/main/dogHost.ts`, `src/main/index.ts`, `src/shared/control.ts` (`AppStatus`), `src/main/trayModel.ts`, `src/renderer/control/study.tsx`, `src/main/debug.ts`, `PLAN.md` (Global Constraints)
- Test: `tests/main/power.test.ts`, `tests/main/dogHost.test.ts` (extend), `tests/main/tray.test.ts` (extend), `tests/main/forbidden-win32.test.ts` (extend)

**Interfaces:**
- **`createPowerWatch({ read: () => boolean, onChange: (on: boolean) => void, pollMs?: number, setInterval?, clearInterval?, log })`**
  - `PowerWatch = { start(); refresh(); readonly on: boolean; force(on: boolean | null); stop() }`.
  - `force` is the e2e override; `null` hands back to `read`.
- **`readBatterySaver(): boolean`** in `power-win32.ts`. It lazily loads koffi `kernel32.GetSystemPowerStatus(_Out_ SYSTEM_POWER_STATUS*)`, where the struct is `uint8 ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; uint32 BatteryLifeTime, BatteryFullLifeTime`, and returns `SystemStatusFlag === 1`. A load or call failure throws, and `createPowerWatch` catches it.
- **`DogHost.setPowerSaving(on: boolean)`:**
  - While it is on, `resting()` returns `'curl'` instead of `'roam'`.
  - `getUp()` leaves a power-saving curl alone.
  - A `follow`, `laps`, `dig`, `hop` or `sit-stay` behaviour runs unchanged and returns to `'curl'` when it ends.
  - Turning it off ends a power-saving curl and goes back to `resting()`, unless away or end-of-session reasons hold him in curl.
- **Status:** `AppStatus` gains `batterySaver: boolean`. `TrayInputs` gains `batterySaver`, and `statusLine` appends `TRAY.napping` when it is true. The Study page running view shows `STUDY.batterySaver` when `batterySaver`.
- **Debug:** `setBatterySaver(on: boolean | null)` maps to `power.force`.

- [ ] **Step 1: Write failing tests.**
  - **power:**
    - Emits only on change.
    - Polls every `pollMs`.
    - `refresh()` reads at once.
    - A throwing `read` means off, logged once, not on every poll.
    - `force(true)` overrides the reading, and `force(null)` restores it.
  - **dogHost** (Review Focus 4):
    - Saving on while roaming means curl within one tick, with no movement over 5 s of ticks.
    - Saving on during laps keeps the laps to their end, then curl.
    - Saving on while already curled from away, then the user comes back: still curled. Saving off then: up.
    - Saving off while paused-curled stays curled.
    - Saving off returns to roam.
  - **tray:** `statusLine` with `batterySaver` ends with the napping text.
  - **forbidden-win32:** `power-win32.ts` contains `GetSystemPowerStatus` and no other `.func(` declaration.
- [ ] **Step 2:** `npx vitest run tests/main/power.test.ts tests/main/dogHost.test.ts tests/main/tray.test.ts tests/main/forbidden-win32.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement and wire up in `index.ts`:**
  - Create the watch with `readBatterySaver`.
  - `powerMonitor.on('on-battery' | 'on-ac' | 'resume', () => power.refresh())`.
  - `onChange`: call `dogHost.setPowerSaving(on)`, then `publishStatus()`.
  - Add `batterySaver` to the diagnostics state.
  - In PLAN.md's Global Constraints, the Win32 line gains "plus `GetSystemPowerStatus` for the power state".
- [ ] **Step 4:** Run the full gate. Add an e2e test to `overlay.spec.ts`: `setBatterySaver(true)`, then the body x stays put across 3 s and the mood log's last pose is `curl`; then `setBatterySaver(false)`. Run `npm run e2e`.
- [ ] **Step 5: Commit.** `feat(power): battery saver makes Pandesal nap; check-ins unaffected`

---

### Task 6: Text-scaling spike, and fallback if needed

**Files:**
- Modify: `docs/spike-results.md`
- Only if needed:
  - Create `src/main/system/textscale-win32.ts`.
  - Modify `src/main/controlWindow.ts`, `src/main/index.ts` and `PLAN.md`.
  - Test: `tests/main/textScale.test.ts`

- [ ] **Step 1: Spike.** With `npm run build && npx electron .`, take a screenshot of Study with Windows text size at 100 % and again at 150 % (*Settings → Accessibility → Text size*). Record in `docs/spike-results.md` whether the control window's text grew.

  **This step needs CJ to change the Windows setting.** Ask once, with exact steps. If CJ is unavailable, take the fallback path and write that down as a `Ruling:`.
- [ ] **Step 2: Only if the text did not grow.**
  1. Write failing tests for `zoomFor(value: number | null): number`: `null` gives 1, 150 gives 1.5, and 99 or 300 are clamped to 1 and 2.25.
  2. Implement `readTextScaleFactor(): number | null` with a lazy koffi `advapi32.RegGetValueW(HKEY_CURRENT_USER, 'Software\\Microsoft\\Accessibility', 'TextScaleFactor', RRF_RT_REG_DWORD, …)`. It returns `null` when the value is absent or on failure (logged once).
  3. `controlWindow` calls `webContents.setZoomFactor(zoomFor(read()))` on `did-finish-load` and on `show`.
  4. Extend the forbidden-Win32 test: that file declares only `RegGetValueW`.
  5. Add the line to PLAN.md's Global Constraints.
- [ ] **Step 3:** Run the full gate, then commit `docs: text-scaling spike` (plus `feat(main): follow Windows text size` if the fallback was built).

---

### Task 7: Accessibility pass and UI minors

**Files:**
- Create: `tests/e2e/a11y.spec.ts`, `tests/e2e/keyboard.spec.ts`
- Modify: `package.json` (dev dependency `@axe-core/playwright`, exact-pinned), `src/renderer/control/*.tsx`, `styles.css`, `src/renderer/overlay/bubble.ts` (only where axe finds an issue), `tests/e2e/helpers.ts`
- Test: those e2e specs, plus `tests/renderer/settingsModel.test.ts` (extend)

**Interfaces:**
- **Helper:** `helpers.ts` gains `expectNoAxeViolations(page, context: string, disabled?: Record<string, string>)`. It runs `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])` and fails listing each violation's id, help text and target. A disabled rule needs a reason string.
- **`settingsModel.ts`** gains `createCommitGuard<T>(initial: T): { shouldCommit(next: T): boolean; committed(value: T): void }`. It returns true only when `next` differs from the last committed value, and the check-in fields and volume use it.

- [ ] **Step 1: Install and write the failing specs.**
  - `npm i -D --save-exact @axe-core/playwright`.
  - **`a11y.spec.ts`:** one test per spec §7 surface, each reaching its state and calling `expectNoAxeViolations`. For the overlay bubble, open a card with `debug('checkin')`, find the overlay page by URL, and scan it.
  - **`keyboard.spec.ts`:**
    1. Skip link: `Tab` then `Enter` focuses `#main`.
    2. The flow (new deck, add card, start, answer with the self-grade buttons, end, change cap) uses only `keyboard.press`. After each view switch, the focused element is that page's `h1`.
    3. After deleting the only card, focus is on the cards heading.
    4. For each dialog, focus stays inside it, `Escape` closes it, and focus returns to its opener.
    5. A sample of focused controls has `getComputedStyle(el).outlineStyle !== 'none'` or a non-empty `box-shadow`.
  - **settingsModel:** `createCommitGuard` refuses an unchanged value and accepts a changed one.
- [ ] **Step 2:** `npm run build && npx playwright test tests/e2e/a11y.spec.ts tests/e2e/keyboard.spec.ts`. Expect failures listing real violations and focus misses. Save the list in the ledger as the audit.
- [ ] **Step 3: Fix every finding,** plus these:
  - **View switches:** `app.tsx` focuses the new page's `h1` (each page's `h1` gets `tabIndex={-1}` and a ref passed down, or `document.querySelector('#main h1')` after render).
  - **Deletes:** after a delete in `decks.tsx` and `cards.tsx`, focus moves to the next row's first button, or to the list heading.
  - **`HotkeyField`:** switches to `aria-disabled` while busy and ignores clicks and keys meanwhile.
  - **Commits:** `IntervalFields` and `VolumeSlider` use `createCommitGuard`.
  - **Onboarding:** "Couldn't start setup" gets a **Try again** that re-runs the load.
  - **`app.tsx`:** when `setupAgain` is true and the snapshot is null, render the error view instead of `null`.
  - **About:** "Run setup again" is disabled while a session runs, with an `aria-describedby` reason (`ABOUT.setupWhileRunning`). `AboutPage` takes `sessionRunning: boolean`.
  - **Contrast:** adjust tokens in `styles.css` only as far as axe requires, and keep the palette.
- [ ] **Step 4:** Rerun both specs to green, then the full gate and `npm run e2e`.
- [ ] **Step 5: Commit.** `feat(a11y): axe-clean screens, keyboard-only flows, consistent focus; settings UI minors`

---

### Task 8: Deck round trip, docs, plan status

**Files:**
- Create: `tests/e2e/decks-roundtrip.spec.ts`, `tests/fixtures/decks/excel-bom-crlf.csv`
- Modify: `src/main/files.ts` (the override also covers `pickImport` and `saveExport`), `docs/test-matrix.md`, `PLAN.md`

- [ ] **Step 1: Write the fixture.** It is a UTF-8 BOM followed by these rows, separated by CRLF:
  - `"chat, le",the cat`
  - `école,school`
  - `"il dit ""bonjour""",he says hello`
  - `chien,dog`
- [ ] **Step 2: Write the spec.** It is expected to fail, because the override does not cover deck dialogs yet.
  1. Seed and open, then `setNextDialogPath(fixture)`, then Decks, **New deck → Import file…** (the existing import dialog's file button).
  2. Expect 4 cards.
  3. `setNextDialogPath(tmp.csv)`, then export the deck.
  4. `setNextDialogPath(tmp.csv)`, then import it as a new deck named "Again".
  5. Both decks' card lists (via `control(page, 'card:list', …)`) have equal fronts and backs, in order.
- [ ] **Step 3:** Make `createFileAccess`'s `overridePath` apply to `pickImport` and `saveExport` too. Rerun the spec to green.
- [ ] **Step 4: Docs.**
  - **`docs/test-matrix.md`** gains the five manual rows from spec §8.
  - **PLAN.md:**
    - The M5 header says M5 is done, linking both M5a and M5b specs and plans.
    - The Global Constraints Win32 line is already updated in Tasks 5 and 6; check that it reads right.
- [ ] **Step 5:** Run the full gate and `npm run e2e`. Expect all specs green. Commit `test: deck import/export round trip; docs: M5 done`.

---

## Self-review

- **Spec coverage:** spec §1 is Task 1; §2 is Task 2; §3 is Task 3; §4 is Task 4; §5 is Task 5; §6 is Task 6; §7 is Task 7, with two of its minors in Tasks 1 and 3; §8 is Task 8. The Verification section is covered by each task's gate plus Task 8's full e2e.
- **Type consistency:**
  - `EngineLog`, `LogEntry` and `extractEngineLog` are defined in Task 2 and used in Task 4.
  - `Log.tail` is defined in Task 3 and used in Task 4.
  - `AppStatus.batterySaver` is defined in Task 5 and used in Task 4's input. Task 4 lands first, so it uses `false` until Task 5 wires it up; that is noted in Task 5's Step 3.
  - `SettingsReason` (Task 1) feeds `errorText`.
  - `setNextDialogPath` is extended in Task 8.
- **Proportion:** the plan is about 2.5 times the spec's length, mostly interface lines and test assertions. No function bodies, except the replay round-trip scenario and the scrub cases, which are what the tests are.
