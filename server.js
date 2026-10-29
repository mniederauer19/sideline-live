const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cfg = require('./src/config');
const db = require('./src/db');
const nflverse = require('./src/nflverse');
const engine = require('./src/engine');
const sidelineAuth = require('./src/sideline-auth');
const persist = require('./src/persist');

const app = express();
app.set('trust proxy', true); // behind Railway / Cloudflare
app.use(express.json({ limit: '50kb' }));

// Smaller downloads (helps on hosts with a monthly bandwidth limit). The live stream is left alone.
try {
  const compression = require('compression');
  app.use(compression({ filter: (req, res) => !String(res.getHeader('Content-Type') || '').includes('text/event-stream') && compression.filter(req, res) }));
} catch { /* optional: run `npm install` to enable */ }

// ---------- CORS (lets sidelineff.com call this API if hosted on another subdomain) ----------
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && cfg.CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- users ----------
// AUTH_MODE=local: pick a username here (a saved token identifies you).
// AUTH_MODE=sideline: you're signed in with your sidelineff.com account (see src/sideline-auth.js).
const q = {
  userByToken: db.prepare('SELECT id, name, credits FROM users WHERE token=?'),
  userByName: db.prepare('SELECT id FROM users WHERE name=?'),
  createUser: db.prepare('INSERT INTO users (name, token, credits, created_at) VALUES (?, ?, ?, ?)'),
};
async function auth(req, _res, next) {
  req.user = null;
  if (!req.path.startsWith('/api/')) return next();
  if (cfg.AUTH_MODE === 'sideline') {
    try { req.user = await sidelineAuth.userFromCookie(req.headers.cookie); } catch { req.user = null; }
  } else {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    req.user = token ? q.userByToken.get(token) || null : null;
  }
  next();
}
app.use(auth);
const signInMsg = cfg.AUTH_MODE === 'sideline' ? 'Sign in with your Sideline account to do that.' : 'Pick a username to do that.';
const needUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: signInMsg }));
const authInfo = { mode: cfg.AUTH_MODE, loginUrl: cfg.AUTH_MODE === 'sideline' ? cfg.SIDELINE_LOGIN_URL : null };

function tier(credits) {
  if (credits >= 3000) return 'Hall of Fame';
  if (credits >= 2200) return 'All-Pro';
  if (credits >= 1600) return 'Pro Bowl';
  if (credits >= 1200) return 'Starter';
  if (credits >= 900) return 'Rookie';
  return 'Practice squad';
}
function record(userId) {
  const r = db.prepare(`SELECT SUM(result='win') w, SUM(result='loss') l, SUM(result='push') p FROM picks WHERE user_id=?`).get(userId);
  return { w: r.w || 0, l: r.l || 0, p: r.p || 0 };
}
function rankOf(credits) {
  return db.prepare('SELECT COUNT(*) + 1 AS r FROM users WHERE credits > ?').get(credits).r;
}

app.post('/api/users', (req, res) => {
  if (cfg.AUTH_MODE === 'sideline') return res.status(403).json({ error: 'Sign in with your Sideline account instead.' });
  const name = String(req.body?.name || '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return res.status(400).json({ error: 'Use 3–20 letters, numbers or underscores.' });
  if (q.userByName.get(name)) return res.status(409).json({ error: 'That username is taken.' });
  const token = crypto.randomBytes(24).toString('hex');
  q.createUser.run(name, token, cfg.START_CREDITS, Date.now());
  const user = q.userByToken.get(token);
  persist.upsert('users', { id: user.id });
  res.json({ token, user: { ...user, tier: tier(user.credits) } });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null, auth: authInfo });
  const u = req.user;
  res.json({ user: { ...u, tier: tier(u.credits), rank: rankOf(u.credits), record: record(u.id) }, auth: authInfo });
});

// ---------- games + picks ----------
function pickSplits(gameId) {
  const rows = db.prepare('SELECT market, selection, COUNT(*) n FROM picks WHERE game_id=? GROUP BY market, selection').all(gameId);
  const out = {};
  for (const r of rows) (out[r.market] ||= {})[r.selection] = r.n;
  return out;
}
function pickOpen(g) {
  return g.state === 'pre' && Date.now() < g.start && !!g.odds;
}
// ?week=N picks a week of the season (defaults to the current NFL week)
const weekOf = (req) => Number(req.query.week) || engine.currentWeek().week;

app.get('/api/schedule', (_req, res) => {
  res.json({ ...engine.currentWeek(), weeks: engine.schedule(), sync: engine.sync });
});

app.get('/api/games', (req, res) => {
  const mine = req.user ? db.prepare('SELECT * FROM picks WHERE user_id=?').all(req.user.id) : [];
  const games = engine.listGames(weekOf(req)).map((g) => ({
    ...g,
    pickOpen: pickOpen(g),
    splits: pickSplits(g.id),
    myPicks: mine.filter((p) => p.game_id === g.id).map((p) => ({ market: p.market, selection: p.selection, line: p.line, fav: p.fav, result: p.result, delta: p.credits_delta })),
  }));
  res.json({ week: engine.currentWeek(), selected: weekOf(req), demo: cfg.DEMO, games });
});

app.get('/api/games/:id', (req, res) => {
  const g = engine.games.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  res.json({ game: { ...g, pickOpen: pickOpen(g), splits: pickSplits(g.id) } });
});

app.post('/api/picks', needUser, (req, res) => {
  const { gameId, market, selection } = req.body || {};
  const g = engine.games.get(String(gameId));
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  if (!pickOpen(g)) return res.status(400).json({ error: 'Picks for this game are locked.' });
  let line;
  if (market === 'spread') {
    if (![g.home.abbr, g.away.abbr].includes(selection) || g.odds.spread == null) return res.status(400).json({ error: 'Choose a team.' });
    line = g.odds.spread;
  } else if (market === 'total') {
    if (!['over', 'under'].includes(selection) || g.odds.total == null) return res.status(400).json({ error: 'Choose over or under.' });
    line = g.odds.total;
  } else return res.status(400).json({ error: 'Unknown market.' });
  db.prepare(`INSERT INTO picks (user_id, game_id, market, selection, fav, line, created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id, game_id, market) DO UPDATE SET selection=excluded.selection, fav=excluded.fav, line=excluded.line, created_at=excluded.created_at`)
    .run(req.user.id, g.id, market, selection, g.odds.fav, line, Date.now());
  persist.upsert('picks', { user_id: req.user.id, game_id: g.id, market });
  engine.bus.emit('splits', { gameId: g.id, splits: pickSplits(g.id) });
  res.json({ ok: true, splits: pickSplits(g.id) });
});

app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare('SELECT id, name, credits FROM users ORDER BY credits DESC, id ASC LIMIT 100').all();
  res.json({
    rows: rows.map((u, i) => ({ rank: i + 1, name: u.name, credits: u.credits, tier: tier(u.credits), record: record(u.id), me: req.user?.id === u.id })),
  });
});

// Fantasy box score for one game (PPR leaders) + latest win probability
app.get('/api/games/:id/fantasy', (req, res) => {
  const g = engine.games.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  const players = [...engine.boxFor(g.id).values()].map((t) => {
    const nv = nflverse.get(t.id);
    return { id: t.id, name: nv?.name || t.name, pos: nv?.pos || '', team: nv?.team || t.team, headshot: nv?.headshot || '',
      ppr: t.ppr, line: t.line, salary: nv?.salary || null, ppg: nv?.ppg ?? null };
  }).filter((p) => p.ppr !== 0 || p.line).sort((a, b) => b.ppr - a.ppr);
  const last = db.prepare("SELECT data FROM plays WHERE game_id=? AND data LIKE '%\"wp\":%' ORDER BY seq DESC LIMIT 1").get(g.id);
  const wp = last ? JSON.parse(last.data).wp : null;
  let homeWp = null;
  if (wp) homeWp = wp.team === g.home.abbr ? wp.pct : Math.round((100 - wp.pct) * 10) / 10;
  const plays = db.prepare('SELECT COUNT(*) n, SUM(explosive) big, AVG(ppr) avg FROM plays WHERE game_id=?').get(g.id);
  res.json({ game: g, players, homeWp, plays });
});

// Top PPR scorers across this week's games so far
app.get('/api/leaders', (req, res) => {
  const players = [];
  for (const g of engine.listGames(weekOf(req))) {
    for (const t of engine.boxFor(g.id).values()) {
      const nv = nflverse.get(t.id);
      if (!nv && !t.name) continue;
      players.push({ id: t.id, name: nv?.name || t.name, pos: nv?.pos || 'K', team: nv?.team || t.team, ppr: t.ppr, line: t.line, gameState: g.state });
    }
  }
  players.sort((a, b) => b.ppr - a.ppr);
  res.json({ players: players.slice(0, 25) });
});

// ---------- feed ----------
const EMOJIS = ['🔥', '😂', '😭', '🤯', '💀', '👏'];
function social(ids, userId) {
  if (!ids.length) return {};
  const ph = ids.map(() => '?').join(',');
  const out = Object.fromEntries(ids.map((id) => [id, { reactions: {}, mine: [], score: 0, myVote: 0, comments: 0 }]));
  for (const r of db.prepare(`SELECT play_id, emoji, COUNT(*) n FROM reactions WHERE play_id IN (${ph}) GROUP BY play_id, emoji`).all(...ids)) out[r.play_id].reactions[r.emoji] = r.n;
  for (const r of db.prepare(`SELECT play_id, COALESCE(SUM(value),0) s FROM votes WHERE play_id IN (${ph}) GROUP BY play_id`).all(...ids)) out[r.play_id].score = r.s;
  for (const r of db.prepare(`SELECT play_id, COUNT(*) n FROM comments WHERE play_id IN (${ph}) GROUP BY play_id`).all(...ids)) out[r.play_id].comments = r.n;
  if (userId) {
    for (const r of db.prepare(`SELECT play_id, emoji FROM reactions WHERE user_id=? AND play_id IN (${ph})`).all(userId, ...ids)) out[r.play_id].mine.push(r.emoji);
    for (const r of db.prepare(`SELECT play_id, value FROM votes WHERE user_id=? AND play_id IN (${ph})`).all(userId, ...ids)) out[r.play_id].myVote = r.value;
  }
  return out;
}
function withSocial(plays, userId) {
  const s = social(plays.map((p) => p.id), userId);
  return plays.map((p) => ({ ...p, social: s[p.id] }));
}
function myLineupIds(userId) {
  const w = engine.currentWeek();
  const row = db.prepare('SELECT players FROM lineups WHERE user_id=? AND season=? AND week=?').get(userId, w.season, w.week);
  return row ? JSON.parse(row.players).map((p) => String(p.id)) : [];
}

app.get('/api/feed', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const where = [];
  const args = [];
  const week = engine.listGames(weekOf(req)).map((g) => g.id);
  if (req.query.game) { where.push('game_id = ?'); args.push(String(req.query.game)); }
  else if (week.length) { where.push(`game_id IN (${week.map(() => '?').join(',')})`); args.push(...week); }
  const f = req.query.filter || 'all';
  if (f === 'scoring') where.push('scoring = 1');
  if (f === 'ppr5') where.push('ppr >= 5');
  if (f === 'ppr10') where.push('ppr >= 10');
  if (f === 'big') where.push('(explosive = 1 OR ppr >= 8)');
  if (f === 'mine') {
    const ids = req.user ? myLineupIds(req.user.id) : [];
    if (!ids.length) return res.json({ plays: [], next: null });
    where.push(`(${ids.map(() => 'player_ids LIKE ?').join(' OR ')})`);
    args.push(...ids.map((id) => `%,${id},%`));
  }
  if (req.query.player) { where.push('player_ids LIKE ?'); args.push(`%,${req.query.player},%`); }
  if (req.query.before) {
    const [ts, seq] = String(req.query.before).split(':').map(Number);
    where.push('(ts < ? OR (ts = ? AND seq < ?))'); args.push(ts, ts, seq);
  }
  const rows = db.prepare(`SELECT data FROM plays ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC, seq DESC LIMIT ?`).all(...args, limit);
  const plays = rows.map((r) => JSON.parse(r.data));
  const last = plays[plays.length - 1];
  res.json({ plays: withSocial(plays, req.user?.id), next: plays.length === limit && last ? `${last.ts}:${last.seq}` : null });
});

app.get('/api/plays/:id', (req, res) => {
  const row = db.prepare('SELECT data FROM plays WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Play not found.' });
  res.json({ play: withSocial([JSON.parse(row.data)], req.user?.id)[0] });
});

// ---------- reactions, votes, comments ----------
const playExists = (id) => !!db.prepare('SELECT 1 FROM plays WHERE id=?').get(id);
function pushSocial(id) {
  engine.bus.emit('social', { id, social: social([id])[id] });
}

app.post('/api/plays/:id/react', needUser, (req, res) => {
  const { emoji } = req.body || {};
  if (!EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Unknown reaction.' });
  if (!playExists(req.params.id)) return res.status(404).json({ error: 'Play not found.' });
  const has = db.prepare('SELECT 1 FROM reactions WHERE play_id=? AND user_id=? AND emoji=?').get(req.params.id, req.user.id, emoji);
  const key = { play_id: req.params.id, user_id: req.user.id, emoji };
  if (has) { db.prepare('DELETE FROM reactions WHERE play_id=? AND user_id=? AND emoji=?').run(req.params.id, req.user.id, emoji); persist.remove('reactions', key); }
  else { db.prepare('INSERT INTO reactions (play_id, user_id, emoji) VALUES (?,?,?)').run(req.params.id, req.user.id, emoji); persist.upsert('reactions', key); }
  pushSocial(req.params.id);
  res.json({ social: social([req.params.id], req.user.id)[req.params.id] });
});

app.post('/api/plays/:id/vote', needUser, (req, res) => {
  const value = Number(req.body?.value);
  if (![1, -1, 0].includes(value)) return res.status(400).json({ error: 'Vote must be 1, -1 or 0.' });
  if (!playExists(req.params.id)) return res.status(404).json({ error: 'Play not found.' });
  const key = { play_id: req.params.id, user_id: req.user.id };
  if (value === 0) { db.prepare('DELETE FROM votes WHERE play_id=? AND user_id=?').run(req.params.id, req.user.id); persist.remove('votes', key); }
  else { db.prepare('INSERT INTO votes (play_id, user_id, value) VALUES (?,?,?) ON CONFLICT(play_id, user_id) DO UPDATE SET value=excluded.value').run(req.params.id, req.user.id, value); persist.upsert('votes', key); }
  pushSocial(req.params.id);
  res.json({ social: social([req.params.id], req.user.id)[req.params.id] });
});

app.get('/api/plays/:id/comments', (req, res) => {
  const rows = db.prepare(`SELECT c.id, c.body, c.created_at, u.name FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.play_id=? ORDER BY c.id DESC LIMIT 200`).all(req.params.id);
  res.json({ comments: rows });
});

const lastComment = new Map();
app.post('/api/plays/:id/comments', needUser, (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write something first.' });
  if (body.length > 500) return res.status(400).json({ error: 'Keep comments under 500 characters.' });
  if (!playExists(req.params.id)) return res.status(404).json({ error: 'Play not found.' });
  if (Date.now() - (lastComment.get(req.user.id) || 0) < 3000) return res.status(429).json({ error: 'Slow down: one comment every 3 seconds.' });
  lastComment.set(req.user.id, Date.now());
  const info = db.prepare('INSERT INTO comments (play_id, user_id, body, created_at) VALUES (?,?,?,?)').run(req.params.id, req.user.id, body, Date.now());
  persist.upsert('comments', { id: Number(info.lastInsertRowid) });
  const comment = { id: info.lastInsertRowid, body, created_at: Date.now(), name: req.user.name };
  engine.bus.emit('comment', { playId: req.params.id, comment });
  pushSocial(req.params.id);
  res.json({ comment });
});

// ---------- weekly salary-cap lineups ----------
const SLOT_POS = { QB: ['QB'], RB1: ['RB'], RB2: ['RB'], WR1: ['WR'], WR2: ['WR'], WR3: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'] };

function slatePlayers() {
  const games = engine.listGames();
  const byTeam = new Map();
  for (const g of games) {
    byTeam.set(g.home.abbr, { g, opp: g.away.abbr, home: true });
    byTeam.set(g.away.abbr, { g, opp: g.home.abbr, home: false });
  }
  const maxWeek = Math.max(0, ...nflverse.all().map((p) => p.weeks[p.weeks.length - 1]?.week || 0));
  return nflverse.all()
    .filter((p) => byTeam.has(p.team) && (p.weeks[p.weeks.length - 1]?.week || 0) >= maxWeek - 2 && p.ppg >= 1)
    .map((p) => {
      const t = byTeam.get(p.team);
      return {
        id: p.id, name: p.name, pos: p.pos, team: p.team, opp: t.opp, home: t.home, headshot: p.headshot,
        salary: p.salary, ppg: p.ppg, last3Ppg: p.last3Ppg, tgtShare: p.tgtShare, adot: p.adot,
        gameId: t.g.id, kickoff: t.g.start, locked: t.g.state !== 'pre' || Date.now() >= t.g.start,
      };
    })
    .sort((a, b) => b.salary - a.salary || b.ppg - a.ppg);
}

app.get('/api/slate', (req, res) => {
  res.json({ ...engine.currentWeek(), cap: cfg.SALARY_CAP, slots: cfg.ROSTER_SLOTS, slotPos: SLOT_POS, players: slatePlayers() });
});

function liveLineup(players) {
  return players.map((s) => {
    const nv = nflverse.get(s.id);
    const pg = engine.playerGame(s.id);
    const g = pg?.game || (nv && engine.teamGame(nv.team));
    return {
      slot: s.slot, id: s.id, name: nv?.name || pg?.name || 'Unknown', pos: nv?.pos || '', team: nv?.team || pg?.team || '',
      headshot: nv?.headshot || '', salary: nv?.salary || 0,
      points: pg?.ppr || 0, line: pg?.line || '', gameState: g?.state || 'pre', gameDetail: g?.detail || '',
    };
  });
}

app.get('/api/lineups/me', needUser, (req, res) => {
  const w = engine.currentWeek();
  const row = db.prepare('SELECT * FROM lineups WHERE user_id=? AND season=? AND week=?').get(req.user.id, w.season, w.week);
  if (!row) return res.json({ lineup: null });
  const players = liveLineup(JSON.parse(row.players));
  res.json({ lineup: { salary: row.salary, players, points: +players.reduce((s, p) => s + p.points, 0).toFixed(2) } });
});

app.post('/api/lineups', needUser, (req, res) => {
  const w = engine.currentWeek();
  const sel = Array.isArray(req.body?.players) ? req.body.players : [];
  const pool = new Map(slatePlayers().map((p) => [p.id, p]));
  const existing = db.prepare('SELECT players FROM lineups WHERE user_id=? AND season=? AND week=?').get(req.user.id, w.season, w.week);
  const prev = new Map(existing ? JSON.parse(existing.players).map((p) => [p.slot, String(p.id)]) : []);

  const seen = new Set();
  let salary = 0;
  const clean = [];
  for (const slot of cfg.ROSTER_SLOTS) {
    const pick = sel.find((p) => p.slot === slot);
    const prevId = prev.get(slot);
    const prevP = prevId && pool.get(prevId);
    if (prevP?.locked && String(pick?.id) !== prevId) return res.status(400).json({ error: `${prevP.name}'s game has started, so your ${slot} is locked.` });
    if (!pick) return res.status(400).json({ error: `Fill your ${slot} spot.` });
    const p = pool.get(String(pick.id));
    if (!p) return res.status(400).json({ error: `That ${slot} isn't on this week's slate.` });
    if (!SLOT_POS[slot].includes(p.pos)) return res.status(400).json({ error: `${p.name} can't play ${slot}.` });
    if (p.locked && prevId !== p.id) return res.status(400).json({ error: `${p.name}'s game has started. Pick someone who hasn't played yet.` });
    if (seen.has(p.id)) return res.status(400).json({ error: `${p.name} is in your lineup twice.` });
    seen.add(p.id);
    salary += p.salary;
    clean.push({ slot, id: p.id });
  }
  if (salary > cfg.SALARY_CAP) return res.status(400).json({ error: `You're $${(salary - cfg.SALARY_CAP).toLocaleString()} over the cap.` });
  const now = Date.now();
  db.prepare(`INSERT INTO lineups (user_id, season, week, players, salary, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id, season, week) DO UPDATE SET players=excluded.players, salary=excluded.salary, updated_at=excluded.updated_at`)
    .run(req.user.id, w.season, w.week, JSON.stringify(clean), salary, now, now);
  persist.upsert('lineups', { user_id: req.user.id, season: w.season, week: w.week });
  engine.bus.emit('lineups');
  res.json({ ok: true, salary });
});

app.get('/api/lineups', (req, res) => {
  const w = engine.currentWeek();
  const rows = db.prepare(`SELECT l.*, u.name FROM lineups l JOIN users u ON u.id=l.user_id WHERE l.season=? AND l.week=?`).all(w.season, w.week);
  const out = rows.map((r) => {
    const players = liveLineup(JSON.parse(r.players));
    return { name: r.name, me: req.user?.id === r.user_id, salary: r.salary, players, points: +players.reduce((s, p) => s + p.points, 0).toFixed(2) };
  }).sort((a, b) => b.points - a.points || a.salary - b.salary);
  out.forEach((l, i) => { l.rank = i + 1; });
  // Most-rostered players this week
  const counts = new Map();
  for (const l of out) for (const p of l.players) counts.set(p.id, { ...p, n: (counts.get(p.id)?.n || 0) + 1 });
  const popular = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((p) => ({ name: p.name, pos: p.pos, team: p.team, pct: Math.round(p.n / out.length * 100) }));
  res.json({ ...w, lineups: out, popular });
});

// ---------- live push (Server-Sent Events) ----------
const clients = new Set();
const BOOT_ID = Date.now().toString(36);
app.get('/api/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ boot: BOOT_ID, dev: DEV })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
const send = (event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
};
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000).unref();
for (const ev of ['games', 'game', 'refresh', 'points', 'social', 'comment', 'splits', 'leaderboard', 'lineups', 'sync', 'schedule']) {
  engine.bus.on(ev, (d) => send(ev, d ?? {}));
}
engine.bus.on('play', (p) => send('play', { ...p, social: { reactions: {}, mine: [], score: 0, myVote: 0, comments: 0 } }));
engine.bus.on('play_update', (p) => send('play_update', p));

// While developing (npm run demo / npm run dev), open pages refresh themselves
// whenever a file in public/ changes. Server files restart via node --watch.
const DEV = cfg.DEMO || process.execArgv.some((x) => x.startsWith('--watch'));
if (DEV) {
  let t;
  try {
    require('fs').watch(path.join(__dirname, 'public'), { recursive: true }, () => {
      clearTimeout(t);
      t = setTimeout(() => send('reload', {}), 150);
    });
  } catch (e) { console.warn('[dev] auto-refresh unavailable:', e.message); }

  // Developer helper: the play parser as a browser script, for testing against real games
  app.get('/dev/parse.js', (_req, res) => {
    const fs = require('fs');
    const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
    res.type('application/javascript').send(`(function(){const mods={},cache={};
function req(n){n=n.replace('./','');if(cache[n])return cache[n].exports;const m={exports:{}};cache[n]=m;mods[n](m,m.exports,req);return m.exports;}
mods.ep=function(module,exports,require){${src('ep.js')}\n};
mods.parse=function(module,exports,require){${src('parse.js')}\n};
window.__parse=req('parse');})();`);
  });
}

app.get('/api/health', (_req, res) => res.json({ ok: true, demo: cfg.DEMO, week: engine.currentWeek(), games: engine.listGames().length, seasonGames: engine.games.size,
  plays: db.prepare('SELECT COUNT(*) n FROM plays').get().n, sync: engine.sync,
  saved: persist.enabled ? { restored: persist.state.restored, pending: persist.state.pending, failed: persist.state.failed } : null, players: nflverse.state.byEspn.size, clients: clients.size }));

// Browsers re-check page files each visit (cheap 304s), so updates show up right away
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

process.on('SIGTERM', async () => {
  await persist.flush().catch(() => {});
  try { db.close(); } catch { /* ignore */ }
  process.exit(0);
});

(async () => {
  // Bring back saved accounts, comments, picks and lineups first (when DATABASE_URL is set)
  await persist.restoreWithRetry();
  nflverse.start();
  engine.start();
  app.listen(cfg.PORT, () => console.log(`Sideline Live on http://localhost:${cfg.PORT}${cfg.DEMO ? '  (DEMO MODE)' : ''}`));

  // Free hosts (like Render) put the site to sleep after 15 minutes without visitors, which
  // would stop it following live games. It visits itself every 10 minutes to stay awake.
  const self = process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL;
  if (self && !cfg.DEMO) {
    setInterval(() => { fetch(self.replace(/\/$/, '') + '/api/health', { signal: AbortSignal.timeout(20000) }).catch(() => {}); }, 10 * 60 * 1000).unref();
  }
})();
