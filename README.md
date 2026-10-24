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
