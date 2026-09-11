import { describe, expect, it } from 'vitest';
import { apply, createGame } from '../src/core/game';
import { loadGame, serialize } from '../src/core/save';
import { Rng } from '../src/core/rng';
import { checkInvariants } from './invariants';
import { playRandomDay } from './driver';
import type { GameState } from '../src/core/types';

/** Play `days` days of pseudo-random but legal player behaviour. */
function simulate(seed: string, days: number, onDay?: (s: GameState) => void): GameState {
  let state = createGame(seed);
  const rng = Rng.fromSeed(`driver-${seed}`);
  for (let d = 0; d < days; d++) {
    state = playRandomDay(state, rng);
    onDay?.(state);
  }
  return state;
}

describe('long simulation', () => {
  for (const seed of ['soak-a', 'soak-b', 'soak-c']) {
    it(`holds every invariant for 200 days (${seed})`, () => {
      let worst: string[] = [];
      let worstDay = 0;
      const state = simulate(seed, 200, (s) => {
        const violations = checkInvariants(s);
        if (violations.length > worst.length) {
          worst = violations;
          worstDay = s.day;
        }
      });
      expect(worst, `day ${worstDay}: ${worst.join(' | ')}`).toEqual([]);
      expect(state.day).toBe(201);
    });
  }

  it('never reaches a dead end: the day can always be advanced', () => {
    // Progress must never depend on money. From any reachable morning the
    // player can always open and close the day.
    const state = simulate('broke', 150);
    const stuck = structuredClone(state);
    stuck.player.money = 0;
    stuck.phase = 'morning';

    const opened = apply(stuck, { type: 'openMuseum' });
    expect(opened.ok).toBe(true);
    expect(apply(opened.state, { type: 'endNight' }).ok).toBe(true);
  });

  it('a full store is always recoverable without spending money', () => {
    const state = simulate('full-store', 120);
    const stuck = structuredClone(state);
    stuck.phase = 'morning';
    stuck.player.money = 0;
    stuck.player.foragesLeft = 4;
    stuck.player.inventory = Array.from({ length: 24 }, (_, i) => ({
      id: `junk_stuck${i}`,
      defId: 'can',
      foundDay: 1,
    }));

    expect(apply(stuck, { type: 'forage' }).ok).toBe(false);
    const dropped = apply(stuck, { type: 'discard', itemId: 'junk_stuck0' });
    expect(dropped.ok).toBe(true);
    expect(apply(dropped.state, { type: 'forage' }).ok).toBe(true);
  });

  it('keeps the economy bounded rather than exploding', () => {
    const state = simulate('econ', 300);
    expect(state.player.money).toBeLessThan(9_999_999);
    expect(state.player.buzz).toBeLessThan(99_999);
    expect(state.player.authority).toBeLessThan(99_999);
  });

  it('keeps a day inside a sane time budget', () => {
    const start = performance.now();
    simulate('perf', 200);
    const elapsed = performance.now() - start;
    expect(elapsed / 200).toBeLessThan(25); // ms per simulated day
  });

  it('round-trips through a save at every step of a long game', () => {
    let state = createGame('save-soak');
    const rng = Rng.fromSeed('driver-save-soak');
    for (let d = 0; d < 60; d++) {
      state = playRandomDay(state, rng);
      const result = loadGame(serialize(state));
      expect(result.ok, `day ${state.day}`).toBe(true);
      if (!result.ok) return;
      expect(result.repairs, `day ${state.day}`).toEqual([]);
      expect(serialize(result.state), `day ${state.day}`).toBe(serialize(state));
      state = result.state;
    }
  });

  it('is fully reproducible from the seed', () => {
    expect(serialize(simulate('repro', 80))).toBe(serialize(simulate('repro', 80)));
  });

  it('grows the save file sub-linearly once the caps engage', () => {
    const short = serialize(simulate('size', 60)).length;
    const long = serialize(simulate('size', 240)).length;
    // 4x the days must not mean 4x the bytes.
    expect(long).toBeLessThan(short * 2.5);
  });
});

describe('rival health over a long game', () => {
  it('does not let every rival be robbed into permanent emptiness', () => {
    const state = simulate('rivals', 250);
    const alive = state.rivals.filter((r) => r.exhibits.length > 0).length;
    expect(alive).toBeGreaterThan(0);
  });

  it('keeps rival money non-negative and bounded', () => {
    const state = simulate('rival-money', 250);
    for (const rival of state.rivals) {
      expect(Number.isSafeInteger(rival.money)).toBe(true);
      expect(rival.money).toBeGreaterThanOrEqual(0);
    }
  });
});
