import type { Env } from '../types';

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

export async function transcribeGroq(
  env: Env,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), `audio.${extFor(mime)}`);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'json');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq transcription failed: ${res.status} ${await res.text()}`);

  const json = (await res.json()) as { text?: string };
  if (typeof json.text !== 'string') throw new Error('Groq returned no transcript');
  return json.text;
}

function extFor(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg')) return 'mp3';
  return 'ogg';
}
