import type { Env } from '../types';
import { cafToOggOpus, isCaf } from './caf';
import { sniffAudio, type Sniffed } from './sniff';
import { transcribeWorkersAi } from './workersai';
import { transcribeGroq } from './groq';
import { transcribeDeepgram } from './deepgram';

/** Swappable transcription backend. */
export interface Transcriber {
  name: string;
  /**
   * True if this provider accepts a raw Apple .caf container.
   *
   * None currently do. Deepgram was marked `true` on the assumption that it
   * accepts the widest range of containers, but CAF is not in its supported
   * list and a raw .caf is rejected with a 400. Apple voice notes therefore
   * always take the remux path, which is pure repackaging — the Opus packets
   * inside are what Ogg carries anyway, so nothing is re-encoded.
   */
  acceptsCaf: boolean;
  transcribe(bytes: Uint8Array, mime: string): Promise<string>;
}

export function getTranscriber(env: Env): Transcriber {
  switch ((env.TRANSCRIBE_PROVIDER || 'deepgram').toLowerCase()) {
    case 'groq':
      return {
        name: 'groq',
        acceptsCaf: false,
        transcribe: (b, m) => transcribeGroq(env, b, m),
      };
    case 'workersai':
      return {
        name: 'workersai',
        acceptsCaf: false,
        transcribe: (b, m) => transcribeWorkersAi(env, b, m),
      };
    case 'deepgram':
    default:
      return {
        name: 'deepgram',
        acceptsCaf: false,
        transcribe: (b, m) => transcribeDeepgram(env, b, m),
      };
  }
}

export interface TranscribeResult {
  text: string;
  provider: string;
  remuxed: boolean;
  /** What the bytes turned out to be, for the log. */
  container: string;
  mime: string;
}

/**
 * Decide what to send a provider: the sniffed container, remuxed to Ogg Opus
 * when it is CAF and the provider cannot read CAF.
 *
 * Pure, so the decision is testable without a network call.
 */
export function planPayload(
  bytes: Uint8Array,
  headerMime: string | null | undefined,
  acceptsCaf: boolean,
): { sniffed: Sniffed; remux: boolean; sendMime: string } {
  const sniffed = sniffAudio(bytes, headerMime);
  const remux = sniffed.container === 'caf' && !acceptsCaf;
  return { sniffed, remux, sendMime: remux ? 'audio/ogg' : sniffed.mime };
}

/**
 * Transcribe audio. The container is determined from the bytes rather than
 * from the transport's content-type, because the media CDN's header is not
 * something we control and a provider picks its decoder from what we send.
 */
export async function transcribe(
  env: Env,
  bytes: Uint8Array,
  mime: string | null | undefined,
): Promise<TranscribeResult> {
  const provider = getTranscriber(env);
  const { sniffed, remux, sendMime } = planPayload(bytes, mime, provider.acceptsCaf);

  let payload = bytes;
  if (remux) {
    if (!isCaf(bytes)) throw new Error('planned a CAF remux for something that is not CAF');
    payload = cafToOggOpus(bytes);
  }

  const text = await provider.transcribe(payload, sendMime);
  return {
    text: text.trim(),
    provider: provider.name,
    remuxed: remux,
    container: sniffed.container,
    mime: sendMime,
  };
}

export { cafToOggOpus, isCaf, sniffAudio };
