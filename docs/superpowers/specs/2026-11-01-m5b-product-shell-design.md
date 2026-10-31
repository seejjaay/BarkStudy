# M5b design: product shell, part 2 (accessibility, diagnostics, power, strings)

Status: approved in conversation on 2026-11-01, pending review of this document.

## Context

M5a is merged (`main` @ dbb21f0, not pushed). It shipped onboarding, Settings, data export/import/reset and About. M5b finishes Milestone 5 (PLAN.md T5.3 to T5.6), and its acceptance is M5's:

- A new user installs, gets through onboarding, studies, changes settings, and can export, back up and restore their data, all keyboard-only if they want.
- When something breaks, they can hand over a bug report that replays, without BarkStudy ever sending anything anywhere.

M5b also picks up two leftovers. The control window's strings are still inline and in `text.ts` rather than in `i18n/en.ts`, and the M5a final review deferred some minors (listed in their tasks below).

**Decided in conversation:**
- **Battery saver** is read from Windows with `GetSystemPowerStatus`. Being unplugged is not enough.
- **"Copy diagnostics"** shows a preview first and copies only after that. Home-folder paths and the account name are scrubbed.
- **Accessibility is tested** with `@axe-core/playwright` (a dev dependency only) plus keyboard-only e2e walks. Narrator gets manual test-matrix rows.

## Order of work

1. Strings into `i18n/en.ts`.
2. Engine log made replay-ready, and `scripts/replay.ts`.
3. Logging and crash log.
4. Diagnostics bundle, About actions, Report a bug.
5. Power awareness.
6. Text-scaling spike, and its fallback only if needed.
7. Accessibility pass: axe, keyboard walks, focus rules, the review minors.
8. Deck round-trip e2e, test-matrix rows, PLAN.md status.

The strings come first so every later task adds strings in the right place.

## 1. Strings

- **`src/shared/i18n/en.ts`** keeps Pandesal's `line.*` record and `say()` exactly as they are.
- **The control window's words** move into typed, per-area modules under `src/shared/i18n/en/`:
  - `common.ts`: errors, skip reasons, notices, store names.
  - `study.ts`, `decks.ts`, `history.ts`, `settings.ts`, `onboarding.ts`, `about.ts`, `tray.ts`.
  - `en.ts` re-exports them.
- **They are typed objects, not a flat key-to-string map.** A missing key is then a compile error, and phrases with parameters stay functions, for example `exportDone(path)`.
- **`src/renderer/control/text.ts` keeps only formatting helpers:** `plural`, `formatWhen`, `formatDuration`, `deckLabel`, `importMessage`. The last two build their sentences from i18n words.
- **The tray's labels** in `trayModel.ts` move too.
- **The M5a review minor** "specific `invalid-request` reasons are dropped" is fixed here:
  - `settings:update` refusals carry a reason code: `too-many-apps`, `bad-interval`, `same-shortcut`, `bad-shortcut`.
  - Each code has its own words, so the user sees why a change was refused.
- **Guard:** a unit test reads `src/renderer/control/**/*.tsx` and `src/main/trayModel.ts` and fails on English inside them: JSX text, or string values of `label`, `title`, `aria-label`, `placeholder` or `hint`. It allows punctuation and symbols such as `×`, `✓` and `…`.

## 2. Replay-ready engine log and `scripts/replay.ts`

**Today's log cannot be replayed faithfully.**
- It is a 500-entry ring, so it can lose `SESSION_START`.
- It merges ticks.
- It drops the Stay length.
- It does not record the context that changes timing: the busy flag, preset, tuning, and whether there is a last guilt time.

**The log becomes per session.**
- `EngineLog` = `{ seed, preset, tuning: 'normal' | 'fast', hadLastGuilt, truncated, entries }`. It starts at `SESSION_START` and is capped at 5,000 entries. Past the cap the oldest go and `truncated` is set to true.
- The most recent session's log stays available after it ends, so the bundle can carry it.

**What each entry keeps.**
- `TICK` keeps `count` and total `dtMs`. Replay splits it into `count` equal ticks, which reproduces the same event order, with timing within one 250 ms tick.
- `STAY_ON` keeps `durationMs`.
- `WINDOW_FOCUS_CHANGED` keeps only `window` or `none`.
- The busy flag gets its own log-only entries, `{ type: 'BUSY', detail: 'on' | 'off' }`.
- Activity, suppress, answer and cap keep their current `detail`.
- Never any card text, deck name or topic.

**`replayLog(log): { actions: Action[][]; violation: { index: number; invariant: string } | null }`** lives in `src/engine/replay.ts`. It is pure and lives in the engine, so the engine import rules apply.
- It rebuilds events and context and runs the real `step`.
- It checks `INVARIANTS` after every step.
- It uses a fake active-window id of 1 whenever the log says `window`.

**`npm run replay -- <file>`** (`scripts/replay.ts`) runs a pasted bundle.
- It takes the fenced ```` ```barkstudy-engine-log ```` JSON block out of the bundle, or reads a bare JSON file.
- It runs `replayLog`.
- It prints one line per step with its actions, then either "No invariant broken." or the first violation and its step number.
- A truncated log is replayed from its first kept entry, with a warning that the start is missing.

**The proof is a test.** It drives a real engine host through a scripted session on a fake clock: start, ticks, check-in, escalation, busy on and off, Stay, an answer, end. It feeds `host.diagnostics()` to `replayLog` and asserts the action sequence equals what the host sent its sink.

## 3. Logging and crash log

**`src/main/logs.ts`** is `createLog({ dir, maxBytes = 1_000_000, files = 3, fs?, now? })`.
- It writes `logs/app.log` and rotates to `app.1.log` and `app.2.log`, deleting the oldest.
- Each line is `ISO time  LEVEL  area  message`, plus the stack for errors.
- Writes are queued in order, and a failing write never throws into the caller.
- `tail(n, minLevel)` returns the last `n` lines at or above a level, for the bundle.
- No new dependency.

**What goes into it:**
- The existing `console.error` calls in `src/main`.
- From main: `process` `uncaughtException` and `unhandledRejection`; `app` `render-process-gone` and `child-process-gone`; tracker down; a failed store read or write; a failed power read.
- Under e2e it also echoes to the console as it does today.

**Renderer errors** arrive on one IPC channel, `log:renderer`.
- Payload: `{ message, stack? }`.
- Sender-checked: only our control window and overlays.
- Each field is capped at 2,000 characters, and at most 20 entries a minute are taken from each renderer. The rest are counted and logged once as "N more dropped".
- Both preloads install `window.onerror` and `unhandledrejection` forwarders.

**Crash log:** `crashReporter.start({ uploadToServer: false })`. `app.setPath('crashDumps', …)` points it at `userData/logs/crashes`. The bundle reports only the dump count and the newest dump's date.

## 4. Diagnostics bundle, About, Report a bug

**`buildDiagnostics(input): string`** in `src/main/diagnostics.ts` is pure; `index.ts` gathers its input. It has these sections, in this order:
- **App:** BarkStudy, Electron, Chrome and Node versions.
- **OS:** Windows release and architecture.
- **Displays:** count, and each display's size and scale factor.
- **Settings summary:** cap, preset, reduced motion, sound on/off, and the *number* of excluded apps (never their names).
- **State:** tracker up or down, Leave it conflict, battery saver, session phase.
- **Crash dumps:** count and newest date.
- **Recent problems:** `logs.tail(50, 'warn')`.
- **Engine log:** the fenced `barkstudy-engine-log` JSON block.

**Scrubbing:**
- Every `X:\Users\<name>\…` path, with either slash, becomes `%USERPROFILE%\…`.
- Every other occurrence of the account name (`os.userInfo().username`) becomes `<user>`.

**Size:** capped at 60,000 characters (GitHub's issue body limit is 65,536). Problem lines are dropped oldest first, then the oldest engine entries, and the log is marked truncated.

**New ops:**
- `diagnostics:get` builds the text, keeps it in main and returns it.
- `diagnostics:copy` writes that kept text to the clipboard with Electron's `clipboard` and returns `ok`. It never takes text from the renderer.

**About page:**
- **Copy diagnostics…** opens a modal. It holds a read-only, scrollable, labelled text area with the exact text, a **Copy** button (toast: "Diagnostics copied. Paste them into your bug report.") and **Close**.
- **Report a bug** opens the link id `new-issue`, which is `https://github.com/seejjaay/BarkStudy/issues/new` in the allowlist, with nothing appended. The hint next to it says to paste the diagnostics into the report.

## 5. Power awareness

**`src/main/power.ts`** is `createPowerWatch({ read, onChange, pollMs = 30_000, log })`.
- It reads at start, every `pollMs`, and right away when `refresh()` is called.
- It calls `onChange(on)` only when the value changes.
- If `read` throws, it treats the value as off and logs once.

**Reading the flag:** `read` is one koffi call, `kernel32.GetSystemPowerStatus`, into `SYSTEM_POWER_STATUS`.
- Battery saver is on when `SystemStatusFlag === 1`.
- The library is loaded lazily inside the read, so a load failure lands in the same failure path.
- `index.ts` calls `refresh()` on `powerMonitor`'s `on-battery`, `on-ac` and `resume`.

**What it does to him:** `dogHost.setPowerSaving(on)`.
- While it is on, he does not roam.
- Whenever his mood would be `idle` or `wander` and no effect is running, he holds the `curl` pose with the `nap` look where he is.
- Every other mood and every effect plays as normal: a card waiting, escalation up to the cap, Esc, Leave it. Afterwards he goes back to curling up.
- Turning it off resumes roaming.
- Check-ins and the engine are untouched.

**Telling the user:**
- `AppStatus` gains `batterySaver`.
- The Study page shows "Battery saver is on, so Pandesal is napping. Check-ins still come."
- The tray status line appends "(napping: battery saver)".

**Debug hook (e2e only):** `setBatterySaver(on: boolean | null)`. `null` hands control back to the real reading.

**Constraints:**
- PLAN.md Global Constraints, Win32 line, gains "plus `GetSystemPowerStatus` for the power state".
- A unit test checks that `power.ts` declares no other native call.

## 6. Text scaling

**Spike, written up in `docs/spike-results.md`:** set Windows *Settings → Accessibility → Text size* to 150 % and check whether the control window's text grows.
- **If it grows:** nothing to build. Add a test-matrix row and stop.
- **If it doesn't:** read the one value `HKCU\Software\Microsoft\Accessibility\TextScaleFactor` (100 to 225; absent means 100) with koffi `advapi32.RegGetValueW`. Set the control window's `webContents.setZoomFactor(value / 100)` at start and whenever the window is shown, and log a failure once. The Global Constraints' Win32 line also gains "and the one registry value `TextScaleFactor`".

## 7. Accessibility pass

**Automated scan:** `tests/e2e/a11y.spec.ts` runs `AxeBuilder` with the tags `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`.
- Zero violations on each of these:
  - Study, idle and running.
  - Decks, the card editor and History (empty and with rows).
  - Settings and About.
  - Every onboarding step.
  - The import, delete, restore, reset and diagnostics dialogs.
  - The overlay's answer bubble while it is open.
- A rule may be disabled only with a written reason next to it.

**Keyboard walks** in `tests/e2e/keyboard.spec.ts`:
- The skip link moves focus to the main content.
- Keyboard only: create a deck, add a card, start a session, answer in the control window, end it, change a setting, and open and close each dialog.
- Each focused control has a visible outline (computed `outline-style` is not `none`, or a box-shadow ring).

**Focus rules:**
- Switching views moves focus to that page's `h1` (`tabIndex={-1}`).
- Deleting a deck or card moves focus to the next row, or to the list heading if it was the last.
- `HotkeyField` uses `aria-disabled` instead of `disabled` while saving, and ignores presses meanwhile, so focus stays on it.
- Dialogs keep their existing trap and return.

**Fix whatever the scan and walks find**, including contrast in the CSS tokens.

**M5a review minors fixed here:**
- Check-in fields and volume track the last committed value, so Enter then Tab saves once, and the volume saves (and toasts) once per release.
- Onboarding's "Couldn't start setup" gets a **Try again** button.
- `app.tsx` falls through to the error view instead of rendering nothing when setup is open and a refresh fails.
- "Run setup again" is disabled while a session runs, with the reason shown.

**Folded into the tasks that touch the same code:**
- The raw excluded-apps array is capped at 1,000 in `parsePatch`, and `normalizeExcluded` dedupes with a `Set`. (Task 1.)
- `afterReplace` reports a failed Leave it rebind as a conflict, so the banner, tray and Settings agree. (Task 3.)
- A stored settings field that fails `checkSettings` is repaired to its default when the library opens, instead of blocking every later update. (Task 1.)
  - It raises a new notice kind, `repaired`, with the words "A setting that could not be used was put back to its default."
  - Imported settings keep only known keys.

## 8. Deck round trip, docs

**`setNextDialogPath`** also covers deck import and export.

**`tests/e2e/decks-roundtrip.spec.ts`:**
1. Import `tests/fixtures/decks/excel-bom-crlf.csv` through the UI. Its content: a BOM, CRLF line endings, a quoted comma, and accented text.
2. Export that deck to a temp file.
3. Re-import the export as a new deck.
4. The two decks have the same fronts and backs, in the same order.

**`docs/test-matrix.md` rows:**
- Narrator reads every screen and dialog sensibly.
- Windows text size at 150 %.
- Battery saver on a real laptop: he curls up, check-ins still come, and he roams again when it is turned off.
- The diagnostics preview checked by eye for paths and names.
- A real bug bundle pasted into `npm run replay`.

**PLAN.md:** the M5 header says M5 is done, and the Global Constraints get the Win32 lines from sections 5 and 6.

## Verification

- Each task ends with `npm run typecheck && npm run lint && npm test`.
- The last task runs `npm run e2e`: all specs, including a11y, keyboard and the deck round trip.
- Manual:
  - `npm run dev`, then Copy diagnostics and read it.
  - `npm run replay` on the copied text.
  - Turn battery saver on.
  - Tab through every screen.
- One fresh reviewer checks the whole branch at the end.
