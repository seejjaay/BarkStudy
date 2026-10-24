import type { Session, WebContents } from 'electron';

/** Every renderer window uses this in-memory session, so the network guard never touches main-process requests (the updater, later). */
export const UI_PARTITION = 'barkstudy-ui';

/**
 * The renderer may load only local files, devtools, and (in dev) the dev-server origin over http/ws.
 * Everything else, including data: and blob:, is refused.
 */
export function isAllowedUrl(url: string, devOrigin: string | null): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'file:' || u.protocol === 'devtools:') return true;
  if (devOrigin === null) return false;
  let dev: URL;
  try {
    dev = new URL(devOrigin);
  } catch {
    return false;
  }
  const protocols = dev.protocol === 'https:' ? ['https:', 'wss:'] : ['http:', 'ws:'];
  return u.host === dev.host && protocols.includes(u.protocol);
}

export function installNetworkGuard(ses: Session, devOrigin: string | null): void {
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedUrl(details.url, devOrigin) }));
}

/** No popups, no navigation away from allowed origins, no webviews. */
export function hardenWebContents(wc: WebContents, devOrigin: string | null): void {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url, devOrigin)) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
}
