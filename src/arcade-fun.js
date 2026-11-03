// Hype meter: every live game has a 0-100 meter that jumps on big plays, reactions and comments
// and cools off over time (it halves every 90 seconds). The loudest game is marked.
const db = require('./db');
const engine = require('./engine');

const HALF_LIFE = 90e3;
const hype = new Map(); // gameId -> { v, at, sent }
const reactTotals = new Map(); // playId -> reactions + comments seen so far
function bump(gameId, add) {
  if (!gameId || !add) return;
  const now = Date.now();
  const h = hype.get(gameId) || { v: 0, at: now, sent: 0 };
  h.v = h.v * 0.5 ** ((now - h.at) / HALF_LIFE) + add;
  h.at = now;
  hype.set(gameId, h);
}
const valueOf = (h, now = Date.now()) => Math.min(100, Math.round(h.v * 0.5 ** ((now - h.at) / HALF_LIFE)));
function playWeight(p) {
  const x = p.players?.find((y) => y.pos !== 'DST' && y.role !== 'target') || p.players?.[0];
  const pts = Math.abs(x?.ppr || 0);
  return 3 + Math.min(12, pts) + (p.td ? 28 : 0) + (p.explosive ? 10 : 0) + (p.kind === 'int' || p.turnover ? 18 : 0) + (Number(p.yards) >= 40 ? 10 : 0);
}
const gameOfPlay = db.prepare('SELECT game_id FROM plays WHERE id=?');
function board() {
  const now = Date.now();
  const live = engine.listGames().filter((g) => g.state === 'in');
  const out = {};
  for (const g of live) out[g.id] = hype.has(g.id) ? valueOf(hype.get(g.id), now) : 0;
  const top = Object.entries(out).sort((a, b) => b[1] - a[1])[0];
  return { games: out, loudest: top && top[1] >= 15 ? top[0] : null };
}

function mount(app, { send }) {
  engine.bus.on('play', (p) => bump(p.gameId, playWeight(p)));
  engine.bus.on('social', ({ id, social }) => {
    if (!social) return;
    const total = Object.values(social.reactions || {}).reduce((a, b) => a + b, 0) + (social.comments || 0);
    const before = reactTotals.get(id) ?? total - 1;
    reactTotals.set(id, total);
    if (reactTotals.size > 20000) reactTotals.delete(reactTotals.keys().next().value);
    if (total > before) bump(gameOfPlay.get(id)?.game_id, 4 * (total - before));
  });
  // send the meters every 3 seconds while anything changed
  let last = '';
  setInterval(() => {
    if (!engine.listGames().some((g) => g.state === 'in')) return;
    const b = board(), key = JSON.stringify(b);
    if (key !== last) { last = key; send('hype', b); }
  }, 3000).unref();

  app.get('/api/hype', (_req, res) => res.json(board()));
}

module.exports = { mount, playWeight, _bump: bump, _board: board };
