import { describe, expect, it } from 'vitest';
import { STEPS, canAdvance, initialFlow, reduce, shouldOnboard, visibleSteps, type Action, type Flow } from '../../src/renderer/control/onboardingFlow';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

const start = (over: Partial<Flow> = {}): Flow => ({ ...initialFlow(DEFAULT_SETTINGS, true, false), ...over });
const run = (f: Flow, ...actions: Action[]): Flow => actions.reduce(reduce, f);

describe('shouldOnboard: only a real first run shows it', () => {
  const ready = (onboarded: boolean, notices: { store: string; kind: string }[] = []) => shouldOnboard({ status: 'ready' }, { onboarded, notices });

  it('shows on a loaded snapshot that has not been onboarded', () => {
    expect(ready(false)).toBe(true);
  });

  it('never shows while loading, after a failed load, or once done', () => {
    expect(shouldOnboard({ status: 'loading' }, null)).toBe(false);
    expect(shouldOnboard({ status: 'error' }, null)).toBe(false);
    expect(shouldOnboard({ status: 'loading' }, { onboarded: false, notices: [] })).toBe(false);
    expect(shouldOnboard({ status: 'error' }, { onboarded: false, notices: [] })).toBe(false);
    expect(ready(true)).toBe(false);
  });

  it('never shows when the settings file was damaged or could not be read: that is not a first run', () => {
    expect(ready(false, [{ store: 'settings', kind: 'unavailable' }])).toBe(false);
    expect(ready(false, [{ store: 'settings', kind: 'recovered' }])).toBe(false);
  });

  it('is not put off by a problem with some other file', () => {
    expect(ready(false, [{ store: 'history', kind: 'recovered' }])).toBe(true);
  });
});

describe('the starting point', () => {
  it('begins at the first step, filled in from the current settings', () => {
    const f = initialFlow({ ...DEFAULT_SETTINGS, cap: 2, preset: 'calm', updateChecks: false }, true, false);
    expect(f).toMatchObject({ step: 'meet', cap: 2, preset: 'calm', updateChecks: false, leaveItSeen: false, leaveItBlocked: false });
  });

  it('offers the starter deck only when it is not already there', () => {
    expect(initialFlow(DEFAULT_SETTINGS, true, false).sampleDeck).toBe(true);
    expect(initialFlow(DEFAULT_SETTINGS, true, true).sampleDeck).toBe(false);
  });
});

describe('moving between steps', () => {
  it('walks forward through every step in order and stops at the end', () => {
    let f = start({ leaveItSeen: true });
    const seen = [f.step];
    for (let i = 0; i < STEPS.length + 2; i++) {
      f = reduce(f, { type: 'next' });
      if (seen[seen.length - 1] !== f.step) seen.push(f.step);
    }
    expect(seen).toEqual([...STEPS]);
    expect(reduce(f, { type: 'next' }).step).toBe(f.step);
  });

  it('back from the first step stays put, and back from a later step goes one step back', () => {
    expect(reduce(start(), { type: 'back' }).step).toBe('meet');
    expect(run(start(), { type: 'next' }, { type: 'next' }, { type: 'back' }).step).toBe('personality');
  });

  it('skips the start-with-Windows step where it is not offered', () => {
    expect(visibleSteps(false)).not.toContain('login');
    expect(visibleSteps(true)).toContain('login');
    const f = start({ step: 'privacy', loginAvailable: false });
    expect(reduce(f, { type: 'next' }).step).toBe('sample');
    expect(reduce(start({ step: 'sample', loginAvailable: false }), { type: 'back' }).step).toBe('privacy');
  });

  it('going back does not forget that Leave it was pressed', () => {
    const f = run(start({ step: 'escape' }), { type: 'leaveItPressed' }, { type: 'back' }, { type: 'next' });
    expect(f).toMatchObject({ step: 'escape', leaveItSeen: true });
  });
});

describe('the Leave it practice step', () => {
  it('will not go on until Leave it was pressed once', () => {
    const f = start({ step: 'escape' });
    expect(canAdvance(f)).toBe(false);
    expect(reduce(f, { type: 'next' }).step).toBe('escape');
    expect(canAdvance(reduce(f, { type: 'leaveItPressed' }))).toBe(true);
  });

  it('goes on after "continue anyway", and a conflict alone does not let it through', () => {
    const f = run(start({ step: 'escape' }), { type: 'leaveItConflict', on: true });
    expect(f.leaveItBlocked).toBe(true);
    expect(canAdvance(f)).toBe(false);
    expect(canAdvance(reduce(f, { type: 'continueAnyway' }))).toBe(true);
    expect(canAdvance(run(f, { type: 'leaveItConflict', on: false }))).toBe(false);
  });

  it('every other step can always go on', () => {
    for (const step of STEPS.filter((s) => s !== 'escape')) expect(canAdvance(start({ step })), step).toBe(true);
  });
});

describe('the choices', () => {
  it('changing one leaves the others alone', () => {
    const f = reduce(start(), { type: 'set', patch: { cap: 3 } });
    expect(f).toMatchObject({ cap: 3, preset: 'classic', updateChecks: true, sampleDeck: true });
    expect(reduce(f, { type: 'set', patch: { preset: 'calm', sampleDeck: false } })).toMatchObject({ cap: 3, preset: 'calm', sampleDeck: false });
  });
});
