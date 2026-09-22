import type { Area, Bucket, Env } from './types';
import { AREAS, BUCKETS } from './types';
import { callModel, extractJson } from './enrich';

/**
 * Segmenter: one capture → N spans, each assigned a bucket.
 *
 * The unit rule the prompt is built around: one item is one thing you would
 * check off, decide, or film. A to-do with three sub-steps is one item; two
 * unrelated to-dos in one breath are two. The bias is toward over-splitting,
 * because the inbox has a "split" action but no "merge" — under-splitting a
 * two-minute memo means tapping words eight times to fix it.
 *
 * The model quotes where each span starts rather than returning character
 * offsets, which small models get wrong. Offsets are recovered locally.
 */

/** Hard ceiling on items from one capture. Anything past this is merged into the last span. */
export const MAX_SEGMENTS = 15;
/** A span with fewer words than this is noise or a fragment; it merges into its neighbour. */
export const MIN_WORDS = 3;

export interface Segment {
  bucket: Bucket;
  area: Area | '';
  /** Model-supplied working title; empty when the model gave none. */
  title: string;
  /** The span of the original text, trimmed. */
  text: string;
  /** ISO timestamp, or '' when no due date was heard. */
  due_at: string;
}

export interface SegmentContext {
  /** YYYY-MM-DD in the user's zone, so "by Friday" resolves to a date. */
  today: string;
  tz: string;
}

/** What the model is asked to return, before offsets are resolved. */
interface RawSegment {
  starts_with: string;
  bucket: Bucket;
  area: Area | '';
  title: string;
  due: string | null;
}

export function buildSegmentPrompt(raw: string, ctx: SegmentContext): string {
  return `You are sorting a voice memo or text message that Nathan sent himself.
Nathan runs Hafen's Garage (a self-serve DIY auto bay rental in Utah) and
Lockii (contactless rental booking and access software), and makes content
about building the business.

Split the captured text below into separate items and sort each one.

THE UNIT
One item = one thing Nathan would check off, decide, or film.
- A to-do with three sub-steps is ONE item.
- Two unrelated to-dos said in one breath are TWO items.
- When in doubt, split. Merging later is cheap; missing a to-do is not.

WHERE ITEMS START
Transcripts have weak punctuation. Topic shifts sound like: "also", "oh and",
"next thing", "another thing", "remind me to", "I need to", "I should",
"note to self", "and then", "second", "third", "the other thing is".
Each new item starts at the first word of the new thought, not at the filler
before it ("um", "okay so").

BUCKETS
- todo: a concrete action to take. Verbs: call, order, email, fix, check, buy, send.
- content_idea: a video, short, post, or angle for the content series.
- roadmap: a product or business feature to build someday, not this week.
- journal: a reflection, feeling, or observation with no action attached.
- follow_up: waiting on someone else; check back with them.
- decision: a choice to make, framed as "whether" or "should I".

AREAS
- hafens: the garage business.
- lockii: the software product.
- content: videos, posts, the newsletter.
- personal: everything else.
Leave area empty ("") only if none fits.

DUE DATES
Today is ${ctx.today} (${ctx.tz}). If an item names a day or deadline
("by Friday", "before Thursday", "next week"), set "due" to that date as
YYYY-MM-DD. Otherwise null.

CAPTURED TEXT
"""
${raw}
"""

RULES
- "starts_with" is the first 4 to 8 words of the item, copied EXACTLY from the
  captured text, in order, so the span can be located. Never paraphrase it.
- List items in the order they appear. The first item starts at the first
  real thought (skip leading filler).
- At most ${MAX_SEGMENTS} items. Never drop content: every part of the text
  belongs to some item.
- A single-topic capture is ONE item. Do not invent splits.

Respond with JSON only — no prose, no markdown fences — matching exactly:
{
  "items": [
    {
      "starts_with": "first 4-8 words copied exactly",
      "bucket": "todo | content_idea | roadmap | journal | follow_up | decision",
      "area": "hafens | lockii | content | personal | ",
      "title": "short working title, <= 10 words, imperative for to-dos",
      "due": "YYYY-MM-DD or null"
    }
  ]
}`;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Words of a quote as a lenient regex: case-insensitive, punctuation and whitespace tolerant. */
function quotePattern(quote: string): RegExp | null {
  const words = quote
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('[^\\p{L}\\p{N}]+'), 'iu');
}

/**
 * Find where a quote starts in the text, searching from `from` first so a
 * phrase that appears twice resolves to the later, in-order occurrence.
 */
export function locateQuote(text: string, quote: string, from = 0): number {
  const re = quotePattern(quote);
  if (!re) return -1;
  const tail = re.exec(text.slice(from));
  if (tail) return from + tail.index;
  const head = re.exec(text);
  return head ? head.index : -1;
}

/**
 * Transition filler that the model is told to skip when quoting a start:
 * "also", "oh and", "next thing", "the other thing is". Matched at the end
 * of the text before a span so the filler travels with the span it
 * introduces rather than dangling off the previous one.
 */
const CONNECTORS =
  /(?:(?:^|[\s,.;:!?-]+)(?:also|and\s+then|and|then|oh|next\s+thing|next|another\s+thing|the\s+other\s+thing(?:\s+is)?|okay|ok|so|um|uh|plus|too|second(?:ly)?|third(?:ly)?|fourth|lastly|finally|last\s+thing|one\s+more\s+thing|anyway|alright))+[\s,.;:!?-]*$/i;

/** Move a span start back over the connector words that introduce it. */
export function backOverConnectors(text: string, at: number): number {
  const m = CONNECTORS.exec(text.slice(0, at));
  if (!m) return at;
  const lead = /^[\s,.;:!?-]+/.exec(m[0]);
  return m.index + (lead ? lead[0].length : 0);
}

function words(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** A due date the model returned, as an ISO timestamp at noon in the user's zone-ish, or ''. */
export function dueToIso(due: unknown): string {
  if (typeof due !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due.trim());
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Validate the model's JSON, resolve each quoted start to an offset, cut the
 * text into spans, and apply the guardrails. Spans whose quote cannot be
 * found fold into the previous span; spans that are too short fold into a
 * neighbour; the list is capped at MAX_SEGMENTS.
 *
 * Throws only when the reply is not the expected shape at all. A reply with
 * zero locatable items degrades to one span of the whole text in the first
 * item's bucket, so a bad quote never loses content.
 */
export function validateSegments(value: unknown, text: string): Segment[] {
  if (typeof value !== 'object' || value === null) throw new Error('output is not an object');
  const list = (value as { items?: unknown }).items;
  if (!Array.isArray(list) || list.length === 0) throw new Error('items must be a non-empty array');

  const body = text.trim();
  const parsed: RawSegment[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const bucket = str(e.bucket, 30).toLowerCase() as Bucket;
    if (!BUCKETS.includes(bucket)) throw new Error(`bucket must be one of ${BUCKETS.join(', ')}`);
    const areaRaw = str(e.area, 20).toLowerCase();
    const area = (AREAS as readonly string[]).includes(areaRaw) ? (areaRaw as Area) : '';
    parsed.push({
      starts_with: str(e.starts_with, 200),
      bucket,
      area,
      title: str(e.title, 200),
      due: typeof e.due === 'string' ? e.due : null,
    });
  }
  if (!parsed.length) throw new Error('no usable items');

  // Resolve starts to offsets, in order. The first span always starts at 0
  // so leading filler is kept rather than lost. A span whose quote cannot be
  // found folds into the previous one. A previous span that turns out to be
  // nothing but the connectors introducing this one is dropped in its favour.
  const starts: { at: number; seg: RawSegment }[] = [];
  for (const seg of parsed) {
    if (!starts.length) {
      starts.push({ at: 0, seg });
      continue;
    }
    const found = locateQuote(body, seg.starts_with, starts[starts.length - 1].at + 1);
    if (found < 0) continue;
    let at = backOverConnectors(body, found);
    while (starts.length > 1 && at <= starts[starts.length - 1].at) starts.pop();
    if (at <= starts[starts.length - 1].at) at = found;
    if (at <= starts[starts.length - 1].at) continue;
    starts.push({ at, seg });
  }

  let segments: Segment[] = starts.map(({ at, seg }, i) => ({
    bucket: seg.bucket,
    area: seg.area,
    title: seg.title,
    text: body.slice(at, i + 1 < starts.length ? starts[i + 1].at : undefined).trim(),
    due_at: dueToIso(seg.due),
  }));

  // Fold fragments into the previous span; a leading fragment folds forward
  // and takes the next span's classification.
  const folded: Segment[] = [];
  for (const seg of segments) {
    if (words(seg.text) < MIN_WORDS && folded.length) {
      folded[folded.length - 1].text = `${folded[folded.length - 1].text} ${seg.text}`.trim();
    } else {
      folded.push({ ...seg });
    }
  }
  if (folded.length > 1 && words(folded[0].text) < MIN_WORDS) {
    const head = folded.shift() as Segment;
    folded[0].text = `${head.text} ${folded[0].text}`.trim();
  }
  segments = folded.filter((s) => s.text);

  // Cap: everything past the limit joins the last kept span.
  if (segments.length > MAX_SEGMENTS) {
    const kept = segments.slice(0, MAX_SEGMENTS);
    const rest = segments.slice(MAX_SEGMENTS).map((s) => s.text).join(' ');
    kept[MAX_SEGMENTS - 1].text = `${kept[MAX_SEGMENTS - 1].text} ${rest}`.trim();
    segments = kept;
  }

  return segments;
}

/** Split raw text into classified spans. Retries once on invalid JSON, then gives up. */
export async function segment(env: Env, raw: string, ctx: SegmentContext): Promise<Segment[]> {
  const prompt = buildSegmentPrompt(raw, ctx);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callModel(
        env,
        attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous reply was not valid JSON matching the schema. Return JSON only.`,
        2000,
      );
      return validateSegments(extractJson(text), raw);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`segmentation failed: ${(lastError as Error)?.message ?? lastError}`);
}
