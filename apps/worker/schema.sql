-- D1 schema for status-please. Apply with: bun run db:apply

-- One row per check run. Git-commit history in upptime is replaced by rows here,
-- which are cheap to query for uptime windows.
CREATE TABLE IF NOT EXISTS checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('up', 'degraded', 'down')),
  code          INTEGER NOT NULL,
  response_time INTEGER NOT NULL,
  checked_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checks_slug_time ON checks (slug, checked_at DESC);

-- checked_at-first index so the 90-day history aggregate (a range scan across
-- all slugs) is sargable and does not degrade as the table grows.
CREATE INDEX IF NOT EXISTS idx_checks_time ON checks (checked_at);

-- Incident lifecycle: Investigating → Identified → Monitoring → Resolved.
CREATE TABLE IF NOT EXISTS incidents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  severity    TEXT    NOT NULL,
  started_at  TEXT    NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS incident_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES incidents (id),
  state       TEXT    NOT NULL CHECK (state IN ('investigating', 'identified', 'monitoring', 'resolved')),
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);
