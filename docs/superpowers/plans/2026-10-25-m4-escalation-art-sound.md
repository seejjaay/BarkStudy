# M4: Escalation, Art and Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real session visibly and audibly plays the whole escalation ladder, respects the cap, and Esc or Leave it stops it at any point, with placeholder art and sound behind swappable interfaces.

**Architecture:** Main stays the single source of truth for where Pandesal is. A pure behaviour layer (`src/shared/behaviour.ts`) and new behaviour modes in `dogHost` move him, the frame carries mood and effect state, and the overlay only draws (`DogRenderer`, `effects.ts`), talks (speech balloon) and plays sound (`SoundBank`). The session controller is the one place engine actions fan out to the dog, the Esc key, speech and sound.

**Tech Stack:** TypeScript, Electron 45 (`globalShortcut`, `screen`, `Tray`), canvas 2D, Web Audio, Vitest 5 (+ fast-check 4), Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-25-m4-escalation-art-sound-design.md` (read it first; this plan cites its sections as §n).

## Global Constraints

- Pandesal is **he**. No she/her in any string, line, comment or doc.
- Art is procedural and sound synthesized; both are placeholders. Drawing goes only through `DogRenderer`, audio only through `SoundBank`.
- `src/engine/` is not changed by any task.
- Sounds: each under 1.5 s, never loop. Defaults `soundOn: true`, `volume: 0.4`. Tray volumes: Low 0.4, Medium 0.65, High 0.9. At least 3 s between sounds. No sound while suppressed, paused, on a Stay, away, or with sound off.
- Effects stop at their max plus 500 ms without waiting for the engine (`DEFAULT_TUNING.lapsMaxMs` = 6000, `digInMaxMs` = 8000).
- The global `Escape` is registered only while an effect runs and released on `END_EFFECT`, session end, press, dispose, or max + 500 ms.
- Speech: guilt, greeting and answer-reaction lines always pass; every other line at most once per 30 s; shown about 4 s; not announced to screen readers.
- The cursor is read through Electron `screen.getCursorScreenPoint()` only while following. No new Win32 calls, no hooks, never keystrokes (`tests/main/forbidden-win32.test.ts` must stay green).
- `BARKSTUDY_FAST_TUNING` is honoured only when `BARKSTUDY_E2E=1` on an unpackaged app, and shrinks `checkinMinMs`, `checkinMaxMs`, `firstEscalationMs`, `escalationStepMs` and `guiltThresholdMs` by 100×; effect durations are unchanged.
- Renderer and preload code import no `node:*` and (renderer) no `electron`; `src/shared` imports neither.
- Every task ends green on `npm run typecheck && npm run lint && npm test`; tasks touching Electron wiring also run `npm run e2e`.

## Review Focus

1. **A `settings.json` written before M4** (no `soundOn` or `volume`) must load with the defaults, not be treated as corrupt and replaced. Test in Task 7.
2. **The user drags the target window during laps or dig-in.** He follows the live rect every tick, not the rect from when the effect began. Test in Task 3.
3. **The target window is on another display, or spans two.** His frame goes to the display that holds his actual position, and the old display is sent `null`. Test in Task 3.
4. **Esc pressed while typing in the open bubble during an effect.** The effect ends, the bubble stays open with its draft, and the second Esc dismisses it. Test in Task 8.
5. **The session ends, or Leave it pauses it, in the middle of an effect.** Esc is released at once, he goes back to roaming or sitting, and no further sound or speech plays. Test in Task 8.

---

### Task 1: Frame contract, moods, pronoun fix

**Files:**
- Create: `src/shared/mood.ts`
- Modify: `src/shared/ipc.ts` (`DogFrame`), `src/main/dogHost.ts` (`frameFor` emits `mood`), `src/renderer/control/app.tsx` (tracker banner), `src/renderer/control/study.tsx` ("check in on her own")
- Test: `tests/shared/mood.test.ts`, `tests/main/dogHost.test.ts` (add one case)

**Interfaces:**
- Produces: `type Mood = 'idle' | 'wander' | 'nap' | 'curious' | 'pleading' | 'follow-cursor' | 'whine' | 'zoomies' | 'dig' | 'happy' | 'ecstatic' | 'calm' | 'sulk' | 'greet' | 'sit'`; `moodFromExpression(name: string): Mood`; `MOOD_HOLD_MS: Partial<Record<Mood, number>>` = `{ happy: 2000, ecstatic: 2000, greet: 2000, sulk: 4000 }`; `type DogPose = 'walk' | 'sit' | 'fall' | 'run' | 'hop' | 'dig' | 'curl'`; `type LapSide = 'top' | 'right' | 'bottom' | 'left'`; `interface EffectState { kind: 'laps' | 'dig'; seed: number; elapsedMs: number; rect: Rect }`; `DogFrame` gains `mood: Mood`, `pose: DogPose`, `side?: LapSide`, `effect?: EffectState`.

- [ ] **Step 1: Write the failing tests.** `tests/shared/mood.test.ts`: every expression name the engine emits (`wander nap curious pleading follow-cursor whine zoomies dig happy ecstatic calm sulk greet sit`) maps to itself; `'unknown'` and `''` map to `'idle'`; `MOOD_HOLD_MS.sulk === 4000`, `MOOD_HOLD_MS.happy === 2000`. In `dogHost.test.ts`: `a fresh dog's frame has mood idle`.
- [ ] **Step 2: Run** `npx vitest run tests/shared/mood.test.ts tests/main/dogHost.test.ts`. Expected: FAIL (module missing, `mood` undefined).
- [ ] **Step 3: Implement** `src/shared/mood.ts`, widen `DogFrame` in `src/shared/ipc.ts`, and make `frameFor` emit `mood: 'idle'`. `draw.ts` keeps drawing unknown poses as `walk` until Task 5.
- [ ] **Step 4: Fix the two strings.** `app.tsx`: "…so he roams the edges of your screen instead." `study.tsx`: "Pandesal will check in on his own." Then `grep -rniE "\b(she|her|hers)\b" src` returns nothing.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(shared): dog moods and the wider frame contract; Pandesal is he`.

### Task 2: Behaviour geometry

**Files:**
- Create: `src/shared/behaviour.ts`
- Test: `tests/shared/behaviour.test.ts`

**Interfaces:**
- Consumes: `Rect`, `Platform` (`src/shared/geometry.ts`), `LapSide` (Task 1).
- Produces:
  - `interface Point { x: number; y: number }` (new; nothing in `src/` defines one yet).
  - `LAP_SPEED = 0.45` px/ms, `HOP_MS = 600`, `HOP_HEIGHT = 60` px, `FOLLOW_DEADZONE = 24` px.
  - `lapPerimeter(rect: Rect): number` = `2 * (width + height)`.
  - `lapPoint(rect: Rect, distance: number): { x: number; y: number; side: LapSide; facing: 1 | -1 }`: clockwise from the top-left corner, wrapping with `distance mod perimeter`; feet on the outside edge (top: `y = rect.y`; right: `x = rect.x + width`; bottom: `y = rect.y + height`; left: `x = rect.x`).
  - `digSpot(rect: Rect): { x: number; y: number }`: the centre of the top edge.
  - `hopPoint(from: Point, to: Point, t: number): Point`: linear in x, parabola peaking `HOP_HEIGHT` above the higher end; t clamped to 0..1.
  - `followDirection(dogX: number, cursorX: number, platform: Pick<Platform, 'x1' | 'x2'>): -1 | 0 | 1`: 0 inside the dead zone, and 0 when the next step would leave `x1..x2`.

- [ ] **Step 1: Write the failing tests:**
  - `lap points stay on the perimeter`: for 200 distances across 0 to 2 laps, each point is within 1 px of an edge of a `{ x: 100, y: 50, width: 400, height: 300 }` rect.
  - `a lap is continuous`: consecutive points 1 px of distance apart are at most 1.01 px apart, corners included.
  - `one perimeter is exactly one lap`: `lapPoint(r, 0)` equals `lapPoint(r, lapPerimeter(r))`; sides in order top, right, bottom, left.
  - `facing follows travel`: 1 on top, -1 on bottom.
  - `digSpot is the top centre`.
  - `hop starts and ends exactly`: t = 0 is `from`, t = 1 is `to`, t = 0.5 is above both.
  - `follow stays put in the dead zone and never walks off its platform`.
- [ ] **Step 2: Run** `npx vitest run tests/shared/behaviour.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/shared/behaviour.ts` with the signatures above.
- [ ] **Step 4: Run** the test file, then `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): pure geometry for laps, dig, hop and follow`.

### Task 3: dogHost behaviours and safety rules

**Files:**
- Modify: `src/main/dogHost.ts`
- Test: `tests/main/dogHost.test.ts` (extend; reuse its fake clock and recording sink)

**Interfaces:**
- Consumes: Task 1 types, Task 2 functions, `occludersFor` and `clipSprite` (`src/shared/geometry.ts`).
- Produces:
  - `type DogAction = Extract<Action, { type: 'WALK_TO' | 'RUN_LAPS' | 'START_DIG_IN' | 'END_EFFECT' | 'CURL_UP' }>` (exported from `dogHost.ts`).
  - `createDogHost` options gain `cursor?: () => Point | null`, `onEffectLost?: () => void`, and `effectMaxMs?: { laps: number; dig: number }` (default from `DEFAULT_TUNING`).
  - `DogHost` gains `perform(action: DogAction): void`, `setMood(name: string): void`, `sulkAfter(): void`, `setStay(on: boolean): void`, and `readonly behaviour: 'roam' | 'follow' | 'hop' | 'laps' | 'dig' | 'curl' | 'sit-stay'`.

- [ ] **Step 1: Write the failing tests** (fake clock, a world with a target window `{ id: 7, … }`):
  - `RUN_LAPS moves him around the window frame`: after 500 ms the frame has `pose: 'run'`, a `side`, `effect.kind: 'laps'`, and his position is on the window's perimeter within 1 px.
  - `END_EFFECT ends laps and he falls back onto a platform`: `behaviour` becomes `roam` and within 2 s his body is anchored.
  - `laps stop by themselves at lapsMaxMs + 500 with no END_EFFECT`.
  - `START_DIG_IN puts him on the title bar centre digging, and he stays there after it ends`.
  - `the target vanishing stops the effect and calls onEffectLost exactly once`: also for the window disappearing from the world, and for its display becoming hidden by a fullscreen window.
  - `an effect on a window that does not exist never starts and reports lost`.
  - Review Focus #2, `dragging the target during laps moves the path with it`: shift the window by `+200` x mid-lap and the next frame is on the new perimeter.
  - Review Focus #3, `laps that cross onto another display hand the frame over`: with two displays and a window spanning them, the sink receives a frame on display B and `null` on display A.
  - `WALK_TO hops to that window's top edge and lands anchored on it`.
  - `follow walks toward the cursor along his platform and stops in the dead zone`: driven by `setMood('pleading')` and a fake `cursor()`. Also `cursor() is never called when not following`.
  - `CURL_UP gives pose curl and he does not move`; `setStay(true) sits him until setStay(false)`.
  - `setMood('happy') falls back to idle after 2 s`; `sulkAfter() keeps the current mood ~1.5 s, then sulk for 4 s, then idle`.
  - `reduced motion: laps do not move him and the mood is zoomies`.
  - `a second RUN_LAPS while lapping restarts the timer without stacking effects`.
- [ ] **Step 2: Run** `npx vitest run tests/main/dogHost.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the behaviour state in `dogHost.ts`:
  - **Ticking:** `advance()` branches on the behaviour. `laps` and `dig` read the target's live rect from `windows` on every tick. `schedule()` ticks at `TICK_MS` while the behaviour is anything but `roam` or `sit-stay` and the dog is moving or a mood timer is pending.
  - **Hidden behind windows:** during laps, `occludersFor(targetId, windows)` hides him behind windows above the target.
  - **Display choice:** made by his position (the display whose bounds contain his feet, else the nearest one).
  - **Frame fields:** `mood`, `pose`, `side` and `effect` (`elapsedMs` from the start, `rect` in display coordinates).
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS, with the existing M2 dogHost cases unchanged.
- [ ] **Step 5: Commit** `feat(main): dog behaviours for follow, hop, laps, dig, curl and stay, with hard stops`.

### Task 4: Dynamic Esc

**Files:**
- Create: `src/main/escapeKey.ts`
- Test: `tests/main/escapeKey.test.ts`

**Interfaces:**
- Consumes: the hotkeys shape already used by `bubbleHost.ts`/`leaveIt.ts` (`register(accelerator, onPress): boolean`, `unregister(accelerator): void`), and the `Clock` type from `dogHost.ts`.
- Produces: `createEscapeKey(deps: { hotkeys; clock?: Clock; onPress: () => void }): EscapeKey`, where `interface EscapeKey { effectStarted(maxMs: number): void; effectEnded(): void; readonly held: boolean; dispose(): void }`. `ESCAPE_GRACE_MS = 500`.

- [ ] **Step 1: Write the failing tests:**
  - `not held until an effect starts`;
  - `held from effectStarted until effectEnded`;
  - `released by the hard timer at maxMs + 500 with no end`;
  - `a press calls onPress once and releases at once`;
  - `two starts register once and the timer is re-armed from the second`;
  - `a failed registration is not held and does not throw`;
  - `dispose releases`.

  Plus a fast-check property: random sequences of `start(maxMs ∈ 1..10000)`, `end`, `press` and `advance(ms ∈ 0..20000)` never leave `held` true with no effect active, and no continuous held stretch exceeds the latest `maxMs + 500`.
- [ ] **Step 2: Run** `npx vitest run tests/main/escapeKey.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/main/escapeKey.ts`. The accelerator is `'Escape'`. A failed register is logged once with `console.error`.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(main): Esc held only while an effect runs`.

### Task 5: DogRenderer, effects drawing, icons

**Files:**
- Create: `src/renderer/overlay/renderer.ts` (the interface), `src/renderer/overlay/procedural.ts` (replaces `draw.ts`), `src/renderer/overlay/effects.ts`, `src/main/icon.ts` (replaces `trayIcon.ts`)
- Delete: `src/renderer/overlay/draw.ts`, `src/main/trayIcon.ts`
- Modify: `src/renderer/overlay/main.ts` (use the renderer and the animation loop), `src/main/tray.ts`, `src/main/controlWindow.ts`, `src/main/overlay.ts` (window `icon`)
- Test: `tests/renderer/effects.test.ts`, `tests/renderer/animation.test.ts`; `tests/main/tray.test.ts` (rename the icon import)

**Interfaces:**
- Consumes: `DogFrame` (Task 1).
- Produces:
  - `interface DogRenderer { draw(ctx: CanvasRenderingContext2D, frame: DogFrame, tMs: number): void }`; `proceduralRenderer: DogRenderer`.
  - `dirtParticles(seed: number, elapsedMs: number, origin: Point, reducedMotion: boolean): { x: number; y: number; size: number; alpha: number }[]`.
  - `pawPrints(seed: number, rect: Rect, elapsedMs: number, fadeMs: number): { x: number; y: number; angle: number; alpha: number }[]`; `PRINT_FADE_MS = 1500`.
  - `needsAnimation(frame: DogFrame | null, fading: boolean, reducedMotion: boolean): boolean`.
  - `makeIcon(size: number): Buffer` (BGRA, same art as before).

- [ ] **Step 1: Write the failing tests:**
  - `dirt is deterministic`: the same seed and time give equal arrays, and a different seed gives a different one.
  - `dirt falls`: a particle's y grows with time.
  - `reduced motion: dirt does not move`: the arrays are equal across times.
  - `prints lie on the frame`: each is within 4 px of the rect's perimeter.
  - `prints fade`: alpha is 1 while the effect runs, and 0 at `fadeMs` after it.
  - `needsAnimation`: true for an effect, `pose: 'run' | 'hop'`, and moods `happy`/`ecstatic`; false for an idle sitting frame and for `null`; false for everything under reduced motion except a fade in progress.
- [ ] **Step 2: Run** `npx vitest run tests/renderer`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - **`procedural.ts`** carries over today's drawing and adds the moods by shape (spec §4.5 list), the new poses, and rotation by `side`.
  - **Overlay `main.ts`:** draws on frame arrival and runs a `requestAnimationFrame` loop only while `needsAnimation(...)` is true. It also draws prints and dirt from `frame.effect`, keeps the last effect for `PRINT_FADE_MS` after it disappears, and draws only within `frame.clip` for the dog (effects are not clipped).
  - **Icons:** move `makeTrayBitmap` to `makeIcon`, and set it as the `icon` of the control window and overlays via `nativeImage.createFromBitmap(makeIcon(256), { width: 256, height: 256 })`.
- [ ] **Step 4: Run** `npm run build && npm run typecheck && npm run lint && npm test && npm run e2e`. Expected: PASS (the overlay e2e still sees the dog).
- [ ] **Step 5: Commit** `feat(overlay): procedural DogRenderer with moods, dirt and paw prints`.

### Task 6: Speech

**Files:**
- Create: `src/shared/i18n/en.ts`, `src/main/speechGate.ts`
- Modify: `src/shared/ipc.ts` (channel `speechSay: 'speech:say'`, `BarkOverlayApi.onSpeech`), `src/preload/overlay.ts`, `src/renderer/overlay/index.html` (balloon element), `src/renderer/overlay/bubble.ts` (eyebrow text), and a new `src/renderer/overlay/speech.ts`
- Test: `tests/shared/i18n.test.ts`, `tests/main/speechGate.test.ts`

**Interfaces:**
- Consumes: `ALL_LINE_KEYS`, `GUILT_LINES`, `LAST_GUILT_LINES`, `INTENT_LINES` (`src/engine/lines.ts`).
- Produces:
  - `EN: Record<string, string>`; `say(key: string, params?: Record<string, number>): string | null` (null for an unknown key; `{minutes}` replaced).
  - `interface SpeechLine { key: string; params?: Record<string, number>; id: number }`.
  - `createSpeechGate(clock?: { now(): number }): { pass(key: string): boolean }`; `SPEECH_MIN_GAP_MS = 30_000`, `SPEECH_SHOW_MS = 4000`.
  - Priority keys are those in `GUILT_LINES`, `LAST_GUILT_LINES` and the `greetReturn`, `celebrateSmall`, `celebrateBig` and `calm` groups.

- [ ] **Step 1: Write the failing tests:**
  - `every engine line key has text`: for each key of `ALL_LINE_KEYS`, `EN[key]` is a non-empty string.
  - `guilt lines take minutes`: every `GUILT_LINES` and `LAST_GUILT_LINES` text contains `{minutes}`, and `say(GUILT_LINES[0], { minutes: 6 })` contains `6` and no `{`.
  - `no line calls Pandesal she`: no text matches `/\b(she|her|hers)\b/i`.
  - `unknown key gives null`.
  - Gate: `priority lines always pass`; `other lines pass at most once per 30 s` (two `pass('line.whine.1')` 10 s apart give true then false; 31 s later true).
- [ ] **Step 2: Run** `npx vitest run tests/shared/i18n.test.ts tests/main/speechGate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the 51 lines in `en.ts`**, in Pandesal's voice: short, dog-like, first person, he/him if a pronoun is needed. Implement `say()` and the gate.
- [ ] **Step 4: Implement the overlay side.** `speech.ts` shows the text for `SPEECH_SHOW_MS` in a balloon placed with `placeBubble` above the dog, only on the overlay whose frame is non-null. The balloon has `aria-hidden="true"`. While the flashcard bubble is open, the text replaces the bubble's "Pandesal asks" eyebrow for the same time instead.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: Pandesal's lines and the speech balloon`.

### Task 7: Sound, settings and tray controls

**Files:**
- Create: `src/renderer/overlay/sound.ts` (`SoundBank` and the synthesized implementation), `src/shared/sounds.ts` (names and recipes), `src/main/soundGate.ts`
- Modify:
  - `src/shared/settings.ts` (`soundOn`, `volume`, defaults) and `src/shared/validate.ts` (both optional on disk);
  - `src/main/library.ts` (fill defaults on read; `updateSettings`);
  - `src/main/trayModel.ts` and `src/main/tray.ts` (Sounds checkbox and Volume radio);
  - `src/shared/ipc.ts` (`soundPlay: 'sound:play'`, `BarkOverlayApi.onSound`) and `src/preload/overlay.ts`;
  - `src/main/overlay.ts` (`webPreferences.autoplayPolicy: 'no-user-gesture-required'`).
- Test: `tests/shared/sounds.test.ts`, `tests/main/soundGate.test.ts`, `tests/main/library.test.ts`, `tests/main/tray.test.ts`

**Interfaces:**
- Produces:
  - `type SoundName = 'bark' | 'whine' | 'yip' | 'scratch'`; `interface SoundRecipe { parts: { kind: 'tone' | 'noise'; startMs: number; durationMs: number; freqHz?: number; freqEndHz?: number; gain: number }[] }`; `RECIPES: Record<SoundName, SoundRecipe>`; `recipeLengthMs(r: SoundRecipe): number`; `MAX_SOUND_MS = 1500`.
  - `interface SoundBank { play(name: SoundName, volume: number): void }`; `createSynthSoundBank(): SoundBank`.
  - `soundFor(event: { kind: 'effect'; effect: 'laps' | 'dig' } | { kind: 'mood'; mood: Mood }): SoundName | null`. Laps → bark, dig → scratch, whine → whine, happy or ecstatic → yip, anything else → null.
  - `createSoundGate(clock?): { pass(name: SoundName, ctx: { soundOn: boolean; volume: number; quiet: boolean }): boolean }`; `SOUND_MIN_GAP_MS = 3000`. `quiet` means suppressed, paused, on a Stay, or away.
  - `Settings` gains `soundOn: boolean` and `volume: number`. `DEFAULT_SETTINGS.soundOn = true` and `volume = 0.4`. `Library.updateSettings(patch: Partial<Settings>): Promise<Result<Settings>>` returns `invalid-request` for a bad patch.
  - `MenuItemSpec` gains `kind?: 'checkbox' | 'radio'` and `checked?: boolean`; `TrayInputs` gains `soundOn: boolean` and `volume: number`; `TrayAction` gains `{ kind: 'sound'; on: boolean }` and `{ kind: 'volume'; level: 0.4 | 0.65 | 0.9 }` with ids `sound:on`, `sound:off`, `volume:0.4`, `volume:0.65`, `volume:0.9`.

- [ ] **Step 1: Write the failing tests:**
  - `every recipe is under 1.5 s and has parts`.
  - `soundFor maps each trigger, and nothing else`.
  - Gate:
    - `sound off plays nothing`;
    - `quiet plays nothing`;
    - `volume 0 plays nothing`;
    - `a second sound within 3 s is dropped, and after 3 s it plays`.
  - Library:
    - Review Focus #1, `a settings.json from before M4 loads with soundOn true and volume 0.4 and is not set aside`: write the v1 fixture shape with no sound fields, open, `notices()` is empty, and `getSettings()` has the defaults.
    - `updateSettings saves and survives reopening`.
    - `updateSettings refuses volume 1.5, -0.1 and a non-boolean soundOn`.
  - Tray:
    - `the menu shows Sounds checked or unchecked`;
    - `the volume radio has the current level checked`;
    - `sound:on`, `sound:off` and the `volume:*` ids parse, and `volume:0.5` does not;
    - `runTrayAction` for sound and volume calls `library.updateSettings` (so `TrayActionDeps.library` widens to `Pick<Library, 'getSettings' | 'updateSettings'>`).
- [ ] **Step 2: Run** `npx vitest run tests/shared/sounds.test.ts tests/main/soundGate.test.ts tests/main/library.test.ts tests/main/tray.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.**
  - **Validation:** `isSettings` accepts missing `soundOn` and `volume`, but rejects present ones of the wrong type or with `volume` outside 0..1.
  - **Library:** fills the defaults when it loads settings.
  - **`createSynthSoundBank`:** creates one `AudioContext` on first `play`, schedules each part as a one-shot node stopped at its end, and never sets `loop`. A failing `AudioContext` is caught and logged once, and after that it stays silent.
  - **`tray.ts`:** maps `kind` and `checked` to Electron `type` and `checked`.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: synthesized placeholder sounds, sound settings and tray controls`.

### Task 8: Wiring the session to the dog, Esc, speech and sound

**Files:**
- Modify:
  - `src/main/engineHost.ts` (`HostSink.guiltTrip`; `StartOptions.tuning?: Partial<Tuning>`);
  - `src/main/session.ts` (presentation fan-out, gates, `effectLost`, `fastTuning`);
  - `src/main/index.ts`;
  - `src/main/debug.ts`.
- Test: `tests/main/engineHost.test.ts`, `tests/main/session.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 6 and 7.
- Produces:
  - `HostSink.guiltTrip(waitedMs: number): void`, called from the `RECORD_GUILT_TRIP` route.
  - `SessionControllerOptions` replaces `dog?: DogHooks` with `presentation?: { dog?: { perform(a: DogAction): void; setMood(name: string): void; sulkAfter(): void; setStay(on: boolean): void }; escape?: { effectStarted(maxMs: number): void; effectEnded(): void }; speech?: (line: SpeechLine) => void; sound?: (name: SoundName, volume: number) => void }` and adds `fastTuning?: boolean`.
  - `SessionController.effectLost(): void` dispatches `ESC_PRESSED`.

- [ ] **Step 1: Write the failing tests** (fake presentation sinks recording calls; fake timers as in the existing `session.test.ts`):
  - `engine effect actions reach the dog`, and `RUN_LAPS` and `START_DIG_IN` call `escape.effectStarted` with `lapsMaxMs` and `digInMaxMs`; `END_EFFECT` calls `effectEnded`.
  - `moods reach the dog and the sound gate`: a whine expression plays `whine` at the settings volume.
  - `an answer with a guilt trip calls sulkAfter, and a guilt line passes the speech gate`.
  - `a dig that ends with the card still pending reopens the bubble`.
  - `effectLost dispatches ESC_PRESSED: the effect ends and the level is kept`.
  - `stay on/off reaches the dog`.
  - Review Focus #4, `Esc during an effect while the bubble is open ends the effect and leaves the bubble open`: `bubbleState().open` stays true.
  - Review Focus #5, `ending or pausing mid-effect releases Esc, returns the dog to roam, and plays no more sound or speech`.
  - `fastTuning shrinks check-in, escalation and guilt timings 100× and leaves effect durations`, checked through the escalation reaching a timeout within 1 s of fake time.
  - In `engineHost.test.ts`: `a guilt trip reaches the sink`.
- [ ] **Step 2: Run** `npx vitest run tests/main/session.test.ts tests/main/engineHost.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the fan-out in the session sink (spec §3 diagram), with the speech and sound gates owned by the session. Then wire `index.ts`:
  - `createDogHost` gets `cursor: () => screen.getCursorScreenPoint()` and `onEffectLost: () => studySession.effectLost()`;
  - `createEscapeKey` uses `globalShortcut`;
  - speech and sound are broadcast to the overlays;
  - `fastTuning: e2e && process.env['BARKSTUDY_FAST_TUNING'] === '1'`.

  `bubbleHost`, `leaveIt` and `escapeKey` all share one hotkeys adapter built in `index.ts`. In e2e that adapter also records each registered callback by accelerator.

  Debug gains:
  - `moodLog()`: the last 200 `{ mood, pose, effect }` changes recorded from the dog's frames;
  - `escapeHeld()`;
  - `pressHotkey(accelerator)`: runs the recorded callback as if the key were pressed;
  - `speechLog()`;
  - `updateSettings(patch)`: passes through to `library.updateSettings`.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(main): engine actions drive the dog, Esc, speech and sound`.

### Task 9: Acceptance, OS-level Esc check and a real look

**Files:**
- Create: `tests/e2e/escalation.spec.ts`, `scripts/capture-overlay.cjs`
- Modify: `scripts/os-check.cjs` (a new Esc section)

**Interfaces:**
- Consumes: the debug hooks from Task 8.

- [ ] **Step 1: Write the e2e acceptance tests** (launched with `BARKSTUDY_FAST_TUNING=1`, a deck with 3 cards, a session started):
  - `an ignored card climbs curious, pleading, zoomies, dig-in in order`: `moodLog()` contains those moods in order, with `effect.kind` `laps` then `dig`.
  - `at cap 3 there is never a dig-in`: set via the `updateSettings({ cap: 3 })` debug hook before starting.
  - `Esc during laps ends the effect and releases Esc`: `pressHotkey('Escape')` while `escapeHeld()`, then the effect is gone and `escapeHeld()` is false.
  - `Leave it stops everything`: `pressHotkey('Ctrl+Alt+L')` during an effect, then the effect ends, `escapeHeld()` is false, and nothing new appears in `moodLog()` for 2 s.
  - `a slow answer gives the answer mood, then sulk, and a guilt line shows`: wait past the shrunk guilt threshold, answer through the bubble, then `moodLog()` ends with `happy` or `ecstatic` or `calm` followed by `sulk`, and the overlay balloon or eyebrow shows the guilt text with the minutes.
  - `a quick correct answer has no sulk`.
- [ ] **Step 2: Run** `npm run e2e`. Expected: all specs PASS. Fix the product code, not the assertions, on a failure.
- [ ] **Step 3: Add the OS-level Esc section** to `scripts/os-check.cjs`. Open a focused plain test `BrowserWindow` with a keydown counter, then check:
  - with no effect, Esc reaches it (`count` goes up);
  - during a forced laps effect, Esc ends the effect and `count` does not change;
  - after the effect, Esc reaches it again.

  Run `node scripts/os-check.cjs`. Expected: every line PASS.
- [ ] **Step 4: Write `scripts/capture-overlay.cjs`.** It launches with fast tuning, forces laps and then dig, and saves `webContents.capturePage()` of the dog's overlay at three moments each into a directory given as its first argument. Run it into the scratchpad and look at the images: the dog is visible and on the window frame during laps, dirt appears at the title bar, and nothing is drawn off-screen at 125% scale. Fix what the images show before moving on.
- [ ] **Step 5: Commit** `test: M4 acceptance, OS-level Esc check and overlay capture script`.

### Task 10: Docs

**Files:**
- Modify: `PLAN.md` (Milestone 4 heading: done, linking this plan and the spec), `docs/test-matrix.md` (rows for Esc release in another app, laps across two monitors and sound default, marked manual where unchecked), `README.md` (one line on tray sound controls)

- [ ] **Step 1: Edit** the three docs. Pandesal is he throughout.
- [ ] **Step 2: Run** `npm run typecheck && npm run lint && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 3: Commit** `docs: M4 done; test matrix rows for effects, Esc and sound`.
