import type { EngineLog } from '../engine/replay';
import { DEFAULT_TUNING } from '../engine/tuning';
import type { Tuning } from '../engine/types';
import type { BubbleState, RevealResult, SelfGrade, SubmitResult } from '../shared/bubble';
import type { AppError, Result, SessionAction, SessionView, StartRequest, ViewCard } from '../shared/control';
import type { SpeechLine } from '../shared/ipc';
import { matchAnswer, type Match } from '../shared/matching';
import type { Card } from '../shared/model';
import { moodFromExpression } from '../shared/mood';
import { soundFor, type SoundName } from '../shared/sounds';
import type { Grade } from '../shared/srs';
import { createEngineHost, type CardPrompt, type EngineHost, type ExternalEvent, type HostSink } from './engineHost';
import type { Clock, DogAction } from './dogHost';
import type { Library } from './library';
import { MAX_INTERVAL_MINUTES } from '../shared/settings';
import { createSoundGate } from './soundGate';
import { createSpeechGate } from './speechGate';

/**
 * One study session as the control window sees it: starts it from a deck, feeds answers and controls to the engine
 * host, saves each review as it happens, records the finished session in the history, and publishes a plain view of
 * all of it whenever that view changes. It is also the one place the engine's actions fan out to the presentation:
 * the dog, the global Esc key, speech (through the speech gate) and sound (through the sound gate). No Electron in here.
 */

export const VIEW_REFRESH_MS = 1000;
/** What the engine's personality layer sets for its "re-ask" intent (see EXPRESSION in engine/personality.ts). */
export const RE_ASK_EXPRESSION = 'pleading';
export const MAX_TOPIC = 80;
/** e2e only: how much fast tuning shrinks the check-in, escalation and guilt timings. Effect lengths stay real. */
export const FAST_TUNING_FACTOR = 100;
const STAY_MINUTES: readonly number[] = [15, 25, 50];

/** Where the engine's actions are played out. Any part may be left out; tests leave out what they do not watch. */
export interface SessionPresentation {
  dog?: { perform(a: DogAction): void; setMood(name: string): void; sulkAfter(): void; setStay(on: boolean): void; wake(): void };
  escape?: { effectStarted(maxMs: number): void; effectEnded(): void };
  speech?: (line: SpeechLine) => void;
  sound?: (name: SoundName, volume: number) => void;
}

export interface SessionControllerOptions {
  library: Library;
  seed: number;
  publish: (view: SessionView) => void;
  /** The bubble beside Pandesal: the question while one is pending, null otherwise. Sent only when it changes. */
  publishBubble?: (state: BubbleState | null) => void;
  presentation?: SessionPresentation;
  /** e2e only: shrink the check-in, escalation and guilt timings FAST_TUNING_FACTOR times so a test can watch the ladder. */
  fastTuning?: boolean;
  clock?: Clock;
}

export interface SessionController {
  start: (req: StartRequest) => Result<SessionView>;
  end: () => Promise<Result<SessionView>>;
  answer: (grade: Grade) => Result<void>;
  control: (action: SessionAction) => Result<void>;
  /** Leaves the end-of-session summary and returns to idle. */
  dismissSummary: () => void;
  view: () => SessionView;
  bubbleState: () => BubbleState | null;
  /** Esc: hides the bubble. The card stays pending and unanswered. */
  dismissBubble: () => void;
  /** A click on Pandesal or the hotkey. Does nothing if no card is up. */
  openBubble: () => void;
  /** A typed answer, matched here so the expected answer never leaves main until it is shown. Blank text is not an answer. */
  submitText: (text: string) => SubmitResult;
  revealAnswer: () => RevealResult;
  /** After "Show answer": Got it or Missed it. False if there is no card. */
  selfGrade: (grade: SelfGrade) => boolean;
  /** The deck a running session is drawing from, or null. */
  activeDeckId: () => string | null;
  /** Idle, away and suppression changes, and anything else the engine takes from outside. */
  dispatch: (e: ExternalEvent) => void;
  /** The dog could not play or keep his effect (its window went away): it ends as Esc would end it, keeping the level. */
  effectLost: () => void;
  setBusy: (busy: boolean) => void;
  setActiveWindow: (id: number | null) => void;
  /** The engine log of the running session, or of the last one; null before any session. For the diagnostics bundle. */
  diagnostics: () => EngineLog | null;
  /** Resolves when every review save started so far has finished (also before quitting). */
  settled: () => Promise<void>;
  dispose: () => void;
}

const defaultClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const fail = (code: AppError['code'], message: string): { ok: false; error: AppError } => ({ ok: false, error: { code, message } });
const good = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

interface Active {
  deckId: string;
  deckName: string;
  topic: string;
  startedAt: number;
}

export function createSessionController(opts: SessionControllerOptions): SessionController {
  const clock = opts.clock ?? defaultClock;
  const { library } = opts;
  const show: SessionPresentation = opts.presentation ?? {};
  const speechGate = createSpeechGate(clock);
  const soundGate = createSoundGate(clock);

  let active: Active | null = null;
  let ended: Extract<SessionView, { phase: 'ended' }> | null = null;
  let card: ViewCard | null = null;
  let bubbleOpen = true;
  let saveProblem = false;
  let lastPublished = '';
  let lastBubble = '';
  let refreshHandle: unknown = null;
  const pending = new Set<Promise<unknown>>();
  /** The effect the presentation was last told is running. */
  let effect: 'laps' | 'dig' | null = null;
  /** Whether the dog was last told he is on a Stay. */
  let dogStay = false;
  let lineId = 0;

  /** Suppressed, paused, on a Stay or away: he makes no sound, and does not push the card back up. */
  function quiet(): boolean {
    const s = host.status();
    return s.paused || s.stay || s.suppressed || s.activity !== 'active';
  }

  function play(name: SoundName | null): void {
    if (name === null || !host.running || !show.sound) return;
    const { soundOn, volume } = library.getSettings();
    if (soundGate.pass(name, { soundOn, volume, quiet: quiet() })) show.sound(name, volume);
  }

  /** Lets go of Esc and forgets the effect, whatever the engine said: nothing may hold Esc past the session. */
  function forgetEffect(): void {
    effect = null;
    show.escape?.effectEnded();
  }

  const sink: HostSink = {
    showCard: (c: CardPrompt) => {
      card = { id: c.id, front: c.front, back: c.back };
      bubbleOpen = true; // asking again (or the first time) always brings the bubble back
      publish();
    },
    hideCard: () => {
      card = null;
      publish();
    },
    say: (key, params) => {
      // Params go through untouched: the guilt lines need their {minutes}.
      if (!host.running || !show.speech || !speechGate.pass(key)) return;
      lineId += 1;
      show.speech(params ? { key, params, id: lineId } : { key, id: lineId });
    },
    expression: (name) => {
      // The engine's "re-ask" intent asks again by pleading; it is the only intent that does. A dismissed bubble comes back.
      if (name === RE_ASK_EXPRESSION && card && !bubbleOpen) {
        bubbleOpen = true;
        publish();
      }
      show.dog?.setMood(name);
      play(soundFor({ kind: 'mood', mood: moodFromExpression(name) }));
    },
    walkTo: (id) => show.dog?.perform({ type: 'WALK_TO', windowId: id }),
    effect: (a) => {
      show.dog?.perform(a);
      if (a.type === 'RUN_LAPS' || a.type === 'START_DIG_IN') {
        effect = a.type === 'RUN_LAPS' ? 'laps' : 'dig';
        // The real maximum even under fast tuning, which never shortens an effect.
        show.escape?.effectStarted(effect === 'laps' ? DEFAULT_TUNING.lapsMaxMs : DEFAULT_TUNING.digInMaxMs);
        play(soundFor({ kind: 'effect', effect }));
      } else if (a.type === 'END_EFFECT') {
        const was = effect;
        forgetEffect();
        // He pops up with the card: a dig that ends with it still pending brings the bubble back, unless something is
        // holding prompts back (Leave it, a Stay, suppression, away). An answer has already taken the card down here.
        if (was === 'dig' && host.status().cardUp && !quiet()) openBubble();
      }
    },
    treat: () => undefined,
    // The engine routes the answer's own expression first, so the dog keeps that mood a moment before he sulks.
    guiltTrip: () => show.dog?.sulkAfter(),
  };

  const host: EngineHost = createEngineHost({
    seed: opts.seed,
    sink,
    clock,
    onReviewed: (reviewed: Card) => {
      const deckId = active?.deckId;
      if (deckId === undefined) return;
      const save = library
        .updateCard(deckId, reviewed)
        .then((r) => {
          if (!r.ok) saveProblem = true;
        })
        .finally(() => {
          pending.delete(save);
          publish();
        });
      pending.add(save);
    },
  });

  function buildView(): SessionView {
    if (active && host.running) {
      const s = host.status();
      return {
        phase: 'running',
        deckId: active.deckId,
        deckName: active.deckName,
        topic: active.topic,
        startedAt: active.startedAt,
        paused: s.paused,
        stay: s.stay,
        stayLeftMs: s.stayLeftMs,
        away: s.activity !== 'active',
        suppressed: s.suppressed,
        card,
        answered: s.answered,
        treats: s.treats,
        saveProblem,
      };
    }
    return ended ?? { phase: 'idle' };
  }

  function buildBubble(): BubbleState | null {
    return host.running && card ? { cardId: card.id, front: card.front, open: bubbleOpen } : null;
  }

  /** Tells the dog when a Stay begins or ends, however it ends: lifted, run out, or the session over. */
  function syncStay(): void {
    const stay = host.running && host.status().stay;
    if (stay === dogStay) return;
    dogStay = stay;
    show.dog?.setStay(stay);
  }

  function publish(): void {
    syncStay();
    const bubble = JSON.stringify(buildBubble());
    if (bubble !== lastBubble) {
      lastBubble = bubble;
      opts.publishBubble?.(buildBubble());
    }
    const view = buildView();
    const key = JSON.stringify(view);
    if (key === lastPublished) return;
    lastPublished = key;
    opts.publish(view);
  }

  function gradeFor(m: Match): Grade {
    return m === 'exact' ? 'good' : m === 'fuzzy' ? 'hard' : 'again';
  }

  function scheduleRefresh(): void {
    refreshHandle = clock.setTimeout(() => {
      refreshHandle = null;
      publish();
      if (host.running) scheduleRefresh();
    }, VIEW_REFRESH_MS);
  }

  function stopRefresh(): void {
    if (refreshHandle !== null) clock.clearTimeout(refreshHandle);
    refreshHandle = null;
  }

  function validIntervals(req: StartRequest): boolean {
    const { checkinMinMinutes: lo, checkinMaxMinutes: hi } = req;
    return Number.isFinite(lo) && Number.isFinite(hi) && lo >= 1 && hi >= lo && hi <= MAX_INTERVAL_MINUTES;
  }

  function fastTuning(req: StartRequest): Partial<Tuning> | undefined {
    if (!opts.fastTuning) return undefined;
    const f = FAST_TUNING_FACTOR;
    return {
      checkinMinMs: (req.checkinMinMinutes * 60_000) / f,
      checkinMaxMs: (req.checkinMaxMinutes * 60_000) / f,
      firstEscalationMs: DEFAULT_TUNING.firstEscalationMs / f,
      escalationStepMs: DEFAULT_TUNING.escalationStepMs / f,
      guiltThresholdMs: DEFAULT_TUNING.guiltThresholdMs / f,
    };
  }

  function openBubble(): void {
    if (!host.running || !card || bubbleOpen) return;
    bubbleOpen = true;
    publish();
  }

  /**
   * Leave it or the session's end: the engine sends no expression for either, so whatever he last felt (pleading and
   * trailing the cursor, a whine) would last for good. He drops it, gets up from any curl, and goes back to roaming.
   */
  function calmDog(): void {
    show.dog?.setMood('idle');
    show.dog?.wake();
  }

  /** Away or suppressed: the engine curls him up then, and says nothing when it is over. */
  function curledUpTime(): boolean {
    const s = host.status();
    return s.activity !== 'active' || s.suppressed;
  }

  function dispatch(e: ExternalEvent): void {
    const wasCurled = host.running && curledUpTime();
    host.dispatch(e);
    // The user is back and nothing holds him back: he gets up. After the engine's own reaction, so a greeting keeps its mood.
    if (wasCurled && host.running && !curledUpTime()) show.dog?.wake();
    publish();
  }

  return {
    start(req) {
      if (host.running) return fail('already-running', 'a session is already running');
      const topic = req.topic.trim();
      if (topic.length > MAX_TOPIC || !validIntervals(req)) return fail('invalid-request', 'the topic or the check-in interval is not usable');
      const deck = library.getDeck(req.deckId);
      if (!deck) return fail('not-found', 'that deck no longer exists');
      if (deck.cards.length === 0) return fail('empty-deck', 'that deck has no cards yet');
      const settings = library.getSettings();
      ended = null;
      card = null;
      saveProblem = false;
      active = { deckId: deck.id, deckName: deck.name, topic, startedAt: clock.now() };
      host.setPreset(settings.preset);
      host.start({
        cards: deck.cards,
        cap: settings.cap,
        preset: settings.preset,
        checkinMinMinutes: req.checkinMinMinutes,
        checkinMaxMinutes: req.checkinMaxMinutes,
        lastGuiltMs: library.lastGuiltMs(),
        tuning: fastTuning(req),
      });
      scheduleRefresh();
      publish();
      return good(buildView());
    },

    async end() {
      if (!host.running || !active) return fail('not-running', 'no session is running');
      stopRefresh();
      const finished = active;
      const summary = host.end();
      // The engine's END_EFFECT has let go of Esc already if an effect was running; the dog leaves any Stay now, not
      // after the history write below.
      forgetEffect();
      syncStay();
      calmDog();
      card = null;
      active = null;
      const endedView = (saved: boolean): Extract<SessionView, { phase: 'ended' }> => ({
        phase: 'ended',
        deckName: finished.deckName,
        topic: finished.topic,
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        answered: summary.answered,
        treats: summary.treats,
        longestWaitMs: summary.longestWaitMs,
        guiltTrips: summary.guiltTrips.length,
        saved,
      });
      // view() already reports the summary, but nothing is published until the history write has finished: the control
      // window re-reads the history the moment it hears the session ended, and must find the new row there.
      ended = endedView(true);
      const saved = await library.recordSession({ deckId: finished.deckId, topic: finished.topic, summary });
      if (!saved.ok) ended = endedView(false);
      publish();
      return good(ended);
    },

    answer(grade) {
      if (!host.running) return fail('not-running', 'no session is running');
      if (!host.answer(grade)) return fail('invalid-request', 'there is no card to answer right now');
      publish();
      return good(undefined);
    },

    control(a) {
      if (!host.running) return fail('not-running', 'no session is running');
      switch (a.action) {
        case 'pause':
          host.dispatch({ type: 'PAUSE' });
          calmDog();
          break;
        case 'resume':
          host.dispatch({ type: 'RESUME' });
          break;
        case 'stay-on':
          if (!STAY_MINUTES.includes(a.minutes)) return fail('invalid-request', 'a stay lasts 15, 25 or 50 minutes');
          host.dispatch({ type: 'STAY_ON', durationMs: a.minutes * 60_000 });
          break;
        case 'stay-off':
          host.dispatch({ type: 'STAY_OFF' });
          break;
      }
      publish();
      return good(undefined);
    },

    dismissSummary() {
      if (host.running) return;
      ended = null;
      publish();
    },

    view: buildView,
    bubbleState: buildBubble,

    dismissBubble() {
      if (!card || !bubbleOpen) return;
      bubbleOpen = false;
      publish();
    },

    openBubble,

    submitText(text) {
      const current = card;
      if (!host.running || !current || text.trim() === '') return { ok: false };
      const match = matchAnswer(text, current.back);
      if (!host.answer(gradeFor(match))) return { ok: false };
      publish();
      return { ok: true, match, expected: current.back };
    },

    revealAnswer: () => (host.running && card ? { ok: true, back: card.back } : { ok: false }),

    selfGrade(grade) {
      if (!host.running || !card || !host.answer(grade === 'good' ? 'good' : 'again')) return false;
      publish();
      return true;
    },

    activeDeckId: () => (host.running && active ? active.deckId : null),

    dispatch,
    // From the dog's own tick, never from inside an action this session is fanning out. With no effect running (a
    // report that lands just after the engine ended the effect itself) ESC_PRESSED does nothing.
    effectLost: () => dispatch({ type: 'ESC_PRESSED' }),
    setBusy: (busy) => host.setBusy(busy),
    setActiveWindow: (id) => host.setActiveWindow(id),

    diagnostics: () => host.diagnostics(),

    async settled() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },

    dispose() {
      stopRefresh();
      host.dispose();
      forgetEffect();
    },
  };
}
