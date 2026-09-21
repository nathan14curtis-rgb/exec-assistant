import { describe, expect, it } from 'vitest';
import { splitJoinedRow, updateSql, CAPTURE_COLUMNS, ITEM_COLUMNS } from '../src/store/d1';
import {
  CAPTURES_HEADERS,
  CONTENT_HEADERS,
  ITEMS_HEADERS,
  captureToValues,
  contentToValues,
  itemToValues,
} from '../src/store/mirror';
import { enrichmentToItem, combineText, resolveInputKind } from '../src/consumer';
import { audioKey, newId } from '../src/ids';
import { confirmationText } from '../src/sendblue';
import type { Capture, Enrichment } from '../src/types';

const enrichment: Enrichment = {
  title: 'Hourly bay rental',
  cleaned_idea: 'Rent the bay by the hour instead of the day.',
  type: 'idea',
  theme: 'Pricing experiments',
  is_new_theme: false,
  new_theme_description: null,
  tags: ['pricing', 'booking'],
  suggested_new_tags: [],
  audience_pain: 'Operators default to daily pricing.',
  content_format: 'short',
  lockii_fit: 5,
  lockii_fit_reason: 'Pricing is core to rental operators.',
  possible_duplicate_of: null,
};

const capture: Capture = {
  id: 'CAP-20260918-7K3M',
  created_at: '2026-09-18T12:00:00.000Z',
  channel: 'sendblue',
  source_id: 'msg-1',
  input_kind: 'voice',
  raw_text: '',
  transcript_raw: 'so the idea is hourly bay rental',
  transcript_repaired: '',
  audio_r2_key: 'audio/2026/09/msg-1.caf',
  item_count: 1,
  status: 'processed',
  error: '',
};

describe('enrichmentToItem', () => {
  const now = new Date('2026-09-18T12:00:00Z');
  const { item, content } = enrichmentToItem(enrichment, capture.id, now);

  it('links the item to its capture and content row', () => {
    expect(item.id).toMatch(/^ITM-20260918-[A-Z2-9]{4}$/);
    expect(item.capture_id).toBe(capture.id);
    expect(item.bucket).toBe('content_idea');
    expect(item.status).toBe('open');
    expect(content.item_id).toBe(item.id);
    expect(content.stage).toBe('enriched');
  });

  it('flattens tags and leaves the draft columns blank', () => {
    expect(content.tags).toBe('pricing, booking');
    expect(content.lockii_fit).toBe(5);
    for (const f of ['titles_draft', 'hooks_draft', 'clip_moments_draft', 'cta_deliverable_draft'] as const) {
      expect(content[f]).toBe('');
    }
  });

  it('carries a duplicate hint into related_item_id', () => {
    const dup = enrichmentToItem({ ...enrichment, possible_duplicate_of: 'ITM-1' }, capture.id, now);
    expect(dup.item.related_item_id).toBe('ITM-1');
    expect(dup.content.possible_duplicate_of).toBe('ITM-1');
  });
});

describe('updateSql', () => {
  it('only touches whitelisted columns, in a stable order', () => {
    const u = updateSql<Capture>(
      'captures',
      CAPTURE_COLUMNS,
      { status: 'error', error: 'boom', ['evil' as never]: 'x' } as Partial<Capture>,
      'id',
      'CAP-1',
    );
    expect(u).toEqual({
      sql: 'UPDATE captures SET status = ?, error = ? WHERE id = ?',
      params: ['error', 'boom', 'CAP-1'],
    });
  });

  it('returns null for an empty patch', () => {
    expect(updateSql('items', ITEM_COLUMNS, {}, 'id', 'x')).toBeNull();
  });
});

describe('splitJoinedRow', () => {
  it('separates c_-prefixed content columns and nulls an absent join', () => {
    const withContent = splitJoinedRow({ id: 'ITM-1', bucket: 'content_idea', c_item_id: 'ITM-1', c_stage: 'enriched' });
    expect(withContent.id).toBe('ITM-1');
    expect(withContent.content).toEqual({ item_id: 'ITM-1', stage: 'enriched' });

    const without = splitJoinedRow({ id: 'ITM-2', bucket: 'todo', c_item_id: null, c_stage: null });
    expect(without.content).toBeNull();
    expect((without as unknown as Record<string, unknown>).c_stage).toBeUndefined();
  });
});

describe('mirror row builders', () => {
  it('emit one cell per header, in header order', () => {
    const c = captureToValues(capture);
    expect(c).toHaveLength(CAPTURES_HEADERS.length);
    expect(c[0]).toBe(capture.id);
    expect(c[CAPTURES_HEADERS.indexOf('item_count')]).toBe('1');

    const { item, content } = enrichmentToItem(enrichment, capture.id, new Date());
    const i = itemToValues(item);
    expect(i).toHaveLength(ITEMS_HEADERS.length);
    expect(i[ITEMS_HEADERS.indexOf('bucket')]).toBe('content_idea');

    const ci = contentToValues(item.title, content);
    expect(ci).toHaveLength(CONTENT_HEADERS.length);
    expect(ci[CONTENT_HEADERS.indexOf('title')]).toBe('Hourly bay rental');
    expect(ci[CONTENT_HEADERS.indexOf('lockii_fit')]).toBe('5');
  });
});

describe('ids', () => {
  it('builds sortable dated ids per prefix', () => {
    const d = new Date('2026-09-18T00:00:00Z');
    expect(newId('CAP', d)).toMatch(/^CAP-20260918-[A-Z2-9]{4}$/);
    expect(newId('ITM', d)).toMatch(/^ITM-20260918-[A-Z2-9]{4}$/);
  });

  it('builds a partitioned r2 key and sanitizes the source id', () => {
    expect(audioKey('abc/def', 'caf', new Date('2026-09-18T00:00:00Z'))).toBe('audio/2026/09/abc_def.caf');
  });
});

describe('input handling', () => {
  it('classifies each combination', () => {
    expect(resolveInputKind('', true)).toBe('voice');
    expect(resolveInputKind('typed', false)).toBe('text');
    expect(resolveInputKind('typed', true)).toBe('voice+text');
  });

  it('puts the typed text before the transcript', () => {
    expect(combineText('typed', 'spoken')).toBe('typed\n\nspoken');
    expect(combineText('', 'spoken')).toBe('spoken');
  });
});

describe('confirmationText', () => {
  it('formats the confirmation', () => {
    expect(confirmationText(enrichment)).toBe(
      '✅ idea: "Hourly bay rental" → Theme: Pricing experiments | Tags: pricing, booking | Fit 5/5',
    );
  });

  it('appends the duplicate warning', () => {
    expect(confirmationText(enrichment, 'Door codes that expire')).toContain('⚠️ Similar to: "Door codes that expire"');
  });
});
