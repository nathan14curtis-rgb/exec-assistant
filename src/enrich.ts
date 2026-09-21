import type { Env, Enrichment } from './types';
import type { Theme } from './store';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

const TYPES = ['theme', 'idea', 'concept'];
const FORMATS = ['youtube_pillar', 'short', 'linkedin_post', 'carousel', 'newsletter'];

export interface EnrichContext {
  themes: Theme[];
  tagVocab: string[];
  recentIdeas: { id: string; title: string }[];
}

const SERIES_CONTEXT = `
You are helping Nathan capture content ideas for a series called
"Building a billion-dollar brand from my basement".

Business: Hafen's Garage — a self-serve DIY auto bay rental in Utah. Customers
book a bay and work on their own car; the location runs unstaffed.

Why the content exists: it is a newsletter lead magnet for Lockii, a contactless
rental booking and access platform. The audience is operators building
contactless / unstaffed rental businesses.

Platforms: YouTube is the pillar, clipped down to TikTok / Instagram / Facebook /
Shorts, plus LinkedIn text posts.
`.trim();

export function buildPrompt(raw: string, ctx: EnrichContext): string {
  const themeList = ctx.themes.length
    ? ctx.themes.map((t) => `- ${t.theme}: ${t.description}`).join('\n')
    : '(none yet)';
  const recent = ctx.recentIdeas.length
    ? ctx.recentIdeas.map((i) => `- ${i.id}: ${i.title}`).join('\n')
    : '(none yet)';

  return `${SERIES_CONTEXT}

Classify and enrich the captured idea below.

DEFINITIONS
- theme: a broad recurring pillar (e.g. "Unstaffed operations").
- idea: a specific video or post.
- concept: a framework, belief, or angle that can span many pieces.

EXISTING THEMES
${themeList}

CONTROLLED TAG VOCABULARY
${ctx.tagVocab.join(', ')}

RECENT IDEAS (for duplicate detection)
${recent}

RULES
- Prefer an existing theme. Create a new theme only if nothing fits; then set
  is_new_theme to true and write new_theme_description.
- Only put tags from the controlled vocabulary in "tags". Anything else goes in
  "suggested_new_tags" for human review — never invent a tag in "tags".
- lockii_fit (1-5) measures relevance to contactless rental operators.
  5 = directly about booking, access control, unstaffed operations, or pricing.
- possible_duplicate_of is an id from RECENT IDEAS, or null.
- Write cleaned_idea in Nathan's own voice: direct, concrete, first person.

CAPTURED IDEA
"""
${raw}
"""

Respond with JSON only — no prose, no markdown fences — matching exactly:
{
  "title": "short working title, <= 10 words",
  "cleaned_idea": "2-4 sentence clean summary in Nathan's voice",
  "type": "theme | idea | concept",
  "theme": "existing theme name, or a new one",
  "is_new_theme": true,
  "new_theme_description": "only if is_new_theme, else null",
  "tags": ["from controlled vocab"],
  "suggested_new_tags": [],
  "audience_pain": "the operator problem this addresses",
  "content_format": "youtube_pillar | short | linkedin_post | carousel | newsletter",
  "lockii_fit": 1,
  "lockii_fit_reason": "one sentence",
  "possible_duplicate_of": null
}`;
}

/** Tolerate a model that wraps its JSON in prose or a code fence. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object in model output');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function str(v: unknown, field: string, max = 2000): string {
  if (typeof v !== 'string') throw new Error(`${field} must be a string`);
  return v.trim().slice(0, max);
}

function strArray(v: unknown, field: string): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${field} must be an array`);
  return v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

/**
 * Validate the model's JSON against the schema, and enforce the tag-vocabulary
 * rule locally so an out-of-vocab tag can never reach the sheet.
 */
export function validateEnrichment(value: unknown, tagVocab: string[]): Enrichment {
  if (typeof value !== 'object' || value === null) throw new Error('output is not an object');
  const v = value as Record<string, unknown>;

  const type = str(v.type, 'type', 20).toLowerCase();
  if (!TYPES.includes(type)) throw new Error(`type must be one of ${TYPES.join(', ')}`);

  const content_format = str(v.content_format, 'content_format', 40).toLowerCase();
  if (!FORMATS.includes(content_format)) {
    throw new Error(`content_format must be one of ${FORMATS.join(', ')}`);
  }

  const fit = Math.round(Number(v.lockii_fit));
  if (!Number.isFinite(fit) || fit < 1 || fit > 5) {
    throw new Error('lockii_fit must be an integer 1-5');
  }

  const vocab = new Set(tagVocab.map((t) => t.toLowerCase()));
  const rawTags = strArray(v.tags, 'tags').map((t) => t.toLowerCase());
  const tags = [...new Set(rawTags.filter((t) => vocab.has(t)))];
  const suggested = [
    ...new Set([
      ...strArray(v.suggested_new_tags, 'suggested_new_tags').map((t) => t.toLowerCase()),
      ...rawTags.filter((t) => !vocab.has(t)),
    ]),
  ];

  const is_new_theme = v.is_new_theme === true;
  const dup = v.possible_duplicate_of;

  return {
    title: str(v.title, 'title', 200),
    cleaned_idea: str(v.cleaned_idea, 'cleaned_idea'),
    type: type as Enrichment['type'],
    theme: str(v.theme, 'theme', 120),
    is_new_theme,
    new_theme_description: is_new_theme
      ? str(v.new_theme_description ?? '', 'new_theme_description', 500)
      : null,
    tags,
    suggested_new_tags: suggested,
    audience_pain: str(v.audience_pain ?? '', 'audience_pain'),
    content_format: content_format as Enrichment['content_format'],
    lockii_fit: fit as Enrichment['lockii_fit'],
    lockii_fit_reason: str(v.lockii_fit_reason ?? '', 'lockii_fit_reason', 500),
    possible_duplicate_of:
      typeof dup === 'string' && dup.trim() && dup.trim().toLowerCase() !== 'null'
        ? dup.trim()
        : null,
  };
}

async function callModel(env: Env, prompt: string): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      messages: [
        { role: 'user', content: prompt },
        // Prefill the opening brace so the reply can only be a JSON object.
        { role: 'assistant', content: '{' },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic call failed: ${res.status} ${await res.text()}`);

  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (json.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  return `{${text}`;
}

/** Enrich raw text. Retries once on invalid JSON, then gives up. */
export async function enrich(
  env: Env,
  raw: string,
  ctx: EnrichContext,
): Promise<Enrichment> {
  const prompt = buildPrompt(raw, ctx);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callModel(
        env,
        attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous reply was not valid JSON matching the schema. Return JSON only.`,
      );
      return validateEnrichment(extractJson(text), ctx.tagVocab);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`enrichment failed: ${(lastError as Error)?.message ?? lastError}`);
}
