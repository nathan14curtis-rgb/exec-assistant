import type { Env } from './types';

/** Constant-time string compare so a secret can't be probed byte by byte. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type Principal = { kind: 'token' } | { kind: 'access'; email: string };

/** `Authorization: Bearer <API_TOKEN>` — for the Cowork task, Shortcuts, curl. */
export function checkBearer(request: Request, env: Pick<Env, 'API_TOKEN'>): boolean {
  if (!env.API_TOKEN) return false;
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(/\s+/, 2);
  return scheme?.toLowerCase() === 'bearer' && !!token && timingSafeEqual(token, env.API_TOKEN);
}

// --- Cloudflare Access JWT --------------------------------------------------

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

interface CachedKeys {
  keys: Jwk[];
  fetchedAt: number;
}
let jwksCache: CachedKeys | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

function b64urlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getJwks(teamDomain: string, fetcher: typeof fetch): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const json = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { keys: json.keys ?? [], fetchedAt: now };
  return jwksCache.keys;
}

/**
 * Verify the `Cf-Access-Jwt-Assertion` header Cloudflare Access adds after
 * the user logs in. Returns the email on success, null otherwise.
 */
export async function verifyAccessJwt(
  token: string,
  env: Pick<Env, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'>,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; exp?: number; iss?: string; email?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(env.ACCESS_AUD)) return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;

  const jwk = (await getJwks(env.ACCESS_TEAM_DOMAIN, fetcher)).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  return ok ? payload.email ?? '' : null;
}

/** Bearer token first (machine clients), then an Access-authenticated browser. */
export async function authorize(request: Request, env: Env): Promise<Principal | null> {
  if (checkBearer(request, env)) return { kind: 'token' };
  const jwt = request.headers.get('cf-access-jwt-assertion');
  if (jwt) {
    const email = await verifyAccessJwt(jwt, env);
    if (email !== null) return { kind: 'access', email };
  }
  return null;
}

/** Test hook. */
export function resetJwksCache(): void {
  jwksCache = null;
}
