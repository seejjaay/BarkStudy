# M6a: local packaging, fuses and auto-update (plus the flaky-test fix first)

## Context

M5 is merged into `main` (fast-forward; not pushed; 78 ahead of origin). M6 is release engineering. It splits like M5 did:

- **M6a (this plan):** everything that can be built and tested on this machine.
  - T6.1: packaging, fuses and ASAR integrity, the installer icon, the uninstaller's keep-data prompt.
  - T6.3: the updater.
  - The unfinished half of the M0 S5 spike (does electron-updater find, download and apply a newer build?), run against a local server.
- **M6b (later):** what needs GitHub Actions and the public repo.
  - T6.2: SignPath signing, which can be applied for now because the repo is public.
  - T6.4: release-please.
  - T6.5: winget.
  - T6.6: repo docs.
  - `release.yml`.

Facts found while planning that shape the work:

- **Nothing packaging-related exists yet.** There's no electron-builder, electron-updater or `@electron/fuses`, no `build/`, and `ci.yml` only checks.
  - Latest versions: electron-builder 26.18.0, electron-updater 6.8.11, `@electron/fuses` 2.1.3.
  - The S5 spike already proved that an unsigned NSIS installer works and that koffi runs from `app.asar.unpacked`.
- **The userData folder isn't pinned.** Nothing sets `productName` or calls `app.setName`. In dev the folder is `name` (`barkstudy`); packaged, it's `productName`. Renaming the app in T7.3 would orphan everyone's data.
- **`app.setAppUserModelId` is never called.** Notifications from the installed app need the AUMID (the app identity Windows attaches notifications to) to match the shortcut's, which electron-builder sets to `appId`.
- **Settings already store the update toggles.** `updateChecks` and `betaChannel` are saved, validated and shown ([settings.tsx:144-151](src/renderer/control/settings.tsx#L144-L151)). The hint `updatesNote` says "arrives in a later version".
- **The updater's requests won't be blocked.** The network guard covers only the UI partition ([network.ts](src/main/network.ts)), and its comment already anticipates the updater.

Decisions CJ made:

- **appId:** `io.github.seejjaay.barkstudy`, locked now.
- **Mid-session update:** "Restart to update" waits until the session ends.
- **Uninstall:** asks whether to delete data, default **keep**. Silent and update-time uninstalls never ask and never delete.

Every task ends with `npm run typecheck && npm run lint && npm test` green. Each commit is CJ-confirmed (Global Constraints).

## Task 0: flaky-test fix (on `main`, before M6a)

- [tests/main/storage.test.ts:67](tests/main/storage.test.ts#L67): `50 concurrent writes…` timed out at 5 s in 1 of 5 full runs.
  - Cause: it does 50 serialized real fsyncs while 62 workers run in parallel. It's not a logic bug.
  - Fix: give that one `it` an explicit timeout (20 s) with a one-line comment saying why. Leave the global `testTimeout` alone.
- The first run on merged `main` showed **2** failing files, and only the storage one was identified. Run `npm test` 5× after the fix.
  - Capture any other failure the same way: `grep -E '^ *(FAIL|×)'`.
  - If it's another load-induced timeout, fix it the same way. If it's anything else, stop and debug it (systematic-debugging) before M6a.
- Commit: `test: give the fsync-heavy storage test room under a full parallel run`.

## M6a tasks (branch `m6a-packaging-updater` from `main`)

First commit on the branch: mirror this plan to `docs/superpowers/plans/2026-11-02-m6a-packaging-updater.md`, and add the M6a/M6b split note to the PLAN.md M6 header (same pattern as M5).

### T1. Identity: pin userData, set the AUMID, lock appId

- New `src/main/identity.ts`:
  - `APP_ID = 'io.github.seejjaay.barkstudy'`
  - `USER_DATA_NAME = 'BarkStudy'`
  - `PRODUCT_NAME = 'BarkStudy'`
- [index.ts](src/main/index.ts), before the first `app.getPath` (currently `logDir` at line 45):
  - `app.setPath('userData', join(app.getPath('appData'), USER_DATA_NAME))`
  - `app.setAppUserModelId(APP_ID)`
  - Dev keeps using the same folder, because Windows paths are case-insensitive (`barkstudy` and `BarkStudy` are the same directory).
- `tests/main/identity.test.ts`: reads `electron-builder.yml` as text and checks that the `appId:` and `productName:` lines equal the constants. This stops the code and the build config from drifting apart.
- [docs/release.md](docs/release.md): replace `<owner> pending` with the locked value, and add the userData pin to the never-change table.
- `package.json`: `version` → `0.1.0`. From M6b, release-please owns the version.

### T2. Installer icon from the code-drawn art

- `scripts/make-icon.ts` writes `build/icon.ico` from `makeIcon` ([icon.ts](src/main/icon.ts)).
  - Sizes: 16, 24, 32, 48, 64, 128 and 256.
  - Format: 32-bit BGRA DIB entries (uncompressed bitmaps), not PNG. They're simplest and every tool reads them, NSIS and rcedit included. `makeIcon` already outputs BGRA.
  - DIB rows are stored bottom-up, and each entry needs an AND mask.
- `build/icon.ico` is generated, so it goes in `.gitignore`. `build/installer.nsh` (T3) is tracked.
- This is a swappable placeholder, matching the M4 memory on placeholder art: final art just replaces the generator's output.
- `tests/main/makeIcon.test.ts`: parse the ICO header and check entry count, sizes, offsets, and that one pixel matches `makeIcon`.

### T3. Packaging config, fuses and the uninstaller

- Dependencies:
  - devDependencies: `electron-builder@26.18.0`, `@electron/fuses@2.1.3`
  - dependencies: `electron-updater@6.8.11`. It has to be a runtime dependency so it ends up in the asar.
  - npm 12 blocks install scripts. electron-builder's postinstall isn't needed, so don't approve it.
- `electron-builder.yml`:
  - `appId`, `productName`, `directories.output: release`.
  - `files: [out/**, package.json]`, `asarUnpack: node_modules/koffi/**` (as in S5).
  - `win.target: nsis x64`, `win.icon: build/icon.ico`.
  - `nsis`:
    - `oneClick: true`, `perMachine: false`, `allowElevation: false`. That's a per-user install with no admin.
    - `include: build/installer.nsh`.
    - `uninstallDisplayName`.
  - `electronFuses`:
    - Off: `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`.
    - On: `onlyLoadAppFromAsar`, `enableEmbeddedAsarIntegrityValidation`.
  - `publish: { provider: github, owner: seejjaay, repo: BarkStudy, releaseType: draft }`. This writes `resources/app-update.yml`.
  - `signAndEditExecutable`:
    - Try the default first. It downloads winCodeSign, which may need Developer Mode for symlinks.
    - If that fails on this machine, set it to `false` locally and record why in `docs/spike-results.md`. Note that the exe icon and version info then come only from the CI build (M6b).
- `build/installer.nsh`, `customUnInstall` macro:
  - Skip entirely when `${isUpdated}` (an update runs the old uninstaller) or `IfSilent` (winget, `/S`).
  - Otherwise: `MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2` "Also delete your decks and study history?" On Yes: `RMDir /r "$APPDATA\BarkStudy"`.
  - The installer strings live in NSIS, not `en.ts`. Note that exception in `docs/release.md`.
- `package.json` script: `"package": "npm run build && tsx scripts/make-icon.ts && electron-builder --win --publish never"`. `release/` is already gitignored.
- Check `npm audit --audit-level=high` with the new devDependencies. If it trips, record which package and decide with CJ. Don't add blind overrides.

### T4. Packaged-build checks (`scripts/verify-package.cjs`)

The script prints PASS/FAIL per line and exits non-zero on any FAIL (the overlay-testing lesson):

1. Read `release/win-unpacked/BarkStudy.exe` with `@electron/fuses` `getCurrentFuseWire` and check all five fuses.
2. `resources/app.asar` exists, and `koffi` is under `app.asar.unpacked`.
3. `resources/app-update.yml` names provider `github` and owner `seejjaay`.
4. Tamper test:
   - Copy `win-unpacked` to a temp dir, flip one byte inside `app.asar`, and launch.
   - Expect it to exit within 10 s without opening a window.
   - Kill it if still alive, and delete the copy.
5. RunAsNode test: launch with `ELECTRON_RUN_AS_NODE=1 … -e "console.log('node')"`. It must not print `node`.

Add `npm run package && node scripts/verify-package.cjs` as a step in the `windows-latest` CI job, so packaging breakage shows up in CI. That reaches GitHub only when CJ pushes.

### T5. Updater core (`src/main/updater.ts`, pure and injected)

- `createUpdater({ client, settings, enabled, timers, log, notify, sessionRunning, onChange })`. `client` is a narrow interface over electron-updater's `AppUpdater`:
  - `checkForUpdates`, `quitAndInstall`
  - `allowPrerelease`, `autoInstallOnAppQuit`
  - event subscription
- The view is `{ state: 'unavailable' | 'off' | 'idle' | 'checking' | 'downloading' | 'ready'; version?: string }`.
- When it runs:
  - With `enabled` false (unpackaged, or e2e), the state is `unavailable`. There are zero network calls and electron-updater is never constructed.
  - The client is built lazily inside a try. If it fails, the error is logged and the state stays `unavailable`. That follows the lesson on building optional modules inside their failure path.
  - Checks run 30 s after launch (startup is never slowed), then every 6 h. Both delays are constants, which follows the timer-delay lesson.
  - At most one check is in flight.
- Settings changes:
  - **`updateChecks` off:** timers are cleared, the state is `off`, and `autoInstallOnAppQuit = false`, so a download that already finished isn't installed on quit.
  - **`updateChecks` on:** check now, then reschedule.
  - **`betaChannel` changes:** `allowPrerelease = betaChannel`, then check now. `allowDowngrade` stays false, so leaving beta never downgrades.
- Download:
  - `autoDownload` is on and runs in the background.
  - On `update-downloaded`, the state becomes `ready` and there's one notification per version: "BarkStudy {v} is ready. Restart from the tray when you're done."
- Errors are silent: `log.warn` with the message only and no URLs, the state goes back to what it was, and the next cycle retries.
- `restart()`:
  - Refused unless the state is `ready` and no session is running (CJ's call).
  - Otherwise `quitAndInstall(true, true)`, which is silent and relaunches.
  - Quitting normally while ready installs on quit (`autoInstallOnAppQuit` stays true while checks are on).
- Ways out of `ready` (state-exit lesson): restart, a normal quit (installs), or turning checks off (no install). Each has a test that starts from `ready`.
- `src/main/updaterClient.ts` is the thin electron-updater adapter. It wires the logger into `log` and sets `autoDownload: true` and `allowDowngrade: false`.
- `tests/main/updater.test.ts`, with a fake client and fake timers, covers:
  - the 30 s launch check and the 6 h cadence
  - off means zero checks (property test over random toggle sequences; it counts that "on" states are reached, per the property-test lesson)
  - the beta flag reaching `allowPrerelease`
  - an error staying silent and being retried next cycle
  - one notification per version
  - restart refused while a session runs, and allowed after it ends
  - turning checks off from `ready` clears install-on-quit
  - `unavailable` never constructing the client

### T6. Wiring: tray, settings, diagnostics

- [index.ts](src/main/index.ts):
  - Create the updater after the tray, with `enabled: app.isPackaged && !e2e` and `sessionRunning: () => studySession.view().phase === 'running'`.
  - `onChange` → `publishStatus()`, which already refreshes the tray and pushes the status.
  - Call `start()` next to `power.start()`, and dispose it in `before-quit`.
- [trayModel.ts](src/main/trayModel.ts):
  - `TrayInputs.update`.
  - Before Open/Quit: when `ready` with no session, show `{ id: 'restart-update', label: TRAY.restartToUpdate(v) }`. When `ready` during a session, show the disabled `TRAY.updateAfterSession`.
  - `parseTrayAction` and `runTrayAction` get `restart-update`, and `TrayActionDeps` gets `restartToUpdate`.
  - When the session ends, `publish` already refreshes the tray, so the item flips back to clickable by itself.
- [controlHandlers.ts](src/main/controlHandlers.ts):
  - `updateSettings` calls `platform.updatesChanged()` when the patch touches `updateChecks` or `betaChannel`.
  - `afterReplace` calls it too, because a restore swaps the settings.
  - New op `update:restart`, which returns a Result error code `session-running` when refused.
- `AppStatus` gets `update: UpdaterView`.
- Settings → System replaces `updatesNote` with a status line for each state: unavailable ("Updates work in the installed app"), off, up to date, checking, downloading, and ready.
  - In `ready`, a **Restart to update** button appears. It's disabled during a session, with the reason written next to it.
  - Every state shows its word in text, never colour alone (status lesson).
- All strings go in `src/shared/i18n/en/settings.ts` and the tray strings file, so the inline-string guard stays green. `updatesNote` and its onboarding wording get updated, since checks are real now.
- Diagnostics: add `update: view.state` to `state` (no URLs, no versions beyond our own).
- Tests:
  - `tray.test.ts`: the item in both cases, and the id round trip.
  - `controlHandlers.test.ts`: `updatesChanged` fires only for those two keys and after a restore, and `update:restart` is refused mid-session.
  - `settings.spec.ts` (e2e): the unavailable line shows in the unpackaged app. Run `a11y.spec.ts` over the changed section.

### T7. Local update dry run (S5 second half)

`scripts/update-dryrun.cjs`:

- Build A (`0.1.0`) and B (`-c.extraMetadata.version=0.1.1`), both with `-c.publish.provider=generic -c.publish.url=http://127.0.0.1:47613/`, into `release/dryrun/{a,b}`. The production config stays GitHub-only, and the packaged app has no feed override.
- Serve B's `latest.yml`, installer and blockmap from a server the script starts itself, on a fixed unusual port. Fail if the port is taken (lesson on owning the test server).
- Prep: **back up `%APPDATA%\BarkStudy` first** (it's CJ's real dev data too) and restore it at the end. Install A silently (`/S`) and launch it.
- Wait for the `update downloaded 0.1.1` line in `logs/app.log`. Then CJ clicks **Restart to update** in the tray, and the script waits.
- Assert:
  - The installed exe's file version is 0.1.1.
  - The app relaunched.
  - A sentinel deck is still there.
- Then a silent uninstall: data kept, no prompt.
- Manual part, which CJ does: uninstall from Settings → Apps.
  - The prompt shows with No as the default, and No keeps the data.
  - Yes is checked only after the backup is safe.
- Record the results:
  - `docs/spike-results.md` S5 row 26 goes to Pass or Fail.
  - New `docs/test-matrix.md` rows: install, update applies, update waits for the session, uninstall prompt, silent uninstall keeps data, fuses and tamper. Row 27 (start with Windows) becomes runnable.
- Installing on CJ's machine is a real system change, so ask before running it.

## Files

- **New:**
  - `src/main/identity.ts`, `src/main/updater.ts`, `src/main/updaterClient.ts`
  - `electron-builder.yml`, `build/installer.nsh`
  - `scripts/make-icon.ts`, `scripts/verify-package.cjs`, `scripts/update-dryrun.cjs`
  - `tests/main/{identity,makeIcon,updater}.test.ts`
- **Changed:**
  - `src/main/index.ts`, `src/main/trayModel.ts`, `src/main/controlHandlers.ts`
  - `src/shared/control.ts`, `src/renderer/control/settings.tsx`, `src/shared/i18n/en/*`
  - `package.json`, `.gitignore`, `.github/workflows/ci.yml`
  - `docs/release.md`, `docs/spike-results.md`, `docs/test-matrix.md`, `PLAN.md`
- **Reused:**
  - `makeIcon` ([icon.ts](src/main/icon.ts))
  - `publishStatus`/`notify` and the `before-quit` cleanup ([index.ts](src/main/index.ts))
  - `buildTrayMenu`/`parseTrayAction`/`runTrayAction` ([trayModel.ts](src/main/trayModel.ts))
  - the `loginItem` `isPackaged` pattern ([index.ts:252](src/main/index.ts#L252))
  - `UI_PARTITION` guard (unchanged)

## Verification

1. Task 0: `npm test` 5× in a row, all green.
2. Per task: `npm run typecheck && npm run lint && npm test`. After T6: `npm run e2e` (settings, a11y and keyboard specs).
3. `npm run package` produces `release/BarkStudy Setup 0.1.0.exe`. Then `node scripts/verify-package.cjs` must be all PASS: fuses, asar, koffi unpacked, `app-update.yml`, tamper refused, no RunAsNode.
4. The packaged app launches, the tray and dog come up, Settings → System shows a real update status, and notifications carry the BarkStudy identity.
5. With CJ's OK: `node scripts/update-dryrun.cjs`, end to end, including the manual uninstall prompt. Record the results in spike-results and the test matrix.
6. End of M6a: run requesting-code-review on the branch, then finishing-a-development-branch.
