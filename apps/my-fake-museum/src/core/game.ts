/**
 * The game reducer.
 *
 * `apply(state, action)` is pure: it deep-clones the state, mutates the clone
 * and returns it. Nothing outside this module may mutate a GameState. That is
 * what makes save/load, replay-from-seed and the property tests possible.
 *
 * Phase order for one day:
 *   morning  -- player forages, arranges, buys
 *   night    -- player may raid one rival; rivals then raid everyone
 *   (day + 1, back to morning)
 * `openMuseum` runs the visitor settlement and moves morning -> night.
 */

import {
  CASES,
  FORAGES_PER_DAY,
  GUARDS,
  HEISTS_PER_NIGHT,
  JUNK,
  LIGHTING_PRICE,
  MAX_INVENTORY,
  MAX_LIGHTING,
  MAX_LOG,
  MAX_REPORTS,
  MAX_SLOTS,
  RELIC_POOL,
  STARTING_MONEY,
  STARTING_SLOTS,
  caseDef,
  guardDef,
  junkDefOrFallback,
  slotPrice,
} from './content';
import { scoreCaption } from './caption';
import { settleDetailed, settleFast } from './appraisal';
import { addBuzz, addFame, addMoney, clampStat, decayBuzz, spend } from './economy';
import { attemptHeist } from './heist';
import { mintId } from './ids';
import { moderateCaption, explainReason } from './moderation';
import { Rng } from './rng';
import { createRival, runRivalDay } from './rivals';
import { SAVE_VERSION } from './types';
import type {
  CaseTier,
  DayReport,
  Exhibit,
  GameState,
  GuardTier,
  LogEntry,
  LogKind,
  Museum,
  RivalMuseum,
} from './types';

export const RIVAL_COUNT = 4;
export const RELIC_INTERVAL = 7;

export type Action =
  | { type: 'forage' }
  | { type: 'place'; itemId: string; caption: string }
  | { type: 'recaption'; exhibitId: string; caption: string }
  | { type: 'withdraw'; exhibitId: string }
  | { type: 'discard'; itemId: string }
  | { type: 'buyCase'; exhibitId: string; tier: CaseTier }
  | { type: 'buyLighting'; exhibitId: string }
  | { type: 'buyGuard'; tier: GuardTier }
  | { type: 'buySlot' }
  | { type: 'claimRelic' }
  | { type: 'openMuseum' }
  | { type: 'raid'; rivalId: string }
  | { type: 'endNight' }
  | { type: 'rename'; name: string };

export interface ActionResult {
  state: GameState;
  ok: boolean;
  /** Player-facing message; safe to render directly. */
  message: string;
}

// ---------------------------------------------------------------------------
// construction
// ---------------------------------------------------------------------------

function emptyMuseum(id: string, name: string): Museum {
  return {
    id,
    name,
    foundedDay: 1,
    money: STARTING_MONEY,
    authority: 0,
    buzz: 0,
    fame: 0,
    slots: STARTING_SLOTS,
    exhibits: [],
    inventory: [],
    guard: null,
    foragesLeft: FORAGES_PER_DAY,
    heistsLeft: HEISTS_PER_NIGHT,
  };
}

export function createGame(seed: string, museumName = 'わたしの博物館'): GameState {
  const rng = Rng.fromSeed(seed);
  const idCounter = { next: 1 };

  const player = emptyMuseum(mintId(idCounter, 'you'), museumName);
  const rivals: RivalMuseum[] = [];
  const order = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (let i = 0; i < RIVAL_COUNT; i++) {
    rivals.push(createRival(order[i] ?? i, rng, idCounter));
  }

  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: rng.save(),
    idCounter,
    day: 1,
    phase: 'morning',
    player,
    rivals,
    log: [],
    reports: [],
    relic: null,
    totals: { tips: 0, visitors: 0, exhibitsPlaced: 0, itemsStolen: 0, itemsLost: 0, daysPlayed: 0 },
    settings: { moderation: true },
  };

  pushLog(state, 'day', `1日目。${museumName}、開館。`);
  return state;
}

// ---------------------------------------------------------------------------
// helpers (operate on an already-cloned draft)
// ---------------------------------------------------------------------------

function pushLog(state: GameState, kind: LogKind, text: string): void {
  const entry: LogEntry = { id: mintId(state.idCounter, 'log'), day: state.day, kind, text };
  state.log.push(entry);
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function fail(state: GameState, message: string): ActionResult {
  return { state, ok: false, message };
}

function findExhibit(museum: Museum, exhibitId: string): number {
  return museum.exhibits.findIndex((e) => e.id === exhibitId);
}

function findItem(museum: Museum, itemId: string): number {
  return museum.inventory.findIndex((i) => i.id === itemId);
}

/** Validate + score a caption. Returns null with a reason when rejected. */
function acceptCaption(
  state: GameState,
  raw: string,
): { caption: string; warning: string | null } | { error: string } {
  if (!state.settings.moderation) {
    const trimmed = typeof raw === 'string' ? raw.slice(0, 400) : '';
    return trimmed === '' ? { error: 'キャプションが空です。' } : { caption: trimmed, warning: null };
  }
  const verdict = moderateCaption(raw);
  if (verdict.severity === 'block') {
    const first = verdict.reasons.find((r) => r !== 'invisible_characters') ?? verdict.reasons[0];
    return { error: first ? explainReason(first) : 'このキャプションは使用できません。' };
  }
  const warning = verdict.reasons.includes('invisible_characters')
    ? explainReason('invisible_characters')
    : null;
  return { caption: verdict.normalized, warning };
}

// ---------------------------------------------------------------------------
// the reducer
// ---------------------------------------------------------------------------

export function apply(prev: GameState, action: Action): ActionResult {
  const state = clone(prev);
  const rng = new Rng(state.rng);
  const player = state.player;

  const commit = (ok: boolean, message: string): ActionResult => {
    state.rng = rng.save();
    return { state, ok, message };
  };

  switch (action.type) {
    // ---- morning --------------------------------------------------------
    case 'forage': {
      if (state.phase !== 'morning') return fail(state, '今は採集できません。');
      if (player.foragesLeft <= 0) return fail(state, '今日はもう歩き回れません。');
      if (player.inventory.length >= MAX_INVENTORY) return fail(state, '倉庫がいっぱいです。');

      const def = rng.pickWeighted(JUNK, (j) => j.weight);
      player.inventory.push({
        id: mintId(state.idCounter, 'junk'),
        defId: def.id,
        foundDay: state.day,
      });
      player.foragesLeft -= 1;
      pushLog(state, 'forage', `${def.emoji} ${def.name} を拾った。`);
      return commit(true, `${def.name} を拾った。`);
    }

    case 'place': {
      if (state.phase !== 'morning') return fail(state, '今は展示できません。');
      if (player.exhibits.length >= player.slots) return fail(state, '展示枠が空いていません。');
      const index = findItem(player, action.itemId);
      if (index === -1) return fail(state, 'その品は倉庫にありません。');

      const verdict = acceptCaption(state, action.caption);
      if ('error' in verdict) return fail(state, verdict.error);

      const item = player.inventory[index];
      if (!item) return fail(state, 'その品は倉庫にありません。');

      const exhibit: Exhibit = {
        id: mintId(state.idCounter, 'ex'),
        defId: item.defId,
        caption: verdict.caption,
        score: scoreCaption(verdict.caption, item.defId),
        placedDay: state.day,
        caseTier: 'none',
        lighting: 0,
        stolenHistory: item.stolenHistory ? [...item.stolenHistory] : [],
        votesReal: 0,
        votesFake: 0,
        tipsEarned: 0,
        genuine: item.genuine === true,
      };
      player.inventory.splice(index, 1);
      player.exhibits.push(exhibit);
      state.totals.exhibitsPlaced += 1;

      const def = junkDefOrFallback(item.defId);
      pushLog(state, 'exhibit', `${def.emoji} ${def.name} を展示した。`);
      return commit(true, verdict.warning ?? `${def.name} を展示した。`);
    }

    case 'recaption': {
      if (state.phase !== 'morning') return fail(state, '今は書き換えできません。');
      const index = findExhibit(player, action.exhibitId);
      if (index === -1) return fail(state, 'その展示品は見つかりません。');

      const verdict = acceptCaption(state, action.caption);
      if ('error' in verdict) return fail(state, verdict.error);

      const exhibit = player.exhibits[index];
      if (!exhibit) return fail(state, 'その展示品は見つかりません。');
      exhibit.caption = verdict.caption;
      exhibit.score = scoreCaption(verdict.caption, exhibit.defId);
      pushLog(state, 'recaption', `由来を書き換えた。`);
      return commit(true, verdict.warning ?? '由来を書き換えた。');
    }

    case 'withdraw': {
      if (state.phase !== 'morning') return fail(state, '今は撤去できません。');
      if (player.inventory.length >= MAX_INVENTORY) return fail(state, '倉庫がいっぱいです。');
      const index = findExhibit(player, action.exhibitId);
      if (index === -1) return fail(state, 'その展示品は見つかりません。');
      const exhibit = player.exhibits[index];
      if (!exhibit) return fail(state, 'その展示品は見つかりません。');

      player.exhibits.splice(index, 1);
      player.inventory.push({
        id: mintId(state.idCounter, 'junk'),
        defId: exhibit.defId,
        foundDay: state.day,
        ...(exhibit.stolenHistory.length > 0 ? { stolenHistory: exhibit.stolenHistory } : {}),
        ...(exhibit.genuine ? { genuine: true } : {}),
      });
      return commit(true, '展示を下げた。');
    }

    case 'discard': {
      if (state.phase !== 'morning') return fail(state, '今は捨てられません。');
      const index = findItem(player, action.itemId);
      if (index === -1) return fail(state, 'その品は倉庫にありません。');
      player.inventory.splice(index, 1);
      return commit(true, '捨てた。');
    }

    case 'buyCase': {
      if (state.phase !== 'morning') return fail(state, '今は購入できません。');
      const index = findExhibit(player, action.exhibitId);
      if (index === -1) return fail(state, 'その展示品は見つかりません。');
      const exhibit = player.exhibits[index];
      if (!exhibit) return fail(state, 'その展示品は見つかりません。');

      const target = CASES.find((c) => c.tier === action.tier);
      if (!target) return fail(state, 'そのケースはありません。');
      const current = caseDef(exhibit.caseTier);
      if (target.price <= current.price) return fail(state, '今のケースより上位を選んでください。');
      // Upgrades are priced as the difference, so a ladder costs the same as a leap.
      const cost = target.price - current.price;
      if (!spend(player, cost)) return fail(state, `所持金が足りません（${cost}）。`);

      exhibit.caseTier = target.tier;
      pushLog(state, 'purchase', `${target.name} を購入（-${cost}）。`);
      return commit(true, `${target.name} に入れた。`);
    }

    case 'buyLighting': {
      if (state.phase !== 'morning') return fail(state, '今は購入できません。');
      const index = findExhibit(player, action.exhibitId);
      if (index === -1) return fail(state, 'その展示品は見つかりません。');
      const exhibit = player.exhibits[index];
      if (!exhibit) return fail(state, 'その展示品は見つかりません。');
      if (exhibit.lighting >= MAX_LIGHTING) return fail(state, 'これ以上は明るくできません。');

      const nextLevel = exhibit.lighting + 1;
      const cost = LIGHTING_PRICE[nextLevel] ?? 0;
      if (!spend(player, cost)) return fail(state, `所持金が足りません（${cost}）。`);
      exhibit.lighting = nextLevel;
      pushLog(state, 'purchase', `照明を強化（-${cost}）。`);
      return commit(true, '照明を強化した。');
    }

    case 'buyGuard': {
      if (state.phase !== 'morning') return fail(state, '今は購入できません。');
      const target = GUARDS.find((g) => g.tier === action.tier);
      if (!target || target.tier === 'none') return fail(state, 'その警備はありません。');
      if (!spend(player, target.price)) return fail(state, `所持金が足りません（${target.price}）。`);

      // Re-hiring before expiry extends from today, it does not stack forever.
      player.guard = { tier: target.tier, expiresOnDay: state.day + target.days };
      pushLog(state, 'purchase', `${target.name} を雇った（-${target.price}）。`);
      return commit(true, `${target.name} を雇った。`);
    }

    case 'buySlot': {
      if (state.phase !== 'morning') return fail(state, '今は購入できません。');
      if (player.slots >= MAX_SLOTS) return fail(state, 'これ以上は広げられません。');
      const cost = slotPrice(player.slots);
      if (!spend(player, cost)) return fail(state, `所持金が足りません（${cost}）。`);
      player.slots += 1;
      pushLog(state, 'purchase', `展示枠を増やした（-${cost}）。`);
      return commit(true, '展示枠を増やした。');
    }

    case 'claimRelic': {
      if (state.phase !== 'morning') return fail(state, '今は取りに行けません。');
      const relic = state.relic;
      if (!relic || relic.day !== state.day) return fail(state, '今日は本物が出ていません。');
      if (relic.claimedBy !== null) return fail(state, 'すでに誰かが持ち去った後だ。');
      if (player.inventory.length >= MAX_INVENTORY) return fail(state, '倉庫がいっぱいです。');

      relic.claimedBy = player.id;
      player.inventory.push({
        id: mintId(state.idCounter, 'junk'),
        defId: relic.defId,
        foundDay: state.day,
        genuine: true,
      });
      addFame(player, 12);
      const def = junkDefOrFallback(relic.defId);
      pushLog(state, 'relic', `本物の ${def.name} を手に入れた。`);
      return commit(true, `本物の ${def.name} を手に入れた。`);
    }

    // ---- open -----------------------------------------------------------
    case 'openMuseum': {
      if (state.phase !== 'morning') return fail(state, 'すでに開館済みです。');

      const result = settleDetailed(player, rng);

      for (const rival of state.rivals) {
        runRivalDay(rival, rng, state.day, state.idCounter);
        settleFast(rival, rng);
      }

      // An unclaimed relic goes to a rival at close of business.
      if (state.relic && state.relic.day === state.day && state.relic.claimedBy === null && state.rivals.length > 0) {
        const taker = rng.pick(state.rivals);
        state.relic.claimedBy = taker.id;
        addFame(taker, 12);
        const def = junkDefOrFallback(state.relic.defId);
        // A full store must not be allowed to exceed MAX_INVENTORY: the save
        // validator truncates on load, which both loses the item and makes a
        // round-trip produce a different state. Make room instead, oldest
        // ordinary piece first, and never at the cost of another genuine one.
        if (taker.inventory.length >= MAX_INVENTORY) {
          const dropIndex = taker.inventory.findIndex((i) => i.genuine !== true);
          if (dropIndex !== -1) taker.inventory.splice(dropIndex, 1);
        }
        if (taker.inventory.length < MAX_INVENTORY) {
          taker.inventory.push({
            id: mintId(state.idCounter, 'junk'),
            defId: state.relic.defId,
            foundDay: state.day,
            genuine: true,
          });
          pushLog(state, 'relic', `本物の ${def.name} は ${taker.name} が持ち去った。`);
        } else {
          pushLog(state, 'relic', `本物の ${def.name} は、どこかへ消えた。`);
        }
      }

      const report: DayReport = {
        day: state.day,
        visitors: result.visitors,
        tips: result.tips,
        authorityGained: result.authorityGained,
        buzzGained: result.buzzGained,
        votesReal: result.votesReal,
        votesFake: result.votesFake,
        robbedCount: 0,
        stolenCount: 0,
      };
      state.reports.push(report);
      if (state.reports.length > MAX_REPORTS) {
        state.reports.splice(0, state.reports.length - MAX_REPORTS);
      }

      state.totals.tips += result.tips;
      state.totals.visitors += result.visitors;
      state.phase = 'night';

      pushLog(
        state,
        'visitors',
        `来館 ${result.visitors} 人、チップ ${result.tips}。本物 ${result.votesReal} / 嘘くさい ${result.votesFake}。`,
      );
      return commit(true, `来館 ${result.visitors} 人、チップ ${result.tips}。`);
    }

    // ---- night ----------------------------------------------------------
    case 'raid': {
      if (state.phase !== 'night') return fail(state, '夜になるまで待ってください。');
      if (player.heistsLeft <= 0) return fail(state, '今夜はもう動けません。');
      const rival = state.rivals.find((r) => r.id === action.rivalId);
      if (!rival) return fail(state, 'その館は見つかりません。');

      const result = attemptHeist(player, rival, rng, state.day, state.idCounter, rival.foundedDay);
      player.heistsLeft -= 1;

      const currentReport = state.reports[state.reports.length - 1];
      switch (result.outcome) {
        case 'stolen': {
          const def = junkDefOrFallback(result.defId ?? '');
          state.totals.itemsStolen += 1;
          if (currentReport) currentReport.stolenCount += 1;
          pushLog(state, 'heist_success', `${rival.name} から ${def.name} を盗んだ。`);
          return commit(true, `${def.name} を盗んだ。`);
        }
        case 'blocked':
          pushLog(state, 'heist_blocked', `${rival.name} の警備に阻まれた。`);
          return commit(true, '警備に阻まれた。');
        case 'grace':
          return commit(false, 'まだ開館したばかりの館は襲えません。');
        case 'no_target':
          return commit(false, `${rival.name} には盗むものがない。`);
        case 'inventory_full':
          return commit(false, '倉庫がいっぱいで持ち帰れません。');
        default:
          return commit(false, '何も起きなかった。');
      }
    }

    case 'endNight': {
      if (state.phase !== 'night') return fail(state, 'まだ夜ではありません。');

      // Rivals raid the player and each other.
      const targets: Museum[] = [player, ...state.rivals];
      let robbed = 0;
      for (const rival of state.rivals) {
        if (!rng.chance(rival.aggression)) continue;
        const candidates = targets.filter((t) => t.id !== rival.id && t.exhibits.length > 0);
        if (candidates.length === 0) continue;
        const victim = rng.pick(candidates);
        const foundedDay = victim.id === player.id ? player.foundedDay : victim.foundedDay;
        const result = attemptHeist(rival, victim, rng, state.day, state.idCounter, foundedDay);
        if (victim.id !== player.id) continue;

        if (result.outcome === 'stolen') {
          robbed += 1;
          state.totals.itemsLost += 1;
          const def = junkDefOrFallback(result.defId ?? '');
          pushLog(state, 'robbed', `${rival.name} に ${def.name} を盗まれた。`);
        } else if (result.outcome === 'blocked') {
          pushLog(state, 'robbery_blocked', `${rival.name} の侵入を警備が防いだ。`);
        }
      }

      const currentReport = state.reports[state.reports.length - 1];
      if (currentReport) currentReport.robbedCount = robbed;

      // End of day bookkeeping.
      decayBuzz(player);
      for (const rival of state.rivals) decayBuzz(rival);

      state.day += 1;
      state.totals.daysPlayed += 1;
      state.phase = 'morning';
      player.foragesLeft = FORAGES_PER_DAY;
      player.heistsLeft = HEISTS_PER_NIGHT;

      if (player.guard && state.day > player.guard.expiresOnDay) player.guard = null;
      for (const rival of state.rivals) {
        if (rival.guard && state.day > rival.guard.expiresOnDay) rival.guard = null;
      }

      if (state.day % RELIC_INTERVAL === 0) {
        const defId = rng.pick(RELIC_POOL);
        state.relic = { day: state.day, defId, claimedBy: null };
        const def = junkDefOrFallback(defId);
        pushLog(state, 'relic', `今日はどこかに本物の ${def.name} がある。`);
      } else {
        state.relic = null;
      }

      pushLog(state, 'day', `${state.day}日目。`);
      return commit(true, `${state.day}日目の朝。`);
    }

    case 'rename': {
      const name = typeof action.name === 'string' ? action.name.trim().slice(0, 24) : '';
      if (name === '') return fail(state, '館名を入力してください。');
      const verdict = moderateCaption(name);
      if (verdict.severity === 'block' && !verdict.reasons.includes('too_short')) {
        return fail(state, 'その館名は使用できません。');
      }
      player.name = name;
      return commit(true, `館名を「${name}」に変更した。`);
    }

    default: {
      const never: never = action;
      return fail(state, `未知の操作です: ${JSON.stringify(never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// read-only selectors used by the UI
// ---------------------------------------------------------------------------

export function nextSlotPrice(state: GameState): number | null {
  return state.player.slots >= MAX_SLOTS ? null : slotPrice(state.player.slots);
}

export function guardStatus(state: GameState): { name: string; daysLeft: number } | null {
  const guard = state.player.guard;
  if (!guard) return null;
  const daysLeft = guard.expiresOnDay - state.day + 1;
  if (daysLeft <= 0) return null;
  return { name: guardDef(guard.tier).name, daysLeft };
}

export function totalTipsToday(state: GameState): number {
  const report = state.reports[state.reports.length - 1];
  return report && report.day === state.day ? report.tips : 0;
}

/** Museums ranked for the league table. */
export function standings(state: GameState): { name: string; score: number; isPlayer: boolean }[] {
  const rank = (m: Museum): number =>
    clampStat(Math.round(m.authority * 1.2 + m.buzz + m.fame * 2 + m.exhibits.length * 3));
  const rows = [
    { name: state.player.name, score: rank(state.player), isPlayer: true },
    ...state.rivals.map((r) => ({ name: r.name, score: rank(r), isPlayer: false })),
  ];
  // Sort by score, then name, so ties are stable across runs.
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ja'));
  return rows;
}

export { addBuzz, addMoney };
