import { describe, expect, it, beforeEach } from 'vitest';
import {
  equalHex,
  formatCode,
  hashCode,
  newCode,
  normalizeCode,
  requestCode,
  sessionValid,
  verifyCode,
  CODE_TTL_SECONDS,
  MAX_ATTEMPTS,
  MAX_SENDS,
} from '../src/dashboard/otp';
import { resetStore } from '../src/store';
import { makeTestEnv, get, post, type TestEnv } from './helpers/fake-env';

/** Read the code out of the text the fake Sendblue captured. */
function codeFrom(t: TestEnv): string {
  const last = t.sms[t.sms.length - 1];
  return last.content.replace(/\D/g, '').slice(0, 6);
}

describe('code generation', () => {
  it('is always six digits, leading zeros kept', () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
    // a draw that lands on 0 must render as 000000, not "0"
    expect(newCode(() => new Uint32Array([0]))).toBe('000000');
    expect(newCode(() => new Uint32Array([42]))).toBe('000042');
  });

  it('rejects the non-uniform tail of the random range', () => {
    // the first draw is past the usable limit, so it must be discarded
    const draws = [4_294_000_000, 123_456].values();
    expect(newCode(() => new Uint32Array([draws.next().value as number]))).toBe('123456');
  });

  it('formats and normalizes the way people type', () => {
    expect(formatCode('123456')).toBe('123 456');
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('code: 123-456')).toBe('123456');
    expect(normalizeCode('12345678')).toBe('123456');
    expect(normalizeCode('abc')).toBe('');
  });
});

describe('hashing', () => {
  it('is stable, distinct per code, and compared in constant time', async () => {
    const a = await hashCode('123456');
    expect(a).toBe(await hashCode('123456'));
    expect(a).not.toBe(await hashCode('123457'));
    expect(a).toHaveLength(64);
    expect(equalHex(a, a)).toBe(true);
    expect(equalHex(a, await hashCode('123457'))).toBe(false);
    expect(equalHex(a, 'short')).toBe(false);
  });
});

describe('the code lifecycle', () => {
  let t: TestEnv;
  beforeEach(() => {
    resetStore();
    t = makeTestEnv();
  });

  it('texts a code to the configured number, and never stores the code itself', async () => {
    expect(await requestCode(t.env)).toEqual({ ok: true });
    expect(t.sms).toHaveLength(1);
    expect(t.sms[0].to).toBe('+14355036688');
    expect(t.sms[0].content).toMatch(/^\d{3} \d{3} is your inbox code/);

    const stored = String(t.kv.map.get('otp:code')?.value);
    expect(stored).not.toContain(codeFrom(t));
    expect(JSON.parse(stored).hash).toBe(await hashCode(codeFrom(t)));
  });

  it('accepts the right code once, then burns it', async () => {
    await requestCode(t.env);
    const code = codeFrom(t);

    const first = await verifyCode(t.env, code);
    expect(first.ok).toBe(true);
    expect(first.ok && first.session).toMatch(/^[0-9a-f]{64}$/);
    expect(await sessionValid(t.env, first.ok ? first.session : null)).toBe(true);

    // replaying the same SMS must not work
    expect(await verifyCode(t.env, code)).toEqual({ ok: false, reason: 'no-code' });
  });

  it('accepts a code the way a person pastes it', async () => {
    await requestCode(t.env);
    const code = codeFrom(t);
    expect((await verifyCode(t.env, `${code.slice(0, 3)} ${code.slice(3)}`)).ok).toBe(true);
  });

  it('burns the code after too many wrong guesses', async () => {
    await requestCode(t.env);
    const code = codeFrom(t);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(await verifyCode(t.env, wrong)).toEqual({ ok: false, reason: 'wrong' });
    }
    expect(await verifyCode(t.env, wrong)).toEqual({ ok: false, reason: 'too-many-attempts' });
    // the real code is dead too — brute force cannot be resumed
    expect(await verifyCode(t.env, code)).toEqual({ ok: false, reason: 'no-code' });
  });

  it('expires a code', async () => {
    await requestCode(t.env);
    const code = codeFrom(t);
    const later = Date.now() + (CODE_TTL_SECONDS + 1) * 1000;
    expect(await verifyCode(t.env, code, later)).toEqual({ ok: false, reason: 'expired' });
  });

  it('replaces an outstanding code, so only the newest works', async () => {
    await requestCode(t.env);
    const first = codeFrom(t);
    await requestCode(t.env);
    const second = codeFrom(t);
    expect(second).not.toBe(first);
    expect(await verifyCode(t.env, first)).toEqual({ ok: false, reason: 'wrong' });
    expect((await verifyCode(t.env, second)).ok).toBe(true);
  });

  it('rate-limits how many codes can be requested', async () => {
    for (let i = 0; i < MAX_SENDS; i++) expect(await requestCode(t.env)).toEqual({ ok: true });
    expect(await requestCode(t.env)).toEqual({ ok: false, reason: 'rate-limited' });
    expect(t.sms).toHaveLength(MAX_SENDS);
  });

  it('refuses to send when no number is configured', async () => {
    t.vars.OTP_PHONE = '';
    expect(await requestCode(t.env)).toEqual({ ok: false, reason: 'not-configured' });
    expect(t.sms).toHaveLength(0);
  });

  it('reports a send Sendblue refuses in the body of a 200', async () => {
    // The failure that made codes silently vanish: HTTP 200, status ERROR.
    t.sendblue.body = JSON.stringify({
      status: 'ERROR',
      error_code: 4001,
      error_message: 'from_number is not provisioned',
    });

    const result = await requestCode(t.env);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('send-failed');
    expect(result.ok === false && result.reason === 'send-failed' && result.detail)
      .toContain('from_number is not provisioned');
    expect(t.sms).toHaveLength(0);
  });

  it('reports an HTTP-level rejection too', async () => {
    t.sendblue.status = 401;
    t.sendblue.body = 'unauthorized';
    const result = await requestCode(t.env);
    expect(result.ok === false && result.reason).toBe('send-failed');
    expect(result.ok === false && result.reason === 'send-failed' && result.detail).toContain('401');
  });

  it('spends nothing when the send fails, so failures cannot lock the account out', async () => {
    t.sendblue.body = JSON.stringify({ status: 'ERROR', error_message: 'nope' });

    // Twice as many failures as the hourly limit allows.
    for (let i = 0; i < MAX_SENDS * 2; i++) {
      expect((await requestCode(t.env)).ok).toBe(false);
    }
    // No counter burned and no code left outstanding for a text nobody got.
    expect(t.kv.map.get('otp:sends')).toBeUndefined();
    expect(t.kv.map.get('otp:code')).toBeUndefined();

    // The moment the provider recovers, signing in works.
    t.sendblue.body = JSON.stringify({ status: 'QUEUED', message_handle: 'h' });
    expect(await requestCode(t.env)).toEqual({ ok: true });
    expect((await verifyCode(t.env, codeFrom(t))).ok).toBe(true);
  });

  it('rejects a forged or malformed session id', async () => {
    expect(await sessionValid(t.env, null)).toBe(false);
    expect(await sessionValid(t.env, 'nope')).toBe(false);
    expect(await sessionValid(t.env, 'f'.repeat(64))).toBe(false);
    expect(await sessionValid(t.env, '../../etc/passwd')).toBe(false);
  });
});

describe('the sign-in routes', () => {
  let t: TestEnv;
  beforeEach(() => {
    resetStore();
    t = makeTestEnv();
  });

  it('serves the favicon to a signed-out browser', async () => {
    const res = await get(t, '/inbox/icon.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');

    // real PNG bytes, not an error page rendered with a 200
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // small enough to belong in the worker bundle
    expect(bytes.byteLength).toBeLessThan(32 * 1024);
  });

  it('links the favicon from the sign-in page', async () => {
    const body = await (await get(t, '/inbox')).text();
    expect(body).toContain('<link rel="icon" type="image/png" href="/inbox/icon.png">');
  });

  it('shows the request screen, not a token box', async () => {
    const body = await (await get(t, '/inbox')).text();
    expect(body).toContain('Text me a code');
    expect(body).not.toContain('dashboard token');
  });

  it('walks request → enter → signed in, and sets a scoped cookie', async () => {
    const sent = await post(t, '/inbox/login/send', {});
    expect(await sent.text()).toContain('Enter your code');

    const res = await post(t, '/inbox/login/verify', { code: codeFrom(t) });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/inbox');

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/inbox_session=[0-9a-f]{64}/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/inbox');

    // that cookie really opens the inbox
    const id = /inbox_session=([0-9a-f]{64})/.exec(cookie)![1];
    const page = await worker(t, '/inbox', id);
    expect(await page.text()).toContain('Inbox');
  });

  it('re-prompts on a wrong code without revealing anything', async () => {
    await post(t, '/inbox/login/send', {});
    const res = await post(t, '/inbox/login/verify', { code: '000000' });
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('not right');
    expect(body).not.toContain(codeFrom(t));
  });

  it('shows why a send failed rather than a blank error page', async () => {
    t.sendblue.body = JSON.stringify({ status: 'ERROR', error_message: 'number is not a valid destination' });
    const res = await post(t, '/inbox/login/send', {});
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('Could not send the code');
    expect(body).toContain('number is not a valid destination');
    // and it must not pretend a code is waiting to be typed
    expect(body).not.toContain('Enter your code');
  });

  it('refuses a verify with no code outstanding', async () => {
    const res = await post(t, '/inbox/login/verify', { code: '123456' });
    expect(await res.text()).toContain('No code outstanding');
  });

  it('will not sign in on a GET', async () => {
    expect(await (await get(t, '/inbox/login/send')).text()).toContain('Text me a code');
    expect(await (await get(t, '/inbox/login/verify')).text()).toContain('Text me a code');
    expect(t.sms).toHaveLength(0);
  });

  it('signs out, and the cookie stops working', async () => {
    await post(t, '/inbox/login/send', {});
    const signedIn = await post(t, '/inbox/login/verify', { code: codeFrom(t) });
    const id = /inbox_session=([0-9a-f]{64})/.exec(signedIn.headers.get('set-cookie') ?? '')![1];

    const out = await worker(t, '/inbox/logout', id, 'POST');
    expect(out.status).toBe(303);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');

    expect(await (await worker(t, '/inbox', id)).text()).toContain('Text me a code');
  });
});

/** Request with an explicit session id. */
async function worker(t: TestEnv, path: string, session: string, method = 'GET'): Promise<Response> {
  const mod = (await import('../src/index')).default;
  return mod.fetch(
    new Request(`https://x${path}`, { method, headers: { cookie: `inbox_session=${session}` } }),
    t.env,
  );
}
