import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { control, debug, expectNoAxeViolations, launchControl, seedOnboarded, waitForDebug } from './helpers';

/**
 * Every control-window screen and dialog, and the overlay's answer bubble, scanned with axe (WCAG 2.0/2.1 A and AA).
 * No rule is switched off: a finding is fixed in the page, never waved through.
 */

let app: ElectronApplication | null = null;
let page: Page;
let userData: string;

async function open(): Promise<void> {
  ({ app, page } = await launchControl(userData));
  await expect(nav('Study')).toBeVisible();
}

test.beforeEach(() => {
  userData = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-e2e-a11y-'));
});

// Closing the app first means a failing test still exits in seconds, then the temp data goes.
test.afterEach(async () => {
  if (app) await app.close();
  app = null;
  fs.rmSync(userData, { recursive: true, force: true });
});

const nav = (name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name });
const toast = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text });

/** Opens the app as an onboarded user with one deck of two cards, and reloads so the lists show it. */
async function openWithDeck(): Promise<string> {
  seedOnboarded(userData);
  await open();
  const r = await control<{ ok: true; value: { deckId: string } }>(page, 'deck:import-text', { deckId: null, name: 'Capitals', text: 'France,Paris\nPeru,Lima' });
  await page.reload();
  await expect(nav('Study')).toBeVisible();
  return r.value.deckId;
}

async function startSession(deckId: string): Promise<void> {
  await control(page, 'session:start', { deckId, topic: '', checkinMinMinutes: 5, checkinMaxMinutes: 15 });
  await nav('Study').click();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
}

test('Study, idle', async () => {
  await openWithDeck();
  await expect(page.getByRole('button', { name: 'Start session' })).toBeVisible();
  await expectNoAxeViolations(page, 'Study, idle');
});

test('Study, idle with no deck', async () => {
  seedOnboarded(userData);
  await open();
  await expect(page.getByRole('heading', { name: 'Nothing to study yet' })).toBeVisible();
  await expectNoAxeViolations(page, 'Study, no deck');
});

test('Study, running: waiting, then a question, then the answer', async () => {
  const deckId = await openWithDeck();
  await startSession(deckId);
  await expectNoAxeViolations(page, 'Study, running with no question');

  await waitForDebug(app!);
  await debug(app!, 'checkin');
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible();
  await expectNoAxeViolations(page, 'Study, running with a question');

  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
  await expectNoAxeViolations(page, 'Study, running with the answer shown');
});

test('Study, session finished', async () => {
  const deckId = await openWithDeck();
  await startSession(deckId);
  await control(page, 'session:end');
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
  await expectNoAxeViolations(page, 'Study, finished summary');
});

test('Decks: empty, with rows, renaming, and with the undo toast showing', async () => {
  seedOnboarded(userData);
  await open();
  await nav('Decks').click();
  await expect(page.getByRole('heading', { name: 'No decks yet' })).toBeVisible();
  await expectNoAxeViolations(page, 'Decks, empty');

  await control(page, 'deck:import-text', { deckId: null, name: 'Capitals', text: 'France,Paris\nPeru,Lima' });
  await page.reload();
  await nav('Decks').click();
  await expect(page.getByText('Capitals')).toBeVisible();
  await expectNoAxeViolations(page, 'Decks, with rows');

  await page.getByRole('button', { name: 'New deck' }).click();
  await expect(page.getByRole('textbox', { name: 'Deck name' })).toBeVisible();
  await expectNoAxeViolations(page, 'Decks, naming a new deck');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('textbox', { name: 'New name for Capitals' })).toBeVisible();
  await expectNoAxeViolations(page, 'Decks, renaming');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(toast('Deleted')).toBeVisible();
  await expectNoAxeViolations(page, 'Decks, delete toast with Undo');
});

test('Cards: the editor with rows, a row being edited, and an empty deck', async () => {
  await openWithDeck();
  await nav('Decks').click();
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Capitals' })).toBeVisible();
  await expect(page.getByText('Paris')).toBeVisible();
  await expectNoAxeViolations(page, 'Card editor with rows');

  await page.getByRole('button', { name: 'Edit France' }).click();
  await expect(page.getByRole('textbox', { name: 'Front' }).last()).toBeVisible();
  await expectNoAxeViolations(page, 'Card editor, editing a card');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Delete France' }).click();
  await page.getByRole('button', { name: 'Delete Peru' }).click();
  await expect(page.getByRole('heading', { name: 'No cards in this deck yet' })).toBeVisible();
  await expectNoAxeViolations(page, 'Card editor, empty');
});

test('History: empty, then with rows', async () => {
  const deckId = await openWithDeck();
  await nav('History').click();
  await expect(page.getByRole('heading', { name: 'No sessions yet' })).toBeVisible();
  await expectNoAxeViolations(page, 'History, empty');

  await startSession(deckId);
  await control(page, 'session:end');
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
  await nav('History').click();
  await expect(page.getByRole('table')).toBeVisible();
  await expectNoAxeViolations(page, 'History, with rows');
});

test('Settings', async () => {
  seedOnboarded(userData);
  await open();
  await nav('Settings').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expectNoAxeViolations(page, 'Settings');
});

test('About', async () => {
  seedOnboarded(userData);
  await open();
  await nav('About').click();
  await expect(page.getByRole('heading', { level: 1, name: 'About BarkStudy' })).toBeVisible();
  await expectNoAxeViolations(page, 'About');
});

test('every onboarding step', async () => {
  await launchAndWait();
  const titles = ['Meet Pandesal', 'How much dog do you want?', 'Two ways to make him stop', 'What he can see', 'Something to study'];
  for (const [i, title] of titles.entries()) {
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    if (title === 'Two ways to make him stop') {
      await expectNoAxeViolations(page, `Onboarding step "${title}" before the shortcut is pressed`);
      expect(await debug<boolean>(app!, 'pressHotkey', 'Ctrl+Alt+L')).toBe(true);
      await expect(page.getByText('That worked')).toBeVisible();
    }
    await expectNoAxeViolations(page, `Onboarding step "${title}"`);
    if (i < titles.length - 1) await page.getByRole('button', { name: 'Next' }).click();
  }
});

async function launchAndWait(): Promise<void> {
  ({ app, page } = await launchControl(userData));
  await waitForDebug(app);
  await expect(page.getByRole('heading', { level: 1, name: 'Meet Pandesal' })).toBeVisible();
}

test('the import dialog, and its finished report', async () => {
  await openWithDeck();
  await nav('Decks').click();
  await page.getByRole('button', { name: 'Import cards' }).click();
  await expect(page.getByRole('dialog', { name: 'Import cards' })).toBeVisible();
  await expectNoAxeViolations(page, 'Import dialog, new deck');

  await page.getByRole('radio', { name: /An existing deck/ }).click();
  await expect(page.getByRole('combobox', { name: 'Deck' })).toBeVisible();
  await expectNoAxeViolations(page, 'Import dialog, existing deck');

  // One good row, one without a separator: the dialog stays open on a report with a skipped-rows table.
  await page.getByRole('textbox', { name: 'Paste cards' }).fill('Chile,Santiago\nbroken line');
  await page.getByRole('button', { name: 'Import pasted text' }).click();
  await expect(page.getByRole('dialog', { name: 'Import finished' })).toBeVisible();
  await expectNoAxeViolations(page, 'Import finished dialog with skipped rows');
});

test('the import dialog showing an error', async () => {
  await openWithDeck();
  await nav('Decks').click();
  await page.getByRole('button', { name: 'Import cards' }).click();
  await page.getByRole('textbox', { name: 'Deck name' }).fill('Junk');
  await page.getByRole('textbox', { name: 'Paste cards' }).fill('nothing usable here');
  await page.getByRole('button', { name: 'Import pasted text' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No row could be read' })).toBeVisible();
  await expectNoAxeViolations(page, 'Import dialog with an error');
});

test('the restore-from-backup dialog', async () => {
  seedOnboarded(userData);
  await open();
  await nav('Settings').click();
  await page.getByRole('button', { name: 'Import all…' }).click();
  await expect(page.getByRole('dialog', { name: 'Restore from a backup?' })).toBeVisible();
  await expectNoAxeViolations(page, 'Restore dialog');
});

test('the reset dialog', async () => {
  seedOnboarded(userData);
  await open();
  await nav('Settings').click();
  await page.getByRole('button', { name: 'Reset everything…' }).click();
  await expect(page.getByRole('dialog', { name: 'Reset everything?' })).toBeVisible();
  await expectNoAxeViolations(page, 'Reset dialog');
});

test('the diagnostics dialog', async () => {
  seedOnboarded(userData);
  await open();
  await nav('About').click();
  await page.getByRole('button', { name: 'Copy diagnostics…' }).click();
  await expect(page.getByRole('dialog', { name: 'Diagnostics' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Diagnostics to paste into a bug report' })).not.toHaveValue(/Gathering/);
  await expectNoAxeViolations(page, 'Diagnostics dialog');
});

test("the overlay's answer bubble while it is open", async () => {
  const deckId = await openWithDeck();
  await waitForDebug(app!);
  await startSession(deckId);
  await debug(app!, 'checkin');
  await expect.poll(() => app!.windows().some((w) => w.url().includes('overlay'))).toBe(true);
  const overlay = app!.windows().find((w) => w.url().includes('overlay'))!;
  await expect(overlay.locator('#bubble')).toBeVisible();
  await expectNoAxeViolations(overlay, 'Overlay answer bubble, asking');

  await overlay.locator('#bubble-reveal').click();
  await expect(overlay.locator('#bubble-answer-box')).toBeVisible();
  await expectNoAxeViolations(overlay, 'Overlay answer bubble, answer shown');
});

test('the main screens and a dialog in the dark colour scheme', async () => {
  const deckId = await openWithDeck();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoAxeViolations(page, 'Study, idle (dark)');
  for (const name of ['Decks', 'History', 'Settings', 'About']) {
    await nav(name).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page, `${name} (dark)`);
  }
  await startSession(deckId);
  await debug(app!, 'checkin').catch(() => undefined);
  await nav('Study').click();
  await expectNoAxeViolations(page, 'Study, running (dark)');
  await nav('About').click();
  await page.getByRole('button', { name: 'Copy diagnostics…' }).click();
  await expect(page.getByRole('dialog', { name: 'Diagnostics' })).toBeVisible();
  await expectNoAxeViolations(page, 'Diagnostics dialog (dark)');
});
