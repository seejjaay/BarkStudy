import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/**
 * One JSON file per store under the user-data folder, written atomically (temp file, flush, rename), versioned with a
 * `schemaVersion`, migrated step by step with a rolling backup first, and never silently replaced by an empty store.
 */

/** One step: data as version N wrote it → data as version N+1 expects it. Must be pure. */
export type Migration = (old: unknown) => unknown;

export interface StoreDef<T> {
  /** File name without extension. */
  name: string;
  /** `migrations[i]` upgrades version i+1 to i+2, so the current version is `migrations.length + 1`. */
  migrations: readonly Migration[];
  fallback: () => T;
  /** Shape check for stored data: lenient about extra fields, strict about types. */
  validate: (v: unknown) => v is T;
}

export type ReadResult<T> =
  /** Current version, read as is. */
  | { status: 'ok'; value: T }
  /** No file yet; `value` is the fallback and nothing has been written. */
  | { status: 'created'; value: T }
  /** An older file was backed up, migrated and rewritten. */
  | { status: 'migrated'; value: T; from: number }
  /** The file was unusable; it was set aside under backups/ and `value` comes from the newest usable backup or the fallback. */
  | { status: 'recovered'; value: T; reason: 'unparseable' | 'invalid-data'; source: 'backup' | 'fallback' }
  /** Nothing was changed on disk. The caller must not write this store until the cause is dealt with. */
  | { status: 'error'; error: 'unreadable' | 'too-new' | 'migration-failed' | 'backup-failed' | 'write-failed'; version?: number; detail: string };

/** The file operations storage needs, so tests can make them fail. */
export interface FsOps {
  readFile: (path: string) => Promise<string>;
  /** Write, flush to disk, close. */
  writeAndSync: (path: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  /** Fails if `to` exists when `exclusive`. */
  copyFile: (from: string, to: string, exclusive: boolean) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
  unlink: (path: string) => Promise<void>;
}

export const nodeFs: FsOps = {
  readFile: (path) => fsp.readFile(path, 'utf8'),
  async writeAndSync(path, data) {
    const handle = await fsp.open(path, 'w');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => fsp.rename(from, to),
  copyFile: (from, to, exclusive) => fsp.copyFile(from, to, exclusive ? fsp.constants.COPYFILE_EXCL : 0),
  mkdir: async (path) => void (await fsp.mkdir(path, { recursive: true })),
  readdir: (path) => fsp.readdir(path),
  unlink: (path) => fsp.unlink(path),
};

export interface Storage {
  read: <T>(def: StoreDef<T>) => Promise<ReadResult<T>>;
  /** Throws if `data` does not validate or the file cannot be written; the previous file is then untouched. */
  write: <T>(def: StoreDef<T>, data: T) => Promise<void>;
  /** Copies the store's current file into backups/ (oldest beyond the keep limit are dropped) and leaves it in place. Nothing to copy is not an error. */
  backup: <T>(def: StoreDef<T>) => Promise<void>;
}

export interface StorageOptions {
  fs?: FsOps;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Pre-migration backups (and corrupt-file copies) kept per store. Default 5. */
  keepBackups?: number;
  /** Backups taken before a restore or reset (`backup()`), kept apart from the ones above so they are not pushed out by them. Default 20. */
  keepReplaceBackups?: number;
}

interface Envelope {
  schemaVersion: number;
  data: unknown;
}

const RENAME_RETRIES = 6;
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseEnvelope(text: string): Envelope | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(v) || !Number.isInteger(v['schemaVersion']) || (v['schemaVersion'] as number) < 1 || !('data' in v)) return null;
  return { schemaVersion: v['schemaVersion'] as number, data: v['data'] };
}

function migrate<T>(def: StoreDef<T>, env: Envelope): { ok: true; value: T } | { ok: false; detail: string } {
  let data = env.data;
  for (let v = env.schemaVersion; v <= def.migrations.length; v++) {
    try {
      data = def.migrations[v - 1]!(structuredClone(data));
    } catch (e) {
      return { ok: false, detail: `step v${v} to v${v + 1} failed: ${message(e)}` };
    }
  }
  return def.validate(data) ? { ok: true, value: data } : { ok: false, detail: 'migrated data failed validation' };
}


/** Brings data written at `schemaVersion` up to what this app writes, for data that did not come from a store file (an imported backup). */
export function upgrade<T>(def: StoreDef<T>, schemaVersion: number, data: unknown): { ok: true; value: T } | { ok: false; reason: 'newer-version' | 'invalid' } {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) return { ok: false, reason: 'invalid' };
  const current = def.migrations.length + 1;
  if (schemaVersion > current) return { ok: false, reason: 'newer-version' };
  if (schemaVersion === current) return def.validate(data) ? { ok: true, value: data } : { ok: false, reason: 'invalid' };
  const m = migrate(def, { schemaVersion, data });
  return m.ok ? m : { ok: false, reason: 'invalid' };
}

export function createStorage(dir: string, opts: StorageOptions = {}): Storage {
  const fs = opts.fs ?? nodeFs;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const keep = opts.keepBackups ?? 5;
  const keepReplace = opts.keepReplaceBackups ?? 20;
  const backupDir = join(dir, 'backups');
  const chains = new Map<string, Promise<unknown>>();
  let tmpSeq = 0;

  /** Runs `job` after every earlier job for the same store, so reads, migrations and writes never interleave. */
  function serial<R>(name: string, job: () => Promise<R>): Promise<R> {
    const run = (chains.get(name) ?? Promise.resolve()).then(job, job);
    chains.set(name, run.catch(() => undefined));
    return run;
  }

  const fileOf = (name: string) => join(dir, `${name}.json`);
  const stamp = (t: number) => String(t).padStart(15, '0');

  async function writeUnlocked<T>(def: StoreDef<T>, data: T): Promise<void> {
    const version = def.migrations.length + 1;
    const target = fileOf(def.name);
    const tmp = `${target}.${++tmpSeq}.tmp`;
    await fs.mkdir(dir);
    try {
      await fs.writeAndSync(tmp, JSON.stringify({ schemaVersion: version, data }));
      for (let attempt = 0; ; attempt++) {
        try {
          await fs.rename(tmp, target);
          return;
        } catch (e) {
          // Antivirus or an indexer can hold the file for a moment on Windows.
          if (attempt >= RENAME_RETRIES || !TRANSIENT.has(code(e) ?? '')) throw e;
          await sleep(10 * 2 ** attempt);
        }
      }
    } catch (e) {
      await fs.unlink(tmp).catch(() => undefined);
      throw e;
    }
  }

  type BackupKind = 'v' | 'corrupt' | 'replace';

  async function listBackups(name: string, kind: BackupKind): Promise<{ file: string; at: number }[]> {
    let names: string[];
    try {
      names = await fs.readdir(backupDir);
    } catch {
      return [];
    }
    const pattern = { v: `^${name}\\.v\\d+-(\\d+)\\.json$`, corrupt: `^${name}\\.corrupt-(\\d+)\\.json$`, replace: `^${name}\\.before-replace-v\\d+-(\\d+)\\.json$` }[kind];
    const re = new RegExp(pattern);
    return names
      .map((file) => ({ file, m: re.exec(file) }))
      .filter((x): x is { file: string; m: RegExpExecArray } => x.m !== null)
      .map((x) => ({ file: x.file, at: Number(x.m[1]) }))
      .sort((a, b) => b.at - a.at);
  }

  async function prune(name: string, kind: BackupKind): Promise<void> {
    for (const old of (await listBackups(name, kind)).slice(kind === 'replace' ? keepReplace : keep)) await fs.unlink(join(backupDir, old.file)).catch(() => undefined);
  }

  /** Copies `from` into backups/ under a name that sorts by time; never overwrites an existing backup. */
  async function copyToBackups(from: string, mkName: (at: number) => string): Promise<void> {
    await fs.mkdir(backupDir);
    for (let at = now(); ; at++) {
      try {
        await fs.copyFile(from, join(backupDir, mkName(at)), true);
        return;
      } catch (e) {
        if (code(e) !== 'EEXIST') throw e;
      }
    }
  }

  async function recover<T>(def: StoreDef<T>, reason: 'unparseable' | 'invalid-data'): Promise<ReadResult<T>> {
    const target = fileOf(def.name);
    try {
      await fs.mkdir(backupDir);
      for (let at = now(); ; at++) {
        const aside = join(backupDir, `${def.name}.corrupt-${at}.json`);
        try {
          await fs.copyFile(target, aside, true);
          break;
        } catch (e) {
          if (code(e) !== 'EEXIST') throw e;
        }
      }
      await fs.unlink(target);
    } catch (e) {
      return { status: 'error', error: 'unreadable', detail: `could not set the corrupt file aside: ${message(e)}` };
    }
    await prune(def.name, 'corrupt');
    for (const b of await listBackups(def.name, 'v')) {
      const env = parseEnvelope(await fs.readFile(join(backupDir, b.file)).catch(() => ''));
      if (!env || env.schemaVersion > def.migrations.length + 1) continue;
      const m: { ok: true; value: T } | { ok: false } =
        env.schemaVersion === def.migrations.length + 1 ? (def.validate(env.data) ? { ok: true, value: env.data } : { ok: false }) : migrate(def, env);
      if (!m.ok) continue;
      try {
        await writeUnlocked(def, m.value);
      } catch (e) {
        return { status: 'error', error: 'write-failed', detail: message(e) };
      }
      return { status: 'recovered', value: m.value, reason, source: 'backup' };
    }
    return { status: 'recovered', value: def.fallback(), reason, source: 'fallback' };
  }

  async function cleanTemps(name: string): Promise<void> {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    await Promise.all(names.filter((n) => n.startsWith(`${name}.json.`) && n.endsWith('.tmp')).map((n) => fs.unlink(join(dir, n)).catch(() => undefined)));
  }

  async function readUnlocked<T>(def: StoreDef<T>): Promise<ReadResult<T>> {
    await cleanTemps(def.name);
    let text: string;
    try {
      text = await fs.readFile(fileOf(def.name));
    } catch (e) {
      if (code(e) === 'ENOENT') return { status: 'created', value: def.fallback() };
      // Locked or permission-denied is not "corrupt": leave the file exactly where it is.
      return { status: 'error', error: 'unreadable', detail: message(e) };
    }
    const env = parseEnvelope(text);
    if (!env) return recover(def, 'unparseable');
    const current = def.migrations.length + 1;
    if (env.schemaVersion > current) {
      return { status: 'error', error: 'too-new', version: env.schemaVersion, detail: `file is version ${env.schemaVersion}, this app understands up to ${current}` };
    }
    if (env.schemaVersion === current) return def.validate(env.data) ? { status: 'ok', value: env.data } : recover(def, 'invalid-data');

    try {
      await copyToBackups(fileOf(def.name), (at) => `${def.name}.v${env.schemaVersion}-${stamp(at)}.json`);
    } catch (e) {
      return { status: 'error', error: 'backup-failed', version: env.schemaVersion, detail: message(e) };
    }
    await prune(def.name, 'v');
    const migrated = migrate(def, env);
    if (!migrated.ok) return { status: 'error', error: 'migration-failed', version: env.schemaVersion, detail: migrated.detail };
    try {
      await writeUnlocked(def, migrated.value);
    } catch (e) {
      return { status: 'error', error: 'write-failed', version: env.schemaVersion, detail: message(e) };
    }
    return { status: 'migrated', value: migrated.value, from: env.schemaVersion };
  }

  return {
    read: (def) => serial(def.name, () => readUnlocked(def)),
    backup: (def) =>
      serial(def.name, async () => {
        const text = await fs.readFile(fileOf(def.name)).catch((e: unknown) => {
          if (code(e) === 'ENOENT') return null;
          throw e;
        });
        if (text === null) return;
        const env = parseEnvelope(text);
        // Nothing to keep when the file only holds the empty starting state: it would spend a slot on nothing.
        if (env && env.schemaVersion === def.migrations.length + 1 && isDeepStrictEqual(env.data, def.fallback())) return;
        const version = env?.schemaVersion ?? def.migrations.length + 1;
        await copyToBackups(fileOf(def.name), (at) => `${def.name}.before-replace-v${version}-${stamp(at)}.json`);
        await prune(def.name, 'replace');
      }),
    write: (def, data) =>
      serial(def.name, async () => {
        if (!def.validate(data)) throw new Error(`invalid data for store "${def.name}"`);
        await writeUnlocked(def, data);
      }),
  };
}
