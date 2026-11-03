// 17-0: spin a team + season (1970 to today), draft one player from that team that year into
// your lineup (QB, RB, RB, WR, WR, TE, FLEX, SuperFlex), 8 rounds. Then the lineup plays a
// 17-game season: each player scores his era-adjusted points per game (with good and bad weeks)
// and misses as many weeks as he missed that season. Can it go 17-0?
const crypto = require('crypto');
const DATA = require('./data/seasons.json');

const SLOTS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'SF'];
const FITS = { QB: ['QB'], RB1: ['RB'], RB2: ['RB'], WR1: ['WR'], WR2: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], SF: ['QB', 'RB', 'WR', 'TE'] };
const YEARS = Object.keys(DATA.seasons).map(Number).sort((a, b) => a - b);
const NAMES = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals',
  CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers', HOU: 'Houston Texans', IND: 'Indianapolis Colts',
  JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs', LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles',
  PIT: 'Pittsburgh Steelers', SF: 'San Francisco 49ers', SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington',
};
// what the team was called that year
function eraName(team, y) {
  if (team === 'IND' && y <= 1983) return 'Baltimore Colts';
  if (team === 'TEN') return y <= 1996 ? 'Houston Oilers' : y <= 1998 ? 'Tennessee Oilers' : NAMES.TEN;
  if (team === 'NE' && y <= 1970) return 'Boston Patriots';
  if (team === 'LV') return y <= 1981 || (y >= 1995 && y <= 2019) ? 'Oakland Raiders' : y <= 1994 ? 'Los Angeles Raiders' : NAMES.LV;
  if (team === 'LAR') return y >= 1995 && y <= 2015 ? 'St. Louis Rams' : NAMES.LAR;
  if (team === 'ARI') return y <= 1987 ? 'St. Louis Cardinals' : y <= 1993 ? 'Phoenix Cardinals' : NAMES.ARI;
  if (team === 'LAC') return y <= 2016 ? 'San Diego Chargers' : NAMES.LAC;
  if (team === 'WAS') return y >= 2022 ? 'Washington Commanders' : 'Washington';
  return NAMES[team] || team;
}
const teamsIn = (y) => Object.keys(DATA.seasons[y]?.teams || {}).sort();
const yearsOf = (team) => YEARS.filter((y) => DATA.seasons[y].teams[team]);
// Decades mode: a spin is a team + a decade (the 1970s on)
const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];
const inDecade = (y, d) => y >= d && y < d + 10;
const decadesOf = (team) => DECADES.filter((d) => yearsOf(team).some((y) => inDecade(y, d)));
const teamsInDecade = (d) => [...new Set(YEARS.filter((y) => inDecade(y, d)).flatMap(teamsIn))].sort();
const nickname = (team, y) => { const n = eraName(team, y); return n === 'Washington' || n === 'Washington Commanders' ? 'Washington' : n.split(' ').slice(-1)[0]; };
const spinName = (cur) => (cur.decade ? `${cur.year}s ${nickname(cur.team, Math.min(cur.year + 5, YEARS[YEARS.length - 1]))}` : eraName(cur.team, cur.year));

// ---------- seeded randomness (the same seed always gives the same spins and season) ----------
function rng(seed) {
  let a = crypto.createHash('sha256').update(String(seed)).digest().readUInt32BE(0);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

// 8 rounds of spins; each round also has its re-spin (a new team that year, or the same team another year)
function spins(mode, seed) {
  const r = rng(`spins:${mode}:${seed}`);
  const out = [];
  const used = new Set();
  const fr = mode === 'franchise' ? pick(r, Object.keys(NAMES)) : null;
  if (mode === 'decades') {
    for (let i = 0; i < 8; i++) {
      let decade, team, guard = 0;
      do { decade = pick(r, DECADES); team = pick(r, teamsInDecade(decade)); } while (used.has(`${team}${decade}`) && guard++ < 30);
      used.add(`${team}${decade}`);
      const otherTeams = teamsInDecade(decade).filter((t) => t !== team);
      const otherDecades = decadesOf(team).filter((d) => d !== decade && !used.has(`${team}${d}`));
      out.push({ team, year: decade, decade: true, altTeam: { team: pick(r, otherTeams), year: decade, decade: true },
        altYear: otherDecades.length ? { team, year: pick(r, otherDecades), decade: true } : null });
    }
    return { franchise: null, rounds: out };
  }
  for (let i = 0; i < 8; i++) {
    let year, team, guard = 0;
    do {
      if (fr) { year = pick(r, yearsOf(fr)); team = fr; }
      else { year = pick(r, YEARS); team = pick(r, teamsIn(year)); }
    } while (used.has(`${team}${year}`) && guard++ < 30);
    used.add(`${team}${year}`);
    const otherTeams = teamsIn(year).filter((t) => t !== team);
    const otherYears = yearsOf(team).filter((y) => y !== year && !used.has(`${team}${y}`));
    out.push({ team, year, altTeam: fr ? null : { team: pick(r, otherTeams), year }, altYear: otherYears.length ? { team, year: pick(r, otherYears) } : null });
  }
  return { franchise: fr, rounds: out };
}

// A team's decade: each player once, with his best season for that team in those years
function rosterDecade(team, decade) {
  const best = new Map();
  for (const y of yearsOf(team).filter((x) => inDecade(x, decade))) {
    for (const p of roster(team, y).players) {
      const value = p.adj * Math.min(1, p.g / DATA.seasons[y].g);
      const prev = best.get(p.name);
      if (!prev || value > prev.value) best.set(p.name, { ...p, year: y, games: DATA.seasons[y].g, value });
    }
  }
  const players = [...best.values()].sort((a, b) => b.value - a.value).slice(0, 40).map(({ value, ...p }) => p);
  return { team, year: decade, decade: true, name: spinName({ team, year: decade, decade: true }), games: null, players };
}
function roster(team, year, decade = false) {
  if (decade) return rosterDecade(team, year);
  const s = DATA.seasons[year]; const rows = s?.teams?.[team];
  if (!rows) return null;
  return { team, year, name: eraName(team, year), games: s.g, players: rows.map((r) => {
    const o = Object.fromEntries(DATA.cols.map((c, i) => [c, r[i]]));
    o.id = `${year}-${team}-${o.name}`.replace(/\s+/g, '_');
    o.year = year; o.games = s.g;
    return o;
  }) };
}

// ---------- the season ----------
const OPP_MEAN = 122, OPP_SD = 20, NOISE = 0.42;
function normal(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function simulate(lineup, seed) {
  const r = rng(`season:${seed}`);
  // which weeks each player sits (as many as he missed that season, scaled to 17 games)
  const plays = lineup.map((p) => {
    const playN = Math.max(1, Math.min(17, Math.round(17 * Math.min(1, p.g / p.games))));
    const weeks = Array.from({ length: 17 }, (_, i) => i).sort(() => r() - 0.5).slice(0, playN);
    return new Set(weeks);
  });
  const weeks = [];
  for (let w = 0; w < 17; w++) {
    let you = 0; const out = [];
    const line = lineup.map((p, i) => {
      if (!plays[i].has(w)) { out.push(p.name); return 0; }
      const pts = Math.max(0, p.adj * Math.exp(normal(r) * NOISE - NOISE * NOISE / 2));
      you += pts; return +pts.toFixed(1);
    });
    const opp = Math.max(60, OPP_MEAN + normal(r) * OPP_SD);
    weeks.push({ week: w + 1, you: +you.toFixed(1), opp: +opp.toFixed(1), win: you > opp, out, line });
  }
  const wins = weeks.filter((x) => x.win).length;
  return { wins, losses: 17 - wins, weeks, points: +weeks.reduce((a, x) => a + x.you, 0).toFixed(1) };
}

module.exports = { DATA, SLOTS, FITS, YEARS, NAMES, DECADES, eraName, spins, roster, simulate, teamsIn, yearsOf, decadesOf, OPP_MEAN };

// ---------- the game on the server (so a 17-0 is real) ----------
const db = require('./db');
const persist = require('./persist');
db.exec(`CREATE TABLE IF NOT EXISTS s17_runs (
  id TEXT PRIMARY KEY, user_id INTEGER, mode TEXT NOT NULL, seed TEXT NOT NULL, day TEXT,
  round INTEGER NOT NULL DEFAULT 0, rerolled INTEGER NOT NULL DEFAULT 0, cur TEXT, picks TEXT NOT NULL DEFAULT '[]',
  wins INTEGER, losses INTEGER, points REAL, counted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER
); CREATE INDEX IF NOT EXISTS s17_day ON s17_runs(day, counted);`);
persist.TABLES.s17_runs = { pk: ['id'], cols: { id: 'TEXT', user_id: 'BIGINT', mode: 'TEXT', seed: 'TEXT', day: 'TEXT', round: 'BIGINT', rerolled: 'BIGINT', cur: 'TEXT', picks: 'TEXT', wins: 'BIGINT', losses: 'BIGINT', points: 'DOUBLE PRECISION', counted: 'BIGINT', created_at: 'BIGINT', finished_at: 'BIGINT' } };
const LAUNCH = '2026-11-03';

function mount(app, { A }) {
  const save = (id) => persist.upsert('s17_runs', { id });
  const load = (id) => db.prepare('SELECT * FROM s17_runs WHERE id=?').get(String(id || ''));
  const dayNo = (day) => Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${LAUNCH}T12:00:00Z`)) / 86400e3) + 1;
  function view(run, meId) {
    const picks = JSON.parse(run.picks);
    const cur = run.cur ? JSON.parse(run.cur) : null;
    const sp = spins(run.mode, run.seed).rounds[run.round] || null;
    const out = { id: run.id, mode: run.mode, day: run.day, number: run.day ? dayNo(run.day) : null, round: run.round, picks, done: run.round >= 8,
      franchise: run.mode === 'franchise' ? spins(run.mode, run.seed).franchise : null, mine: !run.user_id || run.user_id === meId, counted: !!run.counted };
    if (!out.done && cur) out.spin = { ...cur, name: spinName(cur), roster: roster(cur.team, cur.year, cur.decade), canTeam: !run.rerolled && !!sp?.altTeam, canYear: !run.rerolled && !!sp?.altYear };
    if (out.done) {
      const lineup = picks.map((p) => ({ ...p, games: DATA.seasons[p.year].g }));
      out.result = simulate(lineup, `${run.mode}:${run.seed}:${run.id}`);
    }
    return out;
  }
  app.post('/api/170/start', (req, res) => {
    const mode = ['daily', 'unlimited', 'franchise', 'decades'].includes(req.body?.mode) ? req.body.mode : 'unlimited';
    const day = A.etDay();
    if (mode === 'daily' && req.user) {
      const prev = db.prepare("SELECT * FROM s17_runs WHERE user_id=? AND mode='daily' AND day=? ORDER BY counted DESC, created_at DESC LIMIT 1").get(req.user.id, day);
      if (prev && !prev.finished_at) return res.json({ run: view(prev, req.user.id) }); // pick up where you left off
    }
    const id = crypto.randomBytes(9).toString('base64url');
    const seed = mode === 'daily' ? day : crypto.randomBytes(8).toString('hex');
    const first = spins(mode, seed).rounds[0];
    db.prepare('INSERT INTO s17_runs (id, user_id, mode, seed, day, cur, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.user?.id || null, mode, seed, mode === 'daily' ? day : null, JSON.stringify({ team: first.team, year: first.year, decade: !!first.decade }), Date.now());
    save(id);
    res.json({ run: view(load(id), req.user?.id) });
  });
  app.get('/api/170/run/:id', (req, res) => {
    const run = load(req.params.id);
    if (!run) return res.status(404).json({ error: 'That game doesn\'t exist.' });
    res.json({ run: view(run, req.user?.id) });
  });
  const own = (req, res) => {
    const run = load(req.body?.runId);
    if (!run) { res.status(404).json({ error: 'That game doesn\'t exist.' }); return null; }
    if (run.user_id && run.user_id !== req.user?.id) { res.status(403).json({ error: 'That\'s someone else\'s game.' }); return null; }
    if (run.round >= 8) { res.status(400).json({ error: 'This season is already over.' }); return null; }
    return run;
  };
  app.post('/api/170/respin', (req, res) => {
    const run = own(req, res); if (!run) return;
    if (run.rerolled) return res.status(400).json({ error: 'You already used this round\'s re-spin.' });
    const sp = spins(run.mode, run.seed).rounds[run.round];
    const alt = req.body?.kind === 'year' ? sp.altYear : sp.altTeam;
    if (!alt) return res.status(400).json({ error: 'No re-spin for that this round.' });
    db.prepare('UPDATE s17_runs SET cur=?, rerolled=1 WHERE id=?').run(JSON.stringify(alt), run.id); save(run.id);
    res.json({ run: view(load(run.id), req.user?.id) });
  });
  app.post('/api/170/pick', (req, res) => {
    const run = own(req, res); if (!run) return;
    const cur = JSON.parse(run.cur);
    const ro = roster(cur.team, cur.year, cur.decade);
    const p = ro?.players.find((x) => x.id === req.body?.playerId);
    if (!p) return res.status(400).json({ error: 'That player wasn\'t on this team that year.' });
    const picks = JSON.parse(run.picks);
    if (picks.some((x) => x.name === p.name)) return res.status(400).json({ error: `${p.name} is already on your team.` });
    const open = SLOTS.filter((s) => !picks.some((x) => x.slot === s));
    const slot = req.body?.slot && open.includes(req.body.slot) ? req.body.slot : null;
    if (!slot || !FITS[slot].includes(p.pos)) return res.status(400).json({ error: `${p.name} can't play there.` });
    picks.push({ slot, round: run.round, team: cur.team, year: p.year, teamName: eraName(cur.team, p.year), name: p.name, pos: p.pos, g: p.g, ppr: p.ppr, adj: p.adj,
      passYds: p.passYds, passTd: p.passTd, rushYds: p.rushYds, rushTd: p.rushTd, rec: p.rec, recYds: p.recYds, recTd: p.recTd });
    const round = run.round + 1;
    const next = spins(run.mode, run.seed).rounds[round];
    db.prepare('UPDATE s17_runs SET picks=?, round=?, rerolled=0, cur=? WHERE id=?').run(JSON.stringify(picks), round, next ? JSON.stringify({ team: next.team, year: next.year, decade: !!next.decade }) : null, run.id);
    if (round >= 8) {
      const v = view(load(run.id), req.user?.id);
      const r = v.result;
      const counted = run.mode === 'daily' && run.user_id && !db.prepare("SELECT 1 FROM s17_runs WHERE user_id=? AND mode='daily' AND day=? AND counted=1").get(run.user_id, run.day) ? 1 : 0;
      db.prepare('UPDATE s17_runs SET wins=?, losses=?, points=?, finished_at=?, counted=? WHERE id=?').run(r.wins, r.losses, r.points, Date.now(), counted, run.id);
      if (run.user_id && r.wins === 17) { A.award(run.user_id, 'perfect-17', 'Perfect 17-0'); A.earn(run.user_id, 's17', `s17-${run.id}`); }
    }
    save(run.id);
    res.json({ run: view(load(run.id), req.user?.id) });
  });
  app.get('/api/170/today', (req, res) => {
    const day = A.etDay();
    const rows = db.prepare("SELECT user_id, wins, losses, points FROM s17_runs WHERE mode='daily' AND day=? AND counted=1 ORDER BY wins DESC, points DESC LIMIT 25").all(day);
    const mine = req.user ? db.prepare("SELECT id, wins, losses, points, finished_at FROM s17_runs WHERE user_id=? AND mode='daily' AND day=? ORDER BY counted DESC, created_at DESC LIMIT 1").get(req.user.id, day) : null;
    const best = req.user ? db.prepare('SELECT MAX(wins) w, SUM(wins=17) perfect, COUNT(*) n FROM s17_runs WHERE user_id=? AND finished_at IS NOT NULL').get(req.user.id) : null;
    res.json({ day, number: dayNo(day), board: rows.map((r, i) => ({ rank: i + 1, ...A.who(r.user_id), wins: r.wins, losses: r.losses, points: r.points })),
      mine: mine ? { id: mine.id, done: !!mine.finished_at, wins: mine.wins, losses: mine.losses } : null, best: best?.n ? { wins: best.w, perfect: best.perfect || 0, played: best.n } : null, years: [YEARS[0], YEARS[YEARS.length - 1]] });
  });
}
const statsFor = (userId) => db.prepare('SELECT MAX(wins) best, SUM(wins=17) perfect, COUNT(*) n FROM s17_runs WHERE user_id=? AND finished_at IS NOT NULL').get(userId);
module.exports.mount = mount;
module.exports.statsFor = statsFor;
