CREATE TABLE trends (
  term TEXT NOT NULL,
  day_jst TEXT NOT NULL,
  traffic INTEGER NOT NULL DEFAULT 0,
  news_json TEXT NOT NULL DEFAULT '[]',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  UNIQUE (term, day_jst)
);
CREATE INDEX idx_trends_last_seen ON trends (last_seen);
CREATE INDEX idx_trends_day_jst ON trends (day_jst);

CREATE TABLE ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  scores_json TEXT NOT NULL DEFAULT '{}',
  total REAL NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'building', 'built', 'skipped')),
  claimed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ideas_created_at ON ideas (created_at);
CREATE INDEX idx_ideas_status_total ON ideas (status, total DESC);

CREATE TABLE builds (
  slug TEXT PRIMARY KEY,
  preview_url TEXT NOT NULL,
  pr_url TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result TEXT NOT NULL,
  note TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('retention_days', '400'), ('min_score', '60');
