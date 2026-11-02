# Privacy

BarkStudy runs on your PC and keeps everything there. This page says exactly what it reads, what it stores, and the one thing it sends. If the code ever disagrees with this page, that is a bug: please [report it](https://github.com/seejjaay/BarkStudy/issues/new).

## What it reads

To let Pandesal walk along window title bars, BarkStudy asks Windows for:

- each top-level window's position and size, and which windows are in front of which
- which window is in the foreground
- whether a window is minimised or hidden
- the name of the program that owns each window (for example `chrome.exe`), so you can list apps he should leave alone
- how long you have been idle, and whether the screen is locked
- whether Windows battery saver is on

It **never** reads window titles or what is inside a window, **never** takes screenshots, and never moves, closes, resizes, focuses or types into another program's window. Its global shortcuts (Leave it, Esc during an effect, the answer bubble) are registered with Windows only while they are needed, and BarkStudy does not log your key presses. The only text it reads is the answer you type into its own bubble, to mark it.

## What it stores

Everything is in `%APPDATA%\BarkStudy` on this PC (Settings → Your data → **Open data folder** shows it):

| What | Where |
| --- | --- |
| Your decks and cards, with their review schedule | `data\decks.json` |
| Your settings, including any program names you asked it to leave alone | `data\settings.json` |
| Study session history (when, which deck and topic, how many answered, treats earned, and the times you left him waiting) | `data\history.json` |
| Automatic backups of those files (the last five of each) | `data\backups\` |
| A rolling log of the app's own errors | `logs\app.log` |
| Crash dumps, if the app ever crashes | `logs\crashes\` (never uploaded) |

**Export all** in Settings writes one backup file of your decks, history and settings to a place you choose. **Reset everything** deletes them (after keeping a copy in the backups folder). Uninstalling asks whether to delete this folder too; a silent uninstall keeps it.

## What it sends

One kind of request, and only if **Check for updates** is on (it is by default; Settings → System turns it off): the app asks this repository's GitHub Releases for the newest version, and downloads it when there is one. The request carries no information from your decks, history or settings. Like any web request, GitHub sees your IP address and the app's user-agent string, as it does when you open the Releases page in a browser.

Nothing else leaves your PC: no telemetry, no analytics, no crash reports, no account. The app's windows are not allowed to make network requests at all; the update check is made by the main process alone.

## Diagnostics and bug reports

About → **Copy diagnostics** puts a text bundle on your clipboard so you can paste it into a bug report: app, Windows and display details, recent errors, and a log of the engine's events (event types and timings, no card text). Paths and your user name are scrubbed, and the bundle is shown to you first. Nothing is sent by the app: you decide whether to paste it anywhere. **Report a bug** opens GitHub's new-issue page with nothing filled in.
