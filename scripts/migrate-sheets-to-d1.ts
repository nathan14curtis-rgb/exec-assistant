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

async function main(): Promise<void> {
  const { saEmail, saKey, sheetId, legacyTab } = loadSetupConfig();

  const token = await getAccessToken(saEmail, saKey);
  const [ideaRows, themeRows] = await Promise.all([
    getValues(token, sheetId, `${legacyTab}!A2:Z`),
    getValues(token, sheetId, 'Themes!A2:D'),
  ]);

  const lines: string[] = [
    `-- Generated ${new Date().toISOString()} from sheet ${sheetId}, tab ${legacyTab}`,
    'BEGIN TRANSACTION;',
  ];

  let ideas = 0;
  let errored = 0;
  for (const raw of ideaRows) {
    if (!raw[0]?.trim()) continue;
    const row = Object.fromEntries(LEGACY_HEADERS.map((h, i) => [h, (raw[i] ?? '').trim()])) as LegacyRow;
    lines.push(...legacyRowToSql(row));
    ideas++;
    if (row.status === 'error') errored++;
  }

  let themes = 0;
  for (const raw of themeRows) {
    if (!raw[0]?.trim()) continue;
    lines.push(themeRowToSql(raw));
    themes++;
  }
  lines.push('COMMIT;');

  if (!ideas && !themes) {
    console.error(`\n✘ No rows found in "${legacyTab}!A2:Z" or "Themes!A2:D".`);
    console.error('  Wrong tab name? Set LEGACY_TAB in .dev.vars.\n');
    process.exit(1);
  }

  const out = resolve(process.cwd(), OUT_FILE);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n') + '\n', 'utf8');

  console.log(`read ${ideas} ideas (${errored} error rows -> capture only) and ${themes} themes`);
  console.log(`wrote ${lines.length - 3} statements to ${OUT_FILE}`);
  console.log('\nReview it, then apply:');
  console.log(`  npx wrangler d1 execute idea-capture --remote --file=${OUT_FILE}`);
}

// Only run when executed directly, so tests can import the pure helpers.
if (process.argv[1] && /migrate-sheets-to-d1/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(`\n✘ ${err.message ?? err}\n`);
    process.exit(1);
  });
}
