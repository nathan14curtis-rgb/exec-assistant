import { describe, expect, it } from 'vitest';
import { IDEAS_HEADERS, ideaRowToValues } from '../src/sheets';
import { audioKey, newIdeaId } from '../src/ids';
import { combineText, resolveSource } from '../src/consumer';
import { confirmationText } from '../src/sendblue';
import type { Enrichment, IdeaRow } from '../src/types';

const row: IdeaRow = {
  id: 'IDEA-20260918-7K3',
  created_at: '2026-09-18T12:00:00.000Z',
  source: 'voice',
  raw_text: '',
  transcript: 'so the idea is hourly bay rental',
  audio_r2_key: 'audio/2026/09/msg-1.caf',
  title: 'Hourly bay rental',
  cleaned_idea: 'Rent the bay by the hour instead of the day.',
  type: 'idea',
  theme: 'Pricing experiments',
  tags: 'pricing, booking',
  suggested_new_tags: '',
  audience_pain: 'Operators default to daily pricing.',
  content_format: 'short',
  lockii_fit: '5',
  lockii_fit_reason: 'Pricing is core to rental operators.',
  possible_duplicate_of: '',
  status: 'enriched',
  titles_draft: '',
  hooks_draft: '',
  clip_moments_draft: '',
  cta_deliverable_draft: '',
  picked_on: '',
  posted_url: '',
  notes: '',
  error: '',
};

describe('ideaRowToValues', () => {
  it('emits one cell per header, in header order', () => {
    const values = ideaRowToValues(row);
    expect(values).toHaveLength(IDEAS_HEADERS.length);
    expect(values[0]).toBe('IDEA-20260918-7K3');
    expect(values[IDEAS_HEADERS.indexOf('status')]).toBe('enriched');
    expect(values[IDEAS_HEADERS.indexOf('tags')]).toBe('pricing, booking');
    expect(values[IDEAS_HEADERS.indexOf('error')]).toBe('');
  });

  it('leaves the draft columns blank for the Cowork task', () => {
    const values = ideaRowToValues(row);
    for (const h of ['titles_draft', 'hooks_draft', 'clip_moments_draft', 'cta_deliverable_draft']) {
      expect(values[IDEAS_HEADERS.indexOf(h as never)]).toBe('');
    }
  });
});

describe('ids', () => {
  it('builds a sortable dated id', () => {
    expect(newIdeaId(new Date('2026-09-18T00:00:00Z'))).toMatch(/^IDEA-20260918-[A-Z2-9]{3}$/);
  });

  it('builds a partitioned r2 key and sanitizes the message id', () => {
    expect(audioKey('abc/def', 'caf', new Date('2026-09-18T00:00:00Z')))
      .toBe('audio/2026/09/abc_def.caf');
  });
});

describe('source resolution', () => {
  it('classifies each combination', () => {
    expect(resolveSource('', 'spoken')).toBe('voice');
    expect(resolveSource('typed', '')).toBe('text');
    expect(resolveSource('typed', 'spoken')).toBe('voice+text');
  });

  it('puts the typed text before the transcript', () => {
    expect(combineText('typed', 'spoken')).toBe('typed\n\nspoken');
    expect(combineText('', 'spoken')).toBe('spoken');
  });
});

describe('confirmationText', () => {
  const enrichment: Enrichment = {
    title: 'Hourly bay rental',
    cleaned_idea: '',
    type: 'idea',
    theme: 'Pricing experiments',
    is_new_theme: false,
    new_theme_description: null,
    tags: ['pricing', 'booking'],
    suggested_new_tags: [],
    audience_pain: '',
    content_format: 'short',
    lockii_fit: 5,
    lockii_fit_reason: '',
    possible_duplicate_of: null,
  };

  it('formats the confirmation', () => {
    expect(confirmationText(enrichment)).toBe(
      '✅ idea: "Hourly bay rental" → Theme: Pricing experiments | Tags: pricing, booking | Fit 5/5',
    );
  });

  it('appends the duplicate warning', () => {
    expect(confirmationText(enrichment, 'Door codes that expire')).toContain(
      '⚠️ Similar to: "Door codes that expire"',
    );
  });

  it('says none when there are no tags', () => {
    expect(confirmationText({ ...enrichment, tags: [] })).toContain('Tags: none');
  });
});
