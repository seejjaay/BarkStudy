import * as fs from 'node:fs';
import * as os from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { LibrarySnapshot } from '../../src/shared/control';
import { control, debug, launchControl, seedOnboarded, waitForDebug } from './helpers';

/** A file from Excel (BOM, CRLF, quoted commas and quotes, accents) goes in through the UI, comes back out, and goes in again unchanged. */

let app: ElectronApplication | null = null;
let page: Page;
let userData: string;

test.beforeEach(() => {
  userData = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-e2e-roundtrip-'));
});

test.afterEach(async () => {
  if (app) await app.close();
  app = null;
  fs.rmSync(userData, { recursive: true, force: true });
});

const nav = (name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name });
const toast = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text });

async function cardsOf(name: string): Promise<{ front: string; back: string }[]> {
  const snapshot = await control<LibrarySnapshot>(page, 'app:snapshot');
  const deck = snapshot.decks.find((d) => d.name === name);
  if (!deck) throw new Error(`no deck named ${name}`);
  const r = await control<{ ok: true; value: { front: string; back: string }[] }>(page, 'card:list', { deckId: deck.id });
  return r.value.map(({ front, back }) => ({ front, back }));
}

test('an Excel CSV imports, exports and re-imports with the same cards in the same order', async () => {
  const fixture = resolve('tests/fixtures/decks/excel-bom-crlf.csv');
  const exported = join(userData, 'Again.csv'); // a file import names the deck after the file
  seedOnboarded(userData);
  ({ app, page } = await launchControl(userData));
  await waitForDebug(app);
  await nav('Decks').click();

  await debug(app, 'setNextDialogPath', fixture);
  await page.getByRole('button', { name: 'Import cards' }).first().click();
  await page.getByRole('dialog', { name: 'Import cards' }).getByRole('button', { name: 'Choose a file…' }).click();
  // The header row and the row with no back are skipped, so the dialog stays open on its report.
  const report = page.getByRole('dialog', { name: 'Import finished' });
  await expect(report).toBeVisible();
  await expect(report).toContainText('4 cards');
  await report.getByRole('button', { name: 'Done' }).click();
  const original = await cardsOf('excel-bom-crlf');
  expect(original).toHaveLength(4);

  await debug(app, 'setNextDialogPath', exported);
  await page.getByRole('listitem').filter({ hasText: 'excel-bom-crlf' }).getByRole('button', { name: 'Export' }).click();
  await expect(toast('Exported')).toBeVisible();
  expect(fs.existsSync(exported)).toBe(true);

  await debug(app, 'setNextDialogPath', exported);
  await page.getByRole('button', { name: 'Import cards' }).first().click();
  await page.getByRole('dialog', { name: 'Import cards' }).getByRole('button', { name: 'Choose a file…' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Again' })).toBeVisible();

  expect(await cardsOf('Again')).toEqual(original);
});
