import type { Env } from './types';

/**
 * Low-level Google Sheets access (service-account JWT + values REST calls).
 * Domain logic lives in store/mirror.ts; this file knows nothing about tabs.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

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
  if (!env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_PRIVATE_KEY) {
    throw new Error('GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY are not set');
  }
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
