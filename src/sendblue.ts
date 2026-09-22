import type { Env, Enrichment } from './types';

const SEND_URL = 'https://api.sendblue.co/api/send-message';

/** Send to a specific number. */
export async function sendSms(env: Env, to: string, content: string): Promise<void> {
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      'sb-api-key-id': env.SENDBLUE_API_KEY_ID,
      'sb-api-secret-key': env.SENDBLUE_API_SECRET_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ number: to, from_number: env.SENDBLUE_FROM_NUMBER, content }),
  });
  if (!res.ok) throw new Error(`Sendblue send failed: ${res.status} ${await res.text()}`);
}

/** Send to the allowlisted capture number — receipts and error notices. */
export function sendMessage(env: Env, content: string): Promise<void> {
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
