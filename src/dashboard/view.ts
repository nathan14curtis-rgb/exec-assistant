import type { Bucket, Capture, ItemWithContent } from '../types';
import { html, raw, type Raw } from './html';
import { AREA_SHORT, BUCKETS, BUCKET_ORDER } from './design';

// --- primitives -------------------------------------------------------------

/** A bucket glyph. Shape and fill carry the identity; hue is the last signal. */
export function glyph(bucket: Bucket, size = 12, color = true): Raw {
  const b = BUCKETS[bucket];
  const style = color ? `color:var(${b.hue})` : '';
  const fill = b.g1Fill ? 'currentColor' : 'none';
  const stroke = b.g1Fill ? 'none' : 'currentColor';
  return html`<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" style="flex:none;${raw(style)}"
    ><path d="${b.g1}" fill="${fill}" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path
    >${b.g2 ? html`<path d="${b.g2}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>` : ''}</svg>`;
}

export function chevronDown(size = 14): Raw {
  return html`<svg class="chev" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"
    ><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>`;
}

export function chevronRight(size = 11): Raw {
  return html`<svg class="chev-r" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"
    ><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>`;
}

const TICK = html`<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" style="flex:none"
  ><path d="M3.4 8.4l3 3 6.2-7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path></svg>`;

const ALERT = html`<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" style="flex:none"
  ><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"></circle
  ><path d="M8 4.8v4M8 11.1v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path></svg>`;

const MIC = html`<svg width="24" height="24" viewBox="0 0 16 16" aria-hidden="true" style="color:var(--ink-3)"
  ><rect x="6" y="2" width="4" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"></rect
  ><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"></path></svg>`;

const LINES = html`<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" style="flex:none"
  ><path d="M3 5h10M3 8.5h10M3 12h5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>`;

// --- formatting -------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Relative time, as the spec's capture headers read: "2 min ago", "12 min
 * ago", "1 hr ago", "yesterday", then a date in the user's zone.
 */
export function relativeTime(iso: string, now: Date, tz: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const diff = now.getTime() - then.getTime();
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} hr ago`;
  }
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: tz }).format(then);
  } catch {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(then);
  }
}

/** Format a stored `due_at` for the item meta line. */
export function formatDue(due: string, now: Date, tz: string): string {
  if (!due) return '';
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return due;
  const diff = d.getTime() - now.getTime();
  if (diff < 0) return 'overdue';
  if (diff < DAY) return 'due today';
  if (diff < 2 * DAY) return 'due tomorrow';
  try {
    const wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(d);
    if (diff < 7 * DAY) return `due ${wd.toLowerCase()}`;
    return `due ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: tz }).format(d)}`;
  } catch {
    return 'due';
  }
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** `due_at` for an <input type="date">, which wants YYYY-MM-DD. */
export function dueInputValue(due: string): string {
  if (!due) return '';
  const d = new Date(due);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// --- item -------------------------------------------------------------------

export interface ViewContext {
  now: Date;
  tz: string;
  /** Preserved across every action so a POST returns to the same view. */
  queryString: string;
  /** Item id whose drawer should start open, after an action on it. */
  openItem?: string;
  /** Capture id whose transcript should start open. */
  openCapture?: string;
  /** Sub-form to reveal inside a drawer: edit | meta | split. */
  openForm?: string;
}

function itemMeta(item: ItemWithContent, ctx: ViewContext): Raw {
  const spec = BUCKETS[item.bucket as Bucket] ?? BUCKETS.content_idea;
  const bits: Raw[] = [];
  if (item.area && AREA_SHORT[item.area]) bits.push(html`<span class="dim">· ${AREA_SHORT[item.area]}</span>`);
  if (item.content?.lockii_fit) bits.push(html`<span class="dim">· rel ${item.content.lockii_fit}</span>`);
  if (item.content?.stage) bits.push(html`<span class="dim">· ${item.content.stage}</span>`);
  const due = formatDue(item.due_at, ctx.now, ctx.tz);
  if (due) bits.push(html`<span class="dim">· ${due}</span>`);
  return html`<div class="meta" style="color:var(${raw(spec.hue)})">
    ${glyph(item.bucket as Bucket)}<span>${spec.label}</span>${bits}
    ${item.status === 'done' ? html`<span class="badge badge-good">done</span>` : ''}
  </div>`;
}

/** The move-to grid: six targets, one tap each, current bucket inert. */
function moveGrid(item: ItemWithContent, ctx: ViewContext): Raw {
  return html`<form method="post" action="/inbox/item/${item.id}/bucket${ctx.queryString}">
    <div class="drawer-label">Move to</div>
    <div class="moves">
      ${BUCKET_ORDER.map((b) => {
        const spec = BUCKETS[b];
        const current = b === item.bucket;
        return current
          ? html`<span class="btn" aria-current="true" style="color:var(${raw(spec.hue)})"
              >${glyph(b)}${spec.short}<span class="btn-now">now</span></span>`
          : html`<button class="btn" name="bucket" value="${b}" style="color:var(${raw(spec.hue)})"
              >${glyph(b)}${spec.short}</button>`;
      })}
    </div>
  </form>`;
}

function editForm(item: ItemWithContent, ctx: ViewContext, open: boolean): Raw {
  return html`<details class="confirm" ${open ? raw('open') : ''}>
    <summary class="btn">Edit text</summary>
    <form method="post" action="/inbox/item/${item.id}/edit${ctx.queryString}" style="margin-top:var(--s3)">
      <label class="field"><span>Title</span>
        <input name="title" value="${item.title}" maxlength="300" required></label>
      <label class="field"><span>Body</span>
        <textarea name="body" maxlength="8000">${item.body}</textarea></label>
      <div class="acts"><button class="btn btn-primary">Save</button>
        <a class="btn" href="/inbox${ctx.queryString}">Cancel</a></div>
    </form>
  </details>`;
}

function metaForm(item: ItemWithContent, ctx: ViewContext, open: boolean): Raw {
  return html`<details class="confirm" ${open ? raw('open') : ''}>
    <summary class="btn">Area · due</summary>
    <form method="post" action="/inbox/item/${item.id}/meta${ctx.queryString}" style="margin-top:var(--s3)">
      <div class="two">
        <label class="field"><span>Area</span>
          <select name="area">
            ${['', 'hafens', 'lockii', 'content', 'personal'].map(
              (a) => html`<option value="${a}" ${a === item.area ? raw('selected') : ''}>${a ? AREA_SHORT[a] : 'none'}</option>`,
            )}
          </select></label>
        <label class="field"><span>Due</span>
          <input type="date" name="due" value="${dueInputValue(item.due_at)}"></label>
      </div>
      <div class="acts"><button class="btn btn-primary">Save</button>
        <a class="btn" href="/inbox${ctx.queryString}">Cancel</a></div>
    </form>
  </details>`;
}

/**
 * Split: every word in the body is its own submit button carrying the
 * character offset it starts at. Tapping a word says "item two starts here"
 * — no JavaScript, one page load.
 */
function splitForm(item: ItemWithContent, ctx: ViewContext, open: boolean): Raw {
  const text = item.body.trim();
  if (!text) return raw('');
  const words: { word: string; at: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) words.push({ word: m[0], at: m.index });

  return html`<details class="confirm" ${open ? raw('open') : ''}>
    <summary class="btn">Split in two</summary>
    <form method="post" action="/inbox/item/${item.id}/split${ctx.queryString}" style="margin-top:var(--s3)">
      <div class="drawer-label">Tap where the second thought starts</div>
      <div class="words">
        ${words.map((w) =>
          w.at === 0
            ? html`<span class="word" style="color:var(--ink-3)">${w.word}</span>`
            : html`<button class="word" name="at" value="${String(w.at)}">${w.word}</button>`,
        )}
      </div>
      <p style="font-size:var(--text-small);color:var(--ink-3);margin:0">
        The second half becomes a new item in the same bucket, on this capture.</p>
    </form>
  </details>`;
}

function deleteForm(item: ItemWithContent, ctx: ViewContext): Raw {
  return html`<details class="confirm">
    <summary class="btn btn-danger">Delete this item…</summary>
    <p style="margin-top:var(--s3)">Delete this item? There is no undo.</p>
    <form method="post" action="/inbox/item/${item.id}/delete${ctx.queryString}" class="acts">
      <button class="btn btn-danger" style="border:1px solid var(--danger);justify-content:center;min-height:var(--tap);padding:0 var(--s3)">Delete for good</button>
      <a class="btn" href="/inbox${ctx.queryString}">Cancel</a>
    </form>
  </details>`;
}

/**
 * One item: the whole row is the `<summary>`, so tapping anywhere opens the
 * action drawer in place. Zero page loads to reach an action, one to commit.
 */
export function itemView(item: ItemWithContent, ctx: ViewContext): Raw {
  const open = ctx.openItem === item.id;
  const done = item.status === 'done';
  const form = open ? ctx.openForm : undefined;
  return html`<details class="item ${done ? 'item-done' : ''}" id="i-${item.id}" ${open ? raw('open') : ''}>
    <summary class="row">
      <div class="row-main">
        ${itemMeta(item, ctx)}
        <p class="title">${item.title || '(untitled)'}</p>
      </div>
      ${chevronDown()}
    </summary>
    <div class="drawer">
      ${item.body
        ? html`<p class="body">${item.body}</p>`
        : html`<p class="body body-none">${LINES} No body — title only</p>`}
      ${item.content?.tags
        ? html`<div class="tags">${item.content.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => html`<span class="tag">${t}</span>`)}
            ${item.content.theme ? html`<span class="tag">theme: ${item.content.theme}</span>` : ''}</div>`
        : ''}
      ${moveGrid(item, ctx)}
      <div class="acts">
        <form method="post" action="/inbox/item/${item.id}/status${ctx.queryString}">
          <button class="btn ${done ? '' : 'btn-primary'}" name="status" value="${done ? 'open' : 'done'}" style="width:100%"
            >${done ? raw('') : TICK}${done ? 'Reopen' : 'Mark done'}</button>
        </form>
        ${editForm(item, ctx, form === 'edit')}
        ${metaForm(item, ctx, form === 'meta')}
        ${splitForm(item, ctx, form === 'split')}
      </div>
      <div class="acts-row">${deleteForm(item, ctx)}</div>
    </div>
  </details>`;
}

// --- capture ----------------------------------------------------------------

function durationLabel(capture: Capture): string {
  return capture.input_kind === 'text' ? 'text' : capture.input_kind === 'voice+text' ? 'voice + text' : 'voice';
}

function transcriptPanel(capture: Capture, ctx: ViewContext): Raw {
  const repaired = capture.transcript_repaired;
  const rawText = capture.transcript_raw;
  const shown = repaired || rawText;
  if (!shown && !capture.raw_text) return raw('');

  // A voice capture shows its transcript; a typed one shows the message.
  const label = rawText ? 'Transcript' : 'Original message';
  const text = shown || capture.raw_text;
  const open = ctx.openCapture === capture.id;

  return html`<details class="tx" ${open ? raw('open') : ''}>
    <summary class="tx-head">${chevronRight()}<span>${label} · ${String(wordCount(text))} words</span>
      ${repaired && rawText && repaired !== rawText
        ? html`<span class="r"><span class="badge" style="color:var(--idea)">repaired</span></span>`
        : ''}</summary>
    <div class="tx-body">
      <p>${text}</p>
      ${repaired && rawText && repaired !== rawText
        ? html`<details class="tx-raw">
            <summary class="tx-head">${chevronRight()}<span>Original, as heard</span></summary>
            <p style="margin-top:var(--s3);color:var(--ink-3)">${rawText}</p>
          </details>`
        : ''}
      ${capture.audio_r2_key
        ? html`<audio class="audio" controls preload="none" src="/inbox/capture/${capture.id}/audio"></audio>`
        : ''}
      <form method="post" action="/inbox/capture/${capture.id}/rerun${ctx.queryString}" style="margin-top:var(--s3)">
        <details class="confirm">
          <summary class="btn">Re-run AI on this capture</summary>
          <p style="margin-top:var(--s3)">Discards the current items and sorts the transcript again.</p>
          <div class="acts">
            <button class="btn btn-primary">Re-run</button>
            <a class="btn" href="/inbox${ctx.queryString}">Cancel</a>
          </div>
        </details>
      </form>
    </div>
  </details>`;
}

export function captureView(capture: Capture, items: ItemWithContent[], ctx: ViewContext): Raw {
  const when = relativeTime(capture.created_at, ctx.now, ctx.tz);
  const head = html`<div class="cap-head">
    <span>${when} · ${durationLabel(capture)}</span>
    <span class="r">${
      capture.status === 'processing'
        ? html`<span class="tag-working">working</span>`
        : capture.status === 'error'
          ? html`<span class="tag-failed">${ALERT} failed</span>`
          : items.length > 1
            ? html`${String(items.length)} items`
            : ''
    }</span>
  </div>`;

  if (capture.status === 'processing') {
    return html`<article class="card">
      ${head}
      <div class="bar"><i></i></div>
      <div class="state">
        <h2>Transcribing and sorting</h2>
        <p>Usually 10–20 seconds. Your recording is saved.</p>
      </div>
      <div class="split-acts" style="grid-template-columns:1fr">
        <a class="btn" href="/inbox${ctx.queryString}">Refresh</a>
      </div>
    </article>`;
  }

  if (capture.status === 'error') {
    const heard = capture.transcript_repaired || capture.transcript_raw || capture.raw_text;
    return html`<article class="card">
      ${head}
      <div class="state">
        <h2>Sorting failed — nothing was lost</h2>
        <p>${capture.error || 'The pipeline could not classify this one.'}</p>
        ${heard ? html`<p class="quote">“${heard}”</p>` : ''}
      </div>
      <div class="split-acts">
        <form method="post" action="/inbox/capture/${capture.id}/rerun${ctx.queryString}">
          <button class="btn" style="color:var(--accent)">Re-run AI</button></form>
        <form method="post" action="/inbox/capture/${capture.id}/keep${ctx.queryString}">
          <button class="btn">Keep as note</button></form>
      </div>
    </article>`;
  }

  // A capture with two or more items gets a spine in the left gutter; one
  // item gets none, so it reads as a single record rather than a container.
  const braced = items.length > 1;
  return html`<article class="card">
    ${head}
    <div class="items ${braced ? 'braced' : 'single'}">${items.map((i) => itemView(i, ctx))}</div>
    ${transcriptPanel(capture, ctx)}
  </article>`;
}

export { MIC };
