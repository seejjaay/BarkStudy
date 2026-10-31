/**
 * Global shortcuts in Electron's accelerator form, such as "Control+Alt+L". Pure text handling so the control window
 * can build one from a key press and main can check one before trying to register it.
 */

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};
const NAMED_VALUES = new Set(Object.values(NAMED_KEYS).map((v) => v.toLowerCase()));

const CTRL_NAMES = new Set(['ctrl', 'control', 'commandorcontrol', 'cmdorctrl']);
const ALT_NAMES = new Set(['alt', 'option']);

/** The accelerator key name for a `KeyboardEvent.code`, or null for keys that cannot carry a shortcut. */
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return NAMED_KEYS[code] ?? null;
}

/** Builds an accelerator from a key press. It needs Ctrl or Alt plus one ordinary key; Esc and Windows-key combinations are refused. */
export function acceleratorFromKeyEvent(e: KeyEventLike): string | null {
  if (e.metaKey || !(e.ctrlKey || e.altKey)) return null;
  const key = keyName(e.code);
  if (key === null) return null;
  return [e.ctrlKey ? 'Control' : null, e.altKey ? 'Alt' : null, e.shiftKey ? 'Shift' : null, key].filter((p): p is string => p !== null).join('+');
}

function isKeyPart(part: string): boolean {
  return /^[a-z0-9]$/i.test(part) || /^f([1-9]|1[0-9]|2[0-4])$/i.test(part) || NAMED_VALUES.has(part.toLowerCase());
}

/** True for text Electron can register: at least Ctrl or Alt, any other modifiers, then one ordinary key. */
export function isAccelerator(a: string): boolean {
  const parts = a.split('+');
  if (parts.length < 2) return false;
  if (!isKeyPart(parts[parts.length - 1]!)) return false;
  const mods = parts.slice(0, -1).map((p) => p.toLowerCase());
  if (!mods.every((m) => CTRL_NAMES.has(m) || ALT_NAMES.has(m) || m === 'shift')) return false;
  return mods.some((m) => CTRL_NAMES.has(m) || ALT_NAMES.has(m));
}

/** How a shortcut is shown to people: "Ctrl+Alt+L". */
export function acceleratorLabel(a: string): string {
  return a
    .split('+')
    .map((p) => (CTRL_NAMES.has(p.toLowerCase()) ? 'Ctrl' : p))
    .join('+');
}

function canonical(a: string): string {
  const parts = a.split('+').map((p) => p.toLowerCase());
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((m) => (CTRL_NAMES.has(m) ? 'ctrl' : ALT_NAMES.has(m) ? 'alt' : m)));
  return [...[...mods].sort(), key].join('+');
}

/** Two spellings of the same shortcut: Ctrl and Control, any letter case, any modifier order. */
export function sameAccelerator(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}
