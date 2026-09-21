import type { Bucket, ContentIdea, ContentStage, Env, Item, ItemStatus } from './types';
import { AREAS, BUCKETS } from './types';
import { authorize } from './auth';
import { getStore, type ItemFilter } from './store';

/**
 * JSON API behind Cloudflare Access (browser) or a bearer token (machines).
 * The drafting task reads content ideas by stage and writes the *_draft
 * columns back here instead of touching the Sheet.
 *
 *   GET   /api/captures?limit=50
 *   GET   /api/captures/:id            capture + its items
 *   GET   /api/captures/:id/audio      archived audio from R2
 *   GET   /api/items?bucket=&status=&stage=&limit=
 *   GET   /api/items/:id
 *   PATCH /api/items/:id               { title?, body?, status?, area?, due_at?, bucket?,
 *                                        related_item_id?, content?: { stage?, *_draft?, ... } }
 */

/** Caller error → 400. Anything else → 500. */
export class ValidationError extends Error {}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const STATUSES: ItemStatus[] = ['open', 'done', 'dismissed'];
const STAGES: ContentStage[] = ['enriched', 'drafted', 'picked', 'filmed', 'posted'];

const ITEM_PATCH_FIELDS = ['title', 'body', 'status', 'area', 'due_at', 'bucket', 'related_item_id'] as const;
const CONTENT_PATCH_FIELDS = [
  'stage', 'theme', 'tags', 'notes', 'cleaned_idea', 'titles_draft', 'hooks_draft',
  'clip_moments_draft', 'cta_deliverable_draft', 'picked_on', 'posted_url',
] as const;

export interface ParsedPatch {
  item: Partial<Item>;
  content: Partial<ContentIdea>;
}

/** Whitelist + validate a PATCH body. Throws a message suitable for a 400. */
export function parseItemPatch(body: unknown): ParsedPatch {
  if (typeof body !== 'object' || body === null) throw new ValidationError('body must be a JSON object');
  const b = body as Record<string, unknown>;
  const item: Partial<Item> = {};
  const content: Partial<ContentIdea> = {};

  for (const f of ITEM_PATCH_FIELDS) {
    const v = b[f];
    if (v === undefined) continue;
    if (typeof v !== 'string') throw new ValidationError(`${f} must be a string`);
    if (f === 'status' && !STATUSES.includes(v as ItemStatus)) throw new ValidationError(`status must be one of ${STATUSES.join(', ')}`);
    if (f === 'bucket' && !BUCKETS.includes(v as Bucket)) throw new ValidationError(`bucket must be one of ${BUCKETS.join(', ')}`);
    if (f === 'area' && v !== '' && !AREAS.includes(v as never)) throw new ValidationError(`area must be one of ${AREAS.join(', ')}`);
    (item as Record<string, unknown>)[f] = v.slice(0, 4000);
  }

  if (b.content !== undefined) {
    if (typeof b.content !== 'object' || b.content === null) throw new ValidationError('content must be an object');
    const c = b.content as Record<string, unknown>;
    for (const f of CONTENT_PATCH_FIELDS) {
      const v = c[f];
      if (v === undefined) continue;
      if (typeof v !== 'string') throw new ValidationError(`content.${f} must be a string`);
      if (f === 'stage' && !STAGES.includes(v as ContentStage)) throw new ValidationError(`content.stage must be one of ${STAGES.join(', ')}`);
      (content as Record<string, unknown>)[f] = v.slice(0, 8000);
    }
  }

  if (!Object.keys(item).length && !Object.keys(content).length) throw new ValidationError('nothing to update');
  return { item, content };
}

export function parseItemFilter(params: URLSearchParams): ItemFilter {
  const f: ItemFilter = {};
  const bucket = params.get('bucket');
  const status = params.get('status');
  const stage = params.get('stage');
  const limit = Number(params.get('limit'));
  if (bucket) {
    if (!BUCKETS.includes(bucket as Bucket)) throw new ValidationError('bad bucket');
    f.bucket = bucket as Bucket;
  }
  if (status) {
    if (!STATUSES.includes(status as ItemStatus)) throw new ValidationError('bad status');
    f.status = status as ItemStatus;
  }
  if (stage) {
    if (!STAGES.includes(stage as ContentStage)) throw new ValidationError('bad stage');
    f.stage = stage as ContentStage;
  }
  if (Number.isFinite(limit) && limit > 0) f.limit = limit;
  return f;
}

export async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const principal = await authorize(request, env);
  if (!principal) return json({ ok: false, error: 'unauthorized' }, 401);

  const store = getStore(env);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [resource, id, sub] = parts;

  try {
    if (resource === 'captures' && request.method === 'GET') {
      if (!id) {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
        return json({ ok: true, captures: await store.listCaptures(limit) });
      }
      const capture = await store.getCapture(id);
      if (!capture) return json({ ok: false, error: 'not found' }, 404);
      if (sub === 'audio') {
        if (!capture.audio_r2_key) return json({ ok: false, error: 'no audio' }, 404);
        const obj = await env.AUDIO.get(capture.audio_r2_key);
        if (!obj) return json({ ok: false, error: 'audio missing from R2' }, 404);
        return new Response(obj.body, {
          headers: {
            'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
            'cache-control': 'private, max-age=3600',
          },
        });
      }
      const items = await store.listItems({ capture_id: id, limit: 100 });
      return json({ ok: true, capture, items });
    }

    if (resource === 'items') {
      if (request.method === 'GET') {
        if (!id) return json({ ok: true, items: await store.listItems(parseItemFilter(url.searchParams)) });
        const item = await store.getItem(id);
        return item ? json({ ok: true, item }) : json({ ok: false, error: 'not found' }, 404);
      }
      if (request.method === 'PATCH' && id) {
        const existing = await store.getItem(id);
        if (!existing) return json({ ok: false, error: 'not found' }, 404);
        const body = await request.json().catch(() => {
          throw new ValidationError('bad json');
        });
        const patch = parseItemPatch(body);
        if (Object.keys(patch.content).length && !existing.content) {
          return json({ ok: false, error: 'item has no content-idea row' }, 400);
        }
        if (Object.keys(patch.item).length) await store.updateItem(id, patch.item);
        if (Object.keys(patch.content).length) await store.updateContentIdea(id, patch.content);
        return json({ ok: true, item: await store.getItem(id) });
      }
    }

    return json({ ok: false, error: 'not found' }, 404);
  } catch (err) {
    if (err instanceof ValidationError) return json({ ok: false, error: err.message }, 400);
    console.error('api error', err);
    return json({ ok: false, error: 'internal error' }, 500);
  }
}
