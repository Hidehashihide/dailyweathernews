/**
 * View model.
 *
 * Pure functions that turn a GameState into the plain data the DOM layer
 * renders. Keeping this separate from the DOM means the screen contents can be
 * asserted in tests without a browser.
 */

import { caseDef, guardDef, junkDefOrFallback, slotPrice } from '../core/content';
import { CASES, GUARDS, LIGHTING_PRICE, MAX_LIGHTING, MAX_SLOTS } from '../core/content';
import { standings } from '../core/game';
import type { GameState, Museum } from '../core/types';

export interface ExhibitView {
  id: string;
  emoji: string;
  name: string;
  caption: string;
  caseName: string;
  caseTier: string;
  lighting: number;
  plausibility: number;
  absurdity: number;
  tipMultiplier: number;
  votesReal: number;
  votesFake: number;
  tipsEarned: number;
  /** Non-empty when the piece was taken from someone. Never removable. */
  stolenFrom: string[];
  genuine: boolean;
  nextCaseTier: string | null;
  nextCasePrice: number | null;
  nextLightingPrice: number | null;
}

export interface ItemView {
  id: string;
  emoji: string;
  name: string;
  rarity: string;
  stolenFrom: string[];
  genuine: boolean;
}

export interface RivalView {
  id: string;
  name: string;
  exhibitCount: number;
  guardName: string | null;
  topCaption: string | null;
  raidable: boolean;
}

export interface HeaderView {
  day: number;
  phase: string;
  phaseLabel: string;
  money: number;
  authority: number;
  buzz: number;
  fame: number;
  foragesLeft: number;
  heistsLeft: number;
  slotsUsed: number;
  slots: number;
  guardLabel: string;
  nextSlotPrice: number | null;
  relicName: string | null;
  relicClaimable: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  morning: '朝 — 採集と展示',
  open: '開館中',
  night: '夜 — 略奪',
  settlement: '精算',
};

export function headerView(state: GameState): HeaderView {
  const p = state.player;
  const guard = p.guard && p.guard.expiresOnDay >= state.day ? p.guard : null;
  const relicActive = state.relic !== null && state.relic.day === state.day;
  return {
    day: state.day,
    phase: state.phase,
    phaseLabel: PHASE_LABEL[state.phase] ?? state.phase,
    money: p.money,
    authority: p.authority,
    buzz: p.buzz,
    fame: p.fame,
    foragesLeft: p.foragesLeft,
    heistsLeft: p.heistsLeft,
    slotsUsed: p.exhibits.length,
    slots: p.slots,
    guardLabel: guard
      ? `${guardDef(guard.tier).name}（あと${guard.expiresOnDay - state.day + 1}日）`
      : '無警備',
    nextSlotPrice: p.slots >= MAX_SLOTS ? null : slotPrice(p.slots),
    relicName: relicActive ? junkDefOrFallback(state.relic!.defId).name : null,
    relicClaimable: relicActive && state.relic!.claimedBy === null,
  };
}

function nextCase(currentTier: string): { tier: string; price: number } | null {
  const current = caseDef(currentTier as never);
  const better = CASES.filter((c) => c.price > current.price).sort((a, b) => a.price - b.price)[0];
  return better ? { tier: better.tier, price: better.price - current.price } : null;
}

export function exhibitViews(state: GameState): ExhibitView[] {
  return state.player.exhibits.map((e) => {
    const def = junkDefOrFallback(e.defId);
    const upgrade = nextCase(e.caseTier);
    return {
      id: e.id,
      emoji: def.emoji,
      name: def.name,
      caption: e.caption,
      caseName: caseDef(e.caseTier).name,
      caseTier: e.caseTier,
      lighting: e.lighting,
      plausibility: e.score.plausibility,
      absurdity: e.score.absurdity,
      tipMultiplier: e.score.tipMultiplier,
      votesReal: e.votesReal,
      votesFake: e.votesFake,
      tipsEarned: e.tipsEarned,
      stolenFrom: e.stolenHistory.map((h) => h.fromMuseum),
      genuine: e.genuine,
      nextCaseTier: upgrade?.tier ?? null,
      nextCasePrice: upgrade?.price ?? null,
      nextLightingPrice:
        e.lighting >= MAX_LIGHTING ? null : (LIGHTING_PRICE[e.lighting + 1] ?? null),
    };
  });
}

export function itemViews(state: GameState): ItemView[] {
  return state.player.inventory.map((i) => {
    const def = junkDefOrFallback(i.defId);
    return {
      id: i.id,
      emoji: def.emoji,
      name: def.name,
      rarity: def.rarity,
      stolenFrom: (i.stolenHistory ?? []).map((h) => h.fromMuseum),
      genuine: i.genuine === true,
    };
  });
}

function bestCaption(museum: Museum): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const e of museum.exhibits) {
    if (e.score.tipMultiplier > bestScore) {
      bestScore = e.score.tipMultiplier;
      best = e.caption;
    }
  }
  return best;
}

export function rivalViews(state: GameState): RivalView[] {
  return state.rivals.map((r) => {
    const guard = r.guard && r.guard.expiresOnDay >= state.day ? r.guard : null;
    return {
      id: r.id,
      name: r.name,
      exhibitCount: r.exhibits.length,
      guardName: guard ? guardDef(guard.tier).name : null,
      topCaption: bestCaption(r),
      raidable: r.exhibits.length > 0 && state.day - r.foundedDay >= 3,
    };
  });
}

export function guardOptions(state: GameState): { tier: string; name: string; price: number; affordable: boolean }[] {
  return GUARDS.filter((g) => g.tier !== 'none').map((g) => ({
    tier: g.tier,
    name: `${g.name}（${g.days}日）`,
    price: g.price,
    affordable: state.player.money >= g.price,
  }));
}

export function standingsView(state: GameState): { name: string; score: number; isPlayer: boolean }[] {
  return standings(state);
}

export function recentLog(state: GameState, limit = 24): { day: number; kind: string; text: string }[] {
  return state.log.slice(-limit).reverse();
}

export function lastReport(state: GameState): GameState['reports'][number] | null {
  return state.reports[state.reports.length - 1] ?? null;
}
