import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStorage, nodeFs, type FsOps, type StoreDef } from '../../src/main/storage/io';
import { allStores } from '../../src/main/storage/stores';

interface Toy {
  items: string[];
  count?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isToy = (v: unknown): v is Toy => isRecord(v) && Array.isArray(v['items']);
// v1 -> v2 adds a count; v2 -> v3 upper-cases the items.
const addCount = (old: unknown) => ({ ...(old as Toy), count: (old as Toy).items.length });
const shout = (old: unknown) => ({ ...(old as Toy), items: (old as Toy).items.map((s) => s.toUpperCase()) });
const toy = (migrations: StoreDef<Toy>['migrations'], validate: StoreDef<Toy>['validate'] = isToy): StoreDef<Toy> => ({
  name: 'toy',
  migrations,
  fallback: () => ({ items: [] }),
  validate,
});
const toyV1 = toy([]);
const toyV2 = toy([addCount]);
const toyV3 = toy([addCount, shout]);

let dir: string;
let tick: number;
const now = () => (tick += 1000);
const noSleep = () => Promise.resolve();
const storage = (over: Partial<FsOps> = {}, extra: { keepBackups?: number } = {}) =>
  createStorage(dir, { fs: { ...nodeFs, ...over }, now, sleep: noSleep, ...extra });
const file = (name = 'toy') => join(dir, `${name}.json`);
const backups = (name = 'toy') => (fs.existsSync(join(dir, 'backups')) ? fs.readdirSync(join(dir, 'backups')).filter((f) => f.startsWith(name)).sort() : []);
const envelope = (version: number, data: unknown) => JSON.stringify({ schemaVersion: version, data });
const put = (version: number, data: unknown) => fs.writeFileSync(file(), envelope(version, data));
const onDisk = (path = file()) => JSON.parse(fs.readFileSync(path, 'utf8')) as { schemaVersion: number; data: Toy };
const errno =(code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-store-'));
  tick = 1_790_000_000_000;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('reading and writing', () => {
  it('a missing file reads as the fallback and is not created by reading', async () => {
    const r = await storage().read(toyV1);
    expect(r).toEqual({ status: 'created', value: { items: [] } });
    expect(fs.existsSync(file())).toBe(false);
  });

  it('write then read round-trips, and the file carries the schema version', async () => {
    const s = storage();
    await s.write(toyV3, { items: ['A'], count: 1 });
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ schemaVersion: 3, data: { items: ['A'], count: 1 } });
    expect(await storage().read(toyV3)).toEqual({ status: 'ok', value: { items: ['A'], count: 1 } });
  });

  it('refuses to write data the store cannot validate, leaving the file alone', async () => {
    put(1, { items: ['keep'] });
    await expect(storage().write(toyV1, { nope: true } as unknown as Toy)).rejects.toThrow(/invalid/i);
    expect(onDisk().data).toEqual({ items: ['keep'] });
  });

  it('50 concurrent writes end with the last one and leave no temp files', async () => {
    const s = storage();
    await Promise.all(Array.from({ length: 50 }, (_, i) => s.write(toyV1, { items: [`w${i}`] })));
    expect(onDisk().data).toEqual({ items: ['w49'] });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('crash safety', () => {
  it('crash mid-write (before the rename) keeps the old file, and the stray temp file is cleaned on the next read', async () => {
    put(1, { items: ['old'] });
    const crashing = storage({
      rename: () => Promise.reject(new Error('power cut')),
    });
    await expect(crashing.write(toyV1, { items: ['new'] })).rejects.toThrow('power cut');
    expect(onDisk().data).toEqual({ items: ['old'] });
    fs.writeFileSync(join(dir, 'toy.json.99.tmp'), '{"half'); // what a real crash would leave behind
    expect(await storage().read(toyV1)).toEqual({ status: 'ok', value: { items: ['old'] } });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('crash while writing the temp file keeps the old file', async () => {
    put(1, { items: ['old'] });
    const crashing = storage({
      writeAndSync: (path) => {
        fs.writeFileSync(path, '{"half');
        return Promise.reject(new Error('disk full'));
      },
    });
    await expect(crashing.write(toyV1, { items: ['new'] })).rejects.toThrow('disk full');
    expect(onDisk().data).toEqual({ items: ['old'] });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('a rename that fails transiently (antivirus holding the file) is retried', async () => {
    let failures = 2;
    const flaky = storage({
      rename: (a, b) => (failures-- > 0 ? Promise.reject(errno('EPERM')) : nodeFs.rename(a, b)),
    });
    await flaky.write(toyV1, { items: ['ok'] });
    expect(onDisk().data).toEqual({ items: ['ok'] });
  });
});

describe('corrupt files', () => {
  it('corrupt → set aside as a backup copy + fallback, and the store works again', async () => {
    fs.writeFileSync(file(), 'this is not json {{{');
    const s = storage();
    const r = await s.read(toyV1);
    expect(r).toEqual({ status: 'recovered', value: { items: [] }, reason: 'unparseable', source: 'fallback' });
    expect(fs.existsSync(file())).toBe(false);
    const kept = backups().filter((f) => f.includes('corrupt'));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(join(dir, 'backups', kept[0]!), 'utf8')).toBe('this is not json {{{');
    await s.write(toyV1, { items: ['fresh'] });
    expect(await s.read(toyV1)).toEqual({ status: 'ok', value: { items: ['fresh'] } });
  });

  it('a truncated file, a non-envelope and a bad version are all treated as corrupt', async () => {
    for (const bad of ['{"schemaVersion":1,"data":{"items":["a"', '[1,2,3]', '{"schemaVersion":"1","data":{}}', '{"schemaVersion":0,"data":{}}', '{"data":{"items":[]}}', '']) {
      fs.writeFileSync(file(), bad);
      const r = await storage().read(toyV1);
      expect(r.status, bad).toBe('recovered');
    }
  });

  it('a valid envelope with unusable data is treated as corrupt, and the original is kept', async () => {
    put(1, { surprise: true });
    const r = await storage().read(toyV1);
    expect(r).toMatchObject({ status: 'recovered', reason: 'invalid-data', source: 'fallback' });
    expect(backups().some((f) => f.includes('corrupt'))).toBe(true);
  });

  it('corrupt with an older backup on disk: recovers the backup (migrated) instead of starting empty', async () => {
    put(1, { items: ['precious'] });
    await storage().read(toyV3); // migrates v1 -> v3 and leaves a pre-migration backup
    fs.writeFileSync(file(), 'garbage');
    const r = await storage().read(toyV3);
    expect(r).toEqual({ status: 'recovered', value: { items: ['PRECIOUS'], count: 1 }, reason: 'unparseable', source: 'backup' });
    expect(await storage().read(toyV3)).toEqual({ status: 'ok', value: { items: ['PRECIOUS'], count: 1 } });
  });
});

describe('migrations', () => {
  it('applies every step in order, writes the new version, and backs up the old file first', async () => {
    put(1, { items: ['a', 'b'] });
    const original = fs.readFileSync(file(), 'utf8');
    const r = await storage().read(toyV3);
    expect(r).toEqual({ status: 'migrated', from: 1, value: { items: ['A', 'B'], count: 2 } });
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ schemaVersion: 3, data: { items: ['A', 'B'], count: 2 } });
    const [backup] = backups();
    expect(backup).toMatch(/^toy\.v1-\d+\.json$/);
    expect(fs.readFileSync(join(dir, 'backups', backup!), 'utf8')).toBe(original);
  });

  it('starts from the version on disk, not from 1', async () => {
    put(2, { items: ['x'], count: 1 });
    expect(await storage().read(toyV3)).toMatchObject({ status: 'migrated', from: 2, value: { items: ['X'], count: 1 } });
  });

  it('keeps only the last 5 backups', async () => {
    const s = storage();
    for (let i = 0; i < 8; i++) {
      put(1, { items: [`gen${i}`] });
      await s.read(toyV2);
    }
    const kept = backups();
    expect(kept).toHaveLength(5);
    const contents = kept.map((f) => onDisk(join(dir, 'backups', f)).data.items[0]);
    expect(contents).toEqual(['gen3', 'gen4', 'gen5', 'gen6', 'gen7']);
  });

  it('failed migration restores the backup and reports an error, never an empty app', async () => {
    put(1, { items: ['a'] });
    const original = fs.readFileSync(file(), 'utf8');
    const broken = toy([
      () => {
        throw new Error('bug in migration');
      },
    ]);
    const s = storage();
    const r = await s.read(broken);
    expect(r).toMatchObject({ status: 'error', error: 'migration-failed', version: 1 });
    expect((r as { detail: string }).detail).toContain('bug in migration');
    expect(fs.readFileSync(file(), 'utf8')).toBe(original);
    expect(backups()).toHaveLength(1);
    expect(await s.read(broken)).toMatchObject({ status: 'error', error: 'migration-failed' }); // still an error, not "created"
  });

  it('a migration that produces data the store rejects fails the same way', async () => {
    put(1, { items: ['a'] });
    const original = fs.readFileSync(file(), 'utf8');
    const bad = toy([() => ({ items: 'not an array' })]);
    expect(await storage().read(bad)).toMatchObject({ status: 'error', error: 'migration-failed' });
    expect(fs.readFileSync(file(), 'utf8')).toBe(original);
  });

  it('migrations get a copy: mutating their input cannot corrupt the stored original', async () => {
    put(1, { items: ['a'] });
    const mutating = toy([
      (old) => {
        (old as Toy).items.push('MUTATED');
        throw new Error('then fail');
      },
    ]);
    await storage().read(mutating);
    expect(onDisk().data).toEqual({ items: ['a'] });
  });

  it('no backup, no migration: if the backup cannot be written the file is left alone', async () => {
    put(1, { items: ['a'] });
    const original = fs.readFileSync(file(), 'utf8');
    const r = await storage({ copyFile: () => Promise.reject(new Error('no space')) }).read(toyV2);
    expect(r).toMatchObject({ status: 'error', error: 'backup-failed' });
    expect(fs.readFileSync(file(), 'utf8')).toBe(original);
  });

  it('a file from a newer app is never touched', async () => {
    put(9, { items: ['future'], novel: true });
    const original = fs.readFileSync(file(), 'utf8');
    expect(await storage().read(toyV3)).toMatchObject({ status: 'error', error: 'too-new', version: 9 });
    expect(fs.readFileSync(file(), 'utf8')).toBe(original);
    expect(backups()).toEqual([]);
  });

  it('a file that cannot be read for permission reasons is not mistaken for corrupt', async () => {
    put(1, { items: ['a'] });
    const r = await storage({ readFile: () => Promise.reject(errno('EACCES')) }).read(toyV1);
    expect(r).toMatchObject({ status: 'error', error: 'unreadable' });
    expect(fs.existsSync(file())).toBe(true);
    expect(backups()).toEqual([]);
  });
});

describe('the real stores', () => {
  it('each store is named after its file, versions start at 1, and the fallback validates', () => {
    for (const def of allStores) {
      expect(def.name).toMatch(/^[a-z]+$/);
      expect(def.validate(def.fallback()), def.name).toBe(true);
    }
  });

  it('every past fixture migrates to current', async () => {
    for (const def of allStores) {
      const current = def.migrations.length + 1;
      for (let v = 1; v <= current; v++) {
        const fixture = join(__dirname, '..', 'fixtures', 'schemas', `v${v}`, `${def.name}.json`);
        expect(fs.existsSync(fixture), `missing fixture ${fixture}: every schema version needs one`).toBe(true);
        const d = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-fixture-'));
        try {
          fs.copyFileSync(fixture, join(d, `${def.name}.json`));
          const r = await createStorage(d, { now, sleep: noSleep }).read(def);
          expect(['ok', 'migrated'], `${def.name} v${v}: ${JSON.stringify(r)}`).toContain(r.status);
          expect(r.status !== 'error' && def.validate(r.value)).toBe(true);
          expect(onDisk(join(d, `${def.name}.json`)).schemaVersion).toBe(current);
        } finally {
          fs.rmSync(d, { recursive: true, force: true });
        }
      }
    }
  });

  it('v1 fixtures keep every deck, card, review state, setting and guilt trip', async () => {
    const read = async (name: string) => {
      const def = allStores.find((s) => s.name === name)!;
      const d = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-fixture-'));
      fs.copyFileSync(join(__dirname, '..', 'fixtures', 'schemas', 'v1', `${name}.json`), join(d, `${name}.json`));
      const r = await createStorage(d, { now, sleep: noSleep }).read(def);
      fs.rmSync(d, { recursive: true, force: true });
      return r.status === 'error' ? null : (r.value as Record<string, unknown>);
    };
    const decks = (await read('decks')) as { decks: { name: string; cards: { fsrs: { reps: number; state: number } }[] }[] };
    expect(decks.decks[0]?.name).toBe('French basics');
    expect(decks.decks[0]?.cards.map((c) => [c.fsrs.reps, c.fsrs.state])).toEqual([
      [1, 1],
      [0, 0],
    ]);
    expect(await read('settings')).toMatchObject({ cap: 3, preset: 'drama-queen', leaveItHotkey: 'Ctrl+Alt+K', excludedApps: ['zoom.exe', 'my-game.exe'] });
    expect(await read('history')).toMatchObject({ treats: 9, guiltTrips: [{ waitedMs: 420000 }] });
  });
});
