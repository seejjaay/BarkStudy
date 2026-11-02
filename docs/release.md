# Release notes for maintainers

## Fixed identifiers (never change after first public release)

Changing either one breaks auto-update and orphans user data.

| Thing | Value |
| --- | --- |
| userData folder name | `BarkStudy` (pinned in `src/main/identity.ts` with `app.setPath`, so renaming the app never moves it) |
| `appId` | `io.github.seejjaay.barkstudy` (**locked 2026-11-02**; also the Windows AppUserModelId. Set in `src/main/identity.ts` and repeated in `electron-builder.yml`) |

The display name (`productName`) may still change before 1.0.
