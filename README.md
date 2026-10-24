# BarkStudy

Pandesal is a dog that walks your real title bars, schedules your flashcards with spaced repetition, and escalates when you ignore her. She stays inside an intensity cap you set, is always escapable, and never phones home with your data.

Free, open source (MIT), Windows only. Work in progress: see [PLAN.md](PLAN.md) for the roadmap and [docs/SPEC.md](docs/SPEC.md) for the original vision.

## Development

Node 24 LTS.

```sh
npm ci
npm run typecheck && npm run lint && npm test
```

The engine in `src/engine` is pure TypeScript: no Electron, React, DOM or Node imports, and no `Math.random()`. ESLint and `tsconfig.engine.json` both enforce that.

## How Pandesal stays safe

Pandesal can bark, run laps around your window and dig at a title bar, so the rules about *when* she may do that are checked by machine, not just by reading the code.

The engine is split in two. A small **rule layer** (a finite state machine) decides what is allowed: the escalation level, your intensity cap, pause, Stay, cooldowns, whether you are away or in a suppressed app. A **personality layer** only picks among the options the rules allow, using a seeded random number generator. A **clock** turns real time into the timer events the rules react to. Because the rules are finite and timers are just events, they can be checked exhaustively.

Eight invariants (in [`src/engine/invariants.ts`](src/engine/invariants.ts)) are checked two ways:

- **Exhaustive exploration.** [`npm run explore`](scripts/explore.ts) runs a breadth-first search from the initial state, applies every event in every reachable state (branching over every intent the rules allow), and asserts every invariant on every transition. Currently that is 880 reachable rule states and 21,628 transitions, with 0 violations; the command prints the current numbers.
- **Property tests.** [fast-check](https://fast-check.dev) generates thousands of random event sequences (up to 300 events, with simulated time including multi-hour sleep gaps) against the real engine and checks the invariants plus timing guarantees: effects end on their own, dig-in respects its cooldown, Esc always ends an effect, a long sleep gives one catch-up and not a burst, and the same seed and events always produce the same actions. A failing run is shrunk to the shortest breaking sequence and saved under [`tests/regressions/`](tests/regressions) so it replays forever.

The checker is itself tested: four deliberately broken copies of the rules (a wrong answer that escalates, a dig-in that ignores its cooldown, an Esc that does nothing, a cap that is ignored) must each be caught, with a counterexample of eight steps or fewer. `npm run explore -- --mutant <id>` prints one.

What this is **not**: a formal proof. The exploration is exhaustive over the rule layer's abstract state space, and the property tests sample the timing behaviour of the whole engine. They are strong evidence, not a guarantee.
