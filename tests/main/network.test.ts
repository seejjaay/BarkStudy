import { describe, expect, it } from 'vitest';
import { isAllowedUrl } from '../../src/main/network';

const DEV = 'http://localhost:5173';

describe('isAllowedUrl', () => {
  it('allows local files and devtools', () => {
    expect(isAllowedUrl('file:///C:/app/out/renderer/overlay/index.html', null)).toBe(true);
    expect(isAllowedUrl('devtools://devtools/bundled/devtools_app.html', null)).toBe(true);
  });

  it('allows the dev server origin over http and websocket only in dev', () => {
    expect(isAllowedUrl('http://localhost:5173/overlay/index.html', DEV)).toBe(true);
    expect(isAllowedUrl('ws://localhost:5173/', DEV)).toBe(true);
    expect(isAllowedUrl('http://localhost:5173/overlay/index.html', null)).toBe(false);
    expect(isAllowedUrl('ws://localhost:5173/', null)).toBe(false);
  });

  it('denies other ports, hosts and schemes', () => {
    expect(isAllowedUrl('http://localhost:5174/', DEV)).toBe(false);
    expect(isAllowedUrl('https://localhost:5173/', DEV)).toBe(false);
    expect(isAllowedUrl('https://example.com/', DEV)).toBe(false);
    expect(isAllowedUrl('https://example.com/', null)).toBe(false);
    expect(isAllowedUrl('data:text/html,x', DEV)).toBe(false);
    expect(isAllowedUrl('blob:http://localhost:5173/abc', DEV)).toBe(false);
    expect(isAllowedUrl('ftp://localhost:5173/', DEV)).toBe(false);
  });

  it('denies garbage and a lookalike host', () => {
    expect(isAllowedUrl('not a url', DEV)).toBe(false);
    expect(isAllowedUrl('', DEV)).toBe(false);
    expect(isAllowedUrl('http://localhost:5173.evil.com/', DEV)).toBe(false);
    expect(isAllowedUrl('http://localhost:5173@evil.com/', DEV)).toBe(false);
  });

  it('a malformed dev origin allows nothing but local files', () => {
    expect(isAllowedUrl('http://localhost:5173/', 'nope')).toBe(false);
    expect(isAllowedUrl('file:///x', 'nope')).toBe(true);
  });
});
