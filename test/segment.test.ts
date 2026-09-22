import { describe, expect, it } from 'vitest';
import {
  backOverConnectors,
  buildSegmentPrompt,
  dueToIso,
  locateQuote,
  validateSegments,
  MAX_SEGMENTS,
} from '../src/segment';
import { receiptText } from '../src/sendblue';
import type { Enrichment } from '../src/types';

/**
 * Fixture: a to-do dump the way a two-minute memo actually transcribes —
 * no paragraphs, weak punctuation, filler up front. The expected split is
 * the ground truth to tune the prompt against.
 */
const MEMO =
  'okay so a few things. call Marcus about the lift install quote and ask if the ' +
  'anchor depth changes anything. also order more shop towels before Thursday. ' +
  'oh and I should email the insurance guy back about the liability rider. ' +
  'next thing, a video idea, why most shop tours are boring and what I would do instead. ' +
  'and then the other thing is whether Lockii should ship with the metal keyfob or just the app.';

const MEMO_REPLY = {
  items: [
    { starts_with: 'call Marcus about the lift', bucket: 'todo', area: 'hafens', title: 'Call Marcus about the lift quote', due: null },
    { starts_with: 'order more shop towels', bucket: 'todo', area: 'hafens', title: 'Order shop towels', due: '2026-09-24' },
    { starts_with: 'I should email the insurance guy', bucket: 'todo', area: 'hafens', title: 'Email insurance about liability rider', due: null },
    { starts_with: 'a video idea, why most shop tours', bucket: 'content_idea', area: 'content', title: 'Why most shop tours are boring', due: null },
    { starts_with: 'whether Lockii should ship with', bucket: 'decision', area: 'lockii', title: 'Keyfob or app-only', due: null },
  ],
};

describe('locateQuote', () => {
  it('matches case- and punctuation-insensitively', () => {
    expect(locateQuote('Okay so. Call Marcus, about the lift', 'call marcus about the lift')).toBe(9);
  });

  it('prefers the occurrence at or after `from`', () => {
    const text = 'call him. then later call him again';
    expect(locateQuote(text, 'call him', 5)).toBe(21);
    expect(locateQuote(text, 'call him', 0)).toBe(0);
  });

  it('returns -1 for a quote that is not in the text', () => {
    expect(locateQuote('one two three', 'four five')).toBe(-1);
    expect(locateQuote('one two three', '...')).toBe(-1);
  });
});

describe('backOverConnectors', () => {
  it('backs a start over the filler that introduces it, and no further', () => {
    const text = 'fix the door. oh and then, order towels';
    const at = text.indexOf('order');
    expect(text.slice(backOverConnectors(text, at))).toBe('oh and then, order towels');
    expect(backOverConnectors('fix the door. order towels', 14)).toBe(14);
    expect(backOverConnectors('order towels', 0)).toBe(0);
  });
});

describe('validateSegments', () => {
  it('splits the to-do memo into five items in spoken order', () => {
    const out = validateSegments(MEMO_REPLY, MEMO);
    expect(out.map((s) => s.bucket)).toEqual(['todo', 'todo', 'todo', 'content_idea', 'decision']);
    expect(out[0].text.startsWith('okay so a few things. call Marcus')).toBe(true);
    expect(out[0].text).toMatch(/changes anything\.$/);
    expect(out[1].text.startsWith('also order more shop towels')).toBe(true);
    expect(out[1].due_at).toBe('2026-09-24T12:00:00.000Z');
    expect(out[2].text.startsWith('oh and I should email')).toBe(true);
    expect(out[3].text.startsWith('next thing, a video idea')).toBe(true);
    expect(out[4].text.startsWith('and then the other thing is whether')).toBe(true);
    expect(out[3].area).toBe('content');
    expect(out[4].text).toMatch(/metal keyfob or just the app\.$/);
    // Nothing is lost: the spans tile the memo.
    expect(out.map((s) => s.text).join(' ')).toBe(MEMO);
  });

  it('folds a span whose quote cannot be found into the previous one', () => {
    const reply = {
      items: [
        MEMO_REPLY.items[0],
        { ...MEMO_REPLY.items[1], starts_with: 'buy some towels or whatever' },
        MEMO_REPLY.items[2],
      ],
    };
    const out = validateSegments(reply, MEMO);
    expect(out).toHaveLength(2);
    expect(out[0].text).toContain('order more shop towels');
    expect(out[1].text.startsWith('oh and I should email')).toBe(true);
  });

  it('keeps a single-topic capture as one item', () => {
    const text = 'Why most shop tours are boring and what I would do instead.';
    const out = validateSegments(
      { items: [{ starts_with: 'Why most shop tours', bucket: 'content_idea', area: 'content', title: 'Shop tours', due: null }] },
      text,
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe(text);
  });

  it('folds a fragment into its neighbour instead of making a two-word item', () => {
    const text = 'okay so. call Marcus about the lift. and then. order towels for the bay.';
    const out = validateSegments(
      {
        items: [
          { starts_with: 'okay so', bucket: 'journal', area: '', title: '', due: null },
          { starts_with: 'call Marcus about', bucket: 'todo', area: 'hafens', title: 'Call Marcus', due: null },
          { starts_with: 'and then', bucket: 'todo', area: '', title: '', due: null },
          { starts_with: 'order towels for', bucket: 'todo', area: 'hafens', title: 'Order towels', due: null },
        ],
      },
      text,
    );
    expect(out.map((s) => s.title)).toEqual(['Call Marcus', 'Order towels']);
    expect(out[0].text).toBe('okay so. call Marcus about the lift.');
    expect(out[0].bucket).toBe('todo');
    expect(out[1].text).toBe('and then. order towels for the bay.');
  });

  it('caps the item count and keeps the overflow text', () => {
    const words = Array.from({ length: 40 }, (_, i) => `thing${i} do it now`);
    const text = words.join('. ');
    const items = words.map((w, i) => ({ starts_with: w, bucket: 'todo', area: '', title: `t${i}`, due: null }));
    const out = validateSegments({ items }, text);
    expect(out).toHaveLength(MAX_SEGMENTS);
    expect(out[MAX_SEGMENTS - 1].text).toContain('thing39');
  });

  it('never loses content when no quote can be located', () => {
    const out = validateSegments(
      { items: [{ starts_with: 'nope', bucket: 'todo', area: '', title: 'x', due: null }, { starts_with: 'also nope', bucket: 'todo', area: '', title: 'y', due: null }] },
      MEMO,
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe(MEMO);
  });

  it('rejects a bad bucket, an empty list, and a non-object', () => {
    expect(() => validateSegments({ items: [{ starts_with: 'x', bucket: 'tweet' }] }, MEMO)).toThrow();
    expect(() => validateSegments({ items: [] }, MEMO)).toThrow();
    expect(() => validateSegments(null, MEMO)).toThrow();
  });

  it('drops an unknown area rather than storing it', () => {
    const out = validateSegments(
      { items: [{ starts_with: 'call Marcus', bucket: 'todo', area: 'garage', title: 'x', due: null }] },
      MEMO,
    );
    expect(out[0].area).toBe('');
  });
});

describe('dueToIso', () => {
  it('accepts YYYY-MM-DD only', () => {
    expect(dueToIso('2026-09-24')).toBe('2026-09-24T12:00:00.000Z');
    expect(dueToIso('Thursday')).toBe('');
    expect(dueToIso(null)).toBe('');
  });
});

describe('buildSegmentPrompt', () => {
  it('carries the unit rule, the buckets, today and the text', () => {
    const p = buildSegmentPrompt('call Marcus', { today: '2026-09-22', tz: 'America/Denver' });
    expect(p).toContain('One item = one thing');
    expect(p).toContain('follow_up');
    expect(p).toContain('2026-09-22');
    expect(p).toContain('call Marcus');
    expect(p).toContain(`At most ${MAX_SEGMENTS} items`);
  });
});

describe('receiptText', () => {
  it('lists one line per item with a bucket mark', () => {
    const text = receiptText([
      { bucket: 'todo', title: 'Call Marcus' },
      { bucket: 'content_idea', title: 'Shop tours are boring' },
      { bucket: 'decision', title: 'Keyfob or app' },
    ]);
    expect(text.split('\n')).toEqual([
      '✅ 3 items:',
      '☐ Call Marcus',
      '▶ Shop tours are boring',
      '? Keyfob or app',
    ]);
  });

  it('falls back to the one-line idea receipt for a single enriched idea', () => {
    const enrichment: Enrichment = {
      title: 'Shop tours', cleaned_idea: '', type: 'idea', theme: 'Formats', is_new_theme: false,
      new_theme_description: null, tags: [], suggested_new_tags: [], audience_pain: '',
      content_format: 'short', lockii_fit: 3, lockii_fit_reason: '', possible_duplicate_of: null,
    };
    expect(receiptText([{ bucket: 'content_idea', title: 'Shop tours', enrichment }])).toContain('Theme: Formats');
    expect(receiptText([{ bucket: 'todo', title: 'Call Marcus' }])).toBe('✅ 1 item:\n☐ Call Marcus');
  });
});
