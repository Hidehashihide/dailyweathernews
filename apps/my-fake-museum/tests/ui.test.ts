/**
 * View-model and long-game regression tests.
 *
 * The DOM itself is covered by tests/e2e/smoke.mjs in a real browser; this file
 * covers the pure layer underneath it, plus the counter-overflow regressions
 * that only a long game reaches.
 */

import { describe, expect, it } from 'vitest';
import { apply, createGame } from '../src/core/game';
import { loadGame, serialize } from '../src/core/save';
import { Rng } from '../src/core/rng';
import { MAX_STAT, MAX_TOTAL, clampTotal } from '../src/core/economy';
import { playRandomDay } from './driver';
import {
  exhibitViews,
  guardOptions,
  headerView,
  itemViews,
  lastReport,
  recentLog,
  rivalViews,
  standingsView,
} from '../src/ui/render';
import type { GameState } from '../src/core/types';

const GOOD = '1847年、旧市街の遺構より出土。用途は不明であり、鑑定が継続中である。';

function withOneExhibit(seed = 'ui'): GameState {
  let s = apply(createGame(seed), { type: 'forage' }).state;
  const item = s.player.inventory[0];
  if (!item) throw new Error('no item');
  s = apply(s, { type: 'place', itemId: item.id, caption: GOOD }).state;
  return s;
}

function simulate(seed: string, days: number): GameState {
  let state = createGame(seed);
  const rng = Rng.fromSeed(`driver-${seed}`);
  for (let d = 0; d < days; d++) state = playRandomDay(state, rng);
  return state;
}

describe('headerView', () => {
  it('reports the opening position', () => {
    const h = headerView(createGame('hv'));
    expect(h.day).toBe(1);
    expect(h.phaseLabel).toContain('朝');
    expect(h.slotsUsed).toBe(0);
    expect(h.guardLabel).toBe('無警備');
    expect(h.relicName).toBeNull();
  });

  it('shows the remaining guard days inclusively', () => {
    let s = structuredClone(createGame('hv2'));
    s.player.money = 10_000;
    s = apply(s, { type: 'buyGuard', tier: 'volunteer' }).state;
    expect(headerView(s).guardLabel).toContain('あと3日');
  });

  it('hides an expired guard rather than showing a negative count', () => {
    const s = structuredClone(createGame('hv3'));
    s.player.guard = { tier: 'pro', expiresOnDay: 0 };
    expect(headerView(s).guardLabel).toBe('無警備');
  });

  it('announces a claimable relic', () => {
    let s = createGame('hv4');
    while (s.day < 7) {
      s = apply(s, { type: 'openMuseum' }).state;
      s = apply(s, { type: 'endNight' }).state;
    }
    const h = headerView(s);
    expect(h.relicName).toBeTruthy();
    expect(h.relicClaimable).toBe(true);
  });
});

describe('exhibitViews', () => {
  it('carries the caption through verbatim', () => {
    const views = exhibitViews(withOneExhibit());
    expect(views).toHaveLength(1);
    expect(views[0]!.caption).toBe(GOOD);
  });

  it('offers the next case up, priced as the difference', () => {
    const view = exhibitViews(withOneExhibit('case'))[0]!;
    expect(view.nextCaseTier).toBe('glass');
    expect(view.nextCasePrice).toBe(120);
  });

  it('stops offering upgrades at the top tier', () => {
    const s = structuredClone(withOneExhibit('top'));
    s.player.exhibits[0]!.caseTier = 'gold';
    s.player.exhibits[0]!.lighting = 3;
    const view = exhibitViews(s)[0]!;
    expect(view.nextCaseTier).toBeNull();
    expect(view.nextLightingPrice).toBeNull();
  });

  it('surfaces the full theft chain', () => {
    const s = structuredClone(withOneExhibit('theft'));
    s.player.exhibits[0]!.stolenHistory = [
      { fromMuseum: 'A館', onDay: 4, previousCaption: 'x' },
      { fromMuseum: 'B館', onDay: 9, previousCaption: 'y' },
    ];
    expect(exhibitViews(s)[0]!.stolenFrom).toEqual(['A館', 'B館']);
  });
});

describe('itemViews / rivalViews / standings', () => {
  it('lists inventory with rarity and theft marks', () => {
    const s = apply(createGame('items'), { type: 'forage' }).state;
    const views = itemViews(s);
    expect(views).toHaveLength(1);
    expect(views[0]!.rarity).toBeTruthy();
    expect(views[0]!.stolenFrom).toEqual([]);
  });

  it('marks a rival unraidable during the grace period', () => {
    const s = createGame('grace');
    expect(rivalViews(s).every((r) => !r.raidable)).toBe(true);
  });

  it('lists every museum exactly once in the standings', () => {
    const s = createGame('rank');
    expect(standingsView(s)).toHaveLength(1 + s.rivals.length);
  });

  it('marks guard options the player cannot afford', () => {
    const s = structuredClone(createGame('afford'));
    s.player.money = 100;
    const options = guardOptions(s);
    expect(options[0]!.affordable).toBe(true); // 90
    expect(options[options.length - 1]!.affordable).toBe(false); // 950
  });
});

describe('log and report views', () => {
  it('returns the newest entries first and respects the limit', () => {
    let s = createGame('log');
    for (let i = 0; i < 20; i++) {
      s = apply(s, { type: 'openMuseum' }).state;
      s = apply(s, { type: 'endNight' }).state;
    }
    const entries = recentLog(s, 5);
    expect(entries).toHaveLength(5);
    expect(entries[0]!.day).toBeGreaterThanOrEqual(entries[4]!.day);
  });

  it('has no report before the first opening', () => {
    expect(lastReport(createGame('rep'))).toBeNull();
  });
});

describe('long-game counter regressions', () => {
  it('lifetime totals keep growing past MAX_STAT', () => {
    // Regression: totals were clamped with the museum-stat ceiling (99,999),
    // which froze the stats screen and made save/load disagree around day 350.
    const state = simulate('totals', 400);
    expect(state.totals.visitors).toBeGreaterThan(MAX_STAT);
    expect(state.totals.visitors).toBeLessThanOrEqual(MAX_TOTAL);

    const loaded = loadGame(serialize(state));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.state.totals).toEqual(state.totals);
  });

  it('clampTotal agrees with itself on both paths', () => {
    expect(clampTotal(MAX_TOTAL + 1)).toBe(MAX_TOTAL);
    expect(clampTotal(-5)).toBe(0);
    expect(clampTotal(NaN)).toBe(0);
  });

  it('per-exhibit vote counters never exceed the ceiling the loader enforces', () => {
    const state = simulate('votes', 400);
    for (const e of state.player.exhibits) {
      expect(e.votesReal).toBeLessThanOrEqual(MAX_STAT);
      expect(e.votesFake).toBeLessThanOrEqual(MAX_STAT);
    }
    const loaded = loadGame(serialize(state));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(serialize(loaded.state)).toBe(serialize(state));
  });

  it('survives a 500-day game with a clean save round-trip', () => {
    const state = simulate('long', 500);
    const loaded = loadGame(serialize(state));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.repairs).toEqual([]);
    expect(serialize(loaded.state)).toBe(serialize(state));
  });
});
