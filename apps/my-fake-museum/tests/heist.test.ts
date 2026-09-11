import { describe, expect, it } from 'vitest';
import { attemptHeist, guardBlockChance, isRaidable } from '../src/core/heist';
import { Rng } from '../src/core/rng';
import { scoreCaption } from '../src/core/caption';
import { GRACE_DAYS, MAX_INVENTORY } from '../src/core/content';
import type { Exhibit, Museum } from '../src/core/types';

function museum(id: string, name: string, exhibits: number, foundedDay = 1): Museum {
  return {
    id,
    name,
    foundedDay,
    money: 500,
    authority: 0,
    buzz: 0,
    fame: 0,
    slots: 12,
    exhibits: Array.from({ length: exhibits }, (_, i) => exhibit(`${id}_ex${i}`)),
    inventory: [],
    guard: null,
    foragesLeft: 0,
    heistsLeft: 1,
  };
}

function exhibit(id: string, caption = '1847年、旧市街の遺構より出土した断片である。'): Exhibit {
  return {
    id,
    defId: 'can',
    caption,
    score: scoreCaption(caption, 'can'),
    placedDay: 1,
    caseTier: 'none',
    lighting: 0,
    stolenHistory: [],
    votesReal: 0,
    votesFake: 0,
    tipsEarned: 0,
    genuine: false,
  };
}

const DAY = GRACE_DAYS + 5;

describe('isRaidable', () => {
  it('is false during the grace period', () => {
    const m = museum('a', 'A', 2);
    for (let day = 1; day < 1 + GRACE_DAYS; day++) {
      expect(isRaidable(m, day, 1), `day ${day}`).toBe(false);
    }
    expect(isRaidable(m, 1 + GRACE_DAYS, 1)).toBe(true);
  });

  it('is false for an empty museum', () => {
    expect(isRaidable(museum('a', 'A', 0), DAY, 1)).toBe(false);
  });
});

describe('attemptHeist', () => {
  it('moves exactly one piece from victim to raider', () => {
    const raider = museum('r', 'R', 0);
    const victim = museum('v', 'V', 3);
    const result = attemptHeist(raider, victim, Rng.fromSeed('h1'), DAY, { next: 1 });

    expect(result.outcome).toBe('stolen');
    expect(victim.exhibits).toHaveLength(2);
    expect(raider.inventory).toHaveLength(1);
    expect(raider.exhibits).toHaveLength(0); // loot lands in storage, not on show
  });

  it('stamps an indelible record carrying the caption at the time of theft', () => {
    const raider = museum('r', 'R', 0);
    const victim = museum('v', 'V', 1);
    victim.exhibits[0]!.caption = '唯一無二の遺物である。';
    victim.exhibits[0]!.score = scoreCaption('唯一無二の遺物である。', 'can');

    attemptHeist(raider, victim, Rng.fromSeed('h2'), DAY, { next: 1 });
    const history = raider.inventory[0]!.stolenHistory!;
    expect(history).toHaveLength(1);
    expect(history[0]!.fromMuseum).toBe('V');
    expect(history[0]!.onDay).toBe(DAY);
    expect(history[0]!.previousCaption).toBe('唯一無二の遺物である。');
  });

  it('accumulates a record per theft so a passed-around piece keeps every owner', () => {
    const a = museum('a', 'A', 1);
    const b = museum('b', 'B', 0);
    const c = museum('c', 'C', 0);
    const counter = { next: 1 };

    attemptHeist(b, a, Rng.fromSeed('h3'), DAY, counter);
    // B puts it on display, then C steals it.
    const looted = b.inventory.pop()!;
    b.exhibits.push({ ...exhibit('b_ex0'), stolenHistory: looted.stolenHistory ?? [] });
    attemptHeist(c, b, Rng.fromSeed('h4'), DAY, counter);

    const history = c.inventory[0]!.stolenHistory!;
    expect(history.map((h) => h.fromMuseum)).toEqual(['A', 'B']);
  });

  it('refuses to steal from a museum still in its grace period', () => {
    const raider = museum('r', 'R', 0);
    const victim = museum('v', 'V', 2, 10);
    const result = attemptHeist(raider, victim, Rng.fromSeed('h5'), 11, { next: 1 }, 10);
    expect(result.outcome).toBe('grace');
    expect(victim.exhibits).toHaveLength(2);
  });

  it('refuses to steal from an empty museum', () => {
    const result = attemptHeist(museum('r', 'R', 0), museum('v', 'V', 0), Rng.fromSeed('h6'), DAY, { next: 1 });
    expect(result.outcome).toBe('no_target');
  });

  it('refuses to steal from itself', () => {
    const self = museum('s', 'S', 2);
    const result = attemptHeist(self, self, Rng.fromSeed('h7'), DAY, { next: 1 });
    expect(result.outcome).toBe('self');
    expect(self.exhibits).toHaveLength(2);
  });

  it('refuses when the raider has nowhere to put the loot', () => {
    const raider = museum('r', 'R', 0);
    raider.inventory = Array.from({ length: MAX_INVENTORY }, (_, i) => ({
      id: `j${i}`, defId: 'can', foundDay: 1,
    }));
    const victim = museum('v', 'V', 2);
    const result = attemptHeist(raider, victim, Rng.fromSeed('h8'), DAY, { next: 1 });
    expect(result.outcome).toBe('inventory_full');
    expect(victim.exhibits).toHaveLength(2);
  });

  it('never leaves the victim with a negative exhibit count under repeated raids', () => {
    const raider = museum('r', 'R', 0);
    raider.inventory = [];
    const victim = museum('v', 'V', 2);
    const counter = { next: 1 };
    const rng = Rng.fromSeed('h9');
    for (let i = 0; i < 20; i++) attemptHeist(raider, victim, rng, DAY, counter);
    expect(victim.exhibits).toHaveLength(0);
    expect(raider.inventory).toHaveLength(2);
  });
});

describe('guards', () => {
  it('report zero block chance once expired', () => {
    const m = museum('v', 'V', 2);
    m.guard = { tier: 'elite', expiresOnDay: 5 };
    expect(guardBlockChance(m, 5)).toBeGreaterThan(0);
    expect(guardBlockChance(m, 6)).toBe(0);
  });

  it('an elite guard blocks most raids but not all', () => {
    let blocked = 0;
    const rng = Rng.fromSeed('guard-rate');
    const counter = { next: 1 };
    for (let i = 0; i < 2000; i++) {
      const raider = museum('r', 'R', 0);
      const victim = museum('v', 'V', 2);
      victim.guard = { tier: 'elite', expiresOnDay: DAY };
      if (attemptHeist(raider, victim, rng, DAY, counter).outcome === 'blocked') blocked += 1;
    }
    expect(blocked / 2000).toBeGreaterThan(0.78);
    expect(blocked / 2000).toBeLessThan(0.86);
  });

  it('consumes the same amount of randomness whether or not the raid is blocked', () => {
    // Replay determinism depends on the rng draw count being independent of
    // collection size and guard outcome.
    const counter = { next: 1 };
    const guarded = Rng.fromSeed('draws');
    const unguarded = Rng.fromSeed('draws');

    const a = museum('v', 'V', 4);
    a.guard = { tier: 'elite', expiresOnDay: DAY };
    attemptHeist(museum('r', 'R', 0), a, guarded, DAY, counter);

    const b = museum('v', 'V', 4);
    attemptHeist(museum('r', 'R', 0), b, unguarded, DAY, counter);

    // Both consumed: 1 chance() + 1 pickWeighted(). States must line up.
    expect(guarded.save()).toEqual(unguarded.save());
  });
});

describe('being robbed is not a pure loss', () => {
  it('gives the victim notoriety when a piece is taken', () => {
    const victim = museum('v', 'V', 2);
    const before = victim.buzz;
    attemptHeist(museum('r', 'R', 0), victim, Rng.fromSeed('buzz'), DAY, { next: 1 });
    expect(victim.buzz).toBeGreaterThan(before);
    expect(victim.fame).toBeGreaterThan(0);
  });

  it('gives a smaller bump when the guard repels the raid', () => {
    const robbed = museum('v', 'V', 2);
    attemptHeist(museum('r', 'R', 0), robbed, Rng.fromSeed('b1'), DAY, { next: 1 });

    const defended = museum('v', 'V', 2);
    defended.guard = { tier: 'elite', expiresOnDay: DAY };
    let attempts = 0;
    const rng = Rng.fromSeed('b2');
    while (attempts < 50) {
      const r = attemptHeist(museum('r', 'R', 0), defended, rng, DAY, { next: 1 });
      attempts += 1;
      if (r.outcome === 'blocked') break;
    }
    expect(defended.buzz).toBeLessThan(robbed.buzz);
  });
});
