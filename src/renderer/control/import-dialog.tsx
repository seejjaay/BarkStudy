import { useId, useState } from 'react';
import type { AppError, DeckSummary, ImportReport, Result } from '../../shared/control';
import { COMMON as C, DECKS } from '../../shared/i18n/en';
import { api, attempt } from './api';
import { Modal } from './modal';
import { deckLabel, errorText } from './text';
import type { SkippedRow } from '../../shared/deckParse';

const T = DECKS.importDialog;
const SHOW_SKIPPED = 100;

function SkippedList({ rows }: { rows: readonly SkippedRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="skipped">
      <p className="muted">{T.skippedCount(C.rows(rows.length))}</p>
      <table>
        <thead>
          <tr>
            <th scope="col">{T.line}</th>
            <th scope="col">{T.whyLeftOut}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, SHOW_SKIPPED).map((r) => (
            <tr key={`${r.line}-${r.reason}`}>
              <td>{r.line}</td>
              <td>{C.skipped[r.reason]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > SHOW_SKIPPED && <p className="muted">{T.andMore(rows.length - SHOW_SKIPPED)}</p>}
    </div>
  );
}

export function ImportDialog({
  decks,
  initialDeckId,
  onClose,
  onImported,
}: {
  decks: readonly DeckSummary[];
  /** Null starts on "new deck". */
  initialDeckId: string | null;
  onClose: () => void;
  onImported: (report: ImportReport, deckName: string) => void;
}) {
  const ids = { name: useId(), deck: useId(), text: useId(), err: useId() };
  const [target, setTarget] = useState<'new' | 'existing'>(initialDeckId !== null && decks.some((d) => d.id === initialDeckId) ? 'existing' : 'new');
  const [deckId, setDeckId] = useState(initialDeckId ?? decks[0]?.id ?? '');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [report, setReport] = useState<{ report: ImportReport; deckName: string } | null>(null);

  const targetId = target === 'new' ? null : deckId;

  function finish(result: Result<ImportReport | null>): void {
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.value === null) return; // cancelled in the file dialog
    setError(null);
    const r = result.value;
    const deckName = decks.find((d) => d.id === r.deckId)?.name ?? (name.trim() || T.yourNewDeck);
    onImported(r, deckName);
    if (r.skipped.length === 0 && r.duplicates === 0) onClose();
    else setReport({ report: r, deckName });
  }

  async function importText(): Promise<void> {
    setBusy(true);
    setError(null);
    finish(await attempt(api.call('deck:import-text', { deckId: targetId, name, text })));
  }

  async function importFile(): Promise<void> {
    setBusy(true);
    setError(null);
    finish(await attempt(api.call('deck:import-file', { deckId: targetId })));
  }

  if (report) {
    const r = report.report;
    return (
      <Modal title={T.finishedTitle} onClose={onClose}>
        <p>
          {T.addedBefore}<strong>{C.cards(r.added)}</strong>
          {T.addedAfter(report.deckName)}
          {r.duplicates > 0 && T.duplicates(C.rows(r.duplicates))}
        </p>
        <SkippedList rows={r.skipped} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" data-autofocus onClick={onClose}>
            {C.done}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={T.title} onClose={onClose}>
      <fieldset className="field-group">
        <legend>{T.addTo}</legend>
        <label className="radio">
          <input type="radio" name="target" checked={target === 'new'} onChange={() => setTarget('new')} /> {T.newDeckOption}
        </label>
        <label className="radio">
          <input type="radio" name="target" checked={target === 'existing'} disabled={decks.length === 0} onChange={() => setTarget('existing')} /> {T.existingDeckOption}
          {decks.length === 0 && <span className="muted">{T.noneYet}</span>}
        </label>
      </fieldset>

      {target === 'new' ? (
        <div className="field">
          <label htmlFor={ids.name}>{DECKS.deckName}</label>
          <input id={ids.name} type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-autofocus autoComplete="off" />
          <p className="hint">{T.fileNameNote}</p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor={ids.deck}>{T.deck}</label>
          <select id={ids.deck} value={deckId} onChange={(e) => setDeckId(e.target.value)} data-autofocus>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {deckLabel(d)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor={ids.text}>{T.pasteLabel}</label>
        <textarea
          id={ids.text}
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={error ? ids.err : undefined}
          spellCheck={false}
          placeholder={T.pastePlaceholder}
        />
        <p className="hint">{T.pasteNote}</p>
      </div>

      {error && (
        <div id={ids.err} className="banner banner-error" role="alert">
          <strong>{errorText(error)}</strong>
          {error.code !== 'no-valid-rows' && error.message !== errorText(error) && <span className="muted"> {error.message}</span>}
          {error.skipped && <SkippedList rows={error.skipped} />}
        </div>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void importFile()}>
          {T.chooseFile}
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          {C.cancel}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || text.trim() === '' || (target === 'existing' && deckId === '')} onClick={() => void importText()}>
          {busy ? T.importing : T.importPasted}
        </button>
      </div>
    </Modal>
  );
}
