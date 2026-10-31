import { describe, expect, it, vi } from 'vitest';
import { createLog, type LogFs } from '../../src/main/logs';

/** Files in memory; `failNext` makes the next appends reject. */
function memoryFs(): LogFs & { files: Map<string, string>; failNext: number } {
  const files = new Map<string, string>();
  const fs = {
    files,
    failNext: 0,
    mkdir: () => Promise.resolve(),
    append: (path: string, text: string) => {
      if (fs.failNext > 0) {
        fs.failNext--;
        return Promise.reject(new Error('disk full'));
      }
      files.set(path, (files.get(path) ?? '') + text);
      return Promise.resolve();
    },
    size: (path: string) => Promise.resolve(Buffer.byteLength(files.get(path) ?? '')),
    rename: (from: string, to: string) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
      return Promise.resolve();
    },
    remove: (path: string) => {
      files.delete(path);
      return Promise.resolve();
    },
  };
  return fs;
}

const T0 = Date.UTC(2026, 10, 1, 9, 30, 15, 120);
const slashed = (path: string) => path.replace(/\\/g, '/');
const fileNames = (fs: { files: Map<string, string> }) => [...fs.files.keys()].map((p) => slashed(p).split('/').pop()).sort();
const textOf = (fs: { files: Map<string, string> }, name: string): string => {
  for (const [p, t] of fs.files) if (slashed(p).endsWith(`/${name}`)) return t;
  return '';
};

describe('createLog', () => {
  it('writes lines in order, in the exact format', async () => {
    const fs = memoryFs();
    const log = createLog({ dir: 'logs', now: () => T0, fs });
    log.info('main', 'started');
    log.warn('hotkey', 'taken');
    log.error('store', 'write failed', new Error('boom'));
    await log.flush();
    const lines = textOf(fs, 'app.log').split('\n');
    expect(lines[0]).toBe('2026-11-01T09:30:15.120Z INFO  main: started');
    expect(lines[1]).toBe('2026-11-01T09:30:15.120Z WARN  hotkey: taken');
    expect(lines[2]).toBe('2026-11-01T09:30:15.120Z ERROR store: write failed');
    expect(lines[3]).toBe('  Error: boom');
    expect(lines[4]).toMatch(/^ {6}at /); // the stack, indented by two on top of its own four
  });

  it('keeps a message on one line', async () => {
    const fs = memoryFs();
    const log = createLog({ dir: 'logs', now: () => T0, fs });
    log.info('main', 'two\nlines');
    await log.flush();
    expect(textOf(fs, 'app.log')).toBe('2026-11-01T09:30:15.120Z INFO  main: two lines\n');
  });

  it('rolls over at maxBytes and keeps only app.log, app.1.log and app.2.log', async () => {
    const fs = memoryFs();
    const log = createLog({ dir: 'logs', maxBytes: 200, files: 3, now: () => T0, fs });
    const line = 'x'.repeat(40);
    for (let i = 0; i < 50; i++) log.info('a', line); // 50 lines of about 74 bytes
    await log.flush();
    expect(fileNames(fs)).toEqual(['app.1.log', 'app.2.log', 'app.log']);
    const oneLine = '2026-11-01T09:30:15.120Z INFO  a: '.length + 40 + 1;
    for (const [, text] of fs.files) expect(Buffer.byteLength(text)).toBeLessThanOrEqual(200 + oneLine);
  });

  it('never throws on a write that rejects, and retries it with the next line', async () => {
    const fs = memoryFs();
    fs.failNext = 1;
    const log = createLog({ dir: 'logs', now: () => T0, fs });
    expect(() => log.error('a', 'first')).not.toThrow();
    await log.flush();
    expect(textOf(fs, 'app.log')).toBe('');
    log.info('a', 'second');
    await log.flush();
    const messages = textOf(fs, 'app.log')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split(': ')[1]);
    expect(messages).toEqual(['first', 'second']);
  });

  it('tail returns only warn and error entries, the last n, from memory', () => {
    const log = createLog({ dir: 'logs', now: () => T0, fs: memoryFs() });
    log.info('a', 'one');
    log.warn('a', 'two');
    log.error('a', 'three');
    log.error('a', 'four', new Error('x'));
    const tail = log.tail(2, 'warn');
    expect(tail).toHaveLength(2);
    expect(tail[0]).toContain('ERROR a: three');
    expect(tail[1]).toContain('ERROR a: four');
    expect(tail[1]).toContain('\n  Error: x');
    expect(log.tail(10, 'warn')).toHaveLength(3);
    expect(log.tail(10, 'error')).toHaveLength(2);
    expect(log.tail(0, 'warn')).toEqual([]);
  });

  it('keeps the last 500 entries in memory', () => {
    const log = createLog({ dir: 'logs', now: () => T0, fs: memoryFs() });
    for (let i = 0; i < 600; i++) log.warn('a', `m${i}`);
    const all = log.tail(1000, 'warn');
    expect(all).toHaveLength(500);
    expect(all[0]).toContain('m100');
  });

  it('flush gives up after its timeout when a write never settles, so quitting is not held up', async () => {
    vi.useFakeTimers();
    try {
      const fs = memoryFs();
      fs.append = () => new Promise<void>(() => undefined);
      const log = createLog({ dir: 'logs', now: () => T0, fs });
      log.error('a', 'stuck');
      let done = false;
      void log.flush().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(1999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a flush that finishes in time does not wait for its timeout', async () => {
    vi.useFakeTimers();
    try {
      const log = createLog({ dir: 'logs', now: () => T0, fs: memoryFs() });
      log.info('a', 'x');
      await log.flush(); // would hang here if it waited on the fake clock
    } finally {
      vi.useRealTimers();
    }
  });

  it('echoes entries when asked to', () => {
    const seen: string[] = [];
    const log = createLog({ dir: 'logs', now: () => T0, fs: memoryFs(), echo: (e) => seen.push(e) });
    log.warn('a', 'hello');
    expect(seen).toEqual(['2026-11-01T09:30:15.120Z WARN  a: hello']);
  });
});
