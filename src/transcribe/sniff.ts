/**
 * Work out what an audio payload actually is, from its bytes.
 *
 * The container matters twice: the transcription APIs pick a decoder from the
 * request's content-type, and the R2 archive key gets an extension. Both were
 * previously taken from whatever `content-type` the media CDN returned, which
 * is not ours to rely on — Sendblue can hand back `application/octet-stream`,
 * and a provider that trusts that header rejects the request.
 */

export type Container = 'caf' | 'ogg' | 'm4a' | 'mp3' | 'wav' | 'webm' | 'flac' | 'amr' | 'unknown';

export interface Sniffed {
  container: Container;
  /** A media type the transcription APIs recognise. */
  mime: string;
  /** Extension for the R2 key, without the dot. */
  ext: string;
}

const TABLE: Record<Container, { mime: string; ext: string }> = {
  caf: { mime: 'audio/x-caf', ext: 'caf' },
  ogg: { mime: 'audio/ogg', ext: 'ogg' },
  m4a: { mime: 'audio/mp4', ext: 'm4a' },
  mp3: { mime: 'audio/mpeg', ext: 'mp3' },
  wav: { mime: 'audio/wav', ext: 'wav' },
  webm: { mime: 'audio/webm', ext: 'webm' },
  flac: { mime: 'audio/flac', ext: 'flac' },
  amr: { mime: 'audio/amr', ext: 'amr' },
  unknown: { mime: 'application/octet-stream', ext: 'bin' },
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Identify the container from its magic bytes. */
export function detectContainer(bytes: Uint8Array): Container {
  if (bytes.length < 12) return 'unknown';

  if (ascii(bytes, 0, 4) === 'caff') return 'caf';
  if (ascii(bytes, 0, 4) === 'OggS') return 'ogg';
  if (ascii(bytes, 0, 4) === 'fLaC') return 'flac';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav';
  // ISO base media: a 'ftyp' box at offset 4 covers m4a, mp4 and 3gp.
  if (ascii(bytes, 4, 4) === 'ftyp') return 'm4a';
  // EBML header — WebM and Matroska.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (ascii(bytes, 0, 5) === '#!AMR') return 'amr';
  if (ascii(bytes, 0, 3) === 'ID3') return 'mp3';
  // A bare MPEG audio frame: 11 sync bits, and not a free-format/reserved frame.
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08) return 'mp3';

  return 'unknown';
}

/**
 * Sniff the payload, falling back to the transport's content-type only when
 * the bytes say nothing — and never passing a non-audio type through.
 */
export function sniffAudio(bytes: Uint8Array, headerMime?: string | null): Sniffed {
  const container = detectContainer(bytes);
  if (container !== 'unknown') return { container, ...TABLE[container] };

  // The bytes were inconclusive. A plausible audio content-type is better
  // than nothing; anything else (octet-stream, text/html from an expired
  // link) would only mislead the decoder.
  const header = (headerMime ?? '').split(';')[0].trim().toLowerCase();
  if (header.startsWith('audio/') || header === 'video/mp4' || header === 'video/webm') {
    const guess = (Object.keys(TABLE) as Container[]).find((c) => TABLE[c].mime === header);
    if (guess) return { container: guess, ...TABLE[guess] };
    return { container: 'unknown', mime: header, ext: header.split('/')[1] || 'bin' };
  }

  return { container: 'unknown', ...TABLE.unknown };
}
