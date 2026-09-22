import type { Env } from '../types';
import { sendSms } from '../sendblue';

/**
 * One-time codes over SMS for the dashboard login.
 *
 * The code is sent to a single fixed number, so there is no phone field to
 * enumerate and no way to redirect a code elsewhere. What is stored in KV is
 * a hash of the code, never the code, so read access to the namespace does
 * not let anyone log in. A successful check mints a random session id; the
 * cookie never carries a long-lived secret.
 */

const CODE_KEY = 'otp:code';
const SENDS_KEY = 'otp:sends';
const SESSION_PREFIX = 'sess:';

export const CODE_TTL_SECONDS = 10 * 60;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Wrong guesses allowed before the code is burned. */
export const MAX_ATTEMPTS = 5;
/** Codes that may be requested per window, so the line can't be flooded. */
export const MAX_SENDS = 5;
export const SEND_WINDOW_SECONDS = 60 * 60;

export interface StoredCode {
  hash: string;
  attempts: number;
  expiresAt: number;
}

/** Six digits, uniformly drawn. Leading zeros are kept. */
export function newCode(random: () => Uint32Array = () => crypto.getRandomValues(new Uint32Array(1))): string {
  // Reject the tail of the range so 0…999999 stays uniform.
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  let n = random()[0];
  while (n >= limit) n = random()[0];
  return String(n % 1_000_000).padStart(6, '0');
}

export async function hashCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`inbox-otp:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time hex compare, so a wrong guess leaks no timing signal. */
export function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Only the digits — people paste "123 456" or "code: 123456". */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6);
}

export function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export type RequestResult =
  | { ok: true }
  | { ok: false; reason: 'rate-limited' | 'not-configured' }
  | { ok: false; reason: 'send-failed'; detail: string };

/**
 * Mint a code, text it, and store its hash. Replaces any code still
 * outstanding, so only the newest one works.
 *
 * The text goes out *before* anything is written: a send the provider refuses
 * must not spend the hourly allowance or leave a code outstanding that nobody
 * ever received. The reverse order silently locked the account out after five
 * failed attempts.
 */
export async function requestCode(env: Env, now = Date.now()): Promise<RequestResult> {
  if (!env.OTP_PHONE) return { ok: false, reason: 'not-configured' };

  const sends = Number((await env.DEDUPE.get(SENDS_KEY)) ?? 0);
  if (sends >= MAX_SENDS) return { ok: false, reason: 'rate-limited' };

  const code = newCode();
  try {
    const sent = await sendSms(
      env,
      env.OTP_PHONE,
      `${formatCode(code)} is your inbox code. It expires in 10 minutes.`,
    );
    console.log(`otp sms accepted: status=${sent.status ?? 'unknown'} handle=${sent.message_handle ?? 'none'}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('otp sms failed:', detail);
    return { ok: false, reason: 'send-failed', detail };
  }

  const stored: StoredCode = {
    hash: await hashCode(code),
    attempts: 0,
    expiresAt: now + CODE_TTL_SECONDS * 1000,
  };
  await env.DEDUPE.put(CODE_KEY, JSON.stringify(stored), { expirationTtl: CODE_TTL_SECONDS });
  // The counter's TTL is only refreshed when the window starts, so the limit
  // is per hour rather than per hour-since-the-last-send.
  await env.DEDUPE.put(SENDS_KEY, String(sends + 1), {
    expirationTtl: sends === 0 ? SEND_WINDOW_SECONDS : undefined,
  });

  return { ok: true };
}

export type VerifyResult =
  | { ok: true; session: string }
  | { ok: false; reason: 'no-code' | 'expired' | 'too-many-attempts' | 'wrong' };

/** Check a code and, on success, mint a session id. */
export async function verifyCode(env: Env, input: string, now = Date.now()): Promise<VerifyResult> {
  const raw = await env.DEDUPE.get(CODE_KEY);
  if (!raw) return { ok: false, reason: 'no-code' };

  let stored: StoredCode;
  try {
    stored = JSON.parse(raw) as StoredCode;
  } catch {
    await env.DEDUPE.delete(CODE_KEY);
    return { ok: false, reason: 'no-code' };
  }

  if (stored.expiresAt <= now) {
    await env.DEDUPE.delete(CODE_KEY);
    return { ok: false, reason: 'expired' };
  }
  if (stored.attempts >= MAX_ATTEMPTS) {
    await env.DEDUPE.delete(CODE_KEY);
    return { ok: false, reason: 'too-many-attempts' };
  }

  const code = normalizeCode(input);
  if (code.length === 6 && equalHex(await hashCode(code), stored.hash)) {
    // Burn the code: one login per code, so a shoulder-surfed SMS is spent.
    await env.DEDUPE.delete(CODE_KEY);
    return { ok: true, session: await createSession(env) };
  }

  const attempts = stored.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await env.DEDUPE.delete(CODE_KEY);
    return { ok: false, reason: 'too-many-attempts' };
  }
  await env.DEDUPE.put(
    CODE_KEY,
    JSON.stringify({ ...stored, attempts }),
    { expirationTtl: Math.max(60, Math.ceil((stored.expiresAt - now) / 1000)) },
  );
  return { ok: false, reason: 'wrong' };
}

export async function createSession(env: Env): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DEDUPE.put(`${SESSION_PREFIX}${id}`, String(Date.now()), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return id;
}

export async function sessionValid(env: Env, id: string | null): Promise<boolean> {
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return false;
  return (await env.DEDUPE.get(`${SESSION_PREFIX}${id}`)) !== null;
}

export async function destroySession(env: Env, id: string | null): Promise<void> {
  if (id && /^[0-9a-f]{64}$/.test(id)) await env.DEDUPE.delete(`${SESSION_PREFIX}${id}`);
}
