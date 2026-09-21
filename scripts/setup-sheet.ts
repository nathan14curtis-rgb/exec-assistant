/**
 * Sheet bootstrap for the mirror tabs: Captures / Items / ContentIdeas /
 * Themes. Writes header rows only. Safe to re-run — existing tabs and
 * non-empty headers are left alone. Legacy tabs (Ideas, Tags, Log) are not
 * touched; rename Ideas to Ideas_archive by hand after migrating.
 *
 * Reads its config from `.dev.vars` — see .dev.vars.example.
 *
 *   npm run setup-sheet
 */
import { createSign } from 'node:crypto';
import { loadSetupConfig } from './config';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

// Mirror tabs. D1 is the source of truth; the Worker writes these one-way.
// Keep in step with src/store/mirror.ts.
const CAPTURES_HEADERS = [
  'id', 'created_at', 'channel', 'input_kind', 'status', 'item_count', 'raw_text',
  'transcript_raw', 'transcript_repaired', 'audio_r2_key', 'error',
];
const ITEMS_HEADERS = [
  'id', 'capture_id', 'created_at', 'bucket', 'status', 'area', 'title', 'body',
  'due_at', 'related_item_id', 'data', 'updated_at',
];
const CONTENT_HEADERS = [
  'item_id', 'title', 'stage', 'theme', 'type', 'tags', 'suggested_new_tags',
  'cleaned_idea', 'audience_pain', 'content_format', 'lockii_fit',
  'lockii_fit_reason', 'possible_duplicate_of', 'titles_draft', 'hooks_draft',
  'clip_moments_draft', 'cta_deliverable_draft', 'picked_on', 'posted_url', 'notes',
];
const THEMES_HEADERS = ['theme', 'description', 'idea_count'];

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

let token = '';
let sheetId = '';

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}/${sheetId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** A1 range end column for N headers (all our tabs are well under 26 wide). */
function lastColumn(n: number): string {
  return String.fromCharCode(64 + n);
}

async function main(): Promise<void> {
  const cfg = loadSetupConfig();
  sheetId = cfg.sheetId;
  token = await getAccessToken(cfg.saEmail, cfg.saKey);

  const meta = await api('');
  console.log(`sheet: ${meta.properties?.title ?? '(untitled)'}`);
  const existing = new Set<string>(
    (meta.sheets ?? []).map((s: any) => s.properties.title as string),
  );

  const wanted: [string, string[]][] = [
    ['Captures', CAPTURES_HEADERS],
    ['Items', ITEMS_HEADERS],
    ['ContentIdeas', CONTENT_HEADERS],
    ['Themes', THEMES_HEADERS],
  ];

  const missing = wanted.filter(([title]) => !existing.has(title));
  if (missing.length) {
    await api(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: missing.map(([title]) => ({ addSheet: { properties: { title } } })),
      }),
    });
    console.log(`created tabs: ${missing.map(([t]) => t).join(', ')}`);
  }

  for (const [title, headers] of wanted) {
    const range = `${title}!A1:${lastColumn(headers.length)}1`;
    const current = await api(`/values/${encodeURIComponent(range)}`);
    if (current.values?.[0]?.length) {
      console.log(`${title}: headers already present`);
      continue;
    }
    await api(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [headers] }),
    });
    console.log(`${title}: wrote headers`);
  }

  console.log('\ndone — the mirror will now find its tabs.');
}

main().catch((err) => {
  console.error(`\n✘ ${err.message ?? err}\n`);
  process.exit(1);
});
