/**
 * One-time migration: legacy `Ideas` + `Themes` tabs → D1 SQL.
 *
 * Reads the Sheet with the service account and writes SQL to
 * migrations/data/legacy-ideas.sql. Nothing is sent to D1 by this script —
 * you review the file, then apply it:
 *
 *   npm run migrate:sql
 *   npx wrangler d1 execute idea-capture --remote --file=migrations/data/legacy-ideas.sql
 *
 * Config comes from .dev.vars — see .dev.vars.example.
 *
 * Each legacy row becomes one capture + one content_idea item. The item keeps
 * the legacy IDEA-… id so anything that referenced it still resolves; the
 * capture gets the same suffix under a CAP- prefix. Statements use INSERT OR
 * IGNORE, so re-running is safe.
 */
import { createSign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadSetupConfig } from './config';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

const LEGACY_HEADERS = [
  'id', 'created_at', 'source', 'raw_text', 'transcript', 'audio_r2_key', 'title',
  'cleaned_idea', 'type', 'theme', 'tags', 'suggested_new_tags', 'audience_pain',
  'content_format', 'lockii_fit', 'lockii_fit_reason', 'possible_duplicate_of',
  'status', 'titles_draft', 'hooks_draft', 'clip_moments_draft',
  'cta_deliverable_draft', 'picked_on', 'posted_url', 'notes', 'error',
] as const;
type LegacyRow = Record<(typeof LEGACY_HEADERS)[number], string>;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

async function getAccessToken(saEmail: string, saKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: saEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(saKey));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function getValues(token: string, sheetId: string, range: string): Promise<string[][]> {
  const res = await fetch(`${API}/${sheetId}/values/${encodeURIComponent(range)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${range} failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { values?: string[][] }).values ?? [];
}

// --- SQL helpers ------------------------------------------------------------

export function q(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

function insertOrIgnore(table: string, row: Record<string, string | number>): string {
  const cols = Object.keys(row);
  return `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => q(row[c])).join(', ')});`;
}

const STAGES = new Set(['enriched', 'drafted', 'picked', 'filmed', 'posted']);

/** Pure: legacy row → SQL statements. Exported for tests. */
export function legacyRowToSql(r: LegacyRow): string[] {
  const suffix = r.id.replace(/^IDEA-/, '');
  const captureId = `CAP-${suffix}`;
  const hasAudio = !!r.audio_r2_key || !!r.transcript;
  const inputKind = r.source || (r.raw_text && hasAudio ? 'voice+text' : hasAudio ? 'voice' : 'text');
  const isError = r.status === 'error';
  const createdAt = r.created_at || new Date().toISOString();
  const out: string[] = [];

  out.push(
    insertOrIgnore('captures', {
      id: captureId,
      created_at: createdAt,
      channel: 'sendblue',
      source_id: `legacy:${r.id}`,
      input_kind: inputKind,
      raw_text: r.raw_text,
      transcript_raw: r.transcript,
      transcript_repaired: '',
      audio_r2_key: r.audio_r2_key,
      item_count: isError ? 0 : 1,
      status: isError ? 'error' : 'processed',
      error: r.error,
    }),
  );
  if (isError) return out;

  out.push(
    insertOrIgnore('items', {
      id: r.id,
      capture_id: captureId,
      bucket: 'content_idea',
      title: r.title,
      body: r.cleaned_idea,
      status: r.status === 'posted' ? 'done' : 'open',
      area: 'content',
      due_at: '',
      related_item_id: r.possible_duplicate_of,
      data: '{}',
      created_at: createdAt,
      updated_at: createdAt,
    }),
  );
  out.push(
    insertOrIgnore('content_ideas', {
      item_id: r.id,
      cleaned_idea: r.cleaned_idea,
      type: r.type,
      theme: r.theme,
      tags: r.tags,
      suggested_new_tags: r.suggested_new_tags,
      audience_pain: r.audience_pain,
      content_format: r.content_format,
      lockii_fit: Number(r.lockii_fit) || 0,
      lockii_fit_reason: r.lockii_fit_reason,
      possible_duplicate_of: r.possible_duplicate_of,
      stage: STAGES.has(r.status) ? r.status : 'enriched',
      titles_draft: r.titles_draft,
      hooks_draft: r.hooks_draft,
      clip_moments_draft: r.clip_moments_draft,
      cta_deliverable_draft: r.cta_deliverable_draft,
      picked_on: r.picked_on,
      posted_url: r.posted_url,
      notes: r.notes,
    }),
  );
  return out;
}

export function themeRowToSql(r: string[]): string {
  return insertOrIgnore('themes', {
    theme: r[0] ?? '',
    description: r[1] ?? '',
    idea_count: Number(r[2]) || 0,
    created_at: r[3] || new Date().toISOString(),
  });
}

const OUT_FILE = 'migrations/data/legacy-ideas.sql';

export interface MigrationReport {
  /** Non-empty rows seen in the legacy tab. */
  rows: number;
  /** Rows whose id cell was blank, given a synthetic id rather than dropped. */
  synthesizedIds: string[];
  /** Ids appearing more than once; later ones are suffixed rather than lost. */
  duplicateIds: string[];
  /** Legacy rows that only produce a capture, because they failed originally. */
  errored: number;
  themes: number;
  /** Header cells that do not match what this script expects to find. */
  headerMismatch: { column: string; expected: string; found: string }[];
}

export interface MigrationPlan {
  statements: string[];
  report: MigrationReport;
}

function columnName(i: number): string {
  return String.fromCharCode(65 + i);
}

/**
 * Turn the legacy tab into SQL, accounting for every row.
 *
 * Nothing is dropped quietly: a blank id gets a synthetic one, a repeated id
 * gets a suffix rather than colliding into `INSERT OR IGNORE`, and both are
 * reported. A silent partial migration is worse than a noisy complete one —
 * you cannot tell from the row count which records you lost.
 */
export function planMigration(
  headerRow: string[],
  ideaRows: string[][],
  themeRows: string[][],
): MigrationPlan {
  const headerMismatch: { column: string; expected: string; found: string }[] = [];
  if (headerRow.length) {
    LEGACY_HEADERS.forEach((expected, i) => {
      const found = (headerRow[i] ?? '').trim();
      if (found.toLowerCase() !== expected) {
        headerMismatch.push({ column: columnName(i), expected, found: found || '(empty)' });
      }
    });
  }

  const statements: string[] = [];
  const seen = new Map<string, number>();
  const synthesizedIds: string[] = [];
  const duplicateIds: string[] = [];
  let rows = 0;
  let errored = 0;

  ideaRows.forEach((raw, index) => {
    // A row is worth migrating if anything in it is filled in — judging by
    // the id cell alone loses rows whose id was never written.
    if (!raw.some((cell) => (cell ?? '').trim())) return;
    rows++;

    const row = Object.fromEntries(
      LEGACY_HEADERS.map((h, i) => [h, (raw[i] ?? '').trim()]),
    ) as LegacyRow;

    if (!row.id) {
      row.id = `IDEA-LEGACY-${String(index + 2).padStart(4, '0')}`;
      synthesizedIds.push(row.id);
    }

    const count = seen.get(row.id) ?? 0;
    seen.set(row.id, count + 1);
    if (count > 0) {
      duplicateIds.push(row.id);
      row.id = `${row.id}-${count + 1}`;
    }

    statements.push(...legacyRowToSql(row));
    if (row.status === 'error') errored++;
  });

  let themes = 0;
  for (const raw of themeRows) {
    if (!(raw[0] ?? '').trim()) continue;
    statements.push(themeRowToSql(raw));
    themes++;
  }

  return {
    statements,
    report: { rows, synthesizedIds, duplicateIds, errored, themes, headerMismatch },
  };
}

async function main(): Promise<void> {
  const { saEmail, saKey, sheetId, legacyTab } = loadSetupConfig();

  const token = await getAccessToken(saEmail, saKey);
  const [headerRows, ideaRows, themeRows] = await Promise.all([
    getValues(token, sheetId, `${legacyTab}!A1:Z1`),
    getValues(token, sheetId, `${legacyTab}!A2:Z`),
    getValues(token, sheetId, 'Themes!A2:D'),
  ]);

  const { statements, report } = planMigration(headerRows[0] ?? [], ideaRows, themeRows);

  if (!report.rows && !report.themes) {
    console.error(`\n✘ No rows found in "${legacyTab}!A2:Z" or "Themes!A2:D".`);
    console.error('  Wrong tab name? Set LEGACY_TAB in .dev.vars.\n');
    process.exit(1);
  }

  if (report.headerMismatch.length) {
    console.error(`\n✘ The "${legacyTab}" tab is not laid out the way this script expects.`);
    console.error('  Columns are read by position, so the wrong layout imports the wrong fields:\n');
    for (const m of report.headerMismatch.slice(0, 8)) {
      console.error(`    column ${m.column}: expected "${m.expected}", found "${m.found}"`);
    }
    if (report.headerMismatch.length > 8) {
      console.error(`    … and ${report.headerMismatch.length - 8} more`);
    }
    console.error('\n  Nothing was written. Set LEGACY_TAB if this is the wrong tab, or');
    console.error('  reorder the sheet to match src/store/mirror.ts.\n');
    process.exit(1);
  }

  // No BEGIN TRANSACTION / COMMIT: D1 rejects explicit transaction control
  // ("D1 runs your SQL in a transaction for you"), and `wrangler d1 execute
  // --file` already applies the file as one batch that rolls back whole if a
  // statement fails. Emitting them made the whole import fail at apply time.
  const lines = [
    `-- Generated ${new Date().toISOString()} from sheet ${sheetId}, tab ${legacyTab}`,
    '-- Applied with: npm run migrate:apply',
    ...statements,
  ];
  const out = resolve(process.cwd(), OUT_FILE);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n') + '\n', 'utf8');

  console.log(`read ${report.rows} rows (${report.errored} failed originally -> capture only)`);
  console.log(`read ${report.themes} themes`);
  if (report.synthesizedIds.length) {
    console.log(`\n⚠ ${report.synthesizedIds.length} row(s) had no id; gave them one so they are not lost:`);
    console.log(`  ${report.synthesizedIds.slice(0, 5).join(', ')}${report.synthesizedIds.length > 5 ? ' …' : ''}`);
  }
  if (report.duplicateIds.length) {
    console.log(`\n⚠ ${report.duplicateIds.length} repeated id(s); suffixed so none is dropped:`);
    console.log(`  ${[...new Set(report.duplicateIds)].slice(0, 5).join(', ')}`);
  }
  console.log(`\nwrote ${statements.length} statements to ${OUT_FILE}`);
  console.log('\nReview it, then apply:');
  console.log('  npm run migrate:apply');
}

// Only run when executed directly, so tests can import the pure helpers.
if (process.argv[1] && /migrate-sheets-to-d1/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(`\n✘ ${err.message ?? err}\n`);
    process.exit(1);
  });
}
