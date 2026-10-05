-- Global Pini Arcade leaderboard. Apply with:
--   npx wrangler d1 execute <database-name> --remote --file=migrations/0001_create_scores.sql
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 12),
  score INTEGER NOT NULL CHECK (score > 0),
  category TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS scores_by_category ON scores (category, score DESC, id);
