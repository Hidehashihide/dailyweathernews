/**
 * Unicode-safe text helpers.
 *
 * Captions are free-form player input, so every length check, truncation and
 * comparison here must work in grapheme clusters -- not UTF-16 code units.
 * A family emoji built from ZWJ-joined code points has `.length === 8`, and
 * naive slicing splits surrogate pairs into replacement characters. That is
 * exactly the class of bug that ships to stores.
 */

const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** Split into user-perceived characters. */
export function graphemes(input: string): string[] {
  if (input === '') return [];
  if (segmenter) {
    const out: string[] = [];
    for (const s of segmenter.segment(input)) out.push(s.segment);
    return out;
  }
  // Fallback: code points. Splits ZWJ sequences but never surrogate pairs.
  return Array.from(input);
}

export function graphemeLength(input: string): number {
  return graphemes(input).length;
}

/** Truncate to `max` graphemes without ever splitting a cluster. */
export function truncateGraphemes(input: string, max: number): string {
  if (max <= 0) return '';
  const g = graphemes(input);
  if (g.length <= max) return input;
  return g.slice(0, max).join('');
}

/**
 * Control, zero-width, bidi-override and interlinear-annotation characters.
 *
 * Bidi overrides matter for moderation: they can make a caption render as
 * something other than the text a word list matched against. They are removed
 * on input, never stored and never rendered.
 */
const INVISIBLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/gu;

/**
 * Joiners that are meaningful in real text and therefore survive storage:
 * U+200D glues emoji sequences together (a ZWJ family is one grapheme, and
 * stripping the joiner explodes it into three), and U+200C is required by
 * Persian and several Indic scripts. They are removed only in the matching
 * normalisers below, so they cannot be used to smuggle a banned word past the
 * word list while still rendering as one.
 */
const MATCH_ONLY_JOINERS_RE = /[\u200C\u200D\uFE0E\uFE0F]/gu;

export function stripInvisible(input: string): string {
  return input.replace(INVISIBLE_RE, '');
}

/** Collapse runs of whitespace (including U+3000 ideographic space) into one ASCII space. */
export function collapseWhitespace(input: string): string {
  return input.replace(/[\s　]+/gu, ' ').trim();
}

/**
 * Canonical storage form: NFC, no invisibles, collapsed whitespace.
 * Applied before length checks so whitespace padding cannot inflate a caption.
 */
export function normalizeCaption(input: string): string {
  return collapseWhitespace(stripInvisible(input.normalize('NFC')));
}

/**
 * Matching form for moderation: NFKC (folds full-width, circled and superscript
 * letters), lowercased, with runs of 3+ identical characters squashed to 2 so
 * that letter-padding cannot slip past a word list.
 */
export function normalizeForMatch(input: string): string {
  const base = stripInvisible(input.normalize('NFKC'))
    .replace(MATCH_ONLY_JOINERS_RE, '')
    .toLowerCase();
  return base.replace(/(.)\1{2,}/gu, '$1$1');
}

/**
 * Collapse "spaced-out" evasion (`f.u.c.k`, `f u c k`) without touching normal
 * prose. Only runs where single characters are repeatedly separated are
 * joined, which is what keeps `Scunthorpe collection, on loan` intact.
 */
export function collapseSpacedLetters(input: string): string {
  // Lookarounds pin the run to word edges. Without the trailing one the greedy
  // match swallows the next word's first letter ("f.u.c.k this" -> "fuckt his")
  // and the joined word no longer matches the term list.
  const SPACED =
    /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}][\s._\-*+~,/\\|:;'"`^]{1,2}){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu;
  return input.replace(SPACED, (run) => run.replace(/[^\p{L}\p{N}]/gu, ''));
}

/** Reduce every run of the same character to a single one. Matching only. */
export function squashRepeats(input: string): string {
  return input.replace(/(.)\1+/gu, '$1');
}

const LEET_MAP: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '|': 'i',
};

/** Strictest form: leet folded, every non-alphanumeric separator removed. */
export function normalizeStrict(input: string): string {
  const joined = collapseSpacedLetters(
    stripInvisible(input.normalize('NFKC')).replace(MATCH_ONLY_JOINERS_RE, ''),
  ).toLowerCase();
  const folded = joined.replace(/[013457@$!|]/gu, (ch) => LEET_MAP[ch] ?? ch);
  // Word gaps are preserved so the caller can still match on word boundaries;
  // only decorative punctuation is dropped.
  return squashRepeats(folded.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim());
}

/** Distinct graphemes / total. 1 = all different, near 0 = one repeated char. */
export function varietyRatio(input: string): number {
  const g = graphemes(input);
  if (g.length === 0) return 0;
  return new Set(g).size / g.length;
}

/** Non-overlapping occurrences of a plain substring. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}
