import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1, // one Electron app at a time: they share the screen and the global hotkey
  retries: 0,
  reporter: 'list',
});
