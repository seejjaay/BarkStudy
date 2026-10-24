# BarkStudy Product Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Context:** BarkStudy is a real product, not a demo. It's free, open source (MIT), and shipped to the public on Windows through signed GitHub Releases and winget. `docs/SPEC.md` is the original vision. **Where this plan and the spec disagree, this plan wins.** In particular, demo mode is gone, and the app makes exactly one network call: an update check that users can turn off.

**Goal:** Ship BarkStudy 1.0, a Windows desktop study companion. Pandesal walks real title bars, schedules your flashcards with spaced repetition, escalates when ignored (within an intensity cap you set), is always escapable, updates itself, and never phones home with your data.

**Architecture:** A pure TypeScript engine (`src/engine`) split into a **finite rule layer**, a **clock** that turns real time into timer events, and a **personality layer** that picks among allowed intents with a seeded RNG. Electron main (`src/main`) owns the engine, the Win32 tracker (koffi), idle detection, hotkeys, storage and updates. It sends actions over IPC to a click-through React + canvas overlay, plus a normal control window for decks, settings and history.

**Tech Stack:** Node 24 LTS, TypeScript (strict), Electron + electron-vite + electron-builder (NSIS) + electron-updater, React, koffi, ts-fsrs (FSRS spaced-repetition scheduler, MIT), Vitest, fast-check, Playwright (Electron e2e), tsx, ESLint (flat config + typescript-eslint). npm with exact pins (`npm i -E`), using whatever is current at install time. Dependabot keeps them moving.

**Spec:** `docs/SPEC.md` (vision) + this plan (decisions)

## Global Constraints

- `src/engine/**` imports nothing from `electron`, `react`, `react-dom`, `node:*` or any DOM API. This is enforced by ESLint `no-restricted-imports` **and** by `tsconfig.engine.json` (`lib: ["ES2022"]`, `types: []`).
- No `Math.random()` in `src/`. ESLint `no-restricted-properties` blocks it, and randomness goes through `src/engine/rng.ts`.
- The engine is deterministic: the same seed and event sequence produce identical actions. This is what makes bug reports replayable.
- Win32 reads are limited to window bounds, z-order, foreground hwnd, minimized/cloaked flags and process image name. Never `GetWindowText`, window contents or screenshots. Never move, close, resize, focus or send input to another window.
- **Network.** The renderer makes zero requests: the Electron session cancels everything but `file:` and the dev-server origin. Main makes exactly one kind of request, the electron-updater check against this repo's GitHub Releases. It's disclosed in onboarding, can be switched off in Settings, and carries no user data. There is no telemetry and no analytics.
- `shell.openExternal` may only be called with URLs from a hardcoded allowlist (repo issues, releases, `PRIVACY.md`), and never with user data in the URL.
- Electron hardening: `contextIsolation`, `sandbox`, no `nodeIntegration`, a narrow `contextBridge` API, CSP `default-src 'self'`. Fuses: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `OnlyLoadAppFromAsar` on, `EnableEmbeddedAsarIntegrityValidation` on.
- Storage is local JSON under `userData`. It's written atomically, carries a `schemaVersion` with tested migrations, keeps rolling backups (last 5), and a corrupt file → `.bak` + fallback, never a crash.
- `appId` (`io.github.<owner>.barkstudy`) and the userData folder name are fixed in Task 0 and never change, since changing them breaks updates and orphans user data. The display name can still change before 1.0.
- All user-facing strings live in `src/shared/i18n/en.ts`, with no inline literals in UI, so Filipino can be added later without hunting.
- Every task ends with `npm run typecheck && npm run lint && npm test` green. Each commit is CJ-confirmed.

## Decisions this plan makes (spec gaps or contradictions; override any)

1. **Away vs. busy.** Only `active` escalates (the spec's invariant beats its §4 wording). While typing-busy (idle < 10 s), escalation timeouts × `activeSlowdown` (2). Idle 10 s–5 min counts as active. Idle ≥ 5 min counts as away. Lock counts as locked.
2. **Finite rule layer.** Timers are events fired by the clock, so the explorer runs the real rule code over every reachable state. Timing guarantees are covered by property tests. The docs describe it exactly that way, not as a proof.
3. **RNG state lives in `EngineState`.** The signature is `step(state, event, ctx)`.
4. **Esc** is a `globalShortcut` registered only while an effect runs (≤ 8 s). "Leave it" is a permanent global hotkey (`Ctrl+Alt+L`, rebindable).
5. **Suppression.** A fullscreen foreground window **or** a foreground app on the user's *excluded apps* list (by process name: games, Zoom, Teams, OBS…, with a default list shipped) means no prompts, no effects and no escalation.
6. **Answers.** Any answer resets the level to 0. Only a correct answer earns a treat. Esc ends the effect but keeps the level.
7. **Intensity cap.** The user chooses a max level, *Gentle* (2), *Playful* (3) or *Full dog* (4, default), and that's an engine invariant. Someone who hates dig-in turns it off without losing the app.
8. **Spaced repetition.** Card **choice** is FSRS via ts-fsrs, while check-in **timing** stays the engine's job. Grades: exact match → Good, fuzzy match → Hard, wrong → Again. Self-grade offers "Got it" (Good) and "Missed it" (Again). `src/shared/srs.ts` wraps ts-fsrs, so the engine doesn't know about cards.
9. **Answer matching.** Normalisation is NFKC, then lowercase, then strip diacritics, then collapse whitespace, then strip trailing punctuation. Allowed Damerau-Levenshtein distance is 0 for ≤ 3 chars, 1 for ≤ 7, and 2 above that. Digit runs must match exactly.
10. **Overlay spanning.** One window if correct on mixed DPI, otherwise one per display (decided in M0). If the tracker fails at runtime, the app drops to **edge-roaming mode** automatically instead of breaking.
11. **Distribution.** MIT on GitHub. Releases are NSIS installers, signed through SignPath Foundation (free for OSS; apply early because approval takes time), published to GitHub Releases with a winget manifest per release. There's a beta channel (prerelease tags) behind a Settings toggle.
12. **Diagnostics instead of telemetry.** Crashes go to a local crash log (`crashReporter` with `uploadToServer: false`). "Copy diagnostics" bundles app/OS version, DPI and monitor count, recent errors, and the engine input log (event types, timings, seed, no card text) for the user to attach to a GitHub issue. `npm run replay` reproduces it.

## Review Focus

1. **Mixed-DPI two-monitor setup.** The dog should stand exactly on title bars on both screens. M2 geometry tests use per-monitor scale fixtures, plus the manual matrix.
2. **Esc pressed in another app during an effect.** Only the effect ends, and Esc is released within ≤ 8 s. T4.4 registrar test with a fake `globalShortcut`.
3. **Real-shaped imports.** Excel CSV (BOM, CRLF, quoted commas), Quizlet export (tab-separated), Anki TSV, and pasted text with blank lines all import without junk rows. M3 fixtures.
4. **Sleep/resume (a TICK of hours).** No escalation burst, no dig-in spam, effects still end. A Task 7 property with dt up to 6 h, plus single-`CHECKIN_DUE` catch-up.
5. **Upgrading from an older version.** Every deck, review history, setting and guilt trip survives, and a failed migration restores the backup instead of starting empty. T3.3 migration tests using fixtures from every past schema version.

---

## File structure

```text
LICENSE  README.md  PRIVACY.md  SECURITY.md  CONTRIBUTING.md  CHANGELOG.md
.github/workflows/ci.yml, release.yml   .github/ISSUE_TEMPLATE/   .github/dependabot.yml
docs/SPEC.md  docs/spike-results.md  docs/test-matrix.md  docs/release.md
src/engine/        types, tuning, rng, rules, clock, personality, lines, engine, invariants
src/shared/        geometry, physics, matching, deckParse, srs, ipc, i18n/en.ts
src/main/          index, overlay, controlWindow, tray, tracker/, idle, suppress, hotkeys,
                   storage/ (io, migrations/, backups), engineHost, updater, diagnostics, autostart
src/renderer/overlay/   canvas loop, sprites, bubble, effects, audio
src/renderer/control/   onboarding, decks, session, settings, history, about
assets/            sprites, sounds, icons (source files + exported sheets)
tests/             engine/, checker/, property/, regressions/, shared/, main/, e2e/, fixtures/
scripts/           explore.ts, replay.ts
spike/             M0 throwaway (deleted at end of M2)
```

---

## Task 0: Repo foundation

**Files:** `package.json`, `tsconfig.json`, `tsconfig.engine.json`, `eslint.config.js`, `vitest.config.ts`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.gitignore`, `LICENSE` (MIT), `README.md`, `docs/SPEC.md`

- [ ] Run `git init`. Install the dev deps exact-pinned. Scripts: `typecheck`, `lint`, `test`, `explore`, `replay`.
- [ ] ESLint: engine `no-restricted-imports`, `Math.random` ban, `recommended-type-checked`.
- [ ] Barrier check: a probe file importing `electron` in `src/engine` fails lint, and `document` there fails `tsc -p tsconfig.engine.json`. Delete the probe.
- [ ] CI runs on `ubuntu-latest` + `windows-latest`: `npm ci`, typecheck, lint, test, `npm audit --audit-level=high`. Dependabot is weekly for npm + actions.
- [ ] Lock in `appId` and the userData name and record them in `docs/release.md`. Create the GitHub repo (public, so it's eligible for SignPath) once CJ OKs it.
- [ ] Commit `chore: foundation, guardrails, CI`.

## Milestone 0: Win32 + overlay spike (time-box 2 days, `spike/`)

These items carry over from the previous plan unchanged. They retire the riskiest unknowns first, and each records pass/fail in `docs/spike-results.md`.

- [ ] **S1 Overlay.** Transparent, frameless, `alwaysOnTop('screen-saver')`, `skipTaskbar`, `focusable:false`, `setIgnoreMouseEvents(true,{forward:true})`, with a hover hit-test toggling over IPC. **Pass:** click-through everywhere except the target, at 100/125/150 % and on 2 mixed-scale monitors. **Fail → per-display overlays.**
- [ ] **S2 Tracker via koffi.**
  - Calls: `EnumWindows`, `IsWindowVisible`, skip `WS_EX_TOOLWINDOW`, `DWMWA_CLOAKED (14)`, `IsIconic`, `DWMWA_EXTENDED_FRAME_BOUNDS (9)`, `GetWindow(GW_HWNDNEXT)`, `GetForegroundWindow`, process name via `QueryFullProcessImageNameW`. Skip our own hwnd and convert with `screen.screenToDipRect`.
  - **Pass:** title-bar outlines track exactly at all scales.
- [ ] **S3 WinEvent hooks.** `SetWinEventHook` (`WINEVENT_OUTOFCONTEXT`) for location change, foreground, move/size start/end, minimize start/end, show/hide/destroy, with `koffi.register` callbacks on the main thread. **Pass:** drags stream with no jank. **Fail → 30 Hz poll only while needed.**
- [ ] **S4 Focus and keys.** Bubble input → `setFocusable(true)` + `focus()`, focus returned afterward. Dynamic `Escape` register/unregister. **Pass:** typing works, and Esc in Notepad is normal after unregister.
- [ ] **S5 Signing and updates dry run.** Build an NSIS installer with electron-builder, install, then publish a draft GitHub Release with v0.0.2 and confirm electron-updater finds, downloads and applies it on a test machine. (Unsigned for now, so SmartScreen will warn, and that's expected.) Submit the SignPath Foundation application in parallel.
- [ ] Go/no-go goes in `docs/spike-results.md`, then write the detailed M2 plan from the results.

## Milestone 1: Engine and invariant checker

*Acceptance: all invariants pass in the explorer and in the property tests, and each deliberate mutant is caught with a short counterexample.*

### Task 1: Seeded RNG

**Files:** create `src/engine/rng.ts`; test `tests/engine/rng.test.ts`

**Produces:** `type RngState = { a; b; c; d: number }`; `createRng(seed: number): RngState`; `nextFloat(r): [number, RngState]` in [0,1); `nextInt(r, min, maxExcl): [number, RngState]`; `weightedPick<T>(r, items: readonly {item: T; weight: number}[]): [T, RngState]`.

- [ ] Tests: `same seed gives same 1000-value sequence`, `different seeds diverge within 3 values`, `nextFloat always in [0,1)` (fast-check), `weightedPick never picks weight-0 items`, `weightedPick frequencies within ±2% over 100k draws`, `input state is not mutated`.
- [ ] FAIL → implement **sfc32** → PASS → commit `feat(engine): seeded rng`.

### Task 2: Types and tuning

**Files:** create `src/engine/types.ts`, `src/engine/tuning.ts`

**Produces:**
```ts
type Level = 0|1|2|3|4; type Cap = 2|3|4; type Activity = 'active'|'away'|'locked'; type EffectKind = 'laps'|'dig-in';
interface RuleState { session: boolean; level: Level; cap: Cap; paused: boolean; stay: boolean; activity: Activity;
  suppressed: boolean; card: boolean; effect: EffectKind|null; digCooling: boolean; missedWhileAway: boolean }
type RuleEvent = Exclude<Event, {type:'TICK'}|{type:'WINDOW_FOCUS_CHANGED'}>
  | {type:'EFFECT_EXPIRED'} | {type:'DIG_COOLDOWN_EXPIRED'} | {type:'STAY_EXPIRED'};
type Intent = 'idle-wander'|'nap'|'show-card'|'re-ask'|'follow-cursor'|'whine'|'laps'|'dig-in'
  |'celebrate-small'|'celebrate-big'|'calm'|'sulk'|'curl-up'|'greet-return'|'sit-stay';
interface Traits { neediness: number; drama: number; patience: number; zoominess: number } // 0..1
interface Tuning { checkinMinMs; checkinMaxMs; firstEscalationMs; escalationStepMs; activeSlowdown;
  digInCooldownMs; lapsMaxMs; digInMaxMs; guiltThresholdMs; awayIdleMs; busyIdleMs } // number
interface Context { traits: Traits; tuning: Tuning; activeWindowId: number|null; busy: boolean; lastGuiltMs: number|null }
```
`Event`/`Action` are copied from SPEC §5.1, plus `Event` gains `{type:'SUPPRESS_CHANGED'; on:boolean}` and `{type:'CAP_CHANGED'; cap: Cap}`, and `SESSION_START` gains `cap: Cap`.
- `DEFAULT_TUNING`: checkin 5–15 min, firstEscalation 90 s, escalationStep 60 s, activeSlowdown 2, digInCooldown 10 min, lapsMax 6 s, digInMax 8 s, guiltThreshold 2 min, awayIdle 5 min, busyIdle 10 s.
- `DEFAULT_TRAITS`, plus three presets (`calm`, `classic`, `drama-queen`) for onboarding.

- [ ] `npm run typecheck` passes, then commit with Task 3.

### Task 3: Rule layer

**Files:** create `src/engine/rules.ts`; test `tests/engine/rules.test.ts`

**Produces:** `ruleStep(s: RuleState, e: RuleEvent): { state: RuleState; required: Action[]; intents: Intent[] }`; `applyIntent(s: RuleState, i: Intent): RuleState` (`laps` → effect='laps'; `dig-in` → effect='dig-in', digCooling=true); `INITIAL_RULES` (session false, level 0, cap 4, active, rest false/null). The helper `allowed(effect, cap)` permits laps when cap ≥ 3 and dig-in when cap = 4.

Every row gets one test, named after the row:

| Event | Guard | Result |
|---|---|---|
| CHECKIN_DUE | session, ¬paused, ¬stay, ¬card, active, ¬suppressed | card=true, level=max(level,1), `[show-card]` |
| CHECKIN_TIMEOUT | card, active, ¬paused, ¬stay, ¬suppressed | level=min(level+1, cap). New level 2 → `[re-ask, follow-cursor, whine]`, 3 → `[laps, whine]`, 4 → `[dig-in]` if ¬digCooling else `[laps, whine]`. At the cap → `[re-ask, whine]` |
| CHECKIN_TIMEOUT | card, away/locked/suppressed | level unchanged, missedWhileAway=true, `[curl-up]` |
| ANSWER_SUBMITTED | card | level=0, card=false, effect=null (+END_EFFECT). correct → `[celebrate-small, celebrate-big]` + AWARD_TREAT, wrong → `[calm]` |
| USER_ACTIVITY away/locked | — | effect=null (+END_EFFECT), `[curl-up]` |
| USER_ACTIVITY active | missedWhileAway | missedWhileAway=false, `[greet-return]` (+SHOW_FLASHCARD if card) |
| STAY_ON | — | stay=true, card=false, effect=null, level=0 (+END_EFFECT), `[sit-stay]` |
| STAY_OFF / STAY_EXPIRED | stay | stay=false |
| PAUSE / RESUME | — | paused=true, effect=null (+END_EFFECT), level kept / paused=false |
| ESC_PRESSED, EFFECT_EXPIRED | effect≠null | effect=null + END_EFFECT, level kept |
| DIG_COOLDOWN_EXPIRED | — | digCooling=false |
| SUPPRESS_CHANGED on/off | — | suppressed=on. On → effect=null (+END_EFFECT) |
| CAP_CHANGED | — | cap=c, level=min(level,c), effect cleared if `!allowed(effect,c)` (+END_EFFECT) |
| SESSION_START / END | — | start → INITIAL with session=true and cap from the event. End → INITIAL (+END_EFFECT) |
| anything else | — | no change, no actions |

- [ ] Write the row tests, plus `wrong answer at level 3 → level 0, no AWARD_TREAT` and `cap 2 never offers laps or dig-in`. FAIL → implement as one `switch` → PASS → commit `feat(engine): rule layer`.

### Task 4: Invariants, explorer, mutants

**Files:** create `src/engine/invariants.ts`, `tests/checker/explorer.ts`, `tests/checker/explorer.test.ts`, `tests/checker/mutants.test.ts`, `scripts/explore.ts`

**Produces:**
```ts
type Transition = { prev: RuleState; event: RuleEvent; intent: Intent|null; next: RuleState; actions: Action[] };
type Invariant = { id: string; holds: (t: Transition) => boolean };
const INVARIANTS: readonly Invariant[];
explore(step: typeof ruleStep, apply: typeof applyIntent, invariants: readonly Invariant[]):
  { states: number; transitions: number; violation: null | { invariant: string; trace: Transition[] } };
canAlwaysReach(step, apply, goal: (s: RuleState) => boolean): { ok: boolean; stuck: RuleState[] };
```
Invariants:
- `QUIET`: paused/stay before and after ⇒ no SHOW_FLASHCARD/RUN_LAPS/START_DIG_IN, effect null, level not raised.
- `LEVEL_BOUNDS`: 0 ≤ level ≤ 4.
- `CAP`: `next.level ≤ next.cap` and `allowed(next.effect, next.cap)`.
- `DIG_ONCE`: START_DIG_IN ⇒ `!prev.digCooling && next.digCooling`.
- `WRONG_NO_RAISE`: an answer never raises the level.
- `ESC_ENDS`: ESC/EFFECT_EXPIRED ⇒ effect null, with END_EFFECT iff an effect was running.
- `AWAY_NO_RAISE`: the level rises only on CHECKIN_TIMEOUT while active, ¬suppressed, ¬paused, ¬stay.
- `NO_SESSION_QUIET`: no session ⇒ no prompt/effect actions.

The explorer does BFS from `INITIAL_RULES` over the full event alphabet (both `correct` values, 3 activities, `on` both ways, every cap, one STAY_ON duration). It branches over every intent, dedupes on `JSON.stringify`, and keeps parent pointers so traces are shortest. Actions = `required` + a placeholder intent→action map.

- [ ] `explorer.test.ts`: `explores every reachable rule state with zero violations` (expect states > 1000), `canAlwaysReach(level 0 && effect null) from every reachable state`, `PAUSE from any reachable state yields no effect`.
- [ ] `mutants.test.ts`: `wrong-answer-escalates` → `WRONG_NO_RAISE`, `dig-ignores-cooldown` → `DIG_ONCE`, `esc-ignored` → `ESC_ENDS`, `cap-ignored` → `CAP`, each with a trace ≤ 8.
- [ ] `scripts/explore.ts` is a dev tool: it prints the stats, and with `--mutant <id>` prints the trace and exits 1.
- [ ] FAIL → implement → PASS → commit `feat(checker): rule-layer explorer + mutation tests`.

### Task 5: Clock and engine composition

**Files:** create `src/engine/clock.ts`, `src/engine/engine.ts`; test `tests/engine/engine.test.ts`

**Consumes:** Tasks 1–3, plus Task 6 personality (stubbed with the first intent until then).
**Produces:**
```ts
interface Deadlines { checkin; timeout; effectEnd; digCooldownEnd; stayEnd: number|null }
interface Stats { answered: number; treats: number; cardShownAt: number|null; longestWaitMs: number; guiltTrips: number[] }
interface EngineState { rules: RuleState; now: number; deadlines: Deadlines; pausedAt: number|null; rng: RngState; stats: Stats }
createEngine(seed: number): EngineState;
step(s: EngineState, e: Event, ctx: Context): { state: EngineState; actions: Action[] };
```
- `TICK(dt)` fires due deadlines in time order at their exact time, then advances by the remainder.
- **Catch-up:** an overdue check-in fires once and is rescheduled from `now`.
- **Timeouts:** first = `firstEscalationMs × lerp(1.5,0.5,patience) × (busy ? activeSlowdown : 1)`, each later one = `escalationStepMs × lerp(1.5,0.5,neediness) × slowdown`.
- **Other deadlines:** check-in = `nextInt(checkinMinMs, checkinMaxMs)`. Effect end = laps/dig max. Dig cooldown. Stay end.
- **Pause:** PAUSE stores `pausedAt`, and RESUME shifts all deadlines.
- **Guilt:** an answer with `waited ≥ guiltThresholdMs` emits `RECORD_GUILT_TRIP`.

- [ ] Tests: `effect ends exactly at lapsMaxMs even with a single TICK of 1h`; `pause 30 min shifts deadlines by 30 min`; `TICK of 6h fires at most one CHECKIN_DUE`; `busy doubles time to first escalation`; `guilt trip only when waited ≥ threshold`; `step does not mutate its input`.
- [ ] FAIL → implement → PASS → commit `feat(engine): clock + step`.

### Task 6: Personality layer

**Files:** create `src/engine/personality.ts`, `src/engine/lines.ts`; test `tests/engine/personality.test.ts`

**Produces:** `chooseIntent(intents, rules, ctx, rng): [Intent, RngState]`; `intentToActions(i, rules, ctx, rng, waitedMs: number|null): [Action[], RngState]`.
- Utility = `BASE[intent] × trait multiplier` (celebrate-big × (0.5+zoominess), whine/follow-cursor × (0.5+neediness), sulk × drama), picked with `weightedPick`.
- `laps`/`dig-in` with a null activeWindowId degrade to `whine`.
- `lines.ts` holds **i18n keys**, not strings. There are ≥ 3 variants per intent, plus guilt-trip and "last time you left me for N minutes" (from `ctx.lastGuiltMs`) keys with `{minutes}` params. The renderer resolves them through `src/shared/i18n/en.ts`.

- [ ] Tests: `chosen intent always ∈ intents` (fast-check), `zoominess 1 → celebrate-big ≥ 70% over 10k; zoominess 0 → ≤ 30%`, `null activeWindowId emits no RUN_LAPS/START_DIG_IN`, `guilt line params: 360000ms → {minutes: 6}`.
- [ ] FAIL → implement → PASS. Replace the Task 5 stub and re-run everything. Commit `feat(engine): personality`.

### Task 7: Property tests and regression replay

**Files:** create `tests/property/arbitraries.ts`, `tests/property/engine.property.test.ts`, `tests/regressions/replay.test.ts`, `tests/regressions/.gitkeep`

- Arbitraries: all Events (TICK dt weighted 16 ms–5 min with a 5 % tail to 6 h), ctx (traits, busy, activeWindowId), scenarios of ≤ 300 events. 2,000 runs each. On failure, the shrunk scenario is written to `tests/regressions/<invariant>-<seed>.json` and the test fails with the path.
- [ ] Properties: `rule invariants hold on every engine step`, `effects never outlive their max`, `START_DIG_IN ≥ digInCooldownMs apart`, `ESC always ends a running effect`, `deterministic (same scenario twice → identical action log)`, `no escalation while away or suppressed`, and `level never exceeds cap`.
- [ ] `replay.test.ts` replays every saved JSON (and passes with none).
- [ ] Barrier check: break `WRONG_NO_RAISE`, then confirm the property writes a JSON with ≤ 10 events. Revert, and keep the JSON as a regression.
- [ ] Commit `test(engine): properties + regression replay`.

### Task 8: M1 acceptance

- [ ] Green locally and on both CI runners, `npm run explore` reports 0 violations, and every mutant is caught.
- [ ] README "How Pandesal stays safe": the explorer is exhaustive over the finite rule layer (N states, M transitions), properties cover time, and it's explicitly not a formal proof. This is public-facing, because it's the trust story.
- [ ] Commit `docs: safety model`.

---

## Milestone 2: Overlay and window tracker *(detailed plan written from M0 results)*

*Acceptance: dragging a window carries Pandesal along, clicks pass through everywhere except the dog and its bubble, and killing the tracker drops to edge-roaming without a crash.*

- **T2.1 `src/shared/geometry.ts` (pure, TDD).**
  - Functions: `visibleTopEdges(windows, workAreas): Platform[]`, `clipSprite(sprite, occluders): Rect[]`, `toDip(rect, scale)`.
  - Tests: overlapping stacks, maximised (top edge = platform, floor = work-area bottom), minimised/cloaked excluded, scale fixtures 1.0/1.25/1.5.
- **T2.2 `src/shared/physics.ts` (pure, TDD).**
  - Function: `stepDog(dog, platforms, dtMs): DogBody`, with gravity, landing, riding, falling when the platform vanishes, and a floor fallback.
  - Tests: ride a 300 px drag, the platform vanishes and the dog lands on the next one, and a 100 px/frame drag doesn't tunnel through.
- **T2.3 `src/main/tracker/`.** koffi bindings → `TrackedWindow {id, bounds, z, minimized, fullscreen, processName, isForeground}`, pushed on WinEvent with 16 ms coalescing.
  - Excluded: our own hwnd and tool windows.
  - A test greps `src/` for `GetWindowText|SetWindowPos|SendInput|PostMessage|SendMessage` and expects none.
  - Runtime failure (FFI throws, the hook dies) → emits `tracker-down`, and the overlay switches to edge-roaming.
- **T2.4 `src/main/overlay.ts`.** Overlay window(s) per S1, the ignore-mouse toggle, the network-cancel hook and the CSP.
- **T2.5 `src/renderer/overlay/`.** A canvas loop that runs only while something moves, hit-testing, and reduced-motion support (`prefers-reduced-motion` + Windows animation setting → walk instead of run, no particles).
- **T2.6 Manual matrix** in `docs/test-matrix.md`: 3 scales × 1–2 monitors × maximised/fullscreen/minimised/fast drag. Delete `spike/`.

## Milestone 3: Study loop and data

*Acceptance: a full study session works without effects. Cards are chosen by FSRS, and all data survives an app restart and an upgrade.*

- **T3.1 `src/shared/deckParse.ts` (TDD).** `parseDeck(text): { cards: CardInput[]; skipped: {line; reason}[] }`. Delimiter is auto-detected, with RFC 4180 quoting, BOM, CRLF and blank lines handled. Fixtures: excel-bom-crlf.csv, quizlet-export.tsv, anki.tsv, pasted-with-blank-lines.txt, quoted-commas.csv. Plus `exportDeck(deck): string` (CSV round-trips).
- **T3.2 `src/shared/matching.ts` (TDD).** `matchAnswer(given, expected): 'exact'|'fuzzy'|'wrong'` per Decision 9. Tests: case/space/diacritics, 1 typo at 6 chars → fuzzy, `1990` vs `1991` → wrong, empty → wrong.
- **T3.3 `src/main/storage/` (TDD in a temp dir).**
  - Read and write: `readStore<T>(name, migrations, fallback)` and `writeAtomic(name, data)`. Files: `decks.json` (cards + FSRS state), `settings.json`, `history.json` (sessions, guilt trips, treats).
  - Migrations: `migrations/NNN-*.ts`, each a pure `(old) => new` with fixtures under `tests/fixtures/schemas/vN/`.
  - Backups: rolling, last 5, taken before every migration.
  - Tests: `corrupt → .bak + fallback`, `crash mid-write keeps the old file`, `every past fixture migrates to current`, and `failed migration restores the backup and reports an error` (not an empty app).
- **T3.4 `src/shared/srs.ts` (TDD).** `nextCard(deck, now): Card|null` and `review(card, grade, now): Card`, wrapping ts-fsrs. Tests: a new deck serves new cards, Again re-queues soon, nothing due → least-recently-seen card (a session never stalls), deterministic for a fixed `now`.
- **T3.5 `src/main/idle.ts` + `src/main/suppress.ts`.** Idle runs every 5 s via `powerMonitor.getSystemIdleTime()` plus the lock/unlock events → `USER_ACTIVITY` on change and `ctx.busy`. Suppress reads the tracker foreground (fullscreen, or process name in the excluded list) → `SUPPRESS_CHANGED` on change.
- **T3.6 `src/main/engineHost.ts`.** Owns `EngineState` and a 250 ms TICK while a session runs. It maps actions → IPC and the SRS card → bubble, and keeps a rolling engine input log (event types, dt, seed, no card text) for diagnostics.
- **T3.7 Control window, decks and session.**
  - Decks: list, create, rename, delete with undo toast, add/edit/delete cards, import (paste/file) with a skipped-row report, export CSV.
  - Session: start session (deck, topic name, interval bounds) and end session → summary (answered, treats, longest wait, guilt trips).
  - History list of past sessions.
  - States, each built explicitly: no decks (Start disabled + reason), 0 valid rows, import error, running, paused, stay (time left), away, tracker-down notice.
  - Every write confirms with a toast.
- **T3.8 Bubble.** Question, answer input, "Show answer" → Got it / Missed it, result feedback. Fully keyboard-operable: Enter submits, Esc dismisses the bubble without counting as an answer.
- **T3.9 Tray + hotkeys.** The tray is the always-there nav: Start/End session, Stay (15/25/50 min), Leave it, Open BarkStudy, Quit. `Ctrl+Alt+L` toggles PAUSE/RESUME. A registration conflict is shown in Settings with a rebind prompt, never swallowed. A single-instance lock means a second launch focuses the control window.

## Milestone 4: Escalation, art and sound

*Acceptance: the full escalation ladder (idle → curious → pleading → zoomies → dig-in → answer → sulk) plays in a real session, respects the cap, and Esc/Leave it stop it at any point.*

- **T4.1 Art.**
  - Final sprite sheets for the 5 moods plus spin, treat, sulk, curl-up and sit-stay.
  - App/tray/installer icons.
  - Sources in `assets/` and exported sheets at 1x/2x for DPI.
  - Art style is decided at the start of this task: self-drawn, or commissioned under a CC-BY/owned license, recorded in `assets/LICENSE`.
- **T4.2 Zoomies.** A laps path around the active window's frame, ending at `lapsMaxMs`.
- **T4.3 Dig-in.** Dirt particles, paw prints along the frame and a pop-up with the card, all on the overlay. If the target vanishes or becomes suppressed → END_EFFECT.
- **T4.4 Dynamic Esc.** `hotkeys.ts` registers on effect start and unregisters on END_EFFECT **and** on a hard timer at `max+500ms`. Tests use a fake `globalShortcut`.
- **T4.5 Sound.** Bark, whine, happy yip and dig scratch, with a volume slider and mute. It's silent while suppressed, and sounds must be short (< 1.5 s) and never loop.
- **T4.6 Guilt memory.** On session start, `ctx.lastGuiltMs` comes from history → "Last time you left me for N minutes."

## Milestone 5: Product shell

*Acceptance: a new user installs, gets through onboarding, studies, changes settings, and can export, back up and restore their data, all keyboard-only if they want.*

- **T5.1 Onboarding (first run only, can be re-opened from About).**
  - Meet Pandesal.
  - Pick a personality preset + intensity cap.
  - Learn the two escape hatches (press `Ctrl+Alt+L` once to continue).
  - Privacy summary + update-check toggle.
  - Start-with-Windows choice.
  - A sample deck so the first session works immediately.
- **T5.2 Settings.**
  - Study: intensity cap, personality preset/trait sliders, check-in interval bounds, excluded apps (pick from running processes + manual entry, default list shipped).
  - Controls: hotkeys (rebind).
  - Sound & motion: sound/volume, reduced motion (follows Windows by default).
  - System: start with Windows (`app.setLoginItemSettings`), updates (on/off, beta channel).
  - Data: open folder, export all, import all, reset with confirm.
- **T5.3 Accessibility pass.** Every control-window flow works by keyboard alone, with visible focus rings, labelled inputs, screen-reader names (Narrator check), and text that scales with the Windows text-size setting. Status is never carried by colour alone.
- **T5.4 Diagnostics.**
  - Crash log: `crashReporter` local only.
  - Main/renderer errors go to a rolling `logs/app.log`.
  - About → "Copy diagnostics" copies the Decision 12 bundle to the clipboard, and "Report a bug" opens the allowlisted GitHub new-issue URL (no data in the URL).
  - `scripts/replay.ts` replays a pasted engine log.
- **T5.5 Power awareness.** On battery saver, roaming stops and the dog naps, with check-ins unaffected.
- **T5.6 e2e (Playwright `_electron`).** Smoke flows: first run → onboarding → sample session answered → summary, and import a deck → export round-trips. Teardown closes the app first, then the temp userData dir, so a failing test still exits in seconds.

## Milestone 6: Release engineering

*Acceptance: pushing a `vX.Y.Z` tag produces a signed installer on GitHub Releases, existing installs auto-update to it, and `winget install` works.*

- **T6.1 Fuses + packaging.** electron-builder NSIS (per-user install, no admin), the fuses from Global Constraints, ASAR integrity, and the installer/uninstaller icon. The uninstaller asks whether to keep data.
- **T6.2 Signing.** SignPath Foundation signing in `release.yml` (GitHub Actions only, as their OSS program requires). If approval is still pending at 1.0, ship unsigned beta builds marked clearly in the release notes and hold 1.0 for signing.
- **T6.3 Auto-update.** `src/main/updater.ts` uses electron-updater against GitHub Releases. It checks on launch + every 6 h if enabled, downloads in the background, and on "Restart to update" (tray + toast) never interrupts a running session. Beta channel = prerelease tags. Offline or failed → silent retry next cycle.
- **T6.4 Versioning.** Conventional commits → release-please generates `CHANGELOG.md` and the release PR. The tag triggers `release.yml`.
- **T6.5 winget.** `wingetcreate` submits the manifest PR on each stable release (a GitHub Action step). The package id is recorded in `docs/release.md`.
- **T6.6 Repo docs.** `README` (what it is, screenshots/GIF, install, safety model, privacy), `PRIVACY.md` (exactly what's read, what's stored, the one network call), `SECURITY.md` (how to report), `CONTRIBUTING.md`, issue templates (bug report asks for "Copy diagnostics"), PR template.

## Milestone 7: Beta → 1.0

*Acceptance: the 1.0 release criteria below are all met.*

- **T7.1 Closed beta.** Classmates and friends on the beta channel for 2+ weeks, with feedback through GitHub Discussions/Issues. Track "funny vs. annoying" per escalation level and tune `DEFAULT_TUNING` and traits from it.
- **T7.2 Hardware sweep.** A low-end laptop (4 GB RAM, integrated graphics) plus the dev machine. CPU targets: idle < 1 %, roaming < 5 %. Memory: < 250 MB total working set. Results go in `docs/test-matrix.md`.
- **T7.3 Final name.** Check the name against existing apps, trademarks and winget ids, then set the display name. `appId` stays as is.
- **T7.4 1.0 release criteria.** All of these are needed:
  - No open crash bugs.
  - The manual matrix passes.
  - The installer is signed.
  - Auto-update has been verified from the last beta.
  - Migration fixtures exist for every beta schema.
  - `PRIVACY.md` matches the code (re-grep for network and Win32 calls).

## Post-1.0 roadmap (not scheduled)

Filipino localization, Anki `.apkg` import, a daily study reminder, more dogs with trait profiles, Microsoft Store listing, macOS window awareness / a Linux framed fallback, and local-model flashcard generation.

## Verification (whole product)

- `npm test` (unit, explorer, mutants, properties, regressions, storage migrations) on Ubuntu and Windows CI on every push, plus `npm audit`.
- e2e smoke on Windows CI for every PR.
- The manual matrix before every release.
- Safety checks on every release:
  - Esc and `Ctrl+Alt+L` work during every effect.
  - The forbidden-Win32 grep comes up empty.
  - With updates off, the network log shows zero requests.
  - With updates on, only GitHub Releases is contacted.
- Release check: install the previous version, auto-update to the new one, and confirm decks, history and settings are intact.
