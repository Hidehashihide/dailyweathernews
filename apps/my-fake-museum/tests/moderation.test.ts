import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_CAPTION_GRAPHEMES,
  explainReason,
  looksLikePaymentCard,
  moderateCaption,
} from '../src/core/moderation';

const ok = (s: string) => moderateCaption(s).severity !== 'block';
const blocked = (s: string) => moderateCaption(s).severity === 'block';

describe('moderateCaption - legitimate captions pass', () => {
  const good = [
    'これは古代王の涙である。少なくとも当館はそう考えている。',
    '1847年、旧市街の遺構より出土。用途は不明であり、鑑定が継続中である。',
    'A fragment excavated near the old harbour, circa 1620. Provenance disputed.',
    '世界最古の空き缶。異論は認めない！',
    'ただの石。',
  ];
  for (const caption of good) {
    it(`allows: ${caption.slice(0, 24)}`, () => {
      expect(ok(caption)).toBe(true);
    });
  }
});

describe('moderateCaption - the Scunthorpe problem', () => {
  // Innocent words that contain banned substrings once separators are removed.
  const innocent = [
    'classic passing assessment of the data',
    'Scunthorpe collection, on loan',
    'This is a classic bit of shipping hardware',
    'the assassin bug specimen, well preserved',
    'grape harvest tooling from Penistone',
    '分析の結果、真贋は不明であった',
  ];
  for (const caption of innocent) {
    it(`does not block: ${caption.slice(0, 32)}`, () => {
      const result = moderateCaption(caption);
      expect(result.severity, result.reasons.join(',')).not.toBe('block');
    });
  }
});

describe('moderateCaption - obfuscation is defeated', () => {
  const evasions = [
    'ＦＵＣＫ this exhibit',
    'f.u.c.k this exhibit',
    'f u c k this exhibit',
    'f-u-c-k this exhibit',
    'fuuuuuck this exhibit',
    'this is a piece of 死ね text',
  ];
  for (const caption of evasions) {
    it(`blocks: ${caption.slice(0, 28)}`, () => {
      expect(blocked(caption)).toBe(true);
    });
  }

  it('blocks text hidden behind zero-width characters', () => {
    expect(blocked('f​u​c​k you')).toBe(true);
  });

  it('flags invisible characters even when the text is otherwise clean', () => {
    const result = moderateCaption('ふつうの​キャプションです');
    expect(result.severity).toBe('flag');
    expect(result.reasons).toContain('invisible_characters');
    expect(result.normalized).not.toContain('​');
  });
});

describe('moderateCaption - contact details and PII', () => {
  it('blocks email addresses', () => {
    expect(moderateCaption('連絡は curator@example.com まで').reasons).toContain('contact_email');
  });

  it('blocks URLs', () => {
    expect(moderateCaption('詳しくは https://example.com/x を見て').reasons).toContain('contact_url');
    expect(moderateCaption('see www.example.org for more').reasons).toContain('contact_url');
    expect(moderateCaption('visit example.jp today').reasons).toContain('contact_url');
  });

  it('blocks phone-shaped numbers', () => {
    expect(moderateCaption('090-1234-5678 までご連絡ください').reasons).toContain('contact_phone');
    expect(moderateCaption('call +1 (555) 010-9999 now').reasons).toContain('contact_phone');
  });

  it('does not mistake a plausible year for a phone number', () => {
    const result = moderateCaption('1847年に発見された断片である。');
    expect(result.reasons).not.toContain('contact_phone');
    expect(result.severity).not.toBe('block');
  });

  it('blocks Luhn-valid card numbers', () => {
    expect(moderateCaption('4111 1111 1111 1111 で購入').reasons).toContain('payment_card');
    expect(looksLikePaymentCard('4111111111111111')).toBe(true);
  });

  it('does not flag a random 16-digit run that fails Luhn', () => {
    expect(looksLikePaymentCard('1234567812345678')).toBe(false);
  });
});

describe('moderateCaption - shape rules', () => {
  it('blocks empty and whitespace-only captions', () => {
    expect(moderateCaption('').reasons).toContain('empty');
    expect(moderateCaption('　  \n ').reasons).toContain('empty');
  });

  it('blocks captions shorter than the minimum', () => {
    expect(moderateCaption('石。').reasons).toContain('too_short');
  });

  it('blocks captions over the maximum length', () => {
    expect(moderateCaption('あ'.repeat(MAX_CAPTION_GRAPHEMES + 1)).reasons).toContain('too_long');
  });

  it('measures length in graphemes, so emoji are not over-counted', () => {
    // 130 family emoji = 1040 UTF-16 units but only 130 graphemes: under the cap.
    const caption = '\u{1F468}‍\u{1F469}‍\u{1F467}'.repeat(130);
    expect(moderateCaption(caption).reasons).not.toContain('too_long');
  });

  it('blocks single-character spam', () => {
    expect(moderateCaption('ああああああああああああああああ').reasons).toContain('spam_repetition');
  });

  it('flags symbol soup without blocking it', () => {
    const result = moderateCaption('!!!???!!!???!!!???');
    expect(result.reasons).toContain('symbol_spam');
  });
});

describe('moderateCaption - contract', () => {
  it('returns an empty normalized string exactly when blocked', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const r = moderateCaption(s);
        if (r.severity === 'block') expect(r.normalized).toBe('');
        else expect(r.normalized.length).toBeGreaterThan(0);
      }),
      { numRuns: 1000 },
    );
  });

  it('never throws on arbitrary unicode, including lone surrogates', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString({ maxLength: 300 }), (s) => {
        expect(() => moderateCaption(s)).not.toThrow();
      }),
      { numRuns: 1000 },
    );
    expect(() => moderateCaption('\uD800')).not.toThrow();
    expect(() => moderateCaption('\uDFFF\uD800')).not.toThrow();
  });

  it('never throws on a non-string input', () => {
    expect(() => moderateCaption(undefined as unknown as string)).not.toThrow();
    expect(moderateCaption(null as unknown as string).severity).toBe('block');
    expect(moderateCaption(42 as unknown as string).severity).toBe('block');
  });

  it('is stable: the normalized output re-moderates to the same verdict', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const first = moderateCaption(s);
        if (first.severity === 'block') return;
        const second = moderateCaption(first.normalized);
        expect(second.severity === 'block').toBe(false);
        expect(second.normalized).toBe(first.normalized);
      }),
      { numRuns: 1000 },
    );
  });

  it('completes quickly even on a pathological input', () => {
    const nasty = 'a!'.repeat(20_000);
    const start = performance.now();
    moderateCaption(nasty);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('has a message for every reason it can emit', () => {
    const reasons = [
      'empty', 'too_short', 'too_long', 'banned_word', 'banned_word_obfuscated',
      'contact_email', 'contact_phone', 'contact_url', 'payment_card',
      'spam_repetition', 'symbol_spam', 'invisible_characters',
    ] as const;
    for (const r of reasons) {
      expect(explainReason(r)).toBeTruthy();
    }
  });
});
