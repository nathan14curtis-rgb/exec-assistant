import { describe, expect, it } from 'vitest';
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
