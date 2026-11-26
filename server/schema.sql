-- Skyward Parkour leaderboard (Cloudflare D1)
-- npx wrangler d1 execute skyward --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,            -- random id made on the device
  token_hash  TEXT NOT NULL,               -- sha256 of the device's secret: only that device can update this row
  name        TEXT NOT NULL,
  tag         TEXT NOT NULL,               -- 4 hex chars shown after the name (names may repeat)
  best_height REAL NOT NULL DEFAULT 0,     -- Adventure mode
  height_at   INTEGER NOT NULL DEFAULT 0,  -- when best_height was reached (earlier wins ties)
  best_height_c REAL NOT NULL DEFAULT 0,   -- Challenge mode (every run from 0 m)
  height_at_c   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_submit INTEGER NOT NULL DEFAULT 0,
  submits     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS players_height ON players (best_height DESC, height_at ASC);
CREATE INDEX IF NOT EXISTS players_height_c ON players (best_height_c DESC, height_at_c ASC);
