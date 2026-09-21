-- Capture = one voice note / message. Items = the N things derived from it.
-- D1 is the source of truth; the Google Sheet is a one-way mirror.

CREATE TABLE IF NOT EXISTS captures (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  channel             TEXT NOT NULL,
  source_id           TEXT NOT NULL,
  input_kind          TEXT NOT NULL,
  raw_text            TEXT NOT NULL DEFAULT '',
  transcript_raw      TEXT NOT NULL DEFAULT '',
  transcript_repaired TEXT NOT NULL DEFAULT '',
  audio_r2_key        TEXT NOT NULL DEFAULT '',
  item_count          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'processing',
  error               TEXT NOT NULL DEFAULT ''
);
-- One capture per inbound message, whatever the queue retries.
CREATE UNIQUE INDEX IF NOT EXISTS captures_source ON captures (channel, source_id);
CREATE INDEX IF NOT EXISTS captures_created ON captures (created_at DESC);

CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,
  capture_id      TEXT NOT NULL REFERENCES captures (id),
  bucket          TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'open',
  area            TEXT NOT NULL DEFAULT '',
  due_at          TEXT NOT NULL DEFAULT '',
  related_item_id TEXT NOT NULL DEFAULT '',
  data            TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_capture ON items (capture_id);
CREATE INDEX IF NOT EXISTS items_bucket_status ON items (bucket, status, created_at DESC);

-- Content-idea enrichment stays as real columns: the drafting task reads and
-- writes these, so they must be queryable without unpacking JSON.
CREATE TABLE IF NOT EXISTS content_ideas (
  item_id               TEXT PRIMARY KEY REFERENCES items (id),
  cleaned_idea          TEXT NOT NULL DEFAULT '',
  type                  TEXT NOT NULL DEFAULT '',
  theme                 TEXT NOT NULL DEFAULT '',
  tags                  TEXT NOT NULL DEFAULT '',
  suggested_new_tags    TEXT NOT NULL DEFAULT '',
  audience_pain         TEXT NOT NULL DEFAULT '',
  content_format        TEXT NOT NULL DEFAULT '',
  lockii_fit            INTEGER NOT NULL DEFAULT 0,
  lockii_fit_reason     TEXT NOT NULL DEFAULT '',
  possible_duplicate_of TEXT NOT NULL DEFAULT '',
  stage                 TEXT NOT NULL DEFAULT 'enriched',
  titles_draft          TEXT NOT NULL DEFAULT '',
  hooks_draft           TEXT NOT NULL DEFAULT '',
  clip_moments_draft    TEXT NOT NULL DEFAULT '',
  cta_deliverable_draft TEXT NOT NULL DEFAULT '',
  picked_on             TEXT NOT NULL DEFAULT '',
  posted_url            TEXT NOT NULL DEFAULT '',
  notes                 TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS content_ideas_stage ON content_ideas (stage);

CREATE TABLE IF NOT EXISTS themes (
  theme       TEXT PRIMARY KEY COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  idea_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  tag         TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  level     TEXT NOT NULL,
  event     TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO tags (tag, description) VALUES
  ('branding', 'Brand identity, positioning, naming'),
  ('ad-creative', 'Ads, creative testing, copy'),
  ('graphic-design', 'Visual design work and assets'),
  ('logo', 'Logo design and iterations'),
  ('physical-space', 'The bay, layout, build-out, signage'),
  ('customer-comms', 'Messaging customers, support, expectations'),
  ('booking', 'Reservations, scheduling, availability'),
  ('access-control', 'Locks, doors, codes, contactless entry'),
  ('pricing', 'Rates, packages, discounts, margins'),
  ('unstaffed-ops', 'Running the business without staff on site'),
  ('shrinkage', 'Theft, damage, loss, abuse of the space'),
  ('hiring', 'Finding and managing people'),
  ('growth-pains', 'Scaling problems and bottlenecks'),
  ('expansion', 'New locations, new markets'),
  ('capital', 'Funding, loans, cash flow'),
  ('mistakes', 'Things that went wrong and lessons learned'),
  ('numbers', 'Revenue, costs, metrics, unit economics'),
  ('tools-stack', 'Software and hardware used to run the business');
