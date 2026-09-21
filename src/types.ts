export interface Env {
  // Bindings
  AI: Ai;
  DEDUPE: KVNamespace;
  AUDIO: R2Bucket;
  DB: D1Database;
  CAPTURE_QUEUE: Queue<CaptureJob>;

  // Vars
  TRANSCRIBE_PROVIDER: string;
  TRANSCRIBE_KEYTERMS?: string;
  /** IANA zone used for any "by Friday"-style date parsing downstream. */
  USER_TZ: string;
  /** Cloudflare Access team domain, e.g. myteam.cloudflareaccess.com. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application AUD tag. */
  ACCESS_AUD?: string;

  // Secrets
  SENDBLUE_API_KEY_ID: string;
  SENDBLUE_API_SECRET_KEY: string;
  SENDBLUE_WEBHOOK_SECRET: string;
  SENDBLUE_FROM_NUMBER: string;
  ALLOWED_FROM_NUMBER: string;
  ANTHROPIC_API_KEY: string;
  /** Bearer token for machine clients (the Cowork task, Shortcuts, curl). */
  API_TOKEN?: string;
  /** Sheets mirror. All three optional: unset SHEET_ID disables the mirror. */
  GOOGLE_SA_EMAIL?: string;
  GOOGLE_SA_PRIVATE_KEY?: string;
  SHEET_ID?: string;
  GROQ_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
}

// --- Capture pipeline -------------------------------------------------------

/** Where a capture came from. Sendblue is one adapter; anything can POST /capture. */
export type Channel = 'sendblue' | 'api';

/** Job payload placed on the queue by any inbound adapter. */
export interface CaptureJob {
  channel: Channel;
  /** Idempotency key within the channel (Sendblue message_handle, client id). */
  sourceId: string;
  text: string;
  mediaUrl: string | null;
  receivedAt: string;
  /** Text a receipt back over Sendblue when done. */
  notify: boolean;
}

export type InputKind = 'voice' | 'text' | 'voice+text';
export type CaptureStatus = 'processing' | 'processed' | 'error';

/** One voice note / text message. The parent of N items. */
export interface Capture {
  id: string;
  created_at: string;
  channel: Channel;
  source_id: string;
  input_kind: InputKind;
  raw_text: string;
  /** Exactly what the transcriber returned. Never overwritten. */
  transcript_raw: string;
  /** Jargon-repaired transcript. Empty until the repair step exists. */
  transcript_repaired: string;
  audio_r2_key: string;
  item_count: number;
  status: CaptureStatus;
  error: string;
}

export const BUCKETS = [
  'content_idea',
  'todo',
  'roadmap',
  'journal',
  'follow_up',
  'decision',
] as const;
export type Bucket = (typeof BUCKETS)[number];

export const AREAS = ['hafens', 'lockii', 'content', 'personal'] as const;
export type Area = (typeof AREAS)[number];

/** Generic lifecycle shared by every bucket; content ideas also carry a `stage`. */
export type ItemStatus = 'open' | 'done' | 'dismissed';

/** One derived thing from a capture. Bucket-specific fields live in `data`. */
export interface Item {
  id: string;
  capture_id: string;
  bucket: Bucket;
  title: string;
  body: string;
  status: ItemStatus;
  area: Area | '';
  due_at: string;
  related_item_id: string;
  /** JSON object string. */
  data: string;
  created_at: string;
  updated_at: string;
}

export type ContentStage = 'enriched' | 'drafted' | 'picked' | 'filmed' | 'posted';

/** Content-idea enrichment, kept as real columns so the drafting task can query them. */
export interface ContentIdea {
  item_id: string;
  cleaned_idea: string;
  type: string;
  theme: string;
  tags: string;
  suggested_new_tags: string;
  audience_pain: string;
  content_format: string;
  lockii_fit: number;
  lockii_fit_reason: string;
  possible_duplicate_of: string;
  stage: ContentStage;
  titles_draft: string;
  hooks_draft: string;
  clip_moments_draft: string;
  cta_deliverable_draft: string;
  picked_on: string;
  posted_url: string;
  notes: string;
}

export interface ItemWithContent extends Item {
  content: ContentIdea | null;
}

// --- Enrichment (unchanged) -------------------------------------------------

/** Strict shape returned by the enrichment LLM. */
export interface Enrichment {
  title: string;
  cleaned_idea: string;
  type: 'theme' | 'idea' | 'concept';
  theme: string;
  is_new_theme: boolean;
  new_theme_description: string | null;
  tags: string[];
  suggested_new_tags: string[];
  audience_pain: string;
  content_format:
    | 'youtube_pillar'
    | 'short'
    | 'linkedin_post'
    | 'carousel'
    | 'newsletter';
  lockii_fit: 1 | 2 | 3 | 4 | 5;
  lockii_fit_reason: string;
  possible_duplicate_of: string | null;
}
