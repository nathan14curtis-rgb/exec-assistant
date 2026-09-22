import { describe, expect, it, beforeEach } from 'vitest';
import { esc, html, query, raw } from '../src/dashboard/html';
import { formatDue, relativeTime, wordCount, dueInputValue } from '../src/dashboard/view';
import { splitBody, titleFrom } from '../src/dashboard/actions';
import { matchesFilters } from '../src/dashboard/index';
import { BUCKETS, BUCKET_ORDER } from '../src/dashboard/design';
import { BUCKETS as BUCKET_NAMES } from '../src/types';
import type { ItemWithContent } from '../src/types';

describe('html escaping', () => {
  it('escapes interpolations, including in attributes', () => {
    const evil = '"><script>alert(1)</script>';
    const out = html`<a href="${evil}">${evil}</a>`.value;
    expect(out).not.toContain('<script>');
    expect(out).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('leaves raw() and nested html alone', () => {
    expect(html`${raw('<b>x</b>')}`.value).toBe('<b>x</b>');
    expect(html`${html`<i>y</i>`}`.value).toBe('<i>y</i>');
  });

  it('renders arrays and skips nullish', () => {
    expect(html`${[1, 2]}${null}${undefined}${false}`.value).toBe('12');
  });

  it('escapes ampersands so query strings are valid in attributes', () => {
    expect(esc('a&b')).toBe('a&amp;b');
    expect(html`<a href="/x${query({ bucket: 'todo', status: 'open' })}">`.value)
      .toContain('href="/x?bucket=todo&amp;status=open"');
  });
});

describe('query', () => {
  it('drops empty values and returns "" when nothing is set', () => {
    expect(query({ a: '1', b: undefined, c: '' })).toBe('?a=1');
    expect(query({ a: undefined })).toBe('');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-09-21T18:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('reads the way the capture headers do', () => {
    expect(relativeTime(ago(30_000), now, 'UTC')).toBe('just now');
    expect(relativeTime(ago(2 * 60_000), now, 'UTC')).toBe('2 min ago');
    expect(relativeTime(ago(90 * 60_000), now, 'UTC')).toBe('1 hr ago');
    expect(relativeTime(ago(26 * 3600_000), now, 'UTC')).toBe('yesterday');
    expect(relativeTime(ago(3 * 24 * 3600_000), now, 'UTC')).toBe('3 days ago');
    expect(relativeTime(ago(30 * 24 * 3600_000), now, 'UTC')).toMatch(/Aug/);
  });

  it('survives a bad timestamp and an unknown zone', () => {
    expect(relativeTime('not a date', now, 'UTC')).toBe('');
    expect(relativeTime(ago(30 * 24 * 3600_000), now, 'Not/AZone')).toMatch(/Aug/);
  });
});

describe('formatDue', () => {
  const now = new Date('2026-09-21T18:00:00Z');
  const inMs = (ms: number) => new Date(now.getTime() + ms).toISOString();

  it('says overdue, today, tomorrow, then a weekday', () => {
    expect(formatDue('', now, 'UTC')).toBe('');
    expect(formatDue(inMs(-3600_000), now, 'UTC')).toBe('overdue');
    expect(formatDue(inMs(3600_000), now, 'UTC')).toBe('due today');
    expect(formatDue(inMs(30 * 3600_000), now, 'UTC')).toBe('due tomorrow');
    expect(formatDue(inMs(4 * 24 * 3600_000), now, 'UTC')).toMatch(/^due [a-z]{3}$/);
  });
});

describe('wordCount / dueInputValue', () => {
  it('counts words and formats a date input', () => {
    expect(wordCount('  one   two three ')).toBe(3);
    expect(wordCount('   ')).toBe(0);
    expect(dueInputValue('2026-09-25T12:00:00.000Z')).toBe('2026-09-25');
    expect(dueInputValue('')).toBe('');
    expect(dueInputValue('nonsense')).toBe('');
  });
});

describe('splitBody', () => {
  const body = 'First thought here. Second thought starts now.';

  it('splits at an offset and trims both halves', () => {
    const at = body.indexOf('Second');
    expect(splitBody(body, at)).toEqual({
      first: 'First thought here.',
      second: 'Second thought starts now.',
    });
  });

  it('refuses a split that would leave a half empty', () => {
    expect(splitBody(body, 0)).toBeNull();
    expect(splitBody(body, body.length)).toBeNull();
    expect(splitBody(body, 999)).toBeNull();
    expect(splitBody('   ', 1)).toBeNull();
  });
});

describe('titleFrom', () => {
  it('takes the first sentence, and truncates a long one', () => {
    expect(titleFrom('Call Marcus about the lift. Then the other thing.')).toBe('Call Marcus about the lift');
    expect(titleFrom('   ')).toBe('Untitled');
    const long = 'x'.repeat(200);
    const t = titleFrom(long);
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('matchesFilters', () => {
  const item = (o: Partial<ItemWithContent>) =>
    ({ bucket: 'todo', status: 'open', content: null, ...o }) as ItemWithContent;

  it('matches on bucket, status and stage', () => {
    expect(matchesFilters(item({}), {})).toBe(true);
    expect(matchesFilters(item({}), { bucket: 'todo' })).toBe(true);
    expect(matchesFilters(item({}), { bucket: 'journal' })).toBe(false);
    expect(matchesFilters(item({ status: 'done' }), { status: 'open' })).toBe(false);
    expect(matchesFilters(item({ content: { stage: 'drafted' } as never }), { stage: 'drafted' })).toBe(true);
    expect(matchesFilters(item({}), { stage: 'drafted' })).toBe(false);
  });
});

describe('the bucket system', () => {
  it('covers every bucket exactly once, with a distinct glyph', () => {
    expect(BUCKET_ORDER.slice().sort()).toEqual(BUCKET_NAMES.slice().sort());
    const glyphs = BUCKET_ORDER.map((b) => BUCKETS[b].g1);
    expect(new Set(glyphs).size).toBe(BUCKET_ORDER.length);
    const hues = BUCKET_ORDER.map((b) => BUCKETS[b].hue);
    expect(new Set(hues).size).toBe(BUCKET_ORDER.length);
  });

  it('distinguishes buckets without hue — fill differs as well as shape', () => {
    const filled = BUCKET_ORDER.filter((b) => BUCKETS[b].g1Fill);
    expect(filled.length).toBeGreaterThan(0);
    expect(filled.length).toBeLessThan(BUCKET_ORDER.length);
  });
});

// --- the routes, against an in-memory store ---------------------------------

import { resetStore } from '../src/store';
import { makeTestEnv, get, post, type TestEnv } from './helpers/fake-env';
import worker from '../src/index';

describe('dashboard routes', () => {
  let env: TestEnv;

  beforeEach(() => {
    resetStore();
    env = makeTestEnv();
  });

  it('refuses everything without a session', async () => {
    const res = await get(env, '/inbox');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Text me a code');
  });

  it('401s instead of offering a token box when Access is configured', async () => {
    env.vars.ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
    env.vars.ACCESS_AUD = 'aud';
    const res = await get(env, '/inbox');
    expect(res.status).toBe(401);
  });

  it('still lets a machine through on the bearer token', async () => {
    const res = await worker.fetch(
      new Request('https://x/api/items', { headers: { authorization: 'Bearer test-token' } }),
      env.env,
    );
    expect(res.status).toBe(200);
  });

  it('renders captures, items and the transcript', async () => {
    const res = await get(env, '/inbox', { auth: true });
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('The 90-second garage teardown format');
    expect(body).toContain('Call Marcus about the lift install quote');
    expect(body).toContain('Transcribing and sorting');
    expect(body).toContain('Sorting failed');
    // the three-item capture is braced, the single-item one is not
    expect(body).toContain('class="items braced"');
    expect(body).toContain('class="items single"');
  });

  it('moves an item to another bucket and redirects back with the filter kept', async () => {
    const res = await post(env, '/inbox/item/ITM-B2/bucket?bucket=todo', { bucket: 'journal' }, { auth: true });
    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('bucket=todo');
    expect(loc).toContain('item=ITM-B2');
    expect(loc).toContain('#i-ITM-B2');
    expect((await env.store.getItem('ITM-B2'))?.bucket).toBe('journal');
  });

  it('rejects an unknown bucket', async () => {
    const res = await post(env, '/inbox/item/ITM-B2/bucket', { bucket: 'groceries' }, { auth: true });
    expect(res.status).toBe(400);
    expect((await env.store.getItem('ITM-B2'))?.bucket).toBe('todo');
  });

  it('toggles done and back', async () => {
    await post(env, '/inbox/item/ITM-B2/status', { status: 'done' }, { auth: true });
    expect((await env.store.getItem('ITM-B2'))?.status).toBe('done');
    await post(env, '/inbox/item/ITM-B2/status', { status: 'open' }, { auth: true });
    expect((await env.store.getItem('ITM-B2'))?.status).toBe('open');
  });

  it('edits title and body, and refuses an empty title', async () => {
    await post(env, '/inbox/item/ITM-B2/edit', { title: 'Call Marcus back', body: 'new body' }, { auth: true });
    const item = await env.store.getItem('ITM-B2');
    expect(item?.title).toBe('Call Marcus back');
    expect(item?.body).toBe('new body');

    const bad = await post(env, '/inbox/item/ITM-B2/edit', { title: '  ', body: 'x' }, { auth: true });
    expect(bad.status).toBe(400);
  });

  it('sets area and due date, and rejects an unknown area', async () => {
    await post(env, '/inbox/item/ITM-B2/meta', { area: 'lockii', due: '2026-10-02' }, { auth: true });
    const item = await env.store.getItem('ITM-B2');
    expect(item?.area).toBe('lockii');
    expect(item?.due_at.slice(0, 10)).toBe('2026-10-02');

    const bad = await post(env, '/inbox/item/ITM-B2/meta', { area: 'mars' }, { auth: true });
    expect(bad.status).toBe(400);
  });

  it('adds a to-do by hand: its own capture, one item, no model call', async () => {
    const res = await post(
      env, '/inbox/add',
      { title: 'Order shop towels', body: 'the blue ones', area: 'hafens', due: '2026-09-25' },
      { auth: true },
    );
    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    const id = /item=(ITM-[A-Z0-9-]+)/.exec(location)?.[1];
    expect(id).toBeTruthy();

    const item = await env.store.getItem(id as string);
    expect(item).toMatchObject({
      bucket: 'todo', title: 'Order shop towels', body: 'the blue ones', area: 'hafens',
      due_at: '2026-09-25T12:00:00.000Z', status: 'open',
    });
    expect(JSON.parse(item!.data)).toEqual({ manual: true });

    const capture = await env.store.getCapture(item!.capture_id);
    expect(capture).toMatchObject({ channel: 'api', input_kind: 'text', status: 'processed', item_count: 1 });
    expect(capture!.source_id.startsWith('manual-')).toBe(true);
    expect(env.queue).toHaveLength(0);
  });

  it('refuses a to-do with no title and ignores an unknown area', async () => {
    expect((await post(env, '/inbox/add', { title: '   ' }, { auth: true })).status).toBe(400);
    const res = await post(env, '/inbox/add', { title: 'x', area: 'garage' }, { auth: true });
    expect(res.status).toBe(303);
    const id = /item=(ITM-[A-Z0-9-]+)/.exec(res.headers.get('location') ?? '')?.[1];
    expect((await env.store.getItem(id as string))!.area).toBe('');
  });

  it('shows the add-a-to-do form on the inbox', async () => {
    const body = await (await get(env, '/inbox', { auth: true })).text();
    expect(body).toContain('action="/inbox/add"');
    expect(body).toContain('Add a to-do');
  });

  it('splits an item into two on the same capture', async () => {
    const before = await env.store.getItem('ITM-B2');
    const at = before!.body.indexOf('Ask whether');
    const res = await post(env, '/inbox/item/ITM-B2/split', { at: String(at) }, { auth: true });
    expect(res.status).toBe(303);

    const items = await env.store.listItems({ capture_id: 'CAP-B', limit: 50 });
    expect(items).toHaveLength(4);
    const created = items.find((i) => i.related_item_id === 'ITM-B2');
    expect(created?.bucket).toBe('todo');
    expect(created?.body.startsWith('Ask whether')).toBe(true);
    expect(created?.content).toBeNull();
    expect((await env.store.getItem('ITM-B2'))?.body).not.toContain('Ask whether');
    expect((await env.store.getCapture('CAP-B'))?.item_count).toBe(4);
  });

  it('refuses a split that empties a half', async () => {
    const res = await post(env, '/inbox/item/ITM-B2/split', { at: '0' }, { auth: true });
    expect(res.status).toBe(400);
    expect(await env.store.listItems({ capture_id: 'CAP-B', limit: 50 })).toHaveLength(3);
  });

  it('deletes an item and keeps the capture count right', async () => {
    const res = await post(env, '/inbox/item/ITM-B3/delete', {}, { auth: true });
    expect(res.status).toBe(303);
    expect(await env.store.getItem('ITM-B3')).toBeNull();
    expect((await env.store.getCapture('CAP-B'))?.item_count).toBe(2);
  });

  it('re-runs a capture: items dropped, status reset, job queued without media', async () => {
    const res = await post(env, '/inbox/capture/CAP-B/rerun', {}, { auth: true });
    expect(res.status).toBe(303);
    expect(await env.store.listItems({ capture_id: 'CAP-B', limit: 50 })).toHaveLength(0);

    const capture = await env.store.getCapture('CAP-B');
    expect(capture?.status).toBe('processing');
    expect(capture?.item_count).toBe(0);
    // the transcript survives, so the consumer re-sorts rather than re-transcribes
    expect(capture?.transcript_raw).not.toBe('');

    expect(env.queue).toHaveLength(1);
    expect(env.queue[0]).toMatchObject({ channel: 'sendblue', sourceId: 'src-b', mediaUrl: null, notify: false });
  });

  it('keeps a failed capture as a journal note', async () => {
    const res = await post(env, '/inbox/capture/CAP-D/keep', {}, { auth: true });
    expect(res.status).toBe(303);
    const items = await env.store.listItems({ capture_id: 'CAP-D', limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0].bucket).toBe('journal');
    expect(items[0].body).toContain('bead breaker');
    expect((await env.store.getCapture('CAP-D'))?.status).toBe('processed');
  });

  it('serves archived audio and 404s when it is gone', async () => {
    const ok = await get(env, '/inbox/capture/CAP-B/audio', { auth: true });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('audio');

    const missing = await get(env, '/inbox/capture/CAP-C/audio', { auth: true });
    expect(missing.status).toBe(404);
  });

  it('filters by bucket, and says so when nothing matches', async () => {
    const todo = await get(env, '/inbox?bucket=todo', { auth: true });
    const body = await todo.text();
    expect(body).toContain('Call Marcus');
    expect(body).not.toContain('The 90-second garage teardown format');

    const none = await get(env, '/inbox?bucket=roadmap', { auth: true });
    expect(await none.text()).toContain('Nothing matches');
  });

  it('rejects a GET on an action route', async () => {
    const res = await get(env, '/inbox/item/ITM-B2/delete', { auth: true });
    expect(res.status).toBe(405);
  });
});
