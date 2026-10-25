import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

let app: ElectronApplication | null = null;
let userData: string;
let page: Page;

async function launch(): Promise<void> {
  // VS Code sets ELECTRON_RUN_AS_NODE, which would make Electron behave as plain Node.
  const env = { ...process.env, BARKSTUDY_E2E: '1', BARKSTUDY_USER_DATA: userData } as Record<string, string>;
  delete env['ELECTRON_RUN_AS_NODE'];
  app = await electron.launch({ args: ['.'], env });
  // The overlays are windows too; the control window is the one that loaded the control page.
  await expect
    .poll(() => app?.windows().some((w) => w.url().includes('control')) ?? false, { timeout: 20_000 })
    .toBe(true);
  page = app.windows().find((w) => w.url().includes('control'))!;
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function quit(): Promise<void> {
  if (app) await app.close();
  app = null;
}

function debug<T>(method: string, ...args: unknown[]): Promise<T> {
  return app!.evaluate(
    (_electron, p: { method: string; args: unknown[] }) => {
      const d = (globalThis as unknown as { __barkDebug: Record<string, (...a: unknown[]) => unknown> }).__barkDebug;
      return d[p.method]!(...p.args);
    },
    { method, args },
  ) as Promise<T>;
}

test.beforeEach(async () => {
  userData = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-e2e-ui-'));
  await launch();
});

// Closing the app first means a failing test still exits in seconds, then the temp data goes.
test.afterEach(async () => {
  await quit();
  fs.rmSync(userData, { recursive: true, force: true });
});

const nav = (name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name });
const toast = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text });

async function newDeckByPaste(name: string, text: string): Promise<void> {
  await nav('Decks').click();
  await page.getByRole('button', { name: 'Import cards…' }).first().click();
  await page.getByLabel('Deck name').fill(name);
  await page.getByLabel('Paste cards').fill(text);
  await page.getByRole('button', { name: 'Import pasted text' }).click();
}

test('a new user sees what to do next, and Start says why it is off', async () => {
  await expect(page.getByRole('heading', { name: 'Nothing to study yet' })).toBeVisible();
  await expect(page.getByText('Start is off: create or import a deck first.')).toBeVisible();
  await nav('Decks').click();
  await expect(page.getByRole('heading', { name: 'No decks yet' })).toBeVisible();
  await nav('History').click();
  await expect(page.getByRole('heading', { name: 'No sessions yet' })).toBeVisible();
});

test('creating a deck confirms with a toast and refuses a duplicate name', async () => {
  await nav('Decks').click();
  await page.getByRole('button', { name: 'New deck' }).first().click();
  await page.getByLabel('Deck name').fill('Spanish');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(toast('Created the deck “Spanish”.')).toBeVisible();
  await expect(page.locator('.rows .row').getByText('0 cards')).toBeVisible();

  await page.getByRole('button', { name: 'New deck' }).click();
  await page.getByLabel('Deck name').fill(' spanish ');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already have a deck with that name' })).toBeVisible();
});

test('pasted cards become a deck, and a repeat import reports duplicates and skipped rows', async () => {
  await newDeckByPaste('French', 'bonjour,hello\nmerci,thank you');
  await expect(toast('Added 2 cards to French.')).toBeVisible();
  await expect(page.locator('.rows .row').getByText('2 cards')).toBeVisible();

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByLabel('Paste cards').fill('bonjour,hello\nsalut,hi\nthis line has no separator');
  await page.getByRole('button', { name: 'Import pasted text' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import finished' });
  await expect(dialog).toContainText('Added 1 card to French.');
  await expect(dialog).toContainText('1 row matched cards already in the deck');
  await expect(dialog.getByRole('row', { name: /3\s+No comma, tab or semicolon/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.rows .row').getByText('3 cards')).toBeVisible();
});

test('text with no usable rows says why, row by row, and creates nothing', async () => {
  await newDeckByPaste('Broken', 'no separator here\nnor here');
  const dialog = page.getByRole('dialog', { name: 'Import cards' });
  await expect(dialog.getByRole('alert')).toContainText('No row could be read as a card.');
  await expect(dialog.getByRole('row')).toHaveCount(3); // header + 2 skipped lines
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'No decks yet' })).toBeVisible();
});

test('the import dialog traps focus, closes on Escape and gives focus back', async () => {
  await nav('Decks').click();
  const opener = page.getByRole('button', { name: 'Import cards…' }).first();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Import cards' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('deleting a deck can be undone, and the cards come back with it', async () => {
  await newDeckByPaste('Capitals', 'France,Paris\nPeru,Lima');
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(toast('Deleted “Capitals” (2 cards).')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No decks yet' })).toBeVisible();
  await toast('Deleted').getByRole('button', { name: 'Undo' }).click();
  await expect(toast('Restored “Capitals”.')).toBeVisible();
  await expect(page.locator('.rows .row').getByText('2 cards')).toBeVisible();
});

test('a full session: start, a card appears, answer it, end, and it is in the history', async () => {
  await newDeckByPaste('Capitals', 'France,Paris\nPeru,Lima');

  await nav('Study').click();
  await page.getByLabel('Topic').fill('Week 3');
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(toast('Session started.')).toBeVisible();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();

  await debug('checkin');
  await expect(page.getByText('Pandesal asks')).toBeVisible();
  await expect(page.getByText('France')).toBeVisible();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByText('Paris')).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(toast('Nice. Pandesal got a treat.')).toBeVisible();
  await expect(page.getByText('Answered').locator('xpath=following-sibling::dd')).toHaveText('1');

  await page.getByRole('button', { name: 'Leave it (pause)' }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('button', { name: 'Stay 25 min' }).click();
  await expect(page.getByText('Staying', { exact: true })).toBeVisible();
  await expect(page.getByText(/2[45]:\d\d left/)).toBeVisible();

  await nav('Decks').click();
  await expect(page.getByText('in use by the running session')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await expect(page.getByText('Studying Capitals — Staying')).toBeVisible();
  await page.getByRole('button', { name: 'Back to the session' }).click();

  await page.getByRole('button', { name: 'End session' }).click();
  await expect(toast('Session saved to your history.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();

  await nav('History').click();
  const row = page.getByRole('row').filter({ hasText: 'Week 3' });
  await expect(row).toContainText('Capitals');
  await expect(row.getByRole('cell').nth(4)).toHaveText('1');
});

test('decks, reviews and history survive a restart', async () => {
  await newDeckByPaste('Persisted', 'a,b\nc,d');
  await nav('Study').click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await debug('checkin');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(toast('Nice.')).toBeVisible();
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();

  await quit();
  await launch();
  await nav('Decks').click();
  await expect(page.getByText('Persisted')).toBeVisible();
  await expect(page.locator('.rows .row').getByText('2 cards')).toBeVisible();
  await nav('History').click();
  await expect(page.getByRole('row').filter({ hasText: 'Persisted' })).toBeVisible();

  const saved = JSON.parse(fs.readFileSync(join(userData, 'data', 'decks.json'), 'utf8')) as {
    schemaVersion: number;
    data: { decks: { cards: { fsrs: { reps: number } }[] }[] };
  };
  expect(saved.schemaVersion).toBe(1);
  expect(saved.data.decks[0]?.cards.some((c) => c.fsrs.reps === 1)).toBe(true);
});

test('quitting mid-session still saves the session', async () => {
  await newDeckByPaste('Quit', 'a,b');
  await nav('Study').click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await quit();
  const history = JSON.parse(fs.readFileSync(join(userData, 'data', 'history.json'), 'utf8')) as { data: { sessions: unknown[] } };
  expect(history.data.sessions).toHaveLength(1);
  await launch();
  await nav('History').click();
  await expect(page.getByRole('row').filter({ hasText: 'Quit' })).toBeVisible();
});

test('cards can be added, edited, searched, deleted with undo, and are read-only while a session uses the deck', async () => {
  await newDeckByPaste('Animals', 'chat,cat\nchien,dog');
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Animals' })).toBeFocused();

  await page.getByLabel('Front', { exact: true }).fill('oiseau');
  await page.getByLabel('Back', { exact: true }).fill('bird');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(toast('Added “oiseau”.')).toBeVisible();
  await expect(page.getByText('3 cards', { exact: true })).toBeVisible();

  await page.getByLabel('Front', { exact: true }).fill(' CHAT ');
  await page.getByLabel('Back', { exact: true }).fill('cat');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already has a card with the same front and back' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit chat' }).click();
  await page.getByLabel('Front', { exact: true }).last().fill('le chat');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(toast('Card saved.')).toBeVisible();
  await expect(page.getByText('le chat')).toBeVisible();

  await page.getByLabel('Search cards').fill('DOG');
  await expect(page.getByText('1 card match')).toBeVisible();
  await expect(page.getByText('le chat')).toBeHidden();
  await page.getByLabel('Search cards').fill('zebra');
  await expect(page.getByRole('heading', { name: 'No cards match “zebra”' })).toBeVisible();
  await page.getByLabel('Search cards').fill('');

  await page.getByRole('button', { name: 'Delete chien' }).click();
  await expect(toast('Deleted “chien”.')).toBeVisible();
  await expect(page.getByText('2 cards', { exact: true })).toBeVisible();
  await toast('Deleted').getByRole('button', { name: 'Undo' }).click();
  await expect(toast('Restored “chien”.')).toBeVisible();
  await expect(page.getByText('chien', { exact: true })).toBeVisible();

  await nav('Study').click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await nav('Decks').click();
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(page.getByText('A session is using this deck')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add card' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Edit chien' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete chien' })).toBeDisabled();
});

const overlay = () => app!.windows().find((w) => w.url().includes('overlay'))!;

test('the bubble: type an answer, Esc hides it without answering, the chip brings it back, show-answer and self-grade work', async () => {
  await newDeckByPaste('Capitals', 'France,Paris\nPeru,Lima\nJapan,Tokyo');
  await nav('Study').click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  expect(await debug<boolean>('bubbleHotkeyRegistered')).toBe(false); // nothing is waiting, so Ctrl+Alt+A belongs to everyone else

  // A typed answer, loosely matched.
  await debug('checkin');
  const bubble = overlay().locator('#bubble');
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('France');
  expect(await debug<boolean>('bubbleHotkeyRegistered')).toBe(true);
  expect(await overlay().locator('body').innerText()).not.toContain('Paris'); // the answer is not in the overlay until it is shown
  await overlay().locator('#bubble-input').fill('  PARIS ');
  await overlay().keyboard.press('Enter');
  await expect(overlay().locator('#bubble-fb')).toHaveText('Correct! Pandesal got a treat.');
  await expect(overlay().locator('#bubble-fb')).toHaveAttribute('data-tone', 'right');
  await expect(page.getByText('Answered').locator('xpath=following-sibling::dd')).toHaveText('1');
  await expect(page.getByText('Treats').locator('xpath=following-sibling::dd')).toHaveText('1');
  expect(await debug<boolean>('bubbleHotkeyRegistered')).toBe(false);
  await overlay().keyboard.press('Enter'); // dismisses the verdict early
  await expect(bubble).toBeHidden();

  // Esc dismisses without answering; the question stays pending and comes back from the chip.
  await debug('checkin');
  await expect(bubble).toContainText('Peru');
  await overlay().keyboard.press('Escape');
  await expect(bubble).toBeHidden();
  await expect(overlay().locator('#bubble-chip')).toBeVisible();
  expect(await debug<{ open: boolean } | null>('bubbleState')).toMatchObject({ open: false });
  expect(await debug<boolean>('bubbleHotkeyRegistered')).toBe(true);
  await expect(page.getByText('Answered').locator('xpath=following-sibling::dd')).toHaveText('1');
  await overlay().locator('#bubble-chip').click();
  await expect(bubble).toContainText('Peru');

  // A wrong answer is still an answer: it ends the question, shows the right answer, and earns no treat.
  await overlay().locator('#bubble-input').fill('Cusco');
  await overlay().getByRole('button', { name: 'Check' }).click();
  await expect(overlay().locator('#bubble-fb')).toHaveText('Not quite. It is “Lima”.');
  await expect(page.getByText('Answered').locator('xpath=following-sibling::dd')).toHaveText('2');
  await expect(page.getByText('Treats').locator('xpath=following-sibling::dd')).toHaveText('1');

  // Show answer, then self-grade.
  await overlay().keyboard.press('Escape');
  await debug('checkin');
  await expect(bubble).toContainText('Japan');
  await overlay().getByRole('button', { name: 'Show answer' }).click();
  await expect(overlay().locator('#bubble-a')).toHaveText('Tokyo');
  await overlay().getByRole('button', { name: 'Got it' }).click();
  await expect(overlay().locator('#bubble-fb')).toContainText('Nice, you got it.');
  await expect(page.getByText('Treats').locator('xpath=following-sibling::dd')).toHaveText('2');
  expect(await debug('bubbleState')).toBeNull();
});

test('a blank answer is not submitted, and an answer given in the control window closes the bubble', async () => {
  await newDeckByPaste('Capitals', 'France,Paris');
  await nav('Study').click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await debug('checkin');
  const bubble = overlay().locator('#bubble');
  await expect(bubble).toBeVisible();
  await overlay().locator('#bubble-input').fill('   ');
  await overlay().keyboard.press('Enter');
  await expect(bubble).toContainText('France');
  await expect(page.getByText('Answered').locator('xpath=following-sibling::dd')).toHaveText('0');

  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(bubble).toBeHidden();
});

/** What main will broadcast: a line key (never text) to every overlay. */
const saySpeech = (line: { key: string; params?: Record<string, number>; id: number }) =>
  app!.evaluate(({ BrowserWindow }, l) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('overlay')) w.webContents.send('speech:say', l);
  }, line);

test('his words go in the eyebrow of an open bubble or in a balloon, last about 4 s, and are hidden from screen readers', async () => {
  await newDeckByPaste('Capitals', 'France,Paris');
  await nav('Study').click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await debug('checkin');
  const bubble = overlay().locator('#bubble');
  const eyebrow = overlay().locator('#bubble-eyebrow');
  const balloon = overlay().locator('#speech');
  await expect(bubble).toBeVisible();
  await expect(eyebrow).toHaveText('Pandesal asks');
  await expect(balloon).toBeHidden();

  // The bubble is open: the words replace the eyebrow, and there is no balloon.
  await saySpeech({ key: 'line.guilt.1', params: { minutes: 6 }, id: 1 });
  await expect(eyebrow).toContainText('6 minutes');
  await expect(eyebrow).toHaveAttribute('aria-hidden', 'true');
  await expect(balloon).toBeHidden();

  // The bubble is hidden (a chip is left): a balloon shows, above the chip, and the mouse can go through it.
  await overlay().keyboard.press('Escape');
  await expect(bubble).toBeHidden();
  const chip = overlay().locator('#bubble-chip');
  await expect(chip).toBeVisible();
  await saySpeech({ key: 'line.celebrateSmall.1', id: 2 });
  await expect(balloon).toBeVisible();
  await expect(balloon).toHaveAttribute('aria-hidden', 'true');
  await expect(balloon).toHaveCSS('pointer-events', 'none');
  const [b, c] = [await balloon.boundingBox(), await chip.boundingBox()];
  expect(b!.y + b!.height).toBeLessThanOrEqual(c!.y);

  // A key with no text says nothing, and the line expires by itself.
  await saySpeech({ key: 'line.nope.1', id: 3 });
  await expect(balloon).toBeHidden({ timeout: 8000 });
  await chip.click();
  await expect(bubble).toBeVisible();
  await expect(eyebrow).toHaveText('Pandesal asks');
  expect(await eyebrow.getAttribute('aria-hidden')).toBeNull();
});

type Spec = { id?: string; label: string; enabled?: boolean; submenu?: Spec[]; hint?: string; kind?: string; checked?: boolean };
const flatSpec = (items: Spec[]): Spec[] => items.flatMap((i) => [i, ...(i.submenu ? flatSpec(i.submenu) : [])]);
const trayLabels = async () => flatSpec(await debug<Spec[]>('trayMenu')).map((i) => i.label);
const trayIds = async () => flatSpec(await debug<Spec[]>('trayMenu')).flatMap((i) => (i.id ? [i.id] : []));

test('the tray menu follows the app: it starts a session, pauses, stays, and ends it', async () => {
  expect(await trayLabels()).toContain('Start session (add a deck with cards first)');
  expect(await trayLabels()).toContain('No session running');

  await newDeckByPaste('Capitals', 'France,Paris\nPeru,Lima');
  await expect.poll(trayLabels).toContain('Start session');
  expect(await trayLabels()).toContain('Capitals (2 cards)');
  const startId = (await trayIds()).find((id) => id.startsWith('start:'))!;

  await debug('trayRun', startId);
  await expect(page.getByText('Studying Capitals — Running')).toBeVisible(); // the strip shows on every tab but Study
  await nav('Study').click();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await expect.poll(trayLabels).toContain('Studying Capitals');
  expect(await trayIds()).toEqual(['pause', 'stay-on:15', 'stay-on:25', 'stay-on:50', 'end', 'sound:off', 'volume:0.4', 'volume:0.65', 'volume:0.9', 'open', 'quit']);

  await debug('trayRun', 'pause');
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  expect((await debug<Spec[]>('trayMenu')).find((i) => i.id === 'resume')).toMatchObject({ label: 'Resume', hint: 'Ctrl+Alt+L' });
  await debug('trayRun', 'resume');
  await debug('trayRun', 'stay-on:15');
  await expect(page.getByText('Staying', { exact: true })).toBeVisible();
  await expect.poll(trayIds).toContain('stay-off');
  await debug('trayRun', 'stay-off');
  await expect(page.getByText('Running', { exact: true })).toBeVisible();

  await debug('trayRun', 'bogus-id'); // anything that is not one of ours is ignored
  await debug('trayRun', 'stay-on:7');
  await expect(page.getByText('Running', { exact: true })).toBeVisible();

  await debug('trayRun', 'end');
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
  await expect.poll(trayLabels).toContain('Start session');
  await nav('History').click();
  await expect(page.getByRole('row').filter({ hasText: 'Capitals' })).toBeVisible();
});

test('Sounds and Volume in the tray are saved, show what is set, and are still set after a restart', async () => {
  const sounds = async () => (await debug<Spec[]>('trayMenu')).find((i) => i.label === 'Sounds');
  const volumes = async () => (await debug<Spec[]>('trayMenu')).find((i) => i.label === 'Volume')?.submenu?.map((i) => [i.label, i.checked]);
  expect(await sounds()).toMatchObject({ id: 'sound:off', kind: 'checkbox', checked: true }); // on by default
  expect(await volumes()).toEqual([['Low', true], ['Medium', false], ['High', false]]);

  await debug('trayRun', 'sound:off');
  await debug('trayRun', 'volume:0.9');
  // A click is carried out a moment later (the settings are written first), so each is waited for.
  await expect.poll(sounds).toMatchObject({ id: 'sound:on', checked: false });
  await expect.poll(volumes).toEqual([['Low', false], ['Medium', false], ['High', true]]);
  await debug('trayRun', 'volume:0.5'); // not one of the three: ignored
  expect(await volumes()).toEqual([['Low', false], ['Medium', false], ['High', true]]);

  await quit();
  await launch();
  expect(await sounds()).toMatchObject({ id: 'sound:on', checked: false });
  expect(await volumes()).toEqual([['Low', false], ['Medium', false], ['High', true]]);
});

interface AudioLog {
  contexts: number;
  started: number;
  stopped: number;
  loops: number;
}

/** Counts what the overlay's Web Audio is asked to do, without changing it. */
const watchAudio = () =>
  overlay().evaluate(() => {
    const log: AudioLog = { contexts: 0, started: 0, stopped: 0, loops: 0 };
    (window as unknown as { __audio: AudioLog }).__audio = log;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor() {
        super();
        log.contexts++;
        (window as unknown as { __audioCtx: AudioContext }).__audioCtx = this;
      }
    };
    // The originals are called back with their own `this`. A buffer source has its own start (it takes an offset too).
    const wrap = (target: object, name: 'start' | 'stop', onCall: (self: { loop?: boolean }) => void) => {
      const original = Reflect.get(target, name) as (...args: unknown[]) => void;
      Reflect.set(target, name, function (this: { loop?: boolean }, ...args: unknown[]) {
        onCall(this);
        original.apply(this, args);
      });
    };
    const onStart = (self: { loop?: boolean }) => {
      log.started++;
      if (self.loop === true) log.loops++;
    };
    wrap(AudioScheduledSourceNode.prototype, 'start', onStart);
    if (Object.hasOwn(AudioBufferSourceNode.prototype, 'start')) wrap(AudioBufferSourceNode.prototype, 'start', onStart);
    wrap(AudioScheduledSourceNode.prototype, 'stop', () => log.stopped++);
  });
const audioLog = () => overlay().evaluate(() => (window as unknown as { __audio: AudioLog }).__audio);
const audioState = () => overlay().evaluate(() => (window as unknown as { __audioCtx?: AudioContext }).__audioCtx?.state);

/** What main will broadcast: a sound name and volume to every overlay. `withoutHim` first tells the overlay it has no dog, as one on another display would. */
const sendSound = (cue: { name: string; volume: number }, withoutHim = false) =>
  app!.evaluate(
    ({ BrowserWindow }, c) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.webContents.getURL().includes('overlay')) continue;
        if (c.withoutHim) w.webContents.send('overlay:frame', null);
        w.webContents.send('sound:play', { name: c.name, volume: c.volume });
      }
    },
    { ...cue, withoutHim },
  );

test('a sound is played through Web Audio by the overlay that has him, one context for all of them, and by no overlay that does not', async () => {
  await newDeckByPaste('Capitals', 'France,Paris');
  await nav('Study').click();
  await page.getByRole('button', { name: 'Start session' }).click();
  // The balloon shows only on an overlay that holds a frame of him, so seeing it means this overlay has him.
  await saySpeech({ key: 'line.celebrateSmall.1', id: 1 });
  await expect(overlay().locator('#speech')).toBeVisible();
  await watchAudio();
  expect(await audioLog()).toEqual({ contexts: 0, started: 0, stopped: 0, loops: 0 }); // nothing is made until the first sound

  await sendSound({ name: 'bark', volume: 0.4 });
  await expect.poll(async () => (await audioLog()).started).toBeGreaterThan(0);
  const first = await audioLog();
  expect(first).toMatchObject({ contexts: 1, loops: 0 });
  expect(first.stopped).toBe(first.started); // every piece is given a hard stop
  await expect.poll(audioState).toBe('running'); // the overlay's autoplay policy lets it start without a click

  await sendSound({ name: 'yip', volume: 0.4 });
  await expect.poll(async () => (await audioLog()).started).toBeGreaterThan(first.started);
  expect((await audioLog()).contexts).toBe(1);

  const before = await audioLog();
  await sendSound({ name: 'whine', volume: 0.4 }, true);
  await overlay().evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
  expect(await audioLog()).toEqual(before);
});

test('a Leave it shortcut that another app owns shows a banner and a tray note, and clears when it is freed', async () => {
  expect(await debug('leaveIt')).toEqual({ accelerator: 'Ctrl+Alt+L', conflict: false });
  await expect(page.getByText('is used by another app')).toBeHidden();

  await debug('leaveItReregister', 'Ctrl+Alt+K'); // let go of Ctrl+Alt+L
  const foreign = await app!.evaluate(({ globalShortcut }) => globalShortcut.register('Ctrl+Alt+L', () => undefined));
  expect(foreign).toBe(true); // another app now owns it
  expect(await debug<boolean>('leaveItReregister', 'Ctrl+Alt+L')).toBe(false);

  await expect(page.getByText('Ctrl+Alt+L is used by another app')).toBeVisible();
  expect(await debug('leaveIt')).toEqual({ accelerator: 'Ctrl+Alt+L', conflict: true });
  await expect.poll(trayLabels).toContain('Ctrl+Alt+L is used by another app, so Leave it works from this menu only.');

  await app!.evaluate(({ globalShortcut }) => globalShortcut.unregister('Ctrl+Alt+L'));
  expect(await debug<boolean>('leaveItReregister', 'Ctrl+Alt+L')).toBe(true);
  await expect(page.getByText('is used by another app')).toBeHidden();
  expect(await debug('leaveIt')).toEqual({ accelerator: 'Ctrl+Alt+L', conflict: false });
});
