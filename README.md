# BarkStudy

Pandesal is a dog that walks your real title bars, schedules your flashcards with spaced repetition, and escalates when you ignore him. He stays inside an intensity cap you set, is always escapable, and never phones home with your data.

Free, open source (MIT), Windows only. Work in progress: see [PLAN.md](PLAN.md) for the roadmap and [docs/SPEC.md](docs/SPEC.md) for the original vision.

<!-- TODO: a screenshot or short GIF of Pandesal on a title bar goes here once the art is final. -->

## Install

Download the latest `BarkStudy-Setup-X.Y.Z.exe` from [Releases](https://github.com/seejjaay/BarkStudy/releases) and run it. It installs for your account only, with no administrator prompt.

**Builds are not code-signed yet**, so Windows SmartScreen will warn: choose **More info**, then **Run anyway**. Signed builds come once the code-signing application is approved. To check a download yourself, the release page lists what it contains and the source here is what built it.

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

Releases are unsigned until that is in place, and the release notes say so while it is true. Once signing is on:

- **What gets signed:** only the BarkStudy installer and `BarkStudy.exe`, built from this repository's source by the [Release workflow](.github/workflows/release.yml) on GitHub's own runners from a release tag. Nothing built anywhere else is signed.
- **Who:** BarkStudy has one maintainer, [@seejjaay](https://github.com/seejjaay), who is its author, reviewer and approver. Every release is approved by hand in SignPath before it is signed. Contributions from others go through pull requests that the maintainer reviews.
- **Privacy:** see [PRIVACY.md](PRIVACY.md). In short, the only network request the app makes is the update check, and nothing from your decks, history or settings is sent.

## Updates

BarkStudy checks this repository's GitHub Releases shortly after it starts and about every six hours, downloads a newer version in the background, and tells you. It never restarts on its own while you study: **Restart to update** is in the tray menu and in Settings, and waits until your session ends. Turn checking off in Settings → System. **Include beta versions** opts in to prereleases.

## Privacy

BarkStudy reads where your windows are and which program owns each one, never their titles or contents, and takes no screenshots. Your decks, history and settings stay on your PC. The only network request the app makes is the update check, and there is no telemetry. The details are in [PRIVACY.md](PRIVACY.md).

## Development

Node 24 LTS.

```sh
npm ci
node node_modules/electron/install.js   # npm 12 blocks Electron's own install script
npm run typecheck && npm run lint && npm test
npm run e2e                              # builds, then drives the real overlay (moves its own test window only)
npm run dev                              # run the app; quit it from the tray menu
```

If your terminal sets `ELECTRON_RUN_AS_NODE` (VS Code's does), unset it before launching Electron by hand. Manual checks are listed in [docs/test-matrix.md](docs/test-matrix.md). See [CONTRIBUTING.md](CONTRIBUTING.md) before sending a change.

Pandesal's sounds (bark, whine, happy yip, dig scratch) are short placeholders synthesized in code. The tray menu has a **Sounds** toggle and a **Volume** submenu; he makes no sound while paused, on a Stay, away, or in an excluded or fullscreen app.

The engine in `src/engine` is pure TypeScript: no Electron, React, DOM or Node imports, and no `Math.random()`. ESLint and `tsconfig.engine.json` both enforce that.

## How Pandesal stays safe

Pandesal can bark, run laps around your window and dig at a title bar, so the rules about *when* he may do that are checked by machine, not just by reading the code.

The engine is split in two. A small **rule layer** (a finite state machine) decides what is allowed: the escalation level, your intensity cap, pause, Stay, cooldowns, whether you are away or in a suppressed app. A **personality layer** only picks among the options the rules allow, using a seeded random number generator. A **clock** turns real time into the timer events the rules react to. Because the rules are finite and timers are just events, they can be checked exhaustively.

Eight invariants (in [`src/engine/invariants.ts`](src/engine/invariants.ts)) are checked two ways:

- **Exhaustive exploration.** [`npm run explore`](scripts/explore.ts) runs a breadth-first search from the initial state, applies every event in every reachable state (branching over every intent the rules allow), and asserts every invariant on every transition. Currently that is 880 reachable rule states and 21,628 transitions, with 0 violations; the command prints the current numbers.
- **Property tests.** [fast-check](https://fast-check.dev) generates thousands of random event sequences (up to 300 events, with simulated time including multi-hour sleep gaps) against the real engine and checks the invariants plus timing guarantees: effects end on their own, dig-in respects its cooldown, Esc always ends an effect, a long sleep gives one catch-up and not a burst, and the same seed and events always produce the same actions. A failing run is shrunk to the shortest breaking sequence and saved under [`tests/regressions/`](tests/regressions) so it replays forever.

The checker is itself tested: four deliberately broken copies of the rules (a wrong answer that escalates, a dig-in that ignores its cooldown, an Esc that does nothing, a cap that is ignored) must each be caught, with a counterexample of eight steps or fewer. `npm run explore -- --mutant <id>` prints one.

What this is **not**: a formal proof. The exploration is exhaustive over the rule layer's abstract state space, and the property tests sample the timing behaviour of the whole engine. They are strong evidence, not a guarantee.
