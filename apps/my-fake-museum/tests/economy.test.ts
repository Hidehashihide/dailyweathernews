import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_MONEY,
  MAX_STAT,
  addAuthority,
  addBuzz,
  addMoney,
  canAfford,
  clampMoney,
  decayBuzz,
  safeInt,
  spend,
} from '../src/core/economy';
import type { Museum } from '../src/core/types';

function museum(money = 100): Museum {
  return {
    id: 'm', name: 'n', foundedDay: 1, money, authority: 0, buzz: 0, fame: 0,
    slots: 3, exhibits: [], inventory: [], guard: null, foragesLeft: 0, heistsLeft: 0,
  };
}

describe('safeInt', () => {
  it('rounds, floors at zero and rejects non-finite values', () => {
    expect(safeInt(3.7)).toBe(4);
    expect(safeInt(-5)).toBe(0);
    expect(safeInt(NaN)).toBe(0);
    expect(safeInt(Infinity)).toBe(0);
    expect(safeInt(-Infinity)).toBe(0);
    expect(safeInt(undefined as unknown as number)).toBe(0);
    expect(safeInt(NaN, 7)).toBe(7);
  });
});

describe('addMoney', () => {
  it('never goes below zero', () => {
    const m = museum(10);
    addMoney(m, -999);
    expect(m.money).toBe(0);
  });

  it('clamps at the ceiling', () => {
    const m = museum(MAX_MONEY - 1);
    addMoney(m, 1_000_000);
    expect(m.money).toBe(MAX_MONEY);
  });

  it('ignores NaN and Infinity instead of poisoning the balance', () => {
    const m = museum(50);
    addMoney(m, NaN);
    expect(m.money).toBe(50);
    addMoney(m, Infinity);
    expect(m.money).toBe(50);
  });

  it('always leaves a finite, non-negative integer', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ noDefaultInfinity: false, noNaN: false }), { maxLength: 40 }), (deltas) => {
        const m = museum(500);
        for (const d of deltas) addMoney(m, d);
        expect(Number.isSafeInteger(m.money)).toBe(true);
        expect(m.money).toBeGreaterThanOrEqual(0);
        expect(m.money).toBeLessThanOrEqual(MAX_MONEY);
      }),
      { numRuns: 500 },
    );
  });
});

describe('spend', () => {
  it('is atomic: a failed spend leaves the balance untouched', () => {
    const m = museum(50);
    expect(spend(m, 80)).toBe(false);
    expect(m.money).toBe(50);
  });

  it('succeeds on an exact-balance purchase', () => {
    const m = museum(50);
    expect(spend(m, 50)).toBe(true);
    expect(m.money).toBe(0);
  });

  it('treats a negative cost as zero rather than as income', () => {
    const m = museum(50);
    expect(spend(m, -100)).toBe(true);
    expect(m.money).toBe(50);
  });

  it('treats a NaN cost as zero', () => {
    const m = museum(50);
    expect(spend(m, NaN)).toBe(true);
    expect(m.money).toBe(50);
  });

  it('agrees with canAfford', () => {
    fc.assert(
      fc.property(fc.nat({ max: 5000 }), fc.nat({ max: 5000 }), (balance, cost) => {
        const m = museum(balance);
        expect(spend(m, cost)).toBe(canAfford(museum(balance), cost));
      }),
      { numRuns: 500 },
    );
  });
});

describe('stat helpers', () => {
  it('clamp authority and buzz at MAX_STAT and zero', () => {
    const m = museum();
    addAuthority(m, 1e9);
    expect(m.authority).toBe(MAX_STAT);
    addBuzz(m, -1e9);
    expect(m.buzz).toBe(0);
  });

  it('decayBuzz strictly reduces a positive buzz and bottoms out at zero', () => {
    const m = museum();
    addBuzz(m, 100);
    const before = m.buzz;
    decayBuzz(m);
    expect(m.buzz).toBeLessThan(before);

    m.buzz = 0;
    decayBuzz(m);
    expect(m.buzz).toBe(0);
  });

  it('decayBuzz eventually reaches zero rather than hovering forever', () => {
    const m = museum();
    addBuzz(m, 5000);
    for (let i = 0; i < 500; i++) decayBuzz(m);
    expect(m.buzz).toBe(0);
  });
});

describe('clampMoney', () => {
  it('keeps values inside [0, MAX_MONEY]', () => {
    fc.assert(
      fc.property(fc.double({ noDefaultInfinity: false, noNaN: false }), (v) => {
        const out = clampMoney(v);
        expect(Number.isSafeInteger(out)).toBe(true);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(out).toBeLessThanOrEqual(MAX_MONEY);
      }),
      { numRuns: 500 },
    );
  });
});
