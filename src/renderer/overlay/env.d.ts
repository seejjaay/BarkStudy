import type { BarkOverlayApi } from '../../shared/ipc';

declare global {
  interface Window {
    barkOverlay: BarkOverlayApi;
  }
}
