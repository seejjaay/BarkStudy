import type { LinkId } from '../../shared/control';
import { api, attempt, describe } from './api';
import { ONBOARDING_TEXT as T } from './text';
import { useToast } from './toast';

const LINKS: { id: LinkId; label: string }[] = [
  { id: 'repo', label: 'Project page on GitHub' },
  { id: 'releases', label: 'Releases' },
  { id: 'license', label: 'License' },
];

export function AboutPage({ version, onRunSetup }: { version: string; onRunSetup: () => void }) {
  const toast = useToast();

  async function open(id: LinkId): Promise<void> {
    const r = await attempt(api.call('link:open', { id }));
    if (!r.ok) toast(describe(r.error), { kind: 'error' });
  }

  return (
    <section aria-labelledby="about-title" className="about">
      <header className="page-head">
        <h1 id="about-title">About BarkStudy</h1>
      </header>
      <div className="card-panel settings-section">
        <p>
          <strong>BarkStudy {version}</strong>
        </p>
        <p>{T.aboutBlurb}</p>
        <p className="hint">{T.aboutLicense}</p>
        <div className="actions">
          {LINKS.map((l) => (
            <button key={l.id} type="button" className="btn" onClick={() => void open(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card-panel settings-section">
        <h2>Setup</h2>
        <p className="hint">Walk through the first-run screens again: personality, the way to stop him, privacy and the starter deck.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onRunSetup}>
            Run setup again
          </button>
        </div>
      </div>
    </section>
  );
}
