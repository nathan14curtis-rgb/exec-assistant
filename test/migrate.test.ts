import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyRowToSql, planMigration, q, themeRowToSql } from '../scripts/migrate-sheets-to-d1';
import { loadEnvFile, parseEnvFile } from '../scripts/config';

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

describe('loadEnvFile precedence', () => {
  const file = join(tmpdir(), `dev-vars-${Date.now()}`);
  afterEach(() => { try { unlinkSync(file); } catch {} });

  it('overrides a stale environment variable', () => {
    writeFileSync(file, 'SHEET_ID=real-id\n');
    process.env.SHEET_ID = 'your-sheet-id'; // left over from an earlier shell
    loadEnvFile(file);
    expect(process.env.SHEET_ID).toBe('real-id');
    delete process.env.SHEET_ID;
  });

  it('leaves an existing value alone when the file entry is blank', () => {
    writeFileSync(file, 'SHEET_ID=\n');
    process.env.SHEET_ID = 'set-elsewhere';
    loadEnvFile(file);
    expect(process.env.SHEET_ID).toBe('set-elsewhere');
    delete process.env.SHEET_ID;
  });

  it('is a no-op when the file is missing', () => {
    expect(() => loadEnvFile(join(tmpdir(), 'definitely-not-here'))).not.toThrow();
  });
});

describe('planMigration', () => {
  const HEADERS = [
    'id', 'created_at', 'source', 'raw_text', 'transcript', 'audio_r2_key', 'title',
    'cleaned_idea', 'type', 'theme', 'tags', 'suggested_new_tags', 'audience_pain',
    'content_format', 'lockii_fit', 'lockii_fit_reason', 'possible_duplicate_of',
    'status', 'titles_draft', 'hooks_draft', 'clip_moments_draft',
    'cta_deliverable_draft', 'picked_on', 'posted_url', 'notes', 'error',
  ];
  const row = (id: string, title = 'a title', status = 'enriched') => {
    const r = new Array(26).fill('');
    r[0] = id; r[1] = '2026-09-18T12:00:00Z'; r[6] = title; r[17] = status;
    return r;
  };

  it('accounts for every filled row, not just those with an id', () => {
    const noId = row('', 'lost its id');
    const plan = planMigration(HEADERS, [row('IDEA-1'), noId, row('IDEA-2')], []);
    expect(plan.report.rows).toBe(3);
    expect(plan.report.synthesizedIds).toHaveLength(1);
    // the row without an id still produced its three statements
    expect(plan.statements.filter((s) => s.includes('INTO items'))).toHaveLength(3);
  });

  it('suffixes a repeated id instead of losing it to INSERT OR IGNORE', () => {
    const plan = planMigration(HEADERS, [row('IDEA-1', 'first'), row('IDEA-1', 'second')], []);
    expect(plan.report.duplicateIds).toEqual(['IDEA-1']);
    const items = plan.statements.filter((s) => s.includes('INTO items'));
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("'IDEA-1'");
    expect(items[1]).toContain("'IDEA-1-2'");
    expect(items[1]).toContain('second');
  });

  it('ignores blank rows without counting them', () => {
    const plan = planMigration(HEADERS, [row('IDEA-1'), new Array(26).fill(''), []], []);
    expect(plan.report.rows).toBe(1);
  });

  it('reports a header layout that does not match, naming the column', () => {
    const wrong = [...HEADERS];
    wrong[6] = 'headline';
    const plan = planMigration(wrong, [row('IDEA-1')], []);
    expect(plan.report.headerMismatch).toEqual([
      { column: 'G', expected: 'title', found: 'headline' },
    ]);
  });

  it('accepts the expected layout, case-insensitively, and an absent header row', () => {
    expect(planMigration(HEADERS.map((h) => h.toUpperCase()), [], []).report.headerMismatch).toEqual([]);
    expect(planMigration([], [row('IDEA-1')], []).report.headerMismatch).toEqual([]);
  });

  it('counts themes and error rows', () => {
    const plan = planMigration(HEADERS, [row('IDEA-1', 't', 'error')], [['Pricing', 'd', '2', '']]);
    expect(plan.report.errored).toBe(1);
    expect(plan.report.themes).toBe(1);
    // an error row yields a capture and no item
    expect(plan.statements.filter((s) => s.includes('INTO items'))).toHaveLength(0);
  });
});

describe('D1 compatibility of the generated SQL', () => {
  const HEADERS2 = [
    'id', 'created_at', 'source', 'raw_text', 'transcript', 'audio_r2_key', 'title',
    'cleaned_idea', 'type', 'theme', 'tags', 'suggested_new_tags', 'audience_pain',
    'content_format', 'lockii_fit', 'lockii_fit_reason', 'possible_duplicate_of',
    'status', 'titles_draft', 'hooks_draft', 'clip_moments_draft',
    'cta_deliverable_draft', 'picked_on', 'posted_url', 'notes', 'error',
  ];
  const aRow = (id: string) => {
    const r = new Array(26).fill('');
    r[0] = id; r[1] = '2026-09-18T12:00:00Z'; r[6] = 'a title'; r[17] = 'enriched';
    return r;
  };

  /**
   * D1 refuses explicit transaction control — "D1 runs your SQL in a
   * transaction for you" — and rejects the whole file when it sees one.
   * SQLite accepts these happily, so a local apply test does not catch it.
   */
  it('emits no transaction-control statement', () => {
    const { statements } = planMigration(HEADERS2, [aRow('IDEA-1'), aRow('IDEA-2')], [['T', 'd', '1', '']]);
    expect(statements.length).toBeGreaterThan(0);
    for (const sql of statements) {
      expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i);
    }
  });

  it('emits only INSERTs, each a single terminated statement', () => {
    const { statements } = planMigration(HEADERS2, [aRow('IDEA-1')], []);
    for (const sql of statements) {
      expect(sql.startsWith('INSERT OR IGNORE INTO ')).toBe(true);
      expect(sql.endsWith(';')).toBe(true);
      // one statement per line keeps wrangler's splitting predictable
      expect(sql.split(';').filter((p) => p.trim())).toHaveLength(1);
      expect(sql).not.toContain('\n');
    }
  });
});
