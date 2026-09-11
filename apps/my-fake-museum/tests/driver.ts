/**
 * A pseudo-player.
 *
 * Drives the reducer through legal-looking behaviour so the soak run exercises
 * realistic sequences instead of one scripted path. It deliberately also issues
 * some *illegal* actions (raiding in the morning, buying with an empty purse)
 * to prove the reducer rejects them without corrupting state.
 */

import { apply } from '../src/core/game';
import type { Action } from '../src/core/game';
import { CASES, GUARDS } from '../src/core/content';
import type { GameState } from '../src/core/types';
import type { Rng } from '../src/core/rng';

const CAPTION_POOL: readonly string[] = [
  '1847年、旧市街の遺構より出土。用途は不明であり、鑑定が継続中である。',
  '世界最古の遺物である。異論は一切認めない！',
  '初代館長が晩年まで手放さなかったとされる一点。真贋については諸説ある。',
  '呪われている。触れた者は必ず後悔すると伝えられる。',
  '鉄の表面に残る刻印が、その来歴を静かに語っている。',
  '紀元前3世紀の副葬品と推定される断片。層位の照合が続いている。',
  'これが何なのか、当館にも分からない。だが展示する価値はある。',
  '',                          // rejected: empty
  'あ',                        // rejected: too short
  'fuck this exhibit please',  // rejected: moderation
  'ああああああああああああああああ', // rejected: spam
];

/** Run one full day: morning actions, open, night, advance. */
export function playRandomDay(start: GameState, rng: Rng): GameState {
  let state = start;

  const act = (action: Action): void => {
    state = apply(state, action).state;
  };

  // --- morning ---
  const forages = rng.intInclusive(0, 5); // 5 exceeds the cap on purpose
  for (let i = 0; i < forages; i++) act({ type: 'forage' });

  // Place what fits.
  let guard = 0;
  while (state.player.inventory.length > 0 && state.player.exhibits.length < state.player.slots) {
    if (guard++ > 32) break;
    const item = rng.pick(state.player.inventory);
    act({ type: 'place', itemId: item.id, caption: rng.pick(CAPTION_POOL) });
    // A rejected caption leaves the item in place; drop it so we cannot spin.
    if (state.player.inventory.some((i) => i.id === item.id)) {
      act({ type: 'discard', itemId: item.id });
    }
  }

  // Occasionally rewrite a label.
  if (state.player.exhibits.length > 0 && rng.chance(0.3)) {
    act({
      type: 'recaption',
      exhibitId: rng.pick(state.player.exhibits).id,
      caption: rng.pick(CAPTION_POOL),
    });
  }

  // Occasionally pull one off display.
  if (state.player.exhibits.length > 0 && rng.chance(0.08)) {
    act({ type: 'withdraw', exhibitId: rng.pick(state.player.exhibits).id });
  }

  // Spend, sometimes beyond our means.
  if (rng.chance(0.35)) act({ type: 'buySlot' });
  if (rng.chance(0.4)) act({ type: 'buyGuard', tier: rng.pick(GUARDS).tier });
  if (state.player.exhibits.length > 0) {
    if (rng.chance(0.4)) {
      act({
        type: 'buyCase',
        exhibitId: rng.pick(state.player.exhibits).id,
        tier: rng.pick(CASES).tier,
      });
    }
    if (rng.chance(0.3)) {
      act({ type: 'buyLighting', exhibitId: rng.pick(state.player.exhibits).id });
    }
  }
  if (state.relic && rng.chance(0.6)) act({ type: 'claimRelic' });

  // Illegal in this phase; must be rejected cleanly.
  if (rng.chance(0.1) && state.rivals.length > 0) {
    act({ type: 'raid', rivalId: rng.pick(state.rivals).id });
  }
  if (rng.chance(0.05)) act({ type: 'endNight' });

  // --- open ---
  act({ type: 'openMuseum' });

  // --- night ---
  if (state.rivals.length > 0 && rng.chance(0.7)) {
    act({ type: 'raid', rivalId: rng.pick(state.rivals).id });
  }
  // Second raid is over the nightly limit; must be rejected.
  if (state.rivals.length > 0 && rng.chance(0.2)) {
    act({ type: 'raid', rivalId: rng.pick(state.rivals).id });
  }
  // Illegal in this phase.
  if (rng.chance(0.1)) act({ type: 'forage' });

  act({ type: 'endNight' });
  return state;
}
