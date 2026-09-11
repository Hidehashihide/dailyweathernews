/**
 * Deterministic, serializable PRNG (sfc32).
 *
 * The whole game is a pure reducer, so randomness MUST be part of the state and
 * MUST round-trip exactly through save/load. Never use Math.random() in core/.
 */

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Mix a string seed into four uint32 words (cyrb128). */
export function hashSeed(seed: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  const out: RngState = {
    a: (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    b: (h2 ^ h1) >>> 0,
    c: (h3 ^ h1) >>> 0,
    d: (h4 ^ h1) >>> 0,
  };
  // sfc32 degenerates if every word is zero.
  if ((out.a | out.b | out.c | out.d) === 0) out.a = 0x9e3779b9;
  return out;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    this.a = state.a >>> 0;
    this.b = state.b >>> 0;
    this.c = state.c >>> 0;
    this.d = state.d >>> 0;
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 0x9e3779b9;
  }

  static fromSeed(seed: string): Rng {
    const rng = new Rng(hashSeed(seed));
    // Discard the first few outputs; sfc32's early stream is weakly mixed.
    for (let i = 0; i < 12; i++) rng.next();
    return rng;
  }

  /**
   * Snapshot as four unsigned words.
   *
   * The `>>> 0` here is load-bearing: `^` and `<<` yield *signed* int32, so
   * without it a saved word can be negative. That survives a round-trip in
   * memory (the constructor re-normalises) but not a trip through the save
   * validator, which clamps negative numbers to zero and silently resets the
   * player's random stream.
   */
  save(): RngState {
    return { a: this.a >>> 0, b: this.b >>> 0, c: this.c >>> 0, d: this.d >>> 0 };
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.a + this.b) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.d = (this.d + 1) >>> 0;
    t = (t + this.d) >>> 0;
    this.c = (this.c + t) >>> 0;
    return (t >>> 0) / 4294967296;
  }

  /** Integer in [min, max). Returns `min` when the range is empty. */
  int(min: number, max: number): number {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      throw new RangeError(`Rng.int: non-finite bounds (${min}, ${max})`);
    }
    if (hi <= lo) return lo;
    return lo + Math.floor(this.next() * (hi - lo));
  }

  /** Integer in [min, max], both inclusive. */
  intInclusive(min: number, max: number): number {
    return this.int(min, max + 1);
  }

  float(min: number, max: number): number {
    if (max <= min) return min;
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    if (!(p > 0)) return false; // also catches NaN
    if (p >= 1) return true;
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty array');
    const item = items[this.int(0, items.length)];
    // Index is provably in range; assert for noUncheckedIndexedAccess.
    return item as T;
  }

  /** Weighted pick. Non-finite / negative weights are treated as 0. */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    if (items.length === 0) throw new RangeError('Rng.pickWeighted: empty array');
    let total = 0;
    const weights: number[] = [];
    for (const item of items) {
      const w = weightOf(item);
      const safe = Number.isFinite(w) && w > 0 ? w : 0;
      weights.push(safe);
      total += safe;
    }
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i] as number;
      if (roll < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Fisher-Yates. Returns a new array; does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /** Sample without replacement. Caps at `items.length`. */
  sample<T>(items: readonly T[], count: number): T[] {
    const n = Math.max(0, Math.min(Math.floor(count), items.length));
    if (n === 0) return [];
    return this.shuffle(items).slice(0, n);
  }
}
