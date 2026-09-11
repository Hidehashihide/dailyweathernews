/**
 * Caption moderation.
 *
 * Captions are free-form text written by players and shown to other players,
 * so this runs on every write. Design rules:
 *
 *  1. Layered, not single-pass. Obfuscation is defeated by normalisation, not
 *     by an ever-growing word list.
 *  2. Two matching passes with different strictness. The separator-stripping
 *     pass only runs against terms that cannot collide with innocent words --
 *     otherwise "classic" and "Scunthorpe" get blocked (see tests).
 *  3. Never throw. A moderation crash must not be able to eat a player's save.
 *
 * The seed word list below is deliberately small. A shipping build is expected
 * to swap `SEVERE_TERMS` for a maintained vendor list via `configureTerms()`;
 * the engine, not the list, is what is being tested here.
 */

import {
  graphemeLength,
  normalizeCaption,
  normalizeForMatch,
  normalizeStrict,
  squashRepeats,
  stripInvisible,
  varietyRatio,
} from './text';

export const MIN_CAPTION_GRAPHEMES = 4;
export const MAX_CAPTION_GRAPHEMES = 140;

export type Severity = 'clean' | 'flag' | 'block';

export type ModerationReason =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'banned_word'
  | 'banned_word_obfuscated'
  | 'contact_email'
  | 'contact_phone'
  | 'contact_url'
  | 'payment_card'
  | 'spam_repetition'
  | 'symbol_spam'
  | 'invisible_characters';

export interface ModerationResult {
  severity: Severity;
  reasons: ModerationReason[];
  /** Canonical text to store. Empty when the caption is rejected. */
  normalized: string;
}

export interface TermRule {
  term: string;
  /**
   * Retained for list curation: marks terms distinctive enough that a future
   * substring-based pass could use them safely. The strict pass itself now
   * matches on word boundaries, so this no longer gates correctness.
   */
  strictSafe: boolean;
  /** ASCII terms need word boundaries; CJK has no word boundaries. */
  cjk: boolean;
}

function rule(term: string, strictSafe: boolean): TermRule {
  return { term, strictSafe, cjk: /[぀-ヿ㐀-鿿]/u.test(term) };
}

/** Seed list. Representative, not exhaustive -- replace in production. */
let SEVERE_TERMS: TermRule[] = [
  rule('fuck', true),
  rule('shit', false),
  rule('bitch', true),
  rule('cunt', true),
  rule('asshole', true),
  rule('bastard', true),
  rule('retard', true),
  rule('kill yourself', true),
  rule('kys', false),
  rule('rape', false),
  rule('nazi', true),
  rule('死ね', true),
  rule('殺す', true),
  rule('自殺しろ', true),
  rule('killyourself', true),
];

/** Replace the term list (e.g. with a vendor-maintained list) at boot. */
export function configureTerms(terms: readonly TermRule[]): void {
  SEVERE_TERMS = terms.slice();
}

export function currentTerms(): readonly TermRule[] {
  return SEVERE_TERMS;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Boundary-aware match for ASCII, plain substring for CJK. */
function matchesTerm(haystack: string, r: TermRule): boolean {
  if (r.term === '') return false;
  if (r.cjk) return haystack.includes(r.term);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(r.term)}(?![\\p{L}\\p{N}])`, 'u');
  return re.test(haystack);
}

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[a-z]{2,}/iu;
const URL_RE = /(https?:\/\/|www\.)\S+|\b[\p{L}\p{N}-]+\.(com|net|org|io|jp|co|gg|me|ru|cn|xyz|link)\b/iu;
// Separated digit groups (phone-shaped) or a long bare run of digits.
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/u;

/** Luhn check, used to catch pasted card numbers. */
export function looksLikePaymentCard(input: string): boolean {
  const candidates = input.match(/\d(?:[\d\s-]{11,21})\d/gu);
  if (!candidates) return false;
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/gu, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (double) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      double = !double;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

function symbolRatio(input: string): number {
  const chars = Array.from(input);
  if (chars.length === 0) return 0;
  let symbols = 0;
  for (const ch of chars) {
    if (!/[\p{L}\p{N}\s]/u.test(ch)) symbols += 1;
  }
  return symbols / chars.length;
}

/**
 * Run every layer. Returns the canonical caption plus a verdict.
 * `block` means reject the write; `flag` means accept but mark for review.
 */
export function moderateCaption(raw: string): ModerationResult {
  const reasons: ModerationReason[] = [];
  // Tracked as a rank rather than a union so that mutation inside the closure
  // below is not lost to control-flow narrowing.
  let rank = 0; // 0 clean, 1 flag, 2 block
  const bump = (next: Severity): void => {
    const value = next === 'block' ? 2 : next === 'flag' ? 1 : 0;
    if (value > rank) rank = value;
  };
  const verdict = (): Severity => (rank === 2 ? 'block' : rank === 1 ? 'flag' : 'clean');

  if (typeof raw !== 'string') {
    return { severity: 'block', reasons: ['empty'], normalized: '' };
  }

  if (stripInvisible(raw) !== raw) {
    reasons.push('invisible_characters');
    bump('flag');
  }

  const normalized = normalizeCaption(raw);
  const length = graphemeLength(normalized);

  if (length === 0) {
    return { severity: 'block', reasons: ['empty'], normalized: '' };
  }
  if (length < MIN_CAPTION_GRAPHEMES) {
    reasons.push('too_short');
    bump('block');
  }
  if (length > MAX_CAPTION_GRAPHEMES) {
    reasons.push('too_long');
    bump('block');
  }

  const loose = normalizeForMatch(normalized);
  const strict = normalizeStrict(normalized);

  for (const r of SEVERE_TERMS) {
    if (matchesTerm(loose, r)) {
      reasons.push('banned_word');
      bump('block');
      break;
    }
  }
  if (!reasons.includes('banned_word')) {
    // The strict pass joins spaced-out evasion and squashes repeats, then
    // matches with the same word boundaries as the loose pass. Boundaries are
    // what keep `Scunthorpe` and `classic` out of the block list while
    // `f.u.c.k` and `fuuuuuck` still resolve to the term.
    const squashed = squashRepeats(strict);
    for (const r of SEVERE_TERMS) {
      const needle = r.cjk ? r.term : squashRepeats(normalizeStrict(r.term));
      if (needle === '') continue;
      if (matchesTerm(squashed, { ...r, term: needle })) {
        reasons.push('banned_word_obfuscated');
        bump('block');
        break;
      }
    }
  }

  if (EMAIL_RE.test(normalized)) {
    reasons.push('contact_email');
    bump('block');
  }
  if (URL_RE.test(normalized)) {
    reasons.push('contact_url');
    bump('block');
  }
  if (looksLikePaymentCard(normalized)) {
    reasons.push('payment_card');
    bump('block');
  } else if (PHONE_RE.test(normalized)) {
    reasons.push('contact_phone');
    bump('block');
  }

  if (length >= 12 && varietyRatio(normalized) < 0.15) {
    reasons.push('spam_repetition');
    bump('block');
  }
  if (length >= 10 && symbolRatio(normalized) > 0.6) {
    reasons.push('symbol_spam');
    bump('flag');
  }

  const severity = verdict();
  return {
    severity,
    reasons,
    normalized: severity === 'block' ? '' : normalized,
  };
}

/** Human-readable reason, shown in the caption editor. */
export function explainReason(reason: ModerationReason): string {
  switch (reason) {
    case 'empty':
      return 'キャプションが空です。';
    case 'too_short':
      return `短すぎます（${MIN_CAPTION_GRAPHEMES}文字以上）。`;
    case 'too_long':
      return `長すぎます（${MAX_CAPTION_GRAPHEMES}文字まで）。`;
    case 'banned_word':
    case 'banned_word_obfuscated':
      return '使用できない表現が含まれています。';
    case 'contact_email':
      return 'メールアドレスは書けません。';
    case 'contact_phone':
      return '電話番号は書けません。';
    case 'contact_url':
      return 'URLは書けません。';
    case 'payment_card':
      return 'カード番号のような文字列は書けません。';
    case 'spam_repetition':
      return '同じ文字の繰り返しが多すぎます。';
    case 'symbol_spam':
      return '記号が多すぎます。';
    case 'invisible_characters':
      return '表示されない文字は削除されました。';
  }
}
