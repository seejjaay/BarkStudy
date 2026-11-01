import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { control, debug, launchControl, seedOnboarded, waitForDebug } from './helpers';

/**
 * The control window with no mouse: the skip link, a whole study flow, where focus lands after a view switch or a delete,
 * dialogs that hold focus and give it back, and a visible focus ring on what you tab through.
 * Keys are pressed for real; only things a person cannot do from the keyboard (a check-in arriving, seeding a deck) are set up around them.
 */

let app: ElectronApplication | null = null;
let page: Page;
let userData: string;

async function open(): Promise<void> {
  ({ app, page } = await launchControl(userData));
  await expect(nav('Study')).toBeVisible();
}

test.beforeEach(() => {
  userData = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-e2e-keyboard-'));
});

test.afterEach(async () => {
  if (app) await app.close();
  app = null;
  fs.rmSync(userData, { recursive: true, force: true });
});

const nav = (name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name });
const focusedHeading = (name: string) => page.locator('h1:focus', { hasText: name });

/** Tab until `target` has focus, so reaching a control costs what it costs a person. */
async function tabTo(target: Locator, max = 120): Promise<void> {
  const handle = await target.elementHandle();
  if (!handle) throw new Error(`tabTo: ${String(target)} is not on the page`);
  for (let i = 0; i < max; i++) {
    if (await handle.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`tabTo: ${String(target)} was not reached in ${max} Tab presses`);
}

async function seedDeck(cards: string): Promise<string> {
  seedOnboarded(userData);
  await open();
  const r = await control<{ ok: true; value: { deckId: string } }>(page, 'deck:import-text', { deckId: null, name: 'Capitals', text: cards });
  await page.reload();
  await expect(nav('Study')).toBeVisible();
  return r.value.deckId;
}

test('the skip link is the first stop and Enter moves focus to the main area', async () => {
  seedOnboarded(userData);
  await open();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('main');
});

test('a whole study flow from the keyboard, landing on each page heading', async () => {
  seedOnboarded(userData);
  await open();

  // Decks: make a deck.
  await tabTo(nav('Decks'));
  await page.keyboard.press('Enter');
  await expect(focusedHeading('Decks')).toBeVisible();
  await tabTo(page.getByRole('button', { name: 'New deck' }).first());
  await page.keyboard.press('Enter');
  await tabTo(page.getByRole('textbox', { name: 'Deck name' }));
  await page.keyboard.type('Capitals');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Capitals', { exact: true })).toBeVisible();

  // Its cards: add one with Ctrl+Enter.
  await tabTo(page.getByRole('button', { name: 'Cards', exact: true }));
  await page.keyboard.press('Enter');
  await expect(focusedHeading('Capitals')).toBeVisible();
  await tabTo(page.getByRole('textbox', { name: 'Front' }));
  await page.keyboard.type('France');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Paris');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Paris', { exact: true })).toBeVisible();

  // Study: pick the deck, start, take a check-in, grade it, end.
  await tabTo(nav('Study'));
  await page.keyboard.press('Enter');
  await expect(focusedHeading('Study')).toBeVisible();
  const deckSelect = page.getByRole('combobox', { name: 'Deck' });
  await tabTo(deckSelect);
  if ((await deckSelect.inputValue()) === '') await page.keyboard.press('ArrowDown');
  await tabTo(page.getByRole('button', { name: 'Start session' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('Running', { exact: true })).toBeVisible();

  await waitForDebug(app!);
  await debug(app!, 'checkin');
  await tabTo(page.getByRole('button', { name: 'Show answer' }));
  await page.keyboard.press('Enter');
  await tabTo(page.getByRole('button', { name: 'Got it' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Got it' })).toBeHidden();

  await tabTo(page.getByRole('button', { name: 'End session' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();

  // Settings: change how far he may go with the arrow keys.
  await tabTo(nav('Settings'));
  await page.keyboard.press('Enter');
  await expect(focusedHeading('Settings')).toBeVisible();
  // Full dog is the default, so it is the radio Tab stops on.
  const cap = page.getByRole('radio', { name: /Full dog/ });
  await tabTo(cap);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('radio', { name: /Playful/ })).toBeChecked();
});

test('every page heading takes focus when you switch to it', async () => {
  seedOnboarded(userData);
  await open();
  for (const name of ['History', 'Settings', 'About', 'Decks', 'Study']) {
    await tabTo(nav(name));
    await page.keyboard.press('Enter');
    await expect(focusedHeading(name === 'About' ? 'About' : name)).toBeVisible();
  }
});

test('deleting the only card leaves focus on the cards heading', async () => {
  await seedDeck('France,Paris');
  await nav('Decks').click();
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(page.getByText('Paris', { exact: true })).toBeVisible();
  await tabTo(page.getByRole('button', { name: 'Delete France' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'No cards in this deck yet' })).toBeVisible();
  await expect(page.locator('#cards-title')).toBeFocused();
});

test('deleting a card moves focus to the next row', async () => {
  await seedDeck('France,Paris\nPeru,Lima');
  await nav('Decks').click();
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(page.getByText('Lima', { exact: true })).toBeVisible();
  await tabTo(page.getByRole('button', { name: 'Delete France' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('Paris', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit Peru' })).toBeFocused();
});

test('deleting the only deck leaves focus on the Decks heading', async () => {
  await seedDeck('France,Paris');
  await nav('Decks').click();
  await tabTo(page.getByRole('button', { name: 'Delete' }).first());
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'No decks yet' })).toBeVisible();
  await expect(page.locator('#decks-title')).toBeFocused();
});

const DIALOGS = [
  { name: 'the import dialog', page: 'Decks', opener: 'Import cards', dialog: 'Import cards', seed: true },
  { name: 'the restore dialog', page: 'Settings', opener: 'Import all…', dialog: 'Restore from a backup?', seed: false },
  { name: 'the reset dialog', page: 'Settings', opener: 'Reset everything…', dialog: 'Reset everything?', seed: false },
  { name: 'the diagnostics dialog', page: 'About', opener: 'Copy diagnostics…', dialog: 'Diagnostics', seed: false },
];

for (const d of DIALOGS) {
  test(`${d.name} holds focus, closes on Escape and hands focus back`, async () => {
    if (d.seed) await seedDeck('France,Paris');
    else {
      seedOnboarded(userData);
      await open();
    }
    await nav(d.page).click();
    const opener = page.getByRole('button', { name: d.opener }).first();
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: d.dialog });
    await expect(dialog).toBeVisible();

    for (let i = 0; i < 14; i++) {
      await page.keyboard.press(i % 2 === 0 ? 'Tab' : 'Shift+Tab');
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), `focus left the dialog after ${i + 1} presses`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
}

test('what you tab through on Settings shows a focus ring', async () => {
  seedOnboarded(userData);
  await open();
  await nav('Settings').click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const unringed: string[] = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const seen = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const ring = s.outlineStyle !== 'none' || (s.boxShadow !== '' && s.boxShadow !== 'none');
      return { ring, label: `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? ''}` };
    });
    if (seen && !seen.ring) unringed.push(seen.label);
  }
  expect(unringed, 'focused with no outline and no box-shadow').toEqual([]);
});
