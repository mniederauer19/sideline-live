const fs = require('fs');
const path = require('path');
// Uses the SQLite database built into Node.js (22.13+), so there is nothing to compile.
process.removeAllListeners('warning'); // hide the "SQLite is experimental" notice on older Node versions
const { DatabaseSync } = require('node:sqlite');
const { DB_FILE } = require('./config');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Same helper better-sqlite3 has: run a function inside one transaction
let txDepth = 0;
db.transaction = (fn) => (...args) => {
  if (txDepth > 0) return fn(...args); // already inside one: just run
  txDepth++;
  db.exec('BEGIN');
  try { const r = fn(...args); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { txDepth--; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  season INTEGER, week INTEGER,
  start_time INTEGER,
  state TEXT,              -- pre | in | post
  data TEXT NOT NULL,      -- normalized game JSON
  graded INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS plays (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  ppr REAL NOT NULL DEFAULT 0,
  scoring INTEGER NOT NULL DEFAULT 0,
  explosive INTEGER NOT NULL DEFAULT 0,
  player_ids TEXT NOT NULL DEFAULT '',   -- ",123,456," for fast LIKE lookups
  hash TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_game ON plays(game_id, seq);
CREATE INDEX IF NOT EXISTS plays_ts ON plays(ts);

CREATE TABLE IF NOT EXISTS reactions (
  play_id TEXT NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL,
  PRIMARY KEY (play_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS votes (
  play_id TEXT NOT NULL, user_id INTEGER NOT NULL, value INTEGER NOT NULL,
  PRIMARY KEY (play_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  play_id TEXT NOT NULL, user_id INTEGER NOT NULL,
  body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_play ON comments(play_id, id);

CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, game_id TEXT NOT NULL,
  market TEXT NOT NULL,          -- spread | total
  selection TEXT NOT NULL,       -- team abbr | over | under
  fav TEXT, line REAL NOT NULL,  -- line locked at the moment of the pick
  result TEXT,                   -- win | loss | push (null until graded)
  credits_delta INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, game_id, market)
);

CREATE TABLE IF NOT EXISTS lineups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, season INTEGER NOT NULL, week INTEGER NOT NULL,
  players TEXT NOT NULL,         -- JSON [{slot, id}]
  salary INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (user_id, season, week)
);
`);

CREATE_EXTRA();
function CREATE_EXTRA() {
  // Added for the full-season backfill (safe to run on an existing database)
  try { db.exec('ALTER TABLE games ADD COLUMN synced_at INTEGER'); } catch { /* already there */ }
  try { db.exec('ALTER TABLE users ADD COLUMN ext_id TEXT'); } catch { /* already there */ }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_ext ON users(ext_id) WHERE ext_id IS NOT NULL');
  db.exec(`
CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL, player_id TEXT NOT NULL,
  name TEXT, team TEXT, ppr REAL NOT NULL DEFAULT 0, line TEXT, stats TEXT,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS games_week ON games(season, week);
`);
}

module.exports = db;
