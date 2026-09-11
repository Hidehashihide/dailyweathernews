import type { CaseDef, CaseTier, GuardDef, GuardTier, JunkDef } from './types';

/** The junk catalogue. `grade` 1 = worthless, 5 = genuinely odd. */
export const JUNK: readonly JunkDef[] = [
  { id: 'can',       name: '空き缶',           nameEn: 'Empty Can',          material: 'metal',   rarity: 'common',   grade: 1, weight: 100, emoji: '🥫' },
  { id: 'twig',      name: '折れた枝',          nameEn: 'Broken Twig',        material: 'wood',    rarity: 'common',   grade: 1, weight: 100, emoji: '🌿' },
  { id: 'receipt',   name: 'しなびたレシート',   nameEn: 'Faded Receipt',      material: 'paper',   rarity: 'common',   grade: 1, weight:  95, emoji: '🧾' },
  { id: 'sock',      name: '片方だけの靴下',     nameEn: 'Lone Sock',          material: 'cloth',   rarity: 'common',   grade: 1, weight:  90, emoji: '🧦' },
  { id: 'bottlecap', name: '王冠',             nameEn: 'Bottle Cap',         material: 'metal',   rarity: 'common',   grade: 1, weight:  90, emoji: '🔘' },
  { id: 'pebble',    name: 'ただの石',          nameEn: 'Just a Pebble',      material: 'stone',   rarity: 'common',   grade: 1, weight:  85, emoji: '🪨' },
  { id: 'straw',     name: '曲がったストロー',   nameEn: 'Bent Straw',         material: 'plastic', rarity: 'common',   grade: 1, weight:  85, emoji: '🥤' },
  { id: 'button',    name: '外れたボタン',       nameEn: 'Loose Button',       material: 'plastic', rarity: 'common',   grade: 2, weight:  70, emoji: '⚪' },
  { id: 'key',       name: '合わない鍵',        nameEn: 'Key to Nothing',     material: 'metal',   rarity: 'uncommon', grade: 2, weight:  55, emoji: '🗝️' },
  { id: 'spoon',     name: '曲がったスプーン',   nameEn: 'Bent Spoon',         material: 'metal',   rarity: 'uncommon', grade: 2, weight:  55, emoji: '🥄' },
  { id: 'photo',     name: '他人の写真',        nameEn: 'Strangers Photo',    material: 'paper',   rarity: 'uncommon', grade: 3, weight:  40, emoji: '🖼️' },
  { id: 'shard',     name: 'ガラスの破片',      nameEn: 'Glass Shard',        material: 'glass',   rarity: 'uncommon', grade: 2, weight:  45, emoji: '🔷' },
  { id: 'doll',      name: '首のない人形',      nameEn: 'Headless Doll',      material: 'plastic', rarity: 'uncommon', grade: 3, weight:  35, emoji: '🪆' },
  { id: 'bone',      name: '謎の骨',           nameEn: 'Unidentified Bone',  material: 'organic', rarity: 'rare',     grade: 4, weight:  18, emoji: '🦴' },
  { id: 'tooth',     name: '大きすぎる歯',      nameEn: 'Oversized Tooth',    material: 'organic', rarity: 'rare',     grade: 4, weight:  15, emoji: '🦷' },
  { id: 'letter',    name: '宛名のない手紙',     nameEn: 'Unaddressed Letter', material: 'paper',   rarity: 'rare',     grade: 4, weight:  14, emoji: '✉️' },
  { id: 'mask',      name: '見覚えのない仮面',   nameEn: 'Unfamiliar Mask',    material: 'wood',    rarity: 'rare',     grade: 4, weight:  10, emoji: '🎭' },
  { id: 'meteorite', name: '焦げた石',          nameEn: 'Scorched Stone',     material: 'stone',   rarity: 'rare',     grade: 5, weight:   6, emoji: '☄️' },
  { id: 'cassette',  name: '無音のカセット',     nameEn: 'Silent Cassette',    material: 'plastic', rarity: 'rare',     grade: 4, weight:   8, emoji: '📼' },
  { id: 'ring',      name: 'サイズの合わない指輪', nameEn: 'Ill-fitting Ring',  material: 'metal',   rarity: 'rare',     grade: 5, weight:   5, emoji: '💍' },
];

const JUNK_BY_ID: ReadonlyMap<string, JunkDef> = new Map(JUNK.map((j) => [j.id, j]));

export function junkDef(defId: string): JunkDef | undefined {
  return JUNK_BY_ID.get(defId);
}

/** Never throws: an unknown id degrades to a placeholder so a corrupt save stays playable. */
export function junkDefOrFallback(defId: string): JunkDef {
  return (
    JUNK_BY_ID.get(defId) ?? {
      id: defId,
      name: '正体不明の物体',
      nameEn: 'Unidentified Object',
      material: 'stone',
      rarity: 'common',
      grade: 1,
      weight: 0,
      emoji: '❓',
    }
  );
}

/** Items eligible as the weekly genuine relic. */
export const RELIC_POOL: readonly string[] = ['meteorite', 'ring', 'mask', 'tooth', 'letter'];

export const CASES: readonly CaseDef[] = [
  { tier: 'none',   name: '裸置き',        price: 0,    tipMultiplier: 1.0,  authorityBonus: 0 },
  { tier: 'glass',  name: 'ガラスケース',   price: 120,  tipMultiplier: 1.25, authorityBonus: 3 },
  { tier: 'marble', name: '大理石の台座',   price: 480,  tipMultiplier: 1.6,  authorityBonus: 8 },
  { tier: 'gold',   name: '金張りケース',   price: 1800, tipMultiplier: 2.1,  authorityBonus: 16 },
];

const CASE_BY_TIER: ReadonlyMap<CaseTier, CaseDef> = new Map(CASES.map((c) => [c.tier, c]));

export function caseDef(tier: CaseTier): CaseDef {
  return CASE_BY_TIER.get(tier) ?? (CASES[0] as CaseDef);
}

export const GUARDS: readonly GuardDef[] = [
  { tier: 'none',      name: '無警備',      price: 0,   blockChance: 0,    days: 0 },
  { tier: 'volunteer', name: 'ボランティア', price: 90,  blockChance: 0.35, days: 3 },
  { tier: 'pro',       name: '警備会社',     price: 320, blockChance: 0.6,  days: 3 },
  { tier: 'elite',     name: '元特殊部隊',   price: 950, blockChance: 0.82, days: 3 },
];

const GUARD_BY_TIER: ReadonlyMap<GuardTier, GuardDef> = new Map(GUARDS.map((g) => [g.tier, g]));

export function guardDef(tier: GuardTier): GuardDef {
  return GUARD_BY_TIER.get(tier) ?? (GUARDS[0] as GuardDef);
}

export const LIGHTING_PRICE = [0, 60, 220, 700] as const;
export const MAX_LIGHTING = 3;
export const STARTING_SLOTS = 3;
export const MAX_SLOTS = 12;
export const STARTING_MONEY = 200;
export const FORAGES_PER_DAY = 4;
export const HEISTS_PER_NIGHT = 1;
export const MAX_INVENTORY = 24;
export const MAX_LOG = 200;
export const MAX_REPORTS = 60;
/** Days a newly created museum cannot be raided. */
export const GRACE_DAYS = 3;

/** Cost of the next display slot. Exponential so slots stay a real decision. */
export function slotPrice(currentSlots: number): number {
  const extra = Math.max(0, currentSlots - STARTING_SLOTS);
  return Math.round(150 * Math.pow(1.85, extra));
}

export const RIVAL_NAMES: readonly string[] = [
  '常盤記念館', 'ヴァルナ古物館', '第七収蔵庫', '無名館', 'カラス博物館',
  '灰色コレクション', '夜間展示室', 'ペトロフ私設館', '海底資料室', '月光ギャラリー',
];
