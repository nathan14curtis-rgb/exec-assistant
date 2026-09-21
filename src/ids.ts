const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Crockford-ish: no 0/1/I/O.

function datePart(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function randomSuffix(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Short sortable ID: PREFIX-YYYYMMDD-XXXX.
 * The date prefix keeps IDs sortable; the suffix is random for collision safety.
 */
export function newId(prefix: 'CAP' | 'ITM', now: Date = new Date()): string {
  return `${prefix}-${datePart(now)}-${randomSuffix(4)}`;
}

/** R2 key for archived audio: audio/{yyyy}/{mm}/{sourceId}.{ext} */
export function audioKey(sourceId: string, ext: string, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safe = sourceId.replace(/[^A-Za-z0-9._-]/g, '_');
  return `audio/${y}/${m}/${safe}.${ext.replace(/^\./, '')}`;
}
