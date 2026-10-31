# Manual test matrix

Run before every release (and after any change to `src/main/tracker`, `src/main/overlay.ts`, `src/main/dogHost.ts`, `src/main/escapeKey.ts`, `src/shared/geometry.ts`, `src/shared/behaviour.ts` or `src/shared/physics.ts`).

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
| 17 | An ignored card climbs curious, pleading, zoomies and dig-in in order; at cap 3 there is no dig-in | todo | auto (e2e, seed 14, fast tuning) | todo | todo | e2e `escalation.spec.ts` (ladder order, cap 3), `rules.test.ts` (the rule layer: 3 to 4 offers dig-in, never raises above a cap of 2, a lowered cap clears forbidden effects) |
| 18 | Laps: he runs round the window's frame, on the frame and on screen, at the display's scale | todo | auto (e2e sees laps; unit tests) **+ todo (a person looks at the `capture-overlay.cjs` laps images at 125 %)** | todo | todo | `behaviour.test.ts` (loop within 1 px), `dogHost.test.ts` laps, e2e `escalation.spec.ts` |
| 19 | Laps round a **maximised** (or edge-hugging) window stay on screen: no sprite cut off at the top, left or right | todo | auto (`dogHost.test.ts` work-area regression) **+ todo (a person looks at the `capture-overlay.cjs <dir> laps-maximised` images at 125 %)** | todo | todo | `dogHost.test.ts` "laps round a maximised window keep him on screen" |
| 20 | Dig-in: dirt and paw prints on the overlay, the card pops up; if the window vanishes or is suppressed it ends | todo | auto (e2e sees dig-in; unit tests) **+ todo (a person looks at the `capture-overlay.cjs <dir> dig` images)** | todo | todo | `dogHost.test.ts` (dig-in stop, target vanishing), e2e `escalation.spec.ts` |
| 21 | Laps across two monitors: dragging the window over to the other monitor mid-laps, he follows onto that overlay and the loop stays on that window's frame | n/a | n/a | n/a | todo | `dogHost.test.ts` "Review Focus #3: laps that cross onto another display hand the frame over" (fake displays, unit test only; no real two-monitor run) |
| 22 | Esc during an effect, with another app in front (Notepad, a browser): Esc ends the effect and that app does not get the Esc; once it is over, Esc works in that app again | todo | auto (`scripts/os-check.cjs` Esc section, against its own test window only) | todo | todo | `escapeKey.test.ts` incl. property test (Esc never held without an effect, never longer than max + 500 ms), e2e `Esc during laps…` |
| 23 | Leave it (Ctrl+Alt+L) stops any effect at once | todo | auto (e2e `Leave it stops everything`; `os-check.cjs` presses Ctrl+Alt+L for real and checks it pauses) | todo | todo | e2e `escalation.spec.ts`, `leaveIt.test.ts` |
| 24 | Sound default: a person hears the bark, whine, happy yip and dig scratch at the default volume: audible, not startling, short, never looping | todo | **todo (a human must listen)**; the sounds are synthesized placeholders, so the check is structural only | todo | todo | `soundGate.test.ts` (off, quiet, volume 0, min gap), `sounds.test.ts` (every recipe under 1.5 s) |
| 25 | Tray **Sounds** toggle and **Volume** submenu change what he plays; nothing plays while paused, on a Stay, away or in a suppressed app | todo | todo | todo | todo | `tray.test.ts`, `soundGate.test.ts`, e2e `Sounds and Volume in the tray are saved…` |

## Notes

- **What is not testable on one monitor:** column D. Until someone with two monitors runs it, per-display overlays are a design decision (see `docs/spike-results.md`), not a verified result.
- **The e2e suite** (`npm run e2e`) moves its own test window only, never another app's. `tests/e2e/escalation.spec.ts` holds six M4 acceptance specs: the ladder in order, no dig-in at cap 3, Esc during laps, Leave it, a slow answer (answer mood, sulk, guilt line) and a quick answer (no sulk).
- **e2e environment variables** (all honoured only when `BARKSTUDY_E2E=1` on an unpackaged app): `BARKSTUDY_FAST_TUNING=1` shrinks the check-in, escalation and guilt timings 100x (effect durations stay real); `BARKSTUDY_SEED=<integer>` pins the engine's random number generator, because the engine picks intents at random and only some seeds climb the whole ladder. Seed 14 does, and the escalation e2e, `scripts/os-check.cjs` and `scripts/capture-overlay.cjs` all use it. A non-numeric value falls back to a time-based seed.
- **`scripts/os-check.cjs`** (after `npm run build`) has an Esc section: with a plain test window focused, Esc with no effect reaches it; during forced laps Esc ends the effect and the window does not see it; afterwards Esc reaches the window again. It drives the real keyboard, so leave the machine alone while it runs.
- **`scripts/capture-overlay.cjs <outDir> [laps|dig|laps-maximised]`** (after `npm run build`) saves overlay captures at three moments of each effect, alone and composited over a grey desktop with the work area outlined, and prints the display's scale. It does not touch the mouse or keyboard. It only produces images: a person has to look at them, so rows 18 to 20 are not fully closed by it. Run it on each setup you care about (the dev machine is B, 125 %).
- **Sound is not heard by any test.** The sounds are synthesized placeholders; tests check only the gate (off, quiet, volume 0, minimum gap) and that every recipe is under 1.5 s. Row 24 needs a human with speakers.
- **Do not** test by dragging other apps' windows into odd places on a machine with unsaved work: the dog only reads window positions, but a bug that crashes the overlay should not cost anyone a document.
