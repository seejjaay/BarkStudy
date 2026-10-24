# M0 spike results

Machine: Windows 11 (10.0.26300), one display, 1920x1080 physical at 125% (1536x864 DIP), Electron 45.0.0, koffi 3.3.3.
Code: `spike/` (throwaway, deleted at the end of M2). Run `spike\run.cmd all` to repeat the automated checks.

Most checks are **automated self-tests** using synthetic input (`mouse_event`, `keybd_event`) and Win32 hit-testing (`WindowFromPoint`). They prove the mechanics at the current scale. They do not replace a human look at 100% and 150%, or a real drag with a real mouse; those are listed under "Still open".

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| S1 | Overlay is topmost (`alwaysOnTop('screen-saver')`, `skipTaskbar`, `focusable:false`) | **Pass** at 125% | First in z-order of visible windows |
| S1 | Click-through away from the dog | **Pass** | `WindowFromPoint` under the cursor resolves to the app beneath (`code.exe`), not the overlay |
| S1 | Hover hit-test captures over the dog and releases after | **Pass** | Renderer `mousemove` (forwarded by `setIgnoreMouseEvents(true,{forward:true})`) toggles over IPC; window under cursor flips overlay ↔ app; a click on the dog registered |
| S2 | Enumeration via koffi (`EnumWindows`, visible, skip tool windows, cloaked, minimized, own pid) | **Pass** | 0.43 ms per refresh for 3 windows; process names resolved via `QueryFullProcessImageNameW` |
| S2 | DWM frame bounds → DIP via `screen.screenToDipRect` | **Pass** at 125% | Matches Electron's own `getBounds()` within 1 DIP (rounding) |
| S2 | Outlines sit on real windows | **Pass** at 125% (screenshot of the top strip) | Outlines coincide with window edges; title-bar band covers the real title bars |
| S3 | `SetWinEventHook` (`WINEVENT_OUTOFCONTEXT`) via `koffi.register` on the main thread | **Pass** | 150 `LOCATIONCHANGE` events for 150 moves; largest gap 33.8 ms; callback max 0.06 ms; redraw flush p95 1.06 ms; tracked position equals the window within 1 px |
| S4 | Click on the bubble → `setFocusable(true)` + `focus()` takes keyboard focus | **Pass** | Foreground became the overlay |
| S4 | Typing reaches the input | **Pass** | Submitted `"hi"` |
| S4 | Focus returns to the previous app after `blur()` + `setFocusable(false)` | **Pass** | `code.exe` → overlay → `code.exe`, **without** us calling `SetForegroundWindow` (keeps the "never focus another window" constraint) |
| S4 | Dynamic `Escape`: captured while registered, normal after unregister | **Pass** | Registered: callback fired, focused window saw nothing. Unregistered: focused window received it |
| S5 | NSIS installer builds unsigned (electron-builder 26) | **Pass** | 122 MB installer |
| S5 | Silent per-user install, packaged app runs, koffi + WinEvent hooks work inside the asar build | **Pass** | `koffi` unpacked to `app.asar.unpacked`; packaged smoke test 3/3 |
| S5 | Uninstall leaves nothing | **Pass** | No files, no HKCU uninstall entry, no Start Menu shortcut |
| S5 | electron-updater finds, downloads and applies a newer version | **Not run** | Needs a release host; GitHub is on hold. Can be tried against a local generic-provider server, which tests the updater mechanics but not GitHub Releases specifics |

## Decisions

1. **Tracker: WinEvent hooks.** S3 passes with large margin, so the runtime uses hooks. The 20 Hz poll costs about 0.4 ms per refresh, so it stays as the automatic fallback when the hook fails (plan decision 10).
2. **Overlay: one window per display.** Mixed-DPI could not be tested (single monitor), and a single window spanning monitors of different scale is the known risky case. Per-display windows work whatever the scales are. Revisit only if a second monitor shows a single window is safe.
3. **Return focus by closing, not by calling.** Use `blur()` + `setFocusable(false)` and let Windows restore focus. It worked, and it respects the Win32 read-only constraint.
4. **Bounds source: `DWMWA_EXTENDED_FRAME_BOUNDS`, never `GetWindowRect`.** Even for a frameless window `GetWindowRect` was 16 px wider and 8 px taller (invisible resize border).

**Go/no-go: GO for Milestone 2**, with the open items below carried as manual checks in the M2 test matrix.

## Notes for M2 and release engineering

- **VS Code sets `ELECTRON_RUN_AS_NODE`.** Electron then behaves as plain Node (`electron --version` prints Node's). Unset it when launching (`spike\run.cmd` does). The product build has the `RunAsNode` fuse off anyway.
- **npm 12 blocks install scripts.** Electron's own `install.js` (downloads the binary) did not run; run `node node_modules/electron/install.js` or approve it with `npm install-scripts approve`. koffi loads without its install script.
- **electron-builder** wants `electron` in `devDependencies`. `win.signAndEditExecutable:false` was used for the unsigned local build; the default path downloads `winCodeSign` and may need symlink privileges (Developer Mode) on Windows, which is untested.
- Overlay hit-testing relies on `mousemove` forwarding, which only fires on real mouse movement; always nudge the mouse in tests.
- Enumerate with `EnumWindows` for z-order (top first); no need for `GetWindow(GW_HWNDNEXT)`.

## Still open (needs a human or other hardware)

- [ ] **100% and 150% scaling:** run `spike\run.cmd s3 --keep` at each scale (Settings → System → Display → Scale) and confirm the outlines and title-bar bands sit on real windows. Then rerun `spike\run.cmd all` at each scale.
- [ ] **Drag feel:** with `run.cmd s3 --keep`, drag a window around by its title bar and confirm the outline follows without visible lag.
- [ ] **Mixed-DPI, two monitors:** needs a second display at a different scale. Deferred; decision 2 avoids depending on it.
- [ ] **Auto-update (S5 second half):** needs a release host.
- [ ] **SignPath Foundation application:** needs the public GitHub repo.
