/** Seeded, pure RNG (sfc32). State is immutable: every draw returns the next state. */
export type RngState = { a: number; b: number; c: number; d: number };

function sfc32(s: RngState): [number, RngState] {
  const t = (((s.a + s.b) | 0) + s.d) | 0;
  const d = (s.d + 1) | 0;
  const a = s.b ^ (s.b >>> 9);
  const b = (s.c + (s.c << 3)) | 0;
  const c = (((s.c << 21) | (s.c >>> 11)) + t) | 0;
  return [(t >>> 0) / 4294967296, { a, b, c, d }];
}

/** splitmix32: spreads one 32-bit seed over four well-mixed words. */
function splitmix32(seed: number): () => number {
  let x = seed | 0;
  return () => {
    x = (x + 0x9e3779b9) | 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) | 0;
  };
}

export function createRng(seed: number): RngState {
  const mix = splitmix32(seed);
  let state: RngState = { a: mix(), b: mix(), c: mix(), d: mix() };
  for (let i = 0; i < 12; i++) state = sfc32(state)[1];
  return state;
}

/** Uniform float in [0, 1). */
export function nextFloat(r: RngState): [number, RngState] {
  return sfc32(r);
}

/** Uniform integer in [min, maxExcl). */
export function nextInt(r: RngState, min: number, maxExcl: number): [number, RngState] {
  const [f, next] = sfc32(r);
  return [min + Math.floor(f * (maxExcl - min)), next];
}

/** Weighted pick; items with weight <= 0 are never chosen. Throws if nothing has positive weight. */
export function weightedPick<T>(r: RngState, items: readonly { item: T; weight: number }[]): [T, RngState] {
  let total = 0;
  for (const it of items) if (it.weight > 0) total += it.weight;
  if (total <= 0) throw new Error('weightedPick: no item has positive weight');
  const [f, next] = sfc32(r);
  let target = f * total;
  let last: T | undefined;
  for (const it of items) {
    if (it.weight <= 0) continue;
    last = it.item;
    if (target < it.weight) return [it.item, next];
    target -= it.weight;
  }
  return [last as T, next];
}
