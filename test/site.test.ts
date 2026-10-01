import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { candidateSlots, overlaps, SLOT_TIMES, zonedToUtc } from '../site/booking';
import worker, { notesRedirect, parseSubmission, type SiteEnv } from '../site/worker';

const ORIGIN = 'https://notes.nathancurtis.space';

describe('notetaker redirects', () => {
  it.each(['/inbox', '/inbox/item/x', '/api/items', '/capture', '/webhook', '/health'])('%s → notes', (p) => {
    const r = notesRedirect(new URL(`https://nathancurtis.space${p}?a=1`), ORIGIN)!;
    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe(`${ORIGIN}${p}?a=1`);
  });
  it('leaves site routes alone', () => {
    for (const p of ['/', '/guide', '/inbox-tips', '/forms/newsletter']) {
      expect(notesRedirect(new URL(`https://nathancurtis.space${p}`), ORIGIN)).toBeNull();
    }
  });
});

describe('parseSubmission', () => {
  it('validates email and name', () => {
    expect(parseSubmission('newsletter', { name: 'A', email: 'nope' }).ok).toBe(false);
    expect(parseSubmission('consultation', { name: '', email: 'a@b.co' }).ok).toBe(false);
  });
  it('allows an email-only newsletter signup', () => {
    expect(parseSubmission('newsletter', { email: 'a@b.co', source: 'popup' })).toMatchObject({ ok: true, name: '', data: { source: 'popup' } });
  });
  it('keeps the requested call slot and time drains', () => {
    const p = parseSubmission('consultation', { name: 'A', email: 'a@b.co', slot: '2026-10-02T17:30', slot_label: 'Fri, Oct 2 · 5:30 PM', drains: ['Messages'] });
    expect(p).toMatchObject({ ok: true, data: { slot: '2026-10-02T17:30', slot_label: 'Fri, Oct 2 · 5:30 PM', drains: ['Messages'] } });
  });
  it('normalises newsletter fields', () => {
    const p = parseSubmission('newsletter', { name: ' Jo ', email: 'JO@X.CO', interests: ['Cars', 5], stage: 'Ready to buy' });
    expect(p).toMatchObject({ ok: true, name: 'Jo', email: 'jo@x.co', data: { interests: ['Cars'], stage: 'Ready to buy' } });
  });
  it('rejects a bad consultation website', () => {
    expect(parseSubmission('consultation', { name: 'A', email: 'a@b.co', website: 'javascript:1' }).ok).toBe(false);
  });
});

describe('form endpoint', () => {
  it('stores a submission', async () => {
    const calls: unknown[][] = [];
    const env = {
      NOTES_ORIGIN: ORIGIN,
      ASSETS: { fetch: async () => new Response('asset') },
      DB: { prepare: () => ({ bind: (...a: unknown[]) => ({ run: async () => void calls.push(a) }) }) },
    } as unknown as SiteEnv;
    const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
    const req = new Request('https://nathancurtis.space/forms/newsletter', {
      method: 'POST', body: JSON.stringify({ name: 'Jo', email: 'jo@x.co' }),
    });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    expect(calls[0].slice(1, 4)).toEqual(['newsletter', 'jo@x.co', 'Jo']);
    const bad = await worker.fetch(new Request('https://nathancurtis.space/forms/newsletter', {
      method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}',
    }), env, ctx);
    expect(bad.status).toBe(403);
  });
});

describe('booking slots', () => {
  const tz = 'America/Denver';
  it('converts Denver wall time to UTC across DST', () => {
    expect(new Date(zonedToUtc(2026, 10, 2, 17, 30, tz)).toISOString()).toBe('2026-10-02T23:30:00.000Z'); // MDT
    expect(new Date(zonedToUtc(2026, 12, 2, 17, 30, tz)).toISOString()).toBe('2026-12-03T00:30:00.000Z'); // MST
  });
  it('offers 10 days from tomorrow, no Sundays', () => {
    const now = Date.parse('2026-10-01T18:00:00Z'); // Thu noon in Denver
    const s = candidateSlots(now, tz);
    expect(s).toHaveLength(10 * SLOT_TIMES.length);
    expect(new Date(s[0]).toISOString()).toBe('2026-10-02T13:00:00.000Z'); // Fri 7:00 AM
    const days = s.map((t) => new Date(t - 6 * 3600_000).getUTCDay());
    expect(days).not.toContain(0);
  });
  it('detects overlap with busy blocks', () => {
    const start = Date.parse('2026-10-02T23:30:00Z');
    expect(overlaps(start, [{ start: start + 29 * 60_000, end: start + 3600_000 }])).toBe(true);
    expect(overlaps(start, [{ start: start + 30 * 60_000, end: start + 3600_000 }])).toBe(false);
  });
});

describe('booking + fan-out', () => {
  const fetches: { url: string; body: any; headers: any }[] = [];
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    fetches.length = 0;
    globalThis.fetch = (async (u: any, init: any) => {
      fetches.push({ url: String(u), body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const mkEnv = (rows: { data: string }[] = []) => {
    const waits: Promise<unknown>[] = [];
    const env = {
      NOTES_ORIGIN: ORIGIN, OWNER_TZ: 'America/Denver',
      BEEHIIV_API_KEY: 'bk', BEEHIIV_PUBLICATION_ID: 'pub_1',
      QUO_API_KEY: 'qk', QUO_FROM: '+13853000774', NOTIFY_PHONE: '+15550001111',
      ASSETS: { fetch: async () => new Response('asset') },
      DB: { prepare: () => ({ bind: () => ({ run: async () => {}, all: async () => ({ results: rows }) }) }) },
    } as unknown as SiteEnv;
    const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) } as unknown as ExecutionContext;
    return { env, ctx, waits };
  };
  const post = (kind: string, body: unknown) =>
    new Request(`https://nathancurtis.space/forms/${kind}`, { method: 'POST', body: JSON.stringify(body) });

  it('adds newsletter signups to Beehiiv', async () => {
    const { env, ctx, waits } = mkEnv();
    expect((await worker.fetch(post('newsletter', { email: 'a@b.co', source: 'hero' }), env, ctx)).status).toBe(200);
    await Promise.all(waits);
    const b = fetches.find((f) => f.url.includes('beehiiv'))!;
    expect(b.url).toBe('https://api.beehiiv.com/v2/publications/pub_1/subscriptions');
    expect(b.body).toMatchObject({ email: 'a@b.co', utm_medium: 'hero' });
  });

  it('lists open slots minus site bookings, and texts a new booking', async () => {
    const { env, ctx, waits } = mkEnv();
    const res = await worker.fetch(new Request('https://nathancurtis.space/book/slots'), env, ctx);
    const { slots } = (await res.json()) as { slots: string[] };
    expect(slots.length).toBeGreaterThan(0);

    const ok = await worker.fetch(post('consultation', { name: 'Jo', email: 'jo@x.co', slot: slots[0], drains: ['Messages'] }), env, ctx);
    expect(ok.status).toBe(200);
    await Promise.all(waits);
    const t = fetches.find((f) => f.url.includes('openphone'))!;
    expect(t.headers.authorization).toBe('qk');
    expect(t.body).toMatchObject({ from: '+13853000774', to: ['+15550001111'] });
    expect(t.body.content).toContain('New call booked: Jo');
    expect(t.body.content).toContain('Time drains: Messages');

    const taken = mkEnv([{ data: JSON.stringify({ slot: slots[0] }) }]);
    const again = await worker.fetch(post('consultation', { name: 'Al', email: 'al@x.co', slot: slots[0] }), taken.env, taken.ctx);
    expect(again.status).toBe(409);
    const after = (await (await worker.fetch(new Request('https://nathancurtis.space/book/slots'), taken.env, taken.ctx)).json()) as { slots: string[] };
    expect(after.slots).not.toContain(slots[0]);
  });

  it('rejects a slot that is not offered', async () => {
    const { env, ctx } = mkEnv();
    const r = await worker.fetch(post('consultation', { name: 'Jo', email: 'jo@x.co', slot: '2020-01-01T00:00:00.000Z' }), env, ctx);
    expect(r.status).toBe(409);
  });
});
