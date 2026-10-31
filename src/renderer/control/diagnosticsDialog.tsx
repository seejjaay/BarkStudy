import { useEffect, useState } from 'react';
import { ABOUT as T, COMMON as C } from '../../shared/i18n/en';
import { api, attempt, describe } from './api';
import { Modal } from './modal';
import { useToast } from './toast';

/** Shows the exact text that Copy will put on the clipboard, so nothing leaves the app unread. */
export function DiagnosticsDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api.call('diagnostics:get', undefined).then(
      (t) => live && setText(t),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  async function copy(): Promise<void> {
    const r = await attempt(api.call('diagnostics:copy', undefined));
    if (r.ok) toast(T.copied);
    else toast(describe(r.error), { kind: 'error' });
  }

  return (
    <Modal title={T.diagnosticsTitle} onClose={onClose}>
      <p className="hint">{T.diagnosticsNote}</p>
      <div className="field">
        <textarea rows={16} readOnly spellCheck={false} aria-label={T.diagnosticsLabel} value={text ?? (failed ? T.loadFailed : T.loading)} data-autofocus />
      </div>
      <div className="dialog-actions">
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          {C.close}
        </button>
        <button type="button" className="btn btn-primary" disabled={text === null} onClick={() => void copy()}>
          {T.copy}
        </button>
      </div>
    </Modal>
  );
}
