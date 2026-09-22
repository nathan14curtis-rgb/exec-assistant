import type { Bucket, Capture, ItemWithContent } from '../types';
import { html, query, raw, type Raw } from './html';
import { STYLES } from './styles';
import { BUCKETS, BUCKET_ORDER, STAGE_ORDER, STATUS_ORDER } from './design';
import { captureView, glyph, MIC, type ViewContext } from './view';

export interface InboxFilters {
  bucket?: string;
  status?: string;
  stage?: string;
}

export interface InboxData {
  captures: Capture[];
  itemsByCapture: Map<string, ItemWithContent[]>;
  counts: Record<string, number>;
  totalItems: number;
  filters: InboxFilters;
  ctx: ViewContext;
}

function shell(title: string, body: Raw): Response {
  const doc = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>${raw(STYLES)}</style>
</head>
<body>${body}</body>
</html>`;
  return new Response(doc.value, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** Link to the inbox with one filter changed, or cleared when re-clicked. */
function filterHref(f: InboxFilters, key: keyof InboxFilters, value: string): string {
  const next: InboxFilters = { ...f, [key]: f[key] === value ? undefined : value };
  return `/inbox${query({ bucket: next.bucket, status: next.status, stage: next.stage })}`;
}

function chipRow(f: InboxFilters): Raw {
  const chips: { label: string; href: string; on: boolean }[] = [
    { label: 'All', href: '/inbox', on: !f.bucket && !f.status && !f.stage },
    { label: 'Ideas', href: filterHref(f, 'bucket', 'content_idea'), on: f.bucket === 'content_idea' },
    { label: 'To-do', href: filterHref(f, 'bucket', 'todo'), on: f.bucket === 'todo' },
    { label: 'Open', href: filterHref(f, 'status', 'open'), on: f.status === 'open' },
    { label: 'Done', href: filterHref(f, 'status', 'done'), on: f.status === 'done' },
  ];
  return html`<nav class="chips" aria-label="Filters">
    ${chips.map((c) => html`<a class="chip" href="${c.href}" aria-current="${c.on ? 'true' : 'false'}">${c.label}</a>`)}
  </nav>`;
}

/**
 * Desktop rail: the full bucket list with counts, plus statuses and idea
 * stages. Replaces the phone's chip row rather than supplementing it.
 */
function rail(f: InboxFilters, counts: Record<string, number>, total: number): Raw {
  return html`<nav class="rail" aria-label="Filters">
    <h2>Bucket</h2>
    <a class="rail-link" href="/inbox${query({ status: f.status, stage: f.stage })}" aria-current="${!f.bucket ? 'true' : 'false'}"
      >All<span class="n">${String(total)}</span></a>
    ${BUCKET_ORDER.map(
      (b) => html`<a class="rail-link" href="${filterHref(f, 'bucket', b)}" aria-current="${f.bucket === b ? 'true' : 'false'}"
        >${glyph(b)}${BUCKETS[b].label}<span class="n">${String(counts[b] ?? 0)}</span></a>`,
    )}
    <h2>Status</h2>
    <div class="rail-chips">
      ${STATUS_ORDER.map(
        (s) => html`<a class="chip" href="${filterHref(f, 'status', s)}" aria-current="${f.status === s ? 'true' : 'false'}">${s}</a>`,
      )}
    </div>
    <h2>Idea stage</h2>
    <div class="rail-chips">
      ${STAGE_ORDER.map(
        (s) => html`<a class="chip" href="${filterHref(f, 'stage', s)}" aria-current="${f.stage === s ? 'true' : 'false'}">${s}</a>`,
      )}
    </div>
  </nav>`;
}

function emptyState(f: InboxFilters): Raw {
  const filtered = !!(f.bucket || f.status || f.stage);
  if (!filtered) {
    return html`<div class="empty">
      ${MIC}
      <h2>Nothing captured yet</h2>
      <p>Text or call the line. It shows up here about a minute later.</p>
    </div>`;
  }
  const on = [f.bucket && BUCKETS[f.bucket as Bucket]?.label, f.status, f.stage].filter(Boolean) as string[];
  return html`<div class="empty">
    <div class="rail-chips" style="justify-content:center;margin-bottom:var(--s4)">
      ${on.map((label) => html`<span class="chip" aria-current="true">${label}</span>`)}
    </div>
    <h2>Nothing matches</h2>
    <p>${on.length > 1 ? `${on.length} filters are on.` : 'One filter is on.'}</p>
    <a class="btn" href="/inbox" style="display:inline-flex">Show everything</a>
  </div>`;
}

export function renderInbox(data: InboxData): Response {
  const { captures, itemsByCapture, counts, totalItems, filters, ctx } = data;
  const body = html`<div class="wrap">
    <header class="top">
      <h1>Inbox</h1>
      <span class="count">${String(captures.length)} capture${captures.length === 1 ? '' : 's'}${
        totalItems ? ` · ${totalItems} item${totalItems === 1 ? '' : 's'}` : ''
      }</span>
      <form method="post" action="/inbox/logout" class="top-sp">
        <button class="chip" style="border:0;background:none;padding:7px 0">Sign out</button>
      </form>
    </header>
    ${chipRow(filters)}
    <div class="layout">
      ${rail(filters, counts, totalItems)}
      <main>
        ${captures.length
          ? html`<div class="cards">${captures.map((c) => captureView(c, itemsByCapture.get(c.id) ?? [], ctx))}</div>`
          : emptyState(filters)}
      </main>
    </div>
  </div>`;
  return shell('Inbox', body);
}

/**
 * Step one: ask for a code. There is no phone field — the number is fixed in
 * config, so there is nothing here to enumerate or redirect.
 */
export function renderLogin(error?: string, notice?: string): Response {
  const body = html`<div class="login">
    <h1>Inbox</h1>
    <p>A sign-in code will be texted to your phone.</p>
    ${error ? html`<p class="err">${error}</p>` : ''}
    ${notice ? html`<p style="color:var(--ink-2);font-size:var(--text-small);margin:0 0 var(--s4)">${notice}</p>` : ''}
    <form method="post" action="/inbox/login/send">
      <button class="btn btn-primary" style="width:100%">Text me a code</button>
    </form>
  </div>`;
  return shell('Inbox — sign in', body);
}

/** Step two: enter the six digits. */
export function renderCodeEntry(error?: string): Response {
  const body = html`<div class="login">
    <h1>Enter your code</h1>
    <p>We texted a 6-digit code. It expires in 10 minutes.</p>
    ${error ? html`<p class="err">${error}</p>` : ''}
    <form method="post" action="/inbox/login/verify">
      <label class="field"><span>Code</span>
        <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*"
          maxlength="7" autofocus required
          style="font:600 22px/1 var(--mono);letter-spacing:.24em;text-align:center"></label>
      <button class="btn btn-primary" style="width:100%">Sign in</button>
    </form>
    <form method="post" action="/inbox/login/send" style="margin-top:var(--s4)">
      <button class="btn" style="width:100%">Send a new code</button>
    </form>
  </div>`;
  return shell('Inbox — enter code', body);
}
