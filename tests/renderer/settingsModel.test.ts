import { describe, expect, it, vi } from 'vitest';
import { TRAIT_PRESETS } from '../../src/engine/tuning';
import { CAP_OPTIONS, MOTION_OPTIONS, PRESET_OPTIONS, addExcluded, commitOnce, createCommitGuard, parseInterval, volumePercent } from '../../src/renderer/control/settingsModel';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

describe('parseInterval', () => {
  it('reads two whole numbers of minutes, with stray spaces', () => {
    expect(parseInterval('5', '15')).toEqual({ ok: true, min: 5, max: 15 });
    expect(parseInterval(' 1 ', '240')).toEqual({ ok: true, min: 1, max: 240 });
    expect(parseInterval('7', '7')).toEqual({ ok: true, min: 7, max: 7 });
  });

  it.each([
    ['zero', '0', '5'],
    ['a longest gap shorter than the shortest', '20', '10'],
    ['a fraction', '1.5', '5'],
    ['an empty box', '', '5'],
    ['words', 'five', '15'],
    ['a negative', '-3', '15'],
    ['more than 240', '5', '241'],
  ])('refuses %s with a message', (_name, min, max) => {
    const r = parseInterval(min, max);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message.length).toBeGreaterThan(10);
  });
});

describe('addExcluded', () => {
  it('adds an app in its normal form', () => {
    expect(addExcluded(['a.exe'], ' B.EXE ')).toEqual(['a.exe', 'b.exe']);
    expect(addExcluded([], 'C:\\Games\\Foo.exe')).toEqual(['foo.exe']);
  });

  it('leaves the list alone for a blank or a repeat', () => {
    expect(addExcluded(['a.exe'], '')).toEqual(['a.exe']);
    expect(addExcluded(['a.exe'], '   ')).toEqual(['a.exe']);
    expect(addExcluded(['a.exe'], 'A.EXE')).toEqual(['a.exe']);
  });

  it('does not change the list it was given', () => {
    const list = ['a.exe'];
    addExcluded(list, 'b.exe');
    expect(list).toEqual(['a.exe']);
  });
});

describe('the choices offered', () => {
  it('cap offers Gentle, Playful and Full dog as 2, 3 and 4, and the default is among them', () => {
    expect(CAP_OPTIONS.map((o) => o.value)).toEqual([2, 3, 4]);
    expect(CAP_OPTIONS.map((o) => o.label)).toEqual(['Gentle', 'Playful', 'Full dog']);
    expect(CAP_OPTIONS.map((o) => o.value)).toContain(DEFAULT_SETTINGS.cap);
  });

  it('presets offer exactly the personalities the engine knows, each with a description', () => {
    expect(PRESET_OPTIONS.map((o) => o.value).sort()).toEqual(Object.keys(TRAIT_PRESETS).sort());
    for (const o of [...PRESET_OPTIONS, ...CAP_OPTIONS, ...MOTION_OPTIONS]) expect(o.hint.length, o.label).toBeGreaterThan(10);
  });

  it('reduced motion offers system, on and off', () => {
    expect(MOTION_OPTIONS.map((o) => o.value)).toEqual(['system', 'on', 'off']);
  });
});

describe('volumePercent', () => {
  it('shows a 0..1 volume as a whole percent', () => {
    expect(volumePercent(0.4)).toBe('40%');
    expect(volumePercent(0.65)).toBe('65%');
    expect(volumePercent(1)).toBe('100%');
    expect(volumePercent(0)).toBe('0%');
  });
});

describe('createCommitGuard', () => {
  it('refuses a value equal to the last committed one and accepts a changed one', () => {
    const guard = createCommitGuard(0.5);
    expect(guard.shouldCommit(0.5)).toBe(false);
    expect(guard.shouldCommit(0.7)).toBe(true);
  });

  it('keeps asking until a value is recorded as committed', () => {
    const guard = createCommitGuard('5-15');
    expect(guard.shouldCommit('5-20')).toBe(true);
    expect(guard.shouldCommit('5-20')).toBe(true); // the save has not gone through yet
    guard.committed('5-20');
    expect(guard.shouldCommit('5-20')).toBe(false);
    expect(guard.shouldCommit('5-15')).toBe(true);
  });
});

describe('commitOnce', () => {
  /** A save the test finishes by hand, so a second trigger can arrive while the first is still going. */
  const slowSave = () => {
    const calls: ((ok: boolean) => void)[] = [];
    const save = vi.fn(() => new Promise<boolean>((resolve) => calls.push(resolve)));
    return { save, finish: (ok: boolean) => calls.shift()!(ok) };
  };

  it('sends one save when Enter and then blur both ask before the first comes back', async () => {
    const guard = createCommitGuard('5-15');
    const { save, finish } = slowSave();
    const first = commitOnce(guard, '5-20', '5-15', save);
    const second = commitOnce(guard, '5-20', '5-15', save);
    finish(true);
    expect(await first).toBe(true);
    expect(await second).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('lets the same value be sent again after a save fails', async () => {
    const guard = createCommitGuard('5-15');
    const { save, finish } = slowSave();
    const first = commitOnce(guard, '5-20', '5-15', save);
    finish(false);
    expect(await first).toBe(false);
    const retry = commitOnce(guard, '5-20', '5-15', save);
    finish(true);
    expect(await retry).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not save a value that is already the committed one', async () => {
    const save = vi.fn(() => Promise.resolve(true));
    expect(await commitOnce(createCommitGuard(0.5), 0.5, 0.5, save)).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
