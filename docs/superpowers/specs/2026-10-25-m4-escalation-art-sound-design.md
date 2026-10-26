# M4 design: escalation, art and sound

Status: approved in conversation on 2026-10-25, pending review of this document.
Source: PLAN.md Milestone 4 (T4.1 to T4.6) and SPEC.md §4 (escalation ladder).

## 1. Goal

A real session visibly and audibly plays the whole escalation ladder (idle → curious → pleading → zoomies → dig-in → answer → sulk). It respects the intensity cap, and Esc or Leave it stops it at any point. Esc is never held when no effect runs.

Pandesal is **he** in all text: UI, speech lines, docs.

## 2. Decisions

From CJ:

- **Art is procedural** (canvas drawing in code) and **sound is synthesized** (Web Audio). Both are **temporary** and will be redone later. M4 builds clean swap points, not polish.
- **Sound is on by default at a low volume** (0.4), with mute one click away.
- **Architecture A:** main choreographs every movement, and the overlay only draws.

Made in the design, open to change:

1. A target window that disappears, minimises or loses its display to a fullscreen app ends the effect by sending `ESC_PRESSED` (the effect ends and the level is kept). The engine and its invariants are not changed.
2. When dig-in ends with the card still pending, the bubble reopens: "he pops up with the card".
3. With reduced motion on, laps become a stationary zoomies expression and dig-in has no flying particles. Sound and speech are unchanged.
4. Until Settings exists (M5), the sound controls live in the tray: a Sounds checkbox and a Volume submenu (Low 0.4, Medium 0.65, High 0.9).
5. Speech is not announced to screen readers, because it would flood Narrator. The flashcard bubble is announced, as it is today.
6. T4.6 (guilt memory) is mostly done already: the session passes `lastGuiltMs` from history into the engine. M4 only makes the line visible, through speech.
7. **The sulk after a guilt trip is played by the presentation, not the engine.** The engine defines a `sulk` intent, but no rule offers it, so on its own the ladder's "answer → sulk" beat never happens. When an answer arrives together with `RECORD_GUILT_TRIP`, dogHost shows the answer's mood (happy, ecstatic or calm) for about 1.5 s, then `sulk` for about 4 s, and the guilt line is shown. The engine is unchanged. The alternative is to make the engine offer `sulk` weighted by the drama trait; that touches the explorer and the property tests, and is left for when the engine is next revisited.

Out of scope: real art and audio files, an `assets/` pipeline and licence file (none until real assets exist), the Settings UI (M5), the installer `.ico` (M6), and any change to engine rules.

## 3. Architecture

Main stays the single source of truth for where Pandesal is. The engine's actions flow outward through the session controller:

```
engine actions ──► session controller sink
   SET_EXPRESSION ──► dogHost.setMood ──┬─► frames ──► overlay (DogRenderer, effects)
                                        └─► soundGate ──► overlays: sound:play ──► SoundBank
   WALK_TO / RUN_LAPS / START_DIG_IN /
   END_EFFECT / CURL_UP ──────────────► dogHost.perform ──► frames
   effect start / end ────────────────► escapeKey (global Escape only while an effect runs)
   RECORD_GUILT_TRIP ─► dogHost.setMood(answer mood, then sulk)
   SAY ──► speechGate ──► overlays: speech:say ──► balloon (or bubble eyebrow)
session view: stay on/off ──► dogHost.setStay
dogHost.onEffectLost ──► session.dispatch(ESC_PRESSED)
escapeKey press ──► session.dispatch(ESC_PRESSED)
dig-in ends, card pending ──► session.openBubble()
```

Only the overlay that currently shows the dog (non-null frame) draws effects, shows speech and plays sounds.

## 4. Units

### 4.1 Frame contract (`src/shared/ipc.ts`)

`DogFrame` gains:

- `mood: Mood`. This is the engine's expression names (`wander`, `nap`, `curious`, `pleading`, `follow-cursor`, `whine`, `zoomies`, `dig`, `happy`, `ecstatic`, `calm`, `sulk`, `greet`, `sit`) plus `idle`. An unknown name maps to `idle`.
- `pose`: widened to `walk | sit | fall | run | hop | dig | curl`.
- `side?: 'top' | 'right' | 'bottom' | 'left'`, present only on laps, so the renderer can rotate him.
- `effect?: { kind: 'laps' | 'dig'; seed: number; elapsedMs: number; rect: Rect }`. `rect` is the target window, in the frame's display coordinates.

Identical frames are still skipped, so an idle dog costs nothing.

### 4.2 Behaviour geometry (`src/shared/behaviour.ts`, pure)

- `lapPoint(rect, distancePx)` → `{ x, y, side, facing }`. Clockwise from the top-left corner with his feet on the outside edge, wrapping around the perimeter.
- `digSpot(rect)` → the centre of the top edge.
- `hopPoint(from, to, t)` → a parabolic arc for t in 0..1, exact at both ends.
- `followDirection(dogX, cursorX, platform)` → `-1 | 0 | 1`, with a dead zone, and never off the platform's ends.

### 4.3 dogHost behaviours (`src/main/dogHost.ts`)

A behaviour state sits above the existing physics:

| Behaviour | Started by | Ends |
|---|---|---|
| `roam` | default | when another starts |
| `follow` | mood `pleading` or `follow-cursor` | when the mood changes |
| `hop` | `WALK_TO` | on landing, then `roam` |
| `laps` | `RUN_LAPS` | on `END_EFFECT`, or at `lapsMaxMs + 500`; afterwards he falls onto the nearest platform |
| `dig` | `START_DIG_IN` | on `END_EFFECT`, or at `digInMaxMs + 500`; he stays on that title bar |
| `curl` | `CURL_UP` | when another starts |
| `sit-stay` | `setStay(true)` | at `setStay(false)` |

New inputs:

- `perform(action)`
- `setMood(name)`. Short moods fall back to `idle` on their own: happy, ecstatic and greet after about 2 s, sulk after about 4 s.
- `sulkAfter(mood)`, for an answer that came with a guilt trip: plays `mood` for about 1.5 s, then `sulk` for about 4 s (Decision 7).
- `setStay(on)`
- an injected `cursor(): Point | null`. It reads the cursor position only while following, through Electron's `screen`: no hooks and never keystrokes.
- `onEffectLost` callback.

Safety rules, checked on every tick:

- An effect starts only if its window exists and has a visible top edge. If it is gone, minimised, or its display is hidden by a fullscreen app, the effect stops at once and `onEffectLost` fires exactly once.
- Every effect stops at its max plus 500 ms without waiting for the engine.
- During laps he is occluded by windows above the target (`occludersFor(target)`), so he is clickable only where visible.
- The display is chosen from his actual position, so laps hand over between monitors.
- Reduced motion: no laps movement and no flying particles.

### 4.4 Dynamic Esc (`src/main/escapeKey.ts`)

- `effectStarted(maxMs)` registers the global `Escape` if it isn't already, and arms a hard timer at `maxMs + 500`.
- `effectEnded()` releases Esc and clears the timer. It is called on `END_EFFECT`, when a session ends, and on dispose.
- A press dispatches `ESC_PRESSED` and releases Esc at once.
- A failed registration is logged. The effect still ends on its own timer, and Leave it and the tray still work.

If the user is typing in the bubble during an effect, the first Esc ends the effect and the second dismisses the bubble.

### 4.5 Rendering (`src/renderer/overlay/`)

- **`DogRenderer`** interface: `draw(ctx, frame, tMs)`. Its implementation, `proceduralRenderer`, replaces today's `draw.ts`. Moods are told apart by shape, never only by colour:
  - curious: head tilt;
  - pleading: big eyes and droopy ears;
  - zoomies: grin and ears back;
  - dig: head down;
  - happy and ecstatic: spin and a fast-wagging tail;
  - sulk: back turned and ears down;
  - curl and nap: eyes closed;
  - sit-stay: upright.

  On laps he is rotated to `side`.
- **`effects.ts`** (pure, seeded):
  - `dirtParticles(seed, elapsedMs, origin)` computes positions directly from seed and time, with gravity.
  - `pawPrints(seed, rect, elapsedMs)` lays prints behind him along the frame.
  - Prints fade about 1.5 s after the effect ends; the fade is held in the overlay only.
- **Draw cost:** draw on frame arrival. A `requestAnimationFrame` loop runs only while something animates (an effect, a spin, a wag, or a fading balloon or prints).
- **Icons:** `makeIcon(size)` (generalised from `makeTrayBitmap`) is also the window icon for the control window and the overlays.

### 4.6 Speech

- `src/shared/i18n/en.ts` holds text for every key in `ALL_LINE_KEYS` (51 keys). Guilt lines interpolate `{minutes}`.
- A pure `speechGate` in main always lets through guilt, greeting and answer-reaction lines. Every other line passes at most once every 30 s.
- Main sends `{ key, params, id }` to the overlays. The overlay with the dog shows it for about 4 s: in a small balloon above him, or in the flashcard bubble's eyebrow (in place of "Pandesal asks") while the bubble is open.

### 4.7 Sound

- **`SoundBank`** interface: `play(name, volume)`, with names `bark`, `whine`, `yip` and `scratch`. The placeholder implementation synthesises each sound from a recipe (oscillators and noise with envelopes) through one lazily created `AudioContext`. Every play is a one-shot node with a hard `stop()`. Overlays get `autoplayPolicy: 'no-user-gesture-required'`.
- **Recipes** are data; every recipe's total length is under 1.5 s and none loops.
- **A pure `soundGate` in main maps events to sounds:**
  - zoomies starting: bark;
  - dig starting: scratch;
  - whine: whine;
  - happy or ecstatic: yip.

  It plays nothing while suppressed, paused, on a Stay, away, or with sound off, and leaves at least 3 s between sounds.
- **Settings:** `soundOn: boolean` (default `true`) and `volume: number` (0..1, default `0.4`). Settings is still at schema v1, which may change freely before the first beta, so no migration is needed. `Library.updateSettings(patch)` validates before writing.
- **Tray:** a "Sounds" checkbox and a Volume radio submenu. `MenuItemSpec` gains `checked` and `kind: 'checkbox' | 'radio'`.

## 5. Failure handling

| Failure | Behaviour |
|---|---|
| Target window disappears, minimises or goes behind a fullscreen app | the effect ends at once; `ESC_PRESSED` keeps the level |
| `END_EFFECT` never arrives | dogHost and escapeKey both stop at max + 500 ms |
| `Escape` cannot be registered | logged; the timers still end the effect |
| The audio context cannot start | silent, logged once, never throws |
| Missing speech text | nothing is shown (a test keeps every key filled) |
| Overlay renderer crashes | it reloads and the last frame is replayed (existing) |

## 6. Testing and verification

- **Unit tests:**
  - behaviour geometry: a lap stays on the perimeter within 1 px, is continuous and covers the whole loop; the hop endpoints are exact; follow never leaves its platform;
  - particles and prints are deterministic;
  - `speechGate`, `soundGate` and recipe lengths;
  - `en.ts` is complete, has `{minutes}` in the guilt lines, and no she/her;
  - settings validation and the tray model.
- **With fake clocks:**
  - `dogHost`: every behaviour starts and ends; `onEffectLost` fires exactly once; the hard stop works with no `END_EFFECT`; reduced motion means no movement.
  - `escapeKey`: unit tests, plus a property test that Esc is never held without an effect and never for longer than max + 500 ms in one stretch.
- **e2e acceptance** (`BARKSTUDY_FAST_TUNING`, honoured only in e2e on an unpackaged build, shrinks the check-in, escalation and guilt-threshold timings about 100×; effect durations stay real, so laps and dig-in can be observed. `BARKSTUDY_SEED=<integer>`, honoured under the same gate, pins the engine's random number generator, because the engine picks intents at random and only some seeds climb the whole ladder; seed 14 does, and the escalation e2e and `scripts/os-check.cjs` use it. A non-numeric value falls back to a time-based seed):
  - an ignored card produces curious, pleading, zoomies and dig-in in order, read from the frames' `mood` and `effect`;
  - at cap 3 there is no dig-in;
  - a forced Esc press during laps ends the effect and releases Esc;
  - Leave it stops everything;
  - a quick correct answer gives happy or ecstatic and no sulk; an answer after a wait over the guilt threshold gives the answer mood, then sulk, and a visible guilt line.
- **OS level** (`scripts/os-check.cjs`): with a plain test window focused, Esc with no effect reaches that window; during a forced effect, Esc ends the effect and the window does not see it; afterwards Esc reaches the window again.
- **A real look:** capture the overlay during laps and during dig at 125% scale, and review the images before calling M4 done.

## 7. Slices for the implementation plan

1. Frame contract and moods, plus fixing the two "she" strings in the control window.
2. Pure behaviour geometry.
3. dogHost behaviours and safety rules.
4. Dynamic Esc.
5. `DogRenderer` (procedural), effects drawing and icons.
6. Speech: `en.ts`, `speechGate`, balloon and eyebrow.
7. Sound: `SoundBank`, recipes, `soundGate`, settings and tray controls.
8. Wiring, the e2e acceptance test, the OS-level Esc check and the visual check.
9. Docs: mark M4 done in PLAN.md and add rows to `docs/test-matrix.md`.
