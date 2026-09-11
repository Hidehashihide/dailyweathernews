/**
 * The "open" phase: visitors arrive, look at exhibits, vote and tip.
 *
 * Two implementations on purpose:
 *   - settleDetailed() walks individual visitors. Used for the player, where
 *     per-exhibit vote counts are shown in the UI.
 *   - settleFast() uses the closed-form expectation. Used for rivals, so that
 *     a 2000-day soak test stays under a second instead of minutes.
 * Both are deterministic against the injected Rng.
 */

import { caseDef } from './content';
import { realVoteChance } from './caption';
import { addAuthority, addBuzz, addMoney, clampStat, safeInt } from './economy';
import type { Museum } from './types';
import type { Rng } from './rng';

/** Hard ceiling on simulated visitors per day. Caps worst-case frame time. */
export const MAX_VISITORS_PER_DAY = 600;
const VIEWS_PER_VISITOR = 3;

export interface SettlementResult {
  visitors: number;
  tips: number;
  authorityGained: number;
  buzzGained: number;
  votesReal: number;
  votesFake: number;
}

const EMPTY: SettlementResult = {
  visitors: 0,
  tips: 0,
  authorityGained: 0,
  buzzGained: 0,
  votesReal: 0,
  votesFake: 0,
};

/** Expected visitors before noise. Sub-linear so stats cannot run away. */
export function expectedVisitors(museum: Museum): number {
  const buzz = Math.max(0, museum.buzz);
  const authority = Math.max(0, museum.authority);
  const fame = Math.max(0, museum.fame);
  const base = 6;
  const value =
    base +
    Math.sqrt(buzz) * 2.2 +
    Math.sqrt(authority) * 1.4 +
    Math.sqrt(fame) * 1.1 +
    museum.exhibits.length * 2.5;
  return Math.min(MAX_VISITORS_PER_DAY, Math.max(0, value));
}

/** Per-view tip before the caption multiplier. */
function baseTip(rng: Rng): number {
  return rng.intInclusive(2, 6);
}

function exhibitMultiplier(museum: Museum, index: number): number {
  const exhibit = museum.exhibits[index];
  if (!exhibit) return 0;
  const c = caseDef(exhibit.caseTier);
  const lighting = 1 + Math.max(0, Math.min(3, exhibit.lighting)) * 0.12;
  // A stolen-goods placard is a draw in its own right.
  const notoriety = 1 + Math.min(exhibit.stolenHistory.length, 3) * 0.08;
  return exhibit.score.tipMultiplier * c.tipMultiplier * lighting * notoriety;
}

/** Full per-visitor simulation. Mutates `museum` and its exhibits. */
export function settleDetailed(museum: Museum, rng: Rng): SettlementResult {
  if (museum.exhibits.length === 0) {
    // Nothing on display: people still walk past, nobody pays.
    return { ...EMPTY };
  }

  const visitors = Math.round(expectedVisitors(museum) * rng.float(0.85, 1.15));
  const count = Math.max(0, Math.min(MAX_VISITORS_PER_DAY, visitors));

  let tips = 0;
  let votesReal = 0;
  let votesFake = 0;
  let authorityGained = 0;
  let buzzGained = 0;

  for (let v = 0; v < count; v++) {
    const views = Math.min(VIEWS_PER_VISITOR, museum.exhibits.length);
    for (let k = 0; k < views; k++) {
      const index = rng.int(0, museum.exhibits.length);
      const exhibit = museum.exhibits[index];
      if (!exhibit) continue;

      const tip = Math.round(baseTip(rng) * exhibitMultiplier(museum, index));
      const safeTip = safeInt(tip);
      tips += safeTip;
      exhibit.tipsEarned = safeInt(exhibit.tipsEarned + safeTip);

      if (rng.chance(realVoteChance(exhibit.score))) {
        exhibit.votesReal += 1;
        votesReal += 1;
        authorityGained += exhibit.score.authorityGain > 0 ? 1 : 0;
      } else {
        exhibit.votesFake += 1;
        votesFake += 1;
        buzzGained += exhibit.score.buzzGain > 0 ? 1 : 0;
      }
    }
  }

  // Votes are noisy; scale the actual stat movement down so a single big day
  // cannot outweigh weeks of play.
  const authorityDelta = Math.round(authorityGained * 0.35);
  const buzzDelta = Math.round(buzzGained * 0.45);

  addMoney(museum, tips);
  addAuthority(museum, authorityDelta);
  addBuzz(museum, buzzDelta);

  return {
    visitors: count,
    tips,
    authorityGained: authorityDelta,
    buzzGained: buzzDelta,
    votesReal,
    votesFake,
  };
}

/** Closed-form approximation used for rival museums. */
export function settleFast(museum: Museum, rng: Rng): SettlementResult {
  if (museum.exhibits.length === 0) return { ...EMPTY };

  const visitors = Math.max(
    0,
    Math.min(MAX_VISITORS_PER_DAY, Math.round(expectedVisitors(museum) * rng.float(0.85, 1.15))),
  );
  const views = visitors * Math.min(VIEWS_PER_VISITOR, museum.exhibits.length);

  let multiplierSum = 0;
  let realChanceSum = 0;
  for (let i = 0; i < museum.exhibits.length; i++) {
    multiplierSum += exhibitMultiplier(museum, i);
    const exhibit = museum.exhibits[i];
    if (exhibit) realChanceSum += realVoteChance(exhibit.score);
  }
  const avgMultiplier = multiplierSum / museum.exhibits.length;
  const avgRealChance = realChanceSum / museum.exhibits.length;

  const tips = safeInt(views * 4 * avgMultiplier);
  const votesReal = Math.round(views * avgRealChance);
  const votesFake = views - votesReal;
  const authorityDelta = Math.round(votesReal * 0.35);
  const buzzDelta = Math.round(votesFake * 0.45);

  addMoney(museum, tips);
  addAuthority(museum, authorityDelta);
  addBuzz(museum, buzzDelta);

  // Keep per-exhibit counters roughly in step so the UI never shows a rival
  // with thousands of visitors and zero votes.
  const perExhibit = Math.floor(views / museum.exhibits.length);
  for (const exhibit of museum.exhibits) {
    exhibit.votesReal = clampStat(exhibit.votesReal + Math.round(perExhibit * avgRealChance));
    exhibit.votesFake = clampStat(exhibit.votesFake + Math.round(perExhibit * (1 - avgRealChance)));
  }

  return {
    visitors,
    tips,
    authorityGained: authorityDelta,
    buzzGained: buzzDelta,
    votesReal,
    votesFake,
  };
}
