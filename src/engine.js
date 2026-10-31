// The live engine: polls the scoreboard + every live game, turns each new play
// into a fantasy play card, stores it, and pushes it to every open browser.
const { EventEmitter } = require('events');
const crypto = require('crypto');
const cfg = require('./config');
const db = require('./db');
const persist = require('./persist');
const espn = require('./espn');
const nflverse = require('./nflverse');
const { parsePlay, rosterIndex } = require('./parse');

const bus = new EventEmitter();
bus.setMaxListeners(0);

const provider = cfg.DEMO ? require('./demo') : espn.live;

const games = new Map();      // gameId -> normalized game
const gameState = new Map();  // gameId -> { box, acc, final, backfilled, busy }
let currentWeek = { season: cfg.SEASON, week: null };
const syncedAt = new Map();   // gameId -> when its finished plays were last stored
const sync = { running: false, total: 0, done: 0, failed: 0, scheduleLoaded: false };

const r2 = (x) => Math.round(x * 100) / 100;
const getGS = (id) => {
  if (!gameState.has(id)) gameState.set(id, { box: new Map(), final: false, backfilled: false, busy: false });
  return gameState.get(id);
};

// ---------------- scoreboard ----------------
const upsertGame = db.prepare(`INSERT INTO games (id, season, week, start_time, state, data, updated_at)
  VALUES (@id, @season, @week, @start, @state, @data, @now)
  ON CONFLICT(id) DO UPDATE SET season=@season, week=@week, start_time=@start, state=@state, data=@data, updated_at=@now`);

function saveGame(g) {
  const prev = games.get(g.id);
  // Keep the last known Vegas line once the game starts (ESPN often drops it)
  if (!g.odds && prev?.odds) g.odds = prev.odds;
  if (!g.odds) {
    const row = db.prepare('SELECT data FROM games WHERE id=?').get(g.id);
    if (row) g.odds = JSON.parse(row.data).odds || null;
  }
  games.set(g.id, g);
  upsertGame.run({ id: g.id, season: g.season, week: g.week, start: g.start, state: g.state, data: JSON.stringify(g), now: Date.now() });
  return g;
}

async function refreshScoreboard() {
  const sb = await provider.scoreboard();
  const evs = sb.events || [];
  const type = sb.season?.type || evs[0]?.season?.type;
  if (type === 2 || type === 3 || cfg.DEMO) {
    if (sb.week?.number) currentWeek = { season: sb.season?.year || cfg.SEASON, week: espn.weekNumber(type, sb.week.number) };
    else if (evs[0]) currentWeek = { season: evs[0].season?.year || cfg.SEASON, week: espn.weekNumber(type, evs[0].week?.number) };
    for (const ev of evs) saveGame(espn.normalizeEvent(ev));
  }
  bus.emit('games', listGames());
  // Something changed in a live game: fetch its plays right away instead of waiting for the next check
  for (const g of listGames()) {
    if (g.state === 'in' && changeKey(g) !== getGS(g.id).lastKey) pollGame(g);
  }
}

// Games for one week (defaults to the current NFL week)
function listGames(week = currentWeek.week, season = currentWeek.season) {
  return [...games.values()]
    .filter((g) => (!week || g.week === week) && (!season || !g.season || g.season === season))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

// The whole season at a glance, for the week picker
function schedule(season = currentWeek.season) {
  const weeks = new Map();
  for (const g of games.values()) {
    if (season && g.season && g.season !== season) continue;
    if (!g.week) continue;
    const w = weeks.get(g.week) || { week: g.week, label: espn.POST_LABELS[g.week] || `Week ${g.week}`, short: g.week > 18 ? (espn.POST_LABELS[g.week] || '').split(' ')[0] : `W${g.week}`, start: Infinity, end: 0, games: 0, final: 0, live: 0 };
    w.start = Math.min(w.start, g.start || Infinity);
    w.end = Math.max(w.end, g.start || 0);
    w.games += 1;
    if (g.state === 'post') w.final += 1;
    if (g.state === 'in') w.live += 1;
    weeks.set(g.week, w);
  }
  return [...weeks.values()].sort((a, b) => a.week - b.week);
}

// Load every week of the season (dates, kickoff times, TV, lines) from ESPN
async function refreshSchedule() {
  if (cfg.DEMO || !provider.week) return;
  const season = currentWeek.season || cfg.SEASON;
  let n = 0;
  for (const [type, weeksInType] of [[2, 18], [3, 5]]) {
    for (let w = 1; w <= weeksInType; w++) {
      try {
        const sb = await provider.week(season, type, w);
        for (const ev of sb.events || []) {
          const g = espn.normalizeEvent(ev);
          if (!g.week) g.week = espn.weekNumber(type, w);
          if (!g.season) g.season = season;
          // don't overwrite a live game the live poller is tracking
          const prev = games.get(g.id);
          if (prev && prev.state === 'in' && g.state !== 'post') continue;
          saveGame(prev ? { ...prev, ...g, odds: g.odds || prev.odds } : g);
          n++;
        }
      } catch (e) { console.warn(`[schedule] week ${type}-${w}: ${e.message}`); }
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  sync.scheduleLoaded = true;
  console.log(`[schedule] ${n} games loaded for ${season}`);
  bus.emit('schedule', schedule());
}

// Store every play of every finished game (and refresh recent finals once for stat corrections)
async function backfill() {
  if (sync.running) return;
  const now = Date.now();
  const todo = [...games.values()].filter((g) => {
    if (g.state !== 'post') return false;
    const at = syncedAt.get(g.id);
    if (!at) return true;
    return at - (g.start || 0) < 48 * 3600e3 && now - at > 12 * 3600e3;
  }).sort((a, b) => b.start - a.start); // newest first
  if (!todo.length) return;
  sync.running = true; sync.total = todo.length; sync.done = 0; sync.failed = 0;
  console.log(`[backfill] storing plays for ${todo.length} finished games...`);
  bus.emit('sync', { ...sync });
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const g = queue.shift();
      const gs = getGS(g.id);
      if (gs.busy) continue;
      gs.busy = true;
      try {
        const summary = await provider.summary(g.id);
        processSummary(games.get(g.id) || g, summary, { quiet: true });
      } catch (e) {
        sync.failed++;
        console.warn(`[backfill] ${g.name}: ${e.message}`);
      } finally { gs.busy = false; }
      sync.done++;
      if (sync.done % 4 === 0 || sync.done === sync.total) bus.emit('sync', { ...sync });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  sync.running = false;
  console.log(`[backfill] done: ${sync.done - sync.failed} games stored${sync.failed ? `, ${sync.failed} failed (will retry)` : ''}`);
  bus.emit('sync', { ...sync });
  bus.emit('schedule', schedule());
}

// ---------------- per-game processing ----------------
function boxFromSummary(summary, names = []) {
  const out = new Map();
  for (const tb of summary.boxscore?.players || []) {
    const abbr = tb.team?.abbreviation;
    for (const cat of tb.statistics || []) {
      const labels = cat.labels || [];
      for (const a of cat.athletes || []) {
        const id = String(a.athlete?.id || '');
        if (!id) continue;
        names.push({ id, name: a.athlete.displayName, team: abbr, headshot: a.athlete.headshot?.href || '' });
        const v = (label) => a.stats?.[labels.indexOf(label)];
        const num = (label) => Number(v(label)) || 0;
        const p = out.get(id) || { id, name: a.athlete.displayName, team: abbr, headshot: a.athlete.headshot?.href || '', s: {} };
        const s = p.s;
        if (cat.name === 'passing') {
          const [c, att] = String(v('C/ATT') || '0/0').split('/').map(Number);
          Object.assign(s, { cmp: c || 0, att: att || 0, passYds: num('YDS'), passTd: num('TD'), int: num('INT') });
        } else if (cat.name === 'rushing') Object.assign(s, { car: num('CAR'), rushYds: num('YDS'), rushTd: num('TD') });
        else if (cat.name === 'receiving') Object.assign(s, { rec: num('REC'), recYds: num('YDS'), recTd: num('TD'), tgt: num('TGTS') });
        else if (cat.name === 'fumbles') Object.assign(s, { fumLost: num('LOST') });
        else continue;
        out.set(id, p);
      }
    }
  }
  return out;
}

function pprFromStats(s) {
  return r2((s.passYds || 0) * 0.04 + (s.passTd || 0) * 4 - (s.int || 0) * 2
    + (s.rushYds || 0) * 0.1 + (s.rushTd || 0) * 6
    + (s.rec || 0) + (s.recYds || 0) * 0.1 + (s.recTd || 0) * 6
    - (s.fumLost || 0) * 2 + (s.twoPt || 0) * 2
    + (s.fgPts || 0) + (s.xpm || 0) - Math.max(0, (s.xpa || 0) - (s.xpm || 0)) - Math.max(0, (s.fga || 0) - (s.fgm || 0)));
}

function statLine(s) {
  const parts = [];
  if (s.att) parts.push(`${s.cmp || 0}/${s.att}, ${s.passYds || 0} yd${s.passTd ? `, ${s.passTd} td` : ''}${s.int ? `, ${s.int} int` : ''}`);
  if (s.car) parts.push(`${s.car} car, ${s.rushYds || 0} yd${s.rushTd ? `, ${s.rushTd} td` : ''}`);
  if (s.rec || s.tgt) parts.push(`${s.rec || 0} rec, ${s.recYds || 0} yd${s.recTd ? `, ${s.recTd} td` : ''}`);
  if (s.fga || s.xpa) parts.push(`${s.fgm || 0}/${s.fga || 0} FG, ${s.xpm || 0}/${s.xpa || 0} XP`);
  return parts.join(' · ');
}

const selectGamePlays = db.prepare('SELECT id, hash, ts FROM plays WHERE game_id=?');
const insertPlay = db.prepare(`INSERT INTO plays (id, game_id, seq, ts, ppr, scoring, explosive, player_ids, hash, data)
  VALUES (@id, @game_id, @seq, @ts, @ppr, @scoring, @explosive, @player_ids, @hash, @data)
  ON CONFLICT(id) DO UPDATE SET seq=@seq, ppr=@ppr, scoring=@scoring, explosive=@explosive, player_ids=@player_ids, hash=@hash, data=@data`);
const deletePlay = db.prepare('DELETE FROM plays WHERE id=?');

const upsertBox = db.prepare(`INSERT INTO game_players (game_id, player_id, name, team, ppr, line, stats) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(game_id, player_id) DO UPDATE SET name=excluded.name, team=excluded.team, ppr=excluded.ppr, line=excluded.line, stats=excluded.stats`);

// Official fantasy totals for one game (memory first, then the database)
function boxFor(gameId) {
  const gs = getGS(gameId);
  if (!gs.box.size && !gs.boxLoaded) {
    gs.boxLoaded = true;
    for (const r of db.prepare('SELECT * FROM game_players WHERE game_id=?').all(gameId)) {
      gs.box.set(r.player_id, { id: r.player_id, name: r.name, team: r.team, ppr: r.ppr, line: r.line, s: JSON.parse(r.stats || '{}') });
    }
  }
  return gs.box;
}

function processSummary(game, summary, opts = {}) {
  const gs = getGS(game.id);
  return db.transaction(() => processSummaryTx(game, summary, opts, gs))();
}

function processSummaryTx(game, summary, opts, gs) {

  // Refresh score/status from the summary header
  const hc = summary.header?.competitions?.[0];
  if (hc) {
    const ev = { id: game.id, competitions: [hc], status: hc.status, season: summary.header.season, week: summary.header.week, date: hc.date };
    const g2 = espn.normalizeEvent(ev);
    const pc = espn.normalizeOdds(summary.pickcenter?.[0]);
    const defined = Object.fromEntries(Object.entries(g2).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && isNaN(v))));
    game = saveGame({ ...game, ...defined, name: game.name || `${g2.away.abbr} @ ${g2.home.abbr}`,
      home: { ...game.home, ...g2.home, logo: g2.home.logo || game.home?.logo, record: g2.home.record || game.home?.record },
      away: { ...game.away, ...g2.away, logo: g2.away.logo || game.away?.logo, record: g2.away.record || game.away?.record },
      odds: g2.odds || pc || game.odds, broadcast: game.broadcast || g2.broadcast });
  }

  const teamsById = { [game.home.id]: game.home.abbr, [game.away.id]: game.away.abbr };
  const entries = [];
  const box = boxFromSummary(summary, entries);
  for (const abbr of [game.home.abbr, game.away.abbr]) {
    const k = nflverse.state.kickers.get(abbr);
    if (k) entries.push({ id: k.id, name: k.name, team: abbr, pos: 'K', headshot: k.headshot });
    for (const p of nflverse.byTeam(abbr)) entries.push({ id: p.id, name: p.name, team: p.team, pos: p.pos, headshot: p.headshot });
  }
  for (const r of summary.rosters || []) {
    for (const a of r.roster || []) entries.push({ id: a.athlete?.id, name: a.athlete?.displayName, team: r.team?.abbreviation, pos: a.position?.abbreviation, headshot: a.athlete?.headshot?.href });
  }
  const index = rosterIndex(entries);
  const wp = new Map((summary.winprobability || []).map((w) => [String(w.playId), w.homeWinPercentage]));

  // Gather plays in order
  const raws = [];
  const seen = new Set();
  const drives = summary.drives ? [...(summary.drives.previous || []), summary.drives.current].filter(Boolean) : [];
  for (const d of drives) for (const p of d.plays || []) if (!seen.has(String(p.id))) { seen.add(String(p.id)); raws.push(p); }
  for (const p of summary.plays || []) if (!seen.has(String(p.id))) { seen.add(String(p.id)); raws.push(p); }
  raws.sort((a, b) => (Number(a.sequenceNumber) || 0) - (Number(b.sequenceNumber) || 0));

  const existing = new Map(selectGamePlays.all(game.id).map((r) => [r.id, r]));
  const acc = new Map();        // playerId -> running stats this game
  const teamTgt = {};
  let lastWp = 0.5;
  const fresh = [], updated = [];
  const keep = new Set();

  // Plays already parsed on an earlier poll are reused (only new or edited plays are re-read),
  // which keeps live updates light enough for a small server.
  if (!gs.parsed) gs.parsed = new Map();
  let dirty = false;
  const accumulate = (p) => {
    const a = acc.get(p.id) || { ppr: 0, s: {} };
    a.ppr = r2(a.ppr + p.ppr);
    for (const [k, v] of Object.entries(p.stat)) a.s[k] = (a.s[k] || 0) + v;
    if (p.role === 'kicker' && p.stat.fgm) a.s.fgPts = (a.s.fgPts || 0) + p.ppr;
    acc.set(p.id, a);
    if (p.stat.tgt && p.team) teamTgt[p.team] = (teamTgt[p.team] || 0) + p.stat.tgt;
    return a;
  };

  raws.forEach((raw, i) => {
    const id = String(raw.id);
    const sig = `${raw.text || ''}|${raw.type?.text || ''}|${raw.modified || ''}|${raw.homeScore}-${raw.awayScore}|${raw.scoringPlay ? 1 : 0}|${raw.end?.yardsToEndzone}`;
    let base = gs.parsed.get(id);
    const changed = !base || base.sig !== sig;
    if (changed) {
      base = { sig, play: parsePlay(raw, { gameId: game.id, teamsById, homeAbbr: game.home.abbr, awayAbbr: game.away.abbr, index }) };
      gs.parsed.set(id, base);
      dirty = true;
    }
    if (base.play.kind === 'admin') return;

    // Nothing new up to here: just carry the running totals forward
    if (!dirty && existing.has(id)) {
      for (const p of base.play.players) if (p.id) accumulate(p);
      const w = wp.get(id);
      if (w != null && base.play.offense) lastWp = w;
      keep.add(id);
      return;
    }

    const play = structuredClone(base.play);
    // Running game totals, snapshotted onto the card at the moment of the play
    for (const p of play.players) {
      if (!p.id) continue;
      const a = accumulate(p);
      const nv = nflverse.get(p.id);
      if (nv) { p.pos = p.pos || nv.pos; p.headshot = p.headshot || nv.headshot; p.season = { ppg: nv.ppg, tgtShare: nv.tgtShare, adot: nv.adot, games: nv.games }; }
      p.gamePpr = a.ppr;
      p.gameLine = p.pos === 'DST' ? '' : statLine(a.s);
      if ((p.role === 'receiver' || p.role === 'target') && a.s.tgt >= 3 && teamTgt[p.team]) {
        play.tags.push({ icon: '📡', text: `${a.s.tgt} targets, ${Math.round(a.s.tgt / teamTgt[p.team] * 100)}% share today` });
      }
    }

    // Win probability added (from ESPN's live win-probability model)
    const after = wp.get(play.id);
    if (after != null && play.offense) {
      const offIsHome = play.offense === game.home.abbr;
      const offAfter = offIsHome ? after : 1 - after;
      const offBefore = offIsHome ? lastWp : 1 - lastWp;
      play.wp = { team: play.offense, pct: Math.round(offAfter * 1000) / 10, delta: Math.round((offAfter - offBefore) * 1000) / 10 };
      lastWp = after;
    }
    if (play.epa != null) play.tags.push({ icon: play.epa >= 0 ? '📈' : '📉', text: `${play.epa >= 0 ? '+' : ''}${play.epa.toFixed(1)} EPA` });
    if (play.wp && Math.abs(play.wp.delta) >= 0.5) {
      play.tags.push({ icon: '📊', text: `${play.wp.team} win prob ${play.wp.pct}% (${play.wp.delta >= 0 ? '+' : ''}${play.wp.delta})` });
    }

    play.game = { id: game.id, home: game.home.abbr, away: game.away.abbr };
    const prev = existing.get(play.id);
    const ts = play.ts || prev?.ts || (game.state === 'in' ? Date.now() : (game.start || Date.now()) + i * 25000);
    play.ts = ts;
    const data = JSON.stringify(play);
    const hash = crypto.createHash('sha1').update(data).digest('hex');
    keep.add(play.id);
    if (prev && prev.hash === hash) return;
    insertPlay.run({
      id: play.id, game_id: game.id, seq: play.seq || i, ts,
      ppr: play.ppr, scoring: play.scoring ? 1 : 0, explosive: play.explosive ? 1 : 0,
      player_ids: `,${play.players.map((p) => p.id).filter(Boolean).join(',')},`, hash, data,
    });
    (prev ? updated : fresh).push(play);
  });

  for (const id of existing.keys()) if (!keep.has(id)) deletePlay.run(id);

  // Player fantasy totals for lineups: box score is official; per-play adds kickers/2-pt
  const totals = new Map();
  for (const [id, b] of box) totals.set(id, { id, name: b.name, team: b.team, s: { ...b.s } });
  for (const [id, a] of acc) {
    const t = totals.get(id) || { id, s: {} };
    if (!box.has(id)) Object.assign(t.s, a.s);
    else { t.s.twoPt = a.s.twoPt || 0; }
    totals.set(id, t);
  }
  for (const t of totals.values()) {
    t.ppr = pprFromStats(t.s); t.line = statLine(t.s);
    if (!t.name) { const nv = nflverse.get(t.id); t.name = nv?.name || ''; t.team = t.team || nv?.team || ''; }
    if (t.name) upsertBox.run(game.id, t.id, t.name, t.team || '', t.ppr, t.line, JSON.stringify(t.s));
  }
  gs.box = totals;
  gs.boxLoaded = true;
  // what the fast path needs to read plays between summaries
  gs.ctx = { teamsById, index };
  gs.accBase = acc;
  gs.qacc = null;

  const firstLoad = !gs.backfilled;
  gs.backfilled = true;
  if (!opts.quiet) {
    if (firstLoad || fresh.length > 25) {
      if (fresh.length) bus.emit('refresh', { gameId: game.id });
    } else {
      for (const p of fresh) bus.emit('play', p);
      for (const p of updated) bus.emit('play_update', p);
    }
    bus.emit('game', game);
    if (fresh.length || updated.length) bus.emit('points', { gameId: game.id });
  }

  if (game.state === 'post') {
    gs.final = true;
    gradeGame(game);
    const now = Date.now();
    syncedAt.set(game.id, now);
    db.prepare('UPDATE games SET synced_at=? WHERE id=?').run(now, game.id);
  }
  return { fresh: fresh.length, updated: updated.length };
}

// ---------------- fast path: plays straight from ESPN's core API ----------------
// The core API lists each play about 20 seconds before the game summary does, so live plays
// are read from there first. The summary still arrives later and fills in win probability,
// target share and official box-score totals (the card updates in place).
const CORE_PAGE = 10;
const refId = (o) => (o?.id != null ? String(o.id) : o?.$ref ? (String(o.$ref).match(/teams\/(\d+)/) || [])[1] : undefined);
function normCore(p) {
  const out = { ...p };
  for (const k of ['start', 'end']) if (p[k]) out[k] = { ...p[k], team: p[k].team ? { id: refId(p[k].team) } : undefined };
  if (p.team) out.team = { id: refId(p.team) };
  return out;
}
const playSig = (raw) => `${raw.text || ''}|${raw.type?.text || ''}|${raw.modified || ''}|${raw.homeScore}-${raw.awayScore}|${raw.scoringPlay ? 1 : 0}|${raw.end?.yardsToEndzone}`;

async function pollCore(game) {
  const gs = getGS(game.id);
  if (!provider.corePlays || !gs.ctx || gs.coreBusy) return;
  gs.coreBusy = true;
  try {
    let page = Math.max(1, Math.ceil((gs.coreCount || 1) / CORE_PAGE));
    let r = await provider.corePlays(game.id, page, CORE_PAGE);
    const pages = [r];
    if (r.pageCount > page) {
      page = r.pageCount;
      pages.push(await provider.corePlays(game.id, page, CORE_PAGE));
    }
    gs.coreCount = pages[pages.length - 1].count || gs.coreCount;
    const items = pages.flatMap((x) => x.items || []).map(normCore)
      .sort((a, b) => (Number(a.sequenceNumber) || 0) - (Number(b.sequenceNumber) || 0));
    if (!gs.parsed) gs.parsed = new Map();
    const existing = new Set(selectGamePlays.all(game.id).map((x) => x.id));
    const fresh = [];
    db.transaction(() => {
      for (const raw of items) {
        const id = String(raw.id);
        if (existing.has(id) || gs.parsed.has(id)) continue;
        const base = { sig: playSig(raw), play: parsePlay(raw, { gameId: game.id, ...gs.ctx, homeAbbr: game.home.abbr, awayAbbr: game.away.abbr }) };
        gs.parsed.set(id, base);
        if (base.play.kind === 'admin') continue;
        if (!gs.qacc) gs.qacc = new Map([...(gs.accBase || new Map())].map(([k, v]) => [k, { ppr: v.ppr, s: { ...v.s } }]));
        const play = structuredClone(base.play);
        for (const p of play.players) {
          if (!p.id) continue;
          const a = gs.qacc.get(p.id) || { ppr: 0, s: {} };
          a.ppr = r2(a.ppr + p.ppr);
          for (const [k, v] of Object.entries(p.stat)) a.s[k] = (a.s[k] || 0) + v;
          gs.qacc.set(p.id, a);
          const nv = nflverse.get(p.id);
          if (nv) { p.pos = p.pos || nv.pos; p.headshot = p.headshot || nv.headshot; p.season = { ppg: nv.ppg, tgtShare: nv.tgtShare, adot: nv.adot, games: nv.games }; }
          p.gamePpr = a.ppr;
          p.gameLine = p.pos === 'DST' ? '' : statLine(a.s);
        }
        if (play.epa != null) play.tags.push({ icon: play.epa >= 0 ? '📈' : '📉', text: `${play.epa >= 0 ? '+' : ''}${play.epa.toFixed(1)} EPA` });
        play.game = { id: game.id, home: game.home.abbr, away: game.away.abbr };
        play.ts = Date.now();
        const data = JSON.stringify(play);
        insertPlay.run({
          id: play.id, game_id: game.id, seq: play.seq || 0, ts: play.ts,
          ppr: play.ppr, scoring: play.scoring ? 1 : 0, explosive: play.explosive ? 1 : 0,
          player_ids: `,${play.players.map((p) => p.id).filter(Boolean).join(',')},`,
          hash: crypto.createHash('sha1').update(data).digest('hex'), data,
        });
        fresh.push(play);
      }
    })();
    for (const p of fresh) bus.emit('play', p);
    if (fresh.length) bus.emit('points', { gameId: game.id });
  } catch (e) {
    console.warn(`[engine] fast plays for ${game.id}: ${e.message}`);
  } finally { gs.coreBusy = false; }
}

// What the scoreboard says about a game right now; when it changes, something happened
const changeKey = (g) => [g.state, g.period, g.home?.score, g.away?.score, g.lastPlayId, g.downDistance, g.possession].join('|');

async function pollGame(game) {
  const gs = getGS(game.id);
  if (gs.busy) return;
  gs.busy = true;
  const key = changeKey(game);
  try {
    const summary = await provider.summary(game.id);
    processSummary(game, summary);
    gs.lastKey = key;
    gs.lastFetch = Date.now();
  } catch (e) {
    console.warn(`[engine] game ${game.id}: ${e.message}`);
  } finally { gs.busy = false; }
}

async function pollLive() {
  const now = Date.now();
  const jobs = [];
  for (const g of listGames()) {
    const gs = getGS(g.id);
    const startingSoon = g.state === 'pre' && g.start - now < 10 * 60e3 && g.start - now > -3 * 3600e3;
    const needsFinal = g.state === 'post' && !gs.final && !syncedAt.has(g.id);
    if (g.state === 'in') {
      jobs.push(pollCore(g));
      // Only download the full game when the scoreboard shows a change (or every so often as a safety net)
      if (changeKey(g) !== gs.lastKey || now - (gs.lastFetch || 0) > cfg.LIVE_MAX_GAP_MS) jobs.push(pollGame(g));
    } else if (startingSoon || needsFinal) jobs.push(pollGame(g));
  }
  await Promise.all(jobs);
}

// ---------------- picks grading ----------------
function gradePick(pick, game) {
  const sh = game.home.score, sa = game.away.score;
  if (pick.market === 'total') {
    const pts = sh + sa;
    if (pts === pick.line) return 'push';
    return (pts > pick.line) === (pick.selection === 'over') ? 'win' : 'loss';
  }
  const selHome = pick.selection === game.home.abbr;
  const margin = selHome ? sh - sa : sa - sh;
  // Favorite gives the points, underdog gets them
  const adj = !pick.fav ? 0 : pick.selection === pick.fav ? -pick.line : pick.line;
  const v = margin + adj;
  return v === 0 ? 'push' : v > 0 ? 'win' : 'loss';
}

function gradeGame(game) {
  const row = db.prepare('SELECT graded FROM games WHERE id=?').get(game.id);
  if (!row || row.graded) return;
  const picks = db.prepare('SELECT * FROM picks WHERE game_id=? AND result IS NULL').all(game.id);
  const tx = db.transaction(() => {
    for (const p of picks) {
      const result = gradePick(p, game);
      const delta = result === 'win' ? cfg.PICK_WIN : result === 'loss' ? cfg.PICK_LOSS : 0;
      db.prepare('UPDATE picks SET result=?, credits_delta=? WHERE id=?').run(result, delta, p.id);
      db.prepare('UPDATE users SET credits = MAX(0, credits + ?) WHERE id=?').run(delta, p.user_id);
    }
    db.prepare('UPDATE games SET graded=1 WHERE id=?').run(game.id);
  });
  tx();
  for (const p of picks) persist.upsert('picks', { id: p.id });
  for (const uid of new Set(picks.map((p) => p.user_id))) persist.upsert('users', { id: uid });
  if (picks.length) { console.log(`[engine] graded ${picks.length} picks for ${game.name}`); bus.emit('leaderboard'); }
}

// ---------------- lookups used by the API ----------------
function playerGame(id) {
  for (const g of listGames()) {
    const t = boxFor(g.id).get(String(id));
    if (t) return { game: g, ...t };
  }
  return null;
}

function teamGame(abbr) {
  return listGames().find((g) => g.home.abbr === abbr || g.away.abbr === abbr) || null;
}

async function loop(fn, ms, name) {
  const tick = async () => {
    try { await fn(); } catch (e) { console.warn(`[engine] ${name}: ${e.message}`); }
    setTimeout(tick, typeof ms === 'function' ? ms() : ms).unref?.();
  };
  tick();
}

function start() {
  // restore games from db so the site works immediately after a restart
  for (const r of db.prepare('SELECT data, synced_at FROM games').all()) {
    const g = JSON.parse(r.data);
    games.set(g.id, g);
    if (r.synced_at) syncedAt.set(g.id, r.synced_at);
  }
  loop(refreshScoreboard, () => (listGames().some((g) => g.state === 'in') ? cfg.LIVE_SCOREBOARD_MS : cfg.SCOREBOARD_POLL_MS), 'scoreboard');
  setTimeout(() => loop(pollLive, cfg.LIVE_POLL_MS, 'live'), 1500);
  // Full season: schedule now and every 6 hours, then store all finished games
  if (!cfg.DEMO) {
    const season = async () => {
      if (nflverse.state.loading) await nflverse.state.loading; // player info first, for names and photos
      await refreshSchedule();
      await backfill();
    };
    setTimeout(() => loop(season, 6 * 3600e3, 'season'), 3000);
    setTimeout(() => loop(backfill, 10 * 60e3, 'backfill'), 15 * 60e3);
  }
}

module.exports = {
  _pollCore: pollCore, _processSummary: processSummary,
  bus, start, listGames, games, getGS, boxFor, schedule, sync, currentWeek: () => currentWeek,
  playerGame, teamGame, gradePick, processSummary, refreshScoreboard, refreshSchedule, backfill, pollLive, pprFromStats,
};
