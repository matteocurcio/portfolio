-- Additive migration on the shared app-data database. Everything is prefixed portfolio_;
-- never touches another app's tables. The Worker also runs these statements on first use,
-- so a deploy without `wrangler d1 migrations apply` still works.
CREATE TABLE IF NOT EXISTS portfolio_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  doc        TEXT NOT NULL,
  version    INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT ''
);
-- Every replaced copy, newest kept (the Worker trims to the last 200). Restore by copying a row back.
CREATE TABLE IF NOT EXISTS portfolio_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    INTEGER NOT NULL,
  doc        TEXT NOT NULL,
  saved_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  saved_by   TEXT NOT NULL DEFAULT ''
);
-- Old exports kept for reference (e.g. the EUR-based history from before the AUD rebase).
-- Never loaded as live data. GET /api/archive lists them, GET /api/archive?id=N returns one.
CREATE TABLE IF NOT EXISTS portfolio_archive (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL UNIQUE,
  doc        TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL DEFAULT ''
);
