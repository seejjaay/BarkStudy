# M5a design: product shell, part 1 (settings, data, onboarding, About)

Status: approved in conversation on 2026-10-31, pending review of this document.

## Context

M4 is merged (`main` @ 34a9c16, not pushed). PLAN.md's Milestone 5 makes BarkStudy usable by a stranger: install → onboarding → study → change settings → export/back up/restore. It's split in two (CJ's call):

- **M5a (this plan):** T5.1 onboarding, T5.2 settings + data, About page.
- **M5b (later plan):** T5.3 a11y pass, T5.4 diagnostics, T5.5 power awareness, T5.6 e2e smoke flows.

Today the `Settings` type and `library.updateSettings` exist ([settings.ts](src/shared/settings.ts), [library.ts:340](src/main/library.ts#L340)), but there's no settings UI, no IPC to write settings, no first-run flag, no whole-data export/import/reset, and the control nav only has Study / Decks / History ([app.tsx:10](src/renderer/control/app.tsx#L10)).

**Decided:** presets only (no trait sliders, retune in M7); settings save on change with a toast; Import all **replaces** everything (backup first, refused mid-session).

**Assumptions (override if wrong):**
- **Hotkeys:** Leave it and bubble-focus are rebindable. Esc stays Esc.
- **Live vs next session:** cap and preset changes apply from the next session; the UI says so. Sound, volume, excluded apps and reduced motion apply live; they're already read live except reduced motion.
- **Start with Windows** is only offered in packaged builds (`app.isPackaged`). Dev shows it disabled with a note. The login launch passes `--hidden`, so the app comes up tray-only.
- **Update toggle:** the update-check and beta-channel toggles are stored now and read by M6's updater.
- **Sample deck:** "Pandesal's starter deck", about 12 short cards. Half teach the app (e.g. "Key that stops zoomies → Esc"), half are light trivia with short typeable answers.
- **Strings:** new UI strings go in [text.ts](src/renderer/control/text.ts), the existing control pattern. The sweep into `i18n/en.ts` is an M5b item, to be flagged there.

## Tasks (each ends `npm run typecheck && npm run lint && npm test` green, CJ-confirmed commit)

### T1. Settings schema + strict checks
- **New fields in [settings.ts](src/shared/settings.ts):**
  - `onboarded: boolean`
  - `reducedMotion: 'system' | 'on' | 'off'`
  - `updateChecks: boolean`
  - `betaChannel: boolean`
  - `bubbleHotkey: string` (default `BUBBLE_HOTKEY` from [bubble.ts:22](src/shared/bubble.ts#L22))
- **Older files:** extend `StoredSettings` + `fillSettings` (existing pattern) so a file without the new fields loads. A missing `onboarded` → `false`.
- **`isSettings`** ([validate.ts:41](src/shared/validate.ts#L41)) accepts the new fields as optional, so the v1 fixture still loads.
- **`checkSettings(s): string | null`:** a new, stricter check used by `updateSettings` (not by `isSettings`, so a stored file is never rejected by the stricter rules). It enforces:
  - preset ∈ `TRAIT_PRESETS`
  - 1 ≤ min ≤ max ≤ `MAX_INTERVAL_MINUTES` (move it from [session.ts:28](src/main/session.ts#L28) into shared)
  - excluded apps lower-case, ≤ 260 chars, ≤ 100 entries, deduped
  - hotkeys parse as accelerators, and the two hotkeys differ
- **New `src/shared/accelerator.ts`** (pure):
  - `fromKeyEvent({key, code, ctrl, alt, shift, meta}) → string | null` builds an Electron accelerator. It needs Ctrl or Alt plus one non-modifier key, and rejects Esc and reserved combos.
  - `label(accelerator)` gives the display text.
  - `isAccelerator(s)` is the format check.
- **Tests:** `tests/shared/settings.test.ts`, `tests/shared/accelerator.test.ts`. The v1 fixture fills to valid settings.

### T2. Library + storage: whole-data export / import / reset
- **[io.ts](src/main/storage/io.ts):**
  - Expose `storage.backup(def)`, which wraps the existing `copyToBackups` for the current file and is a no-op if there's no file.
  - Export a pure `upgrade(def, schemaVersion, data)` built from the existing `migrate` step loop: migrate, then validate; refuse versions newer than current.
- **Bundle format:** `{ app: 'barkstudy', kind: 'backup', exportedAt, stores: { decks: {schemaVersion, data}, settings: {…}, history: {…} } }`. It mirrors the on-disk envelope, so old exports upgrade through the same migrations.
- **[library.ts](src/main/library.ts):**
  - `exportAll(): string` produces the JSON bundle.
  - `replaceAll(json)` parses and upgrades **all three** parts before writing any. Then it backs up each current file, writes it and swaps the in-memory slot. A store that was `unavailable` becomes writable again, and its notice is cleared.
  - `resetAll()` does the same with each store's `fallback()`.
  - Both go through the existing per-slot `chain`.
  - A mid-way write failure returns `write-failed` and names the stores that were already replaced. Backups make it recoverable.
- **New `ErrorCode`s:** `'not-a-backup'`, `'newer-version'`, `'hotkey-taken'`, `'hotkey-invalid'`, `'session-running'`, plus matching `ERROR_TEXT` entries.
- **Tests (library + io):**
  - The export→replace round trip is deep-equal.
  - An invalid or newer part writes nothing.
  - A backup exists before the write.
  - The unavailable-store recovery path works.
  - Reset gives fallbacks with `onboarded: false`.
  - New fixture `tests/fixtures/backups/v1-export.json`, generated from a real `exportAll`, so future migrations keep it importable.

### T3. Control ops + main wiring
- **New ops in [control.ts](src/shared/control.ts)** (+ `OP_NAMES`), handled with argument checks in [controlHandlers.ts](src/main/controlHandlers.ts), same style as the existing parse helpers:
  - `settings:get` → `{ settings, loginItem: { available, on }, openApps: string[] }`. `openApps` comes from the deduped `processName`s of the windows the tracker already sees (no new Win32 calls).
  - `settings:update` takes `Partial<Settings>` minus the hotkeys and `onboarded`, then calls `library.updateSettings` and the live effects (reduced motion → `dogHost.setReducedMotion`, resolving `'system'` through the existing `systemPreferences` call at [index.ts:198](src/main/index.ts#L198)).
  - `settings:hotkey {which, accelerator}`:
    - Leave it uses `leaveIt.rebind` first (it already keeps the old binding if the new one is taken), then persists. If the persist fails, it rebinds back.
    - Bubble does a test-register/unregister, then persists. `bubbleHost` reads the accelerator from settings instead of the constant.
  - `settings:login-item {on}` → `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`. It returns `unavailable` when not packaged.
  - `data:open-folder` → `shell.openPath(dataDir)`.
  - `data:export-all` uses a save dialog.
  - `data:import-all` uses an open dialog and has a size cap.
  - `data:reset` and `data:import-all` are refused with `session-running` while a session runs, so a reset can't wipe the dig-in cooldown mid-session.
  - `onboarding:practice {on}`: while it's on, a Leave it press with no session sends ControlEvent `{type: 'leave-it-pressed'}` instead of the "nothing to pause" notification. This needs a small hook in [leaveIt.ts](src/main/leaveIt.ts) at its `no-session` branch.
  - `onboarding:finish {cap, preset, updateChecks, sampleDeck}` writes the settings plus `onboarded: true`. If `sampleDeck` is set and no deck has that name, it imports `src/shared/sampleDeck.ts` via `library.importAsNewDeck`, reusing the parser. It returns `{ deckId | null }`.
  - `link:open {id}` uses a new `src/main/links.ts` hardcoded allowlist (repo, releases, license) → `shell.openExternal`. That's the only call site.
- **`LibrarySnapshot`** gains `onboarded` and `version` (`app.getVersion()`).
- **After a replace or reset,** main re-registers both hotkeys and reapplies reduced motion from the new settings, refreshes the tray, then pushes a `status` event. The push goes **after** the writes land, so the renderer's re-read isn't stale.
- **Startup in [index.ts](src/main/index.ts):** `--hidden` or `wasOpenedAtLogin` skips `controlWindow.show()`, and the saved `reducedMotion` is applied at startup.
- **File dialogs:** [files.ts](src/main/files.ts) gains `pickBackup` and `saveBackup`. Under e2e, [debug.ts](src/main/debug.ts) can preset the next dialog path, since there's no dialog stub today.
- **Tests:** extend `tests/main/controlHandlers` tests. Every new op rejects malformed args, data ops are refused mid-session, a taken hotkey keeps the old one and returns `hotkey-taken`, and `link:open` with an unknown id is refused.

### T4. Settings view
- **New `src/renderer/control/settings.tsx`.** It's one scrolling page with five labelled sections, each a `<section aria-labelledby>`:
  - **Study:** cap as a 3-option radio group (Gentle / Playful / Full dog, each with a one-line description); preset as a radio group (calm / classic / drama queen, with descriptions); check-in min/max number inputs that commit on blur or Enter and show an inline error.
  - **Controls:** two `HotkeyField`s. Focus → "Press a shortcut…", Esc cancels, the live conflict shows inline, and a note says Esc is fixed.
  - **Sound & motion:** sound toggle; volume range that commits on release; reduced motion radio (Follow Windows / On / Off).
  - **System:** start with Windows; check for updates and beta channel (beta is disabled while updates are off).
  - **Data:** open folder; export all; import all and reset, both behind confirms via [modal.tsx](src/renderer/control/modal.tsx). The reset dialog names what goes and says a backup copy stays in the folder.
- **Excluded apps** is a list with a remove button per row, an "Add an open app" select fed by `openApps`, a manual entry field, and "Restore defaults".
- **Every write** fires a toast via [toast.tsx](src/renderer/control/toast.tsx) on success and on failure. The view re-reads `settings:get` on mount and on `status` events.
- **The Study tab's** interval defaults keep coming from `snapshot.defaults` (already wired).

### T5. Onboarding + About + nav
- **[app.tsx](src/renderer/control/app.tsx):** `View` adds `'settings' | 'about'`, and NAV puts Settings and About in a bottom group.
- **When onboarding shows:** only when `load.status === 'ready'` and `!snapshot.onboarded`. It never shows on a load error or while loading. A load error keeps the existing error view, so a corrupt settings file can't masquerade as a first run.
- **Layout:** onboarding replaces the nav shell, full window.
- **New `onboardingFlow.ts`,** a pure reducer that `onboarding.tsx` renders. It has six steps, with "Step n of 6", Back/Next, and "Skip setup" (defaults, still marks onboarded). Focus moves to each step's heading.
  1. **Meet Pandesal.** A small canvas uses the existing `drawDog` ([procedural.ts:215](src/renderer/overlay/procedural.ts#L215)) with a static idle frame (a still frame under reduced motion), plus who he is.
  2. **Personality.** Preset and cap, the same controls as Settings (shared components).
  3. **Escape hatches.**
     - Esc is explained.
     - Then "Press Ctrl+Alt+L once to continue" via `onboarding:practice`. Next unlocks on `leave-it-pressed`.
     - If Leave it is in conflict, it says so and offers an inline `HotkeyField` to pick another, or "Continue anyway, use the tray menu".
  4. **Privacy.** A plain summary (window positions and process names only, nothing leaves the PC, one update check) and the update-check toggle.
  5. **Start with Windows.** Hidden when unavailable.
  6. **Sample deck.** A checkbox, default on when there are no decks, and "Start studying" → `onboarding:finish`. It lands on Study with the sample deck selected.
- **New `about.tsx`:** name, version, MIT, allowlisted links, and "Run setup again". That re-enters onboarding, prefilled from current settings; the sample deck is offered only if it's missing.
- **[styles.css](src/renderer/control/styles.css):** form, radio-card, step and hotkey-field styles on the existing tokens; visible `:focus-visible`; state is never carried by colour alone.

### T6. e2e + docs
- **Existing specs launch with a fresh userData,** so they'd now hit onboarding. Add a launch option that seeds `settings.json` with `onboarded: true` and use it from the existing `launch()` helpers. Don't add an env bypass in the app.
- **New `tests/e2e/onboarding.spec.ts`:**
  - First run → onboarding, done keyboard-only, with the Leave it practice pressed through the debug recorder's hotkey hook → sample deck exists → relaunch skips onboarding.
  - Never-resolving and erroring snapshot loads don't show onboarding.
- **Settings e2e:**
  - Change cap, preset and excluded apps → relaunch → still set.
  - Rebind Leave it → the new accelerator is registered and the old one released.
  - Export all → reset → import all → decks and history are back.
- **Docs:** `docs/test-matrix.md` rows for the real Ctrl+Alt+L practice, Start with Windows (packaged build, to run in M6) and the `--hidden` login launch. Update PLAN.md M5 to "M5a done / M5b next".

## Verification
- After each task: `npm run typecheck && npm run lint && npm test`.
- After T6: `npx playwright test` (all specs, old and new).
- Then a manual run (`npm run dev`) with a fresh userData:
  - Onboarding renders. A real Ctrl+Alt+L press advances step 3.
  - The sample deck session works.
  - Lowering the cap shows the "next session" note.
  - Reduced motion On slows him immediately.
  - Export → reset → import restores.
  - Tab order through Settings is sane.
