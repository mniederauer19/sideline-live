// More of the Arcade:
//   Props        free player props: pick 2-5 More/Less, all must hit (credits only)
//   Moment cards collectible cards of the week's biggest plays, from packs you earn; swap with friends
//   Red zone     an alert the moment a game reaches the red zone (in the app, and on your phone)
//   Locker       levels from everything you do, unlocking share-card frames, color themes and name tags
const crypto = require('crypto');
const db = require('./db');
const persist = require('./persist');
const engine = require('./engine');
const nflverse = require('./nflverse');
const weeklyRanks = require('./weekly-ranks');
const { shared: A } = require('./arcade');

db.exec(`
CREATE TABLE IF NOT EXISTS prop_slips (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, season INTEGER NOT NULL, week INTEGER NOT NULL,
  legs TEXT NOT NULL, created_at INTEGER NOT NULL, result TEXT, credits_delta INTEGER, settled_at INTEGER
);
CREATE TABLE IF NOT EXISTS packs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, key TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL, opened_at INTEGER, UNIQUE (user_id, key));
CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, play_id TEXT NOT NULL, rarity TEXT NOT NULL, season INTEGER, week INTEGER, data TEXT NOT NULL, pack_id INTEGER, earned_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS cards_user ON cards(user_id);
CREATE TABLE IF NOT EXISTS card_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, from_user INTEGER NOT NULL, card_id INTEGER NOT NULL, to_user INTEGER, offer_card_id INTEGER, status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS locker (user_id INTEGER PRIMARY KEY, frame TEXT, theme TEXT, team TEXT, tag TEXT);
`);
{
  const INT = 'BIGINT', TXT = 'TEXT';
  Object.assign(persist.TABLES, {
    prop_slips: { pk: ['id'], cols: { id: INT, user_id: INT, season: INT, week: INT, legs: TXT, created_at: INT, result: TXT, credits_delta: INT, settled_at: INT } },
    packs: { pk: ['id'], cols: { id: INT, user_id: INT, key: TXT, source: TXT, created_at: INT, opened_at: INT } },
    cards: { pk: ['id'], cols: { id: INT, user_id: INT, play_id: TXT, rarity: TXT, season: INT, week: INT, data: TXT, pack_id: INT, earned_at: INT } },
    card_trades: { pk: ['id'], cols: { id: INT, code: TXT, from_user: INT, card_id: INT, to_user: INT, offer_card_id: INT, status: TXT, created_at: INT } },
    locker: { pk: ['user_id'], cols: { user_id: INT, frame: TXT, theme: TXT, team: TXT, tag: TXT } },
  });
}
const code = () => { const C = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (const b of crypto.randomBytes(7)) s += C[b % C.length]; return s; };

// ======================= PLAYER PROPS =======================
// Lines come from sidelineff.com's weekly projections (the same numbers as its rankings page),
// set to the nearest half point and frozen for the week once posted.
const STAT_LABEL = { passYds: 'Pass yards', rushYds: 'Rush yards', recYds: 'Rec yards', rec: 'Catches', ppr: 'Fantasy pts' };
const PAYOUT = { 2: 60, 3: 150, 4: 300, 5: 600 };
const RANK_CUT = { QB: 16, RB: 30, WR: 40, TE: 14 };
const half = (v) => Math.floor(v) + 0.5;
function propBoard() {
  const w = A.cur();
  if (!w.week) return { week: null, players: [] };
  const key = `props:${w.season}:${w.week}`;
  const board = A.kvGet(key) || {};
  let changed = false;
  const slatePlayers = A.priced().players;
  if (weeklyRanks.state.rows.size && weeklyRanks.state.week === w.week) {
    for (const p of slatePlayers) {
      if (board[p.id] || p.locked || !p.weekRank || p.weekRank > (RANK_CUT[p.pos] || 0) || p.inj === 'O') continue;
      const r = weeklyRanks.rankOf(p.name, p.pos);
      if (!r) continue;
      const lines = {};
      if (p.pos === 'QB' && r.passYds >= 100) lines.passYds = half(r.passYds);
      if (p.pos === 'RB' && r.rushYds >= 15) lines.rushYds = half(r.rushYds);
      if (['WR', 'TE'].includes(p.pos) && r.recYds >= 15) lines.recYds = half(r.recYds);
      if (['WR', 'TE', 'RB'].includes(p.pos) && r.rec >= 3) lines.rec = half(r.rec);
      if (r.proj >= 5) lines.ppr = half(r.proj);
      if (Object.keys(lines).length) { board[p.id] = lines; changed = true; }
    }
    if (changed) A.kvSet(key, board);
  }
  const slate = new Map(slatePlayers.map((p) => [String(p.id), p]));
  const players = Object.entries(board).map(([id, lines]) => {
    const p = slate.get(String(id)) || {};
    const nv = nflverse.get(id);
    return { id: String(id), name: p.name || nv?.name || 'Player', pos: p.pos || nv?.pos || '', team: p.team || nv?.team || '', opp: p.opp || '', home: p.home, headshot: p.headshot || nv?.headshot || '',
      gameId: p.gameId || null, kickoff: p.kickoff || null, locked: p.locked !== false, rank: p.weekRank || null, lines };
  }).sort((a, b) => (a.kickoff || 0) - (b.kickoff || 0) || (a.rank || 99) - (b.rank || 99));
  return { week: w.week, season: w.season, players };
}
function statNow(pid, stat, gameId) {
  const box = gameId ? engine.boxFor(gameId) : null;
  const t = box?.get(String(pid));
  if (!t) return null;
  return stat === 'ppr' ? t.ppr : (t.s?.[stat] || 0);
}
function legState(l) {
  const g = l.gameId ? engine.games.get(l.gameId) : null;
  const v = statNow(l.pid, l.stat, l.gameId);
  const state = g?.state || 'pre';
  // graded only when the game is final; while it's live, show which way it's heading
  const result = state === 'post' ? (v == null ? 'void' : (l.side === 'more' ? v > l.line : v < l.line) ? 'hit' : 'miss') : null;
  const trend = state === 'in' && v != null ? ((l.side === 'more' ? v > l.line : v < l.line) ? 'up' : 'down') : null;
  return { ...l, now: v, state, result, trend };
}
function slipView(s) {
  const legs = JSON.parse(s.legs).map(legState);
  const live = legs.filter((l) => l.result !== 'void');
  return { id: s.id, week: s.week, at: s.created_at, result: s.result, delta: s.credits_delta, legs, payout: PAYOUT[live.length] || 0 };
}
function settleSlips() {
  for (const s of db.prepare('SELECT * FROM prop_slips WHERE result IS NULL').all()) {
    const legs = JSON.parse(s.legs).map(legState);
    const live = legs.filter((l) => l.result !== 'void');
    let result = null;
    if (legs.some((l) => l.result === 'miss')) result = 'loss';
    else if (legs.every((l) => l.result)) result = live.length < 2 ? 'void' : 'win';
    if (!result) continue;
    const delta = result === 'win' ? PAYOUT[live.length] : 0;
    db.prepare('UPDATE prop_slips SET result=?, credits_delta=?, settled_at=? WHERE id=?').run(result, delta, Date.now(), s.id);
    persist.upsert('prop_slips', { id: s.id });
    if (delta) { A.credit(s.user_id, delta); grantPack(s.user_id, 'props', `props-${s.id}`); }
  }
}
function propSplits(week, season) {
  const out = {};
  for (const s of db.prepare('SELECT legs FROM prop_slips WHERE season=? AND week=?').all(season, week)) {
    for (const l of JSON.parse(s.legs)) { const k = `${l.pid}:${l.stat}`; const o = out[k] || (out[k] = { more: 0, less: 0 }); o[l.side]++; }
  }
  return out;
}

// ======================= MOMENT CARDS =======================
// The week's 60 biggest plays are this week's cards: the top 5 are legendary, the next 10 epic,
// the next 15 rare and the rest common. Each pack has 3 cards.
const ODDS = [['legendary', 0.04], ['epic', 0.12], ['rare', 0.3], ['common', 0.54]];
const TIER = (i) => (i < 5 ? 'legendary' : i < 15 ? 'epic' : i < 30 ? 'rare' : 'common');
const poolCache = new Map();
function cardPool(week) {
  const c = poolCache.get(week);
  if (c && Date.now() - c.at < 60e3) return c.list;
  const ids = engine.listGames(week).filter((g) => !g.extra).map((g) => g.id);
  const out = [];
  if (ids.length) {
    for (const r of db.prepare(`SELECT data FROM plays WHERE game_id IN (${ids.map(() => '?').join(',')}) AND (scoring=1 OR explosive=1 OR ppr>=6 OR data LIKE '%"kind":"int"%' OR data LIKE '%fumLost%')`).all(...ids)) {
      let p; try { p = JSON.parse(r.data); } catch { continue; }
      const x = p.players?.find((y) => String(y.id) === String(p.lead)) || p.players?.find((y) => y.pos !== 'DST' && y.role !== 'target') || p.players?.[0];
      if (!x || x.pos === 'DST' || !x.name) continue;
      const aura = A.auraOf(x, p);
      const score = Math.abs(x.ppr || 0) + Math.abs(aura) / 20 + (p.td ? 8 : 0) + (p.explosive ? 4 : 0) + (Number(p.yards) >= 40 ? 6 : 0);
      out.push({ play: p, x, aura, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  const list = out.slice(0, 60).map((o, i) => ({ ...o, rarity: TIER(i) }));
  poolCache.set(week, { at: Date.now(), list });
  return list;
}
function packWeek() {
  const w = A.cur().week;
  if (cardPool(w).length >= 30) return w;
  for (let k = w - 1; k >= Math.max(1, w - 3); k--) if (cardPool(k).length >= 30) return k;
  return w;
}
function grantPack(userId, source, key) {
  const info = db.prepare('INSERT OR IGNORE INTO packs (user_id, key, source, created_at) VALUES (?,?,?,?)').run(userId, key, source, Date.now());
  if (info.changes) { persist.upsert('packs', { id: Number(info.lastInsertRowid) }); A.send('packs', { userId }); }
}
A.onEarn(grantPack);
function cardData(o, week) {
  const g = engine.games.get(o.play.gameId);
  const nv = nflverse.get(o.x.id);
  return { name: nv?.name || o.x.name, pos: nv?.pos || o.x.pos || '', team: nv?.team || o.x.team || '', pid: String(o.x.id), headshot: nv?.headshot || o.x.headshot || '',
    headline: o.play.headline, pts: Math.round((o.x.ppr || 0) * 10) / 10, aura: o.aura, td: !!o.play.td, week, q: o.play.period, clock: o.play.clock,
    matchup: g ? `${g.away.abbr} @ ${g.home.abbr}` : '', score: `${o.play.awayScore}–${o.play.homeScore}` };
}
function openPack(userId) {
  const pack = db.prepare('SELECT * FROM packs WHERE user_id=? AND opened_at IS NULL ORDER BY id LIMIT 1').get(userId);
  if (!pack) return null;
  const week = packWeek();
  const pool = cardPool(week);
  if (pool.length < 10) return { error: 'Cards drop once this week has more big plays. Try again after the next games.' };
  const got = [];
  const used = new Set();
  for (let i = 0; i < 3; i++) {
    let r = crypto.randomInt(10000) / 10000, tier = 'common';
    for (const [t, p] of ODDS) { if (r < p) { tier = t; break; } r -= p; }
    if (i === 2 && !got.some((c) => c.rarity !== 'common') && tier === 'common') tier = 'rare'; // every pack has at least one rare
    let options = pool.filter((o) => o.rarity === tier && !used.has(o.play.id));
    if (!options.length) options = pool.filter((o) => !used.has(o.play.id));
    const o = options[crypto.randomInt(options.length)];
    used.add(o.play.id);
    const info = db.prepare('INSERT INTO cards (user_id, play_id, rarity, season, week, data, pack_id, earned_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(userId, o.play.id, o.rarity, A.cur().season, week, JSON.stringify(cardData(o, week)), pack.id, Date.now());
    persist.upsert('cards', { id: Number(info.lastInsertRowid) });
    got.push(cardView(db.prepare('SELECT * FROM cards WHERE id=?').get(info.lastInsertRowid)));
  }
  db.prepare('UPDATE packs SET opened_at=? WHERE id=?').run(Date.now(), pack.id);
  persist.upsert('packs', { id: pack.id });
  return { cards: got };
}
function cardView(c) {
  const serial = db.prepare('SELECT COUNT(*) n FROM cards WHERE play_id=? AND id<=?').get(c.play_id, c.id).n;
  const of = db.prepare('SELECT COUNT(*) n FROM cards WHERE play_id=?').get(c.play_id).n;
  return { id: c.id, playId: c.play_id, rarity: c.rarity, week: c.week, serial, of, ...JSON.parse(c.data), owner: c.user_id };
}
const RARITY_ORDER = { legendary: 0, epic: 1, rare: 2, common: 3 };
function inTrade(cardId) {
  return db.prepare("SELECT 1 FROM card_trades WHERE status IN ('open','offered') AND (card_id=? OR offer_card_id=?)").get(cardId, cardId);
}
function tradeView(t, meId) {
  const card = db.prepare('SELECT * FROM cards WHERE id=?').get(t.card_id);
  const offer = t.offer_card_id ? db.prepare('SELECT * FROM cards WHERE id=?').get(t.offer_card_id) : null;
  return { code: t.code, status: t.status, at: t.created_at, from: A.who(t.from_user), to: t.to_user ? A.who(t.to_user) : null,
    card: card ? cardView(card) : null, offer: offer ? cardView(offer) : null, me: t.from_user === meId ? 'from' : t.to_user === meId ? 'to' : null };
}

// ======================= RED ZONE =======================
const rz = new Map(); // gameId -> was in the red zone
function checkRedZone(g) {
  if (!g || g.extra) return;
  const now = g.state === 'in' && !!g.redZone;
  const was = rz.get(g.id) || false;
  rz.set(g.id, now);
  if (!now || was) return;
  const off = g.possession === g.home.id ? g.home : g.possession === g.away.id ? g.away : null;
  const def = off === g.home ? g.away : g.home;
  const goal = /goal/i.test(g.downDistance || '');
  const alert = { gameId: g.id, offense: off?.abbr || '', defense: def?.abbr || '', text: g.downDistance || '', goal, at: Date.now(),
    title: `${goal ? 'Goal to go' : 'Red zone'}: ${off?.abbr || ''}${g.downDistance ? ` · ${g.downDistance}` : ''}`, score: `${g.away.abbr} ${g.away.score}–${g.home.score} ${g.home.abbr}` };
  A.send('redzone', alert);
  A.pushTo((s) => {
    const pref = s.prefs?.redzone || 'mine';
    if (pref === 'off') return null;
    const mine = [...s.players].map((id) => nflverse.get(id)).filter((p) => p && p.team === off?.abbr);
    if (pref === 'mine' && !mine.length) return null;
    return { title: `🔴 ${alert.title}`, body: mine.length ? `${mine.slice(0, 3).map((p) => p.name).join(', ')} ${mine.length > 1 ? 'are' : 'is'} in range · ${alert.score}` : alert.score, tag: `rz-${g.id}`, hash: `#/game/${g.id}` };
  });
}

// ======================= LOCKER: levels + unlockables =======================
const UNLOCKS = {
  frame: [['classic', 'Classic', 1], ['neon', 'Neon', 2], ['gold', 'Gold foil', 4], ['holo', 'Holo', 7], ['fire', 'On fire', 10]],
  theme: [['default', 'Your site colors', 1], ['team', 'Team colors', 3], ['volt', 'Volt', 5], ['pink', 'Neon pink', 6], ['holo', 'Holo purple', 8], ['champ', 'Championship gold', 11]],
  tag: [['plain', 'Plain', 1], ['glow', 'Glow', 2], ['caps', 'Bold caps', 4], ['flame', 'Flame 🔥', 6], ['crown', 'Crown 👑', 9], ['diamond', 'Diamond 💎', 12]],
};
const levelOf = (xp) => Math.floor(Math.sqrt(xp / 40)) + 1;
const xpFor = (level) => (level - 1) ** 2 * 40;
function xpOf(userId) {
  const n = (sql, ...a) => db.prepare(sql).get(...a)?.n || 0;
  const parts = {
    picks: n('SELECT COUNT(*) n FROM picks WHERE user_id=?', userId) * 10 + n("SELECT COUNT(*) n FROM picks WHERE user_id=? AND result='win'", userId) * 15,
    callit: n("SELECT COUNT(*) n FROM callit WHERE user_id=? AND result IN ('win','loss')", userId) * 2 + n("SELECT COUNT(*) n FROM callit WHERE user_id=? AND result='win'", userId) * 5,
    daily: n('SELECT COUNT(*) n FROM daily_results WHERE user_id=? AND solved=1', userId) * 25,
    takes: n('SELECT COUNT(*) n FROM takes WHERE user_id=?', userId) * 10 + n("SELECT COUNT(*) n FROM takes WHERE user_id=? AND result='hit'", userId) * 40,
    duels: n('SELECT COUNT(*) n FROM duels WHERE (from_user=? OR to_user=?) AND to_user IS NOT NULL', userId, userId) * 15
      + n("SELECT COUNT(*) n FROM duels WHERE (from_user=? AND result='from') OR (to_user=? AND result='to')", userId, userId) * 40,
    props: n('SELECT COUNT(*) n FROM prop_slips WHERE user_id=?', userId) * 10 + n("SELECT COUNT(*) n FROM prop_slips WHERE user_id=? AND result='win'", userId) * 50,
    badges: n('SELECT COUNT(*) n FROM badges WHERE user_id=?', userId) * 60,
    cards: n('SELECT COUNT(*) n FROM cards WHERE user_id=?', userId) * 4,
    comments: n('SELECT COUNT(*) n FROM comments WHERE user_id=?', userId) * 3,
    lineups: n('SELECT COUNT(*) n FROM lineups WHERE user_id=?', userId) * 20,
  };
  return { xp: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}
const lockerCache = new Map();
function lockerOf(userId, fresh = false) {
  const c = lockerCache.get(userId);
  if (!fresh && c && Date.now() - c.at < 30e3) return c.v;
  const { xp, parts } = xpOf(userId);
  const level = levelOf(xp);
  const eq = db.prepare('SELECT * FROM locker WHERE user_id=?').get(userId) || {};
  const ok = (kind, id) => UNLOCKS[kind].some(([k, , lv]) => k === id && lv <= level);
  const v = { xp, level, parts, thisLevel: xpFor(level), nextLevel: xpFor(level + 1),
    equipped: { frame: ok('frame', eq.frame) ? eq.frame : 'classic', theme: ok('theme', eq.theme) ? eq.theme : 'default', team: eq.team || null, tag: ok('tag', eq.tag) ? eq.tag : 'plain' },
    unlocks: Object.fromEntries(Object.entries(UNLOCKS).map(([k, list]) => [k, list.map(([id, label, lv]) => ({ id, label, level: lv, unlocked: lv <= level }))])) };
  lockerCache.set(userId, { at: Date.now(), v });
  return v;
}
// Everyone sees your name tag style next to your name in the Arcade
A.whoExtras.push((id) => { const l = lockerOf(id); return { tag: l.equipped.tag, level: l.level }; });

// ======================= routes =======================
function mount(app, { needUser }) {
  engine.bus.on('game', (g) => { try { checkRedZone(engine.games.get(g.id) || g); } catch (e) { console.warn('[redzone]', e.message); } });
  engine.bus.on('games', (list) => { for (const g of list || []) { try { checkRedZone(g); } catch { /* ignore */ } } });

  // ---- props ----
  app.get('/api/props', (req, res) => {
    settleSlips();
    const b = propBoard();
    const mine = req.user ? db.prepare('SELECT * FROM prop_slips WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.user.id).map(slipView) : [];
    res.json({ ...b, labels: STAT_LABEL, payouts: PAYOUT, splits: b.week ? propSplits(b.week, b.season) : {}, slips: mine,
      slipsLeft: req.user && b.week ? Math.max(0, 3 - db.prepare('SELECT COUNT(*) n FROM prop_slips WHERE user_id=? AND season=? AND week=?').get(req.user.id, b.season, b.week).n) : 3 });
  });
  app.post('/api/props', needUser, (req, res) => {
    const b = propBoard();
    if (!b.week) return res.status(400).json({ error: 'Props open once this week\'s lines are posted.' });
    const picks = Array.isArray(req.body?.legs) ? req.body.legs : [];
    if (picks.length < 2 || picks.length > 5) return res.status(400).json({ error: 'Pick 2 to 5 props.' });
    const used = db.prepare('SELECT COUNT(*) n FROM prop_slips WHERE user_id=? AND season=? AND week=?').get(req.user.id, b.season, b.week).n;
    if (used >= 3) return res.status(400).json({ error: 'That\'s 3 slips this week. Good luck with them.' });
    const byId = new Map(b.players.map((p) => [p.id, p]));
    const legs = [];
    for (const k of picks) {
      const p = byId.get(String(k.pid));
      if (!p || p.lines[k.stat] == null) return res.status(400).json({ error: 'That prop isn\'t on the board.' });
      if (p.locked) return res.status(400).json({ error: `${p.name}'s game has started.` });
      if (!['more', 'less'].includes(k.side)) return res.status(400).json({ error: 'Pick More or Less.' });
      if (legs.some((l) => l.pid === p.id)) return res.status(400).json({ error: `Only one prop per player (${p.name}).` });
      legs.push({ pid: p.id, name: p.name, pos: p.pos, team: p.team, stat: k.stat, label: STAT_LABEL[k.stat], line: p.lines[k.stat], side: k.side, gameId: p.gameId, kickoff: p.kickoff, headshot: p.headshot });
    }
    if (new Set(legs.map((l) => l.team)).size < 2) return res.status(400).json({ error: 'Use players from at least 2 teams.' });
    const info = db.prepare('INSERT INTO prop_slips (user_id, season, week, legs, created_at) VALUES (?,?,?,?,?)').run(req.user.id, b.season, b.week, JSON.stringify(legs), Date.now());
    persist.upsert('prop_slips', { id: Number(info.lastInsertRowid) });
    res.json({ slip: slipView(db.prepare('SELECT * FROM prop_slips WHERE id=?').get(info.lastInsertRowid)) });
  });

  // ---- moment cards ----
  app.get('/api/cards', needUser, (req, res) => {
    // everyone gets a starter pack
    grantPack(req.user.id, 'welcome', 'welcome');
    const cards = db.prepare('SELECT * FROM cards WHERE user_id=?').all(req.user.id).map(cardView)
      .sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || b.week - a.week || b.pts - a.pts);
    const packs = db.prepare('SELECT source, COUNT(*) n FROM packs WHERE user_id=? AND opened_at IS NULL GROUP BY source').all(req.user.id);
    const trades = db.prepare("SELECT * FROM card_trades WHERE (from_user=? OR to_user=?) AND status IN ('open','offered') ORDER BY id DESC").all(req.user.id, req.user.id).map((t) => tradeView(t, req.user.id));
    res.json({ cards, packs: packs.reduce((a, p) => a + p.n, 0), packSources: packs, trades, week: packWeek() });
  });
  app.post('/api/cards/open', needUser, (req, res) => {
    const r = openPack(req.user.id);
    if (!r) return res.status(400).json({ error: 'No packs to open. Earn them in the Arcade.' });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });
  app.post('/api/cards/:id/trade', needUser, (req, res) => {
    const c = db.prepare('SELECT * FROM cards WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
    if (!c) return res.status(404).json({ error: 'That card isn\'t yours.' });
    if (inTrade(c.id)) return res.status(400).json({ error: 'That card is already up for a swap.' });
    let k; do k = code(); while (db.prepare('SELECT 1 FROM card_trades WHERE code=?').get(k));
    const info = db.prepare("INSERT INTO card_trades (code, from_user, card_id, status, created_at) VALUES (?,?,?,'open',?)").run(k, req.user.id, c.id, Date.now());
    persist.upsert('card_trades', { id: Number(info.lastInsertRowid) });
    res.json({ trade: tradeView(db.prepare('SELECT * FROM card_trades WHERE code=?').get(k), req.user.id) });
  });
  app.get('/api/trades/:code', (req, res) => {
    const t = db.prepare('SELECT * FROM card_trades WHERE code=?').get(String(req.params.code));
    if (!t) return res.status(404).json({ error: 'That swap link doesn\'t exist.' });
    res.json({ trade: tradeView(t, req.user?.id) });
  });
  app.post('/api/trades/:code/offer', needUser, (req, res) => {
    const t = db.prepare('SELECT * FROM card_trades WHERE code=?').get(String(req.params.code));
    if (!t || t.status !== 'open') return res.status(400).json({ error: 'This swap isn\'t open anymore.' });
    if (t.from_user === req.user.id) return res.status(400).json({ error: 'Send this link to a friend.' });
    const c = db.prepare('SELECT * FROM cards WHERE id=? AND user_id=?').get(Number(req.body?.cardId), req.user.id);
    if (!c) return res.status(400).json({ error: 'Pick one of your cards to offer.' });
    if (inTrade(c.id)) return res.status(400).json({ error: 'That card is already up for a swap.' });
    db.prepare("UPDATE card_trades SET to_user=?, offer_card_id=?, status='offered' WHERE id=?").run(req.user.id, c.id, t.id);
    persist.upsert('card_trades', { id: t.id });
    A.send('packs', { userId: t.from_user });
    res.json({ trade: tradeView(db.prepare('SELECT * FROM card_trades WHERE id=?').get(t.id), req.user.id) });
  });
  app.post('/api/trades/:code/:answer', needUser, (req, res) => {
    const t = db.prepare('SELECT * FROM card_trades WHERE code=?').get(String(req.params.code));
    if (!t) return res.status(404).json({ error: 'That swap link doesn\'t exist.' });
    const ans = req.params.answer;
    if (ans === 'cancel') {
      if (t.from_user !== req.user.id || !['open', 'offered'].includes(t.status)) return res.status(400).json({ error: 'You can\'t cancel this swap.' });
      db.prepare("UPDATE card_trades SET status='cancelled' WHERE id=?").run(t.id);
    } else if (ans === 'accept' || ans === 'decline') {
      if (t.from_user !== req.user.id || t.status !== 'offered') return res.status(400).json({ error: 'There\'s no offer to answer.' });
      if (ans === 'decline') db.prepare("UPDATE card_trades SET status='open', to_user=NULL, offer_card_id=NULL WHERE id=?").run(t.id);
      else {
        const a = db.prepare('SELECT * FROM cards WHERE id=? AND user_id=?').get(t.card_id, t.from_user);
        const b = db.prepare('SELECT * FROM cards WHERE id=? AND user_id=?').get(t.offer_card_id, t.to_user);
        if (!a || !b) return res.status(400).json({ error: 'One of the cards moved. The swap is off.' });
        db.transaction(() => {
          db.prepare('UPDATE cards SET user_id=? WHERE id=?').run(t.to_user, a.id);
          db.prepare('UPDATE cards SET user_id=? WHERE id=?').run(t.from_user, b.id);
          db.prepare("UPDATE card_trades SET status='done' WHERE id=?").run(t.id);
        })();
        persist.upsert('cards', { id: a.id }); persist.upsert('cards', { id: b.id });
        A.send('packs', { userId: t.to_user });
      }
    } else return res.status(404).json({ error: 'Unknown action.' });
    persist.upsert('card_trades', { id: t.id });
    res.json({ trade: tradeView(db.prepare('SELECT * FROM card_trades WHERE id=?').get(t.id), req.user.id) });
  });

  // ---- red zone (what's in the red zone right now) ----
  app.get('/api/redzone', (_req, res) => {
    res.json({ games: engine.listGames().filter((g) => g.state === 'in' && g.redZone).map((g) => {
      const off = g.possession === g.home.id ? g.home : g.away;
      return { gameId: g.id, offense: off.abbr, defense: off === g.home ? g.away.abbr : g.home.abbr, text: g.downDistance || '', goal: /goal/i.test(g.downDistance || '') };
    }) });
  });

  // ---- locker ----
  app.get('/api/locker', needUser, (req, res) => res.json(lockerOf(req.user.id, true)));
  app.post('/api/locker', needUser, (req, res) => {
    const l = lockerOf(req.user.id);
    const next = { ...l.equipped };
    for (const kind of ['frame', 'theme', 'tag']) {
      const v = req.body?.[kind];
      if (v == null) continue;
      const u = l.unlocks[kind].find((x) => x.id === v);
      if (!u) return res.status(400).json({ error: 'Unknown item.' });
      if (!u.unlocked) return res.status(400).json({ error: `${u.label} unlocks at level ${u.level}.` });
      next[kind] = v;
    }
    if (req.body?.team !== undefined) next.team = /^[A-Z]{2,4}$/.test(String(req.body.team)) ? String(req.body.team) : null;
    db.prepare(`INSERT INTO locker (user_id, frame, theme, team, tag) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET frame=excluded.frame, theme=excluded.theme, team=excluded.team, tag=excluded.tag`).run(req.user.id, next.frame, next.theme, next.team, next.tag);
    persist.upsert('locker', { user_id: req.user.id });
    lockerCache.delete(req.user.id);
    res.json(lockerOf(req.user.id));
  });
}
function start() {
  setInterval(() => { try { settleSlips(); } catch (e) { console.warn('[props]', e.message); } }, 3 * 60e3).unref();
}

module.exports = { mount, start, half, legState, levelOf, xpFor, cardPool, TIER, _grantPack: grantPack, _openPack: openPack, _settleSlips: settleSlips };
