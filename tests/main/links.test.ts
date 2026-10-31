import { describe, expect, it } from 'vitest';
import { LINKS, resolveLink } from '../../src/main/links';

describe('the link allowlist', () => {
  it('every link is this project on GitHub over https', () => {
    for (const url of Object.values(LINKS)) expect(url.startsWith('https://github.com/seejjaay/BarkStudy')).toBe(true);
  });

  it('resolves only its own ids', () => {
    expect(resolveLink('repo')).toBe(LINKS.repo);
    expect(resolveLink('releases')).toBe(LINKS.releases);
    for (const bad of ['evil', '', '__proto__', 'constructor', 'toString', undefined, null, 5, {}, ['repo']]) {
      expect(resolveLink(bad)).toBeNull();
    }
  });
});
