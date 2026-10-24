@echo off
rem Launches the spike with a clean environment (VS Code sets ELECTRON_RUN_AS_NODE, which breaks Electron).
rem   run.cmd s2 --keep      tracker overlay (20 Hz poll), stays up
rem   run.cmd s3 --keep      tracker overlay (WinEvent hooks), stays up: drag windows and watch the outlines
rem   run.cmd all            all automated self-tests, then exits (moves the mouse and sends a few keys)
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
npx electron . %*
