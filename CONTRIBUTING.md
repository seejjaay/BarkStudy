# Contributing

Thanks for looking. BarkStudy is a small project; a short issue before a big change saves everyone time.

## Set up

Windows, Node 24 LTS.

```sh
npm ci
node node_modules/electron/install.js   # npm 12 blocks Electron's own install script
npm run dev                              # run the app; quit it from the tray menu
```

If your terminal sets `ELECTRON_RUN_AS_NODE` (VS Code's does), unset it before launching Electron by hand.

## Before you send a change

```sh
npm run typecheck && npm run lint && npm test
npm run e2e          # builds, then drives the real app; it moves only its own test window
```

CI runs the first line on Windows and Linux and also packages the Windows build (`npm run package`, then `node scripts/verify-package.cjs`). If you touch the engine, `npm run explore` re-checks every invariant over all reachable states.

## Rules that are checked by machine

- `src/engine/**` and `src/shared/**` import nothing from `electron`, `react`, `node:*` or the DOM, and `Math.random()` is banned in `src/`. ESLint and `tsconfig.engine.json` enforce both.
- Every user-facing string lives in `src/shared/i18n/en/`. A test fails on an inline literal in the UI.
- Windows APIs are limited to window bounds, z-order, foreground, minimised or cloaked state, process names and battery saver. Never window titles or contents, and never act on another window. A test reads the sources for this.
- The renderer makes no network requests. The update check in the main process is the only one the app makes.

## Commits and releases

Use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, with `!` or a `BREAKING CHANGE:` footer for breaking ones). release-please reads them to work out the next version and write `CHANGELOG.md`; do not edit the version or the changelog by hand. Maintainers: see [docs/release.md](docs/release.md).

## Reporting a bug

Use the bug report form, and paste **Copy diagnostics** (About page) into it. `npm run replay -- bundle.txt` replays the engine log in it. Security problems go through [SECURITY.md](SECURITY.md), not a public issue.
