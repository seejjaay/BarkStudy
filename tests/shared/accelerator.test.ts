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
  it('builds Alt+F5', () => {
    expect(acceleratorFromKeyEvent(ev({ key: 'F5', code: 'F5', altKey: true }))).toBe('Alt+F5');
  });
  it('keeps Shift as an extra modifier', () => {
    expect(acceleratorFromKeyEvent(ev({ ctrlKey: true, shiftKey: true, code: 'Digit1', key: '!' }))).toBe('Control+Shift+1');
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
  });
  it('rejects malformed text', () => {
    for (const bad of ['', 'L', 'Control+', '+L', 'Control+Alt', 'Shift+L', 'Control+Escape', 'Control+Ll', 'Control++L']) {
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
