import type { CaptureJob, Env } from './types';
import { timingSafeEqual } from './auth';

/**
 * Sendblue adapter: turns an inbound-message webhook into a CaptureJob.
 * Everything channel-specific (signing secret, allowlist, echo filtering)
 * stays here so the consumer never has to know where a capture came from.
 */

/** Shape of the Sendblue inbound-message webhook body (fields we care about). */
export interface SendblueWebhookBody {
  message_handle?: string;
  content?: string;
  media_url?: string;
  is_outbound?: boolean;
  status?: string;
  from_number?: string;
  number?: string;
  to_number?: string;
  date_sent?: string;
  message_type?: string;
}

export { timingSafeEqual };

/** Normalize a phone number to digits-only so +1 555… and 1555… compare equal. */
export function normalizeNumber(n: string | undefined | null): string {
  return (n ?? '').replace(/[^0-9]/g, '');
}

export type WebhookOutcome =
  | { action: 'reject'; status: 401; reason: string }
  | { action: 'ignore'; reason: string }
  | { action: 'enqueue'; job: CaptureJob };

/**
 * Pure decision function — no I/O except the dedupe lookup, which is injected
 * so the rules stay unit-testable.
 */
export async function decideWebhook(
  body: SendblueWebhookBody,
  signingSecret: string | null,
  env: Pick<Env, 'SENDBLUE_WEBHOOK_SECRET' | 'ALLOWED_FROM_NUMBER'>,
  seen: (key: string) => Promise<boolean>,
): Promise<WebhookOutcome> {
  if (!signingSecret || !timingSafeEqual(signingSecret, env.SENDBLUE_WEBHOOK_SECRET)) {
    return { action: 'reject', status: 401, reason: 'bad signing secret' };
  }

  // Outbound echoes and delivery-status callbacks are not captures.
  if (body.is_outbound === true) return { action: 'ignore', reason: 'outbound' };

  const from = normalizeNumber(body.from_number);
  if (!from || from !== normalizeNumber(env.ALLOWED_FROM_NUMBER)) {
    return { action: 'ignore', reason: 'not allowlisted' };
  }

  const content = (body.content ?? '').trim();
  const mediaUrl = body.media_url?.trim() || null;
  if (!content && !mediaUrl) return { action: 'ignore', reason: 'empty message' };

  const messageId = body.message_handle?.trim();
  if (!messageId) return { action: 'ignore', reason: 'missing message_handle' };

  if (await seen(messageId)) return { action: 'ignore', reason: 'duplicate' };

  return {
    action: 'enqueue',
    job: {
      channel: 'sendblue',
      sourceId: messageId,
      text: content,
      mediaUrl,
      receivedAt: body.date_sent ?? new Date().toISOString(),
      notify: true,
    },
  };
}

const DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  let body: SendblueWebhookBody;
  try {
    body = (await request.json()) as SendblueWebhookBody;
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const secret = request.headers.get('sb-signing-secret');

  // Claim the message id in KV as part of the check: whichever delivery writes
  // first wins, so a retried webhook can never produce a second capture.
  const seen = async (key: string) => {
    const kvKey = `msg:${key}`;
    if ((await env.DEDUPE.get(kvKey)) !== null) return true;
    await env.DEDUPE.put(kvKey, '1', { expirationTtl: DEDUPE_TTL_SECONDS });
    return false;
  };

  const outcome = await decideWebhook(body, secret, env, seen);

  if (outcome.action === 'reject') {
    return new Response('unauthorized', { status: outcome.status });
  }
  if (outcome.action === 'ignore') {
    return new Response(JSON.stringify({ ok: true, ignored: outcome.reason }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  await env.CAPTURE_QUEUE.send(outcome.job);
  return new Response(JSON.stringify({ ok: true, queued: outcome.job.sourceId }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
