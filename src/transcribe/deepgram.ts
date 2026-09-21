import type { Env } from '../types';

const BASE = 'https://api.deepgram.com/v1/listen';
const MODEL = 'nova-3';

/**
 * Vocabulary Deepgram would otherwise mangle. Nova-3 "keyterm prompting"
 * biases recognition toward these without a custom model. Overridable per
 * deployment via the TRANSCRIBE_KEYTERMS var (comma-separated).
 */
export const DEFAULT_KEYTERMS = [
  'Lockii',
  "Hafen's Garage",
  'Hafen',
  'contactless',
  'unstaffed',
  'shrinkage',
  'bay',
  'DIY auto bay',
];

export function parseKeyterms(raw: string | undefined): string[] {
  const list = raw?.trim() ? raw.split(',') : DEFAULT_KEYTERMS;
  return [...new Set(list.map((k) => k.trim()).filter(Boolean))];
}

/** Build the /listen URL. Exported so the query shape is unit-testable. */
export function buildDeepgramUrl(keyterms: string[]): string {
  const url = new URL(BASE);
  url.searchParams.set('model', MODEL);
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('punctuate', 'true');
  url.searchParams.set('language', 'en');
  // Repeated keyterm params, one per phrase — Deepgram accepts up to ~100.
  for (const k of keyterms.slice(0, 100)) url.searchParams.append('keyterm', k);
  return url.toString();
}

/** Deepgram accepts the widest range of containers, including raw CAF. */
export async function transcribeDeepgram(
  env: Env,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  if (!env.DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY is not set');

  const res = await fetch(buildDeepgramUrl(parseKeyterms(env.TRANSCRIBE_KEYTERMS)), {
    method: 'POST',
    headers: {
      authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      'content-type': mime || 'audio/x-caf',
    },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`Deepgram transcription failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  const text = json.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (typeof text !== 'string') throw new Error('Deepgram returned no transcript');
  return text;
}
