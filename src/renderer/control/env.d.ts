/// <reference types="vite/client" />
import type { BarkControlApi } from '../../shared/control';

declare global {
  interface Window {
    barkControl: BarkControlApi;
  }
}
