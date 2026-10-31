import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, checkSettings, fillSettings, normalizeExcluded, type Settings } from '../../src/shared/settings';
import { isSettings } from '../../src/shared/validate';
import v1 from '../fixtures/schemas/v1/settings.json';

const ok = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, excludedApps: [...DEFAULT_SETTINGS.excludedApps], ...patch });

describe('fillSettings', () => {
  it('fills the fields a v1 file lacks, and changes nothing that is present', () => {
    expect(isSettings(v1.data)).toBe(true);
    const s = fillSettings(v1.data as never);
    expect(s).toMatchObject({
      cap: 3,
      preset: 'drama-queen',
      checkinMinMinutes: 7,
      leaveItHotkey: 'Ctrl+Alt+K',
      onboarded: false,
      reducedMotion: 'system',
      updateChecks: true,
      betaChannel: false,
      bubbleHotkey: 'Control+Alt+A',
    });
  });
  it('keeps new fields that are present', () => {
    const s = fillSettings({ ...v1.data, onboarded: true, reducedMotion: 'on', betaChannel: true } as never);
    expect(s).toMatchObject({ onboarded: true, reducedMotion: 'on', betaChannel: true });
  });
});

describe('isSettings with the new fields', () => {
  it('refuses a present field of the wrong type', () => {
    expect(isSettings({ ...v1.data, onboarded: 'yes' })).toBe(false);
    expect(isSettings({ ...v1.data, reducedMotion: 'sometimes' })).toBe(false);
    expect(isSettings({ ...v1.data, bubbleHotkey: 4 })).toBe(false);
  });
});

describe('checkSettings', () => {
  it('accepts the defaults', () => {
    expect(checkSettings(ok())).toBeNull();
  });
  it.each<[string, Partial<Settings>]>([
    ['unknown preset', { preset: 'x' as never }],
    ['min below 1', { checkinMinMinutes: 0 }],
    ['min above max', { checkinMinMinutes: 20, checkinMaxMinutes: 10 }],
    ['max above 240', { checkinMaxMinutes: 241 }],
    ['fractional minutes', { checkinMinMinutes: 1.5 }],
    ['empty excluded entry', { excludedApps: [''] }],
    ['overlong excluded entry', { excludedApps: ['a'.repeat(261)] }],
    ['too many excluded entries', { excludedApps: Array.from({ length: 101 }, (_, i) => `a${i}.exe`) }],
    ['bad leave-it hotkey', { leaveItHotkey: 'L' }],
    ['bad bubble hotkey', { bubbleHotkey: '' }],
    ['both hotkeys the same', { leaveItHotkey: 'Ctrl+Alt+A' }],
  ])('refuses %s', (_name, patch) => {
    expect(checkSettings(ok(patch))).not.toBeNull();
  });
});

describe('normalizeExcluded', () => {
  it('lower-cases, trims, drops blanks and duplicates, strips folders', () => {
    expect(normalizeExcluded(['A.EXE', ' a.exe ', 'b.exe', '', 'C:\\Games\\Foo.EXE'])).toEqual(['a.exe', 'b.exe', 'foo.exe']);
  });
});
