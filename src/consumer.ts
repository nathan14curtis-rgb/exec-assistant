import type { Capture, CaptureJob, ContentIdea, Enrichment, Env, InputKind, Item } from './types';
import { newId, audioKey } from './ids';
import { transcribe } from './transcribe';
import { enrich } from './enrich';
import { getStore, type Store } from './store';
import { confirmationText, sendMessage, ERROR_TEXT } from './sendblue';

/** Matches max_retries in wrangler.toml: 3 deliveries, then give up gracefully. */
const MAX_ATTEMPTS = 3;

function extFromMime(mime: string): string {
  if (mime.includes('caf')) return 'caf';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg')) return 'mp3';
  return 'caf';
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
  if (job.mediaUrl && !capture.audio_r2_key) {
    const res = await fetch(job.mediaUrl);
    if (!res.ok) throw new Error(`media download failed: ${res.status}`);
    const mime = res.headers.get('content-type') ?? 'audio/x-caf';
    const bytes = new Uint8Array(await res.arrayBuffer());

    const r2Key = audioKey(job.sourceId, extFromMime(mime), now);
    await env.AUDIO.put(r2Key, bytes, { httpMetadata: { contentType: mime } });
    await store.updateCapture(capture.id, { audio_r2_key: r2Key });

    // 2. Transcribe.
    const result = await transcribe(env, bytes, mime);
    transcript = result.text;
    await store.updateCapture(capture.id, { transcript_raw: transcript });
    await store.log(
      job.sourceId, 'info', 'transcribed',
      `provider=${result.provider} remuxed=${result.remuxed} chars=${transcript.length}`,
    );
  } else if (job.mediaUrl && !transcript) {
    // Audio archived on a previous attempt but transcription didn't land.
    const obj = await env.AUDIO.get(capture.audio_r2_key);
    if (!obj) throw new Error('archived audio missing from R2');
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const result = await transcribe(env, bytes, obj.httpMetadata?.contentType ?? 'audio/x-caf');
    transcript = result.text;
    await store.updateCapture(capture.id, { transcript_raw: transcript });
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

  // 3. Enrich. Until the segmenter lands (Phase 3) every capture is exactly
  //    one content idea, so this is the existing single-call flow.
  const [themes, tagVocab, recentIdeas] = await Promise.all([
    store.getThemes(),
    store.getTagVocab(),
    store.getRecentContentIdeas(50),
  ]);
  const enrichment = await enrich(env, combined, { themes, tagVocab, recentIdeas });

  // 4. Persist item + content row, bump the theme, close out the capture.
  const { item, content } = enrichmentToItem(enrichment, capture.id, new Date());
  await store.createItem(item, content);
  await store.upsertTheme(enrichment.theme, enrichment.new_theme_description ?? '');
  await store.updateCapture(capture.id, { status: 'processed', item_count: 1, error: '' });

  // 5. Receipt.
  if (job.notify) {
    const duplicateTitle = enrichment.possible_duplicate_of
      ? recentIdeas.find((i) => i.id === enrichment.possible_duplicate_of)?.title ?? null
      : null;
    await sendMessage(env, confirmationText(enrichment, duplicateTitle));
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
