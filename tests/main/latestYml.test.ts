import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface Hash {
  sha512: string;
  size: number;
}
const { hashFile, updateLatestYml, checkLatestYml } = createRequire(import.meta.url)('../../scripts/update-latest-yml.cjs') as {
  hashFile: (file: string) => Hash;
  updateLatestYml: (text: string, installerName: string, hash: Hash) => string;
  checkLatestYml: (text: string, installerName: string, hash: Hash) => string[];
};

// The shape electron-builder writes for a one-installer release.
const latest = (sha: string, size: number): string =>
  [
    'version: 0.2.0',
    'files:',
    '  - url: BarkStudy-Setup-0.2.0.exe',
    `    sha512: ${sha}`,
    `    size: ${size}`,
    '    blockMapSize: 130463',
    'path: BarkStudy-Setup-0.2.0.exe',
    `sha512: ${sha}`,
    "releaseDate: '2026-11-03T10:00:00.000Z'",
    '',
  ].join('\n');

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-latest-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const installer = (bytes: string): { name: string; hash: Hash } => {
  const file = join(dir, 'BarkStudy-Setup-0.2.0.exe');
  fs.writeFileSync(file, bytes);
  return { name: 'BarkStudy-Setup-0.2.0.exe', hash: hashFile(file) };
};

describe('latest.yml after signing', () => {
  it('a latest.yml written for the unsigned installer fails the check once the installer is signed', () => {
    const unsigned = installer('unsigned bytes');
    const text = latest(unsigned.hash.sha512, unsigned.hash.size);
    expect(checkLatestYml(text, unsigned.name, unsigned.hash)).toEqual([]);
    const signed = installer('unsigned bytes + a signature block');
    const problems = checkLatestYml(text, signed.name, signed.hash);
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.join(' ')).toMatch(/sha512/);
    expect(problems.join(' ')).toMatch(/size/);
  });

  it('rewriting from the signed installer makes the check pass, and the result still parses as the same shape', () => {
    const unsigned = installer('unsigned bytes');
    const signed = installer('unsigned bytes + a signature block');
    const fixed = updateLatestYml(latest(unsigned.hash.sha512, unsigned.hash.size), signed.name, signed.hash);
    expect(checkLatestYml(fixed, signed.name, signed.hash)).toEqual([]);
    expect(fixed).toContain('version: 0.2.0');
    expect(fixed).toContain('path: BarkStudy-Setup-0.2.0.exe');
    expect(fixed).toContain("releaseDate: '2026-11-03T10:00:00.000Z'");
  });

  it('the top-level hash follows, and the blockmap size is dropped because the blockmap no longer matches', () => {
    const signed = installer('signed');
    const fixed = updateLatestYml(latest('stale==', 1), signed.name, signed.hash);
    expect(fixed.split(signed.hash.sha512)).toHaveLength(3); // the file entry and the top level
    expect(fixed).not.toContain('blockMapSize');
  });

  it('leaves the other entries alone, and refuses an installer the file does not list', () => {
    const signed = installer('signed');
    const text = latest('stale==', 1) + '';
    const withOther = text.replace('path:', '  - url: Other.exe\n    sha512: keep==\n    size: 7\npath:');
    const fixed = updateLatestYml(withOther, signed.name, signed.hash);
    expect(fixed).toContain('url: Other.exe');
    expect(fixed).toContain('sha512: keep==');
    expect(() => updateLatestYml(text, 'Missing.exe', signed.hash)).toThrow(/does not list/);
    expect(checkLatestYml(text, 'Missing.exe', signed.hash)).toEqual(['latest.yml does not list Missing.exe']);
  });

  it('refuses a file that is not an update manifest', () => {
    const { hash } = installer('x');
    expect(() => checkLatestYml('hello: world\n', 'a.exe', hash)).toThrow(/no files list/);
  });
});
