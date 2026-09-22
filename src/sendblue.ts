import type { Env, Enrichment } from './types';

const SEND_URL = 'https://api.sendblue.co/api/send-message';

/** The fields of Sendblue's send-message reply that decide whether it really sent. */
export interface SendResult {
  status?: string;
  error_code?: number | null;
  error_message?: string | null;
  message_handle?: string;
}

/**
 * Send to a specific number.
 *
 * Sendblue reports a refused message in the *body* of a 200: `status` comes
 * back "ERROR" with an `error_message`. Checking only the HTTP code therefore
 * reports a send that never happened, so both are checked here.
 */
export async function sendSms(env: Env, to: string, content: string): Promise<SendResult> {
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      'sb-api-key-id': env.SENDBLUE_API_KEY_ID,
      'sb-api-secret-key': env.SENDBLUE_API_SECRET_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ number: to, from_number: env.SENDBLUE_FROM_NUMBER, content }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Sendblue returned HTTP ${res.status}: ${clip(text)}`);

  let body: SendResult;
  try {
    body = JSON.parse(text) as SendResult;
  } catch {
    throw new Error(`Sendblue returned a non-JSON body: ${clip(text)}`);
  }

  if (body.status === 'ERROR' || body.error_message) {
    const code = body.error_code ? ` (code ${body.error_code})` : '';
    throw new Error(`Sendblue refused the message${code}: ${body.error_message ?? 'no reason given'}`);
  }
  return body;
}

/** Keep a provider message short enough to read in a log line or on a page. */
function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

/** Send to the allowlisted capture number — receipts and error notices. */
export function sendMessage(env: Env, content: string): Promise<SendResult> {
  return sendSms(env, env.ALLOWED_FROM_NUMBER, content);
}

/** ✅ {type}: "{title}" → Theme: {theme} | Tags: {tags} | Fit {lockii_fit}/5 */
export function confirmationText(e: Enrichment, duplicateTitle?: string | null): string {
  const tags = e.tags.length ? e.tags.join(', ') : 'none';
  let text = `✅ ${e.type}: "${e.title}" → Theme: ${e.theme} | Tags: ${tags} | Fit ${e.lockii_fit}/5`;
  if (duplicateTitle) text += `\n⚠️ Similar to: "${duplicateTitle}"`;
  return text;
}

export const ERROR_TEXT = "❌ Couldn't process that idea — saved raw.";
