import type { Capture, CaptureJob, ContentIdea, Enrichment, Env, InputKind, Item } from './types';
import { newId, audioKey } from './ids';
import { transcribe } from './transcribe';
import { sniffAudio } from './transcribe/sniff';
import { enrich, type EnrichContext } from './enrich';
import { segment, type Segment } from './segment';
import { getStore, type Store } from './store';
import { receiptText, sendMessage, ERROR_TEXT } from './sendblue';
import { titleFrom } from './dashboard/actions';

/** Matches max_retries in wrangler.toml: 3 deliveries, then give up gracefully. */
const MAX_ATTEMPTS = 3;

/**
 * What the consumer must do about audio before it can enrich.
 *
 * Keyed on what is stored rather than on whether the job carried a media
 * URL: a re-run from the dashboard deliberately carries none, and a capture
 * whose transcription failed still has its audio in R2. Gating the R2 path
 * on `job.mediaUrl` made such a capture permanently unrecoverable.
 */
export type AudioStep = 'download' | 'from-r2' | 'none';

export function audioStep(
  capture: Pick<Capture, 'audio_r2_key' | 'transcript_raw'>,
  job: Pick<CaptureJob, 'mediaUrl'>,
): AudioStep {
  if (job.mediaUrl && !capture.audio_r2_key) return 'download';
  if (capture.audio_r2_key && !capture.transcript_raw) return 'from-r2';
  return 'none';
}

export function resolveInputKind(rawText: string, hasAudio: boolean): InputKind {
  if (rawText && hasAudio) return 'voice+text';
  if (hasAudio) return 'voice';
  return 'text';
}

/** Text first, then the transcript, when a message carries both. */
export function combineText(rawText: string, transcript: string): string {
  return [rawText, transcript].filter(Boolean).join('\n\n');
}

/** Map the LLM's enrichment onto an item + its content-idea row. */
export function enrichmentToItem(
  enrichment: Enrichment,
  captureId: string,
  now: Date,
): { item: Item; content: ContentIdea } {
  const ts = now.toISOString();
  const item: Item = {
    id: newId('ITM', now),
    capture_id: captureId,
    bucket: 'content_idea',
    title: enrichment.title,
    body: enrichment.cleaned_idea,
    status: 'open',
    area: 'content',
    due_at: '',
    related_item_id: enrichment.possible_duplicate_of ?? '',
    data: '{}',
    created_at: ts,
    updated_at: ts,
  };
  const content: ContentIdea = {
    item_id: item.id,
    cleaned_idea: enrichment.cleaned_idea,
    type: enrichment.type,
    theme: enrichment.theme,
    tags: enrichment.tags.join(', '),
    suggested_new_tags: enrichment.suggested_new_tags.join(', '),
    audience_pain: enrichment.audience_pain,
    content_format: enrichment.content_format,
    lockii_fit: enrichment.lockii_fit,
    lockii_fit_reason: enrichment.lockii_fit_reason,
    possible_duplicate_of: enrichment.possible_duplicate_of ?? '',
    stage: 'enriched',
    titles_draft: '',
    hooks_draft: '',
    clip_moments_draft: '',
    cta_deliverable_draft: '',
    picked_on: '',
    posted_url: '',
    notes: '',
  };
  return { item, content };
}

/** A non-idea segment becomes a plain item: the span is the body, no enrichment row. */
export function segmentToItem(seg: Segment, captureId: string, now: Date): Item {
  const ts = now.toISOString();
  return {
    id: newId('ITM', now),
    capture_id: captureId,
    bucket: seg.bucket,
    title: seg.title || titleFrom(seg.text),
    body: seg.text,
    status: 'open',
    area: seg.area,
    due_at: seg.due_at,
    related_item_id: '',
    data: '{}',
    created_at: ts,
    updated_at: ts,
  };
}

/** YYYY-MM-DD in the user's zone, for the segmenter's due-date parsing. */
export function todayIn(now: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** One persisted-to-be item: a plain item, or a content idea with its enrichment. */
export interface BuiltItem {
  item: Item;
  content: ContentIdea | null;
  enrichment: Enrichment | null;
}

/**
 * Segment the text, then enrich only the content ideas. All model calls
 * finish before anything is written, so a failure part-way leaves the
 * capture with no items rather than half of them.
 *
 * Items are stamped one millisecond apart so the inbox, which orders by
 * created_at, shows them in the order they were spoken.
 */
export async function buildItems(
  env: Env,
  combined: string,
  captureId: string,
  now: Date,
  ctx: EnrichContext,
): Promise<BuiltItem[]> {
  const segments = await segment(env, combined, { today: todayIn(now, env.USER_TZ || 'UTC'), tz: env.USER_TZ || 'UTC' });
  return Promise.all(
    segments.map(async (seg, i): Promise<BuiltItem> => {
      const at = new Date(now.getTime() + i);
      if (seg.bucket !== 'content_idea') return { item: segmentToItem(seg, captureId, at), content: null, enrichment: null };
      const enrichment = await enrich(env, seg.text, ctx);
      const { item, content } = enrichmentToItem(enrichment, captureId, at);
      return { item, content, enrichment };
    }),
  );
}

/**
 * Find the capture row for this job or create it. The (channel, source_id)
 * unique index means a retried job reuses the same capture instead of
 * creating a second one.
 */
async function ensureCapture(store: Store, job: CaptureJob, now: Date): Promise<Capture> {
  const existing = await store.findCaptureBySource(job.channel, job.sourceId);
  if (existing) return existing;
  const capture: Capture = {
    id: newId('CAP', now),
    created_at: now.toISOString(),
    channel: job.channel,
    source_id: job.sourceId,
    input_kind: resolveInputKind(job.text, !!job.mediaUrl),
    raw_text: job.text,
    transcript_raw: '',
    transcript_repaired: '',
    audio_r2_key: '',
    item_count: 0,
    status: 'processing',
    error: '',
  };
  await store.createCapture(capture);
  return capture;
}

export async function processJob(job: CaptureJob, env: Env): Promise<void> {
  const store = getStore(env);
  const now = new Date();
  const capture = await ensureCapture(store, job, now);

  // 1. Archive the media first — Sendblue media URLs expire. Skip if a
  //    previous attempt already got this far.
  let transcript = capture.transcript_raw;
  const step = audioStep(capture, job);
  if (step === 'download') {
    // `audioStep` only returns 'download' when a media URL is present.
    const res = await fetch(job.mediaUrl as string);
    if (!res.ok) throw new Error(`media download failed: ${res.status}`);
    const mime = res.headers.get('content-type') ?? 'audio/x-caf';
    const bytes = new Uint8Array(await res.arrayBuffer());

    // Name and label the archived object by what the bytes are, not by the
    // CDN's content-type — that header is not ours to trust.
    const sniffed = sniffAudio(bytes, mime);
    const r2Key = audioKey(job.sourceId, sniffed.ext, now);
    await env.AUDIO.put(r2Key, bytes, { httpMetadata: { contentType: sniffed.mime } });
    await store.updateCapture(capture.id, { audio_r2_key: r2Key });

    // 2. Transcribe.
    const result = await transcribe(env, bytes, mime);
    transcript = result.text;
    await store.updateCapture(capture.id, { transcript_raw: transcript });
    await store.log(
      job.sourceId, 'info', 'transcribed',
      `provider=${result.provider} container=${result.container} sent=${result.mime}` +
        ` remuxed=${result.remuxed} chars=${transcript.length}`,
    );
  } else if (step === 'from-r2') {
    // Audio is archived but has no transcript — a previous attempt failed at
    // transcription, or this is a re-run, which carries no media URL.
    const obj = await env.AUDIO.get(capture.audio_r2_key);
    if (!obj) throw new Error('archived audio missing from R2');
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const result = await transcribe(env, bytes, obj.httpMetadata?.contentType ?? null);
    transcript = result.text;
    await store.updateCapture(capture.id, { transcript_raw: transcript });
    await store.log(
      job.sourceId, 'info', 'transcribed',
      `provider=${result.provider} container=${result.container} from=r2 chars=${transcript.length}`,
    );
  }

  const combined = combineText(job.text, transcript);
  if (!combined.trim()) throw new Error('nothing to enrich: no text and empty transcript');

  // A retry after the item was written (e.g. the receipt text failed) must
  // not enrich again: that would double the LLM spend and duplicate the item.
  const existing = await store.listItems({ capture_id: capture.id, limit: 10 });
  if (existing.length) {
    await store.updateCapture(capture.id, { status: 'processed', item_count: existing.length, error: '' });
    return;
  }

  // 3. Segment → classify → enrich per bucket. To-dos, decisions and the
  //    rest get a plain item; only content ideas pay for the enrichment call.
  const [themes, tagVocab, recentIdeas] = await Promise.all([
    store.getThemes(),
    store.getTagVocab(),
    store.getRecentContentIdeas(50),
  ]);
  const built = await buildItems(env, combined, capture.id, now, { themes, tagVocab, recentIdeas });

  // 4. Persist items + content rows, bump themes, close out the capture.
  for (const b of built) {
    await store.createItem(b.item, b.content ?? undefined);
    if (b.enrichment) await store.upsertTheme(b.enrichment.theme, b.enrichment.new_theme_description ?? '');
  }
  await store.updateCapture(capture.id, { status: 'processed', item_count: built.length, error: '' });
  await store.log(
    job.sourceId, 'info', 'segmented',
    `items=${built.length} buckets=${built.map((b) => b.item.bucket).join(',')}`,
  );

  // 5. Receipt: one line per item, so a wrong split shows up on the phone.
  if (job.notify) {
    const dupId = built.find((b) => b.enrichment?.possible_duplicate_of)?.enrichment?.possible_duplicate_of;
    const duplicateTitle = dupId ? recentIdeas.find((i) => i.id === dupId)?.title ?? null : null;
    await sendMessage(
      env,
      receiptText(built.map((b) => ({ bucket: b.item.bucket, title: b.item.title, enrichment: b.enrichment })), duplicateTitle),
    );
  }
}

/** Final-attempt fallback: never drop a capture silently. */
async function recordFailure(job: CaptureJob, env: Env, err: unknown): Promise<void> {
  const store = getStore(env);
  const message = err instanceof Error ? err.message : String(err);
  try {
    const capture = await ensureCapture(store, job, new Date());
    await store.updateCapture(capture.id, { status: 'error', error: message.slice(0, 2000) });
  } catch (storeErr) {
    console.error('failed to record error capture', storeErr);
  }
  await store.log(job.sourceId, 'error', 'process_failed', message);
  if (job.notify) {
    await sendMessage(env, ERROR_TEXT).catch((e) => console.error('error text failed', e));
  }
}

export async function handleQueue(batch: MessageBatch<CaptureJob>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processJob(message.body, env);
      message.ack();
    } catch (err) {
      console.error('job failed', message.body.sourceId, err);
      if (message.attempts >= MAX_ATTEMPTS) {
        await recordFailure(message.body, env, err);
        message.ack(); // handled — don't loop forever
      } else {
        message.retry();
      }
    }
  }
}
