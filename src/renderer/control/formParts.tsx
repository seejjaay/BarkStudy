import { useId, useState, type KeyboardEvent } from 'react';
import { acceleratorFromKeyEvent, acceleratorLabel } from '../../shared/accelerator';
import type { Result } from '../../shared/control';
import { SETTINGS } from '../../shared/i18n/en';
import { describe } from './api';

/** Form controls the settings page and onboarding share, so a choice looks and behaves the same in both. */

export interface ChoiceOption<T> {
  value: T;
  label: string;
  hint: string;
}

/** A group of radio buttons, each with a line saying what it does. Native radios, so arrow keys and screen readers just work. */
export function RadioCards<T extends string | number>({
  legend,
  value,
  options,
  onChange,
  note,
}: {
  legend: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  note?: string;
}) {
  const group = useId();
  const noteId = useId();
  return (
    <fieldset className="field-group" aria-describedby={note ? noteId : undefined}>
      <legend>{legend}</legend>
      <div className="radio-cards">
        {options.map((o) => (
          <label key={String(o.value)} className="radio-card">
            <input type="radio" name={group} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span className="radio-card-body">
              <span className="radio-card-label">{o.label}</span>
              <span className="hint">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {note && (
        <p id={noteId} className="hint">
          {note}
        </p>
      )}
    </fieldset>
  );
}

const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'];

/**
 * Shows a shortcut and lets the user press a new one. While it listens, Esc cancels and moving focus away cancels;
 * a combination that cannot be used says why instead of doing nothing.
 */
export function HotkeyField({
  label,
  accelerator,
  hint,
  onCommit,
}: {
  label: string;
  accelerator: string;
  hint?: string;
  onCommit: (accelerator: string) => Promise<Result<unknown>>;
}) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const describedBy = useId();

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (!listening || e.key === 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setListening(false);
      setError(null);
      return;
    }
    if (MODIFIER_KEYS.includes(e.key)) return; // wait for the key that goes with it
    const next = acceleratorFromKeyEvent(e.nativeEvent);
    if (next === null) {
      setError(SETTINGS.hotkey.badCombination);
      return;
    }
    setListening(false);
    setError(null);
    setBusy(true);
    void onCommit(next).then((r) => {
      setBusy(false);
      if (!r.ok) setError(describe(r.error));
    });
  }

  return (
    <div className="field hotkey-field">
      <span className="field-label">
        {label}
      </span>
      <div className="pair">
        <button
          type="button"
          className="btn"
          aria-label={listening ? SETTINGS.hotkey.listeningLabel(label) : SETTINGS.hotkey.idleLabel(label, acceleratorLabel(accelerator))}
          aria-describedby={describedBy}
          disabled={busy}
          onClick={() => {
            setListening(true);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setListening(false)}
        >
          {listening ? SETTINGS.hotkey.pressNew : acceleratorLabel(accelerator)}
        </button>
        <span className="hint">{listening ? SETTINGS.hotkey.listeningNote : SETTINGS.hotkey.idleNote}</span>
      </div>
      <p id={describedBy} className="hint">
        {hint}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
