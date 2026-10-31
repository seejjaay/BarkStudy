import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { debug, launchControl, seedOnboarded, waitForDebug } from './helpers';

let app: ElectronApplication | null = null;
let page: Page;
let userData: string;

async function open(): Promise<void> {
  ({ app, page } = await launchControl(userData));
}

test.beforeEach(() => {
  userData = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-e2e-onb-'));
});

// Closing the app first means a failing test still exits in seconds, then the temp data goes.
test.afterEach(async () => {
  if (app) await app.close();
  app = null;
  fs.rmSync(userData, { recursive: true, force: true });
});

const nav = (name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name });
const heading = (name: string) => page.getByRole('heading', { level: 1, name });
const storedSettings = () => (JSON.parse(fs.readFileSync(join(userData, 'data', 'settings.json'), 'utf8')) as { data: Record<string, unknown> }).data;

/** Activates a control the way a keyboard user does: focus it, press Enter. */
async function activate(control: Locator): Promise<void> {
  await control.focus();
  await page.keyboard.press('Enter');
}

test('a first run is walked through from the keyboard, ends on Study with the starter deck, and is not shown again', async () => {
  await open();
  await waitForDebug(app!);
  await expect(heading('Meet Pandesal')).toBeFocused();
  await activate(page.getByRole('button', { name: 'Next' }));

  await expect(heading('How much dog do you want?')).toBeFocused();
  await page.getByRole('radio', { name: /Playful/ }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('radio', { name: /Playful/ })).toBeChecked();
  await activate(page.getByRole('button', { name: 'Next' }));

  // The Leave it step is a gate: Next stays off until the shortcut has been pressed once.
  await expect(heading('Two ways to make him stop')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  expect(await debug<boolean>(app!, 'pressHotkey', 'Ctrl+Alt+L')).toBe(true);
  await expect(page.getByText('That worked')).toBeVisible();
  await activate(page.getByRole('button', { name: 'Next' }));

  await expect(heading('What he can see')).toBeFocused();
  await activate(page.getByRole('button', { name: 'Next' }));

  // An unpackaged app cannot register itself to start with Windows, so that step is not shown.
  await expect(heading('Something to study')).toBeFocused();
  await activate(page.getByRole('button', { name: 'Start studying' }));

  await expect(nav('Study')).toHaveAttribute('aria-current', 'page');
  await nav('Decks').click();
  await expect(page.getByText("Pandesal's starter deck")).toBeVisible();
  expect(storedSettings()).toMatchObject({ onboarded: true, cap: 3 });

  await app!.close();
  await open();
  await expect(nav('Study')).toBeVisible();
  await expect(heading('Meet Pandesal')).toHaveCount(0);
});

test('Skip setup keeps the defaults, adds the starter deck and counts as done', async () => {
  await open();
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(nav('Study')).toBeVisible();
  expect(storedSettings()).toMatchObject({ onboarded: true, cap: 4, preset: 'classic' });
  await nav('Decks').click();
  await expect(page.getByText("Pandesal's starter deck")).toBeVisible();
});

test('a damaged settings file is reported and is not mistaken for a first run', async () => {
  fs.mkdirSync(join(userData, 'data'), { recursive: true });
  fs.writeFileSync(join(userData, 'data', 'settings.json'), '{"half');
  await open();
  await expect(nav('Study')).toBeVisible();
  await expect(page.getByText('A saved file was damaged')).toBeVisible();
  await expect(heading('Meet Pandesal')).toHaveCount(0);
});

test('Run setup again, from About, starts from what is saved and Cancel changes nothing', async () => {
  seedOnboarded(userData, { cap: 2, preset: 'calm' });
  await open();
  await nav('About').click();
  await page.getByRole('button', { name: 'Run setup again' }).click();
  await expect(heading('Meet Pandesal')).toBeFocused();
  await activate(page.getByRole('button', { name: 'Next' }));
  await expect(page.getByRole('radio', { name: /Gentle/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Calm/ })).toBeChecked();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(nav('About')).toHaveAttribute('aria-current', 'page');
  expect(storedSettings()).toMatchObject({ cap: 2, preset: 'calm', onboarded: true });
});
