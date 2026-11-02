import type { LinkId } from '../shared/control';

/**
 * The only addresses the app ever opens in a browser. The control window asks by id, never by address, so nothing it
 * sends (and nothing a user types) can reach `shell.openExternal`, and no user data can end up in a URL.
 */
export const LINKS: Record<LinkId, string> = {
  repo: 'https://github.com/seejjaay/BarkStudy',
  releases: 'https://github.com/seejjaay/BarkStudy/releases',
  license: 'https://github.com/seejjaay/BarkStudy/blob/main/LICENSE',
  privacy: 'https://github.com/seejjaay/BarkStudy/blob/main/PRIVACY.md',
  'new-issue': 'https://github.com/seejjaay/BarkStudy/issues/new',
};

/** The address for a link id, or null for anything that is not one of ours. */
export function resolveLink(id: unknown): string | null {
  return typeof id === 'string' && Object.hasOwn(LINKS, id) ? LINKS[id as LinkId] : null;
}
