# Capture → Sort → File

Text or send an iMessage voice note to a dedicated Sendblue line (or POST to
`/capture` from anything else). A Cloudflare Worker archives the audio,
transcribes it with Deepgram Nova-3, enriches it with Claude, stores the
result in D1, mirrors it to a Google Sheet, and texts back a receipt.

**D1 is the source of truth. The Sheet is a one-way mirror.** Correct things in
the `/inbox` dashboard or through the API — edits made in the Sheet do not flow
back.

```
iMessage ──► Sendblue webhook ──► /webhook  ┐
Shortcut / curl / dictation ──► /capture    ├─► Cloudflare Queue ─► consumer
                                            ┘        1. media → R2
                                                     2. transcribe (Deepgram Nova-3)
                                                     3. enrich (Claude)     ← Phase 3 replaces this
                                                     4. D1 capture + items     with segment→classify→
                                                     5. Sheets mirror          enrich-per-bucket
                                                     6. receipt text
```

## Data model

One **capture** per inbound message. N **items** per capture, each in a
**bucket**: `content_idea` · `todo` · `roadmap` · `journal` · `follow_up` ·
`decision`. Today the pipeline emits exactly one `content_idea` per capture;
the multi-item segmenter is the next phase and needs no schema change.

| Table | What |
|---|---|
| `captures` | `id CAP-…`, channel, `raw_text`, **`transcript_raw`** (never overwritten), `transcript_repaired`, `audio_r2_key`, `item_count`, `status` processing/processed/error |
| `items` | `id ITM-…`, `capture_id`, `bucket`, `title`, `body`, `status` open/done/dismissed, `area` hafens/lockii/content/personal, `due_at`, `related_item_id`, `data` JSON for bucket-specific fields |
| `content_ideas` | one row per `content_idea` item — theme, tags, `lockii_fit`, `stage` enriched→drafted→picked→filmed→posted, and the `*_draft` columns the drafting task writes |
| `themes`, `tags`, `log` | as before, moved into D1 (theme counts are now an atomic upsert) |

Schema: `migrations/0001_init.sql`. Mirror tabs: `Captures`, `Items`,
`ContentIdeas`, `Themes` (`src/store/mirror.ts`).

## Repo layout

```
src/
  index.ts            router: /inbox /webhook /capture /api/* /health
  webhook.ts          Sendblue adapter → CaptureJob
  capture.ts          generic adapter (bearer token) → CaptureJob
  consumer.ts         queue consumer: archive → transcribe → enrich → store
  api.ts              JSON API for the drafting task and the dashboard
  auth.ts             bearer token + Cloudflare Access JWT verification
  dashboard/
    index.ts          /inbox routes, auth, filters
    page.ts           page shell, filter rail, empty states
    view.ts           capture cards, item rows, action drawer, transcript
    actions.ts        move / done / edit / split / delete / re-run / keep
    design.ts         bucket glyphs and labels
    styles.ts         the stylesheet
    html.ts           escaping template tag
  store/
    index.ts          Store interface — everything persists through this
    d1.ts             D1 implementation (source of truth)
    mirror.ts         Sheets tab layouts + row writers
    mirrored.ts       decorator: D1 first, then best-effort mirror
  transcribe/         Transcriber interface; deepgram (default) / workersai / groq; CAF remux
  enrich.ts           content-idea prompt + JSON validation
  sheets.ts           low-level Sheets auth + values calls
  sendblue.ts         outbound send + receipt formatting
  ids.ts              CAP-/ITM- ids and R2 keys
migrations/           D1 schema (wrangler d1 migrations)
scripts/
  setup-sheet.ts      creates the mirror tabs + headers
  migrate-sheets-to-d1.ts  legacy Ideas/Themes tabs → SQL
preview/render.ts     renders the dashboard to a file with fake data
test/
```

## The dashboard

`/inbox` is server-rendered HTML with no framework and no build step. Every
action is a form POST that redirects back to the same filter and scroll
position; the only client-side behaviour is `<details>` toggling.

- **A capture is the card, its items are the ink.** The header is the lightest
  thing on it. Two or more items get a 2px spine in the left gutter; one item
  gets none, so a single-item capture reads as one record.
- **Actions are in-card, never a detail view.** The whole item row is a
  `<summary>`; tapping it opens a drawer holding the six bucket targets, done,
  edit, area/due, split and delete. Zero page loads to reach an action, one to
  commit it — and correction is the job.
- **Split** renders the body as one submit button per word: tapping a word says
  "the second thought starts here", and the tail becomes a new item on the same
  capture.
- **The transcript** sits at the foot of the card, collapsed. When the repair
  step lands it shows the corrected text with the untouched original as a second
  disclosure inside it; the raw transcript is never overwritten.
- **Buckets** are told apart by glyph silhouette first, the word in mono caps
  second, and hue last, so they survive greyscale and both themes.
- Phone is one column; at 900px a 220px filter rail replaces the chip row and
  the bucket grid goes six across.

`npm run preview` renders the page to `preview/out.html` with representative
fake data — a processing capture, a three-item one, a failure and a done item —
so layout changes can be checked in a browser without deploying.

## Transcription

Default is **Deepgram Nova-3** with keyterm prompting: `TRANSCRIBE_KEYTERMS`
(comma-separated) biases recognition toward your vocabulary — Lockii, Hafen's,
shrinkage. Leave it empty for the built-in list in `src/transcribe/deepgram.ts`.
Deepgram accepts Apple's `.caf` container directly, so the pure-TS CAF→Ogg
remux is only used if you switch to `workersai` or `groq`.

## API

All routes need either `Authorization: Bearer $API_TOKEN` (machines) or a
Cloudflare Access login (browser; see below).

```
GET   /inbox                          the dashboard
GET   /api/captures?limit=50
GET   /api/captures/:id               capture + its items
GET   /api/captures/:id/audio         archived audio
GET   /api/items?bucket=&status=&stage=&limit=
GET   /api/items/:id
PATCH /api/items/:id                  { title?, body?, status?, area?, due_at?, bucket?,
                                        related_item_id?,
                                        content?: { stage?, titles_draft?, hooks_draft?,
                                                    clip_moments_draft?, cta_deliverable_draft?,
                                                    picked_on?, posted_url?, notes?, ... } }
POST  /capture                        { text?, media_url?, source_id?, notify? }  → 202
```

The drafting task's loop becomes: `GET /api/items?bucket=content_idea&stage=enriched`
→ write drafts → `PATCH /api/items/:id {"content": {"stage": "drafted", "titles_draft": …}}`.

## Setup from zero

### 1. Cloudflare resources

```bash
npm install
npx wrangler login

npx wrangler kv namespace create DEDUPE        # paste the id into wrangler.toml
npx wrangler r2 bucket create idea-capture-audio
npx wrangler queues create idea-capture
npx wrangler d1 create idea-capture             # paste database_id into wrangler.toml
npm run d1:migrate                              # applies migrations/ to the remote DB
```

Audio retention: add an R2 lifecycle rule that expires objects under `audio/`
after 30 days (dashboard → bucket → Settings → Object lifecycle rules, or
`npx wrangler r2 bucket lifecycle add idea-capture-audio --prefix audio/ --expire-days 30`).

### 2. Google Sheet (mirror)

Same service account as before. Run the tab bootstrap:

```bash
GOOGLE_SA_EMAIL=... GOOGLE_SA_PRIVATE_KEY="$(cat key.pem)" SHEET_ID=... npm run setup-sheet
```

Leave `SHEET_ID` unset to run without a mirror at all.

### 3. Secrets

```bash
for s in SENDBLUE_API_KEY_ID SENDBLUE_API_SECRET_KEY SENDBLUE_WEBHOOK_SECRET \
         SENDBLUE_FROM_NUMBER ALLOWED_FROM_NUMBER ANTHROPIC_API_KEY DEEPGRAM_API_KEY \
         API_TOKEN GOOGLE_SA_EMAIL GOOGLE_SA_PRIVATE_KEY SHEET_ID; do
  npx wrangler secret put $s
done
```

`API_TOKEN` is anything long and random (`openssl rand -hex 32`). For local dev
put the same keys in `.dev.vars`.

### 4. Cloudflare Access (browser auth for `/api` and the dashboard)

1. Zero Trust → Access → Applications → add self-hosted apps for
   `<worker>.workers.dev/inbox` and `/api/*`, policy: allow your email.
2. Copy the application's **AUD tag** and your team domain
   (`<team>.cloudflareaccess.com`) into `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` in
   `wrangler.toml`.

Bearer-token calls bypass Access, so keep the token secret. **Until Access is
set up**, `/inbox` shows a token form instead: sign in once with `API_TOKEN` and
it stores an HttpOnly, Secure, `SameSite=Lax` cookie scoped to `/inbox`. Access
is the better front door — it is free and keeps the token out of the browser.

### 5. Deploy

```bash
npx wrangler deploy
```

Point the Sendblue receive webhook at `https://<worker>.workers.dev/webhook`.

## Migrating from the Sheets-only version

The old `Ideas` tab becomes `captures` + `items` + `content_ideas`. Each legacy
row keeps its `IDEA-…` id as the item id, so existing references still resolve.

1. **Make a copy of the spreadsheet in Drive first.**
2. Generate and review the SQL (nothing is written by this step):
   ```bash
   GOOGLE_SA_EMAIL=... GOOGLE_SA_PRIVATE_KEY="$(cat key.pem)" SHEET_ID=... \
     npm run migrate:sql > migrations/data/legacy-ideas.sql
   ```
3. Apply it: `npx wrangler d1 execute idea-capture --remote --file=migrations/data/legacy-ideas.sql`
   (idempotent — `INSERT OR IGNORE` throughout).
4. Rename the `Ideas` tab to `Ideas_archive`. `Tags` and `Log` can be deleted;
   both now live in D1.
5. Repoint the drafting task at `/api/items` (see API above).

`migrations/data/` is gitignored — the dump contains your transcripts.

## Behaviour notes

- **Idempotent consumer.** A capture is keyed on `(channel, source_id)`, and a
  retried job reuses it: audio already in R2 is not re-downloaded, an existing
  transcript is not re-transcribed, and a capture that already has items is not
  re-enriched. Retries cost nothing extra.
- **Raw transcript is never overwritten.** `transcript_repaired` is a separate
  column for the jargon-repair step to fill.
- **Mirror failures never fail a job.** They are logged to the `log` table as
  `mirror_failed` so they are visible, not silent.
- **Failure.** Up to 3 deliveries. On the final one the capture is marked
  `status = error` with the message, and (for Sendblue captures) you get
  `❌ Couldn't process that idea — saved raw.`

## Development

```bash
npm test                 # vitest
npm run typecheck
npm run d1:migrate:local # apply schema to the local D1
npm run dev              # wrangler dev
```

## Roadmap

1. ~~D1 + mirror + generic capture + API~~
2. ~~`/inbox` dashboard — read **and** write~~ (this)
3. Segment → classify → enrich per bucket; intent gate (capture / question / noise);
   dedupe across buckets; receipt lists titles; `undo`
4. Google Tasks sink with sync-back cron
5. Text-back Q&A over D1 FTS
6. Weekly digest
