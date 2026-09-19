# Idea Capture → Google Sheets

Text or send an iMessage voice note to a dedicated Sendblue line. A Cloudflare
Worker transcribes it, enriches/themes/tags it with Claude Haiku, appends a row
to a Google Sheet, and texts back a confirmation.

The Sheet is the single source of truth. A separate weekly Claude Cowork task
(out of scope here) reads rows with `status = enriched` and fills the
`*_draft` columns.

```
iMessage (voice or text)
  → Sendblue receive webhook
  → Worker /webhook   (verify → allowlist → dedupe → enqueue → 200)
  → Cloudflare Queue
  → Worker queue consumer
       1. download media_url → R2
       2. transcribe
       3. LLM enrichment → strict JSON
       4. append to Ideas, upsert Themes
       5. confirmation text via Sendblue
```

The webhook acks immediately because transcription plus the LLM call take
several seconds; the queue also gives retries for free.

## Repo layout

```
src/
  index.ts          router: /webhook, /health
  webhook.ts        secret verify, allowlist, dedupe, enqueue
  consumer.ts       queue consumer + failure handling
  transcribe/       provider interface, Workers AI / Groq / Deepgram, CAF remux
  enrich.ts         prompt + JSON schema validation
  sheets.ts         service-account auth + append/get/upsert
  sendblue.ts       outbound send + confirmation formatting
  ids.ts            idea ids and R2 keys
scripts/setup-sheet.ts
test/
```

## Phase 0: audio format decision

Apple voice notes arrive as `.caf` (Core Audio Format, Opus codec), and Workers
cannot run ffmpeg.

**Decision: Workers AI Whisper, fed a remuxed Ogg Opus stream.** Verified
end to end against real iMessage voice notes.

What the spike established:

- Voice notes arrive as **CAF containing Opus**, so the remux path is the one
  that matters in practice.
- **Workers AI does not accept raw CAF**, hence `acceptsCaf: false` on that
  provider — a `.caf` file is remuxed before it is sent.
- **`cafToOggOpus()` output is accepted**, and the returned transcript is
  accurate. No ffmpeg, no Cloudflare Container, no third-party
  transcription key.
- Groq and Deepgram remain implemented and switchable, but were not needed.

One bug surfaced during the spike and is worth remembering when touching the
parser: `CAFPacketTableHeader` is **24 bytes** (`mNumberPackets` +
`mNumberValidFrames` as SInt64, then `mPrimingFrames` + `mRemainderFrames` as
SInt32), not 32. Reading the packet descriptions from the wrong offset lands
mid-table and raises `CAF: truncated varint in packet table`. The synthetic
CAF builder in `test/caf.test.ts` follows Apple's spec exactly so that this
case stays covered — if that builder drifts, the test can agree with a broken
parser and pass while real files fail.

The provider stays swappable if that ever changes:

- `src/transcribe/index.ts` defines `Transcriber` — `transcribe(bytes, mime)`
  plus an `acceptsCaf` flag — and picks the implementation from the
  `TRANSCRIBE_PROVIDER` var (`workersai` | `groq` | `deepgram`).
- **Default: Workers AI** (`@cf/openai/whisper-large-v3-turbo`) — native
  binding, no extra key, no egress.
- Workers AI and Groq Whisper are marked `acceptsCaf: false`; Deepgram is
  marked `true` (it accepts the widest range of containers).
- When the file is CAF and the provider can't read CAF, `cafToOggOpus()`
  remuxes it first: a pure-TS repackage of the existing Opus packets into Ogg
  pages. **No re-encode** — it parses the CAF `desc`/`pakt`/`data` chunks,
  slices the packets back out using the packet table, and writes `OpusHead` +
  `OpusTags` + data pages with correct Ogg CRCs. Covered by
  `test/caf.test.ts`, which validates every page CRC independently.

### Running the spike

1. Send a real voice note to the line.
2. `npx wrangler tail` and copy the logged `media_url`, or pull the archived
   file straight out of R2:
   `npx wrangler r2 object get idea-capture-audio/audio/2026/09/<id>.caf --file=note.caf`
3. `file note.caf` / `ffprobe note.caf` to confirm the container and codec.
4. Try providers in order — Workers AI, Groq, Deepgram — by flipping
   `TRANSCRIBE_PROVIDER` in `wrangler.toml` and redeploying.
5. If one of them accepts raw CAF, set its `acceptsCaf: true` so the remux is
   skipped. If none does, the remux path is already the default behaviour.
6. Record the winner here.

Last resort, if the remux turns out not to satisfy a provider: a tiny
Cloudflare Container running ffmpeg, called from the consumer. Not implemented.

## Setup from zero

### 1. Cloudflare resources

```bash
npm install
npx wrangler login

npx wrangler kv namespace create DEDUPE          # paste the id into wrangler.toml
npx wrangler r2 bucket create idea-capture-audio
npx wrangler queues create idea-capture
```

Workers AI needs no creation step — the `[ai]` binding is enough.

### 2. Google Sheet

1. Create a Google Cloud project, enable the **Google Sheets API**, and create a
   **service account**. Download its JSON key.
2. Create a spreadsheet. Its `SHEET_ID` is the long id in the URL.
3. Share the spreadsheet with the service account's email as **Editor**.
4. Create the tabs, headers and seed tags:

```bash
GOOGLE_SA_EMAIL="svc@project.iam.gserviceaccount.com" \
GOOGLE_SA_PRIVATE_KEY="$(jq -r .private_key key.json)" \
SHEET_ID="1AbC..." \
npm run setup-sheet
```

The script is idempotent — re-running it leaves existing tabs and data alone.

The Worker signs its own RS256 JWT with WebCrypto and exchanges it for an access
token, cached in isolate memory and KV until just before expiry. No
`googleapis` package; the Sheets REST v4 API is called directly.

### 3. Secrets

```bash
for s in SENDBLUE_API_KEY_ID SENDBLUE_API_SECRET_KEY SENDBLUE_WEBHOOK_SECRET \
         SENDBLUE_FROM_NUMBER ALLOWED_FROM_NUMBER ANTHROPIC_API_KEY \
         GOOGLE_SA_EMAIL GOOGLE_SA_PRIVATE_KEY SHEET_ID; do
  npx wrangler secret put "$s"
done
```

- `SENDBLUE_FROM_NUMBER` — the dedicated Sendblue line.
- `ALLOWED_FROM_NUMBER` — Nathan's phone. Everything else is silently ignored.
- `GOOGLE_SA_PRIVATE_KEY` — the full PEM. Literal `\n` escapes are handled.
- Add `GROQ_API_KEY` or `DEEPGRAM_API_KEY` only if you switch providers.

For local dev, put the same keys in `.dev.vars` (gitignored).

### 4. Deploy and point Sendblue at it

```bash
npx wrangler deploy
```

In the Sendblue dashboard set the receive webhook to
`https://<worker>.workers.dev/webhook` and set its signing secret to the same
value as `SENDBLUE_WEBHOOK_SECRET`. `GET /health` is a liveness check.

### Rotating secrets

Rotate one at a time; `wrangler secret put <NAME>` overwrites in place and the
next request picks up the new value.

- **Sendblue webhook secret** — set the new value in the dashboard *and* run
  `wrangler secret put SENDBLUE_WEBHOOK_SECRET`. Requests signed with the old
  secret get a 401, so do both within the same minute.
- **Google service-account key** — create the new key, run
  `wrangler secret put GOOGLE_SA_PRIVATE_KEY`, verify a message flows through,
  then delete the old key in Google Cloud. Cached tokens keep working for up to
  an hour; `wrangler kv key delete --binding=DEDUPE google:token` clears the
  cache immediately.
- **Anthropic / Groq / Deepgram keys** — straight overwrite, no coordination.

## Sheet schema

**Ideas** — `id`, `created_at`, `source`, `raw_text`, `transcript`,
`audio_r2_key`, `title`, `cleaned_idea`, `type`, `theme`, `tags`,
`suggested_new_tags`, `audience_pain`, `content_format`, `lockii_fit`,
`lockii_fit_reason`, `possible_duplicate_of`, `status`, `titles_draft`,
`hooks_draft`, `clip_moments_draft`, `cta_deliverable_draft`, `picked_on`,
`posted_url`, `notes`, `error`

- `id` — `IDEA-20260918-7K3` (dated prefix keeps it sortable)
- `source` — `voice` | `text` | `voice+text`
- `status` — `enriched → drafted → picked → filmed → posted`, or `error`
- `tags` — comma-separated string
- the `*_draft` columns are written by the Cowork task, never by the Worker

**Themes** — `theme`, `description`, `idea_count`, `created_at`. A new theme
appends a row; an existing one increments `idea_count`.

**Tags** — `tag`, `description`. Seeded by the setup script, read-only for the
Worker: the model may only pick from this vocabulary, and anything else lands in
`suggested_new_tags` for human review.

**Log** — `timestamp`, `message_id`, `level`, `event`, `detail`. Errors and key
events only.

## Behaviour notes

- **Dedupe** — the Sendblue `message_handle` is claimed in KV with a 7-day TTL
  as part of the check, so a retried webhook delivery produces exactly one row.
- **Media first** — media URLs expire, so the consumer downloads and archives to
  `audio/{yyyy}/{mm}/{messageId}.caf` in R2 before doing anything else.
- **Both text and audio** — concatenated, typed text first.
- **Enrichment** — Claude Haiku 4.5, JSON-only via an assistant prefill,
  validated against the schema. Invalid JSON retries once, then the job fails.
- **Failure** — up to 3 deliveries. On the final one the consumer still appends
  a row with `status = error`, the raw text, and the error message, then texts
  `❌ Couldn't process that idea — saved raw.` Nothing is dropped silently.

## Development

```bash
npm test          # vitest
npm run typecheck
npm run dev       # wrangler dev
```

## Out of scope

- Cowork draft generation (reads/writes the `*_draft` columns separately)
- Performance feedback loop (views, UTM signups back into the sheet)
- SMS commands like "undo" or "list ideas"
