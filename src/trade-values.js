// Player values from sidelineff.com's trade analyzer, used to price the salary-cap lineup game.
//
// The main site ships its trade values (rest-of-season, 1-QB PPR) in one of its page
// scripts. This reads that same file from sidelineff.com twice a day, so Live's salaries
// always follow the trade analyzer. If the main site can't be reached, the last copy
// is used, and if there's none yet the lineup game falls back to stat-based salaries.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const state = { players: new Map(), asOf: null, source: null, loadedAt: 0, loading: null, error: null };
const FILE = () => path.join(cfg.CACHE_DIR, 'trade-values.json');

// Same name matching the main site uses: lower case, no Jr./Sr./II/III/IV, letters and digits only
const key = (name) => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(jr|sr|iii|ii|iv)\.?$/, '').replace(/[^a-z0-9]/g, '');

// The trade analyzer's value for one player in a 1-QB PPR league (its own formula)
function analyzerValue(p) {
  const v = p.pos === 'QB' ? (p.qb1 ?? 0) : (p.ppr ?? 0);
  return v > 0 ? v : Math.max(0.2, 0.6 - (p.rank || 0) * 0.005);
}

function parse(js) {
  const players = [];
  for (const m of js.matchAll(/\{name:`([^`]+)`,pos:`(QB|RB|WR|TE)`,([^{}]*)\}/g)) {
    const p = { name: m[1], pos: m[2] };
    for (const kv of m[3].matchAll(/([a-zA-Z0-9]+):(-?[\d.]+)/g)) p[kv[1]] = Number(kv[2]);
    players.push(p);
  }
  const asOf = (js.match(/asOf:`([^`]+)`,source:`[^`]*`,players:\[/) || [])[1] || null;
  const source = (js.match(/source:`([^`]*Boone[^`]*)`/) || [])[1] || null;
  return { players, asOf, source };
}

function use(data) {
  const map = new Map();
  for (const p of data.players) map.set(`${key(p.name)}|${p.pos}`, { ...p, value: analyzerValue(p) });
  Object.assign(state, { players: map, asOf: data.asOf, source: data.source, loadedAt: Date.now(), error: null });
}

async function download() {
  const base = cfg.SIDELINE_URL;
  const res = await fetch(base + '/', { headers: { 'user-agent': 'Mozilla/5.0 (compatible; sideline-live)', accept: 'text/html' }, signal: AbortSignal.timeout(60000) });
  const home = await res.text();
  const idx = (home.match(/src="([^"]*\/index-[^"]+\.js)"/) || [])[1];
  if (!idx) throw new Error(`main page script not found (status ${res.status}, ${home.length} bytes: ${home.slice(0, 80).replace(/\s+/g, ' ')})`);
  const index = await fetch(new URL(idx, base).href, { signal: AbortSignal.timeout(60000) }).then((r) => r.text());
  const chunk = (index.match(/_next\/static\/chunks\/boone-values-[A-Za-z0-9_-]+\.js/) || [])[0];
  if (!chunk) throw new Error('trade values file not found');
  const js = await fetch(`${base}/${chunk}`, { signal: AbortSignal.timeout(60000) }).then((r) => r.text());
  const data = parse(js);
  if (data.players.length < 50) throw new Error(`only ${data.players.length} players found`);
  return data;
}

async function load() {
  try {
    const data = await download();
    use(data);
    fs.mkdirSync(cfg.CACHE_DIR, { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(data));
    console.log(`[values] ${data.players.length} trade values from sidelineff.com (as of ${data.asOf || '?'})`);
  } catch (e) {
    state.error = e.message;
    try { if (!state.players.size && fs.existsSync(FILE())) { use(JSON.parse(fs.readFileSync(FILE(), 'utf8'))); console.log('[values] using saved trade values'); } } catch { /* ignore */ }
    console.warn('[values] could not refresh trade values:', e.message);
  }
}

function start() {
  if (cfg.DEMO && !process.env.TRADE_VALUES) {
    // demo: use a saved copy if one exists
    try { if (fs.existsSync(FILE())) use(JSON.parse(fs.readFileSync(FILE(), 'utf8'))); } catch { /* ignore */ }
    return;
  }
  // Try shortly after start (the server is busy loading the season right at boot), retry every
  // 3 minutes until it works, then refresh twice a day.
  let timer = null;
  const run = async () => {
    clearTimeout(timer);
    state.loading = load();
    await state.loading;
    state.loading = null;
    timer = setTimeout(run, state.error && !state.asOf ? 3 * 60e3 : 12 * 3600e3);
    timer.unref?.();
  };
  setTimeout(run, 20e3).unref?.();
}

const valueOf = (name, pos) => state.players.get(`${key(name)}|${pos}`)?.value ?? null;

module.exports = { state, start, valueOf, key, analyzerValue, parse };
