import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  collapseWhitespace,
  countOccurrences,
  graphemeLength,
  graphemes,
  normalizeCaption,
  normalizeForMatch,
  normalizeStrict,
  stripInvisible,
  truncateGraphemes,
  varietyRatio,
} from '../src/core/text';

const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // man-woman-girl ZWJ family
const FLAG = '\u{1F1EF}\u{1F1F5}'; // regional indicator pair
const COMBINING = 'é'; // e + combining acute

describe('graphemes', () => {
  it('counts ZWJ emoji as one character, not eight code units', () => {
    expect(FAMILY.length).toBe(8);
    expect(graphemeLength(FAMILY)).toBe(1);
  });

  it('counts a regional-indicator flag as one character', () => {
    expect(graphemeLength(FLAG)).toBe(1);
  });

  it('counts a combining sequence as one character', () => {
    expect(graphemeLength(COMBINING)).toBe(1);
  });

  it('handles the empty string', () => {
    expect(graphemes('')).toEqual([]);
    expect(graphemeLength('')).toBe(0);
  });
});

describe('truncateGraphemes', () => {
  it('never splits a surrogate pair', () => {
    const out = truncateGraphemes('\u{1F600}\u{1F600}\u{1F600}', 2);
    expect(graphemeLength(out)).toBe(2);
    expect(out).not.toContain('�');
    expect(out.codePointAt(0)).toBe(0x1f600);
  });

  it('never splits a ZWJ cluster', () => {
    const out = truncateGraphemes(`${FAMILY}${FAMILY}`, 1);
    expect(out).toBe(FAMILY);
  });

  it('returns the input untouched when short enough', () => {
    expect(truncateGraphemes('abc', 10)).toBe('abc');
  });

  it('returns empty for a non-positive max', () => {
    expect(truncateGraphemes('abc', 0)).toBe('');
    expect(truncateGraphemes('abc', -3)).toBe('');
  });

  it('always produces at most `max` graphemes', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 30 }), (s, max) => {
        expect(graphemeLength(truncateGraphemes(s, max))).toBeLessThanOrEqual(max);
      }),
      { numRuns: 300 },
    );
  });
});

describe('stripInvisible', () => {
  it('removes zero-width and bidi-override characters', () => {
    expect(stripInvisible('a​b‮c')).toBe('abc');
    expect(stripInvisible('x﻿y')).toBe('xy');
    expect(stripInvisible('p­q')).toBe('pq');
  });

  it('leaves ordinary text and newlines alone', () => {
    expect(stripInvisible('ふつうの 文字\n2行目')).toBe('ふつうの 文字\n2行目');
  });
});

describe('collapseWhitespace / normalizeCaption', () => {
  it('collapses ideographic spaces and trims', () => {
    expect(collapseWhitespace('  a　　b  ')).toBe('a b');
  });

  it('collapses newlines and tabs', () => {
    expect(normalizeCaption('a\n\n\tb')).toBe('a b');
  });

  it('strips invisibles before collapsing so padding cannot inflate length', () => {
    const padded = 'ab' + '​'.repeat(500);
    expect(graphemeLength(normalizeCaption(padded))).toBe(2);
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizeCaption(s);
        expect(normalizeCaption(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });
});

describe('normalizeForMatch', () => {
  it('folds full-width letters via NFKC', () => {
    expect(normalizeForMatch('ＡＢＣ')).toBe('abc');
  });

  it('squashes runs of three or more identical characters', () => {
    expect(normalizeForMatch('fuuuuuck')).toBe('fuuck');
    expect(normalizeForMatch('aa')).toBe('aa');
  });
});

describe('normalizeStrict', () => {
  it('folds leetspeak', () => {
    expect(normalizeStrict('f4k3')).toBe('fake');
    expect(normalizeStrict('5h1t')).toBe('shit');
  });

  it('removes separators used to break up words', () => {
    expect(normalizeStrict('f.u.c.k')).toBe('fuck');
    expect(normalizeStrict('f u c k')).toBe('fuck');
    expect(normalizeStrict('f-u-c-k')).toBe('fuck');
  });

  it('keeps CJK intact', () => {
    expect(normalizeStrict('古代王の涙')).toBe('古代王の涙');
  });
});

describe('varietyRatio', () => {
  it('is 1 for all-distinct and low for a repeated character', () => {
    expect(varietyRatio('abcd')).toBe(1);
    expect(varietyRatio('aaaa')).toBe(0.25);
  });

  it('is 0 for the empty string rather than NaN', () => {
    expect(varietyRatio('')).toBe(0);
  });

  it('always lands in [0, 1]', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = varietyRatio(s);
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });
});

describe('countOccurrences', () => {
  it('counts non-overlapping matches', () => {
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences('abcabc', 'abc')).toBe(2);
    expect(countOccurrences('abc', 'z')).toBe(0);
  });

  it('returns 0 for an empty needle instead of looping forever', () => {
    expect(countOccurrences('abc', '')).toBe(0);
  });
});
