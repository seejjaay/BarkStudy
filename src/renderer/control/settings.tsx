import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Cap } from '../../engine/types';
import { acceleratorLabel } from '../../shared/accelerator';
import type { Result, SettingsPatch, SettingsView } from '../../shared/control';
import { COMMON as C, SETTINGS as T } from '../../shared/i18n/en';
import { DEFAULT_EXCLUDED_APPS, type Settings } from '../../shared/settings';
import { api, attempt, describe } from './api';
import { DataSection } from './dataSection';
import { HotkeyField, RadioCards } from './formParts';
import { CAP_OPTIONS, MOTION_OPTIONS, PRESET_OPTIONS, addExcluded, commitOnce, createCommitGuard, parseInterval, volumePercent } from './settingsModel';
import { useToast } from './toast';

type Save = (patch: SettingsPatch, message?: string) => Promise<boolean>;

export function SettingsPage({ reloadKey, onDataChanged }: { reloadKey: number; onDataChanged: () => void }) {
  const toast = useToast();
  const [view, setView] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.call('settings:get', undefined));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  // Re-read when something else changed the settings (a shortcut taken by another app, a restore).
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  /** Sends one change, tells the user how it went, and keeps the page in step with what was actually saved. */
  const save: Save = async (patch, message = T.saved) => {
    const r = await attempt(api.call('settings:update', patch));
    if (r.ok) {
      setView((v) => (v ? { ...v, settings: r.value } : v));
      toast(message);
    } else {
      toast(describe(r.error), { kind: 'error' });
    }
    return r.ok;
  };

  const setHotkey = (which: 'leaveIt' | 'bubble', name: string) => async (accelerator: string): Promise<Result<Settings>> => {
    const r = await attempt(api.call('settings:hotkey', { which, accelerator }));
    if (r.ok) {
      setView((v) => (v ? { ...v, settings: r.value } : v));
      toast(T.shortcutNow(name, acceleratorLabel(accelerator)));
    }
    return r;
  };

  async function setLogin(on: boolean): Promise<void> {
    const r = await attempt(api.call('settings:login-item', { on }));
    if (!r.ok) {
      toast(describe(r.error), { kind: 'error' });
      return;
    }
    setView((v) => (v ? { ...v, loginItem: r.value } : v));
    toast(on ? T.loginOn : T.loginOff);
  }

  if (loadError !== null) {
    return (
      <div className="empty" role="alert">
        <h1>{T.loadFailed}</h1>
        <p className="muted">{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          {C.tryAgain}
        </button>
      </div>
    );
  }
  if (view === null) {
    return (
      <p className="muted" role="status">
        {T.loading}
      </p>
    );
  }

  const s = view.settings;
  return (
    <div className="settings">
      <header className="page-head">
        <h1>{T.title}</h1>
      </header>

      <section className="card-panel settings-section" aria-labelledby="settings-study">
        <h2 id="settings-study">{T.studySection}</h2>
        <RadioCards<Cap>
          legend={T.capLegend}
          value={s.cap}
          options={CAP_OPTIONS}
          note={T.appliesNote}
          onChange={(cap) => void save({ cap }, T.appliesNextSession)}
        />
        <RadioCards
          legend={T.presetLegend}
          value={s.preset}
          options={PRESET_OPTIONS}
          note={T.appliesNote}
          onChange={(preset) => void save({ preset }, T.appliesNextSession)}
        />
        <IntervalFields min={s.checkinMinMinutes} max={s.checkinMaxMinutes} save={save} />
        <ExcludedApps apps={s.excludedApps} openApps={view.openApps} save={save} />
      </section>

      <section className="card-panel settings-section" aria-labelledby="settings-controls">
        <h2 id="settings-controls">{T.controlsSection}</h2>
        <HotkeyField
          label={T.leaveItName}
          accelerator={s.leaveItHotkey}
          hint={T.leaveItHint}
          onCommit={setHotkey('leaveIt', T.leaveItName)}
        />
        <HotkeyField
          label={T.bubbleName}
          accelerator={s.bubbleHotkey}
          hint={T.bubbleHint}
          onCommit={setHotkey('bubble', T.bubbleName)}
        />
        <p className="hint">{T.escNote}</p>
      </section>

      <section className="card-panel settings-section" aria-labelledby="settings-sound">
        <h2 id="settings-sound">{T.soundSection}</h2>
        <label className="radio">
          <input type="checkbox" checked={s.soundOn} onChange={(e) => void save({ soundOn: e.target.checked })} />
          {T.soundOn}
        </label>
        <VolumeSlider volume={s.volume} disabled={!s.soundOn} save={save} />
        <RadioCards legend={T.motionLegend} value={s.reducedMotion} options={MOTION_OPTIONS} onChange={(reducedMotion) => void save({ reducedMotion })} />
      </section>

      <section className="card-panel settings-section" aria-labelledby="settings-system">
        <h2 id="settings-system">{T.systemSection}</h2>
        <label className="radio">
          <input type="checkbox" checked={view.loginItem.on} disabled={!view.loginItem.available} onChange={(e) => void setLogin(e.target.checked)} />
          {T.startWithWindows}
        </label>
        {!view.loginItem.available && <p className="hint">{T.loginUnavailable}</p>}
        <label className="radio">
          <input type="checkbox" checked={s.updateChecks} onChange={(e) => void save({ updateChecks: e.target.checked })} />
          {T.checkUpdates}
        </label>
        <label className="radio">
          <input type="checkbox" checked={s.betaChannel} disabled={!s.updateChecks} onChange={(e) => void save({ betaChannel: e.target.checked })} />
          {T.betaVersions}
        </label>
        <p className="hint">{T.updatesNote}</p>
      </section>

      <DataSection dataDir={view.dataDir} onDataChanged={onDataChanged} />
    </div>
  );
}

/** The shortest and longest gap between check-ins. Saved when focus leaves the pair or Enter is pressed, so a half-typed pair is never judged. */
function IntervalFields({ min, max, save }: { min: number; max: number; save: Save }) {
  const [lo, setLo] = useState(String(min));
  const [hi, setHi] = useState(String(max));
  const [error, setError] = useState<string | null>(null);
  const ids = { lo: useId(), hi: useId(), err: useId() };
  const guard = useRef(createCommitGuard(`${min}-${max}`));
  useEffect(() => {
    guard.current.committed(`${min}-${max}`);
    setLo(String(min));
    setHi(String(max));
  }, [min, max]);

  async function commit(): Promise<void> {
    const parsed = parseInterval(lo, hi);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    const saved = await commitOnce(guard.current, `${parsed.min}-${parsed.max}`, `${min}-${max}`, () => save({ checkinMinMinutes: parsed.min, checkinMaxMinutes: parsed.max }, T.appliesNextSession));
    if (saved === false) {
      setLo(String(min));
      setHi(String(max));
    }
  }

  return (
    <fieldset
      className="field-group"
      aria-describedby={error ? ids.err : undefined}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) void commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit();
      }}
    >
      <legend>{T.intervalLegend}</legend>
      <div className="pair">
        <label htmlFor={ids.lo} className="sr-only">
          {T.shortestGap}
        </label>
        <input id={ids.lo} type="text" inputMode="numeric" className="num" value={lo} aria-invalid={error ? true : undefined} onChange={(e) => setLo(e.target.value)} />
        <span aria-hidden="true">{T.to}</span>
        <label htmlFor={ids.hi} className="sr-only">
          {T.longestGap}
        </label>
        <input id={ids.hi} type="text" inputMode="numeric" className="num" value={hi} aria-invalid={error ? true : undefined} onChange={(e) => setHi(e.target.value)} />
        <span>{T.minutes}</span>
      </div>
      <p className="hint">{T.intervalNote}</p>
      {error && (
        <p id={ids.err} className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Saved when the slider is let go, not on every step it passes through. */
function VolumeSlider({ volume, disabled, save }: { volume: number; disabled: boolean; save: Save }) {
  const [value, setValue] = useState(volume);
  const id = useId();
  const guard = useRef(createCommitGuard(volume));
  useEffect(() => {
    guard.current.committed(volume);
    setValue(volume);
  }, [volume]);
  const commit = (): void => void commitOnce(guard.current, value, volume, () => save({ volume: value }));
  return (
    <div className="field">
      <label htmlFor={id}>
        {T.volume} <span className="muted">{volumePercent(value)}</span>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        aria-valuetext={volumePercent(value)}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  );
}

function ExcludedApps({ apps, openApps, save }: { apps: string[]; openApps: string[]; save: Save }) {
  const [typed, setTyped] = useState('');
  const ids = { typed: useId(), pick: useId() };
  const addable = openApps.filter((a) => !apps.includes(a));

  function add(entry: string): void {
    const next = addExcluded(apps, entry);
    if (next.length === apps.length) return;
    void save({ excludedApps: next }).then((saved) => saved && setTyped(''));
  }

  return (
    <fieldset className="field-group">
      <legend>{T.excludedLegend}</legend>
      <p className="hint">{T.excludedNote}</p>
      {apps.length === 0 ? (
        <p className="muted">{T.noApps}</p>
      ) : (
        <ul className="app-list">
          {apps.map((a) => (
            <li key={a}>
              <code>{a}</code>
              <button type="button" className="btn btn-quiet" aria-label={T.stopLeaving(a)} onClick={() => void save({ excludedApps: apps.filter((x) => x !== a) })}>
                {T.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="inline-form">
        <label htmlFor={ids.pick} className="sr-only">
          {T.addOpenLabel}
        </label>
        <select id={ids.pick} value="" disabled={addable.length === 0} onChange={(e) => add(e.target.value)}>
          <option value="">{addable.length === 0 ? T.noOtherApp : T.addOpenOption}</option>
          {addable.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          add(typed);
        }}
      >
        <label htmlFor={ids.typed} className="sr-only">
          {T.typedLabel}
        </label>
        <input id={ids.typed} type="text" value={typed} placeholder={T.typedPlaceholder} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        <button type="submit" className="btn" disabled={typed.trim() === ''}>
          {T.add}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => void save({ excludedApps: [...DEFAULT_EXCLUDED_APPS] })}>
          {T.restoreDefaults}
        </button>
      </form>
    </fieldset>
  );
}
