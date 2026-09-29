-- Root-site form submissions (newsletter signups + consultation requests).
CREATE TABLE IF NOT EXISTS site_submissions (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('newsletter','consultation')),
  email      TEXT NOT NULL,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,           -- JSON: interests/stage or the consultation answers
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_site_submissions_kind ON site_submissions(kind, created_at);
