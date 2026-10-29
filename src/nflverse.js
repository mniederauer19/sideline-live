// Season-long player context + salaries, built from nflverse (the same data
// source sidelineff.com already credits). Downloaded on start, refreshed every 12h.
const fs = require('fs');
const path = require('path');
const { SEASON, CACHE_DIR } = require('./config');

const BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
const URLS = {
  players: `${BASE}/players/players.csv`,
  weekly: `${BASE}/stats_player/stats_player_week_${SEASON}.csv`,
};

// nflverse team codes -> ESPN team codes
const TEAM_FIX = { LA: 'LAR', WAS: 'WSH' };
const fixTeam = (t) => TEAM_FIX[t] || t;

const state = {
  ready: false,
  loading: null,
  kickers: new Map(),
  byEspn: new Map(), // espnId -> player profile with season stats + salary
  loadedAt: 0,
};

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function download(name) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, path.basename(URLS[name]));
  const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 12 * 3600e3;
  if (!fresh) {
    try {
      const res = await fetch(URLS[name], { redirect: 'follow' });
      if (!res.ok) throw new Error(`${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      console.warn(`[nflverse] could not download ${name} (${e.message}); using cache if present`);
    }
  }
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const n = (v) => (v === '' || v === undefined || v === 'NA' ? 0 : Number(v) || 0);
const round100 = (x) => Math.round(x / 100) * 100;

// Salary: blends recent form (last 3) with season average, scaled by position.
const POS_SCALE = { QB: 330, RB: 390, WR: 390, TE: 430 };
function salaryFor(pos, seasonPpg, last3Ppg) {
  const blended = 0.55 * last3Ppg + 0.45 * seasonPpg;
  const s = 3000 + blended * (POS_SCALE[pos] || 380) - 1200;
  return Math.max(3000, Math.min(10000, round100(s)));
}

async function load() {
  const [pText, wText] = await Promise.all([download('players'), download('weekly')]);
  if (!pText || !wText) { console.warn('[nflverse] no data yet'); return; }

  const gsisToEspn = new Map();
  const bio = new Map();
  const kickers = new Map();
  for (const p of parseCSV(pText)) {
    if (p.position === 'K' && p.status === 'ACT' && p.espn_id && Number(p.last_season) >= SEASON - 1) {
      const t = fixTeam(p.latest_team);
      const prev = kickers.get(t);
      if (!prev || Number(p.last_season) > prev.lastSeason) {
        kickers.set(t, { id: p.espn_id, name: p.display_name, short: p.short_name || `${p.first_name[0]}.${p.last_name}`, team: t, pos: 'K', headshot: p.headshot, lastSeason: Number(p.last_season) });
      }
    }
    if (p.espn_id && p.gsis_id) {
      gsisToEspn.set(p.gsis_id, p.espn_id);
      bio.set(p.gsis_id, p);
    }
  }

  const agg = new Map();
  const teamTargets = new Map(); // `${team}-${week}` -> targets
  const weekly = parseCSV(wText).filter((r) => r.season_type === 'REG' || r.season_type === 'POST');
  for (const r of weekly) {
    const k = `${r.team}-${r.week}`;
    teamTargets.set(k, (teamTargets.get(k) || 0) + n(r.targets));
  }
  for (const r of weekly) {
    if (!['QB', 'RB', 'WR', 'TE'].includes(r.position)) continue;
    let a = agg.get(r.player_id);
    if (!a) {
      a = { gsis: r.player_id, name: r.player_display_name, short: r.player_name, pos: r.position,
        headshot: r.headshot_url, weeks: [], tgt: 0, teamTgt: 0, carries: 0, rec: 0, airYds: 0,
        rushYds: 0, recYds: 0, passYds: 0, tds: 0, team: r.team, lastWeek: 0 };
      agg.set(r.player_id, a);
    }
    const wk = Number(r.week);
    a.weeks.push({ week: wk, ppr: n(r.fantasy_points_ppr) });
    a.tgt += n(r.targets);
    a.teamTgt += teamTargets.get(`${r.team}-${r.week}`) || 0;
    a.carries += n(r.carries);
    a.rec += n(r.receptions);
    a.airYds += n(r.receiving_air_yards);
    a.rushYds += n(r.rushing_yards);
    a.recYds += n(r.receiving_yards);
    a.passYds += n(r.passing_yards);
    a.tds += n(r.passing_tds) + n(r.rushing_tds) + n(r.receiving_tds);
    if (wk >= a.lastWeek) { a.lastWeek = wk; a.team = r.team; a.headshot = r.headshot_url || a.headshot; }
  }

  const byEspn = new Map();
  for (const a of agg.values()) {
    const espnId = gsisToEspn.get(a.gsis);
    if (!espnId) continue;
    a.weeks.sort((x, y) => x.week - y.week);
    const games = a.weeks.length;
    const total = a.weeks.reduce((s, w) => s + w.ppr, 0);
    const last3 = a.weeks.slice(-3);
    const ppg = total / games;
    const last3Ppg = last3.reduce((s, w) => s + w.ppr, 0) / last3.length;
    byEspn.set(espnId, {
      id: espnId,
      gsis: a.gsis,
      name: a.name,
      short: a.short,
      pos: a.pos,
      team: fixTeam(a.team),
      headshot: a.headshot || bio.get(a.gsis)?.headshot || '',
      games,
      ppg: +ppg.toFixed(1),
      last3Ppg: +last3Ppg.toFixed(1),
      tgtShare: a.teamTgt ? +(a.tgt / a.teamTgt * 100).toFixed(1) : 0,
      targetsPg: +(a.tgt / games).toFixed(1),
      carriesPg: +(a.carries / games).toFixed(1),
      adot: a.tgt ? +(a.airYds / a.tgt).toFixed(1) : 0,
      seasonTds: a.tds,
      weeks: a.weeks,
      salary: salaryFor(a.pos, ppg, last3Ppg),
    });
  }
  state.byEspn = byEspn;
  state.kickers = kickers;
  state.ready = true;
  state.loadedAt = Date.now();
  console.log(`[nflverse] loaded ${byEspn.size} fantasy players`);
}

function start() {
  state.loading = load().catch((e) => console.warn('[nflverse]', e.message));
  setInterval(() => load().catch(() => {}), 12 * 3600e3).unref();
}

module.exports = {
  start, load, state, fixTeam,
  get: (espnId) => state.byEspn.get(String(espnId)),
  byTeam: (team) => [...state.byEspn.values()].filter((p) => p.team === team),
  all: () => [...state.byEspn.values()],
};
