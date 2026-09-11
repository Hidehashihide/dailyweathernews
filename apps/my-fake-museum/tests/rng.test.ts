import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Rng, hashSeed } from '../src/core/rng';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = Rng.fromSeed('museum');
    const b = Rng.fromSeed('museum');
    const left = Array.from({ length: 200 }, () => a.next());
    const right = Array.from({ length: 200 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 50 }, (_, i) => Rng.fromSeed(`s${i}`).next());
    expect(new Set(a).size).toBeGreaterThan(45);
  });

  it('round-trips through save()/new Rng() exactly', () => {
    const rng = Rng.fromSeed('roundtrip');
    for (let i = 0; i < 37; i++) rng.next();
    const snapshot = rng.save();
    const expected = Array.from({ length: 20 }, () => rng.next());

    const restored = new Rng(snapshot);
    const actual = Array.from({ length: 20 }, () => restored.next());
    expect(actual).toEqual(expected);
  });

  it('keeps next() inside [0, 1)', () => {
    const rng = Rng.fromSeed('bounds');
    for (let i = 0; i < 50_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('never degenerates when every seed word hashes to zero', () => {
    const rng = new Rng({ a: 0, b: 0, c: 0, d: 0 });
    const values = Array.from({ length: 100 }, () => rng.next());
    expect(new Set(values).size).toBeGreaterThan(50);
  });

  describe('int()', () => {
    it('stays within [min, max)', () => {
      const rng = Rng.fromSeed('int');
      for (let i = 0; i < 20_000; i++) {
        const v = rng.int(3, 9);
        expect(v).toBeGreaterThanOrEqual(3);
        expect(v).toBeLessThan(9);
        expect(Number.isInteger(v)).toBe(true);
      }
    });

    it('returns min for an empty or inverted range instead of NaN', () => {
      const rng = Rng.fromSeed('empty');
      expect(rng.int(5, 5)).toBe(5);
      expect(rng.int(9, 2)).toBe(9);
    });

    it('throws on non-finite bounds rather than silently producing NaN', () => {
      const rng = Rng.fromSeed('nan');
      expect(() => rng.int(NaN, 5)).toThrow(RangeError);
      expect(() => rng.int(0, Infinity)).toThrow(RangeError);
    });

    it('intInclusive covers both endpoints', () => {
      const rng = Rng.fromSeed('inclusive');
      const seen = new Set<number>();
      for (let i = 0; i < 5_000; i++) seen.add(rng.intInclusive(1, 3));
      expect([...seen].sort()).toEqual([1, 2, 3]);
    });
  });

  describe('chance()', () => {
    it('treats p<=0 as never and p>=1 as always, without consuming entropy', () => {
      const rng = Rng.fromSeed('chance');
      const before = rng.save();
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(-1)).toBe(false);
      expect(rng.chance(1)).toBe(true);
      expect(rng.chance(2)).toBe(true);
      expect(rng.save()).toEqual(before);
    });

    it('treats NaN as false', () => {
      const rng = Rng.fromSeed('chance-nan');
      expect(rng.chance(NaN)).toBe(false);
    });

    it('is approximately fair', () => {
      const rng = Rng.fromSeed('fairness');
      let hits = 0;
      const n = 100_000;
      for (let i = 0; i < n; i++) if (rng.chance(0.25)) hits += 1;
      expect(hits / n).toBeGreaterThan(0.24);
      expect(hits / n).toBeLessThan(0.26);
    });
  });

  describe('pick / pickWeighted / shuffle / sample', () => {
    it('pick throws on an empty array', () => {
      expect(() => Rng.fromSeed('x').pick([])).toThrow(RangeError);
    });

    it('pickWeighted respects weights', () => {
      const rng = Rng.fromSeed('weights');
      const items = ['rare', 'common'] as const;
      let common = 0;
      for (let i = 0; i < 20_000; i++) {
        if (rng.pickWeighted(items, (it) => (it === 'common' ? 9 : 1)) === 'common') common += 1;
      }
      expect(common / 20_000).toBeGreaterThan(0.87);
      expect(common / 20_000).toBeLessThan(0.93);
    });

    it('pickWeighted falls back to uniform when every weight is zero or invalid', () => {
      const rng = Rng.fromSeed('zero-weights');
      const seen = new Set<string>();
      for (let i = 0; i < 500; i++) seen.add(rng.pickWeighted(['a', 'b', 'c'], () => NaN));
      expect(seen.size).toBe(3);
    });

    it('shuffle preserves the multiset and does not mutate the input', () => {
      const rng = Rng.fromSeed('shuffle');
      const input = [1, 2, 3, 4, 5, 5];
      const copy = input.slice();
      const out = rng.shuffle(input);
      expect(input).toEqual(copy);
      expect(out.slice().sort()).toEqual(copy.slice().sort());
    });

    it('sample caps at the array length and never repeats', () => {
      const rng = Rng.fromSeed('sample');
      const out = rng.sample([1, 2, 3], 99);
      expect(out).toHaveLength(3);
      expect(new Set(out).size).toBe(3);
      expect(rng.sample([1, 2, 3], -5)).toEqual([]);
    });
  });

  it('hashSeed never returns all zeroes', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = hashSeed(seed);
        expect(s.a | s.b | s.c | s.d).not.toBe(0);
      }),
      { numRuns: 500 },
    );
  });

  it('saved state is always four uint32 words', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 200 }), (seed, draws) => {
        const rng = Rng.fromSeed(seed);
        for (let i = 0; i < draws; i++) rng.next();
        const s = rng.save();
        for (const word of [s.a, s.b, s.c, s.d]) {
          expect(Number.isInteger(word)).toBe(true);
          expect(word).toBeGreaterThanOrEqual(0);
          expect(word).toBeLessThanOrEqual(0xffffffff);
        }
      }),
      { numRuns: 200 },
    );
  });
});
