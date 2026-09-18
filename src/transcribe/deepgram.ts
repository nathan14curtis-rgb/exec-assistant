import type { Env } from '../types';

const ENDPOINT = 'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true';

/** Deepgram accepts the widest range of containers, including raw CAF. */
export async function transcribeDeepgram(
  env: Env,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  if (!env.DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY is not set');

  const res = await fetch(ENDPOINT, {
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
