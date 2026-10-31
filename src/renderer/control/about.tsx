import { useState } from 'react';
import type { LinkId } from '../../shared/control';
import { ABOUT as T } from '../../shared/i18n/en';
import { api, attempt, describe } from './api';
import { DiagnosticsDialog } from './diagnosticsDialog';
import { useToast } from './toast';

const LINKS: { id: LinkId; label: string }[] = [
  { id: 'repo', label: T.links.repo },
  { id: 'releases', label: T.links.releases },
  { id: 'license', label: T.links.license },
];

export function AboutPage({ version, onRunSetup }: { version: string; onRunSetup: () => void }) {
  const toast = useToast();
  const [diagnosing, setDiagnosing] = useState(false);

  async function open(id: LinkId): Promise<void> {
    const r = await attempt(api.call('link:open', { id }));
    if (!r.ok) toast(describe(r.error), { kind: 'error' });
  }

  return (
    <section aria-labelledby="about-title" className="about">
      <header className="page-head">
        <h1 id="about-title">{T.title}</h1>
      </header>
      <div className="card-panel settings-section">
        <p>
          <strong>{T.version(version)}</strong>
        </p>
        <p>{T.blurb}</p>
        <p className="hint">{T.license}</p>
        <div className="actions">
          {LINKS.map((l) => (
            <button key={l.id} type="button" className="btn" onClick={() => void open(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card-panel settings-section">
        <h2>{T.problemTitle}</h2>
        <p className="hint">{T.problemHint}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setDiagnosing(true)}>
            {T.copyDiagnostics}
          </button>
          <button type="button" className="btn" onClick={() => void open('new-issue')}>
            {T.links['new-issue']}
          </button>
        </div>
      </div>
      <div className="card-panel settings-section">
        <h2>{T.setupTitle}</h2>
        <p className="hint">{T.setupHint}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onRunSetup}>
            {T.setupAgain}
          </button>
        </div>
      </div>
      {diagnosing && <DiagnosticsDialog onClose={() => setDiagnosing(false)} />}
    </section>
  );
}
