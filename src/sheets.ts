import type { Env, IdeaRow } from './types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export const IDEAS_HEADERS = [
  'id', 'created_at', 'source', 'raw_text', 'transcript', 'audio_r2_key', 'title',
  'cleaned_idea', 'type', 'theme', 'tags', 'suggested_new_tags', 'audience_pain',
  'content_format', 'lockii_fit', 'lockii_fit_reason', 'possible_duplicate_of',
  'status', 'titles_draft', 'hooks_draft', 'clip_moments_draft',
  'cta_deliverable_draft', 'picked_on', 'posted_url', 'notes', 'error',
] as const;

export const THEMES_HEADERS = ['theme', 'description', 'idea_count', 'created_at'] as const;
export const TAGS_HEADERS = ['tag', 'description'] as const;
export const LOG_HEADERS = ['timestamp', 'message_id', 'level', 'event', 'detail'] as const;

export const SEED_TAGS: [string, string][] = [
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

/** Turn the row object into the flat array the Sheets API appends. */
export function ideaRowToValues(row: IdeaRow): string[] {
  return IDEAS_HEADERS.map((h) => row[h as keyof IdeaRow] ?? '');
}

// --- Auth -------------------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlString(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

/** Decode a PEM PKCS#8 private key (handles the literal "\n" of a shell-set secret). */
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
let memoToken: CachedToken | null = null;

/** Mint (or reuse) a Google access token. Cached in isolate memory and in KV. */
export async function getAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (memoToken && memoToken.expiresAt > now + 60) return memoToken.token;

  const cached = await env.DEDUPE.get('google:token', 'json').catch(() => null);
  if (cached && (cached as CachedToken).expiresAt > now + 60) {
    memoToken = cached as CachedToken;
    return memoToken.token;
  }

  const header = b64urlString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlString(
    JSON.stringify({
      iss: env.GOOGLE_SA_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(env.GOOGLE_SA_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const entry: CachedToken = {
    token: json.access_token,
    expiresAt: now + json.expires_in,
  };
  memoToken = entry;
  await env.DEDUPE.put('google:token', JSON.stringify(entry), {
    expirationTtl: Math.max(60, json.expires_in - 60),
  }).catch(() => undefined);

  return entry.token;
}

// --- REST helpers -----------------------------------------------------------

async function sheetsFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const token = await getAccessToken(env);
  const res = await fetch(`${API}/${env.SHEET_ID}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Sheets API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getValues(env: Env, range: string): Promise<string[][]> {
  const json = await sheetsFetch(env, `/values/${encodeURIComponent(range)}`);
  return (json.values as string[][] | undefined) ?? [];
}

export async function appendValues(env: Env, range: string, values: string[][]): Promise<void> {
  await sheetsFetch(
    env,
    `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values }) },
  );
}

export async function updateValues(env: Env, range: string, values: string[][]): Promise<void> {
  await sheetsFetch(env, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  });
}

// --- Domain operations ------------------------------------------------------

export async function appendIdea(env: Env, row: IdeaRow): Promise<void> {
  await appendValues(env, 'Ideas!A:Z', [ideaRowToValues(row)]);
}

export interface Theme {
  theme: string;
  description: string;
  idea_count: number;
}

export async function getThemes(env: Env): Promise<Theme[]> {
  const rows = await getValues(env, 'Themes!A2:D');
  return rows
    .filter((r) => (r[0] ?? '').trim() !== '')
    .map((r) => ({
      theme: r[0].trim(),
      description: r[1] ?? '',
      idea_count: Number(r[2] ?? 0) || 0,
    }));
}

export async function getTagVocab(env: Env): Promise<string[]> {
  const rows = await getValues(env, 'Tags!A2:B');
  return rows.map((r) => (r[0] ?? '').trim()).filter(Boolean);
}

/** Last N idea ids + titles, newest last — used for duplicate detection. */
export async function getRecentIdeas(
  env: Env,
  limit = 50,
): Promise<{ id: string; title: string }[]> {
  const rows = await getValues(env, 'Ideas!A2:G');
  const ideas = rows
    .filter((r) => (r[0] ?? '').trim() !== '')
    .map((r) => ({ id: r[0].trim(), title: r[6] ?? '' }));
  return ideas.slice(-limit);
}

/** Append a new theme, or bump idea_count on the existing one. */
export async function upsertTheme(
  env: Env,
  name: string,
  description: string,
): Promise<void> {
  const rows = await getValues(env, 'Themes!A2:D');
  const index = rows.findIndex(
    (r) => (r[0] ?? '').trim().toLowerCase() === name.trim().toLowerCase(),
  );

  if (index === -1) {
    await appendValues(env, 'Themes!A:D', [
      [name, description, '1', new Date().toISOString()],
    ]);
    return;
  }

  const rowNumber = index + 2; // +1 for the header, +1 for 1-based rows
  const current = Number(rows[index][2] ?? 0) || 0;
  await updateValues(env, `Themes!C${rowNumber}`, [[String(current + 1)]]);
}

export async function log(
  env: Env,
  messageId: string,
  level: 'info' | 'error',
  event: string,
  detail: string,
): Promise<void> {
  try {
    await appendValues(env, 'Log!A:E', [
      [new Date().toISOString(), messageId, level, event, detail.slice(0, 2000)],
    ]);
  } catch (err) {
    // Logging must never break the pipeline.
    console.error('log append failed', err);
  }
}
