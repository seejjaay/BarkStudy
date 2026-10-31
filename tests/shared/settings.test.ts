import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, checkSettings, fillSettings, normalizeExcluded, repairSettings, type Settings, type SettingsReason } from '../../src/shared/settings';
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
  it('drops keys it does not know', () => {
    const s = fillSettings({ ...v1.data, extra: 1 } as never);
    expect(s).not.toHaveProperty('extra');
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
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
  it.each<[string, Partial<Settings>, SettingsReason]>([
    ['unknown preset', { preset: 'x' as never }, 'bad-preset'],
    ['min below 1', { checkinMinMinutes: 0 }, 'bad-interval'],
    ['min above max', { checkinMinMinutes: 20, checkinMaxMinutes: 10 }, 'bad-interval'],
    ['max above 240', { checkinMaxMinutes: 241 }, 'bad-interval'],
    ['fractional minutes', { checkinMinMinutes: 1.5 }, 'bad-interval'],
    ['empty excluded entry', { excludedApps: [''] }, 'bad-app-name'],
    ['overlong excluded entry', { excludedApps: ['a'.repeat(261)] }, 'bad-app-name'],
    ['too many excluded entries', { excludedApps: Array.from({ length: 101 }, (_, i) => `a${i}.exe`) }, 'too-many-apps'],
    ['bad leave-it hotkey', { leaveItHotkey: 'L' }, 'bad-shortcut'],
    ['bad bubble hotkey', { bubbleHotkey: '' }, 'bad-shortcut'],
    ['both hotkeys the same', { leaveItHotkey: 'Ctrl+Alt+A' }, 'same-shortcut'],
  ])('refuses %s with its reason', (_name, patch, reason) => {
    expect(checkSettings(ok(patch))).toBe(reason);
  });
});

describe('normalizeExcluded', () => {
  it('lower-cases, trims, drops blanks and duplicates, strips folders', () => {
    expect(normalizeExcluded(['A.EXE', ' a.exe ', 'b.exe', '', 'C:\\Games\\Foo.EXE'])).toEqual(['a.exe', 'b.exe', 'foo.exe']);
  });
});

describe('repairSettings', () => {
  it('leaves good settings alone and says so', () => {
    const r = repairSettings(ok());
    expect(r.repaired).toBe(false);
    expect(r.settings).toEqual(ok());
  });
  it('puts a bad preset back to the default and keeps the rest', () => {
    const r = repairSettings(ok({ preset: 'x' as never, cap: 2 }));
    expect(r).toMatchObject({ repaired: true, settings: { preset: DEFAULT_SETTINGS.preset, cap: 2 } });
  });
  it('puts a bad interval back as a pair', () => {
    const r = repairSettings(ok({ checkinMinMinutes: 30, checkinMaxMinutes: 10, soundOn: false }));
    expect(r.settings).toMatchObject({ checkinMinMinutes: 5, checkinMaxMinutes: 15, soundOn: false });
    expect(r.repaired).toBe(true);
  });
  it('normalises the excluded apps and cuts them to 100', () => {
    const many = Array.from({ length: 150 }, (_, i) => `A${i}.EXE`);
    const r = repairSettings(ok({ excludedApps: many }));
    expect(r.repaired).toBe(true);
    expect(r.settings.excludedApps).toHaveLength(100);
    expect(r.settings.excludedApps[0]).toBe('a0.exe');
    expect(repairSettings(ok({ excludedApps: [' ZOOM.exe ', 'zoom.exe'] })).settings.excludedApps).toEqual(['zoom.exe']);
  });
  it('resets a bad hotkey alone', () => {
    const r = repairSettings(ok({ leaveItHotkey: 'L', bubbleHotkey: 'Ctrl+Alt+K' }));
    expect(r.settings).toMatchObject({ leaveItHotkey: DEFAULT_SETTINGS.leaveItHotkey, bubbleHotkey: 'Ctrl+Alt+K' });
  });
  it('resets the bubble shortcut when both ended up the same', () => {
    const r = repairSettings(ok({ leaveItHotkey: 'Ctrl+Alt+K', bubbleHotkey: 'Ctrl+Alt+K' }));
    expect(r.settings).toMatchObject({ leaveItHotkey: 'Ctrl+Alt+K', bubbleHotkey: DEFAULT_SETTINGS.bubbleHotkey });
    const clash = repairSettings(ok({ leaveItHotkey: 'L', bubbleHotkey: DEFAULT_SETTINGS.leaveItHotkey }));
    expect(checkSettings(clash.settings)).toBeNull();
  });
  it('when both shortcuts equal the bubble default, the bubble keeps it and Leave it goes back to its own default', () => {
    const r = repairSettings(ok({ leaveItHotkey: DEFAULT_SETTINGS.bubbleHotkey, bubbleHotkey: DEFAULT_SETTINGS.bubbleHotkey }));
    expect(r.settings).toMatchObject({ leaveItHotkey: DEFAULT_SETTINGS.leaveItHotkey, bubbleHotkey: DEFAULT_SETTINGS.bubbleHotkey });
    expect(checkSettings(r.settings)).toBeNull();
  });
  it('always yields settings that pass checkSettings', () => {
    const r = repairSettings(ok({ preset: 'x' as never, checkinMinMinutes: 0, excludedApps: [''], leaveItHotkey: '', bubbleHotkey: '' }));
    expect(checkSettings(r.settings)).toBeNull();
  });
});
