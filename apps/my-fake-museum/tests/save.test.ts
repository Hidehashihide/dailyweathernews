import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { loadGame, serialize } from '../src/core/save';
import { apply, createGame } from '../src/core/game';
import type { Action } from '../src/core/game';
import { Rng } from '../src/core/rng';
import { MAX_SLOTS, STARTING_SLOTS } from '../src/core/content';
import { SAVE_VERSION } from '../src/core/types';
import type { GameState } from '../src/core/types';

function play(seed: string, days: number): GameState {
  let s = createGame(seed);
  for (let d = 0; d < days; d++) {
    s = apply(s, { type: 'forage' }).state;
    const item = s.player.inventory[0];
    if (item) {
      s = apply(s, {
        type: 'place',
        itemId: item.id,
        caption: `${1800 + d}年、旧市街の遺構より出土した断片である。`,
      }).state;
    }
    s = apply(s, { type: 'openMuseum' }).state;
    const rival = s.rivals[d % s.rivals.length];
    if (rival) s = apply(s, { type: 'raid', rivalId: rival.id }).state;
    s = apply(s, { type: 'endNight' }).state;
  }
  return s;
}

describe('round trip', () => {
  it('restores an identical state', () => {
    const original = play('rt', 12);
    const result = loadGame(serialize(original));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(original);
    expect(result.repairs).toEqual([]);
  });

  it('restores the random stream exactly, so the next day is unchanged', () => {
    const original = play('stream', 6);
    const loaded = loadGame(serialize(original));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const next: Action[] = [{ type: 'openMuseum' }, { type: 'endNight' }];
    let a = original;
    let b = loaded.state;
    for (const action of next) {
      a = apply(a, action).state;
      b = apply(b, action).state;
    }
    expect(serialize(b)).toBe(serialize(a));
  });

  it('survives many save/load cycles without drift', () => {
    let s = play('cycles', 3);
    for (let i = 0; i < 30; i++) {
      const r = loadGame(serialize(s));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
      s = apply(s, { type: 'openMuseum' }).state;
      s = apply(s, { type: 'endNight' }).state;
    }
    expect(s.day).toBe(34);
    expect(Number.isSafeInteger(s.player.money)).toBe(true);
  });

  it('keeps rng words unsigned through JSON', () => {
    // A negative word would be clamped to zero by the loader and silently
    // reset the player's random stream.
    const s = play('unsigned', 8);
    for (const word of [s.rng.a, s.rng.b, s.rng.c, s.rng.d]) {
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThanOrEqual(0xffffffff);
    }
    const loaded = loadGame(serialize(s));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.state.rng).toEqual(s.rng);
  });
});

describe('rejects unusable input without throwing', () => {
  const bad = ['', '   ', 'not json', '{', '[]', 'null', '42', '"string"', '{"version":1'];
  for (const json of bad) {
    it(`rejects ${JSON.stringify(json)}`, () => {
      const r = loadGame(json);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBeTruthy();
    });
  }

  it('never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (json) => {
        expect(() => loadGame(json)).not.toThrow();
      }),
      { numRuns: 800 },
    );
  });

  it('never throws on arbitrary JSON values', () => {
    fc.assert(
      fc.property(fc.json(), (json) => {
        expect(() => loadGame(json)).not.toThrow();
      }),
      { numRuns: 800 },
    );
  });

  it('refuses a save from a newer version rather than mangling it', () => {
    const s = createGame('future');
    const payload = JSON.parse(serialize(s));
    payload.version = SAVE_VERSION + 5;
    const r = loadGame(JSON.stringify(payload));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('新しいバージョン');
  });
});

describe('repairs corrupt fields instead of losing the save', () => {
  function corrupt(mutate: (data: Record<string, unknown>) => void): ReturnType<typeof loadGame> {
    const payload = JSON.parse(serialize(play('corrupt', 4))) as Record<string, unknown>;
    mutate(payload);
    return loadGame(JSON.stringify(payload));
  }

  it('recovers a NaN-ish money value', () => {
    const r = corrupt((d) => {
      (d['player'] as Record<string, unknown>)['money'] = null;
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.player.money).toBe(0);
  });

  it('clamps an out-of-range money value', () => {
    const r = corrupt((d) => {
      (d['player'] as Record<string, unknown>)['money'] = 1e30;
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number.isSafeInteger(r.state.player.money)).toBe(true);
  });

  it('rebuilds a zeroed rng state', () => {
    const r = corrupt((d) => {
      d['rng'] = { a: 0, b: 0, c: 0, d: 0 };
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairs.some((m) => m.includes('乱数'))).toBe(true);
    const rng = new Rng(r.state.rng);
    expect(new Set(Array.from({ length: 50 }, () => rng.next())).size).toBeGreaterThan(25);
  });

  it('drops exhibits missing an id and keeps the rest', () => {
    const r = corrupt((d) => {
      const player = d['player'] as Record<string, unknown>;
      const exhibits = player['exhibits'] as Record<string, unknown>[];
      exhibits.push({ defId: 'can', caption: 'x' });
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repairs.some((m) => m.includes('破棄'))).toBe(true);
  });

  it('clamps slots into the legal range', () => {
    const r = corrupt((d) => {
      (d['player'] as Record<string, unknown>)['slots'] = 9999;
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.player.slots).toBeLessThanOrEqual(MAX_SLOTS);

    const low = corrupt((d) => {
      (d['player'] as Record<string, unknown>)['slots'] = -4;
    });
    if (low.ok) expect(low.state.player.slots).toBeGreaterThanOrEqual(STARTING_SLOTS);
  });

  it('moves over-capacity exhibits back into storage', () => {
    const r = corrupt((d) => {
      const player = d['player'] as Record<string, unknown>;
      player['slots'] = 3;
      const exhibits = player['exhibits'] as Record<string, unknown>[];
      const template = exhibits[0];
      for (let i = 0; i < 8; i++) exhibits.push({ ...template, id: `ex_extra${i}` });
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.player.exhibits.length).toBeLessThanOrEqual(r.state.player.slots);
    expect(r.repairs.some((m) => m.includes('展示枠'))).toBe(true);
  });

  it('recomputes scores rather than trusting the file', () => {
    const r = corrupt((d) => {
      const exhibits = (d['player'] as Record<string, unknown>)['exhibits'] as Record<string, unknown>[];
      const first = exhibits[0];
      if (first) first['score'] = { tipMultiplier: 9999, plausibility: 1e9 };
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const exhibit = r.state.player.exhibits[0];
    if (exhibit) {
      expect(exhibit.score.tipMultiplier).toBeLessThanOrEqual(3);
      expect(exhibit.score.plausibility).toBeLessThanOrEqual(100);
    }
  });

  it('advances a stale id counter so new ids cannot collide', () => {
    const r = corrupt((d) => {
      d['idCounter'] = { next: 1 };
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairs.some((m) => m.includes('ID'))).toBe(true);

    const existing = new Set<string>([
      ...r.state.player.exhibits.map((e) => e.id),
      ...r.state.player.inventory.map((i) => i.id),
    ]);
    let s = r.state;
    for (let i = 0; i < 4; i++) s = apply(s, { type: 'forage' }).state;
    for (const item of s.player.inventory) {
      if (!existing.has(item.id)) existing.add(item.id);
    }
    const allIds = [...s.player.exhibits.map((e) => e.id), ...s.player.inventory.map((i) => i.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('survives losing the entire rivals array', () => {
    const r = corrupt((d) => {
      d['rivals'] = 'not an array';
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.rivals).toEqual([]);
  });

  it('survives a missing player object', () => {
    const r = corrupt((d) => {
      delete d['player'];
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.player.name).toBeTruthy();
  });
});

describe('migration', () => {
  it('upgrades a v1 payload', () => {
    const s = createGame('v1');
    const payload = JSON.parse(serialize(s)) as Record<string, unknown>;
    payload['version'] = 1;
    delete payload['totals'];
    delete (payload['player'] as Record<string, unknown>)['foundedDay'];

    const r = loadGame(JSON.stringify(payload));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.version).toBe(SAVE_VERSION);
    expect(r.state.player.foundedDay).toBe(1);
    expect(r.state.totals.tips).toBe(0);
    expect(r.repairs.some((m) => m.includes('v1'))).toBe(true);
    expect(r.repairs.some((m) => m.includes('v2'))).toBe(true);
  });

  it('upgrades a v2 payload without re-running the v1 step', () => {
    const s = createGame('v2');
    const payload = JSON.parse(serialize(s)) as Record<string, unknown>;
    payload['version'] = 2;
    const r = loadGame(JSON.stringify(payload));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairs.some((m) => m.includes('v1'))).toBe(false);
    expect(r.repairs.some((m) => m.includes('v2'))).toBe(true);
  });

  it('a migrated save is playable', () => {
    const payload = JSON.parse(serialize(play('mig', 5))) as Record<string, unknown>;
    payload['version'] = 1;
    const r = loadGame(JSON.stringify(payload));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let s = r.state;
    for (let i = 0; i < 5; i++) {
      s = apply(s, { type: 'openMuseum' }).state;
      s = apply(s, { type: 'endNight' }).state;
    }
    expect(s.day).toBeGreaterThan(r.state.day);
  });
});
