import { describe, expect, it } from 'vitest';
import { createRendererErrorGate } from '../../src/main/rendererErrors';

interface Entry {
  level: string;
  message: string;
  err?: unknown;
}

function setup(perMinute?: number) {
  const entries: Entry[] = [];
  let t = 1_000_000;
  const own = { id: 7 };
  const alsoOwn = { id: 9 };
  const other = { id: 8 };
  const gate = createRendererErrorGate({
    log: {
      error: (_a, message, err) => void entries.push({ level: 'error', message, err }),
      warn: (_a, message) => void entries.push({ level: 'warn', message }),
    },
    isOwn: (s) => s === own || s === alsoOwn,
    now: () => t,
    perMinute,
  });
  return { gate, entries, own, alsoOwn, other, advance: (ms: number) => void (t += ms) };
}

describe('createRendererErrorGate', () => {
  it('writes 20 of 1,000 reports from one sender in a minute, then one line for the rest', () => {
    const { gate, entries, own, advance } = setup();
    for (let i = 0; i < 1000; i++) gate.handle(own, { message: `m${i}` });
    expect(entries).toHaveLength(20);
    advance(60_000);
    gate.tick();
    expect(entries).toHaveLength(21);
    expect(entries[20]).toEqual({ level: 'warn', message: '980 more renderer errors dropped' });
    gate.tick();
    expect(entries).toHaveLength(21);
  });

  it('also writes the dropped line when the next report arrives after the minute', () => {
    const { gate, entries, own, advance } = setup(2);
    for (let i = 0; i < 5; i++) gate.handle(own, { message: 'x' });
    advance(61_000);
    gate.handle(own, { message: 'again' });
    expect(entries.map((e) => e.message)).toEqual(['x', 'x', '3 more renderer errors dropped', 'again']);
  });

  it('limits each sender on its own', () => {
    const { gate, entries, own, alsoOwn } = setup(1);
    gate.handle(own, { message: 'a' });
    gate.handle(own, { message: 'b' });
    gate.handle(alsoOwn, { message: 'c' });
    expect(entries.map((e) => e.message)).toEqual(['a', 'c']);
  });

  it('writes nothing for an unknown sender', () => {
    const { gate, entries, other } = setup();
    gate.handle(other, { message: 'hi' });
    gate.handle(null, { message: 'hi' });
    expect(entries).toEqual([]);
  });

  it.each([[undefined], [null], ['text'], [42], [{}], [{ message: 5 }], [{ message: 'ok', stack: 5 }]])('drops the bad payload %j', (payload) => {
    const { gate, entries, own } = setup();
    gate.handle(own, payload);
    expect(entries).toEqual([]);
  });

  it('cuts every field to 2,000 characters', () => {
    const { gate, entries, own } = setup();
    gate.handle(own, { message: 'm'.repeat(10_000), stack: 's'.repeat(10_000) });
    expect(entries[0]!.message).toHaveLength(2000);
    expect(entries[0]!.err).toHaveLength(2000);
  });

  it('logs a report without a stack', () => {
    const { gate, entries, own } = setup();
    gate.handle(own, { message: 'plain' });
    expect(entries).toEqual([{ level: 'error', message: 'plain', err: undefined }]);
  });
});
