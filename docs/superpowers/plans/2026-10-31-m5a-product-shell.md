# M5a Product Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new user can finish onboarding, change every setting, and export, reset and restore all their data, from the control window, keyboard-only if they want.

**Architecture:** Settings gain five fields and a strict validator; the library gains whole-data export/replace/reset on top of the existing storage envelope and migrations. New control ops (same `ControlOps` + argument-checking pattern as decks) expose settings, hotkeys, data and onboarding. Two new control views (Settings, About) and a full-window onboarding flow render them; pure logic (reducer, accelerator parsing) is unit-tested because renderer tests run in the node environment with no DOM.

**Tech Stack:** TypeScript strict, Electron + electron-vite, React, Vitest (node env), Playwright `_electron`.

**Spec:** `docs/superpowers/specs/2026-10-31-m5a-product-shell-design.md` (read it first; this plan only adds the decisions it leaves open).

## Global Constraints

- `src/engine/**` is untouched: no Electron/DOM imports there, no `Math.random()` anywhere in `src/` (use `src/engine/rng.ts`).
- Renderer makes zero network requests; `shell.openExternal` only through the hardcoded allowlist in `src/main/links.ts`, never with user data in the URL.
- Storage stays atomic JSON with `schemaVersion`, rolling backups (last 5), corrupt file → `.bak` + fallback. `appId` and the userData folder name never change.
- Every control-window op checks its own arguments (`invalid-request` on malformed input); the renderer is untrusted.
- New control-window strings go in `src/renderer/control/text.ts`; the dog is "he/him" everywhere.
- Any write the user triggers gives a toast on success and on failure; Save-style buttons are disabled until something changed.
- Every task ends with `npm run typecheck && npm run lint && npm test` green. **Commits are CJ-confirmed:** stage, show the message, wait for OK.
- Branch: `m5a-product-shell`.

## Review Focus

1. **First run vs. broken load.** A snapshot that is loading, errored, or comes from an `unavailable` settings store must never show onboarding (a corrupt `settings.json` is not a first run). Pinned in Task 6 (reducer/gate test) and Task 7 (e2e).
2. **Import all with a bad or newer file.** Truncated JSON, a Quizlet CSV, a bundle with one corrupt part, or `schemaVersion` newer than the app writes nothing and leaves current data intact. Task 2.
3. **Hotkey rebinding to something taken, invalid, or equal to the other hotkey.** The old binding survives and the user sees why. Tasks 1 and 3.
4. **Reset/import during a running session, or right after.** Refused mid-session; afterwards both hotkeys, reduced motion and the tray reflect the new settings, and the dig-in cooldown is not a loophole. Task 3/4.
5. **Excluded-apps list abuse.** Empty entries, upper-case duplicates, `C:\path\x.EXE`, 10 000 entries. Task 1.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/settings.ts` (modify) | `Settings` + new fields, `fillSettings`, `checkSettings` |
| `src/shared/accelerator.ts` (new) | Pure accelerator parse/format from key events |
| `src/shared/sampleDeck.ts` (new) | Starter deck text, imported through the existing parser |
| `src/main/storage/io.ts` (modify) | `backup(def)` and exported `upgrade(def, v, data)` |
| `src/main/library.ts` (modify) | `exportAll`, `replaceAll`, `resetAll`, stricter `updateSettings` |
| `src/shared/control.ts`, `src/main/controlHandlers.ts` (modify) | New ops, error codes, snapshot fields |
| `src/main/links.ts` (new) | URL allowlist |
| `src/main/files.ts`, `src/main/debug.ts` (modify) | Backup dialogs; e2e dialog-path override |
| `src/main/leaveIt.ts`, `src/main/bubbleHost.ts`, `src/main/index.ts` (modify) | Practice hook, bubble accelerator getter, `--hidden`, post-replace re-apply |
| `src/renderer/control/formParts.tsx` (new) | Shared `RadioCards`, `HotkeyField` used by Settings and Onboarding |
| `src/renderer/control/settings.tsx`, `onboarding.tsx`, `about.tsx` (new) | Views |
| `src/renderer/control/onboardingFlow.ts` (new) | Pure step reducer + `shouldOnboard` gate |
| `src/renderer/control/app.tsx`, `text.ts`, `styles.css` (modify) | Nav, gate, strings, styles |

---

### Task 1: Settings schema, strict validation, accelerators

**Files:** modify `src/shared/settings.ts`, `src/shared/validate.ts`, `src/main/session.ts` (move `MAX_INTERVAL_MINUTES` to `settings.ts`, re-import); create `src/shared/accelerator.ts`; test `tests/shared/settings.test.ts`, `tests/shared/accelerator.test.ts`.

**Interfaces:**
- Produces: `Settings` gains `onboarded: boolean`, `reducedMotion: 'system'|'on'|'off'`, `updateChecks: boolean`, `betaChannel: boolean`, `bubbleHotkey: string` (default = `BUBBLE_HOTKEY`). Defaults: `onboarded:false, reducedMotion:'system', updateChecks:true, betaChannel:false`.
- Produces: `checkSettings(s: Settings): string | null` (reason, or null if fine); `export const MAX_INTERVAL_MINUTES = 240`.
- Produces (accelerator.ts): `acceleratorFromKeyEvent(e: {key:string; code:string; ctrlKey:boolean; altKey:boolean; shiftKey:boolean; metaKey:boolean}): string | null`; `acceleratorLabel(a: string): string` ("Control+Alt+L" → "Ctrl+Alt+L"); `isAccelerator(a: string): boolean`.

- [ ] **Step 1: Write failing tests.**
  - settings: `fillSettings` of the v1 fixture (`tests/fixtures/schemas/v1/settings.json` data) gives `onboarded:false`, `reducedMotion:'system'`, `updateChecks:true`, `betaChannel:false`, `bubbleHotkey:'Control+Alt+A'`; it never changes a value that is present.
  - `checkSettings` returns non-null for: preset `'x'`; min 0; min 20 / max 10; max 241; an excluded app that is empty, 261 chars, or beyond 100 entries; a hotkey that fails `isAccelerator`; `leaveItHotkey === bubbleHotkey`. Returns null for `DEFAULT_SETTINGS`.
  - `checkSettings` lower-case/dedupe is *not* its job; assert `normalizeExcluded(['A.EXE',' a.exe ','b.exe',''])` → `['a.exe','b.exe']` (export this helper from `settings.ts`; it also strips a `C:\dir\` prefix).
  - accelerator: Ctrl+Alt+L event → `'Control+Alt+L'`; Alt+F5 → `'Alt+F5'`; bare `L`, Shift+L only, Escape, Ctrl+Alt+Escape, `key:'Control'` alone → `null`; `isAccelerator('Control+Alt+L')` true, `'Control+'` / `'L'` / `''` false; label round-trip.
- [ ] **Step 2:** `npx vitest run tests/shared/settings.test.ts tests/shared/accelerator.test.ts` → FAIL (not defined).
- [ ] **Step 3: Implement.** Extend `StoredSettings`/`fillSettings` (existing pattern); `isSettings` takes the new fields as optional with type checks (so old files still load); `checkSettings` is separate and only used by `library.updateSettings` (a stored file is never rejected by the stricter rules). Accelerator needs Ctrl or Alt plus one non-modifier key, maps `code` (`KeyL`→`L`, `Digit1`→`1`, `F1-F24`) to Electron names, refuses Escape and Win-key combos.
- [ ] **Step 4:** same command → PASS; then `npm run typecheck && npm run lint && npm test`.
- [ ] **Step 5: Commit** `feat(shared): new settings fields, strict settings check, accelerator parsing`.

---

### Task 2: Whole-data export, replace and reset in the library

**Files:** modify `src/main/storage/io.ts`, `src/main/library.ts`, `src/shared/control.ts` (error codes only); test `tests/main/storage.test.ts`, `tests/main/library.test.ts`; create fixture `tests/fixtures/backups/v1-export.json` (generated by a test helper from a real `exportAll`, committed).

**Interfaces:**
- Consumes: `StoreDef`, `createStorage`, `allStores` shapes from `io.ts`/`stores.ts`.
- Produces on `Storage`: `backup<T>(def: StoreDef<T>): Promise<void>` (copies the current file into `backups/`; no-op if the file is absent). Exported `upgrade<T>(def: StoreDef<T>, schemaVersion: number, data: unknown): {ok:true; value:T} | {ok:false; reason:'newer-version'|'invalid'}` reusing the existing migrate loop.
- Produces on `Library`: `exportAll(): string` (bundle `{app:'barkstudy', kind:'backup', exportedAt, stores:{decks,settings,history}}`, each part `{schemaVersion, data}`); `replaceAll(json: string): Promise<Result<void>>`; `resetAll(): Promise<Result<void>>`.
- New `ErrorCode`s: `'not-a-backup' | 'newer-version' | 'hotkey-taken' | 'hotkey-invalid' | 'session-running'`; add matching `ERROR_TEXT` entries in `text.ts` (the type `Record<ErrorCode,string>` forces it).

- [ ] **Step 1: Write failing tests** (library, using the in-memory/temp storage the existing tests use):
  - `replaceAll(exportAll())` on a library with 2 decks + 1 session leaves `listDecks/listSessions/getSettings` deep-equal.
  - `replaceAll` of: `'{'`, `'[]'`, a CSV string, a bundle missing `history`, a bundle whose `history` fails `isHistoryFile`, a bundle with `settings.schemaVersion = CURRENT+1` → `{ok:false}` with `not-a-backup` / `newer-version`, **and** `getSettings()` and the on-disk files unchanged (read via storage).
  - A successful `replaceAll` first leaves a `backups/` copy of each prior file.
  - A store that opened `unavailable` is writable after `replaceAll`, and its notice is gone from `notices()`.
  - `resetAll()` → no decks/sessions, `getSettings()` equals defaults with `onboarded:false`, backups made.
  - The committed `v1-export.json` fixture imports via `replaceAll` (this test is what keeps old exports working through future migrations).
  - Storage: `upgrade` on current version validates only; on `current+1` → `newer-version`; `backup` on a missing file does not throw.
- [ ] **Step 2:** run the two test files → FAIL.
- [ ] **Step 3: Implement.** `replaceAll` parses and `upgrade`s all three parts before touching disk; then, per slot via the existing `mutate` chain (backup → write → swap slot value, `available = true`, drop that store's notice). On a mid-way `write` failure return `write-failed` naming the stores already replaced.
- [ ] **Step 4:** tests PASS; full gate green.
- [ ] **Step 5: Commit** `feat(main): export, replace and reset all data`.

---

### Task 3: Settings, hotkey, login-item and link ops (main side)

**Files:** modify `src/shared/control.ts`, `src/main/controlHandlers.ts`, `src/main/library.ts` (`updateSettings` also runs `checkSettings` and `normalizeExcluded`), `src/main/bubbleHost.ts`, `src/main/index.ts`; create `src/main/links.ts`; test `tests/main/controlHandlers.test.ts`, `tests/main/bubbleHost.test.ts`, `tests/main/links.test.ts`.

**Interfaces:**
- Consumes: `checkSettings`, `normalizeExcluded`, `isAccelerator` (Task 1); `LeaveIt.rebind` ([leaveIt.ts](../../../src/main/leaveIt.ts)).
- Produces ops (add to `ControlOps` + `OP_NAMES`):
  - `'settings:get': [void, SettingsView]` where `SettingsView = { settings: Settings; loginItem: {available:boolean; on:boolean}; openApps: string[]; dataDir: string }`.
  - `'settings:update': [Partial<Omit<Settings,'leaveItHotkey'|'bubbleHotkey'|'onboarded'>>, Result<Settings>]`.
  - `'settings:hotkey': [{which:'leaveIt'|'bubble'; accelerator:string}, Result<Settings>]`.
  - `'settings:login-item': [{on:boolean}, Result<{available:boolean; on:boolean}>]`.
  - `'link:open': [{id:'repo'|'releases'|'license'}, Result<void>]`.
- Produces `ControlHandlerOptions` additions: `platform: { loginItem: {get(): {available:boolean;on:boolean}; set(on:boolean): void}; openApps(): string[]; dataDir: string; openLink(url:string): void; applyReducedMotion(mode: Settings['reducedMotion']): void }`, `hotkeys: { leaveIt: LeaveIt; bubble: {rebind(accelerator:string): boolean} }`.
- `bubbleHost` takes `accelerator: () => string` instead of the constant; `index.ts` passes `() => library.getSettings().bubbleHotkey`.
- `links.ts`: `LINKS: Record<LinkId,string>` and `resolveLink(id: unknown): string | null`.

- [ ] **Step 1: Write failing tests.**
  - handlers: every new op returns `invalid-request` for `undefined`, `{}`, wrong types, and (for `settings:update`) for keys it must not accept (`onboarded`, `leaveItHotkey`).
  - `settings:update` with `cap:3` persists and returns settings; with `reducedMotion:'on'` calls `platform.applyReducedMotion('on')` once; with min>max → `invalid-request` and nothing saved.
  - `settings:hotkey` leaveIt: success persists + `rebind` called; `rebind` returns false → `hotkey-taken`, setting unchanged; `'L'` → `hotkey-invalid`; same as the other hotkey → `hotkey-invalid`; persist failure after a successful rebind rebinds back to the old accelerator.
  - `settings:login-item` returns `available:false` and does nothing when `platform.loginItem.get().available` is false.
  - `link:open` with `'evil'`, `undefined`, `'__proto__'` → `invalid-request`, `openLink` never called; with `'repo'` calls it with the hardcoded URL only.
  - `links.test.ts`: every `LINKS` value starts with `https://github.com/seejjaay/BarkStudy`.
  - bubbleHost: registers whatever `accelerator()` returns at the time it opens.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** in `controlHandlers.ts` using the existing `rec`/`bad`/`fail` helpers. In `index.ts`: `platform.loginItem.set` → `app.setLoginItemSettings({openAtLogin:on, args:['--hidden']})`, `available = app.isPackaged`; `openApps` = deduped lower-case `processName`s of the last `rawWindows`; `applyReducedMotion` resolves `'system'` through the existing `systemPreferences.getAnimationSettings()` call and calls `dogHost.setReducedMotion` (also called once at startup from saved settings); skip `controlWindow.show()` when `process.argv.includes('--hidden')`.
- [ ] **Step 4:** tests PASS; full gate green.
- [ ] **Step 5: Commit** `feat(main): settings, hotkey, login item and link ops`.

---

### Task 4: Data and onboarding ops

**Files:** modify `src/shared/control.ts`, `src/main/controlHandlers.ts`, `src/main/files.ts`, `src/main/leaveIt.ts`, `src/main/debug.ts`, `src/main/index.ts`; create `src/shared/sampleDeck.ts`; test `tests/main/controlHandlers.test.ts`, `tests/main/leaveIt.test.ts`, `tests/shared/sampleDeck.test.ts`.

**Interfaces:**
- Consumes: `library.exportAll/replaceAll/resetAll` (Task 2), `session.view()`, `library.importAsNewDeck`.
- Produces ops: `'data:open-folder': [void, Result<void>]`; `'data:export-all': [void, Result<{path:string}|null>]`; `'data:import-all': [void, Result<{path:string}|null>]`; `'data:reset': [void, Result<void>]`; `'onboarding:practice': [{on:boolean}, void]`; `'onboarding:finish': [{cap:2|3|4; preset:TraitPreset; updateChecks:boolean; sampleDeck:boolean}, Result<{deckId:string|null}>]`.
- Produces `ControlEvent` variant `{type:'leave-it-pressed'}`; `LibrarySnapshot` gains `onboarded: boolean; version: string`.
- Produces `FileAccess` additions: `pickBackup(): Promise<Result<{path:string; text:string}|null>>`, `saveBackup(suggestedName:string, json:string): Promise<{path:string}|null>`.
- Produces `SAMPLE_DECK: {name:string; text:string}` (~12 `front,back` lines, half app-teaching, half trivia with short answers; parses with zero skipped rows).
- `createLeaveIt` deps gain `onIdlePress?: () => void` called instead of the "nothing to pause" notification when set and there is no session; `index.ts` sets it only while practice is on and sends the event to the control window.
- `debug.ts` gains `setNextDialogPath(path: string)`; `createFileAccess(parent, nextPath?: () => string | null)` uses it instead of opening a dialog (e2e only).

- [ ] **Step 1: Write failing tests.**
  - `data:reset` and `data:import-all` → `session-running` when `session.view().phase === 'running'`, and `library.resetAll/replaceAll` not called; allowed otherwise.
  - `data:import-all` with a cancelled picker returns `{ok:true,value:null}`, nothing replaced; with a >50 MB file → `file-too-large`.
  - `onboarding:finish` with `sampleDeck:true` and no deck of that name creates it (card count equals the number of `SAMPLE_DECK` lines); called twice only creates one; with `sampleDeck:false` → `deckId:null`; always sets `onboarded:true` and the cap/preset/updateChecks; invalid `cap:5` → `invalid-request`.
  - leaveIt: with `onIdlePress` set and no session, a press calls it and does not notify; without it, behaviour unchanged.
  - `sampleDeck.test.ts`: runs `SAMPLE_DECK.text` through `deckParse` → no skipped rows, no duplicate fronts.
  - After `data:reset`/`data:import-all` succeed, the handler calls `platform.afterReplace()` (hotkeys re-registered from the new settings, reduced motion reapplied, tray refreshed) *after* the library write resolved (assert call order with a spy).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Add `afterReplace: () => void` to `platform`; in `index.ts` it re-registers via `leaveIt.rebind(settings.leaveItHotkey)` and the bubble getter, applies reduced motion, `appTray.refresh()`, then `publishStatus()`. `data:open-folder` → `shell.openPath(dataDir)`. Export file name `barkstudy-backup-YYYY-MM-DD.json`.
- [ ] **Step 4:** tests PASS; full gate green.
- [ ] **Step 5: Commit** `feat(main): data export/import/reset and onboarding ops`.

---

### Task 5: Settings view

**Files:** create `src/renderer/control/formParts.tsx`, `src/renderer/control/settings.tsx`; modify `src/renderer/control/app.tsx`, `src/renderer/control/text.ts`, `src/renderer/control/styles.css`; test `tests/renderer/settingsModel.test.ts` (pure helpers in `src/renderer/control/settingsModel.ts`).

**Interfaces:**
- Consumes: ops from Tasks 3–4, `acceleratorFromKeyEvent`/`acceleratorLabel`, `Modal` ([modal.tsx](../../../src/renderer/control/modal.tsx)), `useToast`.
- Produces `settingsModel.ts`: `parseInterval(min: string, max: string): {ok:true; min:number; max:number} | {ok:false; message:string}` (whole minutes, 1 ≤ min ≤ max ≤ 240); `addExcluded(list: string[], entry: string): string[]` (normalized, deduped, unchanged if empty); `CAP_OPTIONS`, `PRESET_OPTIONS` (value + label + one-line description).
- Produces `formParts.tsx`: `RadioCards<T>({legend, value, options, onChange})` (a `fieldset`/`legend` with native radios); `HotkeyField({label, accelerator, onCommit(accel): Promise<Result<unknown>>})`.
- `View` in `app.tsx` becomes `'study'|'decks'|'history'|'settings'|'about'`.

- [ ] **Step 1: Write failing tests** for `parseInterval` (`'5','15'` ok; `'0','5'`, `'20','10'`, `'1.5','5'`, `'', '5'`, `'5','241'` fail with a message), `addExcluded` (`['a.exe']` + `' B.EXE '` → `['a.exe','b.exe']`; `''` and a duplicate leave it unchanged), and that `CAP_OPTIONS.map(o=>o.value)` is `[2,3,4]`.
- [ ] **Step 2:** `npx vitest run tests/renderer/settingsModel.test.ts` → FAIL.
- [ ] **Step 3: Implement** the model, then the view as five `<section aria-labelledby>`s exactly as in the spec (Study, Controls, Sound & motion, System, Data). Save-on-change with toast; text/number fields commit on blur or Enter; volume commits on release; the cap/preset section carries a "applies from your next session" note; excluded apps has per-row Remove, an "Add an open app" `<select>` from `openApps`, manual entry, "Restore defaults"; Data buttons Export/Import/Reset with confirm `Modal`s (reset names what goes and that a backup stays in the folder); re-read `settings:get` on mount and on `status` events. Visible `:focus-visible` ring; Esc cancels `HotkeyField` capture.
- [ ] **Step 4:** tests PASS; full gate green; run `npm run dev` with a throwaway `BARKSTUDY_USER_DATA` and click through each section once.
- [ ] **Step 5: Commit** `feat(control): settings view`.

---

### Task 6: Onboarding, About, nav

**Files:** create `src/renderer/control/onboardingFlow.ts`, `onboarding.tsx`, `about.tsx`; modify `app.tsx`, `text.ts`, `styles.css`; test `tests/renderer/onboardingFlow.test.ts`.

**Interfaces:**
- Consumes: `formParts` (Task 5), `drawDog` ([procedural.ts:215](../../../src/renderer/overlay/procedural.ts#L215)), `onboarding:*` ops and `leave-it-pressed` event (Task 4).
- Produces `onboardingFlow.ts`: `type Step = 'meet'|'personality'|'escape'|'privacy'|'login'|'sample'`; `STEPS: Step[]`; `type Flow = {step: Step; cap: 2|3|4; preset: TraitPreset; updateChecks: boolean; sampleDeck: boolean; leaveItSeen: boolean; leaveItBlocked: boolean}`; `initialFlow(s: Settings, loginAvailable: boolean, hasSampleDeck: boolean): Flow`; `reduce(f: Flow, a: Action): Flow`; `canAdvance(f: Flow): boolean`; `visibleSteps(loginAvailable: boolean): Step[]`; `shouldOnboard(load: {status:'loading'|'error'|'ready'}, snapshot: {onboarded:boolean} | null): boolean`.
- Actions: `next | back | set(field,value) | leaveItPressed | leaveItConflict(on) | continueAnyway`.

- [ ] **Step 1: Write failing tests.**
  - `shouldOnboard`: false for `loading`, false for `error`, false for `ready` with `onboarded:true`, true only for `ready` + `onboarded:false` (Review Focus 1).
  - `canAdvance` on the `escape` step is false until `leaveItPressed` or `continueAnyway`; true on conflict only after `continueAnyway`.
  - `back` from the first step stays put; `next` skips `login` when `loginAvailable` is false; `next` from the last step stays put.
  - `initialFlow` pre-fills from current settings (so "Run setup again" shows what they have) and sets `sampleDeck` true only when `hasSampleDeck` is false.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** the reducer, then `onboarding.tsx` (full window, replaces the nav shell; "Step n of N"; Back/Next; "Skip setup" applies defaults and still calls `onboarding:finish`; focus moves to each step's heading; step 3 sends `onboarding:practice {on:true}` on enter and `{on:false}` on leave/unmount; conflict shows an inline `HotkeyField`). The step-1 dog is one `drawDog` call on a canvas with a static idle frame (no animation under reduced motion). `about.tsx`: name, `snapshot.version`, MIT, links through `link:open`, "Run setup again". `app.tsx` renders onboarding when `shouldOnboard(...)`, adds Settings and About to the nav bottom group, and after finishing selects the sample deck on Study.
- [ ] **Step 4:** tests PASS; full gate green; manual: fresh userData → onboarding appears, real Ctrl+Alt+L press advances step 3.
- [ ] **Step 5: Commit** `feat(control): onboarding, About page and nav`.

---

### Task 7: e2e and docs

**Files:** modify `tests/e2e/control.spec.ts`, `escalation.spec.ts`, `overlay.spec.ts` (seed helper), `docs/test-matrix.md`, `PLAN.md`; create `tests/e2e/helpers.ts` (`seedOnboarded(userData)`), `tests/e2e/onboarding.spec.ts`, `tests/e2e/settings.spec.ts`.

- [ ] **Step 1:** add `seedOnboarded(userData)`: writes `<userData>/data/settings.json` as `{schemaVersion:1,data:{...DEFAULT_SETTINGS, onboarded:true}}`; call it in the three existing specs' launch so they skip onboarding (no env bypass in the app). Run `npx playwright test` → existing specs still pass.
- [ ] **Step 2: Write `onboarding.spec.ts`:** fresh userData shows the onboarding heading (not the Study view); complete it keyboard-only (Tab/Enter, `debug('pressHotkey','Control+Alt+L')` for the practice step) → starter deck listed on Decks, `onboarded` true; relaunch with same userData → no onboarding. A second test: write an invalid `settings.json` before launch → the "damaged file" notice shows and onboarding does not.
- [ ] **Step 3: Write `settings.spec.ts`:** change cap to Playful, preset to calm, add an excluded app → quit → relaunch → still set; rebind Leave it to Ctrl+Alt+K → `debug('leaveIt')` reports it and `pressHotkey('Control+Alt+L')` is false; rebinding onto the bubble hotkey shows an error and keeps the old one; Export all (dialog path via `setNextDialogPath`) → Reset → decks gone and onboarding shows → Import all → decks/history back; Reset/Import refused with a visible message while a session runs.
- [ ] **Step 4:** `npx playwright test` all green (old + new).
- [ ] **Step 5: Docs.** `docs/test-matrix.md` rows: real Ctrl+Alt+L practice press on a real keyboard; Start with Windows + `--hidden` login launch (packaged build, run in M6); high-DPI/150% text scale look of Settings and onboarding. PLAN.md M5 header: "M5a done / M5b next (T5.3–T5.6)".
- [ ] **Step 6: Commit** `test: M5a e2e, docs: test matrix and plan status`.

---

## Self-review

- **Spec coverage:** T1→Task 1; T2 (data)→Task 2 (+4); T3 ops→Tasks 3–4; T4 settings view→Task 5; T5 onboarding/About/nav→Task 6; T6 e2e/docs→Task 7. Assumptions: hotkeys (3), live vs next session (5 note), login item `--hidden` (3), update toggles stored only (1, 5), sample deck (4), strings in `text.ts` (all).
- **Known gaps by design:** a11y pass, diagnostics, power awareness, `i18n/en.ts` string sweep are M5b.
- **Type consistency:** `Settings` fields (Task 1) are the ones used in `settings:update` Omit, `onboarding:finish`, `initialFlow`; `Result<T>`/`ErrorCode` extended once in Task 2 and reused; `FileAccess` extended once in Task 4.
