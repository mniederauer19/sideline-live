// This week's rankings from sidelineff.com (the same weekly rankings its rankings page shows):
// each player's rank at his position and his projected PPR points, from the main site's
// public /api/live-projections. Used to price the salary-cap lineup game.
const cfg = require('./config');
const tradeValues = require('./trade-values');

const POS = new Set(['QB', 'RB', 'WR', 'TE']);
const state = { rows: new Map(), season: null, week: null, updatedAt: null, loadedAt: 0, error: null };

async function load() {
  try {
    const res = await fetch(`${cfg.SIDELINE_URL}/api/live-projections`, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; sideline-live)' }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    const rows = new Map();
    for (const r of body.rows || []) {
      if (!POS.has(r.position) || r.pprEcr == null) continue;
      rows.set(`${tradeValues.key(r.name)}|${r.position}`, { name: r.name, pos: r.position, team: r.team, rank: Number(r.pprEcr), proj: Number(r.ppr) || 0 });
    }
    if (rows.size < 40) throw new Error(`only ${rows.size} ranked players`);
    Object.assign(state, { rows, season: body.season, week: body.week, updatedAt: body.updatedAt, loadedAt: Date.now(), error: null });
    console.log(`[ranks] week ${body.week} rankings: ${rows.size} players`);
  } catch (e) {
    state.error = e.message;
    console.warn('[ranks] could not load weekly rankings:', e.message);
  }
}

function start() {
  if (cfg.DEMO && !process.env.WEEKLY_RANKS) return;
  let timer = null;
  const run = async () => {
    clearTimeout(timer);
    await load();
    // rankings change during the week: refresh every 20 minutes (every 3 until the first load works)
    timer = setTimeout(run, state.rows.size ? 20 * 60e3 : 3 * 60e3);
    timer.unref?.();
  };
  setTimeout(run, 15e3).unref?.();
}

const rankOf = (name, pos) => state.rows.get(`${tradeValues.key(name)}|${pos}`) || null;

// Testing: load rankings from data instead of the main site
function useRows(list, meta = {}) {
  const rows = new Map();
  for (const r of list) rows.set(`${tradeValues.key(r.name)}|${r.pos}`, r);
  Object.assign(state, { rows, loadedAt: Date.now(), error: null, ...meta });
}

module.exports = { state, start, rankOf, useRows };
