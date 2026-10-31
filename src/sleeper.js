// Sleeper player IDs -> ESPN player IDs (plus injury status), so people can bring in
// their real Sleeper fantasy team. Sleeper's public player list is large (~15MB), so the
// server downloads it once a day and keeps only what the site needs.
const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('./config');

const URL = 'https://api.sleeper.app/v1/players/nfl';
const POS = new Set(['QB', 'RB', 'WR', 'TE', 'K']);
const state = { map: {}, injuries: {}, count: 0, loadedAt: 0, loading: null };

async function load() {
  const file = path.join(CACHE_DIR, 'sleeper-map.json');
  try {
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 20 * 3600e3) {
      Object.assign(state, JSON.parse(fs.readFileSync(file, 'utf8')), { loadedAt: Date.now() });
      return;
    }
    const res = await fetch(URL, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(String(res.status));
    const all = await res.json();
    const map = {}, injuries = {};
    for (const [id, p] of Object.entries(all)) {
      if (!p || !p.espn_id || !POS.has(p.position) || (!p.team && !p.active)) continue;
      map[id] = String(p.espn_id);
      if (p.injury_status) injuries[String(p.espn_id)] = p.injury_status;
    }
    Object.assign(state, { map, injuries, count: Object.keys(map).length, loadedAt: Date.now() });
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ map, injuries, count: state.count }));
    console.log(`[sleeper] mapped ${state.count} players`);
  } catch (e) {
    console.warn('[sleeper] could not load the player list:', e.message);
  }
}

function ensure() {
  const stale = Date.now() - state.loadedAt > 20 * 3600e3;
  if (stale && !state.loading) state.loading = load().finally(() => { state.loading = null; });
  return state.loading || Promise.resolve();
}

module.exports = { state, ensure };
