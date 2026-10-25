import { useId, useState } from 'react';
import type { AppError, DeckSummary, ImportReport, Result } from '../../shared/control';
import { api, attempt } from './api';
import { Modal } from './modal';
import { SKIP_TEXT, deckLabel, errorText, plural } from './text';
import type { SkippedRow } from '../../shared/deckParse';

const SHOW_SKIPPED = 100;

function SkippedList({ rows }: { rows: readonly SkippedRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="skipped">
      <p className="muted">{plural(rows.length, 'row')} could not be used:</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Why it was left out</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, SHOW_SKIPPED).map((r) => (
            <tr key={`${r.line}-${r.reason}`}>
              <td>{r.line}</td>
              <td>{SKIP_TEXT[r.reason]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > SHOW_SKIPPED && <p className="muted">…and {rows.length - SHOW_SKIPPED} more.</p>}
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
    const deckName = decks.find((d) => d.id === r.deckId)?.name ?? (name.trim() || 'your new deck');
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
      <Modal title="Import finished" onClose={onClose}>
        <p>
          Added <strong>{plural(r.added, 'card')}</strong> to {report.deckName}.
          {r.duplicates > 0 && ` ${plural(r.duplicates, 'row')} matched cards already in the deck, so they were not added again.`}
        </p>
        <SkippedList rows={r.skipped} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" data-autofocus onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Import cards" onClose={onClose}>
      <fieldset className="field-group">
        <legend>Add the cards to</legend>
        <label className="radio">
          <input type="radio" name="target" checked={target === 'new'} onChange={() => setTarget('new')} /> A new deck
        </label>
        <label className="radio">
          <input type="radio" name="target" checked={target === 'existing'} disabled={decks.length === 0} onChange={() => setTarget('existing')} /> An existing deck
          {decks.length === 0 && <span className="muted"> (you have none yet)</span>}
        </label>
      </fieldset>

      {target === 'new' ? (
        <div className="field">
          <label htmlFor={ids.name}>Deck name</label>
          <input id={ids.name} type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-autofocus autoComplete="off" />
          <p className="hint">A file you choose uses its own file name instead.</p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor={ids.deck}>Deck</label>
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
        <label htmlFor={ids.text}>Paste cards</label>
        <textarea
          id={ids.text}
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={error ? ids.err : undefined}
          spellCheck={false}
          placeholder={'One card per line: front, then back.\nbonjour,hello\nmerci\tthank you'}
        />
        <p className="hint">Works with CSV, tab-separated text from Quizlet or Anki, and rows copied from a spreadsheet.</p>
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
          Choose a file…
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || text.trim() === '' || (target === 'existing' && deckId === '')} onClick={() => void importText()}>
          {busy ? 'Importing…' : 'Import pasted text'}
        </button>
      </div>
    </Modal>
  );
}
