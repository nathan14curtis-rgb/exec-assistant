import type { CaptureJob, Env } from './types';
import { checkBearer } from './auth';

/**
 * Generic inbound endpoint. Anything that can make an HTTP request can
 * capture: an iOS Shortcut, a desktop dictation tool, curl. Sendblue is just
 * another adapter (webhook.ts) that produces the same CaptureJob.
 */
export interface CaptureRequestBody {
  text?: string;
  media_url?: string;
  /** Client idempotency key. Omit for a fresh capture every time. */
  source_id?: string;
  /** Text a receipt back over Sendblue. Default false for API captures. */
  notify?: boolean;
}

export type CaptureDecision =
  | { ok: false; status: 400; error: string }
  | { ok: true; job: CaptureJob };

export function decideCapture(body: unknown, now: Date = new Date()): CaptureDecision {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, status: 400, error: 'body must be a JSON object' };
  }
  const b = body as CaptureRequestBody;
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  const mediaUrl = typeof b.media_url === 'string' && b.media_url.trim() ? b.media_url.trim() : null;
  if (!text && !mediaUrl) return { ok: false, status: 400, error: 'text or media_url is required' };
  if (mediaUrl && !/^https:\/\//i.test(mediaUrl)) {
    return { ok: false, status: 400, error: 'media_url must be https' };
  }

  const sourceId =
    typeof b.source_id === 'string' && b.source_id.trim()
      ? b.source_id.trim().slice(0, 200)
      : `api-${now.getTime()}-${crypto.randomUUID().slice(0, 8)}`;

  return {
    ok: true,
    job: {
      channel: 'api',
      sourceId,
      text,
      mediaUrl,
      receivedAt: now.toISOString(),
      notify: b.notify === true,
    },
  };
}

export async function handleCapture(request: Request, env: Env): Promise<Response> {
  if (!checkBearer(request, env)) return new Response('unauthorized', { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const decision = decideCapture(body);
  if (!decision.ok) {
    return new Response(JSON.stringify({ ok: false, error: decision.error }), {
      status: decision.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  await env.CAPTURE_QUEUE.send(decision.job);
  return new Response(JSON.stringify({ ok: true, queued: decision.job.sourceId }), {
    status: 202,
    headers: { 'content-type': 'application/json' },
  });
}
