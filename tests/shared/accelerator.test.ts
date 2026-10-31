import { describe, expect, it } from 'vitest';
import { acceleratorFromKeyEvent, acceleratorLabel, isAccelerator, sameAccelerator } from '../../src/shared/accelerator';

const ev = (over: Partial<Parameters<typeof acceleratorFromKeyEvent>[0]>) => ({
  key: 'l',
  code: 'KeyL',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...over,
});

describe('acceleratorFromKeyEvent', () => {
  it('builds Control+Alt+L from Ctrl+Alt+L', () => {
    expect(acceleratorFromKeyEvent(ev({ ctrlKey: true, altKey: true }))).toBe('Control+Alt+L');
  });
  it('builds a function-key shortcut', () => {
    expect(acceleratorFromKeyEvent(ev({ key: 'F5', code: 'F5', ctrlKey: true, altKey: true }))).toBe('Control+Alt+F5');
  });
  it('keeps Shift as an extra modifier', () => {
    expect(acceleratorFromKeyEvent(ev({ ctrlKey: true, altKey: true, shiftKey: true, code: 'Digit1', key: '!' }))).toBe('Control+Alt+Shift+1');
  });
  it('refuses combinations other apps and Windows own, because a global shortcut would swallow them everywhere', () => {
    const reserved: [string, Partial<Parameters<typeof ev>[0]>][] = [
      ['Ctrl+C', { key: 'c', code: 'KeyC', ctrlKey: true }],
      ['Ctrl+Shift+C', { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true }],
      ['Alt+F4', { key: 'F4', code: 'F4', altKey: true }],
      ['Alt+Space', { key: ' ', code: 'Space', altKey: true }],
      ['Alt+F', { key: 'f', code: 'KeyF', altKey: true }],
      ['Alt+Shift+L', { key: 'L', code: 'KeyL', altKey: true, shiftKey: true }],
    ];
    for (const [name, over] of reserved) expect(acceleratorFromKeyEvent(ev(over)), name).toBeNull();
  });
  it('refuses a bare key, Shift alone, Escape, and a lone modifier', () => {
    expect(acceleratorFromKeyEvent(ev({}))).toBeNull();
    expect(acceleratorFromKeyEvent(ev({ shiftKey: true }))).toBeNull();
    expect(acceleratorFromKeyEvent(ev({ key: 'Escape', code: 'Escape' }))).toBeNull();
    expect(acceleratorFromKeyEvent(ev({ key: 'Escape', code: 'Escape', ctrlKey: true, altKey: true }))).toBeNull();
    expect(acceleratorFromKeyEvent(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull();
  });
  it('refuses Windows-key combinations', () => {
    expect(acceleratorFromKeyEvent(ev({ ctrlKey: true, metaKey: true }))).toBeNull();
  });
});

describe('isAccelerator', () => {
  it('accepts both spellings of Ctrl', () => {
    expect(isAccelerator('Control+Alt+L')).toBe(true);
    expect(isAccelerator('Ctrl+Alt+L')).toBe(true);
    expect(isAccelerator('Control+Alt+Shift+F5')).toBe(true);
  });
  it('rejects malformed text', () => {
    for (const bad of ['', 'L', 'Control+', '+L', 'Control+Alt', 'Shift+L', 'Control+Escape', 'Control+Ll', 'Control++L']) {
      expect(isAccelerator(bad), bad).toBe(false);
    }
  });
  it('rejects reserved combinations: it takes Ctrl and Alt together', () => {
    for (const bad of ['Control+C', 'Ctrl+V', 'Alt+F4', 'Alt+F5', 'Control+Shift+C', 'Alt+Shift+L', 'Control+Shift+Escape']) {
      expect(isAccelerator(bad), bad).toBe(false);
    }
  });
});

describe('labels and equality', () => {
  it('shows Control as Ctrl', () => {
    expect(acceleratorLabel('Control+Alt+L')).toBe('Ctrl+Alt+L');
    expect(acceleratorLabel('Ctrl+Alt+L')).toBe('Ctrl+Alt+L');
  });
  it('treats Ctrl and Control, and letter case, as the same shortcut', () => {
    expect(sameAccelerator('Ctrl+Alt+A', 'Control+Alt+A')).toBe(true);
    expect(sameAccelerator('control+alt+a', 'Ctrl+Alt+A')).toBe(true);
    expect(sameAccelerator('Ctrl+Alt+A', 'Ctrl+Alt+L')).toBe(false);
    expect(sameAccelerator('Alt+Ctrl+A', 'Ctrl+Alt+A')).toBe(true);
  });
});
