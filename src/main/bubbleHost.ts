import { BUBBLE_HOTKEY, isSelfGrade, isTypedAnswer, type BubbleState } from '../shared/bubble';
import { IPC } from '../shared/ipc';
import type { SessionController } from './session';

/**
 * Connects the bubble to the rest of the app: relays the pending question to the overlays, answers their requests
 * (after checking who is asking and what they sent), and keeps the "focus the bubble" hotkey registered only while
 * a question is waiting, so it never swallows Ctrl+Alt+A at any other time.
 */

export interface BubbleHostDeps {
  session: Pick<SessionController, 'dismissBubble' | 'openBubble' | 'submitText' | 'revealAnswer' | 'selfGrade'>;
  overlays: {
    broadcast: (channel: string, payload?: unknown) => void;
    isOverlay: (sender: unknown) => boolean;
    setFocus: (sender: unknown, on: boolean) => void;
  };
  hotkeys: { register: (accelerator: string, onPress: () => void) => boolean; unregister: (accelerator: string) => void };
}

export interface BubbleHost {
  /** Called whenever the session's pending question changes. */
  onBubbleChanged: (state: BubbleState | null) => void;
  /** Answers one request from an overlay. Anything malformed, or not from an overlay, gets nothing useful back. */
  handle: (channel: string, sender: unknown, payload: unknown) => unknown;
  /** False while the hotkey could not be registered because another app owns it. */
  readonly hotkeyOk: boolean;
  dispose: () => void;
}

export function createBubbleHost(deps: BubbleHostDeps): BubbleHost {
  const { session, overlays, hotkeys } = deps;
  let registered = false;
  let conflict = false;
  let last: BubbleState | null = null;

  function onHotkey(): void {
    session.openBubble();
    overlays.broadcast(IPC.bubbleFocusInput);
  }

  function syncHotkey(wanted: boolean): void {
    if (wanted && !registered) {
      registered = hotkeys.register(BUBBLE_HOTKEY, onHotkey);
      conflict = !registered;
      if (conflict) console.error(`${BUBBLE_HOTKEY} is taken by another app; click Pandesal to answer instead`);
    } else if (!wanted && registered) {
      hotkeys.unregister(BUBBLE_HOTKEY);
      registered = false;
    }
    if (!wanted) conflict = false;
  }

  return {
    onBubbleChanged(state) {
      last = state;
      overlays.broadcast(IPC.bubbleState, state);
      syncHotkey(state !== null);
    },

    handle(channel, sender, payload) {
      if (!overlays.isOverlay(sender)) return undefined;
      switch (channel) {
        case IPC.bubbleSubmit:
          return isTypedAnswer(payload) ? session.submitText(payload) : { ok: false };
        case IPC.bubbleReveal:
          return session.revealAnswer();
        case IPC.bubbleGrade:
          return isSelfGrade(payload) ? session.selfGrade(payload) : false;
        case IPC.bubbleDismiss:
          session.dismissBubble();
          return undefined;
        case IPC.bubbleOpen:
          session.openBubble();
          return undefined;
        case IPC.bubbleFocus:
          // Only ever hand focus back when no question is up; take it only while one is.
          if (typeof payload === 'boolean') overlays.setFocus(sender, payload ? last !== null : false);
          return undefined;
        default:
          return undefined;
      }
    },

    get hotkeyOk() {
      return !conflict;
    },

    dispose() {
      syncHotkey(false);
    },
  };
}
