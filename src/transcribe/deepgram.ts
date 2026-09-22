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
  // keyterm prompting is Nova-3 English; the language has to be explicit.
  url.searchParams.set('language', 'en');
  // Repeated keyterm params, one per phrase — Deepgram accepts up to ~100.
  for (const k of keyterms.slice(0, 100)) url.searchParams.append('keyterm', k);
  return url.toString();
}

export function extractTranscript(json: unknown): string {
  const j = json as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
  const text = j?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (typeof text !== 'string') throw new Error('Deepgram returned no transcript');
  return text;
}

async function post(key: string, url: string, bytes: Uint8Array, mime: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { authorization: `Token ${key}`, 'content-type': mime },
    body: bytes,
  });
}

/**
 * Transcribe with Deepgram. `mime` must describe the bytes — the API picks a
 * decoder from it, so a wrong or generic type is a 400.
 *
 * A 400 with keyterms set is retried once without them: keyterm prompting is
 * the optional part, and a plain transcript beats a dropped voice note.
 */
export async function transcribeDeepgram(
  env: Env,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  if (!env.DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY is not set');

  const keyterms = parseKeyterms(env.TRANSCRIBE_KEYTERMS);
  let res = await post(env.DEEPGRAM_API_KEY, buildDeepgramUrl(keyterms), bytes, mime);

  if (res.status === 400 && keyterms.length) {
    const first = await res.text();
    console.warn(`Deepgram 400 with keyterms, retrying without: ${first.slice(0, 300)}`);
    res = await post(env.DEEPGRAM_API_KEY, buildDeepgramUrl([]), bytes, mime);
    if (!res.ok) {
      throw new Error(
        `Deepgram failed: ${res.status} ${await res.text()} ` +
          `(sent ${bytes.length} bytes as ${mime}; also failed with keyterms: ${first.slice(0, 200)})`,
      );
    }
    console.warn('Deepgram succeeded without keyterms — check TRANSCRIBE_KEYTERMS');
  } else if (!res.ok) {
    throw new Error(
      `Deepgram failed: ${res.status} ${await res.text()} (sent ${bytes.length} bytes as ${mime})`,
    );
  }

  return extractTranscript(await res.json());
}
