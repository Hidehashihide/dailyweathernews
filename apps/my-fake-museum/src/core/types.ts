import type { RngState } from './rng';

export const SAVE_VERSION = 3;

export type Material = 'metal' | 'wood' | 'paper' | 'glass' | 'plastic' | 'cloth' | 'stone' | 'organic';

export type JunkRarity = 'common' | 'uncommon' | 'rare' | 'relic';

/** Static catalogue entry. Never stored in a save -- referenced by id. */
export interface JunkDef {
  id: string;
  name: string;
  nameEn: string;
  material: Material;
  rarity: JunkRarity;
  /** 1 (worthless) .. 5 (actually interesting). Drives the absurdity gap. */
  grade: number;
  /** Relative spawn weight while foraging. */
  weight: number;
  emoji: string;
}

/** An instance of junk held by a museum (inventory, not yet on display). */
export interface JunkItem {
  id: string;
  defId: string;
  foundDay: number;
  /**
   * Carried across theft. Present only on items taken from another museum;
   * placing the item on display copies this onto the new exhibit, which is why
   * a stolen-goods placard can never be washed off by re-captioning.
   */
  stolenHistory?: StolenRecord[];
  /** True for the weekly genuine relic. */
  genuine?: boolean;
}

export type CaseTier = 'none' | 'glass' | 'marble' | 'gold';

export interface CaseDef {
  tier: CaseTier;
  name: string;
  price: number;
  /** Multiplies tip income. */
  tipMultiplier: number;
  /** Flat bonus to the authority a caption earns. */
  authorityBonus: number;
}

export type GuardTier = 'none' | 'volunteer' | 'pro' | 'elite';

export interface GuardDef {
  tier: GuardTier;
  name: string;
  price: number;
  /** Probability of repelling one heist attempt, 0..1. */
  blockChance: number;
  /** Days of coverage purchased at once. */
  days: number;
}

/** Permanent, un-erasable record attached to a stolen exhibit. */
export interface StolenRecord {
  fromMuseum: string;
  onDay: number;
  /** The caption the exhibit carried at the moment it was taken. */
  previousCaption: string;
}

export interface Exhibit {
  id: string;
  defId: string;
  caption: string;
  /** Cached analysis of `caption`; recomputed whenever the caption changes. */
  score: CaptionScore;
  placedDay: number;
  caseTier: CaseTier;
  /** 0..3 lighting upgrades. */
  lighting: number;
  stolenHistory: StolenRecord[];
  votesReal: number;
  votesFake: number;
  tipsEarned: number;
  /** Set for the one genuine weekly relic. */
  genuine: boolean;
}

export interface CaptionScore {
  /** 0..100, "sounds like a real museum label". Feeds authority. */
  plausibility: number;
  /** 0..100, "gloriously stupid". Feeds buzz. */
  absurdity: number;
  /** 0..100, writing quality: length, punctuation, variety. */
  craft: number;
  /** 0..100, agreement with the object's material/grade. */
  coherence: number;
  /** Derived, 0.25..3.0. Multiplies tips. */
  tipMultiplier: number;
  authorityGain: number;
  buzzGain: number;
  flags: CaptionFlag[];
}

export type CaptionFlag =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'low_variety'
  | 'material_contradiction'
  | 'has_year'
  | 'has_jargon'
  | 'has_proper_noun'
  | 'has_hyperbole'
  | 'has_exclamation'
  | 'lazy_name_only';

export interface GuardAssignment {
  tier: GuardTier;
  /** Inclusive. Guard is active while state.day <= expiresOnDay. */
  expiresOnDay: number;
}

export interface Museum {
  id: string;
  name: string;
  /** Day the museum opened. Drives the anti-farming grace period. */
  foundedDay: number;
  money: number;
  authority: number;
  buzz: number;
  fame: number;
  slots: number;
  exhibits: Exhibit[];
  inventory: JunkItem[];
  guard: GuardAssignment | null;
  /** Player-only: foraging actions left today. */
  foragesLeft: number;
  /** Player-only: heist attempts left tonight. */
  heistsLeft: number;
}

export interface RivalMuseum extends Museum {
  /** 0..1 how aggressively it raids. */
  aggression: number;
  /** 0..1 how good its captions are. */
  skill: number;
}

export type Phase = 'morning' | 'open' | 'night' | 'settlement';

export type LogKind =
  | 'forage'
  | 'exhibit'
  | 'recaption'
  | 'visitors'
  | 'heist_success'
  | 'heist_blocked'
  | 'robbed'
  | 'robbery_blocked'
  | 'purchase'
  | 'relic'
  | 'day'
  | 'warning';

export interface LogEntry {
  id: string;
  day: number;
  kind: LogKind;
  text: string;
}

export interface DayReport {
  day: number;
  visitors: number;
  tips: number;
  authorityGained: number;
  buzzGained: number;
  votesReal: number;
  votesFake: number;
  robbedCount: number;
  stolenCount: number;
}

export interface WeeklyRelic {
  /** The day it becomes available. */
  day: number;
  defId: string;
  claimedBy: string | null;
}

export interface GameState {
  version: number;
  seed: string;
  rng: RngState;
  idCounter: { next: number };
  day: number;
  phase: Phase;
  player: Museum;
  rivals: RivalMuseum[];
  log: LogEntry[];
  reports: DayReport[];
  relic: WeeklyRelic | null;
  /** Aggregate stats for the stats screen. */
  totals: {
    tips: number;
    visitors: number;
    exhibitsPlaced: number;
    itemsStolen: number;
    itemsLost: number;
    daysPlayed: number;
  };
  settings: {
    /** Hard-block captions that fail moderation. Always true in shipping builds. */
    moderation: boolean;
  };
}
