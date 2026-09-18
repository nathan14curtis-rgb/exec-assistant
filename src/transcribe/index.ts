import type { Env } from '../types';
import { cafToOggOpus, isCaf } from './caf';
import { transcribeWorkersAi } from './workersai';
import { transcribeGroq } from './groq';
import { transcribeDeepgram } from './deepgram';

/** Swappable transcription backend. */
export interface Transcriber {
  name: string;
  /** True if this provider accepts a raw Apple .caf container. */
  acceptsCaf: boolean;
  transcribe(bytes: Uint8Array, mime: string): Promise<string>;
}

export function getTranscriber(env: Env): Transcriber {
  switch ((env.TRANSCRIBE_PROVIDER || 'workersai').toLowerCase()) {
    case 'groq':
      return {
        name: 'groq',
        acceptsCaf: false,
        transcribe: (b, m) => transcribeGroq(env, b, m),
      };
    case 'deepgram':
      return {
        name: 'deepgram',
        acceptsCaf: true,
        transcribe: (b, m) => transcribeDeepgram(env, b, m),
      };
    case 'workersai':
    default:
      return {
        name: 'workersai',
        acceptsCaf: false,
        transcribe: (b, m) => transcribeWorkersAi(env, b, m),
      };
  }
}

/**
 * Transcribe audio, remuxing CAF to Ogg Opus first when the provider can't
 * read CAF. See README "Phase 0" for why.
 */
export async function transcribe(
  env: Env,
  bytes: Uint8Array,
  mime: string,
): Promise<{ text: string; provider: string; remuxed: boolean }> {
  const provider = getTranscriber(env);
  let payload = bytes;
  let payloadMime = mime;
  let remuxed = false;

  if (isCaf(bytes) && !provider.acceptsCaf) {
    payload = cafToOggOpus(bytes);
    payloadMime = 'audio/ogg';
    remuxed = true;
  }

  const text = await provider.transcribe(payload, payloadMime);
  return { text: text.trim(), provider: provider.name, remuxed };
}

export { cafToOggOpus, isCaf };
