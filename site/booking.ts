/**
 * Call slots for /book.
 *
 *  - Slots are fixed start times in the owner's time zone (OWNER_TZ), Mon–Sat,
 *    for the next DAYS days. The page shows them in the visitor's own zone.
 *  - A slot is offered only if it is free on the owner's Google Calendar
 *    (free/busy via the service account) and not already requested on the site.
 *  - A booked call is added to that calendar when the service account has
 *    "Make changes to events" access; free/busy-only sharing still blocks conflicts.
 */

export interface BookingEnv {
  DB: D1Database;
  OWNER_TZ?: string;
  BOOKING_CALENDAR_ID?: string;
  GOOGLE_SA_EMAIL?: string;
  GOOGLE_SA_PRIVATE_KEY?: string;
}

export const SLOT_TIMES = ['07:00', '12:00', '17:30', '18:30', '19:30', '20:30'];
export const SLOT_MINUTES = 30;
const DAYS = 10;
const LEAD_MS = 3 * 3600_000; // no same-afternoon surprises
const DEFAULT_TZ = 'America/Denver';

export const ownerTz = (env: BookingEnv) => env.OWNER_TZ || DEFAULT_TZ;

// --- Time zone math ---------------------------------------------------------

/** Offset of `tz` from UTC at instant `ts`, in ms (Denver in summer → -6h). */
export function tzOffset(ts: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ts))) p[type] = Number(value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

/** Wall-clock time in `tz` → UTC ms. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffset(guess, tz);
  const t = guess - off;
  const off2 = tzOffset(t, tz);
  return off2 === off ? t : guess - off2;
}

/** Every offered slot start (UTC ms) from tomorrow (owner's zone) on, ignoring calendars. */
export function candidateSlots(now: number, tz: string): number[] {
  const local = new Date(now + tzOffset(now, tz));
  let y = local.getUTCFullYear(), m = local.getUTCMonth() + 1, d = local.getUTCDate();
  const out: number[] = [];
  let days = 0;
  for (let i = 1; days < DAYS && i < 30; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    if (day.getUTCDay() === 0) continue; // no Sundays
    days++;
    for (const t of SLOT_TIMES) {
      const [hh, mm] = t.split(':').map(Number);
      const start = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
      if (start - now >= LEAD_MS) out.push(start);
    }
  }
  return out;
}

export interface Busy { start: number; end: number }

export const overlaps = (start: number, busy: Busy[]) =>
  busy.some((b) => start < b.end && start + SLOT_MINUTES * 60_000 > b.start);

/** "Fri, Oct 2, 5:30 PM MDT" in the owner's zone. */
export function ownerLabel(start: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(start));
}

// --- Google Calendar --------------------------------------------------------

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL = 'https://www.googleapis.com/calendar/v3';
let memo: { token: string; exp: number } | null = null;

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function googleToken(env: BookingEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (memo && memo.exp > now + 60) return memo.token;
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: env.GOOGLE_SA_EMAIL, scope: 'https://www.googleapis.com/auth/calendar', aud: TOKEN_URL, iat: now, exp: now + 3600,
  })}`;
  const pem = env.GOOGLE_SA_PRIVATE_KEY!.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`google token ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  memo = { token: j.access_token, exp: now + j.expires_in };
  return memo.token;
}

const calendarReady = (env: BookingEnv) => !!(env.BOOKING_CALENDAR_ID && env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY);

async function calendarBusy(env: BookingEnv, from: number, to: number): Promise<Busy[]> {
  if (!calendarReady(env)) return [];
  const res = await fetch(`${CAL}/freeBusy`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await googleToken(env)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: env.BOOKING_CALENDAR_ID }] }),
  });
  if (!res.ok) throw new Error(`freeBusy ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> };
  const cal = j.calendars[env.BOOKING_CALENDAR_ID!];
  // "notFound" here means the calendar isn't shared with the service account.
  if (!cal || cal.errors?.length) throw new Error(`freeBusy calendar error ${JSON.stringify(cal?.errors)}`);
  return (cal.busy || []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
}

/** Calls already requested through the site (so two visitors can't take one slot). */
async function siteBusy(env: BookingEnv, from: number): Promise<Busy[]> {
  const since = new Date(from - 30 * 86400_000).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT data FROM site_submissions WHERE kind = 'consultation' AND created_at >= ?",
  ).bind(since).all<{ data: string }>();
  const out: Busy[] = [];
  for (const r of results || []) {
    try {
      const s = Date.parse((JSON.parse(r.data) as { slot?: string }).slot || '');
      if (s) out.push({ start: s, end: s + SLOT_MINUTES * 60_000 });
    } catch { /* old rows without a slot */ }
  }
  return out;
}

/**
 * Busy blocks for the booking window. A calendar outage fails open (logged) so
 * the page keeps taking bookings; the text/email still reaches the owner.
 */
async function busyFor(env: BookingEnv, from: number, to: number): Promise<Busy[]> {
  const [cal, site] = await Promise.all([
    calendarBusy(env, from, to).catch((e) => { console.error('calendar busy failed', String(e)); return [] as Busy[]; }),
    siteBusy(env, from),
  ]);
  return [...cal, ...site];
}

export async function openSlots(env: BookingEnv, now = Date.now()): Promise<number[]> {
  const all = candidateSlots(now, ownerTz(env));
  if (!all.length) return [];
  const busy = await busyFor(env, all[0], all[all.length - 1] + SLOT_MINUTES * 60_000);
  return all.filter((s) => !overlaps(s, busy));
}

/** Null if the slot can be booked, else a message for the visitor. */
export async function checkSlot(env: BookingEnv, iso: string, now = Date.now()): Promise<string | null> {
  const start = Date.parse(iso);
  if (!candidateSlots(now, ownerTz(env)).includes(start)) return 'That time is no longer available. Please pick another.';
  const busy = await busyFor(env, start, start + SLOT_MINUTES * 60_000);
  return overlaps(start, busy) ? 'That time was just taken. Please pick another.' : null;
}

export async function addToCalendar(env: BookingEnv, start: number, summary: string, description: string): Promise<void> {
  if (!calendarReady(env)) return;
  const res = await fetch(`${CAL}/calendars/${encodeURIComponent(env.BOOKING_CALENDAR_ID!)}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await googleToken(env)}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      summary, description,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(start + SLOT_MINUTES * 60_000).toISOString() },
    }),
  });
  // 403 = shared as free/busy only; conflicts are still blocked, the event just isn't created.
  if (!res.ok) console.error('calendar insert failed', res.status, await res.text());
}
