import { describe, expect, it } from 'vitest';
import { legacyRowToSql, q, themeRowToSql } from '../scripts/migrate-sheets-to-d1';
import { parseEnvFile } from '../scripts/config';

const legacy = {
  id: 'IDEA-20260918-7K3', created_at: '2026-09-18T12:00:00Z', source: 'voice',
  raw_text: '', transcript: "it's about O'Reilly's", audio_r2_key: 'audio/2026/09/m.caf',
  title: 'Hourly bay rental', cleaned_idea: 'Rent by the hour.', type: 'idea',
  theme: 'Pricing', tags: 'pricing', suggested_new_tags: '', audience_pain: 'x',
  content_format: 'short', lockii_fit: '5', lockii_fit_reason: 'y',
  possible_duplicate_of: '', status: 'drafted', titles_draft: 'A | B', hooks_draft: '',
  clip_moments_draft: '', cta_deliverable_draft: '', picked_on: '', posted_url: '',
  notes: '', error: '',
};

describe('migration SQL', () => {
  it('escapes quotes', () => {
    expect(q("O'Reilly")).toBe("'O''Reilly'");
    expect(q(5)).toBe('5');
    expect(q(null)).toBe('NULL');
  });

  it('emits capture + item + content rows, keeping the legacy item id', () => {
    const sql = legacyRowToSql(legacy);
    expect(sql).toHaveLength(3);
    expect(sql[0]).toContain("INSERT OR IGNORE INTO captures");
    expect(sql[0]).toContain("'CAP-20260918-7K3'");
    expect(sql[0]).toContain("'it''s about O''Reilly''s'");
    expect(sql[1]).toContain("'IDEA-20260918-7K3', 'CAP-20260918-7K3', 'content_idea'");
    expect(sql[2]).toContain("'drafted'");
    expect(sql[2]).toContain("'A | B'");
  });

  it('turns an error row into an error capture with no item', () => {
    const sql = legacyRowToSql({ ...legacy, status: 'error', error: 'boom', title: '' });
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain("'error', 'boom'");
  });

  it('maps themes', () => {
    expect(themeRowToSql(['Pricing', 'Rates', '3', '2026-01-01'])).toBe(
      "INSERT OR IGNORE INTO themes (theme, description, idea_count, created_at) VALUES ('Pricing', 'Rates', 3, '2026-01-01');",
    );
  });
});

describe('parseEnvFile', () => {
  it('reads plain, quoted, exported and commented lines', () => {
    const out = parseEnvFile([
      '# a comment',
      '',
      'SHEET_ID=abc123',
      'export LEGACY_TAB=Ideas',
      'GOOGLE_SA_JSON="C:/Users/Natha/Downloads/key.json"',
      "QUOTED='single'",
      'no_equals_line',
    ].join('\r\n'));
    expect(out).toEqual({
      SHEET_ID: 'abc123',
      LEGACY_TAB: 'Ideas',
      GOOGLE_SA_JSON: 'C:/Users/Natha/Downloads/key.json',
      QUOTED: 'single',
    });
  });
});
