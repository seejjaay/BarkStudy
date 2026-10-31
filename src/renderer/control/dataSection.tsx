import { useState } from 'react';
import { COMMON as C, SETTINGS } from '../../shared/i18n/en';
import { api, attempt, describe } from './api';
import { Modal } from './modal';
import { useToast } from './toast';

const T = SETTINGS.data;

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
    else if (r.value) toast(T.exportDone(r.value.path));
  }

  async function importAll(): Promise<void> {
    setConfirming(null);
    setBusy(true);
    const r = await attempt(api.call('data:import-all', undefined));
    setBusy(false);
    if (!r.ok) toast(describe(r.error), { kind: 'error' });
    else if (r.value) {
      toast(T.importDone);
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
      toast(T.resetDone);
      onDataChanged();
    }
  }

  return (
    <section className="card-panel settings-section" aria-labelledby="settings-data">
      <h2 id="settings-data">{T.title}</h2>
      <p className="hint">
        {T.storedBefore}<code>{dataDir}</code>{T.storedAfter}
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={() => void openFolder()}>
          {T.openFolder}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void exportAll()}>
          {T.exportAll}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => setConfirming('import')}>
          {T.importAll}
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirming('reset')}>
          {T.resetAll}
        </button>
      </div>
      <p className="hint">{T.note}</p>

      {confirming === 'import' && (
        <Modal title={T.importTitle} onClose={() => setConfirming(null)}>
          <p>{T.importBody}</p>
          <div className="dialog-actions">
            <span className="spacer" />
            <button type="button" className="btn btn-quiet" data-autofocus onClick={() => setConfirming(null)}>
              {C.cancel}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void importAll()}>
              {T.chooseBackup}
            </button>
          </div>
        </Modal>
      )}
      {confirming === 'reset' && (
        <Modal title={T.resetTitle} onClose={() => setConfirming(null)}>
          <p>{T.resetBody}</p>
          <div className="dialog-actions">
            <span className="spacer" />
            <button type="button" className="btn btn-quiet" data-autofocus onClick={() => setConfirming(null)}>
              {C.cancel}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void reset()}>
              {T.reset}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
