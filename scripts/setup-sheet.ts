/**
 * Sheet bootstrap for the mirror tabs: Captures / Items / ContentIdeas /
 * Themes. Writes header rows only. Safe to re-run — existing tabs and
 * non-empty headers are left alone. Legacy tabs (Ideas, Tags, Log) are not
 * touched; rename Ideas to Ideas_archive by hand after migrating.
 *
 *   GOOGLE_SA_EMAIL=... GOOGLE_SA_PRIVATE_KEY="$(cat key.pem)" SHEET_ID=... \
 *     npm run setup-sheet
 */
import { createSign } from 'node:crypto';

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

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const SA_EMAIL = required('GOOGLE_SA_EMAIL');
const SA_KEY = required('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n');
const SHEET_ID = required('SHEET_ID');

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: SA_EMAIL, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(SA_KEY));

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
async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}/${SHEET_ID}${path}`, {
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

async function main(): Promise<void> {
  token = await getAccessToken();

  const meta = await api('');
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
    const range = `${title}!A1:${String.fromCharCode(64 + headers.length)}1`;
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

  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
