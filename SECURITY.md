# Security

## Reporting a vulnerability

Please report it **privately** through GitHub: open [Report a vulnerability](https://github.com/seejjaay/BarkStudy/security/advisories/new) on this repository's Security tab. Please do not open a public issue for something exploitable.

Say what you found, how to reproduce it, and which version (About shows it). This is a small project run by one person, so expect an acknowledgement within a week rather than a day; a fix will be released and credited to you if you like.

## What counts

BarkStudy is a desktop app that draws over other windows and reads window positions, so the interesting problems are:

- reading, moving or sending input to another program's windows, which the app promises never to do
- the app's windows making network requests (they are blocked), or the update check being redirected
- a way to run code through the app's own windows, files or update path (the packaged app has Electron's run-as-node and inspector fuses off, loads only from its integrity-checked archive, and uses a sandboxed renderer with a narrow bridge)
- a crafted deck, backup or settings file that crashes or takes over the app
- `shell.openExternal` being reachable with an address other than the fixed list

Not in scope: anything that needs an attacker who can already run code as you or edit files in your user folder, and the SmartScreen warning on unsigned builds.

## Supported versions

Only the latest release gets fixes.
