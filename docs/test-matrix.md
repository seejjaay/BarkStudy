# Manual test matrix

Run before every release (and after any change to `src/main/tracker`, `src/main/overlay.ts`, `src/shared/geometry.ts` or `src/shared/physics.ts`).

**How:** `npm run build`, then `npx electron .` (unset `ELECTRON_RUN_AS_NODE` if your terminal has it, as VS Code's does). Quit with **Ctrl+Alt+Q**. Change scale in Settings → System → Display → Scale. For two monitors, give them different scales.

Legend: **auto** = covered by an automated test on the dev machine at the stated setup (not a substitute for a human look at other setups). **todo** = needs a person. Fill a cell with the date and your initials when you run it.

## Setups

| ID | Setup |
|---|---|
| A | 1 monitor, 100 % |
| B | 1 monitor, 125 % (dev machine, 1920×1080 laptop panel) |
| C | 1 monitor, 150 % |
| D | 2 monitors, mixed scale (for example 100 % and 150 %) |

## Cases

| # | Case | A | B | C | D | Automated coverage |
|---|---|---|---|---|---|---|
| 1 | The dog stands exactly on a title bar (no gap, no sinking into it) | todo | auto (outline check, M0 spike; e2e `y` equals the window top) | todo | todo | spike screenshot, e2e drag test, `geometry.test.ts` scale fixtures 1 / 1.25 / 1.5 |
| 2 | Dragging that window carries the dog along without lag or jumping | todo | auto (e2e, 300 px over 30 moves) | todo | todo | `physics.test.ts` riding, e2e `dragging a window carries Pandesal along` |
| 3 | Fast drag (flick the window across the screen) never shakes the dog off or loses it | todo | todo | todo | todo | `physics.test.ts` 100 px/frame |
| 4 | Dragging the ridden window onto the other monitor: the dog goes with it, onto that monitor's overlay | n/a | n/a | n/a | todo | `dogHost.test.ts` display respawn |
| 5 | Maximised window: the dog is visible standing in the title bar band, not off-screen | todo | todo | todo | todo | `geometry.test.ts` headroom clamp |
| 6 | Fullscreen app or video in front: the dog disappears on that display, comes back after | todo | todo | todo | todo | `geometry.test.ts` + `dogHost.test.ts` fullscreen |
| 7 | Minimising or closing the ridden window: the dog falls and lands on the next window or the floor | todo | auto (e2e, window closed) | todo | todo | e2e `the dog falls when its window closes` |
| 8 | A window drawn over the dog's window hides the part of the dog it covers | todo | todo | todo | todo | `dogHost.test.ts` clip |
| 9 | Clicks and typing pass through everywhere except the visible dog | todo | auto (spike, synthetic input) | todo | todo | spike S1 (`WindowFromPoint` + click), `hit.test.ts` |
| 10 | Hovering the dog captures the mouse; moving away (or the dog walking away from a still cursor) releases it | todo | auto (spike) | todo | todo | spike S1, `hit.test.ts` |
| 11 | Killing the tracker drops to edge-roaming; the app keeps running | n/a | auto (e2e) | n/a | n/a | e2e `killing the tracker…` |
| 12 | Unplug or plug a monitor while running: overlays rebuild, the dog is still visible | n/a | n/a | n/a | todo | `dogHost.test.ts` display removed |
| 13 | Change the scale while running: overlays resize, the dog does not teleport off-screen | todo | todo | todo | todo | none |
| 14 | Sleep and wake (or lock and unlock): the dog is still there and still moves | todo | todo | todo | todo | none |
| 15 | Ctrl+Alt+Q quits the app and removes the overlay (stopgap until the tray in M3) | todo | auto (SendKeys check, M2) | todo | todo | none |
| 16 | With "Reduce motion" on in Windows (Settings → Accessibility → Visual effects → Animation effects off), the dog walks slower and does not bob | todo | todo | todo | todo | `dogHost.test.ts`, `draw.test.ts` |

## Notes

- **What is not testable on one monitor:** column D. Until someone with two monitors runs it, per-display overlays are a design decision (see `docs/spike-results.md`), not a verified result.
- **The e2e suite** (`npm run e2e`) moves its own test window only, never another app's.
- **Do not** test by dragging other apps' windows into odd places on a machine with unsaved work: the dog only reads window positions, but a bug that crashes the overlay should not cost anyone a document.
