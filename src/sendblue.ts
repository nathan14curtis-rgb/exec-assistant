import type { Env, Enrichment } from './types';

const SEND_URL = 'https://api.sendblue.co/api/send-message';

export async function sendMessage(env: Env, content: string): Promise<void> {
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      'sb-api-key-id': env.SENDBLUE_API_KEY_ID,
      'sb-api-secret-key': env.SENDBLUE_API_SECRET_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      number: env.ALLOWED_FROM_NUMBER,
      from_number: env.SENDBLUE_FROM_NUMBER,
      content,
    }),
  });
  if (!res.ok) throw new Error(`Sendblue send failed: ${res.status} ${await res.text()}`);
}

/** ✅ {type}: "{title}" → Theme: {theme} | Tags: {tags} | Fit {lockii_fit}/5 */
export function confirmationText(e: Enrichment, duplicateTitle?: string | null): string {
  const tags = e.tags.length ? e.tags.join(', ') : 'none';
  let text = `✅ ${e.type}: "${e.title}" → Theme: ${e.theme} | Tags: ${tags} | Fit ${e.lockii_fit}/5`;
  if (duplicateTitle) text += `\n⚠️ Similar to: "${duplicateTitle}"`;
  return text;
}

export const ERROR_TEXT = "❌ Couldn't process that idea — saved raw.";
