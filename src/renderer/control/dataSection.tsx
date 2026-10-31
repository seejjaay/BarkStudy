import { useState } from 'react';
import { api, attempt, describe } from './api';
import { Modal } from './modal';
import { SETTINGS_TEXT } from './text';
import { useToast } from './toast';

type Confirming = 'import' | 'reset' | null;

/** Where the data lives, and the three whole-library actions. The two that overwrite anything ask first. */
export function DataSection({ dataDir, onDataChanged }: { dataDir: string; onDataChanged: () => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);

  async function openFolder(): Promise<void> {
    const r = await attempt(api.call('data:open-folder', undefined));
    if (!r.ok) toast(describe(r.error), { kind: 'error' });
  }

  async function exportAll(): Promise<void> {
    setBusy(true);
    const r = await attempt(api.call('data:export-all', undefined));
    setBusy(false);
    if (!r.ok) toast(describe(r.error), { kind: 'error' });
    else if (r.value) toast(SETTINGS_TEXT.exportDone(r.value.path));
  }

  async function importAll(): Promise<void> {
    setConfirming(null);
    setBusy(true);
    const r = await attempt(api.call('data:import-all', undefined));
    setBusy(false);
    if (!r.ok) toast(describe(r.error), { kind: 'error' });
    else if (r.value) {
      toast(SETTINGS_TEXT.importDone);
      onDataChanged();
    }
  }

  async function reset(): Promise<void> {
    setConfirming(null);
    setBusy(true);
    const r = await attempt(api.call('data:reset', undefined));
    setBusy(false);
    if (!r.ok) toast(describe(r.error), { kind: 'error' });
    else {
      toast(SETTINGS_TEXT.resetDone);
      onDataChanged();
    }
  }

  return (
    <section className="card-panel settings-section" aria-labelledby="settings-data">
      <h2 id="settings-data">Your data</h2>
      <p className="hint">
        Everything is stored on this PC, in <code>{dataDir}</code>. Nothing is sent anywhere.
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={() => void openFolder()}>
          Open data folder
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void exportAll()}>
          Export all…
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => setConfirming('import')}>
          Import all…
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirming('reset')}>
          Reset everything…
        </button>
      </div>
      <p className="hint">Export all saves one backup file with your decks, history and settings. Import all restores it. A running session blocks import and reset.</p>

      {confirming === 'import' && (
        <Modal title={SETTINGS_TEXT.importTitle} onClose={() => setConfirming(null)}>
          <p>{SETTINGS_TEXT.importBody}</p>
          <div className="dialog-actions">
            <span className="spacer" />
            <button type="button" className="btn btn-quiet" data-autofocus onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void importAll()}>
              Choose backup file…
            </button>
          </div>
        </Modal>
      )}
      {confirming === 'reset' && (
        <Modal title={SETTINGS_TEXT.resetTitle} onClose={() => setConfirming(null)}>
          <p>{SETTINGS_TEXT.resetBody}</p>
          <div className="dialog-actions">
            <span className="spacer" />
            <button type="button" className="btn btn-quiet" data-autofocus onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void reset()}>
              Reset everything
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
