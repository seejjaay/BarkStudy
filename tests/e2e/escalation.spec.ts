import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// M4 acceptance: the escalation ladder, Esc, Leave it and the answer moods, watched through the debug surface with
// BARKSTUDY_FAST_TUNING (check-in, escalation and guilt timings 100x shorter; laps and dig-in keep their real length).

/**
 * The engine chooses at random between intents on offer (at level 2 re-ask, follow-cursor or whine; at level 3 laps or
 * whine), so the session seed is pinned: with this one an ignored card goes curious, pleading, laps, dig-in.
 */
const SEED = '14';
const CARDS: Record<string, string> = { France: 'Paris', Peru: 'Lima', Japan: 'Tokyo' };
const ANSWER_MOODS = ['happy', 'ecstatic', 'calm'];

type Mood = string;
interface MoodChange {
  mood: Mood;
  pose: string;
  effect: 'laps' | 'dig' | null;
}
interface SpeechLine {
  key: string;
  params?: Record<string, number>;
  id: number;
}

let app: ElectronApplication | null = null;
let userData: string;
let control: Page;

function debug<T>(method: string, ...args: unknown[]): Promise<T> {
  return app!.evaluate(
    (_electron, p: { method: string; args: unknown[] }) => {
      const d = (globalThis as unknown as { __barkDebug: Record<string, (...a: unknown[]) => unknown> }).__barkDebug;
      return d[p.method]!(...p.args);
    },
    { method, args },
  ) as Promise<T>;
}

const moodLog = () => debug<MoodChange[]>('moodLog');
const lastChange = async () => (await moodLog()).at(-1) ?? null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Launches with fast tuning and a pinned seed, makes a 3-card deck and sets the cap through the control page, hides the
 * control window (it could cover the test window's top edge), and puts a plain, focused test window in front.
 * The session is started from the control page once that window is the foreground one, so laps have a window to run round.
 */
async function startSession(cap: 3 | 4): Promise<void> {
  // VS Code sets ELECTRON_RUN_AS_NODE, which would make Electron behave as plain Node.
  const env = {
    ...process.env,
    BARKSTUDY_E2E: '1',
    BARKSTUDY_FAST_TUNING: '1',
    BARKSTUDY_SEED: SEED,
    BARKSTUDY_USER_DATA: userData,
  } as Record<string, string>;
  delete env['ELECTRON_RUN_AS_NODE'];
  app = await electron.launch({ args: ['.'], env });
  await expect
    .poll(() => app?.windows().some((w) => w.url().includes('control')) ?? false, { timeout: 20_000 })
    .toBe(true);
  control = app.windows().find((w) => w.url().includes('control'))!;
  await expect(control.getByRole('heading', { level: 1 })).toBeVisible();

  await debug('updateSettings', { soundOn: false, cap });
  const text = Object.entries(CARDS)
    .map(([front, back]) => `${front},${back}`)
    .join('\n');
  await control.evaluate(async (t) => {
    const r = await window.barkControl.call('deck:import-text', { deckId: null, name: 'Capitals', text: t });
    if (!r.ok) throw new Error('import failed');
  }, text);

  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('control')) w.hide();
    const win = new BrowserWindow({ x: 360, y: 260, width: 640, height: 420, show: false, title: 'e2e target' });
    void win.loadURL('data:text/html,<body style="background:%234fc3f7">e2e target</body>');
    win.show();
    win.focus();
    (globalThis as unknown as { __testWin: unknown }).__testWin = win;
  });
  await expect
    .poll(() => app!.evaluate(() => (globalThis as unknown as { __testWin: { isFocused(): boolean } }).__testWin.isFocused()), { timeout: 5000 })
    .toBe(true);
  await sleep(600); // the tracker polls the foreground window; give it a round or two

  await control.evaluate(async () => {
    const snap = await window.barkControl.call('app:snapshot', undefined);
    const deckId = snap.decks[0]!.id;
    const r = await window.barkControl.call('session:start', { deckId, topic: '', checkinMinMinutes: 5, checkinMaxMinutes: 15 });
    if (!r.ok) throw new Error('session did not start');
  });
}

/** The overlay showing the flashcard bubble. */
async function bubbleOverlay(): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const w of app!.windows().filter((x) => x.url().includes('overlay'))) {
        if (await w.locator('#bubble').isVisible()) {
          found = w;
          return true;
        }
      }
      return false;
    }, { timeout: 5000 })
    .toBe(true);
  return found!;
}

/** Answers the open card correctly, through the bubble. */
async function answerInBubble(overlay: Page): Promise<void> {
  const question = (await overlay.locator('#bubble').innerText()) ?? '';
  const front = Object.keys(CARDS).find((f) => question.includes(f));
  expect(front, `which card is this: ${question}`).toBeDefined();
  await overlay.locator('#bubble-input').fill(CARDS[front!]!);
  await overlay.keyboard.press('Enter');
  await expect(overlay.locator('#bubble-fb')).toContainText('Correct');
}

/** The moods in order, with repeats (pose-only changes) folded away. */
const moodsOf = (log: MoodChange[]): Mood[] => log.map((m) => m.mood).filter((m, i, all) => i === 0 || all[i - 1] !== m);

/** Whether `wanted` appears in `seen` in this order, not necessarily next to each other. */
function inOrder(seen: Mood[], wanted: Mood[]): boolean {
  let i = 0;
  for (const m of seen) if (m === wanted[i]) i++;
  return i === wanted.length;
}

const waitForLaps = () =>
  expect
    .poll(async () => (await lastChange())?.effect === 'laps' && (await debug<boolean>('escapeHeld')), { timeout: 15_000 })
    .toBe(true);

test.beforeEach(() => {
  userData = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-e2e-esc-'));
});

// Closing the app first means a failing test still exits in seconds, then the temp data goes.
test.afterEach(async () => {
  if (app) await app.close();
  app = null;
  fs.rmSync(userData, { recursive: true, force: true });
});

test('an ignored card climbs curious, pleading, zoomies, dig-in in order', async () => {
  await startSession(4);
  await debug('checkin');
  await expect
    .poll(async () => (await moodLog()).some((m) => m.effect === 'dig'), { timeout: 15_000 })
    .toBe(true);

  const log = await moodLog();
  expect(inOrder(moodsOf(log), ['curious', 'pleading', 'zoomies', 'dig'])).toBe(true);
  const lapsAt = log.findIndex((m) => m.effect === 'laps');
  const digAt = log.findIndex((m) => m.effect === 'dig');
  expect(lapsAt).toBeGreaterThanOrEqual(0);
  expect(digAt).toBeGreaterThan(lapsAt);
  // Each starts with its own mood and pose. (Under fast tuning the next ladder step, 1.2 s on, can change his mood while
  // the effect still runs; at real timings a step is over a minute away, longer than either effect.)
  expect(log[lapsAt]).toMatchObject({ mood: 'zoomies', pose: 'run' });
  expect(log[digAt]).toMatchObject({ mood: 'dig', pose: 'dig' });
  expect(log.filter((m) => m.effect !== null).every((m) => m.pose === (m.effect === 'laps' ? 'run' : 'dig'))).toBe(true);
});

test('at cap 3 there is never a dig-in', async () => {
  await startSession(3);
  await debug('checkin');
  await waitForLaps();
  // At cap 4 the dig-in would have come 1.2 s after laps; give it well over that, and the laps time to run out.
  await sleep(7000);
  const log = await moodLog();
  expect(log.some((m) => m.effect === 'dig' || m.mood === 'dig' || m.pose === 'dig')).toBe(false);
  expect(await debug<boolean>('escapeHeld')).toBe(false); // the laps ran their 6 s and let go of Esc
});

// Cap 3 for these two: the ladder stops at laps, so nothing can start a new effect once the test has ended this one.
test('Esc during laps ends the effect and releases Esc', async () => {
  await startSession(3);
  await debug('checkin');
  await waitForLaps();
  expect(await debug<boolean>('pressHotkey', 'Escape')).toBe(true);
  expect(await debug<boolean>('escapeHeld')).toBe(false);
  await expect.poll(async () => (await lastChange())?.effect ?? null, { timeout: 1000 }).toBeNull();
  expect(await debug<boolean>('pressHotkey', 'Escape')).toBe(false); // nothing holds Esc any more
  expect((await debug<{ phase: string; card: unknown }>('sessionView')).card).not.toBeNull(); // the card is still waiting
});

test('Leave it stops everything', async () => {
  await startSession(3);
  await debug('checkin');
  await waitForLaps();
  expect(await debug<boolean>('pressHotkey', 'Ctrl+Alt+L')).toBe(true);
  expect(await debug<{ paused: boolean }>('sessionView')).toMatchObject({ paused: true });
  expect(await debug<boolean>('escapeHeld')).toBe(false);
  await expect.poll(async () => (await lastChange())?.effect ?? null, { timeout: 1000 }).toBeNull();

  // Unpaused, the next step (1.2 s at cap) would plead or whine again. Paused, nothing new is felt or said for 2 s.
  // Pose-only changes with no mood stay in: by design he falls off the frame after laps and goes back to roaming.
  const before = await moodLog();
  const speechBefore = (await debug<SpeechLine[]>('speechLog')).length;
  await sleep(2000);
  const fresh = (await moodLog()).slice(before.length);
  expect(fresh.filter((m) => m.mood !== 'idle' || m.effect !== null)).toEqual([]);
  expect((await debug<SpeechLine[]>('speechLog')).length).toBe(speechBefore);
  expect(await debug<boolean>('escapeHeld')).toBe(false);
});

test('a slow answer gives the answer mood, then sulk, and a guilt line shows', async () => {
  await startSession(4);
  await debug('checkin');
  const overlay = await bubbleOverlay();
  await sleep(1500); // past the 1.2 s guilt threshold that fast tuning leaves
  const answeredFrom = (await moodLog()).length;
  await answerInBubble(overlay);

  await expect
    .poll(async () => {
      const moods = moodsOf((await moodLog()).slice(answeredFrom));
      const i = moods.findIndex((m) => ANSWER_MOODS.includes(m));
      return i >= 0 && moods[i + 1] === 'sulk';
    }, { timeout: 6000 })
    .toBe(true);

  const guilt = (await debug<SpeechLine[]>('speechLog')).find((l) => l.key.startsWith('line.guilt.'));
  expect(guilt, 'a guilt line was said').toBeDefined();
  expect(typeof guilt!.params?.['minutes']).toBe('number');
  // The bubble is still open with its verdict, so the words are in its eyebrow; with it closed they would be in the balloon.
  const shown = async () => `${await overlay.locator('#bubble-eyebrow').innerText()} ${await overlay.locator('#speech').innerText()}`;
  await expect.poll(shown).toMatch(/\d+ minutes/);
  expect(await shown()).not.toContain('{minutes}');
});

test('a quick correct answer has no sulk', async () => {
  await startSession(4);
  await debug('checkin');
  const overlay = await bubbleOverlay();
  const answeredFrom = (await moodLog()).length;
  await answerInBubble(overlay);

  await expect
    .poll(async () => moodsOf((await moodLog()).slice(answeredFrom)).some((m) => m === 'happy' || m === 'ecstatic'), { timeout: 3000 })
    .toBe(true);
  await sleep(2500); // past the 1.5 s a sulk would wait for
  expect(moodsOf((await moodLog()).slice(answeredFrom))).not.toContain('sulk');
  expect((await debug<SpeechLine[]>('speechLog')).some((l) => l.key.startsWith('line.guilt.'))).toBe(false);
});
