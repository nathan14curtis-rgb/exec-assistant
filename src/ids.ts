const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Crockford-ish: no 0/1/I/O.

/**
 * Short sortable ID: IDEA-YYYYMMDD-XXX.
 * The date prefix keeps IDs sortable; the suffix is random for collision safety.
 */
export function newIdeaId(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  let suffix = '';
  for (const b of bytes) suffix += ALPHABET[b % ALPHABET.length];
  return `IDEA-${y}${m}${d}-${suffix}`;
}

/** R2 key for archived audio: audio/{yyyy}/{mm}/{messageId}.{ext} */
export function audioKey(messageId: string, ext: string, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safe = messageId.replace(/[^A-Za-z0-9._-]/g, '_');
  return `audio/${y}/${m}/${safe}.${ext.replace(/^\./, '')}`;
}
