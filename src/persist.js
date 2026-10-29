// Keeps people's data safe in Postgres when DATABASE_URL is set.
//
// Hosts with temporary disks (like Render's free tier) wipe local files on every
// restart. Plays, schedules and stats are rebuilt from ESPN automatically, but
// accounts, reactions, votes, comments, picks and lineups can't be, so they're
// copied to Postgres (e.g. a free Neon database) as they change, and copied back
// into the local SQLite database when the server starts.
//
// SQLite stays the fast working copy; Postgres is the safe copy.
const cfg = require('./config');
const db = require('./db');

const URL = process.env.DATABASE_URL || '';
const enabled = !!URL;

const INT = 'BIGINT', TXT = 'TEXT', REAL = 'DOUBLE PRECISION';
const TABLES = {
  users: { pk: ['id'], cols: { id: INT, name: TXT, token: TXT, credits: INT, created_at: INT, ext_id: TXT } },
  reactions: { pk: ['play_id', 'user_id', 'emoji'], cols: { play_id: TXT, user_id: INT, emoji: TXT } },
  votes: { pk: ['play_id', 'user_id'], cols: { play_id: TXT, user_id: INT, value: INT } },
  comments: { pk: ['id'], cols: { id: INT, play_id: TXT, user_id: INT, body: TXT, created_at: INT } },
  picks: { pk: ['id'], cols: { id: INT, user_id: INT, game_id: TXT, market: TXT, selection: TXT, fav: TXT, line: REAL, result: TXT, credits_delta: INT, created_at: INT } },
  lineups: { pk: ['id'], cols: { id: INT, user_id: INT, season: INT, week: INT, players: TXT, salary: INT, created_at: INT, updated_at: INT } },
};
const pgName = (t) => `sl_${t}`;

let pool = null;
function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(URL);
    pool = new Pool({
      connectionString: URL,
      ssl: local ? false : { rejectUnauthorized: true },
      max: 3,
      // let idle connections close so a free database can sleep between writes
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
    });
    pool.on('error', (e) => console.warn('[persist] idle connection error:', e.message));
  }
  return pool;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { enabled, restored: false, pending: 0, failed: 0, lastError: null };

// ---------- writes: queued in order, retried if the database is briefly unreachable ----------
let chain = Promise.resolve();
function enqueue(fn) {
  state.pending++;
  chain = chain.then(async () => {
    for (let i = 0; ; i++) {
      try { await fn(); return; } catch (e) {
        state.lastError = e.message;
        if (i >= 5) { state.failed++; console.warn('[persist] gave up on a write:', e.message); return; }
        await sleep(500 * 2 ** i);
      }
    }
  }).finally(() => { state.pending--; });
}

const whereSql = (w, start = 1) => Object.keys(w).map((k, i) => `${k}=$${i + start}`).join(' AND ');

async function upsertRows(table, rows) {
  if (!rows.length) return;
  const t = TABLES[table];
  const cols = Object.keys(t.cols);
  const sets = cols.filter((c) => !t.pk.includes(c)).map((c) => `${c}=EXCLUDED.${c}`).join(', ');
  const p = getPool();
  for (const r of rows) {
    await p.query(
      `INSERT INTO ${pgName(table)} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})
       ON CONFLICT (${t.pk.join(',')}) ${sets ? `DO UPDATE SET ${sets}` : 'DO NOTHING'}`,
      cols.map((c) => (r[c] === undefined ? null : r[c])),
    );
  }
}

// Copy the current local row(s) matching `where` to Postgres
function upsert(table, where) {
  if (!enabled) return;
  const rows = db.prepare(`SELECT * FROM ${table} WHERE ${Object.keys(where).map((k) => `${k}=?`).join(' AND ')}`).all(...Object.values(where));
  if (rows.length) enqueue(() => upsertRows(table, rows));
}

// Remove matching row(s) from Postgres
function remove(table, where) {
  if (!enabled) return;
  const vals = Object.values(where);
  enqueue(() => getPool().query(`DELETE FROM ${pgName(table)} WHERE ${whereSql(where)}`, vals));
}

// ---------- startup: create tables, bring saved data back, push anything only local ----------
async function restore() {
  if (!enabled) return;
  const p = getPool();
  for (const [table, t] of Object.entries(TABLES)) {
    const colsSql = Object.entries(t.cols).map(([c, type]) => `${c} ${type}`).join(', ');
    await p.query(`CREATE TABLE IF NOT EXISTS ${pgName(table)} (${colsSql}, PRIMARY KEY (${t.pk.join(',')}))`);
  }
  let pulled = 0, pushed = 0;
  for (const [table, t] of Object.entries(TABLES)) {
    const cols = Object.keys(t.cols);
    const { rows } = await p.query(`SELECT ${cols.join(',')} FROM ${pgName(table)}`);
    const ins = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    db.transaction(() => {
      for (const r of rows) {
        ins.run(...cols.map((c) => (r[c] == null ? null : t.cols[c] === TXT ? String(r[c]) : Number(r[c]))));
        pulled++;
      }
    })();
    // anything that only exists locally (e.g. data from before Postgres was connected)
    const keyOf = (r) => t.pk.map((k) => String(r[k])).join('|');
    const have = new Set(rows.map(keyOf));
    const localOnly = db.prepare(`SELECT * FROM ${table}`).all().filter((r) => !have.has(keyOf(r)));
    await upsertRows(table, localOnly);
    pushed += localOnly.length;
  }
  state.restored = true;
  console.log(`[persist] Postgres connected: ${pulled} saved rows restored${pushed ? `, ${pushed} local rows saved` : ''}`);
}

// Keep trying for a couple of minutes (a sleeping free database can take a moment to wake)
async function restoreWithRetry() {
  if (!enabled) return;
  for (let i = 0; i < 8; i++) {
    try { await restore(); return; } catch (e) {
      state.lastError = e.message;
      console.warn(`[persist] could not reach Postgres (try ${i + 1}/8): ${e.message}`);
      await sleep(Math.min(30000, 2000 * 2 ** i));
    }
  }
  // Starting without the saved data could overwrite it, so stop and let the host restart us
  console.error('[persist] giving up: DATABASE_URL is set but Postgres is unreachable');
  process.exit(1);
}

async function flush() {
  if (!enabled) return;
  await Promise.race([chain, sleep(8000)]);
  if (pool) await pool.end().catch(() => {});
}

module.exports = { enabled, state, upsert, remove, restoreWithRetry, flush, TABLES };
void cfg;
