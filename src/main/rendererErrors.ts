import type { Log } from './logs';

/**
 * Errors the pages report about themselves (`IPC.logRenderer`). The renderer is untrusted, so a report from anything but
 * our own windows is dropped, each field is cut short, and a page stuck in an error loop is rate-limited rather than
 * allowed to fill the log.
 */

export const MAX_FIELD = 2000;
const WINDOW_MS = 60_000;

export interface RendererErrorGateDeps {
  log: Pick<Log, 'error' | 'warn'>;
  /** True only for our own control and overlay pages. */
  isOwn: (sender: unknown) => boolean;
  now: () => number;
  /** How many reports per sender per minute are written. Default 20. */
  perMinute?: number;
}

export interface RendererErrorGate {
  handle: (sender: unknown, payload: unknown) => void;
  /** Writes the "N more dropped" line for every sender whose minute is over. Call about once a minute; handle() also does it on the next report. */
  tick: () => void;
}

interface Bucket {
  start: number;
  written: number;
  dropped: number;
}

const senderId = (sender: unknown): number => {
  const id = typeof sender === 'object' && sender !== null ? (sender as { id?: unknown }).id : undefined;
  return typeof id === 'number' ? id : 0;
};

export function createRendererErrorGate(deps: RendererErrorGateDeps): RendererErrorGate {
  const perMinute = deps.perMinute ?? 20;
  const buckets = new Map<number, Bucket>();

  function close(id: number, b: Bucket): void {
    if (b.dropped > 0) deps.log.warn('renderer', `${b.dropped} more renderer errors dropped`);
    buckets.delete(id);
  }

  return {
    handle(sender, payload) {
      if (!deps.isOwn(sender)) return;
      if (typeof payload !== 'object' || payload === null) return;
      const { message, stack } = payload as { message?: unknown; stack?: unknown };
      if (typeof message !== 'string' || (stack !== undefined && typeof stack !== 'string')) return;

      const id = senderId(sender);
      const at = deps.now();
      let b = buckets.get(id);
      if (b && at - b.start >= WINDOW_MS) {
        close(id, b);
        b = undefined;
      }
      if (!b) {
        b = { start: at, written: 0, dropped: 0 };
        buckets.set(id, b);
      }
      if (b.written >= perMinute) {
        b.dropped++;
        return;
      }
      b.written++;
      deps.log.error('renderer', message.slice(0, MAX_FIELD), typeof stack === 'string' && stack !== '' ? stack.slice(0, MAX_FIELD) : undefined);
    },

    tick() {
      const at = deps.now();
      for (const [id, b] of [...buckets]) if (at - b.start >= WINDOW_MS) close(id, b);
    },
  };
}
