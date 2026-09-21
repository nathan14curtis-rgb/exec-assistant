import { describe, expect, it } from 'vitest';
import { parseItemFilter, parseItemPatch } from '../src/api';
import { decideCapture } from '../src/capture';
import { checkBearer, verifyAccessJwt, resetJwksCache } from '../src/auth';
import { buildDeepgramUrl, parseKeyterms, DEFAULT_KEYTERMS } from '../src/transcribe/deepgram';

describe('parseItemPatch', () => {
  it('splits item and content fields and ignores unknown keys', () => {
    const p = parseItemPatch({
      status: 'done',
      area: 'hafens',
      evil: 'x',
      content: { stage: 'drafted', titles_draft: 'A | B', evil: 'y' },
    });
    expect(p.item).toEqual({ status: 'done', area: 'hafens' });
    expect(p.content).toEqual({ stage: 'drafted', titles_draft: 'A | B' });
  });

  it('rejects bad enums and empty patches', () => {
    expect(() => parseItemPatch({ status: 'maybe' })).toThrow(/status must be/);
    expect(() => parseItemPatch({ bucket: 'grocery' })).toThrow(/bucket must be/);
    expect(() => parseItemPatch({ content: { stage: 'shipped' } })).toThrow(/stage must be/);
    expect(() => parseItemPatch({})).toThrow(/nothing to update/);
    expect(() => parseItemPatch({ title: 42 })).toThrow(/must be a string/);
  });
});

describe('parseItemFilter', () => {
  it('reads valid filters and rejects bad ones', () => {
    const f = parseItemFilter(new URLSearchParams('bucket=content_idea&stage=enriched&limit=10'));
    expect(f).toEqual({ bucket: 'content_idea', stage: 'enriched', limit: 10 });
    expect(() => parseItemFilter(new URLSearchParams('bucket=nope'))).toThrow(/bad bucket/);
  });
});

describe('decideCapture', () => {
  const now = new Date('2026-09-18T12:00:00Z');

  it('accepts text-only and media-only bodies', () => {
    const t = decideCapture({ text: ' hello ' }, now);
    expect(t.ok && t.job.text).toBe('hello');
    expect(t.ok && t.job.channel).toBe('api');
    expect(t.ok && t.job.notify).toBe(false);
    const m = decideCapture({ media_url: 'https://x/y.m4a', source_id: 'abc', notify: true }, now);
    expect(m.ok && m.job.sourceId).toBe('abc');
    expect(m.ok && m.job.notify).toBe(true);
  });

  it('rejects empty bodies and non-https media', () => {
    expect(decideCapture({})).toMatchObject({ ok: false, status: 400 });
    expect(decideCapture({ media_url: 'http://x' })).toMatchObject({ ok: false });
    expect(decideCapture('nope')).toMatchObject({ ok: false });
  });

  it('generates a source id when none is given', () => {
    const d = decideCapture({ text: 'x' }, now);
    expect(d.ok && d.job.sourceId).toMatch(/^api-\d+-[0-9a-f]{8}$/);
  });
});

describe('checkBearer', () => {
  const env = { API_TOKEN: 'secret-token' };
  const req = (auth?: string) => new Request('https://x/api', { headers: auth ? { authorization: auth } : {} });

  it('accepts the exact token and nothing else', () => {
    expect(checkBearer(req('Bearer secret-token'), env)).toBe(true);
    expect(checkBearer(req('bearer secret-token'), env)).toBe(true);
    expect(checkBearer(req('Bearer wrong'), env)).toBe(false);
    expect(checkBearer(req(), env)).toBe(false);
    expect(checkBearer(req('Bearer secret-token'), { API_TOKEN: undefined })).toBe(false);
  });
});

describe('verifyAccessJwt', () => {
  const env = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud-1' };

  function b64url(obj: unknown): string {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
  }

  async function makeToken(overrides: Record<string, unknown> = {}) {
    const pair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
    const header = b64url({ alg: 'RS256', kid: 'k1' });
    const payload = b64url({
      aud: ['aud-1'],
      iss: 'https://team.cloudflareaccess.com',
      exp: Math.floor(Date.now() / 1000) + 600,
      email: 'nathan@example.com',
      ...overrides,
    });
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      pair.privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    const token = `${header}.${payload}.${Buffer.from(sig).toString('base64url')}`;
    const fetcher = (async () =>
      new Response(JSON.stringify({ keys: [{ kid: 'k1', kty: 'RSA', n: jwk.n, e: jwk.e }] }))) as unknown as typeof fetch;
    return { token, fetcher };
  }

  it('accepts a valid token and returns the email', async () => {
    resetJwksCache();
    const { token, fetcher } = await makeToken();
    expect(await verifyAccessJwt(token, env, fetcher)).toBe('nathan@example.com');
  });

  it('rejects wrong audience, expiry, and tampering', async () => {
    resetJwksCache();
    const wrongAud = await makeToken({ aud: ['other'] });
    expect(await verifyAccessJwt(wrongAud.token, env, wrongAud.fetcher)).toBeNull();

    resetJwksCache();
    const expired = await makeToken({ exp: Math.floor(Date.now() / 1000) - 5 });
    expect(await verifyAccessJwt(expired.token, env, expired.fetcher)).toBeNull();

    resetJwksCache();
    const { token, fetcher } = await makeToken();
    const [h, p, s] = token.split('.');
    const tampered = `${h}.${b64url({ aud: ['aud-1'], iss: 'https://team.cloudflareaccess.com', exp: 9999999999, email: 'evil@x' })}.${s}`;
    expect(await verifyAccessJwt(tampered, env, fetcher)).toBeNull();
    expect(p).toBeTruthy();
  });

  it('refuses when Access is not configured', async () => {
    const { token, fetcher } = await makeToken();
    expect(await verifyAccessJwt(token, { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' }, fetcher)).toBeNull();
  });
});

describe('deepgram', () => {
  it('uses nova-3 with one keyterm param per phrase', () => {
    const url = new URL(buildDeepgramUrl(['Lockii', "Hafen's Garage"]));
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('smart_format')).toBe('true');
    expect(url.searchParams.getAll('keyterm')).toEqual(['Lockii', "Hafen's Garage"]);
  });

  it('falls back to the default vocabulary and dedupes overrides', () => {
    expect(parseKeyterms(undefined)).toEqual(DEFAULT_KEYTERMS);
    expect(parseKeyterms('  ')).toEqual(DEFAULT_KEYTERMS);
    expect(parseKeyterms('a, b ,a,,')).toEqual(['a', 'b']);
  });
});
