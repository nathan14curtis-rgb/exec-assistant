export interface Env {
  // Bindings
  AI: Ai;
  DEDUPE: KVNamespace;
  AUDIO: R2Bucket;
  IDEA_QUEUE: Queue<IdeaJob>;

  // Vars
  TRANSCRIBE_PROVIDER: string;

  // Secrets
  SENDBLUE_API_KEY_ID: string;
  SENDBLUE_API_SECRET_KEY: string;
  SENDBLUE_WEBHOOK_SECRET: string;
  SENDBLUE_FROM_NUMBER: string;
  ALLOWED_FROM_NUMBER: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_SA_EMAIL: string;
  GOOGLE_SA_PRIVATE_KEY: string;
  SHEET_ID: string;
  GROQ_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
}

/** Job payload placed on the queue by the webhook handler. */
export interface IdeaJob {
  messageId: string;
  content: string;
  mediaUrl: string | null;
  dateSent: string;
}

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

export type Source = 'voice' | 'text' | 'voice+text';
export type Status = 'enriched' | 'drafted' | 'picked' | 'filmed' | 'posted' | 'error';

export interface IdeaRow {
  id: string;
  created_at: string;
  source: Source;
  raw_text: string;
  transcript: string;
  audio_r2_key: string;
  title: string;
  cleaned_idea: string;
  type: string;
  theme: string;
  tags: string;
  suggested_new_tags: string;
  audience_pain: string;
  content_format: string;
  lockii_fit: string;
  lockii_fit_reason: string;
  possible_duplicate_of: string;
  status: Status;
  titles_draft: string;
  hooks_draft: string;
  clip_moments_draft: string;
  cta_deliverable_draft: string;
  picked_on: string;
  posted_url: string;
  notes: string;
  error: string;
}
