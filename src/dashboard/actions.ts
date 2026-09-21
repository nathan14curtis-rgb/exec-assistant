import type { Area, Bucket, CaptureJob, Env, Item, ItemStatus } from '../types';
import { AREAS, BUCKETS as BUCKET_NAMES } from '../types';
import { newId } from '../ids';
import type { Store } from '../store';

/** Where to send the browser after a POST, and which drawer to reopen. */
export interface Redirect {
  itemId?: string;
  captureId?: string;
  form?: string;
}

export class ActionError extends Error {}

function requireOne<T extends string>(value: string | null, allowed: readonly T[], field: string): T {
  if (!value || !allowed.includes(value as T)) {
    throw new ActionError(`${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

/**
 * Split a body at a character offset, on the nearest sensible boundary.
 * Exported so the offset arithmetic is testable without a store.
 */
export function splitBody(body: string, at: number): { first: string; second: string } | null {
  const text = body.trim();
  if (at <= 0 || at >= text.length) return null;
  const first = text.slice(0, at).trim();
  const second = text.slice(at).trim();
  if (!first || !second) return null;
  return { first, second };
}

/** First sentence or clause of a body, used as a title for the split half. */
export function titleFrom(text: string, max = 80): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return 'Untitled';
  const stop = clean.search(/[.!?](\s|$)/);
  const candidate = stop > 0 && stop < max ? clean.slice(0, stop) : clean;
  return candidate.length <= max ? candidate : `${candidate.slice(0, max - 1).trimEnd()}…`;
}

export async function moveBucket(store: Store, itemId: string, form: FormData): Promise<Redirect> {
  const bucket = requireOne(form.get('bucket') as string | null, BUCKET_NAMES, 'bucket');
  const item = await store.getItem(itemId);
  if (!item) throw new ActionError('item not found');
  if (item.bucket !== bucket) await store.updateItem(itemId, { bucket });
  return { itemId };
}

export async function setStatus(store: Store, itemId: string, form: FormData): Promise<Redirect> {
  const status = requireOne(form.get('status') as string | null, ['open', 'done', 'dismissed'] as const, 'status');
  await store.updateItem(itemId, { status: status as ItemStatus });
  return { itemId };
}

export async function editText(store: Store, itemId: string, form: FormData): Promise<Redirect> {
  const title = String(form.get('title') ?? '').trim();
  if (!title) throw new ActionError('title is required');
  const body = String(form.get('body') ?? '').trim();
  await store.updateItem(itemId, { title: title.slice(0, 300), body: body.slice(0, 8000) });
  return { itemId };
}

export async function editMeta(store: Store, itemId: string, form: FormData): Promise<Redirect> {
  const area = String(form.get('area') ?? '');
  if (area && !AREAS.includes(area as Area)) throw new ActionError('unknown area');
  const due = String(form.get('due') ?? '').trim();
  let dueAt = '';
  if (due) {
    const d = new Date(`${due}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new ActionError('bad due date');
    dueAt = d.toISOString();
  }
  await store.updateItem(itemId, { area: area as Area | '', due_at: dueAt });
  return { itemId };
}

/**
 * Split one item into two. The second half becomes a new item in the same
 * bucket on the same capture, so a merged pair of thoughts can be separated
 * without leaving the inbox.
 */
export async function splitItem(store: Store, itemId: string, form: FormData): Promise<Redirect> {
  const at = Number(form.get('at'));
  if (!Number.isFinite(at)) throw new ActionError('split point is required');
  const item = await store.getItem(itemId);
  if (!item) throw new ActionError('item not found');

  const parts = splitBody(item.body, at);
  if (!parts) throw new ActionError('that split point leaves one half empty');

  const now = new Date();
  const ts = now.toISOString();
  const second: Item = {
    id: newId('ITM', now),
    capture_id: item.capture_id,
    bucket: item.bucket,
    title: titleFrom(parts.second),
    body: parts.second,
    status: 'open',
    area: item.area,
    due_at: '',
    related_item_id: item.id,
    data: '{}',
    created_at: ts,
    updated_at: ts,
  };

  // The new item carries no content_ideas row: its enrichment fields would be
  // a copy, not a classification, and a stale theme is worse than none.
  await store.createItem(second);
  await store.updateItem(itemId, { body: parts.first });

  const capture = await store.getCapture(item.capture_id);
  if (capture) {
    const items = await store.listItems({ capture_id: item.capture_id, limit: 100 });
    await store.updateCapture(capture.id, { item_count: items.length });
  }
  return { itemId: second.id };
}

export async function deleteItem(store: Store, itemId: string): Promise<Redirect> {
  const item = await store.getItem(itemId);
  if (!item) throw new ActionError('item not found');
  await store.deleteItem(itemId);
  const items = await store.listItems({ capture_id: item.capture_id, limit: 100 });
  await store.updateCapture(item.capture_id, { item_count: items.length });
  return { captureId: item.capture_id };
}

/**
 * Re-run the pipeline on a capture: drop its items and re-enqueue. The job
 * carries no media URL, so the consumer reuses the stored transcript rather
 * than re-transcribing — the sorting is what is being retried.
 */
export async function rerunCapture(store: Store, env: Env, captureId: string): Promise<Redirect> {
  const capture = await store.getCapture(captureId);
  if (!capture) throw new ActionError('capture not found');

  const items = await store.listItems({ capture_id: captureId, limit: 200 });
  for (const item of items) await store.deleteItem(item.id);
  await store.updateCapture(captureId, { status: 'processing', item_count: 0, error: '' });

  const job: CaptureJob = {
    channel: capture.channel,
    sourceId: capture.source_id,
    text: capture.raw_text,
    mediaUrl: null,
    receivedAt: new Date().toISOString(),
    notify: false,
  };
  await env.CAPTURE_QUEUE.send(job);
  return { captureId };
}

/**
 * Keep a failed capture as a journal entry rather than retrying the sorter.
 * Nothing is lost and the capture leaves the error state.
 */
export async function keepAsNote(store: Store, captureId: string): Promise<Redirect> {
  const capture = await store.getCapture(captureId);
  if (!capture) throw new ActionError('capture not found');
  const text = (capture.transcript_repaired || capture.transcript_raw || capture.raw_text).trim();
  if (!text) throw new ActionError('nothing to keep');

  const now = new Date();
  const ts = now.toISOString();
  const item: Item = {
    id: newId('ITM', now),
    capture_id: captureId,
    bucket: 'journal',
    title: titleFrom(text),
    body: text,
    status: 'open',
    area: '',
    due_at: '',
    related_item_id: '',
    data: JSON.stringify({ kept_from_error: true }),
    created_at: ts,
    updated_at: ts,
  };
  await store.createItem(item);
  await store.updateCapture(captureId, { status: 'processed', item_count: 1, error: '' });
  return { itemId: item.id };
}

export type { Bucket };
