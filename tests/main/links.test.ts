import { describe, expect, it } from 'vitest';
import { LINKS, resolveLink } from '../../src/main/links';

describe('the link allowlist', () => {
  it('every link is this project on GitHub over https', () => {
    for (const url of Object.values(LINKS)) expect(url.startsWith('https://github.com/seejjaay/BarkStudy')).toBe(true);
  });

  it('opens the new-issue form with nothing appended', () => {
    expect(resolveLink('new-issue')).toBe('https://github.com/seejjaay/BarkStudy/issues/new');
    expect(LINKS['new-issue'].startsWith(LINKS.repo + '/')).toBe(true);
    expect(LINKS['new-issue']).not.toMatch(/[?#]/);
  });

  it('resolves only its own ids', () => {
    expect(resolveLink('repo')).toBe(LINKS.repo);
    expect(resolveLink('releases')).toBe(LINKS.releases);
    expect(resolveLink('privacy')).toBe('https://github.com/seejjaay/BarkStudy/blob/main/PRIVACY.md');
    for (const bad of ['evil', '', '__proto__', 'constructor', 'toString', undefined, null, 5, {}, ['repo']]) {
      expect(resolveLink(bad)).toBeNull();
    }
  });
});
