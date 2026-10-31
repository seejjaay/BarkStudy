import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A small rolling app log: `app.log`, then `app.1.log` (older) up to `files` of them, each about `maxBytes`. Writing is
 * fire-and-forget and never throws; a line that cannot be written is kept and tried again with the next one. The last
 * entries are also kept in memory, so the diagnostics bundle can read them without touching the files.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** The file operations the log needs, so tests can use memory and make them fail. */
export interface LogFs {
  mkdir: (dir: string) => Promise<void>;
  append: (path: string, text: string) => Promise<void>;
  /** The file's size in bytes, or 0 if there is no such file. */
  size: (path: string) => Promise<number>;
  rename: (from: string, to: string) => Promise<void>;
  /** Removes the file; a missing file is not an error. */
  remove: (path: string) => Promise<void>;
}

export const nodeLogFs: LogFs = {
  mkdir: async (dir) => void (await mkdir(dir, { recursive: true })),
  append: (path, text) => appendFile(path, text, 'utf8'),
  size: async (path) => {
    try {
      return (await stat(path)).size;
    } catch {
      return 0;
    }
  },
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path, { force: true }),
};

export interface Log {
  error: (area: string, message: string, err?: unknown) => void;
  warn: (area: string, message: string) => void;
  info: (area: string, message: string) => void;
  /** The last `n` entries at `min` or worse, oldest first. An entry with a stack is one string with newlines. */
  tail: (n: number, min: 'warn' | 'error') => string[];
  /**
   * Resolves when everything logged so far has been written, when a write failed (the lines wait for the next try), or
   * after `timeoutMs` (default 2,000) if the disk hangs, so a caller such as quitting is never held up for good.
   */
  flush: (timeoutMs?: number) => Promise<void>;
}

export interface LogOptions {
  dir: string;
  /** A file is closed once the next line would take it past this. Default 1,000,000. */
  maxBytes?: number;
  /** How many files to keep, the live one included. Default 3. */
  files?: number;
  now?: () => number;
  fs?: LogFs;
  /** Called with each entry as well as writing it (e2e and development). */
  echo?: (entry: string) => void;
}

const RING = 500;
/** Lines waiting for a disk that keeps failing; the oldest go first. */
const MAX_PENDING = 1000;
const RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

const stackOf = (err: unknown): string | null => {
  if (err === undefined || err === null) return null;
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  if (typeof err === 'string' || typeof err === 'number' || typeof err === 'boolean') return String(err);
  return `(a thrown ${typeof err}, not an Error)`;
};

export function createLog(opts: LogOptions): Log {
  const fs = opts.fs ?? nodeLogFs;
  const now = opts.now ?? (() => Date.now());
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const files = Math.max(1, opts.files ?? 3);
  const nameOf = (i: number) => join(opts.dir, i === 0 ? 'app.log' : `app.${i}.log`);

  const ring: { level: LogLevel; text: string }[] = [];
  const pending: string[] = [];
  let size: number | null = null; // the live file's size, read once and then tracked
  let made = false;
  let draining: Promise<void> | null = null;
  let failed = false;

  async function rotate(): Promise<void> {
    await fs.remove(nameOf(files - 1));
    for (let i = files - 2; i >= 0; i--) {
      if ((await fs.size(nameOf(i))) > 0) await fs.rename(nameOf(i), nameOf(i + 1));
    }
    size = 0;
  }

  async function drain(): Promise<void> {
    failed = false;
    try {
      if (!made) {
        await fs.mkdir(opts.dir);
        made = true;
      }
      while (pending.length > 0) {
        const line = pending[0] as string;
        const bytes = Buffer.byteLength(line);
        size ??= await fs.size(nameOf(0));
        if (size > 0 && size + bytes > maxBytes) await rotate();
        await fs.append(nameOf(0), line);
        size += bytes;
        pending.shift();
      }
    } catch {
      failed = true;
      size = null; // the file may not be what it was; look again next time
    }
  }

  function kick(): Promise<void> {
    if (draining === null) {
      draining = drain().finally(() => {
        draining = null;
        if (pending.length > 0 && !failed) void kick();
      });
    }
    return draining;
  }

  function write(level: LogLevel, area: string, message: string, err?: unknown): void {
    const head = `${new Date(now()).toISOString()} ${level.toUpperCase().padEnd(5)} ${area}: ${message.replace(/\r?\n/g, ' ')}`;
    const stack = stackOf(err);
    const entry = stack === null ? head : `${head}\n${stack.split(/\r?\n/).map((l) => `  ${l}`).join('\n')}`;
    ring.push({ level, text: entry });
    if (ring.length > RING) ring.shift();
    opts.echo?.(entry);
    pending.push(`${entry}\n`);
    if (pending.length > MAX_PENDING) pending.shift();
    void kick();
  }

  return {
    error: (area, message, err) => write('error', area, message, err),
    warn: (area, message) => write('warn', area, message),
    info: (area, message) => write('info', area, message),
    tail: (n, min) => {
      const wanted = ring.filter((e) => RANK[e.level] >= RANK[min]);
      return wanted.slice(Math.max(0, wanted.length - Math.max(0, n))).map((e) => e.text);
    },
    async flush(timeoutMs = 2000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const written = (async () => {
        do {
          await kick();
        } while (pending.length > 0 && !failed);
      })();
      const gaveUp = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      try {
        await Promise.race([written, gaveUp]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
