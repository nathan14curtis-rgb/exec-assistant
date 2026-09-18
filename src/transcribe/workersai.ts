import type { Env } from '../types';

const MODEL = '@cf/openai/whisper-large-v3-turbo';

/**
 * Workers AI Whisper. Preferred: native binding, no extra key, no egress.
 * Expects base64-encoded audio in a container it recognizes (ogg/mp3/wav/m4a).
 */
export async function transcribeWorkersAi(
  env: Env,
  bytes: Uint8Array,
  _mime: string,
): Promise<string> {
  const result = (await env.AI.run(MODEL as never, {
    audio: toBase64(bytes),
  } as never)) as { text?: string };

  if (typeof result?.text !== 'string') {
    throw new Error('Workers AI returned no transcript');
  }
  return result.text;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // avoid blowing the argument limit on large files
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
