import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { control, debug, launchControl, seedOnboarded, waitForDebug } from './helpers';

let app: ElectronApplication | null = null;
let page: Page;
let userData: string;

async function open(): Promise<void> {
  ({ app, page } = await launchControl(userData));
}

test.beforeEach(() => {
  userData = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-e2e-set-'));
  seedOnboarded(userData);
});

// Closing the app first means a failing test still exits in seconds, then the temp data goes.
test.afterEach(async () => {
  if (app) await app.close();
  app = null;
  fs.rmSync(userData, { recursive: true, force: true });
});

const nav = (name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name });
const toast = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text });
const leaveItButton = (label: string) => page.getByRole('button', { name: new RegExp(`^Leave it: ${label.replace(/\+/g, '\\+')}`) });

test('cap, personality and the apps he leaves alone are still set after a restart', async () => {
  await open();
  await nav('Settings').click();
  await page.getByRole('radio', { name: /Playful/ }).click();
  await expect(page.getByRole('radio', { name: /Playful/ })).toBeChecked();
  await page.getByRole('radio', { name: /Calm/ }).click();
  await expect(page.getByRole('radio', { name: /Calm/ })).toBeChecked();
  await page.getByRole('textbox', { name: /Program name to add/ }).fill('Notepad.EXE');
  await page.keyboard.press('Enter');
  await expect(page.getByText('notepad.exe')).toBeVisible();
  await expect(toast('Saved.')).toBeVisible();

  await app!.close();
  await open();
  await nav('Settings').click();
  await expect(page.getByRole('radio', { name: /Playful/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Calm/ })).toBeChecked();
  await expect(page.getByText('notepad.exe')).toBeVisible();
});

test('check-in minutes that make no sense are explained and not saved', async () => {
  await open();
  await nav('Settings').click();
  await page.getByRole('textbox', { name: 'Shortest gap in minutes' }).fill('30');
  await page.getByRole('textbox', { name: 'Longest gap in minutes' }).fill('10');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'cannot be shorter' })).toBeVisible();
});

test('Leave it can be moved: the new shortcut works, the old one is released, and a clash is refused', async () => {
  await open();
  await waitForDebug(app!);
  await nav('Settings').click();
  await leaveItButton('Ctrl+Alt+L').click();
  await page.keyboard.press('Control+Alt+K');
  await expect(toast('Leave it is now Ctrl+Alt+K.')).toBeVisible();
  expect((await debug<{ accelerator: string }>(app!, 'leaveIt')).accelerator).toBe('Control+Alt+K');
  expect(await debug<boolean>(app!, 'pressHotkey', 'Ctrl+Alt+L')).toBe(false);
  expect(await debug<boolean>(app!, 'pressHotkey', 'Control+Alt+K')).toBe(true);

  // The answer-bubble shortcut already has Ctrl+Alt+A.
  await leaveItButton('Ctrl+Alt+K').click();
  await page.keyboard.press('Control+Alt+A');
  await expect(page.getByRole('alert').filter({ hasText: 'cannot be used' })).toBeVisible();
  expect((await debug<{ accelerator: string }>(app!, 'leaveIt')).accelerator).toBe('Control+Alt+K');
});

test('export all, reset, then import all brings the decks back', async () => {
  const file = join(userData, 'backup.json');
  await open();
  await waitForDebug(app!);
  await control(page, 'deck:import-text', { deckId: null, name: 'French', text: 'chat,cat' });
  await nav('Settings').click();

  await debug(app!, 'setNextDialogPath', file);
  await page.getByRole('button', { name: 'Export all…' }).click();
  await expect(toast('Backup saved to')).toBeVisible();
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ app: 'barkstudy', kind: 'backup' });

  await page.getByRole('button', { name: 'Reset everything…' }).click();
  await page.getByRole('dialog', { name: 'Reset everything?' }).getByRole('button', { name: 'Reset everything' }).click();
  // Everything is gone, so it is a first run again.
  await expect(page.getByRole('heading', { level: 1, name: 'Meet Pandesal' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip setup' }).click();

  await nav('Settings').click();
  await debug(app!, 'setNextDialogPath', file);
  await page.getByRole('button', { name: 'Import all…' }).click();
  await page.getByRole('dialog', { name: 'Restore from a backup?' }).getByRole('button', { name: 'Choose backup file…' }).click();
  await expect(toast('Restored from the backup')).toBeVisible();
  await nav('Decks').click();
  await expect(page.getByText('French')).toBeVisible();
  await expect(page.getByText("Pandesal's starter deck")).toHaveCount(0);
});

test('reset is refused while a session is running, and nothing is lost', async () => {
  await open();
  await waitForDebug(app!);
  const made = await control<{ ok: boolean; value: { deckId: string } }>(page, 'deck:import-text', { deckId: null, name: 'Busy', text: 'a,b' });
  expect(made.ok).toBe(true);
  await control(page, 'session:start', { deckId: made.value.deckId, topic: '', checkinMinMinutes: 5, checkinMaxMinutes: 15 });
  await nav('Settings').click();
  await page.getByRole('button', { name: 'Reset everything…' }).click();
  await page.getByRole('dialog', { name: 'Reset everything?' }).getByRole('button', { name: 'Reset everything' }).click();
  await expect(toast('End the session first')).toBeVisible();
  await nav('Decks').click();
  await expect(page.locator('.row-title', { hasText: 'Busy' })).toBeVisible();
});
