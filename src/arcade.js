// The Arcade: everything people play between (and during) snaps.
//   Call It      guess the next play (run, short pass, deep shot, touchdown) before the snap
//   Daily        guess the player from a stat line, 6 tries, one puzzle a day
//   Rooms        a chat room for each league synced on sidelineff.com
//   Takes        hot takes, voted W or L now and graded later ("receipts")
//   Duels        1v1 salary-cap lineup battles from a link
//   Aura         points for big moments, lost for fumbles, picks and misses
//   Wrapped      your week (or season) in one shareable card
//   House        a lineup built from the projections, plus creators to beat
//   Challenges   weekly goals that earn badges
//   Push         phone alerts when your players score (installed app)
// Everything here is free to play: credits only, never money.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const db = require('./db');
const persist = require('./persist');
const engine = require('./engine');
const nflverse = require('./nflverse');
const weeklyRanks = require('./weekly-ranks');
const { isOffensive } = require('./moderation');

// ---------------- tables (local SQLite, copied to Postgres like the rest) ----------------
db.exec(`
CREATE TABLE IF NOT EXISTS callit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, game_id TEXT NOT NULL,
  win TEXT NOT NULL, choice TEXT NOT NULL, created_at INTEGER NOT NULL,
  play_id TEXT, result TEXT, credits_delta INTEGER
);
CREATE INDEX IF NOT EXISTS callit_game ON callit(game_id, play_id);
CREATE INDEX IF NOT EXISTS callit_user ON callit(user_id, created_at);
CREATE TABLE IF NOT EXISTS daily_puzzles (day TEXT PRIMARY KEY, player_id TEXT NOT NULL, game_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily_results (
  user_id INTEGER NOT NULL, day TEXT NOT NULL, guesses TEXT NOT NULL,
  solved INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS room_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS room_msgs_room ON room_msgs(room, id);
CREATE TABLE IF NOT EXISTS court_votes (play_id TEXT NOT NULL, user_id INTEGER NOT NULL, value INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (play_id, user_id));
CREATE TABLE IF NOT EXISTS takes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, body TEXT NOT NULL, horizon TEXT NOT NULL,
  created_at INTEGER NOT NULL, settle_at INTEGER NOT NULL, result TEXT, settled_at INTEGER
);
CREATE TABLE IF NOT EXISTS take_votes (take_id INTEGER NOT NULL, user_id INTEGER NOT NULL, phase TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (take_id, user_id, phase));
CREATE TABLE IF NOT EXISTS duels (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, season INTEGER NOT NULL, week INTEGER NOT NULL,
  from_user INTEGER NOT NULL, to_user INTEGER, created_at INTEGER NOT NULL, result TEXT, settled_at INTEGER
);
CREATE TABLE IF NOT EXISTS badges (user_id INTEGER NOT NULL, badge TEXT NOT NULL, label TEXT NOT NULL, earned_at INTEGER NOT NULL, PRIMARY KEY (user_id, badge));
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, user_id INTEGER, sub TEXT NOT NULL, players TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
`);
try { db.exec('ALTER TABLE push_subs ADD COLUMN prefs TEXT'); } catch { /* already there */ }
{
  const INT = 'BIGINT', TXT = 'TEXT';
  Object.assign(persist.TABLES, {
    callit: { pk: ['id'], cols: { id: INT, user_id: INT, game_id: TXT, win: TXT, choice: TXT, created_at: INT, play_id: TXT, result: TXT, credits_delta: INT } },
    daily_puzzles: { pk: ['day'], cols: { day: TXT, player_id: TXT, game_id: TXT, data: TXT } },
    daily_results: { pk: ['user_id', 'day'], cols: { user_id: INT, day: TXT, guesses: TXT, solved: INT, done: INT, updated_at: INT } },
    room_msgs: { pk: ['id'], cols: { id: INT, room: TXT, user_id: INT, body: TXT, created_at: INT } },
    court_votes: { pk: ['play_id', 'user_id'], cols: { play_id: TXT, user_id: INT, value: INT, created_at: INT } },
    takes: { pk: ['id'], cols: { id: INT, user_id: INT, body: TXT, horizon: TXT, created_at: INT, settle_at: INT, result: TXT, settled_at: INT } },
    take_votes: { pk: ['take_id', 'user_id', 'phase'], cols: { take_id: INT, user_id: INT, phase: TXT, value: INT } },
    duels: { pk: ['id'], cols: { id: INT, code: TXT, season: INT, week: INT, from_user: INT, to_user: INT, created_at: INT, result: TXT, settled_at: INT } },
    badges: { pk: ['user_id', 'badge'], cols: { user_id: INT, badge: TXT, label: TXT, earned_at: INT } },
    kv: { pk: ['k'], cols: { k: TXT, v: TXT } },
    push_subs: { pk: ['endpoint'], cols: { endpoint: TXT, user_id: INT, sub: TXT, players: TXT, created_at: INT, prefs: TXT } },
  });
}

// ---------------- helpers ----------------
let send = () => {};
const kvGet = (k) => { const r = db.prepare('SELECT v FROM kv WHERE k=?').get(k); try { return r ? JSON.parse(r.v) : null; } catch { return null; } };
const kvSet = (k, v) => { db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, JSON.stringify(v)); persist.upsert('kv', { k }); };
const profileOf = (u) => { try { return u?.profile ? JSON.parse(u.profile) : null; } catch { return null; } };
const userRow = db.prepare('SELECT id, name, profile, credits FROM users WHERE id=?');
// extra details other modules add to how a person is shown (e.g. their name tag style)
const whoExtras = [];
function who(id) {
  const u = userRow.get(id);
  const out = u ? { name: u.name, profile: profileOf(u) } : { name: 'player', profile: null };
  for (const f of whoExtras) { try { Object.assign(out, f(id)); } catch { /* ignore */ } }
  return out;
}
// Rewards: packs of moment cards etc. Each reward has a key so it's only given once.
const earnHandlers = [];
const earn = (userId, source, key) => { for (const f of earnHandlers) { try { f(userId, source, key); } catch (e) { console.warn('[arcade] earn:', e.message); } } };
let lbTimer = null;
function credit(userId, delta) {
  if (!delta) return;
  db.prepare('UPDATE users SET credits = MAX(0, credits + ?) WHERE id=?').run(delta, userId);
  persist.upsert('users', { id: userId });
  // the leaderboard refresh is shared by everyone, so it's sent at most every 10 seconds
  if (!lbTimer) lbTimer = setTimeout(() => { lbTimer = null; engine.bus.emit('leaderboard'); }, 10000);
}
const ETF = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etDay = (t = Date.now()) => ETF.format(t);
function etDayStart(day) {
  for (const h of [4, 5]) { const t = Date.parse(`${day}T0${h}:00:00Z`); if (etDay(t) === day && etDay(t - 1) !== day) return t; }
  return Date.parse(`${day}T05:00:00Z`);
}
const addDays = (day, n) => etDay(etDayStart(day) + n * 86400e3 + 12 * 3600e3);
const cur = () => engine.currentWeek();
// When a week starts and ends: from the night after last week's final game to the night of its own last game
function weekRange(week, season = cur().season) {
  const gs = engine.listGames(week, season).filter((g) => !g.extra);
  if (!gs.length) return null;
  const starts = gs.map((g) => g.start).filter(Boolean);
  const prev = engine.listGames(week - 1, season).map((g) => g.start).filter(Boolean);
  const from = prev.length ? Math.max(...prev) + 8 * 3600e3 : Math.min(...starts) - 3 * 86400e3;
  return { games: gs, from, to: Math.max(...starts) + 8 * 3600e3, done: gs.every((g) => g.state === 'post') };
}
// Every player's points in one week, from the box scores
function weekPoints(week, season = cur().season) {
  const out = new Map();
  for (const g of engine.listGames(week, season)) for (const t of engine.boxFor(g.id).values()) out.set(String(t.id), { ppr: t.ppr, line: t.line, state: g.state });
  return out;
}
function lineupFor(userId, week, season = cur().season) {
  const row = db.prepare('SELECT players, salary FROM lineups WHERE user_id=? AND season=? AND week=?').get(userId, season, week);
  if (!row) return null;
  const pts = weekPoints(week, season);
  const players = JSON.parse(row.players).map((s) => {
    const nv = nflverse.get(s.id), p = pts.get(String(s.id));
    return { slot: s.slot, id: String(s.id), name: nv?.name || 'Player', pos: nv?.pos || '', team: nv?.team || '', headshot: nv?.headshot || '', points: p?.ppr || 0, line: p?.line || '', state: p?.state || 'pre' };
  });
  return { salary: row.salary, players, total: +players.reduce((a, p) => a + p.points, 0).toFixed(2) };
}
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const lastPost = new Map();
const tooFast = (key, ms) => { const t = lastPost.get(key) || 0; if (Date.now() - t < ms) return true; lastPost.set(key, Date.now()); return false; };

// ======================= CALL IT =======================
// After each play a 20-second window opens: call the next one. When the next real snap arrives it's
// locked in, then graded ~12 seconds later (ESPN fills in details like "deep left" right after).
const WINDOW_MS = 20000, LATE_MS = 4000, GRADE_DELAY = 12000;
const CHOICES = ['run', 'short', 'deep', 'td'];
const CHOICE_LABEL = { run: 'Run', short: 'Short pass', deep: 'Deep shot', td: 'Touchdown' };
const windows = new Map(); // gameId -> { id, at, until }
const isTry = (p) => /extra point|two-point|2-pt|pat\b/i.test(`${p.headline || ''} ${p.typeText || ''}`) || p.kind === 'two_pt';
// What kind of play it was, for grading: 'run' | 'short' | 'deep', 'void' (kicks, sacks, kneels...) or 'skip' (no play: wait for the next one)
function callCategory(p) {
  if (!p || p.kind === 'admin') return 'skip';
  if (isTry(p)) return 'void';
  if (p.nullified || p.kind === 'penalty' || p.kind === 'other') return 'skip';
  if (p.kind === 'rush') return 'run';
  if (['catch', 'incomplete', 'int'].includes(p.kind)) {
    if (p.depth) return /\bdeep\b/i.test(p.depth) ? 'deep' : 'short';
    return p.kind === 'catch' && (Number(p.yards) || 0) >= 20 ? 'deep' : 'short';
  }
  return 'void';
}
// Whether the next play should be a snap (so it's worth calling)
const opensWindow = (p) => !p.td && !p.scoring && !isTry(p) && !['fg_good', 'safety', 'two_pt'].includes(p.kind);
function callStreak(userId) {
  const rows = db.prepare("SELECT result FROM callit WHERE user_id=? AND result IN ('win','loss') ORDER BY created_at ASC, id ASC").all(userId);
  let run = 0, best = 0;
  for (const r of rows) { run = r.result === 'win' ? run + 1 : 0; best = Math.max(best, run); }
  return { streak: run, best, called: rows.length, right: rows.filter((r) => r.result === 'win').length };
}
function callCounts(gameId) {
  const out = { run: 0, short: 0, deep: 0, td: 0 };
  for (const r of db.prepare('SELECT choice, COUNT(*) n FROM callit WHERE game_id=? AND play_id IS NULL AND result IS NULL GROUP BY choice').all(gameId)) out[r.choice] = r.n;
  return out;
}
function onPlayForCalls(p) {
  const g = engine.games.get(p.gameId);
  if (!g) return;
  const now = Date.now();
  const cat = callCategory(p);
  if (cat !== 'skip') {
    const rows = db.prepare('SELECT id, user_id, created_at FROM callit WHERE game_id=? AND play_id IS NULL AND result IS NULL').all(g.id);
    let graded = 0;
    for (const r of rows) {
      if (cat === 'void' || r.created_at > now - LATE_MS) db.prepare("UPDATE callit SET play_id=?, result='void', credits_delta=0 WHERE id=?").run(p.id, r.id);
      else { db.prepare('UPDATE callit SET play_id=? WHERE id=?').run(p.id, r.id); graded++; }
      persist.upsert('callit', { id: r.id });
    }
    if (graded) setTimeout(() => gradeCalls(p.id, g.id), GRADE_DELAY).unref?.();
    if (rows.length > graded) send('callit', { gameId: g.id, playId: p.id, category: 'void' });
  }
  if (g.state === 'in' && opensWindow(p)) windows.set(g.id, { id: p.id, at: now, until: now + WINDOW_MS });
  else windows.delete(g.id);
  send('callit_open', { gameId: g.id, win: windows.get(g.id) || null, now, counts: callCounts(g.id) });
}
function gradeCalls(playId, gameId) {
  const row = db.prepare('SELECT data FROM plays WHERE id=?').get(playId);
  const p = row ? JSON.parse(row.data) : null;
  const cat = p ? callCategory(p) : 'void';
  const rows = db.prepare('SELECT * FROM callit WHERE play_id=? AND result IS NULL').all(playId);
  const users = new Set();
  db.transaction(() => {
    for (const r of rows) {
      if (cat === 'void' || cat === 'skip') { db.prepare("UPDATE callit SET result='void', credits_delta=0 WHERE id=?").run(r.id); continue; }
      const win = r.choice === 'td' ? !!p.td : r.choice === cat;
      db.prepare('UPDATE callit SET result=?, credits_delta=? WHERE id=?').run(win ? 'win' : 'loss', 0, r.id);
      let delta = win ? (r.choice === 'td' ? 25 : 5) : 0;
      if (win && callStreak(r.user_id).streak % 5 === 0) delta += 25; // every 5 in a row
      if (delta) { db.prepare('UPDATE callit SET credits_delta=? WHERE id=?').run(delta, r.id); credit(r.user_id, delta); }
      if (win) { const n = db.prepare("SELECT COUNT(*) n FROM callit WHERE user_id=? AND result='win'").get(r.user_id).n; if (n % 3 === 0) earn(r.user_id, 'callit', `callit-${n}`); }
      users.add(r.user_id);
    }
  })();
  for (const r of rows) persist.upsert('callit', { id: r.id });
  for (const uid of users) checkBadges(uid);
  send('callit', { gameId, playId, category: cat, td: !!p?.td, headline: p?.headline || '' });
}
function callState(userId) {
  const games = {};
  for (const g of engine.listGames().filter((x) => x.state === 'in')) {
    const w = windows.get(g.id);
    const mine = userId ? db.prepare('SELECT choice, created_at FROM callit WHERE user_id=? AND game_id=? AND play_id IS NULL AND result IS NULL').get(userId, g.id) : null;
    const last = userId ? db.prepare('SELECT c.choice, c.result, c.credits_delta, p.data FROM callit c LEFT JOIN plays p ON p.id=c.play_id WHERE c.user_id=? AND c.game_id=? AND c.play_id IS NOT NULL ORDER BY c.id DESC LIMIT 1').get(userId, g.id) : null;
    let lastPlay = null; try { lastPlay = last?.data ? JSON.parse(last.data) : null; } catch { /* ignore */ }
    games[g.id] = { win: w || null, counts: callCounts(g.id), mine: mine ? { choice: mine.choice } : null,
      last: last ? { choice: last.choice, result: last.result || 'pending', delta: last.credits_delta || 0, headline: lastPlay?.headline || '', category: lastPlay ? callCategory(lastPlay) : null } : null };
  }
  return { now: Date.now(), games, labels: CHOICE_LABEL, ...(userId ? callStreak(userId) : {}) };
}

// ======================= SIDELINE DAILY =======================
const LAUNCH = '2026-11-02';
const DIVS = { 'AFC East': 'BUF MIA NE NYJ', 'AFC North': 'BAL CIN CLE PIT', 'AFC South': 'HOU IND JAX TEN', 'AFC West': 'DEN KC LV LAC',
  'NFC East': 'DAL NYG PHI WSH WAS', 'NFC North': 'CHI DET GB MIN', 'NFC South': 'ATL CAR NO TB', 'NFC West': 'ARI LAR LA SF SEA' };
const divOf = (t) => Object.keys(DIVS).find((d) => DIVS[d].split(' ').includes(t)) || '';
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const dayNumber = (day) => Math.round((etDayStart(day) - etDayStart(LAUNCH)) / 86400e3) + 1;
function puzzleFor(day) {
  const have = db.prepare('SELECT * FROM daily_puzzles WHERE day=?').get(day);
  if (have) return { ...JSON.parse(have.data), playerId: have.player_id, gameId: have.game_id, day };
  if (!nflverse.state.byEspn?.size) return null;
  const start = etDayStart(day);
  const recent = new Set(db.prepare('SELECT player_id FROM daily_puzzles WHERE day > ?').all(addDays(day, -60)).map((r) => r.player_id));
  const rows = db.prepare(`SELECT gp.player_id, gp.game_id, gp.ppr, gp.line, g.data FROM game_players gp JOIN games g ON g.id=gp.game_id
    WHERE g.state='post' AND g.start_time BETWEEN ? AND ? AND gp.ppr >= 14`).all(start - 9 * 86400e3, start - 3 * 3600e3);
  const pool = [];
  for (const r of rows) {
    const nv = nflverse.get(r.player_id);
    if (!nv || !SKILL.has(nv.pos) || recent.has(String(r.player_id))) continue;
    let g; try { g = JSON.parse(r.data); } catch { continue; }
    if (g.extra || (g.league && g.league !== 'nfl')) continue;
    const team = [g.home?.abbr, g.away?.abbr].includes(nv.team) ? nv.team : null;
    if (!team || !r.line) continue;
    pool.push({ r, nv, g, team });
  }
  if (!pool.length) return null;
  pool.sort((a, b) => `${a.r.game_id}:${a.r.player_id}`.localeCompare(`${b.r.game_id}:${b.r.player_id}`));
  const h = crypto.createHash('sha256').update(`sideline-daily:${day}`).digest().readUInt32BE(0);
  const { r, nv, g, team } = pool[h % pool.length];
  const opp = g.home.abbr === team ? g.away.abbr : g.home.abbr;
  const data = { line: r.line, ppr: r.ppr, week: g.week, opp, home: g.home.abbr === team, team, pos: nv.pos, name: nv.name, gameDay: new Date(g.start).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }) };
  db.prepare('INSERT OR IGNORE INTO daily_puzzles (day, player_id, game_id, data) VALUES (?,?,?,?)').run(day, String(r.player_id), String(r.game_id), JSON.stringify(data));
  persist.upsert('daily_puzzles', { day });
  return puzzleFor(day);
}
const initials = (n) => String(n || '').replace(/\b(Jr|Sr|II|III|IV)\.?$/, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('.') + '.';
function dailyCheck(pz, guesses) {
  const ans = nflverse.get(pz.playerId);
  const rows = [];
  for (const id of guesses) {
    const nv = nflverse.get(id);
    if (!nv) continue;
    const same = String(nv.id) === String(pz.playerId);
    const ppgDiff = (ans?.ppg ?? 0) - (nv.ppg ?? 0);
    rows.push({ id: String(nv.id), name: nv.name, team: nv.team, pos: nv.pos, ppg: nv.ppg, headshot: nv.headshot || '', div: divOf(nv.team),
      fb: { hit: same, pos: nv.pos === pz.pos ? 'hit' : 'miss', team: nv.team === pz.team ? 'hit' : divOf(nv.team) && divOf(nv.team) === divOf(pz.team) ? 'near' : 'miss',
        conf: divOf(nv.team).slice(0, 3) === divOf(pz.team).slice(0, 3) ? 'hit' : 'miss', ppg: Math.abs(ppgDiff) < 1 ? 'hit' : ppgDiff > 0 ? 'up' : 'down' } });
  }
  const solved = rows.some((r) => r.fb.hit);
  const misses = rows.filter((r) => !r.fb.hit).length;
  const done = solved || rows.length >= 6;
  const hints = [];
  if (misses >= 1 || done) hints.push({ k: 'Position', v: pz.pos });
  if (misses >= 2 || done) hints.push({ k: 'Played', v: `${pz.home ? 'vs' : '@'} ${pz.opp}` });
  if (misses >= 3 || done) hints.push({ k: 'Division', v: divOf(pz.team) });
  if (misses >= 4 || done) hints.push({ k: 'Team', v: pz.team });
  if (misses >= 5 || done) hints.push({ k: 'Initials', v: initials(pz.name) });
  return { rows, solved, done, tries: rows.length, hints, answer: done ? { id: pz.playerId, name: pz.name, team: pz.team, pos: pz.pos, headshot: ans?.headshot || '' } : null };
}
function dailyStats(userId) {
  const rows = db.prepare('SELECT day, solved, done, guesses FROM daily_results WHERE user_id=? AND done=1 ORDER BY day DESC').all(userId);
  const solvedDays = new Set(rows.filter((r) => r.solved).map((r) => r.day));
  let streak = 0;
  let d = etDay();
  if (!solvedDays.has(d)) d = addDays(d, -1);
  while (solvedDays.has(d)) { streak++; d = addDays(d, -1); }
  const dist = [0, 0, 0, 0, 0, 0];
  for (const r of rows) if (r.solved) { const n = JSON.parse(r.guesses).length; if (n >= 1 && n <= 6) dist[n - 1]++; }
  return { played: rows.length, solved: solvedDays.size, streak, dist };
}

// ======================= LEAGUE ROOMS =======================
// A room for each league synced on sidelineff.com. Only people with that league in their own
// sidelineff.com account can read or post (checked with the main site using their login).
const memberCache = new Map();
async function myLeagues(req) {
  if (cfg.DEMO) return new Set(['demo']);
  const cookie = req.headers.cookie;
  if (!cookie || !req.sideline) return null;
  const key = crypto.createHash('sha256').update(cookie).digest('hex');
  const c = memberCache.get(key);
  if (c && Date.now() - c.at < 5 * 60e3) return c.leagues;
  try {
    const r = await fetch(`${cfg.SIDELINE_URL}/api/workspace`, { headers: { cookie, accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; sideline-live)' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const b = await r.json();
    const leagues = new Set((b.workspace?.portfolio?.leagues || []).map((l) => String(l.id)));
    memberCache.set(key, { at: Date.now(), leagues });
    if (memberCache.size > 2000) memberCache.delete(memberCache.keys().next().value);
    return leagues;
  } catch { return null; }
}
const msgView = (m, meId) => ({ id: m.id, body: m.body, at: m.created_at, mine: m.user_id === meId, ...who(m.user_id) });

// ======================= HOT TAKES =======================
const GRADE_WINDOW = 72 * 3600e3;
function settleAt(horizon) {
  if (horizon === 'season') return Date.parse('2027-02-16T05:00:00Z');
  if (horizon === 'month') return Date.now() + 30 * 86400e3;
  const r = weekRange(cur().week);
  return r && r.to > Date.now() ? r.to : Date.now() + 7 * 86400e3;
}
const takePhase = (t, now = Date.now()) => (t.result ? 'final' : now < t.settle_at ? 'call' : now < t.settle_at + GRADE_WINDOW ? 'grade' : 'final');
function takesRecord(userId) {
  const r = db.prepare("SELECT SUM(result='hit') hit, SUM(result='miss') miss FROM takes WHERE user_id=?").get(userId);
  return { hit: r.hit || 0, miss: r.miss || 0 };
}
function takeView(t, meId) {
  const v = { w: 0, l: 0, hit: 0, miss: 0 };
  for (const r of db.prepare('SELECT phase, value, COUNT(*) n FROM take_votes WHERE take_id=? GROUP BY phase, value').all(t.id)) {
    if (r.phase === 'call') v[r.value > 0 ? 'w' : 'l'] += r.n; else v[r.value > 0 ? 'hit' : 'miss'] += r.n;
  }
  const my = {};
  if (meId) for (const r of db.prepare('SELECT phase, value FROM take_votes WHERE take_id=? AND user_id=?').all(t.id, meId)) my[r.phase] = r.value;
  return { id: t.id, body: t.body, horizon: t.horizon, at: t.created_at, settleAt: t.settle_at, result: t.result, phase: takePhase(t), votes: v, my, mine: t.user_id === meId,
    author: { ...who(t.user_id), record: takesRecord(t.user_id) } };
}
function settleTakes() {
  const now = Date.now();
  for (const t of db.prepare('SELECT * FROM takes WHERE result IS NULL AND settle_at + ? < ?').all(GRADE_WINDOW, now)) {
    const r = db.prepare("SELECT SUM(value=1) hit, SUM(value=-1) miss FROM take_votes WHERE take_id=? AND phase='grade'").get(t.id);
    const hit = r.hit || 0, miss = r.miss || 0;
    const result = hit + miss < 2 || hit === miss ? 'unsettled' : hit > miss ? 'hit' : 'miss';
    db.prepare('UPDATE takes SET result=?, settled_at=? WHERE id=?').run(result, now, t.id);
    persist.upsert('takes', { id: t.id });
    if (result === 'hit') { checkBadges(t.user_id); earn(t.user_id, 'take', `take-${t.id}`); }
  }
}

// ======================= DUELS =======================
const newCode = () => { const A = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (const b of crypto.randomBytes(6)) s += A[b % A.length]; return s; };
function duelView(d, meId) {
  const r = weekRange(d.week, d.season);
  const side = (uid) => (uid ? { ...who(uid), lineup: lineupFor(uid, d.week, d.season) } : null);
  const from = side(d.from_user), to = side(d.to_user);
  const status = d.result ? 'final' : !d.to_user ? 'open' : r && r.games.some((g) => g.state !== 'pre') ? 'live' : 'set';
  return { code: d.code, week: d.week, season: d.season, status, result: d.result, from, to,
    me: d.from_user === meId ? 'from' : d.to_user === meId ? 'to' : null };
}
function settleDuels() {
  const now = Date.now();
  for (const d of db.prepare('SELECT * FROM duels WHERE result IS NULL').all()) {
    const r = weekRange(d.week, d.season);
    if (!r || !r.done) continue;
    let result;
    if (!d.to_user) result = 'expired';
    else {
      const a = lineupFor(d.from_user, d.week, d.season)?.total ?? -1, b = lineupFor(d.to_user, d.week, d.season)?.total ?? -1;
      result = a === b ? 'tie' : a > b ? 'from' : 'to';
      if (result === 'from') credit(d.from_user, 50);
      if (result === 'to') credit(d.to_user, 50);
    }
    db.prepare('UPDATE duels SET result=?, settled_at=? WHERE id=?').run(result, now, d.id);
    persist.upsert('duels', { id: d.id });
    if (result === 'from') { checkBadges(d.from_user); earn(d.from_user, 'duel', `duel-${d.id}`); }
    if (result === 'to') { checkBadges(d.to_user); earn(d.to_user, 'duel', `duel-${d.id}`); }
  }
}

// ======================= AURA =======================
// Points for moments, not stats: touchdowns and explosive plays add aura; fumbles, picks,
// sacks and missed kicks take it away. Same rules as the chips on play cards.
function auraOf(x, p) {
  if (!x || x.pos === 'DST') return 0;
  const s = x.stat || {};
  let a = 0;
  a += ((s.recTd || 0) + (s.rushTd || 0) + (s.retTd || 0)) * 100;
  a += (s.passTd || 0) * 50;
  a -= (s.int || 0) * 100;
  a -= (s.fumLost || 0) * 100;
  a -= (s.sacked || 0) * 15;
  a += (s.twoPt || 0) * 30;
  if ((x.role === 'rusher' || x.role === 'receiver') && p.explosive) a += 40;
  if ((x.role === 'rusher' || x.role === 'receiver') && (Number(p.yards) || 0) >= 40) a += 60;
  if (s.fga) {
    const dist = Number((/(\d+) yard field goal/i.exec(p.text || '') || [])[1]) || 0;
    a += s.fgm ? (dist >= 50 ? 60 : 10) : -60;
  }
  if (s.xpa && !s.xpm) a -= 40;
  return a;
}
const auraCache = new Map();
function auraBoard(week) {
  const c = auraCache.get(week);
  if (c && Date.now() - c.at < 20000) return c.data;
  const ids = engine.listGames(week).map((g) => g.id);
  const by = new Map();
  if (ids.length) {
    for (const r of db.prepare(`SELECT id, data FROM plays WHERE game_id IN (${ids.map(() => '?').join(',')})`).all(...ids)) {
      let p; try { p = JSON.parse(r.data); } catch { continue; }
      for (const x of p.players || []) {
        if (!x.id) continue;
        const v = auraOf(x, p);
        if (!v) continue;
        const nv = nflverse.get(x.id);
        const e = by.get(String(x.id)) || { id: String(x.id), name: nv?.name || x.name, team: nv?.team || x.team, pos: nv?.pos || x.pos || '', headshot: nv?.headshot || x.headshot || '', aura: 0, best: null, worst: null, n: 0 };
        e.aura += v; e.n++;
        if (!e.best || v > e.best.v) e.best = { v, headline: p.headline, playId: p.id };
        if (!e.worst || v < e.worst.v) e.worst = { v, headline: p.headline, playId: p.id };
        by.set(e.id, e);
      }
    }
  }
  const all = [...by.values()];
  const data = { week, top: all.filter((e) => e.aura > 0).sort((a, b) => b.aura - a.aura).slice(0, 25), bottom: all.filter((e) => e.aura < 0).sort((a, b) => a.aura - b.aura).slice(0, 10) };
  auraCache.set(week, { at: Date.now(), data });
  return data;
}

// ======================= THE HOUSE + CREATORS =======================
// The House: the lineup with the most projected points that fits under the cap, built once a week
// before kickoff from sidelineff.com's weekly rankings. Creators are listed in creators.json.
let pricedSlate = () => ({ players: [], cap: 0 });
function bestLineup(players, cap, slots, slotPos) {
  const pts = (p) => p.proj ?? p.ppg ?? 0;
  const pool = players.filter((p) => pts(p) > 0 && !p.locked);
  const lineup = {};
  const used = new Set();
  for (const s of slots) {
    const best = pool.filter((p) => slotPos[s].includes(p.pos) && !used.has(p.id)).sort((a, b) => pts(b) - pts(a))[0];
    if (best) { lineup[s] = best; used.add(best.id); }
  }
  if (Object.keys(lineup).length < slots.length) return null;
  const total = () => slots.reduce((a, s) => a + lineup[s].salary, 0);
  // over the cap: make the swap that gives up the fewest points per dollar saved
  for (let guard = 0; total() > cap && guard < 200; guard++) {
    let pick = null;
    for (const s of slots) for (const c of pool) {
      if (used.has(c.id) || !slotPos[s].includes(c.pos) || c.salary >= lineup[s].salary) continue;
      const ratio = (pts(lineup[s]) - pts(c)) / (lineup[s].salary - c.salary);
      if (!pick || ratio < pick.ratio) pick = { s, c, ratio };
    }
    if (!pick) return null;
    used.delete(lineup[pick.s].id); lineup[pick.s] = pick.c; used.add(pick.c.id);
  }
  // then keep making the best upgrade that still fits
  for (let guard = 0; guard < 200; guard++) {
    let pick = null;
    const room = cap - total();
    for (const s of slots) for (const c of pool) {
      if (used.has(c.id) || !slotPos[s].includes(c.pos) || c.salary - lineup[s].salary > room) continue;
      const gain = pts(c) - pts(lineup[s]);
      if (gain > 0.05 && (!pick || gain > pick.gain)) pick = { s, c, gain };
    }
    if (!pick) break;
    used.delete(lineup[pick.s].id); lineup[pick.s] = pick.c; used.add(pick.c.id);
  }
  return slots.map((s) => ({ slot: s, id: String(lineup[s].id), name: lineup[s].name, pos: lineup[s].pos, team: lineup[s].team, salary: lineup[s].salary, proj: pts(lineup[s]) }));
}
const SLOT_POS = { QB: ['QB'], RB1: ['RB'], RB2: ['RB'], WR1: ['WR'], WR2: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'] };
function house(build = true) {
  const w = cur();
  if (!w.week) return null;
  const key = `house:${w.season}:${w.week}`;
  let h = kvGet(key);
  if (!h && build && weeklyRanks.state.rows.size) {
    const slate = pricedSlate();
    const players = bestLineup(slate.players, slate.cap, cfg.ROSTER_SLOTS, SLOT_POS);
    if (players) {
      h = { players, salary: players.reduce((a, p) => a + p.salary, 0), proj: +players.reduce((a, p) => a + p.proj, 0).toFixed(1), cap: slate.cap, builtAt: Date.now(), late: slate.players.some((p) => p.locked) };
      kvSet(key, h);
    }
  }
  if (!h) return null;
  const pts = weekPoints(w.week, w.season);
  const players = h.players.map((p) => ({ ...p, points: pts.get(p.id)?.ppr || 0, line: pts.get(p.id)?.line || '', state: pts.get(p.id)?.state || 'pre' }));
  return { ...h, players, total: +players.reduce((a, p) => a + p.points, 0).toFixed(2) };
}
function creatorsList() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'creators.json'), 'utf8')).filter((c) => c && c.username); } catch { return []; }
}

// ======================= CHALLENGES + BADGES =======================
const CH = {
  underdogs: { label: 'Pick 3 underdogs to win', emoji: '🐶', goal: () => 3 },
  streak5: { label: 'Hit a 5-play Call It streak', emoji: '🔥', goal: () => 5 },
  daily3: { label: 'Solve 3 Sideline Dailies', emoji: '🧩', goal: () => 3 },
  allwinners: { label: "Pick every game's winner", emoji: '🏈', goal: (r) => r.games.length },
  comment3: { label: 'Comment on 3 plays', emoji: '💬', goal: () => 3 },
  take1: { label: 'Post a hot take', emoji: '🌶️', goal: () => 1 },
  duel1: { label: 'Start or accept a lineup duel', emoji: '⚔️', goal: () => 1 },
  lineup: { label: 'Save a salary-cap lineup', emoji: '📋', goal: () => 1 },
};
const ROTATE = ['daily3', 'allwinners', 'comment3', 'take1', 'duel1', 'lineup'];
const weekChallenges = (week) => ['underdogs', 'streak5', ...[0, 1, 2].map((i) => ROTATE[(week * 3 + i) % ROTATE.length])];
function progress(id, userId, week, r) {
  const season = cur().season;
  const gameIds = r.games.map((g) => g.id);
  const ph = gameIds.map(() => '?').join(',') || "''";
  switch (id) {
    case 'underdogs': {
      let n = 0;
      for (const p of db.prepare(`SELECT game_id, selection FROM picks WHERE user_id=? AND market='winner' AND game_id IN (${ph})`).all(userId, ...gameIds)) {
        const g = engine.games.get(p.game_id);
        if (g?.odds?.fav && g.odds.spread && p.selection !== g.odds.fav) n++;
      }
      return n;
    }
    case 'streak5': {
      let run = 0, best = 0;
      for (const x of db.prepare(`SELECT result FROM callit WHERE user_id=? AND game_id IN (${ph}) AND result IN ('win','loss') ORDER BY created_at, id`).all(userId, ...gameIds)) { run = x.result === 'win' ? run + 1 : 0; best = Math.max(best, run); }
      return best;
    }
    case 'daily3': return db.prepare('SELECT COUNT(*) n FROM daily_results WHERE user_id=? AND solved=1 AND day BETWEEN ? AND ?').get(userId, etDay(r.from), etDay(r.to)).n;
    case 'allwinners': return db.prepare(`SELECT COUNT(*) n FROM picks WHERE user_id=? AND market='winner' AND game_id IN (${ph})`).get(userId, ...gameIds).n;
    case 'comment3': return db.prepare(`SELECT COUNT(*) n FROM comments WHERE user_id=? AND created_at BETWEEN ? AND ?`).get(userId, r.from, r.to).n;
    case 'take1': return db.prepare('SELECT COUNT(*) n FROM takes WHERE user_id=? AND created_at BETWEEN ? AND ?').get(userId, r.from, r.to).n;
    case 'duel1': return db.prepare('SELECT COUNT(*) n FROM duels WHERE (from_user=? OR to_user=?) AND season=? AND week=?').get(userId, userId, season, week).n;
    case 'lineup': return db.prepare('SELECT COUNT(*) n FROM lineups WHERE user_id=? AND season=? AND week=?').get(userId, season, week).n;
    default: return 0;
  }
}
function award(userId, badge, label) {
  const info = db.prepare('INSERT OR IGNORE INTO badges (user_id, badge, label, earned_at) VALUES (?,?,?,?)').run(userId, badge, label, Date.now());
  if (info.changes) { persist.upsert('badges', { user_id: userId, badge }); return true; }
  return false;
}
function challengesFor(userId, week = cur().week) {
  const r = weekRange(week);
  if (!r) return { week, list: [] };
  const list = weekChallenges(week).map((id) => {
    const goal = Math.max(1, CH[id].goal(r));
    const have = userId ? progress(id, userId, week, r) : 0;
    return { id, label: CH[id].label, emoji: CH[id].emoji, goal, progress: Math.min(goal, have), done: have >= goal };
  });
  const allDone = userId && list.length && list.every((c) => c.done);
  if (allDone) { award(userId, `grinder-${cur().season}-${week}`, `Week ${week} Grinder`); for (const i of [1, 2, 3]) earn(userId, 'grinder', `grinder-${cur().season}-${week}-${i}`); }
  return { week, list, allDone: !!allDone };
}
function checkBadges(userId) {
  try {
    const cs = callStreak(userId);
    if (cs.best >= 10) award(userId, 'callit-10', 'Called It ×10');
    else if (cs.best >= 5) award(userId, 'callit-5', 'Called It ×5');
    if (dailyStats(userId).streak >= 7) award(userId, 'daily-7', 'Daily ×7');
    if (takesRecord(userId).hit >= 5) award(userId, 'receipts-5', 'Receipts ×5');
    const dw = db.prepare("SELECT COUNT(*) n FROM duels WHERE (from_user=? AND result='from') OR (to_user=? AND result='to')").get(userId, userId).n;
    if (dw >= 3) award(userId, 'duelist-3', 'Duelist');
  } catch (e) { console.warn('[arcade] badges:', e.message); }
}
const badgesOf = (userId) => db.prepare('SELECT badge, label, earned_at FROM badges WHERE user_id=? ORDER BY earned_at DESC').all(userId);

// ======================= WRAPPED =======================
function wrapped(userId, { week, season: wholeSeason }) {
  const season = cur().season;
  const weeks = wholeSeason ? Array.from({ length: cur().week || 1 }, (_, i) => i + 1) : [week];
  const ranges = weeks.map((w) => [w, weekRange(w)]).filter(([, r]) => r);
  if (!ranges.length) return null;
  const gameIds = ranges.flatMap(([, r]) => r.games.map((g) => g.id));
  const from = Math.min(...ranges.map(([, r]) => r.from)), to = Math.max(...ranges.map(([, r]) => r.to));
  const ph = gameIds.map(() => '?').join(',');
  const picks = db.prepare(`SELECT * FROM picks WHERE user_id=? AND game_id IN (${ph})`).all(userId, ...gameIds);
  const wp = picks.filter((p) => p.market === 'winner');
  let upset = null;
  for (const p of wp.filter((x) => x.result === 'win')) {
    const g = engine.games.get(p.game_id);
    if (g?.odds?.fav && p.selection !== g.odds.fav && (!upset || g.odds.spread > upset.spread)) upset = { team: p.selection, opp: g.home.abbr === p.selection ? g.away.abbr : g.home.abbr, spread: g.odds.spread, score: `${g.away.abbr} ${g.away.score}–${g.home.score} ${g.home.abbr}` };
  }
  const calls = db.prepare(`SELECT result, credits_delta FROM callit WHERE user_id=? AND game_id IN (${ph}) AND result IN ('win','loss') ORDER BY created_at, id`).all(userId, ...gameIds);
  let run = 0, bestRun = 0;
  for (const c of calls) { run = c.result === 'win' ? run + 1 : 0; bestRun = Math.max(bestRun, run); }
  const daily = db.prepare('SELECT solved, guesses FROM daily_results WHERE user_id=? AND done=1 AND day BETWEEN ? AND ?').all(userId, etDay(from), etDay(to));
  const solved = daily.filter((d) => d.solved);
  let lineup = null;
  if (!wholeSeason) {
    const l = lineupFor(userId, week, season);
    if (l) {
      const all = db.prepare('SELECT user_id FROM lineups WHERE season=? AND week=?').all(season, week).map((x) => lineupFor(x.user_id, week, season)?.total || 0).sort((a, b) => b - a);
      const rank = all.findIndex((t) => t <= l.total) + 1;
      const top = l.players.slice().sort((a, b) => b.points - a.points)[0];
      lineup = { total: l.total, rank, of: all.length, pct: all.length > 1 ? Math.round((1 - (rank - 1) / all.length) * 100) : 100, top: top ? { name: top.name, points: top.points, id: top.id, headshot: top.headshot } : null };
    }
  } else {
    let tot = 0, n = 0;
    for (const [w] of ranges) { const l = lineupFor(userId, w, season); if (l) { tot += l.total; n++; } }
    if (n) lineup = { total: +tot.toFixed(1), weeks: n };
  }
  const takes = db.prepare('SELECT result FROM takes WHERE user_id=? AND created_at BETWEEN ? AND ?').all(userId, from, to);
  const duels = db.prepare('SELECT * FROM duels WHERE (from_user=? OR to_user=?) AND season=? AND week IN (' + weeks.map(() => '?').join(',') + ')').all(userId, userId, season, ...weeks);
  const dW = duels.filter((d) => (d.result === 'from' && d.from_user === userId) || (d.result === 'to' && d.to_user === userId)).length;
  const dL = duels.filter((d) => (d.result === 'to' && d.from_user === userId) || (d.result === 'from' && d.to_user === userId)).length;
  const credits = picks.reduce((a, p) => a + (p.credits_delta || 0), 0) + calls.reduce((a, c) => a + (c.credits_delta || 0), 0) + dW * 50;
  return {
    label: wholeSeason ? `${season} season so far` : `Week ${week}`, week: wholeSeason ? null : week, season,
    picks: { w: wp.filter((p) => p.result === 'win').length, l: wp.filter((p) => p.result === 'loss').length, p: wp.filter((p) => p.result === 'push').length, made: wp.length, upset },
    callit: { called: calls.length, right: calls.filter((c) => c.result === 'win').length, best: bestRun },
    daily: { solved: solved.length, played: daily.length, avg: solved.length ? +(solved.reduce((a, d) => a + JSON.parse(d.guesses).length, 0) / solved.length).toFixed(1) : null },
    lineup, takes: { posted: takes.length, hit: takes.filter((t) => t.result === 'hit').length }, duels: { w: dW, l: dL }, credits,
    me: who(userId),
  };
}

// ======================= PUSH ALERTS =======================
let webpush = null, vapid = null;
const subs = new Map(); // endpoint -> { sub, players:Set, user_id }
function loadSubs() {
  subs.clear();
  for (const r of db.prepare('SELECT * FROM push_subs').all()) {
    try { subs.set(r.endpoint, { sub: JSON.parse(r.sub), players: new Set(String(r.players || '').split(',').filter(Boolean)), user_id: r.user_id, prefs: JSON.parse(r.prefs || '{}') }); } catch { /* ignore */ }
  }
}
function setupPush() {
  try { webpush = require('web-push'); } catch { console.warn('[push] web-push is not installed'); return; }
  vapid = kvGet('vapid');
  if (!vapid) { vapid = webpush.generateVAPIDKeys(); kvSet('vapid', vapid); }
  webpush.setVapidDetails(process.env.PUSH_CONTACT || 'https://sidelineff.com', vapid.publicKey, vapid.privateKey);
  loadSubs();
}
// Send to every subscriber that `make(sub)` returns a message for
function pushTo(make) {
  if (!webpush) return;
  for (const [endpoint, s] of subs) {
    let msg = null; try { msg = make(s); } catch { msg = null; }
    if (!msg) continue;
    webpush.sendNotification(s.sub, JSON.stringify({ ...msg, url: `${s.sub.base || ''}${msg.hash || ''}` }), { TTL: 300, urgency: 'high' }).catch((e) => {
      if (e.statusCode === 404 || e.statusCode === 410) { subs.delete(endpoint); db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(endpoint); persist.remove('push_subs', { endpoint }); }
    });
  }
}
const pushed = new Set();
function pushForPlay(p) {
  if (!webpush || !subs.size || pushed.has(p.id)) return;
  pushed.add(p.id);
  if (pushed.size > 5000) pushed.delete(pushed.values().next().value);
  for (const [endpoint, s] of subs) {
    const x = (p.players || []).find((y) => y.id && s.players.has(String(y.id)));
    if (!x) continue;
    const v = Math.round((x.ppr || 0) * 10) / 10;
    if (!(p.td || v >= 4 || v <= -2)) continue;
    const title = `${p.td ? '🔥 ' : v < 0 ? '💀 ' : ''}${x.name} ${v > 0 ? '+' : ''}${v.toFixed(1)} PPR`;
    const payload = JSON.stringify({ title, body: p.headline, tag: p.id, url: `${s.sub.base || ''}#/play/${encodeURIComponent(p.id)}` });
    webpush.sendNotification(s.sub, payload, { TTL: 600, urgency: 'high' }).catch((e) => {
      if (e.statusCode === 404 || e.statusCode === 410) { subs.delete(endpoint); db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(endpoint); persist.remove('push_subs', { endpoint }); }
    });
  }
}

// ======================= picture proxy (so share cards can draw player photos) =======================
const IMG_HOSTS = /^(a\.espncdn\.com|a1\.espncdn\.com|a2\.espncdn\.com|a3\.espncdn\.com|static\.www\.nfl\.com|sidelineff\.com|www\.sidelineff\.com)$/;
const imgCache = new Map();

// ======================= routes =======================
function mount(app, deps) {
  send = deps.send;
  pricedSlate = deps.pricedSlate;
  const { needUser } = deps;
  const wk = () => cur().week;

  engine.bus.on('play', (p) => {
    try { onPlayForCalls(p); } catch (e) { console.warn('[arcade] call it:', e.message); }
    try { pushForPlay(p); } catch (e) { console.warn('[push]', e.message); }
  });

  // ---- Call It ----
  app.get('/api/callit', (req, res) => res.json(callState(req.user?.id)));
  app.post('/api/callit', needUser, (req, res) => {
    const { gameId, choice } = req.body || {};
    const g = engine.games.get(String(gameId));
    if (!g || g.state !== 'in') return res.status(400).json({ error: 'That game isn\'t live.' });
    if (!CHOICES.includes(choice)) return res.status(400).json({ error: 'Pick run, short pass, deep shot or touchdown.' });
    const w = windows.get(g.id);
    if (!w || Date.now() > w.until) return res.status(400).json({ error: 'Too late: the snap is coming. Call the next one.' });
    const now = Date.now();
    const mine = db.prepare('SELECT id FROM callit WHERE user_id=? AND game_id=? AND play_id IS NULL AND result IS NULL').get(req.user.id, g.id);
    let id;
    if (mine) { db.prepare('UPDATE callit SET choice=?, win=?, created_at=? WHERE id=?').run(choice, w.id, now, mine.id); id = mine.id; }
    else id = Number(db.prepare('INSERT INTO callit (user_id, game_id, win, choice, created_at) VALUES (?,?,?,?,?)').run(req.user.id, g.id, w.id, choice, now).lastInsertRowid);
    persist.upsert('callit', { id });
    send('callit_n', { gameId: g.id, counts: callCounts(g.id) });
    res.json(callState(req.user.id));
  });

  // ---- Daily ----
  app.get('/api/daily', (req, res) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || '')) && req.query.day <= etDay() ? String(req.query.day) : etDay();
    const pz = puzzleFor(day);
    if (!pz) return res.json({ day, number: dayNumber(day), puzzle: null });
    let saved = null;
    if (req.user) {
      const r = db.prepare('SELECT guesses FROM daily_results WHERE user_id=? AND day=?').get(req.user.id, day);
      if (r) saved = dailyCheck(pz, JSON.parse(r.guesses));
    }
    res.json({ day, number: dayNumber(day), puzzle: { line: pz.line, ppr: pz.ppr, week: pz.week, gameDay: pz.gameDay }, saved, stats: req.user ? dailyStats(req.user.id) : null });
  });
  app.post('/api/daily/check', (req, res) => {
    const day = String(req.body?.day || etDay());
    const pz = /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= etDay() ? puzzleFor(day) : null;
    if (!pz) return res.status(404).json({ error: 'No puzzle for that day.' });
    let guesses = (Array.isArray(req.body?.guesses) ? req.body.guesses : []).map(String).filter((x, i, a) => /^\d+$/.test(x) && a.indexOf(x) === i).slice(0, 6);
    if (req.user) {
      const prev = db.prepare('SELECT guesses, done FROM daily_results WHERE user_id=? AND day=?').get(req.user.id, day);
      const before = prev ? JSON.parse(prev.guesses) : [];
      // a finished puzzle stays finished, and earlier guesses can't be taken back
      if (prev?.done || before.some((g, i) => guesses[i] !== g)) guesses = prev?.done ? before : before.concat(guesses.filter((g) => !before.includes(g))).slice(0, 6);
    }
    const out = dailyCheck(pz, guesses);
    if (req.user && out.rows.length) {
      db.prepare(`INSERT INTO daily_results (user_id, day, guesses, solved, done, updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(user_id, day) DO UPDATE SET guesses=excluded.guesses, solved=excluded.solved, done=excluded.done, updated_at=excluded.updated_at`)
        .run(req.user.id, day, JSON.stringify(out.rows.map((r) => r.id)), out.solved ? 1 : 0, out.done ? 1 : 0, Date.now());
      persist.upsert('daily_results', { user_id: req.user.id, day });
      if (out.done) checkBadges(req.user.id);
      if (out.solved) earn(req.user.id, 'daily', `daily-${day}`);
    }
    res.json({ ...out, number: dayNumber(day), stats: req.user ? dailyStats(req.user.id) : null });
  });
  app.get('/api/daily/players', (_req, res) => {
    res.set('cache-control', 'public, max-age=3600');
    res.json({ players: nflverse.all().filter((p) => SKILL.has(p.pos) && p.games >= 1).map((p) => [String(p.id), p.name, p.team, p.pos]) });
  });

  // ---- League rooms ----
  const roomOk = /^[A-Za-z0-9_:.-]{1,80}$/;
  async function roomGate(req, res) {
    const id = String(req.params.id || '');
    if (!roomOk.test(id)) { res.status(400).json({ error: 'Unknown room.' }); return null; }
    const leagues = await myLeagues(req);
    if (!leagues) { res.status(403).json({ error: 'Open Live on sidelineff.com and sign in to use your league rooms.' }); return null; }
    if (!leagues.has(id)) { res.status(403).json({ error: 'This room is only for people in this league.' }); return null; }
    return id;
  }
  app.get('/api/rooms/:id', needUser, async (req, res) => {
    const id = await roomGate(req, res); if (!id) return;
    const after = Number(req.query.after) || 0;
    const rows = after
      ? db.prepare('SELECT * FROM room_msgs WHERE room=? AND id>? ORDER BY id ASC LIMIT 200').all(id, after)
      : db.prepare('SELECT * FROM room_msgs WHERE room=? ORDER BY id DESC LIMIT 100').all(id).reverse();
    res.json({ room: id, messages: rows.map((m) => msgView(m, req.user.id)) });
  });
  app.post('/api/rooms/:id', needUser, async (req, res) => {
    const id = await roomGate(req, res); if (!id) return;
    const body = clean(req.body?.body, 400);
    if (!body) return res.status(400).json({ error: 'Write something first.' });
    if (isOffensive(body)) return res.status(400).json({ error: 'That message has language that isn\'t allowed here.' });
    if (tooFast(`room:${req.user.id}`, 1500)) return res.status(429).json({ error: 'Slow down a little.' });
    const info = db.prepare('INSERT INTO room_msgs (room, user_id, body, created_at) VALUES (?,?,?,?)').run(id, req.user.id, body, Date.now());
    persist.upsert('room_msgs', { id: Number(info.lastInsertRowid) });
    send('room', { room: id, id: Number(info.lastInsertRowid) });
    res.json({ message: msgView(db.prepare('SELECT * FROM room_msgs WHERE id=?').get(info.lastInsertRowid), req.user.id) });
  });

  // ---- Hot takes ----
  app.get('/api/takes', (req, res) => {
    settleTakes();
    const tab = String(req.query.tab || 'fresh'), now = Date.now(), me = req.user?.id;
    let rows;
    if (tab === 'hot') rows = db.prepare('SELECT t.*, (SELECT COUNT(*) FROM take_votes v WHERE v.take_id=t.id) n FROM takes t WHERE t.settle_at > ? ORDER BY n DESC, t.id DESC LIMIT 50').all(now);
    else if (tab === 'grade') rows = db.prepare('SELECT * FROM takes WHERE result IS NULL AND settle_at <= ? ORDER BY settle_at ASC LIMIT 50').all(now);
    else if (tab === 'receipts') rows = db.prepare("SELECT * FROM takes WHERE result IN ('hit','miss') ORDER BY settled_at DESC LIMIT 50").all();
    else if (tab === 'mine') rows = me ? db.prepare('SELECT * FROM takes WHERE user_id=? ORDER BY id DESC LIMIT 50').all(me) : [];
    else rows = db.prepare('SELECT * FROM takes WHERE settle_at > ? ORDER BY id DESC LIMIT 50').all(now);
    res.json({ tab, takes: rows.map((t) => takeView(t, me)), record: me ? takesRecord(me) : null });
  });
  app.post('/api/takes', needUser, (req, res) => {
    const body = clean(req.body?.body, 200);
    const horizon = ['week', 'month', 'season'].includes(req.body?.horizon) ? req.body.horizon : 'week';
    if (body.length < 6) return res.status(400).json({ error: 'Make it a real take (at least a few words).' });
    if (isOffensive(body)) return res.status(400).json({ error: 'That take has language that isn\'t allowed here.' });
    if (tooFast(`take:${req.user.id}`, 30000)) return res.status(429).json({ error: 'One take every 30 seconds.' });
    const open = db.prepare('SELECT COUNT(*) n FROM takes WHERE user_id=? AND result IS NULL').get(req.user.id).n;
    if (open >= 15) return res.status(400).json({ error: 'You have 15 open takes. Let some get graded first.' });
    const info = db.prepare('INSERT INTO takes (user_id, body, horizon, created_at, settle_at) VALUES (?,?,?,?,?)').run(req.user.id, body, horizon, Date.now(), settleAt(horizon));
    persist.upsert('takes', { id: Number(info.lastInsertRowid) });
    send('takes', {});
    res.json({ take: takeView(db.prepare('SELECT * FROM takes WHERE id=?').get(info.lastInsertRowid), req.user.id) });
  });
  app.post('/api/takes/:id/vote', needUser, (req, res) => {
    const t = db.prepare('SELECT * FROM takes WHERE id=?').get(Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'Take not found.' });
    if (t.user_id === req.user.id) return res.status(400).json({ error: 'You can\'t vote on your own take.' });
    const phase = takePhase(t), value = Number(req.body?.value);
    if (phase === 'final') return res.status(400).json({ error: 'This take is already settled.' });
    if (![1, -1, 0].includes(value)) return res.status(400).json({ error: 'Vote W or L.' });
    const key = { take_id: t.id, user_id: req.user.id, phase };
    if (!value) { db.prepare('DELETE FROM take_votes WHERE take_id=? AND user_id=? AND phase=?').run(t.id, req.user.id, phase); persist.remove('take_votes', key); }
    else { db.prepare('INSERT INTO take_votes (take_id, user_id, phase, value) VALUES (?,?,?,?) ON CONFLICT(take_id, user_id, phase) DO UPDATE SET value=excluded.value').run(t.id, req.user.id, phase, value); persist.upsert('take_votes', key); }
    res.json({ take: takeView(t, req.user.id) });
  });
  app.delete('/api/takes/:id', needUser, (req, res) => {
    const t = db.prepare('SELECT * FROM takes WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
    if (!t) return res.status(404).json({ error: 'Take not found.' });
    if (db.prepare('SELECT COUNT(*) n FROM take_votes WHERE take_id=?').get(t.id).n) return res.status(400).json({ error: 'People already voted, so it stays. Receipts are receipts.' });
    db.prepare('DELETE FROM takes WHERE id=?').run(t.id); persist.remove('takes', { id: t.id });
    res.json({ ok: true });
  });

  // ---- Duels ----
  app.post('/api/duels', needUser, (req, res) => {
    const w = cur();
    const n = db.prepare('SELECT COUNT(*) n FROM duels WHERE from_user=? AND season=? AND week=?').get(req.user.id, w.season, w.week).n;
    if (n >= 10) return res.status(400).json({ error: 'That\'s 10 duels this week. Settle a few first.' });
    let code; do code = newCode(); while (db.prepare('SELECT 1 FROM duels WHERE code=?').get(code));
    const info = db.prepare('INSERT INTO duels (code, season, week, from_user, created_at) VALUES (?,?,?,?,?)').run(code, w.season, w.week, req.user.id, Date.now());
    persist.upsert('duels', { id: Number(info.lastInsertRowid) });
    res.json({ duel: duelView(db.prepare('SELECT * FROM duels WHERE code=?').get(code), req.user.id) });
  });
  app.get('/api/duels', needUser, (req, res) => {
    settleDuels();
    const rows = db.prepare('SELECT * FROM duels WHERE (from_user=? OR to_user=?) ORDER BY id DESC LIMIT 30').all(req.user.id, req.user.id);
    res.json({ duels: rows.map((d) => duelView(d, req.user.id)) });
  });
  app.get('/api/duels/:code', (req, res) => {
    settleDuels();
    const d = db.prepare('SELECT * FROM duels WHERE code=?').get(String(req.params.code));
    if (!d) return res.status(404).json({ error: 'That duel link doesn\'t exist.' });
    res.json({ duel: duelView(d, req.user?.id) });
  });
  app.post('/api/duels/:code/accept', needUser, (req, res) => {
    const d = db.prepare('SELECT * FROM duels WHERE code=?').get(String(req.params.code));
    if (!d) return res.status(404).json({ error: 'That duel link doesn\'t exist.' });
    if (d.from_user === req.user.id) return res.status(400).json({ error: 'Send this link to a friend: you can\'t duel yourself.' });
    if (d.to_user && d.to_user !== req.user.id) return res.status(400).json({ error: 'Someone already took this duel.' });
    if (d.result) return res.status(400).json({ error: 'This duel is over.' });
    db.prepare('UPDATE duels SET to_user=? WHERE id=?').run(req.user.id, d.id);
    persist.upsert('duels', { id: d.id });
    res.json({ duel: duelView(db.prepare('SELECT * FROM duels WHERE id=?').get(d.id), req.user.id) });
  });

  // ---- Aura ----
  app.get('/api/aura', (req, res) => res.json(auraBoard(Number(req.query.week) || wk())));

  // ---- House + creators ----
  app.get('/api/creators', (req, res) => {
    const w = cur();
    const h = house();
    const list = creatorsList().map((c) => {
      const u = db.prepare("SELECT id FROM users WHERE name=? COLLATE NOCASE OR json_extract(profile, '$.username')=? COLLATE NOCASE").get(c.username, c.username);
      return u ? { ...c, ...who(u.id), userId: u.id, lineup: lineupFor(u.id, w.week, w.season) } : null;
    }).filter(Boolean);
    const all = db.prepare('SELECT user_id FROM lineups WHERE season=? AND week=?').all(w.season, w.week).map((r) => ({ id: r.user_id, total: lineupFor(r.user_id, w.week, w.season)?.total || 0 }));
    const beat = (t) => all.filter((x) => x.total > t).length;
    const mine = req.user ? lineupFor(req.user.id, w.week, w.season) : null;
    res.json({ week: w.week, house: h ? { ...h, beatenBy: beat(h.total), of: all.length } : null,
      creators: list.map(({ userId, ...c }) => ({ ...c, beatenBy: beat(c.lineup?.total || 0), of: all.length })),
      me: mine ? { total: mine.total, beatHouse: h ? mine.total > h.total : null } : null,
      started: engine.listGames().some((g) => g.state !== 'pre') });
  });

  // ---- Challenges + badges ----
  app.get('/api/challenges', (req, res) => {
    if (req.user) checkBadges(req.user.id);
    res.json({ ...challengesFor(req.user?.id), badges: req.user ? badgesOf(req.user.id) : [], callit: req.user ? callStreak(req.user.id) : null, daily: req.user ? dailyStats(req.user.id) : null, takes: req.user ? takesRecord(req.user.id) : null });
  });

  // ---- Wrapped ----
  app.get('/api/wrapped', needUser, (req, res) => {
    settleDuels(); settleTakes();
    const out = wrapped(req.user.id, { week: Number(req.query.week) || wk(), season: req.query.season === '1' });
    if (!out) return res.status(404).json({ error: 'No games that week.' });
    res.json(out);
  });

  // ---- Push alerts ----
  app.get('/api/push/key', (_req, res) => res.json({ key: vapid?.publicKey || null }));
  app.post('/api/push/subscribe', (req, res) => {
    const sub = req.body?.sub;
    if (!webpush || !sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return res.status(400).json({ error: 'Alerts aren\'t available here.' });
    const players = (Array.isArray(req.body.players) ? req.body.players : []).map(String).filter((x) => /^\d+$/.test(x)).slice(0, 200);
    const base = /^https:\/\/[^\s]+$/.test(String(req.body.base || '')) ? String(req.body.base).split('#')[0] : '';
    const rec = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, base };
    const prefs = { redzone: ['off', 'mine', 'all'].includes(req.body.prefs?.redzone) ? req.body.prefs.redzone : 'mine' };
    db.prepare(`INSERT INTO push_subs (endpoint, user_id, sub, players, created_at, prefs) VALUES (?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, sub=excluded.sub, players=excluded.players, prefs=excluded.prefs`).run(sub.endpoint, req.user?.id || null, JSON.stringify(rec), players.join(','), Date.now(), JSON.stringify(prefs));
    persist.upsert('push_subs', { endpoint: sub.endpoint });
    subs.set(sub.endpoint, { sub: rec, players: new Set(players), user_id: req.user?.id || null, prefs });
    res.json({ ok: true, players: players.length });
  });
  app.post('/api/push/unsubscribe', (req, res) => {
    const endpoint = String(req.body?.endpoint || '');
    subs.delete(endpoint);
    db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(endpoint); persist.remove('push_subs', { endpoint });
    res.json({ ok: true });
  });
  app.post('/api/push/test', (req, res) => {
    const s = subs.get(String(req.body?.endpoint || ''));
    if (!s || !webpush) return res.status(404).json({ error: 'Turn alerts on first.' });
    webpush.sendNotification(s.sub, JSON.stringify({ title: '🏈 Alerts are on', body: 'You\'ll hear about it the second your players score.', tag: 'test', url: `${s.sub.base || ''}#/leagues` }), { TTL: 60 })
      .then(() => res.json({ ok: true })).catch((e) => res.status(500).json({ error: `Couldn't send (${e.statusCode || e.message}).` }));
  });

  // ---- pictures for share cards ----
  app.get('/api/img', async (req, res) => {
    let u;
    try { u = new URL(String(req.query.u || '')); } catch { return res.status(400).end(); }
    if (u.protocol !== 'https:' || !IMG_HOSTS.test(u.hostname)) return res.status(400).end();
    const hit = imgCache.get(u.href);
    const reply = (c) => { res.set({ 'content-type': c.type, 'cache-control': 'public, max-age=86400' }); res.end(c.buf); };
    if (hit) return reply(hit);
    try {
      const r = await fetch(u.href, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; sideline-live)' } });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !/^image\//.test(type)) return res.status(404).end();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 3e6) return res.status(413).end();
      const c = { type, buf };
      imgCache.set(u.href, c);
      if (imgCache.size > 300) imgCache.delete(imgCache.keys().next().value);
      reply(c);
    } catch { res.status(502).end(); }
  });

  // The installed app's service worker may control everything under /live
  app.get('/sw.js', (_req, res) => {
    res.set({ 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache', 'Content-Type': 'application/javascript' });
    res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
  });
}

// Runs after saved data is restored
function start() {
  setupPush();
  // anything still waiting from before a restart can't be graded fairly: call it off
  const stale = db.prepare("SELECT id FROM callit WHERE result IS NULL AND created_at < ?").all(Date.now() - 2 * 60e3);
  for (const r of stale) { db.prepare("UPDATE callit SET result='void', credits_delta=0 WHERE id=?").run(r.id); persist.upsert('callit', { id: r.id }); }
  setInterval(() => {
    try { settleTakes(); settleDuels(); house(); } catch (e) { console.warn('[arcade]', e.message); }
    const old = db.prepare("SELECT id FROM callit WHERE result IS NULL AND created_at < ?").all(Date.now() - 10 * 60e3);
    for (const r of old) { db.prepare("UPDATE callit SET result='void', credits_delta=0 WHERE id=?").run(r.id); persist.upsert('callit', { id: r.id }); }
  }, 5 * 60e3).unref();
  setTimeout(() => { try { house(); puzzleFor(etDay()); } catch { /* later */ } }, 60e3).unref();
}

// shared with src/arcade-plus.js
const shared = { credit, who, whoExtras, kvGet, kvSet, cur, weekRange, weekPoints, auraOf, etDay, award, checkBadges,
  onEarn: (f) => earnHandlers.push(f), pushTo, send: (e, d) => send(e, d), priced: () => pricedSlate() };
module.exports = { shared, mount, start, callCategory, opensWindow, auraOf, bestLineup, dailyCheck, etDay, etDayStart, addDays, divOf, weekChallenges, _onPlay: onPlayForCalls, _grade: gradeCalls, _windows: windows };
