# BarkStudy

*A needy desktop dog that nags you into studying.*

Working title and mascot name (**BarkStudy**, **Pandesal** the dog) are placeholders. Rename freely.

## 1. The pitch

BarkStudy is Pandesal, a small cartoon dog that lives on your Windows desktop, quizzes you from your own flashcards, and, when ignored, digs into the window you're using until you answer.

The problem is useless on purpose: study timers already exist and work fine. The engineering is not. Pandesal runs on a personality engine whose safety rules are exhaustively checked over an abstract model of its state, and it understands the real windows on your screen well enough to walk along their title bars.

### The 30-second demo (the acceptance test for the whole project)

1. Start a session: "Biochem, 25 flashcards." Pandesal trots onto your browser's title bar and sits.
2. A flashcard bubble appears, dropped like a ball. You answer it. Pandesal does a happy spin and earns a treat.
3. You ignore the next one while typing. Pandesal sees you're active, tilts its head, and backs off.
4. You keep ignoring it. Pandesal gets puppy eyes, then runs zoomies laps around your active window, then digs into its title bar. Dirt flies, paw prints trace the window frame, and Pandesal pops up holding the flashcard in its mouth.
5. You answer. Pandesal bolts out, sulks dramatically, and logs a guilt trip: "You left me for 6 minutes."
6. You hit the "Leave it" hotkey. Everything stops instantly.

A developer demo mode compresses timers and fixes the random seed so this exact sequence replays identically every time.

## 2. The useless problem

Your study timer doesn't care about you. A Pomodoro timer never gets lonely when ignored, never whines, and never digs through your browser to demand an answer about the Krebs cycle. Productivity tools are emotionally unavailable, and BarkStudy fixes this non-problem by giving your reminders a dog's emotional needs.

The serious question underneath: how do you make software feel spontaneous and needy while guaranteeing it can never become harmful, stuck, or impossible to dismiss?

## 3. Meet Pandesal

Pandesal is a small, floppy-eared cartoon dog (think askal, a Filipino street dog) who has appointed itself your study buddy. It is overjoyed when you show up and heartbroken when you don't.

Four personality traits, each a tunable number the engine reads:

- **Neediness:** how quickly an unanswered flashcard becomes heartbreak.
- **Drama:** how long guilt trips last and how theatrical the sulking is. Guilt trips carry across sessions ("Last time you left me for 14 minutes.").
- **Patience:** how long Pandesal waits before escalating.
- **Zoominess:** how wild the celebration is when you answer.

Dog commands double as the controls:

- **"Stay"** (Focus Shield): one click makes Pandesal sit and stay quietly for a focus block, and it respects you for it.
- **"Leave it"** (global hotkey): pauses everything instantly, from anywhere.
- **Esc:** ends any visual effect immediately.

## 4. How a session works

A session is a loop of flashcard check-ins, and Pandesal's mood climbs a bounded five-level ladder based on how you respond.

1. **Start.** Name a topic and load flashcards by pasting Q&A pairs or importing a CSV (`question,answer`).
2. **Roam.** Pandesal walks along the title bars of real windows and falls off when a window moves away.
3. **Check in.** At randomized intervals within limits you set, a flashcard bubble appears. The user can type an answer (lenient matching, case and whitespace ignored, small typos allowed) or hit "Show answer" and self-grade. Any response counts as showing up.
4. **React.** Answering calms Pandesal and earns a treat. A wrong answer never raises the escalation level; only ignoring Pandesal does.
5. **Escalate.** Ignored check-ins raise the level, more slowly when the user is actively working than when away.
6. **Stay or pause.** "Stay" silences Pandesal for a focus block; "Leave it" pauses everything.
7. **Summarize.** At the end: cards answered, treats earned, longest wait, and the session's guilt trips.

### Escalation ladder

| Level | Mood | What Pandesal does |
| --- | --- | --- |
| 0 | Idle | Trots along title bars, naps, wags tail |
| 1 | Curious | Tilts head, drops a flashcard bubble |
| 2 | Pleading | Puppy eyes, whines, follows your cursor, re-asks |
| 3 | Zoomies | Barks, runs laps around the active window, big expressions |
| 4 | Dig-in | Digs into the active window's title bar; dirt and paw prints on the overlay; pops up with the card |

### Away vs. busy

Pandesal reads system idle time, never keystrokes. If the user is away, missed cards do not escalate; Pandesal curls up and greets you with a "where were you" when you return. If the user is active but ignoring the dog, Pandesal cannot tell deep focus from doomscrolling, and that is the joke: it escalates slowly, and "Stay" is the one-click answer.

## 5. Engineering

### 5.1 Two-layer personality engine (pure TypeScript)

A pure function: `(state, event, context, rng) -> { nextState, actions }`. It must never import Electron, React, or any DOM API.

- **Rule layer (finite-state machine):** decides what is *allowed*: current level, legal transitions, cooldowns, pause and stay.
- **Personality layer (utility AI):** scores each allowed action using the traits and context (time since last answer, guilt level, user activity, active window) and picks one with weighted randomness from a seeded generator.

Sketch of the contract:

```ts
type Level = 0 | 1 | 2 | 3 | 4;

type Event =
  | { type: 'SESSION_START' } | { type: 'SESSION_END' }
  | { type: 'TICK'; dtMs: number }
  | { type: 'CHECKIN_DUE' } | { type: 'CHECKIN_TIMEOUT' }
  | { type: 'ANSWER_SUBMITTED'; correct: boolean }
  | { type: 'USER_ACTIVITY'; state: 'active' | 'away' | 'locked' }
  | { type: 'STAY_ON'; durationMs: number } | { type: 'STAY_OFF' }
  | { type: 'PAUSE' } | { type: 'RESUME' } | { type: 'ESC_PRESSED' }
  | { type: 'WINDOW_FOCUS_CHANGED'; windowId: number | null };

type Action =
  | { type: 'SHOW_FLASHCARD' } | { type: 'SET_EXPRESSION'; name: string }
  | { type: 'WALK_TO'; windowId: number } | { type: 'RUN_LAPS'; windowId: number }
  | { type: 'START_DIG_IN'; windowId: number } | { type: 'END_EFFECT' }
  | { type: 'SAY'; line: string } | { type: 'AWARD_TREAT' }
  | { type: 'RECORD_GUILT_TRIP'; waitedMs: number } | { type: 'CURL_UP' };
```

Treat this as a starting point; refine it while building, but keep the engine pure and fully deterministic given a seed.

### 5.2 Safety rules checked, not hoped for

Guarantees are written as invariants and verified two ways in CI:

- **Exhaustive state exploration.** Abstract the engine state into a finite space (level × cooldown bucket × paused × stay × user activity). A breadth-first search applies every event to every reachable state and asserts every invariant. This is a small model checker in plain TypeScript. Describe it honestly as exhaustive checking over the abstract model, not as a full formal proof.
- **Property-based testing.** fast-check generates thousands of random event sequences against the real engine with simulated time. Failures shrink to the shortest breaking sequence and are saved as replayable regression tests.

Invariants:

- Paused or in "Stay" means no prompts, no effects, no escalation.
- The escalation level always stays between 0 and 4.
- Dig-in fires at most once per cooldown window.
- A wrong answer never raises the level.
- Every effect ends on its own within a fixed time, and Esc always ends it immediately.
- While the user is away, missed check-ins never escalate.

### 5.3 Window awareness on Windows

Pandesal treats real windows as a 2D platformer level.

- **Tracking:** call Win32 through a small FFI layer (koffi): enumerate top-level windows, read true frame bounds via DWM, track z-order and the foreground window. Use WinEvent hooks for moves and resizes instead of constant polling.
- **Physics:** simple gravity and collision. Pandesal stands on title bars, rides along when a window is dragged, and falls when the window moves out from under it.
- **Occlusion:** the overlay is always on top, so "hiding behind" a window means clipping the sprite against rectangles of windows above the one it stands on.
- **Overlay:** one transparent, click-through window spans the desktop and only captures the mouse when the cursor is over Pandesal or a flashcard bubble.
- **Edge cases:** per-monitor DPI scaling, multiple monitors, maximized and fullscreen windows, minimized windows Pandesal must step off of.

Only window bounds, z-order, and process names are read. Never window titles, contents, or screenshots.

### 5.4 Away vs. busy

Electron's built-in system idle time and lock state classify the user as active, away, or locked. This signal feeds the engine as context only: never which keys were pressed.

## 6. Architecture and stack

```text
 INPUTS                         ENGINE                    OUTPUTS

 Window tracker ------+
 (Win32 via koffi)    |
                      v
 Idle monitor ----> Personality engine --actions--> Overlay renderer
 (Electron idle)    (FSM + utility AI,              (React + canvas sprites,
                     seeded RNG)                     physics, dig-in effect)
 User input -------^        ^
 (answers, Stay,            |
  Leave it, Esc)            v
                      Local storage (JSON:
                      flashcards, guilt trips, logs)
```

| Layer | Choice |
| --- | --- |
| Desktop shell | Electron (Windows first), built with Vite |
| Language | TypeScript everywhere |
| UI | React plus canvas sprites for the dog, bubbles, and effects |
| Native access | koffi (FFI to Win32) |
| Tests | Vitest and fast-check |
| Storage | Local JSON files |

Suggested layout:

```text
src/engine/     pure logic: types, rules, personality, rng, no Electron/React imports
src/main/       Electron main process: windows, tracker, idle monitor, hotkeys
src/renderer/   React overlay: sprites, bubbles, effects
src/shared/     shared types and constants
tests/          unit tests, state explorer, property tests
```

## 7. Safety and privacy

Pandesal is annoying by design and harmless by construction. Each rule below is a tested invariant or a hard requirement.

- **Always escapable:** Esc ends any effect; the "Leave it" global hotkey pauses the session from anywhere.
- **Hands off other apps:** the dig-in effect is drawn on Pandesal's own click-through overlay. Never move, close, resize, or type into other windows.
- **Minimal signals:** window bounds, z-order, process names, and idle time only. No screenshots, keystrokes, window titles, or contents.
- **No punishment for being wrong:** only ignoring Pandesal escalates.
- **Local only:** settings, flashcards, guilt trips, and session logs stay in local JSON files. No network calls.

## 8. Build plan for Claude Code

### Ground rules

- Build engine-first. The engine stays pure TypeScript with no Electron, React, or DOM imports.
- Every milestone ends with tests green and something demoable. Commit at each milestone.
- Spike the riskiest thing first: Win32 window tracking and the transparent click-through overlay on Windows. If the spike fails, fall back to Pandesal roaming screen edges without window awareness.
- Keep dependencies minimal and pin versions.
- Never read window titles, contents, or screenshots, and never alter other windows.
- Randomness always comes from the seeded generator, never `Math.random()`, so demo mode and tests are reproducible.

### Milestones

1. **Engine and invariant checker.** Rule layer, personality layer, seeded RNG, state explorer, and property tests running in CI. *Acceptance: all invariants pass; deliberately breaking one makes the checker print a counterexample.*
2. **Overlay and window tracker.** Transparent click-through overlay, Win32 tracking, Pandesal walking title bars with physics and occlusion. *Acceptance: dragging a window carries Pandesal with it; clicks pass through everywhere except the dog and its bubble.*
3. **Study loop.** Flashcard import, check-ins, answer matching, idle detection, Stay, "Leave it," treats. *Acceptance: a full session works without effects.*
4. **Escalation and dig-in.** Five expressions, zoomies, the dig-in effect, guilt-trip memory across sessions. *Acceptance: the 30-second storyboard plays end to end.*
5. **Hardening.** Demo mode, session summary, DPI and multi-monitor checks, performance pass. *Acceptance: the demo replays identically from a fixed seed, and the overlay stays light on CPU.*

### MVP (must ship)

- Windows overlay with real window awareness
- Two-layer engine with checked invariants
- Flashcard check-ins, idle detection, Stay, "Leave it"
- Dig-in effect and five expressions
- Session summary, guilt trips, treats, and demo mode

### Stretch (cut first)

- Window awareness on macOS; a framed companion-window fallback on Linux
- An opt-in list of study apps that slows escalation
- More dogs with different trait profiles
- Flashcards generated from notes by a local model

## 9. Testing and demo plan

- **Engine:** unit tests per transition, the exhaustive state explorer, and fast-check property tests, all in CI on every push.
- **Window layer:** a manual matrix covering 100%, 125%, and 150% scaling; one and two monitors; maximized, fullscreen, minimized, and fast-dragged windows.
- **Overlay:** clicks pass through everywhere except the dog and its bubble; Esc and "Leave it" always work.
- **Play test:** if time allows, a few classmates run a real study session and rate whether Pandesal is funny or just annoying.
- **Demo:** fully offline, demo mode with a fixed seed, plus a recorded backup video. Live, break an invariant on purpose and show the checker catching it.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Win32 FFI is harder than expected | Spike it first; fall back to screen-edge roaming without window awareness |
| DPI scaling misaligns the dog and windows | Convert per monitor; test at 100, 125, and 150% |
| Overlay costs too much CPU | WinEvent hooks instead of polling; pause rendering when the dog is still |
| Dig-in feels annoying, not funny | Bounded cooldowns, "Stay," play-test feedback |
| Solo scope | Engine-first order, a demo at every milestone, stretch goals cut first |

## 11. Open decisions

- Final project name and the dog's name (BarkStudy and Pandesal are placeholders).
- Art style: simple self-drawn sprites are the cheapest path.
- Whether to keep the "dig-in" effect as the signature, or swap it for another dog-themed one such as fetch or a howl.

*Useless problem. Seriously engineered dog.*
