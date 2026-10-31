import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchControl, seedOnboarded } from './helpers';

let app: ElectronApplication | null = null;
let userData: string;

test.beforeEach(() => {
  userData = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-e2e-log-'));
  seedOnboarded(userData);
});

test.afterEach(async () => {
  if (app) await app.close();
  app = null;
  fs.rmSync(userData, { recursive: true, force: true });
});

test('an uncaught error in the page lands in the app log, and crash dumps are kept locally', async () => {
  const { app: launched, page } = await launchControl(userData);
  app = launched;
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e page boom');
    }, 0);
  });
  const logFile = join(userData, 'logs', 'app.log');
  await expect.poll(() => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''), { timeout: 10_000 }).toMatch(/ERROR renderer: .*e2e page boom/);
  expect(fs.existsSync(join(userData, 'logs', 'crashes'))).toBe(true);
});
