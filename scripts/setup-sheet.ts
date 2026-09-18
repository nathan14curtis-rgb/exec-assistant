/**
 * One-time Sheet bootstrap: creates the Ideas / Themes / Tags / Log tabs,
 * writes header rows, and seeds the tag vocabulary. Safe to re-run — existing
 * tabs and non-empty headers are left alone.
 *
 *   GOOGLE_SA_EMAIL=... GOOGLE_SA_PRIVATE_KEY="$(cat key.pem)" SHEET_ID=... \
 *     npm run setup-sheet
 */
import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

const IDEAS_HEADERS = [
  'id', 'created_at', 'source', 'raw_text', 'transcript', 'audio_r2_key', 'title',
  'cleaned_idea', 'type', 'theme', 'tags', 'suggested_new_tags', 'audience_pain',
  'content_format', 'lockii_fit', 'lockii_fit_reason', 'possible_duplicate_of',
  'status', 'titles_draft', 'hooks_draft', 'clip_moments_draft',
  'cta_deliverable_draft', 'picked_on', 'posted_url', 'notes', 'error',
];
const THEMES_HEADERS = ['theme', 'description', 'idea_count', 'created_at'];
const TAGS_HEADERS = ['tag', 'description'];
const LOG_HEADERS = ['timestamp', 'message_id', 'level', 'event', 'detail'];

const SEED_TAGS: [string, string][] = [
  ['branding', 'Brand identity, positioning, naming'],
  ['ad-creative', 'Ads, creative testing, copy'],
  ['graphic-design', 'Visual design work and assets'],
  ['logo', 'Logo design and iterations'],
  ['physical-space', 'The bay, layout, build-out, signage'],
  ['customer-comms', 'Messaging customers, support, expectations'],
  ['booking', 'Reservations, scheduling, availability'],
  ['access-control', 'Locks, doors, codes, contactless entry'],
  ['pricing', 'Rates, packages, discounts, margins'],
  ['unstaffed-ops', 'Running the business without staff on site'],
  ['shrinkage', 'Theft, damage, loss, abuse of the space'],
  ['hiring', 'Finding and managing people'],
  ['growth-pains', 'Scaling problems and bottlenecks'],
  ['expansion', 'New locations, new markets'],
  ['capital', 'Funding, loans, cash flow'],
  ['mistakes', 'Things that went wrong and lessons learned'],
  ['numbers', 'Revenue, costs, metrics, unit economics'],
  ['tools-stack', 'Software and hardware used to run the business'],
];

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
    ['Ideas', IDEAS_HEADERS],
    ['Themes', THEMES_HEADERS],
    ['Tags', TAGS_HEADERS],
    ['Log', LOG_HEADERS],
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

  const tagRows = await api('/values/Tags!A2:B');
  if (!tagRows.values?.length) {
    await api('/values/Tags!A:B:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
      method: 'POST',
      body: JSON.stringify({ values: SEED_TAGS }),
    });
    console.log(`Tags: seeded ${SEED_TAGS.length} tags`);
  } else {
    console.log('Tags: already seeded');
  }

  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
