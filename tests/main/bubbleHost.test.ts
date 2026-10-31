import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBubbleHost, type BubbleHost, type BubbleHostDeps } from '../../src/main/bubbleHost';
import { BUBBLE_HOTKEY, MAX_TYPED_ANSWER, type BubbleState } from '../../src/shared/bubble';
import { IPC } from '../../src/shared/ipc';

const overlay = { id: 'overlay-page' };
const stranger = { id: 'some-other-page' };
const open: BubbleState = { cardId: 'c1', front: 'France', open: true };

let broadcasts: [string, unknown][];
let focusCalls: [unknown, boolean][];
let registered: Map<string, () => void>;
let registerResult: boolean;
let registerCalls: number;
let accel: string;
let taken: Set<string>;
let host: BubbleHost;
const session = {
  dismissBubble: vi.fn(),
  openBubble: vi.fn(),
  submitText: vi.fn(),
  revealAnswer: vi.fn(),
  selfGrade: vi.fn(),
};

beforeEach(() => {
  broadcasts = [];
  focusCalls = [];
  registered = new Map();
  registerResult = true;
  registerCalls = 0;
  accel = BUBBLE_HOTKEY;
  taken = new Set();
  for (const fn of Object.values(session)) fn.mockReset();
  session.submitText.mockReturnValue({ ok: true, match: 'exact', expected: 'Paris' });
  session.revealAnswer.mockReturnValue({ ok: true, back: 'Paris' });
  session.selfGrade.mockReturnValue(true);
  const deps: BubbleHostDeps = {
    session,
    overlays: {
      broadcast: (channel, payload) => broadcasts.push([channel, payload]),
      isOverlay: (s) => s === overlay,
      setFocus: (s, on) => focusCalls.push([s, on]),
    },
    hotkeys: {
      register: (a, fn) => {
        registerCalls++;
        const ok = registerResult && !taken.has(a);
        if (ok) registered.set(a, fn);
        return ok;
      },
      unregister: (a) => void registered.delete(a),
    },
    accelerator: () => accel,
  };
  host = createBubbleHost(deps);
});

describe('what overlays are told', () => {
  it('every change in the question is broadcast to the overlays', () => {
    host.onBubbleChanged(open);
    host.onBubbleChanged(null);
    expect(broadcasts).toEqual([
      [IPC.bubbleState, open],
      [IPC.bubbleState, null],
    ]);
  });
});

describe('the focus hotkey', () => {
  it('is registered only while a question is waiting, and only once', () => {
    expect(registered.size).toBe(0);
    host.onBubbleChanged(open);
    host.onBubbleChanged({ ...open, open: false });
    expect(registered.has(BUBBLE_HOTKEY)).toBe(true);
    expect(registerCalls).toBe(1);
    host.onBubbleChanged(null);
    expect(registered.size).toBe(0);
  });

  it('pressing it reopens a dismissed bubble and tells the overlays to take focus', () => {
    host.onBubbleChanged({ ...open, open: false });
    broadcasts.length = 0;
    registered.get(BUBBLE_HOTKEY)!();
    expect(session.openBubble).toHaveBeenCalledOnce();
    expect(broadcasts).toEqual([[IPC.bubbleFocusInput, undefined]]);
  });

  it('a hotkey owned by another app is reported, not swallowed, and clears when the question goes', () => {
    registerResult = false;
    host.onBubbleChanged(open);
    expect(host.hotkeyOk).toBe(false);
    host.onBubbleChanged(null);
    expect(host.hotkeyOk).toBe(true);
  });

  it('is released when the host is disposed mid-question', () => {
    host.onBubbleChanged(open);
    host.dispose();
    expect(registered.size).toBe(0);
  });
});

describe('a rebound focus hotkey', () => {
  it('registers whatever the setting says when the question appears', () => {
    accel = 'Control+Alt+K';
    host.onBubbleChanged(open);
    expect([...registered.keys()]).toEqual(['Control+Alt+K']);
    host.onBubbleChanged(null);
    expect(registered.size).toBe(0);
  });

  it('rebinding while a question is up swaps the shortcut and the new one works', () => {
    host.onBubbleChanged(open);
    expect(host.rebind('Control+Alt+K')).toBe(true);
    expect([...registered.keys()]).toEqual(['Control+Alt+K']);
    registered.get('Control+Alt+K')!();
    expect(session.openBubble).toHaveBeenCalledOnce();
    accel = 'Control+Alt+K';
    host.onBubbleChanged(null);
    expect(registered.size).toBe(0);
  });

  it('rebinding to a shortcut another app owns keeps the old one and says no', () => {
    host.onBubbleChanged(open);
    taken.add('Control+Alt+K');
    expect(host.rebind('Control+Alt+K')).toBe(false);
    expect([...registered.keys()]).toEqual([BUBBLE_HOTKEY]);
  });

  it('rebinding to the shortcut already held succeeds without touching it', () => {
    host.onBubbleChanged(open);
    const before = registerCalls;
    expect(host.rebind('Ctrl+Alt+A')).toBe(true);
    expect(registerCalls).toBe(before);
  });

  it('with no question up it only checks the shortcut is free, and holds nothing afterwards', () => {
    expect(host.rebind('Control+Alt+K')).toBe(true);
    expect(registered.size).toBe(0);
    taken.add('Control+Alt+J');
    expect(host.rebind('Control+Alt+J')).toBe(false);
    expect(registered.size).toBe(0);
  });
});

describe('requests from overlays', () => {
  it('ignores anything that is not one of our overlay pages', () => {
    expect(host.handle(IPC.bubbleSubmit, stranger, 'Paris')).toBeUndefined();
    expect(host.handle(IPC.bubbleDismiss, stranger, undefined)).toBeUndefined();
    expect(host.handle(IPC.bubbleFocus, stranger, true)).toBeUndefined();
    expect(session.submitText).not.toHaveBeenCalled();
    expect(session.dismissBubble).not.toHaveBeenCalled();
    expect(focusCalls).toEqual([]);
  });

  it('passes a typed answer to the session and returns its verdict', () => {
    expect(host.handle(IPC.bubbleSubmit, overlay, 'Paris')).toEqual({ ok: true, match: 'exact', expected: 'Paris' });
    expect(session.submitText).toHaveBeenCalledWith('Paris');
  });

  it('rejects a typed answer that is not text or is far too long', () => {
    expect(host.handle(IPC.bubbleSubmit, overlay, 42)).toEqual({ ok: false });
    expect(host.handle(IPC.bubbleSubmit, overlay, { text: 'x' })).toEqual({ ok: false });
    expect(host.handle(IPC.bubbleSubmit, overlay, 'x'.repeat(MAX_TYPED_ANSWER + 1))).toEqual({ ok: false });
    expect(session.submitText).not.toHaveBeenCalled();
  });

  it('reveal, self-grade, dismiss and open reach the session; a bad grade does not', () => {
    expect(host.handle(IPC.bubbleReveal, overlay, undefined)).toEqual({ ok: true, back: 'Paris' });
    expect(host.handle(IPC.bubbleGrade, overlay, 'good')).toBe(true);
    expect(session.selfGrade).toHaveBeenCalledWith('good');
    expect(host.handle(IPC.bubbleGrade, overlay, 'hard')).toBe(false);
    expect(host.handle(IPC.bubbleGrade, overlay, undefined)).toBe(false);
    expect(session.selfGrade).toHaveBeenCalledTimes(1);
    host.handle(IPC.bubbleDismiss, overlay, undefined);
    host.handle(IPC.bubbleOpen, overlay, undefined);
    expect(session.dismissBubble).toHaveBeenCalledOnce();
    expect(session.openBubble).toHaveBeenCalledOnce();
  });

  it('an unknown channel does nothing', () => {
    expect(host.handle('bubble:rm-rf', overlay, 'x')).toBeUndefined();
  });
});

describe('keyboard focus', () => {
  it('is handed to the overlay only while a question is waiting', () => {
    host.handle(IPC.bubbleFocus, overlay, true);
    expect(focusCalls).toEqual([[overlay, false]]);
    focusCalls.length = 0;
    host.onBubbleChanged(open);
    host.handle(IPC.bubbleFocus, overlay, true);
    expect(focusCalls).toEqual([[overlay, true]]);
  });

  it('handing it back always works, even after the question is gone', () => {
    host.onBubbleChanged(open);
    host.onBubbleChanged(null);
    host.handle(IPC.bubbleFocus, overlay, false);
    expect(focusCalls).toEqual([[overlay, false]]);
  });

  it('a non-boolean focus request is ignored', () => {
    host.onBubbleChanged(open);
    host.handle(IPC.bubbleFocus, overlay, 'yes');
    expect(focusCalls).toEqual([]);
  });
});
