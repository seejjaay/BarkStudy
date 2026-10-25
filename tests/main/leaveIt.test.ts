import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLeaveIt, type LeaveIt } from '../../src/main/leaveIt';
import type { SessionView } from '../../src/shared/control';

let owned: Set<string>;
let registered: Map<string, () => void>;
let view: SessionView;
let conflicts: boolean[];
const control = vi.fn();
const notify = vi.fn();
let leave: LeaveIt;

beforeEach(() => {
  owned = new Set();
  registered = new Map();
  conflicts = [];
  view = { phase: 'idle' };
  control.mockReset();
  notify.mockReset();
  leave = createLeaveIt({
    session: { view: () => view, control },
    hotkeys: {
      register: (accel, fn) => {
        if (accel === 'Bad+++') throw new Error('cannot parse');
        if (owned.has(accel) || registered.has(accel)) return false;
        registered.set(accel, fn);
        return true;
      },
      unregister: (accel) => void registered.delete(accel),
    },
    notify,
    onConflictChange: (c) => conflicts.push(c),
  });
});

const runningView = (paused: boolean): SessionView => ({
  phase: 'running', deckId: 'd', deckName: 'D', topic: '', startedAt: 0, paused, stay: false, stayLeftMs: null,
  away: false, suppressed: false, card: null, answered: 0, treats: 0, saveProblem: false,
});

describe('Leave it hotkey', () => {
  it('registers, and pressing it toggles pause and resume', () => {
    expect(leave.register('Control+Alt+L')).toBe(true);
    expect(leave.conflict).toBe(false);
    expect(conflicts).toEqual([]);
    view = runningView(false);
    registered.get('Control+Alt+L')!();
    expect(control).toHaveBeenLastCalledWith({ action: 'pause' });
    view = runningView(true);
    registered.get('Control+Alt+L')!();
    expect(control).toHaveBeenLastCalledWith({ action: 'resume' });
  });

  it('pressed with nothing running it says so instead of doing nothing silently', () => {
    leave.register('Control+Alt+L');
    registered.get('Control+Alt+L')!();
    expect(control).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
  });

  it('a taken shortcut is reported as a conflict, once', () => {
    owned.add('Control+Alt+L');
    expect(leave.register('Control+Alt+L')).toBe(false);
    expect(leave.conflict).toBe(true);
    expect(leave.accelerator).toBe('Control+Alt+L');
    expect(conflicts).toEqual([true]);
  });

  it('an accelerator that cannot be parsed counts as a conflict, not a crash', () => {
    expect(leave.register('Bad+++')).toBe(false);
    expect(leave.conflict).toBe(true);
  });

  it('rebinding moves the shortcut and clears a conflict', () => {
    owned.add('Control+Alt+L');
    leave.register('Control+Alt+L');
    expect(leave.rebind('Control+Alt+K')).toBe(true);
    expect(leave.conflict).toBe(false);
    expect(leave.accelerator).toBe('Control+Alt+K');
    expect(conflicts).toEqual([true, false]);
    expect([...registered.keys()]).toEqual(['Control+Alt+K']);
  });

  it('a rebind to something taken keeps the working shortcut', () => {
    leave.register('Control+Alt+L');
    owned.add('Control+Alt+K');
    expect(leave.rebind('Control+Alt+K')).toBe(false);
    expect(leave.conflict).toBe(false);
    expect(leave.accelerator).toBe('Control+Alt+L');
    expect([...registered.keys()]).toEqual(['Control+Alt+L']);
  });

  it('rebinding to the shortcut already held is a no-op', () => {
    leave.register('Control+Alt+L');
    expect(leave.rebind('Control+Alt+L')).toBe(true);
    expect(registered.size).toBe(1);
  });

  it('dispose releases it', () => {
    leave.register('Control+Alt+L');
    leave.dispose();
    expect(registered.size).toBe(0);
  });
});
