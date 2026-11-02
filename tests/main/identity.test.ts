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
