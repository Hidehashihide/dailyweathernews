/**
 * Caption scoring -- the heart of the game.
 *
 * A caption earns money down either of two routes, and the design requires both
 * to be viable so that "write a convincing label" players and "write something
 * gloriously stupid" players compete on the same board:
 *
 *   plausibility -> authority -> unlocks expensive cases
 *   absurdity    -> buzz      -> brings more visitors
 *
 * Tips are driven by `max(plausibility, absurdity)`, so committing hard to
 * either route beats hedging in the middle.
 *
 * Contract: pure, total and deterministic. Every field is finite and clamped;
 * no input (including lone surrogates and 100k-character strings) may produce
 * NaN or throw. Fuzzed in tests/caption.fuzz.test.ts.
 */

import { junkDefOrFallback } from './content';
import type { CaptionFlag, CaptionScore, Material } from './types';
import { graphemeLength, normalizeCaption, normalizeForMatch, varietyRatio } from './text';

export const IDEAL_MIN_LENGTH = 18;
export const IDEAL_MAX_LENGTH = 110;

export const MIN_TIP_MULTIPLIER = 0.25;
export const MAX_TIP_MULTIPLIER = 3;

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

/** Scholarly vocabulary. Presence reads as "a real museum wrote this". */
const JARGON: readonly string[] = [
  '出土', '発掘', '推定', '所蔵', '寄贈', '真贋', '由来', '年代測定', '収蔵', '断片',
  '遺構', '文献', '考証', '復元', '模造', '伝来', '来歴', '様式', '編年', '層位',
  '紀元', '世紀', '王朝', '遺跡', '副葬', '碑文', '刻印', '銘', '目録', '寄託',
  'provenance', 'excavated', 'circa', 'attributed', 'fragment', 'artifact',
  'artefact', 'inventory', 'catalogue', 'dynasty', 'excavation', 'restored',
];

/** Words that signal the player is going for laughs rather than credibility. */
const HYPERBOLE: readonly string[] = [
  '世界最', '史上最', '唯一', '伝説', '呪い', '呪われ', '奇跡', '最強', '最古', '禁断',
  '封印', '究極', '神', '悪魔', '宇宙', '異世界', '謎の力', '絶対に', '触れてはいけない',
  'legendary', 'cursed', 'ultimate', 'forbidden', 'divine', 'apocalypse', 'immortal',
];

const MATERIAL_WORDS: Readonly<Record<Material, readonly string[]>> = {
  metal: ['金属', '鉄', '銅', '青銅', '鋼', '鉛', 'metal', 'iron', 'bronze', 'steel'],
  wood: ['木製', '木材', '木彫', '樹木', 'wooden', 'timber', 'oak'],
  paper: ['紙', '羊皮紙', '和紙', 'paper', 'parchment', 'papyrus'],
  glass: ['ガラス', '硝子', 'glass', 'crystal'],
  plastic: ['プラスチック', '樹脂', '合成', 'plastic', 'resin', 'polymer'],
  cloth: ['布', '織物', '繊維', '絹', 'cloth', 'fabric', 'textile', 'silk'],
  stone: ['石製', '岩', '花崗岩', 'stone', 'granite', 'basalt'],
  organic: ['骨', '牙', '角', '皮革', 'bone', 'ivory', 'antler', 'leather'],
};

const ALL_MATERIALS = Object.keys(MATERIAL_WORDS) as Material[];

function countMatches(haystack: string, needles: readonly string[]): number {
  let n = 0;
  for (const needle of needles) {
    if (needle !== '' && haystack.includes(needle)) n += 1;
  }
  return n;
}

/** 1847年 / 紀元前3世紀 / circa 1620 */
function hasYear(text: string): boolean {
  return /\d{1,4}\s*年/u.test(text) || /\d{1,2}\s*世紀/u.test(text) || /\b(1[0-9]{3}|20[0-9]{2})\b/u.test(text);
}

/** Katakana runs, kanji names with an institutional suffix, or Capitalised Latin. */
function hasProperNoun(text: string): boolean {
  if (/[ァ-ヶー]{3,}/u.test(text)) return true;
  if (/[一-龯]{2,}(?:王|朝|家|国|寺|院|藩|氏|教|island|会)/u.test(text)) return true;
  if (/(?:^|[^\p{L}])[A-Z][a-z]{2,}/u.test(text)) return true;
  return false;
}

function hasExclamation(text: string): boolean {
  return /[!！?？]/u.test(text) || /(?:草|ｗｗ|ww|lol|lmao)/iu.test(text);
}

/**
 * Score a caption against the object it is attached to.
 * `defId` is the junk catalogue id; unknown ids degrade gracefully.
 */
export function scoreCaption(rawCaption: string, defId: string): CaptionScore {
  const flags: CaptionFlag[] = [];
  const caption = typeof rawCaption === 'string' ? normalizeCaption(rawCaption) : '';
  const length = graphemeLength(caption);

  if (length === 0) {
    flags.push('empty');
    return {
      plausibility: 0,
      absurdity: 0,
      craft: 0,
      coherence: 0,
      tipMultiplier: MIN_TIP_MULTIPLIER,
      authorityGain: 0,
      buzzGain: 0,
      flags,
    };
  }

  const def = junkDefOrFallback(defId);
  const lower = normalizeForMatch(caption);

  // ---- plausibility -------------------------------------------------------
  let plausibility = 8;
  const jargonHits = countMatches(caption, JARGON) + countMatches(lower, JARGON);
  if (jargonHits > 0) {
    flags.push('has_jargon');
    plausibility += Math.min(jargonHits, 4) * 13;
  }
  if (hasYear(caption)) {
    flags.push('has_year');
    plausibility += 18;
  }
  if (hasProperNoun(caption)) {
    flags.push('has_proper_noun');
    plausibility += 16;
  }
  // Measured, sentence-like prose reads as authoritative.
  if (/[。.]/u.test(caption) && length >= IDEAL_MIN_LENGTH) plausibility += 8;
  if (/[、,]/u.test(caption)) plausibility += 4;

  // ---- absurdity ----------------------------------------------------------
  let absurdity = 6;
  const hypeHits = countMatches(caption, HYPERBOLE) + countMatches(lower, HYPERBOLE);
  if (hypeHits > 0) {
    flags.push('has_hyperbole');
    absurdity += Math.min(hypeHits, 4) * 15;
  }
  if (hasExclamation(caption)) {
    flags.push('has_exclamation');
    absurdity += 12;
  }
  // The joke is the gap: the more worthless the object, the funnier a grand claim.
  const gradeGap = 6 - def.grade; // 1 (interesting) .. 5 (pure trash)
  if (hypeHits > 0 || plausibility > 45) absurdity += gradeGap * 4;

  // ---- craft --------------------------------------------------------------
  let craft = 50;
  if (length < IDEAL_MIN_LENGTH) {
    flags.push('too_short');
    craft -= (IDEAL_MIN_LENGTH - length) * 2.5;
  } else if (length > IDEAL_MAX_LENGTH) {
    flags.push('too_long');
    craft -= (length - IDEAL_MAX_LENGTH) * 0.8;
  } else {
    // Reward the sweet spot, peaking in the middle of the ideal band.
    const mid = (IDEAL_MIN_LENGTH + IDEAL_MAX_LENGTH) / 2;
    const span = (IDEAL_MAX_LENGTH - IDEAL_MIN_LENGTH) / 2;
    craft += 30 * (1 - Math.abs(length - mid) / span);
  }
  const variety = varietyRatio(caption);
  if (variety < 0.3) {
    flags.push('low_variety');
    craft -= 30;
  } else {
    craft += variety * 20;
  }
  if (/[。.、,!！?？]/u.test(caption)) craft += 6;

  // ---- coherence ----------------------------------------------------------
  let coherence = 70;
  const mentionsOwnMaterial = countMatches(caption, MATERIAL_WORDS[def.material] ?? []) > 0;
  let contradicts = false;
  for (const material of ALL_MATERIALS) {
    if (material === def.material) continue;
    if (countMatches(caption, MATERIAL_WORDS[material]) > 0) {
      contradicts = true;
      break;
    }
  }
  if (mentionsOwnMaterial) {
    coherence += 22;
  } else if (contradicts) {
    flags.push('material_contradiction');
    coherence -= 35;
  }
  // Typing the object's own name and nothing else is not a caption.
  const bare = caption.replace(/[\s。、.,]/gu, '');
  if (bare === def.name || bare === def.nameEn.replace(/\s/gu, '')) {
    flags.push('lazy_name_only');
    coherence -= 40;
    craft -= 25;
  }

  plausibility = clamp(plausibility, 0, 100);
  absurdity = clamp(absurdity, 0, 100);
  craft = clamp(craft, 0, 100);
  coherence = clamp(coherence, 0, 100);

  // ---- derived ------------------------------------------------------------
  const peak = Math.max(plausibility, absurdity);
  const base = 0.25 + (peak / 100) * 2.0;
  const craftMul = 0.7 + (craft / 100) * 0.5;
  const coherenceMul = 0.6 + (coherence / 100) * 0.5;
  const tipMultiplier = clamp(
    Math.round(base * craftMul * coherenceMul * 100) / 100,
    MIN_TIP_MULTIPLIER,
    MAX_TIP_MULTIPLIER,
  );

  const authorityGain = Math.round((plausibility / 100) * 12 * (coherence / 100));
  const buzzGain = Math.round((absurdity / 100) * 12);

  return {
    plausibility: Math.round(plausibility),
    absurdity: Math.round(absurdity),
    craft: Math.round(craft),
    coherence: Math.round(coherence),
    tipMultiplier,
    authorityGain,
    buzzGain,
    flags,
  };
}

/** Probability a visitor votes "real" rather than "fake", 0.05..0.95. */
export function realVoteChance(score: CaptionScore): number {
  const lean = score.plausibility - score.absurdity;
  return clamp(0.5 + lean / 220, 0.05, 0.95);
}
