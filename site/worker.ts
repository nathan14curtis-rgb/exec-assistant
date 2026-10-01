/**
 * nathancurtis.space (root site).
 *
 *  - Static pages come from the ASSETS binding (site/public, built by site/build.mjs).
 *  - POST /forms/newsletter and /forms/consultation validate, save to D1, and
 *    fan out (email provider webhook, Resend emails). Fan-out is best-effort:
 *    the submission is already stored, so a provider outage never loses a lead.
 *  - The notetaker used to live at the root; its old routes 308-redirect to
 *    notes.nathancurtis.space so bookmarks and API clients keep working.
 */
export interface SiteEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  NOTES_ORIGIN: string;
  NOTIFY_EMAIL?: string;
  FROM_EMAIL?: string;
  BOOKING_URL?: string;
  RESEND_API_KEY?: string;
  NEWSLETTER_WEBHOOK_URL?: string;
}

const NOTES_PATHS = ['/inbox', '/api', '/capture', '/webhook', '/health'];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 60)).slice(0, 12) : [];

export function notesRedirect(url: URL, origin: string): Response | null {
  const hit = NOTES_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'));
  if (!hit) return null;
  // 308 keeps the method and body, so a POSTed webhook/capture survives a client that follows redirects.
  return Response.redirect(origin + url.pathname + url.search, 308);
}

export type Parsed =
  | { ok: true; kind: 'newsletter' | 'consultation'; name: string; email: string; data: Record<string, unknown> }
  | { ok: false; error: string };

export function parseSubmission(kind: string, b: Record<string, unknown>): Parsed {
  const name = str(b.name, 120);
  const email = str(b.email, 200).toLowerCase();
  // The home page's inline signups only ask for an email; the booking form needs a name.
  if (!name && kind !== 'newsletter') return { ok: false, error: 'Please enter your name.' };
  if (!EMAIL.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (kind === 'newsletter') {
    return { ok: true, kind, name, email, data: { interests: list(b.interests), stage: str(b.stage, 40), source: str(b.source, 40) } };
  }
  if (kind === 'consultation') {
    const website = str(b.website, 300);
    if (website && !/^https?:\/\/\S+\.\S+/.test(website)) return { ok: false, error: 'Enter a full URL, like https://example.com.' };
    return {
      ok: true, kind, name, email,
      data: {
        // slot: requested call time from /book (ISO start + the label the visitor saw).
        slot: str(b.slot, 40), slot_label: str(b.slot_label, 80),
        phone: str(b.phone, 40), website, started: str(b.started, 40),
        renting: list(b.renting), drains: list(b.drains), learn: list(b.learn), notes: str(b.notes, 4000),
      },
    };
  }
  return { ok: false, error: 'Unknown form.' };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function sendEmail(env: SiteEnv, to: string, subject: string, html: string, replyTo?: string) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, html, reply_to: replyTo }),
  });
  if (!res.ok) console.error('resend failed', res.status, await res.text());
}

async function fanOut(env: SiteEnv, p: Extract<Parsed, { ok: true }>, id: string) {
  const tasks: Promise<unknown>[] = [];
  if (p.kind === 'newsletter' && env.NEWSLETTER_WEBHOOK_URL) {
    // Provider-neutral: point this at Zapier/Make/your ESP's inbound hook.
    tasks.push(
      fetch(env.NEWSLETTER_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, email: p.email, first_name: p.name, ...p.data, source: 'nathancurtis.space' }),
      }).then((r) => { if (!r.ok) console.error('newsletter webhook failed', r.status); }),
    );
  }
  if (p.kind === 'consultation') {
    const rows = Object.entries(p.data)
      .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(Array.isArray(v) ? v.join(', ') : String(v || '—'))}</td></tr>`)
      .join('');
    if (env.NOTIFY_EMAIL) {
      const when = p.data.slot_label ? ` — ${p.data.slot_label}` : '';
      tasks.push(sendEmail(env, env.NOTIFY_EMAIL, `Call request: ${p.name}${when}`,
        `<p><b>${esc(p.name)}</b> &lt;${esc(p.email)}&gt;</p><table>${rows}</table>`, p.email));
    }
    const book = env.BOOKING_URL ? `<p>Book a time here: <a href="${esc(env.BOOKING_URL)}">${esc(env.BOOKING_URL)}</a></p>` : '';
    const asked = p.data.slot_label
      ? `You asked for <b>${esc(String(p.data.slot_label))}</b>. I'll send a calendar invite and call link to confirm it.`
      : "I'll email you within two business days to lock in a time.";
    tasks.push(sendEmail(env, p.email, 'Got your request — talk soon',
      `<p>Hi ${esc(p.name.split(' ')[0])},</p><p>Thanks for booking a free 30-minute call. ${asked}</p>${book}<p>— Nathan</p>`,
      env.NOTIFY_EMAIL));
  }
  await Promise.allSettled(tasks);
}

export default {
  async fetch(request: Request, env: SiteEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const moved = notesRedirect(url, env.NOTES_ORIGIN);
    if (moved) return moved;
    // The consultation request form became the Book a Call flow.
    if (url.pathname === '/consultation' || url.pathname === '/consultation/') {
      return Response.redirect(url.origin + '/book' + url.search, 301);
    }

    const m = url.pathname.match(/^\/forms\/(newsletter|consultation)$/);
    if (m) {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      let body: Record<string, unknown>;
      try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'Invalid request.' }, 400); }
      // Honeypot-free spam guard: reject cross-site browser posts.
      const origin = request.headers.get('origin');
      if (origin && new URL(origin).host !== url.host) return json({ error: 'Forbidden.' }, 403);

      const p = parseSubmission(m[1], body);
      if (!p.ok) return json({ error: p.error }, 400);
      const id = `SUB-${crypto.randomUUID().slice(0, 8)}`;
      await env.DB.prepare('INSERT INTO site_submissions (id, kind, email, name, data) VALUES (?,?,?,?,?)')
        .bind(id, p.kind, p.email, p.name, JSON.stringify(p.data)).run();
      ctx.waitUntil(fanOut(env, p, id));
      return json({ ok: true, id });
    }

    return env.ASSETS.fetch(request);
  },
};
