import { describe, expect, it } from 'vitest';
import { apply, createGame, standings } from '../src/core/game';
import type { Action } from '../src/core/game';
import {
  GUARDS,
  FORAGES_PER_DAY,
  MAX_INVENTORY,
  MAX_LOG,
  MAX_SLOTS,
  STARTING_MONEY,
  STARTING_SLOTS,
  slotPrice,
} from '../src/core/content';
import type { GameState } from '../src/core/types';
import { serialize } from '../src/core/save';

const GOOD = '1847年、旧市街の遺構より出土。用途は不明であり、鑑定が継続中である。';

function run(state: GameState, ...actions: Action[]): GameState {
  let s = state;
  for (const a of actions) s = apply(s, a).state;
  return s;
}

/** Forage once and place the item with `caption`. */
function forageAndPlace(state: GameState, caption = GOOD): GameState {
  const after = apply(state, { type: 'forage' }).state;
  const item = after.player.inventory[after.player.inventory.length - 1];
  if (!item) throw new Error('forage produced nothing');
  return apply(after, { type: 'place', itemId: item.id, caption }).state;
}

describe('createGame', () => {
  it('starts on day 1, morning, with the configured purse and rivals', () => {
    const s = createGame('seed-a');
    expect(s.day).toBe(1);
    expect(s.phase).toBe('morning');
    expect(s.player.money).toBe(STARTING_MONEY);
    expect(s.player.slots).toBe(STARTING_SLOTS);
    expect(s.player.foragesLeft).toBe(FORAGES_PER_DAY);
    expect(s.rivals.length).toBeGreaterThan(0);
  });

  it('is reproducible from a seed', () => {
    expect(serialize(createGame('same'))).toBe(serialize(createGame('same')));
  });

  it('produces different worlds for different seeds', () => {
    expect(serialize(createGame('a'))).not.toBe(serialize(createGame('b')));
  });

  it('mints unique ids across the player and every rival', () => {
    const s = createGame('ids');
    const ids = [s.player.id, ...s.rivals.map((r) => r.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('apply - purity', () => {
  it('does not mutate the previous state', () => {
    const before = createGame('purity');
    const snapshot = serialize(before);
    apply(before, { type: 'forage' });
    apply(before, { type: 'openMuseum' });
    apply(before, { type: 'buySlot' });
    expect(serialize(before)).toBe(snapshot);
  });

  it('returns a state that shares no references with the input', () => {
    const before = createGame('refs');
    const after = apply(before, { type: 'forage' }).state;
    expect(after).not.toBe(before);
    expect(after.player).not.toBe(before.player);
    expect(after.player.inventory).not.toBe(before.player.inventory);
  });

  it('is deterministic: the same action sequence yields the same state', () => {
    const script: Action[] = [
      { type: 'forage' }, { type: 'forage' }, { type: 'openMuseum' }, { type: 'endNight' },
      { type: 'forage' }, { type: 'openMuseum' }, { type: 'endNight' },
    ];
    expect(serialize(run(createGame('det'), ...script))).toBe(
      serialize(run(createGame('det'), ...script)),
    );
  });
});

describe('apply - phase gating', () => {
  it('rejects morning actions at night', () => {
    const night = apply(createGame('gate'), { type: 'openMuseum' }).state;
    expect(night.phase).toBe('night');
    for (const action of [
      { type: 'forage' },
      { type: 'buySlot' },
      { type: 'buyGuard', tier: 'pro' },
      { type: 'discard', itemId: 'x' },
    ] as Action[]) {
      const r = apply(night, action);
      expect(r.ok, action.type).toBe(false);
    }
  });

  it('rejects raid and endNight in the morning', () => {
    const s = createGame('gate2');
    expect(apply(s, { type: 'raid', rivalId: s.rivals[0]!.id }).ok).toBe(false);
    expect(apply(s, { type: 'endNight' }).ok).toBe(false);
  });

  it('rejects opening twice in one day', () => {
    const open = apply(createGame('twice'), { type: 'openMuseum' }).state;
    expect(apply(open, { type: 'openMuseum' }).ok).toBe(false);
  });
});

describe('apply - forage', () => {
  it('consumes one action per pickup and stops at the daily limit', () => {
    let s = createGame('forage');
    for (let i = 0; i < FORAGES_PER_DAY; i++) {
      const r = apply(s, { type: 'forage' });
      expect(r.ok).toBe(true);
      s = r.state;
    }
    expect(s.player.foragesLeft).toBe(0);
    expect(apply(s, { type: 'forage' }).ok).toBe(false);
    expect(s.player.inventory).toHaveLength(FORAGES_PER_DAY);
  });

  it('refills the allowance the next morning', () => {
    let s = createGame('refill');
    s = run(s, { type: 'forage' }, { type: 'openMuseum' }, { type: 'endNight' });
    expect(s.player.foragesLeft).toBe(FORAGES_PER_DAY);
  });

  it('refuses to overflow the inventory', () => {
    let s = createGame('overflow');
    // Fill the inventory directly, then confirm the guard holds.
    s = structuredClone(s);
    s.player.inventory = Array.from({ length: MAX_INVENTORY }, (_, i) => ({
      id: `junk_fill${i}`,
      defId: 'can',
      foundDay: 1,
    }));
    const r = apply(s, { type: 'forage' });
    expect(r.ok).toBe(false);
    expect(r.state.player.inventory).toHaveLength(MAX_INVENTORY);
  });
});

describe('apply - place / recaption / withdraw', () => {
  it('places an item and removes it from the inventory exactly once', () => {
    const s = forageAndPlace(createGame('place'));
    expect(s.player.exhibits).toHaveLength(1);
    expect(s.player.inventory).toHaveLength(0);
    expect(s.totals.exhibitsPlaced).toBe(1);
  });

  it('rejects a caption that fails moderation and consumes nothing', () => {
    const after = apply(createGame('mod'), { type: 'forage' }).state;
    const item = after.player.inventory[0]!;
    const r = apply(after, { type: 'place', itemId: item.id, caption: 'fuck this' });
    expect(r.ok).toBe(false);
    expect(r.state.player.inventory).toHaveLength(1);
    expect(r.state.player.exhibits).toHaveLength(0);
  });

  it('rejects an unknown item id', () => {
    const s = createGame('unknown');
    expect(apply(s, { type: 'place', itemId: 'nope', caption: GOOD }).ok).toBe(false);
  });

  it('refuses to place beyond the slot count', () => {
    let s = createGame('slots');
    for (let i = 0; i < STARTING_SLOTS; i++) s = forageAndPlace(s);
    expect(s.player.exhibits).toHaveLength(STARTING_SLOTS);

    const after = apply(s, { type: 'forage' }).state;
    const item = after.player.inventory[0]!;
    const r = apply(after, { type: 'place', itemId: item.id, caption: GOOD });
    expect(r.ok).toBe(false);
    expect(r.state.player.exhibits).toHaveLength(STARTING_SLOTS);
  });

  it('recaption rescores but keeps votes and tips', () => {
    let s = forageAndPlace(createGame('recap'));
    s = run(s, { type: 'openMuseum' }, { type: 'endNight' });
    const before = s.player.exhibits[0]!;
    const votes = before.votesReal + before.votesFake;

    const r = apply(s, {
      type: 'recaption',
      exhibitId: before.id,
      caption: '世界最古の呪われた遺物！絶対に触るな！',
    });
    expect(r.ok).toBe(true);
    const after = r.state.player.exhibits[0]!;
    expect(after.votesReal + after.votesFake).toBe(votes);
    expect(after.tipsEarned).toBe(before.tipsEarned);
    expect(after.score.absurdity).toBeGreaterThan(before.score.absurdity);
  });

  it('withdraw returns the piece to the inventory', () => {
    const s = forageAndPlace(createGame('withdraw'));
    const r = apply(s, { type: 'withdraw', exhibitId: s.player.exhibits[0]!.id });
    expect(r.ok).toBe(true);
    expect(r.state.player.exhibits).toHaveLength(0);
    expect(r.state.player.inventory).toHaveLength(1);
  });
});

describe('apply - purchases are atomic', () => {
  it('buySlot charges the listed price and raises the cap', () => {
    let s = createGame('buyslot');
    s = structuredClone(s);
    s.player.money = 10_000;
    const price = slotPrice(s.player.slots);
    const r = apply(s, { type: 'buySlot' });
    expect(r.ok).toBe(true);
    expect(r.state.player.slots).toBe(STARTING_SLOTS + 1);
    expect(r.state.player.money).toBe(10_000 - price);
  });

  it('buySlot fails without deducting when the purse is short', () => {
    const s = createGame('poor');
    const r = apply(s, { type: 'buySlot' });
    const price = slotPrice(STARTING_SLOTS);
    if (STARTING_MONEY < price) {
      expect(r.ok).toBe(false);
      expect(r.state.player.money).toBe(STARTING_MONEY);
      expect(r.state.player.slots).toBe(STARTING_SLOTS);
    }
  });

  it('refuses to buy past MAX_SLOTS', () => {
    const s = structuredClone(createGame('maxslots'));
    s.player.money = 9_999_999;
    s.player.slots = MAX_SLOTS;
    const r = apply(s, { type: 'buySlot' });
    expect(r.ok).toBe(false);
    expect(r.state.player.slots).toBe(MAX_SLOTS);
  });

  it('case upgrades charge only the difference and refuse a downgrade', () => {
    let s = structuredClone(forageAndPlace(createGame('case')));
    s.player.money = 10_000;
    const id = s.player.exhibits[0]!.id;

    const toGlass = apply(s, { type: 'buyCase', exhibitId: id, tier: 'glass' });
    expect(toGlass.ok).toBe(true);
    expect(toGlass.state.player.money).toBe(10_000 - 120);

    const toGold = apply(toGlass.state, { type: 'buyCase', exhibitId: id, tier: 'gold' });
    expect(toGold.ok).toBe(true);
    expect(toGold.state.player.money).toBe(10_000 - 120 - (1800 - 120));

    const back = apply(toGold.state, { type: 'buyCase', exhibitId: id, tier: 'glass' });
    expect(back.ok).toBe(false);
    expect(back.state.player.money).toBe(toGold.state.player.money);
  });

  it('a ladder of case upgrades costs the same as one leap', () => {
    const base = structuredClone(forageAndPlace(createGame('ladder')));
    base.player.money = 10_000;
    const id = base.player.exhibits[0]!.id;

    const ladder = run(
      base,
      { type: 'buyCase', exhibitId: id, tier: 'glass' },
      { type: 'buyCase', exhibitId: id, tier: 'marble' },
      { type: 'buyCase', exhibitId: id, tier: 'gold' },
    );
    const leap = apply(base, { type: 'buyCase', exhibitId: id, tier: 'gold' }).state;
    expect(ladder.player.money).toBe(leap.player.money);
  });

  it('lighting stops at the maximum', () => {
    let s = structuredClone(forageAndPlace(createGame('light')));
    s.player.money = 10_000;
    const id = s.player.exhibits[0]!.id;
    for (let i = 0; i < 3; i++) {
      const r = apply(s, { type: 'buyLighting', exhibitId: id });
      expect(r.ok, `step ${i}`).toBe(true);
      s = r.state;
    }
    expect(s.player.exhibits[0]!.lighting).toBe(3);
    expect(apply(s, { type: 'buyLighting', exhibitId: id }).ok).toBe(false);
  });

  it('re-hiring a guard resets the expiry instead of stacking it', () => {
    let s = structuredClone(createGame('guard'));
    s.player.money = 10_000;
    s = apply(s, { type: 'buyGuard', tier: 'pro' }).state;
    const first = s.player.guard!.expiresOnDay;
    s = apply(s, { type: 'buyGuard', tier: 'pro' }).state;
    expect(s.player.guard!.expiresOnDay).toBe(first);
  });
});

describe('apply - day cycle', () => {
  it('openMuseum then endNight advances exactly one day', () => {
    const s = run(createGame('cycle'), { type: 'openMuseum' }, { type: 'endNight' });
    expect(s.day).toBe(2);
    expect(s.phase).toBe('morning');
  });

  it('records one report per day', () => {
    let s = createGame('reports');
    for (let i = 0; i < 5; i++) s = run(s, { type: 'openMuseum' }, { type: 'endNight' });
    expect(s.reports).toHaveLength(5);
    expect(s.reports.map((r) => r.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it('drops a guard once it expires', () => {
    let s = structuredClone(createGame('expire'));
    s.player.money = 10_000;
    s = apply(s, { type: 'buyGuard', tier: 'volunteer' }).state;
    expect(s.player.guard).not.toBeNull();
    for (let i = 0; i < 4; i++) s = run(s, { type: 'openMuseum' }, { type: 'endNight' });
    expect(s.player.guard).toBeNull();
  });

  it('spawns a relic every seventh day and clears it otherwise', () => {
    let s = createGame('relic');
    const relicDays: number[] = [];
    for (let i = 0; i < 15; i++) {
      if (s.relic) relicDays.push(s.day);
      s = run(s, { type: 'openMuseum' }, { type: 'endNight' });
    }
    expect(relicDays).toEqual([7, 14]);
  });

  it('hands an unclaimed relic to a rival at closing time', () => {
    let s = createGame('relic2');
    while (s.day < 7) s = run(s, { type: 'openMuseum' }, { type: 'endNight' });
    expect(s.relic?.claimedBy).toBeNull();
    s = apply(s, { type: 'openMuseum' }).state;
    expect(s.relic?.claimedBy).not.toBeNull();
    expect(s.relic?.claimedBy).not.toBe(s.player.id);
  });

  it('lets the player claim the relic first, and only once', () => {
    let s = createGame('relic3');
    while (s.day < 7) s = run(s, { type: 'openMuseum' }, { type: 'endNight' });
    const first = apply(s, { type: 'claimRelic' });
    expect(first.ok).toBe(true);
    expect(first.state.player.inventory.some((i) => i.genuine)).toBe(true);
    expect(apply(first.state, { type: 'claimRelic' }).ok).toBe(false);
  });

  it('caps the log so a long game cannot grow the save without bound', () => {
    let s = createGame('log');
    for (let i = 0; i < 120; i++) s = run(s, { type: 'openMuseum' }, { type: 'endNight' });
    expect(s.log.length).toBeLessThanOrEqual(MAX_LOG);
  });
});

describe('standings', () => {
  it('includes every museum exactly once and marks the player', () => {
    const s = createGame('rank');
    const rows = standings(s);
    expect(rows).toHaveLength(1 + s.rivals.length);
    expect(rows.filter((r) => r.isPlayer)).toHaveLength(1);
  });

  it('is sorted by score descending and stable for ties', () => {
    const s = createGame('rank2');
    const rows = standings(s);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.score).toBeGreaterThanOrEqual(rows[i]!.score);
    }
    expect(standings(s)).toEqual(rows);
  });
});

describe('apply - rename', () => {
  it('accepts a normal name and rejects an abusive one', () => {
    const s = createGame('name');
    expect(apply(s, { type: 'rename', name: '夜光館' }).state.player.name).toBe('夜光館');
    expect(apply(s, { type: 'rename', name: 'fuck museum' }).ok).toBe(false);
    expect(apply(s, { type: 'rename', name: '   ' }).ok).toBe(false);
  });

  it('allows a short name even though captions require more characters', () => {
    const r = apply(createGame('shortname'), { type: 'rename', name: '館' });
    expect(r.ok).toBe(true);
    expect(r.state.player.name).toBe('館');
  });
});

describe('guard duration matches what the shop advertises', () => {
  it('a 3-day guard covers exactly three nights', () => {
    // Regression: expiresOnDay was day + days, which sold a "3日" guard that
    // protected four nights and displayed "あと4日" on the day of purchase.
    let s = structuredClone(createGame('guard-days'));
    s.player.money = 10_000;
    const startDay = s.day;
    s = apply(s, { type: 'buyGuard', tier: 'pro' }).state;
    expect(s.player.guard!.expiresOnDay).toBe(startDay + 2);

    let covered = 0;
    for (let i = 0; i < 6; i++) {
      if (s.player.guard && s.player.guard.expiresOnDay >= s.day) covered += 1;
      s = run(s, { type: 'openMuseum' }, { type: 'endNight' });
    }
    expect(covered).toBe(3);
    expect(s.player.guard).toBeNull();
  });

  it('every guard tier delivers the advertised number of days', () => {
    for (const tier of ['volunteer', 'pro', 'elite'] as const) {
      const def = GUARDS.find((g) => g.tier === tier)!;
      let s = structuredClone(createGame(`dur-${tier}`));
      s.player.money = 10_000;
      s = apply(s, { type: 'buyGuard', tier }).state;
      const daysLeft = s.player.guard!.expiresOnDay - s.day + 1;
      expect(daysLeft, tier).toBe(def.days);
    }
  });
});
