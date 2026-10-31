import { useEffect, useReducer, useRef, useState } from 'react';
import type { Cap } from '../../engine/types';
import { acceleratorLabel } from '../../shared/accelerator';
import type { LibrarySnapshot, SettingsView } from '../../shared/control';
import { SAMPLE_DECK } from '../../shared/sampleDeck';
import { api, attempt, describe } from './api';
import { DogPicture } from './dogPicture';
import { HotkeyField, RadioCards } from './formParts';
import { canAdvance, initialFlow, reduce, visibleSteps } from './onboardingFlow';
import { CAP_OPTIONS, PRESET_OPTIONS } from './settingsModel';
import { ONBOARDING_TEXT as T, SETTINGS_TEXT } from './text';
import { useToast } from './toast';

interface Props {
  snapshot: LibrarySnapshot;
  leaveIt: { conflict: boolean; label: string };
  /** How many times main has reported a Leave it press with no session; each increase is one press. */
  presses: number;
  /** Re-opened from About: Cancel leaves without changing anything. */
  again: boolean;
  onFinished: (deckId: string | null) => Promise<void>;
  onCancel: () => void;
}

/** The full-window first-run flow. It loads the saved settings first, so running it again starts from the user's own choices. */
export function Onboarding(props: Props) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.call('settings:get', undefined).then(setView, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  if (error !== null) {
    return (
      <div className="onboarding">
        <div className="empty" role="alert">
          <h1>Couldn&apos;t start setup</h1>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }
  if (view === null) {
    return (
      <div className="onboarding">
        <p className="muted" role="status">
          Loading…
        </p>
      </div>
    );
  }
  return <OnboardingFlow view={view} {...props} />;
}

function OnboardingFlow({ view, snapshot, leaveIt, presses, again, onFinished, onCancel }: Props & { view: SettingsView }) {
  const toast = useToast();
  const hasSample = snapshot.decks.some((d) => d.name.toLowerCase() === SAMPLE_DECK.name.toLowerCase());
  const [flow, dispatch] = useReducer(reduce, undefined, () => initialFlow(view.settings, view.loginItem.available, hasSample));
  const [login, setLogin] = useState(view.loginItem.on);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const steps = visibleSteps(flow.loginAvailable);
  const index = steps.indexOf(flow.step);
  const last = index === steps.length - 1;
  const still = view.settings.reducedMotion === 'on' || (view.settings.reducedMotion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Each step announces itself: focus goes to its heading.
  useEffect(() => heading.current?.focus(), [flow.step]);

  // Main turns a Leave it press with no session into an event only while this step is up.
  useEffect(() => {
    if (flow.step !== 'escape') return;
    void api.call('onboarding:practice', { on: true }).catch(() => undefined);
    return () => void api.call('onboarding:practice', { on: false }).catch(() => undefined);
  }, [flow.step]);
  const seenPresses = useRef(presses);
  useEffect(() => {
    if (presses === seenPresses.current) return;
    seenPresses.current = presses;
    if (flow.step === 'escape') dispatch({ type: 'leaveItPressed' });
  }, [presses, flow.step]);
  useEffect(() => dispatch({ type: 'leaveItConflict', on: leaveIt.conflict }), [leaveIt.conflict]);

  async function finish(): Promise<void> {
    setBusy(true);
    setError(null);
    const r = await attempt(api.call('onboarding:finish', { cap: flow.cap, preset: flow.preset, updateChecks: flow.updateChecks, sampleDeck: flow.sampleDeck }));
    if (!r.ok) {
      setBusy(false);
      setError(`${T.failed} ${describe(r.error)}`);
      return;
    }
    await onFinished(r.value.deckId);
  }

  async function chooseLogin(on: boolean): Promise<void> {
    const r = await attempt(api.call('settings:login-item', { on }));
    if (!r.ok) {
      toast(describe(r.error), { kind: 'error' });
      return;
    }
    setLogin(r.value.on);
    toast(r.value.on ? SETTINGS_TEXT.loginOn : SETTINGS_TEXT.loginOff);
  }

  const rebindLeaveIt = async (accelerator: string) => {
    const r = await attempt(api.call('settings:hotkey', { which: 'leaveIt', accelerator }));
    if (r.ok) toast(`Leave it is now ${acceleratorLabel(accelerator)}.`);
    return r;
  };

  return (
    <div className="onboarding">
      <main id="onboarding-main" className="onboarding-card">
        <p className="eyebrow">
          Step {index + 1} of {steps.length}
        </p>
        <div className="step-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s} className={i === index ? 'dot dot-now' : i < index ? 'dot dot-done' : 'dot'} />
          ))}
        </div>
        <h1 ref={heading} tabIndex={-1}>
          {T.title[flow.step]}
        </h1>

        {flow.step === 'meet' && (
          <>
            <DogPicture still={still} />
            {T.meet.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </>
        )}

        {flow.step === 'personality' && (
          <>
            <RadioCards<Cap> legend="How far Pandesal may go" value={flow.cap} options={CAP_OPTIONS} onChange={(cap) => dispatch({ type: 'set', patch: { cap } })} />
            <RadioCards legend="Personality" value={flow.preset} options={PRESET_OPTIONS} onChange={(preset) => dispatch({ type: 'set', patch: { preset } })} />
            <p className="hint">You can change both later in Settings.</p>
          </>
        )}

        {flow.step === 'escape' && (
          <>
            <p>{T.escapeEsc}</p>
            {leaveIt.conflict ? (
              <div className="banner banner-warn" role="status">
                <span>{T.escapeTaken(acceleratorLabel(leaveIt.label))}</span>
              </div>
            ) : (
              <p>{T.escapeLeaveIt(acceleratorLabel(leaveIt.label))}</p>
            )}
            {leaveIt.conflict && <HotkeyField label="Leave it shortcut" accelerator={leaveIt.label} onCommit={rebindLeaveIt} />}
            <p role="status" className={flow.leaveItSeen ? 'practice practice-done' : 'practice'}>
              {flow.leaveItSeen ? `✓ ${T.escapeDone}` : T.escapeWaiting}
            </p>
            {leaveIt.conflict && !flow.leaveItSeen && (
              <button type="button" className="btn" onClick={() => dispatch({ type: 'continueAnyway' })}>
                {T.continueAnyway}
              </button>
            )}
          </>
        )}

        {flow.step === 'privacy' && (
          <>
            {T.privacy.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <label className="radio">
              <input type="checkbox" checked={flow.updateChecks} onChange={(e) => dispatch({ type: 'set', patch: { updateChecks: e.target.checked } })} />
              Check for updates
            </label>
            <p className="hint">{SETTINGS_TEXT.updatesNote}</p>
          </>
        )}

        {flow.step === 'login' && (
          <label className="radio">
            <input type="checkbox" checked={login} onChange={(e) => void chooseLogin(e.target.checked)} />
            {T.login}
          </label>
        )}

        {flow.step === 'sample' && (
          <>
            {hasSample ? (
              <p>{T.sampleHave}</p>
            ) : (
              <label className="radio">
                <input type="checkbox" checked={flow.sampleDeck} onChange={(e) => dispatch({ type: 'set', patch: { sampleDeck: e.target.checked } })} />
                {T.sample}
              </label>
            )}
          </>
        )}

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {!canAdvance(flow) && <p className="reason">Next is off until Leave it has been pressed once, or you choose to go on without it.</p>}

        <footer className="onboarding-actions">
          {index > 0 && (
            <button type="button" className="btn" disabled={busy} onClick={() => dispatch({ type: 'back' })}>
              Back
            </button>
          )}
          <span className="spacer" />
          {again ? (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>
              {T.cancel}
            </button>
          ) : (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void finish()}>
              {T.skip}
            </button>
          )}
          {last ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void finish()}>
              {T.finish}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!canAdvance(flow)} onClick={() => dispatch({ type: 'next' })}>
              Next
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}
