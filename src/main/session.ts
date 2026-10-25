import type { BubbleState, RevealResult, SelfGrade, SubmitResult } from '../shared/bubble';
import type { AppError, Result, SessionAction, SessionView, StartRequest, ViewCard } from '../shared/control';
import { matchAnswer, type Match } from '../shared/matching';
import type { Card } from '../shared/model';
import type { Grade } from '../shared/srs';
import { createEngineHost, type CardPrompt, type EngineHost, type ExternalEvent, type HostSink } from './engineHost';
import type { Clock } from './dogHost';
import type { Library } from './library';

/**
 * One study session as the control window sees it: starts it from a deck, feeds answers and controls to the engine
 * host, saves each review as it happens, records the finished session in the history, and publishes a plain view of
 * all of it whenever that view changes. No Electron in here.
 */

export const VIEW_REFRESH_MS = 1000;
/** What the engine's personality layer sets for its "re-ask" intent (see EXPRESSION in engine/personality.ts). */
export const RE_ASK_EXPRESSION = 'pleading';
export const MAX_TOPIC = 80;
export const MAX_INTERVAL_MINUTES = 240;
const STAY_MINUTES: readonly number[] = [15, 25, 50];

export interface DogHooks {
  walkTo?: (windowId: number) => void;
  effect?: HostSink['effect'];
}

export interface SessionControllerOptions {
  library: Library;
  seed: number;
  publish: (view: SessionView) => void;
  /** The bubble beside Pandesal: the question while one is pending, null otherwise. Sent only when it changes. */
  publishBubble?: (state: BubbleState | null) => void;
  dog?: DogHooks;
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
  setBusy: (busy: boolean) => void;
  setActiveWindow: (id: number | null) => void;
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

  let active: Active | null = null;
  let ended: Extract<SessionView, { phase: 'ended' }> | null = null;
  let card: ViewCard | null = null;
  let bubbleOpen = true;
  let saveProblem = false;
  let lastPublished = '';
  let lastBubble = '';
  let refreshHandle: unknown = null;
  const pending = new Set<Promise<unknown>>();

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
    say: () => undefined,
    expression: (name) => {
      // The engine's "re-ask" intent asks again by pleading; it is the only intent that does. A dismissed bubble comes back.
      if (name === RE_ASK_EXPRESSION && card && !bubbleOpen) {
        bubbleOpen = true;
        publish();
      }
    },
    walkTo: (id) => opts.dog?.walkTo?.(id),
    effect: (a) => opts.dog?.effect?.(a),
    treat: () => undefined,
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

  function publish(): void {
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

    openBubble() {
      if (!host.running || !card || bubbleOpen) return;
      bubbleOpen = true;
      publish();
    },

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

    dispatch(e) {
      host.dispatch(e);
      publish();
    },
    setBusy: (busy) => host.setBusy(busy),
    setActiveWindow: (id) => host.setActiveWindow(id),

    async settled() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },

    dispose() {
      stopRefresh();
      host.dispose();
    },
  };
}
