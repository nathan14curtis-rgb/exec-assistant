import type { Bucket, ContentStage, Env, ItemStatus, ItemWithContent } from '../types';
import { BUCKETS as BUCKET_NAMES } from '../types';
import { authorize } from '../auth';
import { getStore } from '../store';
import { query } from './html';
import { renderCodeEntry, renderInbox, renderLogin, type InboxFilters } from './page';
import {
  destroySession,
  requestCode,
  sessionValid,
  verifyCode,
  SESSION_TTL_SECONDS,
} from './otp';
import type { ViewContext } from './view';
import {
  ActionError,
  deleteItem,
  editMeta,
  editText,
  keepAsNote,
  moveBucket,
  rerunCapture,
  setStatus,
  splitItem,
  type Redirect,
} from './actions';

const COOKIE = 'inbox_session';
const STAGES: ContentStage[] = ['enriched', 'drafted', 'picked', 'filmed', 'posted'];
const STATUSES: ItemStatus[] = ['open', 'done', 'dismissed'];

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Cloudflare Access, a machine bearer token, or a browser session earned by
 * entering a code texted to the configured phone.
 *
 * The cookie holds a random session id, not a reusable secret: a stolen
 * cookie can be revoked by deleting one KV key, and nothing in the browser
 * is worth replaying elsewhere.
 */
async function authorizeBrowser(request: Request, env: Env): Promise<boolean> {
  if (await authorize(request, env)) return true;
  return sessionValid(env, readCookie(request, COOKIE));
}

function sessionCookie(id: string): string {
  return `${COOKIE}=${id}; Path=/inbox; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

const CLEARED_COOKIE = `${COOKIE}=; Path=/inbox; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function parseFilters(url: URL): InboxFilters {
  const f: InboxFilters = {};
  const bucket = url.searchParams.get('bucket');
  const status = url.searchParams.get('status');
  const stage = url.searchParams.get('stage');
  if (bucket && BUCKET_NAMES.includes(bucket as Bucket)) f.bucket = bucket;
  if (status && STATUSES.includes(status as ItemStatus)) f.status = status;
  if (stage && STAGES.includes(stage as ContentStage)) f.stage = stage;
  return f;
}

/** Does this item pass the active filters? */
export function matchesFilters(item: ItemWithContent, f: InboxFilters): boolean {
  if (f.bucket && item.bucket !== f.bucket) return false;
  if (f.status && item.status !== f.status) return false;
  if (f.stage && item.content?.stage !== f.stage) return false;
  return true;
}

/** 303 back to the inbox, reopening whatever the action touched. */
function seeOther(url: URL, r: Redirect): Response {
  const f = parseFilters(url);
  const qs = query({
    bucket: f.bucket,
    status: f.status,
    stage: f.stage,
    item: r.itemId,
    capture: r.captureId,
    form: r.form,
  });
  const anchor = r.itemId ? `#i-${r.itemId}` : r.captureId ? `#c-${r.captureId}` : '';
  return new Response(null, { status: 303, headers: { location: `/inbox${qs}${anchor}`, 'cache-control': 'no-store' } });
}

async function renderPage(request: Request, env: Env, url: URL): Promise<Response> {
  const store = getStore(env);
  const filters = parseFilters(url);

  const captures = await store.listCaptures(60);
  const items = await store.listItemsForCaptures(captures.map((c) => c.id));

  const byCapture = new Map<string, ItemWithContent[]>();
  for (const item of items) {
    if (!matchesFilters(item, filters)) continue;
    const list = byCapture.get(item.capture_id);
    if (list) list.push(item);
    else byCapture.set(item.capture_id, [item]);
  }

  // A filtered view shows only captures with a surviving item; unfiltered, a
  // processing or failed capture has no items and must still be visible.
  const filtered = !!(filters.bucket || filters.status || filters.stage);
  const visible = captures.filter((c) =>
    filtered ? byCapture.has(c.id) : byCapture.has(c.id) || c.status !== 'processed',
  );

  const ctx: ViewContext = {
    now: new Date(),
    tz: env.USER_TZ || 'UTC',
    queryString: query({ bucket: filters.bucket, status: filters.status, stage: filters.stage }),
    openItem: url.searchParams.get('item') ?? undefined,
    openCapture: url.searchParams.get('capture') ?? undefined,
    openForm: url.searchParams.get('form') ?? undefined,
  };

  return renderInbox({
    captures: visible,
    itemsByCapture: byCapture,
    counts: await store.countItemsByBucket(),
    totalItems: [...byCapture.values()].reduce((n, l) => n + l.length, 0),
    filters,
    ctx,
  });
}

async function handleAudio(env: Env, captureId: string): Promise<Response> {
  const capture = await getStore(env).getCapture(captureId);
  if (!capture?.audio_r2_key) return new Response('not found', { status: 404 });
  const obj = await env.AUDIO.get(capture.audio_r2_key);
  if (!obj) return new Response('audio expired', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
      'content-length': String(obj.size),
    },
  });
}

export async function handleDashboard(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/inbox\/?/, '');

  // Sign-in is the only route reachable unauthenticated.
  if (path === 'login' || path.startsWith('login/')) {
    const step = path.slice('login'.length).replace(/^\//, '');

    if (step === 'send') {
      if (request.method !== 'POST') return renderLogin();
      const sent = await requestCode(env);
      if (sent.ok) return renderCodeEntry();
      if (sent.reason === 'send-failed') {
        // The provider's own words, so a failure is diagnosable from the page
        // rather than only from `wrangler tail`.
        return renderLogin(`Could not send the code. ${sent.detail}`);
      }
      return renderLogin(
        sent.reason === 'rate-limited'
          ? 'Too many codes requested. Try again in an hour.'
          : 'No phone number is configured for sign-in. Set OTP_PHONE and redeploy.',
      );
    }

    if (step === 'verify') {
      if (request.method !== 'POST') return renderLogin();
      const form = await request.formData();
      const result = await verifyCode(env, String(form.get('code') ?? ''));
      if (result.ok) {
        return new Response(null, {
          status: 303,
          headers: { location: '/inbox', 'set-cookie': sessionCookie(result.session) },
        });
      }
      if (result.reason === 'wrong') return renderCodeEntry('That code is not right.');
      return renderLogin(
        result.reason === 'expired'
          ? 'That code expired. Here is a fresh start.'
          : result.reason === 'too-many-attempts'
            ? 'Too many wrong guesses. Request a new code.'
            : 'No code outstanding. Request one.',
      );
    }

    return renderLogin();
  }

  if (path === 'logout' && request.method === 'POST') {
    await destroySession(env, readCookie(request, COOKIE));
    return new Response(null, { status: 303, headers: { location: '/inbox', 'set-cookie': CLEARED_COOKIE } });
  }

  if (!(await authorizeBrowser(request, env))) {
    // Access is configured but rejected the request: say so rather than
    // offering a token box that cannot help.
    if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) return new Response('unauthorized', { status: 401 });
    return renderLogin();
  }

  if (!path) {
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
    return renderPage(request, env, url);
  }

  const parts = path.split('/');
  const store = getStore(env);

  if (parts[0] === 'capture' && parts[2] === 'audio' && request.method === 'GET') {
    return handleAudio(env, parts[1]);
  }

  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

  try {
    const form = await request.formData();

    if (parts[0] === 'item' && parts[1]) {
      const id = parts[1];
      switch (parts[2]) {
        case 'bucket': return seeOther(url, await moveBucket(store, id, form));
        case 'status': return seeOther(url, await setStatus(store, id, form));
        case 'edit': return seeOther(url, await editText(store, id, form));
        case 'meta': return seeOther(url, await editMeta(store, id, form));
        case 'split': return seeOther(url, await splitItem(store, id, form));
        case 'delete': return seeOther(url, await deleteItem(store, id));
      }
    }

    if (parts[0] === 'capture' && parts[1]) {
      const id = parts[1];
      if (parts[2] === 'rerun') return seeOther(url, await rerunCapture(store, env, id));
      if (parts[2] === 'keep') return seeOther(url, await keepAsNote(store, id));
    }

    return new Response('not found', { status: 404 });
  } catch (err) {
    if (err instanceof ActionError) return new Response(err.message, { status: 400 });
    console.error('dashboard action failed', err);
    return new Response('something went wrong', { status: 500 });
  }
}
