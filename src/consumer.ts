import type { Env, IdeaJob, IdeaRow, Source } from './types';
import { newIdeaId, audioKey } from './ids';
import { transcribe } from './transcribe';
import { enrich } from './enrich';
import {
  appendIdea,
  getRecentIdeas,
  getTagVocab,
  getThemes,
  log,
  upsertTheme,
} from './sheets';
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

function emptyRow(): IdeaRow {
  return {
    id: '', created_at: '', source: 'text', raw_text: '', transcript: '',
    audio_r2_key: '', title: '', cleaned_idea: '', type: '', theme: '', tags: '',
    suggested_new_tags: '', audience_pain: '', content_format: '', lockii_fit: '',
    lockii_fit_reason: '', possible_duplicate_of: '', status: 'enriched',
    titles_draft: '', hooks_draft: '', clip_moments_draft: '',
    cta_deliverable_draft: '', picked_on: '', posted_url: '', notes: '', error: '',
  };
}

export function resolveSource(rawText: string, transcript: string): Source {
  if (rawText && transcript) return 'voice+text';
  if (transcript) return 'voice';
  return 'text';
}

/** Text first, then the transcript, when a message carries both. */
export function combineText(rawText: string, transcript: string): string {
  return [rawText, transcript].filter(Boolean).join('\n\n');
}

export async function processJob(job: IdeaJob, env: Env): Promise<void> {
  const now = new Date();
  let r2Key = '';
  let transcript = '';

  // 1. Archive the media first — Sendblue media URLs expire.
  if (job.mediaUrl) {
    const res = await fetch(job.mediaUrl);
    if (!res.ok) throw new Error(`media download failed: ${res.status}`);
    const mime = res.headers.get('content-type') ?? 'audio/x-caf';
    const bytes = new Uint8Array(await res.arrayBuffer());

    r2Key = audioKey(job.messageId, extFromMime(mime), now);
    await env.AUDIO.put(r2Key, bytes, { httpMetadata: { contentType: mime } });

    // 2. Transcribe.
    const result = await transcribe(env, bytes, mime);
    transcript = result.text;
    await log(
      env, job.messageId, 'info', 'transcribed',
      `provider=${result.provider} remuxed=${result.remuxed} chars=${transcript.length}`,
    );
  }

  const combined = combineText(job.content, transcript);
  if (!combined.trim()) throw new Error('nothing to enrich: no text and empty transcript');

  // 3. Enrich.
  const [themes, tagVocab, recentIdeas] = await Promise.all([
    getThemes(env),
    getTagVocab(env),
    getRecentIdeas(env, 50),
  ]);
  const enrichment = await enrich(env, combined, { themes, tagVocab, recentIdeas });

  // 4. Write the idea row, then keep the Themes tab in step.
  const row: IdeaRow = {
    ...emptyRow(),
    id: newIdeaId(now),
    created_at: now.toISOString(),
    source: resolveSource(job.content, transcript),
    raw_text: job.content,
    transcript,
    audio_r2_key: r2Key,
    title: enrichment.title,
    cleaned_idea: enrichment.cleaned_idea,
    type: enrichment.type,
    theme: enrichment.theme,
    tags: enrichment.tags.join(', '),
    suggested_new_tags: enrichment.suggested_new_tags.join(', '),
    audience_pain: enrichment.audience_pain,
    content_format: enrichment.content_format,
    lockii_fit: String(enrichment.lockii_fit),
    lockii_fit_reason: enrichment.lockii_fit_reason,
    possible_duplicate_of: enrichment.possible_duplicate_of ?? '',
    status: 'enriched',
  };
  await appendIdea(env, row);
  await upsertTheme(env, enrichment.theme, enrichment.new_theme_description ?? '');

  // 5. Confirm by text.
  const duplicateTitle = enrichment.possible_duplicate_of
    ? recentIdeas.find((i) => i.id === enrichment.possible_duplicate_of)?.title ?? null
    : null;
  await sendMessage(env, confirmationText(enrichment, duplicateTitle));
}

/** Final-attempt fallback: never drop an idea silently. */
async function recordFailure(job: IdeaJob, env: Env, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const now = new Date();
  try {
    await appendIdea(env, {
      ...emptyRow(),
      id: newIdeaId(now),
      created_at: now.toISOString(),
      source: job.mediaUrl ? (job.content ? 'voice+text' : 'voice') : 'text',
      raw_text: job.content,
      status: 'error',
      error: message.slice(0, 2000),
    });
  } catch (sheetErr) {
    console.error('failed to append error row', sheetErr);
  }
  await log(env, job.messageId, 'error', 'process_failed', message);
  await sendMessage(env, ERROR_TEXT).catch((e) => console.error('error text failed', e));
}

export async function handleQueue(
  batch: MessageBatch<IdeaJob>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processJob(message.body, env);
      message.ack();
    } catch (err) {
      console.error('job failed', message.body.messageId, err);
      if (message.attempts >= MAX_ATTEMPTS) {
        await recordFailure(message.body, env, err);
        message.ack(); // handled — don't loop forever
      } else {
        message.retry();
      }
    }
  }
}
