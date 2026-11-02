import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ID, PRODUCT_NAME, USER_DATA_NAME } from '../../src/main/identity';
import { LINKS } from '../../src/main/links';

describe('the fixed identifiers', () => {
  it('appId is io.github.<repo owner>.barkstudy, matching the repo the updater and links point at', () => {
    const owner = /^https:\/\/github\.com\/([^/]+)\//.exec(LINKS.repo)?.[1];
    expect(owner).toBeTruthy();
    expect(APP_ID).toBe(`io.github.${owner!.toLowerCase()}.barkstudy`);
  });

  it('the data folder is the one earlier builds already used', () => {
    expect(USER_DATA_NAME).toBe('BarkStudy');
    expect(PRODUCT_NAME).toBe('BarkStudy');
  });
});

describe('the packaging config repeats them', () => {
  const read = (file: string): string => readFileSync(join(__dirname, '..', '..', file), 'utf8');

  it('electron-builder.yml has the same appId and productName', () => {
    const yml = read('electron-builder.yml');
    expect(/^appId: (\S+)$/m.exec(yml)?.[1]).toBe(APP_ID);
    expect(/^productName: (\S+)$/m.exec(yml)?.[1]).toBe(PRODUCT_NAME);
  });

  it('the uninstaller deletes only the pinned data folder and the updater cache named in the build', () => {
    const nsh = read('build/installer.nsh');
    const deletes = nsh.split('\n').filter((l) => /RMDir/.test(l) && !l.trim().startsWith(';'));
    expect(deletes).toHaveLength(2);
    expect(deletes.filter((l) => l.includes('"$APPDATA\\' + USER_DATA_NAME + '"'))).toHaveLength(1);
    // electron-builder names the cache "<package name>-updater" (updaterCacheDirName in app-update.yml).
    const pkg = JSON.parse(read('package.json')) as { name: string };
    expect(deletes.filter((l) => l.includes('"$LOCALAPPDATA\\' + pkg.name + '-updater"'))).toHaveLength(1);
  });

  it('only the data folder is behind the question; the updater cache holds no user data', () => {
    const nsh = read('build/installer.nsh');
    const ask = nsh.indexOf('MessageBox');
    expect(nsh.indexOf('RMDir /r "$APPDATA\\' + USER_DATA_NAME + '"')).toBeGreaterThan(ask);
    expect(nsh.indexOf('RMDir /r "$LOCALAPPDATA\\')).toBeLessThan(ask);
  });
});
