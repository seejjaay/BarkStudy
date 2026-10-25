import { describe, expect, it } from 'vitest';
import type { TrackedWindow } from '../../src/shared/geometry';
import { createSuppress, isSuppressing } from '../../src/main/suppress';

const win = (over: Partial<TrackedWindow> = {}): TrackedWindow => ({
  id: 1,
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  z: 0,
  processName: 'code.exe',
  isForeground: true,
  fullscreen: false,
  ...over,
});
const excluded = ['zoom.exe', 'obs64.exe'];

describe('isSuppressing', () => {
  it('an ordinary foreground window does not suppress', () => {
    expect(isSuppressing([win()], excluded)).toBe(false);
  });

  it('a fullscreen foreground window suppresses', () => {
    expect(isSuppressing([win({ fullscreen: true })], excluded)).toBe(true);
  });

  it('a fullscreen window that is not in front does not', () => {
    expect(isSuppressing([win({ id: 2, isForeground: true }), win({ fullscreen: true, isForeground: false, z: 1 })], excluded)).toBe(false);
  });

  it('an excluded app in front suppresses, matched case-insensitively', () => {
    expect(isSuppressing([win({ processName: 'Zoom.EXE' })], excluded)).toBe(true);
    expect(isSuppressing([win({ processName: 'zoom.exe' })], ['ZOOM.exe'])).toBe(true);
  });

  it('an excluded app behind the foreground window does not', () => {
    expect(isSuppressing([win(), win({ id: 2, processName: 'zoom.exe', isForeground: false, z: 1 })], excluded)).toBe(false);
  });

  it('no foreground window (desktop, or nothing tracked) does not suppress', () => {
    expect(isSuppressing([], excluded)).toBe(false);
    expect(isSuppressing([win({ isForeground: false })], excluded)).toBe(false);
  });
});

describe('createSuppress', () => {
  function setup(list: string[] = excluded) {
    const events: boolean[] = [];
    let apps = list;
    const s = createSuppress({ excludedApps: () => apps, emit: (on) => events.push(on) });
    return { s, events, setApps: (a: string[]) => (apps = a) };
  }

  it('says nothing while nothing is suppressing', () => {
    const { s, events } = setup();
    s.update([win()]);
    s.update([win(), win({ id: 2, z: 1 })]);
    expect(events).toEqual([]);
  });

  it('emits once when suppression starts and once when it ends, not on every update', () => {
    const { s, events } = setup();
    s.update([win({ processName: 'zoom.exe' })]);
    s.update([win({ processName: 'zoom.exe', bounds: { x: 5, y: 5, width: 800, height: 600 } })]);
    s.update([win({ fullscreen: true })]);
    expect(events).toEqual([true]);
    s.update([win()]);
    expect(events).toEqual([true, false]);
  });

  it('refresh() re-evaluates the last window list against changed settings', () => {
    const { s, events, setApps } = setup([]);
    s.update([win({ processName: 'game.exe' })]);
    expect(events).toEqual([]);
    setApps(['game.exe']);
    s.refresh();
    expect(events).toEqual([true]);
    setApps([]);
    s.refresh();
    expect(events).toEqual([true, false]);
  });

  it('refresh() before any update is harmless', () => {
    const { s, events } = setup();
    s.refresh();
    expect(events).toEqual([]);
  });
});
