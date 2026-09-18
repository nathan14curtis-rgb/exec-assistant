import { describe, expect, it } from 'vitest';
import { buildPrompt, extractJson, validateEnrichment } from '../src/enrich';

const VOCAB = ['pricing', 'booking', 'unstaffed-ops'];

const valid = {
  title: 'Why I stopped staffing the bay',
  cleaned_idea: 'I pulled the last person off site and nothing broke.',
  type: 'idea',
  theme: 'Unstaffed operations',
  is_new_theme: false,
  new_theme_description: null,
  tags: ['unstaffed-ops', 'pricing'],
  suggested_new_tags: [],
  audience_pain: 'Operators think they need staff on site.',
  content_format: 'youtube_pillar',
  lockii_fit: 5,
  lockii_fit_reason: 'Directly about running a location unstaffed.',
  possible_duplicate_of: null,
};

describe('extractJson', () => {
  it('parses plain JSON and fenced JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });

  it('throws when there is no object', () => {
    expect(() => extractJson('sorry, no')).toThrow();
  });
});

describe('validateEnrichment', () => {
  it('accepts a well-formed payload', () => {
    const out = validateEnrichment(valid, VOCAB);
    expect(out.title).toBe(valid.title);
    expect(out.tags).toEqual(['unstaffed-ops', 'pricing']);
    expect(out.possible_duplicate_of).toBeNull();
  });

  it('moves out-of-vocabulary tags to suggested_new_tags', () => {
    const out = validateEnrichment({ ...valid, tags: ['pricing', 'llc-formation'] }, VOCAB);
    expect(out.tags).toEqual(['pricing']);
    expect(out.suggested_new_tags).toContain('llc-formation');
  });

  it('keeps new_theme_description only when is_new_theme', () => {
    expect(
      validateEnrichment({ ...valid, new_theme_description: 'ignored' }, VOCAB)
        .new_theme_description,
    ).toBeNull();
    expect(
      validateEnrichment(
        { ...valid, is_new_theme: true, new_theme_description: 'Shrinkage stories' },
        VOCAB,
      ).new_theme_description,
    ).toBe('Shrinkage stories');
  });

  it('normalizes a string "null" duplicate id', () => {
    expect(validateEnrichment({ ...valid, possible_duplicate_of: 'null' }, VOCAB)
      .possible_duplicate_of).toBeNull();
    expect(validateEnrichment({ ...valid, possible_duplicate_of: 'IDEA-20260901-7K3' }, VOCAB)
      .possible_duplicate_of).toBe('IDEA-20260901-7K3');
  });

  it('rejects bad enums and out-of-range fit', () => {
    expect(() => validateEnrichment({ ...valid, type: 'tweet' }, VOCAB)).toThrow();
    expect(() => validateEnrichment({ ...valid, content_format: 'billboard' }, VOCAB)).toThrow();
    expect(() => validateEnrichment({ ...valid, lockii_fit: 9 }, VOCAB)).toThrow();
    expect(() => validateEnrichment({ ...valid, title: 42 }, VOCAB)).toThrow();
    expect(() => validateEnrichment(null, VOCAB)).toThrow();
  });
});

describe('buildPrompt', () => {
  it('includes themes, vocab and recent ideas', () => {
    const prompt = buildPrompt('rent by the hour', {
      themes: [{ theme: 'Unstaffed operations', description: 'No staff on site', idea_count: 3 }],
      tagVocab: VOCAB,
      recentIdeas: [{ id: 'IDEA-20260901-7K3', title: 'Door codes that expire' }],
    });
    expect(prompt).toContain('Unstaffed operations');
    expect(prompt).toContain('unstaffed-ops');
    expect(prompt).toContain('IDEA-20260901-7K3');
    expect(prompt).toContain('rent by the hour');
  });
});
