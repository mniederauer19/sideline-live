// DEMO MODE: a simulated slate shaped exactly like ESPN's API responses,
// so the real parser/engine/UI run end to end with no live NFL game on.
// One game is live (a new play every DEMO_PLAY_MS), one is final, two are upcoming.
const cfg = require('./config');
const nflverse = require('./nflverse');

const TEAMS = {
  GB: { id: '9', name: 'Packers', color: '204e32', rec: '4-3' },
  CAR: { id: '29', name: 'Panthers', color: '0085ca', rec: '3-3' },
  DAL: { id: '6', name: 'Cowboys', color: '002a5c', rec: '5-2' },
  PHI: { id: '21', name: 'Eagles', color: '06424d', rec: '4-3' },
  KC: { id: '12', name: 'Chiefs', color: 'e31837', rec: '5-2' },
  BUF: { id: '2', name: 'Bills', color: '00338d', rec: '6-1' },
  SF: { id: '25', name: '49ers', color: 'aa0000', rec: '4-3' },
  SEA: { id: '26', name: 'Seahawks', color: '002a5c', rec: '4-3' },
};
const BOOT = Date.now();
const H = 3600e3;
const SLATE = [
  { id: 'demo-live', away: 'CAR', home: 'GB', details: 'GB -3.5', total: 44.5, tv: 'AMZN', mode: 'live', seed: 11 },
  { id: 'demo-final', away: 'PHI', home: 'DAL', details: 'PHI -2.5', total: 47.5, tv: 'ESPN', mode: 'final', seed: 7, start: BOOT - 3 * 24 * H },
  { id: 'demo-pre1', away: 'KC', home: 'BUF', details: 'BUF -1.5', total: 50.5, tv: 'CBS', mode: 'pre', start: BOOT + 3 * H },
  { id: 'demo-pre2', away: 'SF', home: 'SEA', details: 'SF -3', total: 45.5, tv: 'FOX', mode: 'pre', start: BOOT + 75 * H },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const short = (p) => {
  if (p.short && /\./.test(p.short)) return p.short.replace(/\s+/g, '');
  const parts = p.name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/, '').split(' ');
  return `${parts[0][0]}.${parts.slice(1).join(' ')}`;
};

function roster(abbr) {
  const all = nflverse.byTeam(abbr).sort((a, b) => b.ppg * Math.min(b.games, 4) - a.ppg * Math.min(a.games, 4));
  const pick = (pos, n, fb) => {
    const got = all.filter((p) => p.pos === pos).slice(0, n);
    while (got.length < n) got.push({ id: `${abbr}-${pos}${got.length}`, name: `${fb[got.length]}`, pos, team: abbr });
    return got.map((p) => ({ ...p, tok: short(p) }));
  };
  const k = nflverse.state.kickers.get(abbr) || { id: `${abbr}-K`, name: 'Sam Kicker', team: abbr };
  return {
    qb: pick('QB', 1, ['Alex Passer'])[0],
    rb: pick('RB', 2, ['Ben Runner', 'Cal Back']),
    wr: pick('WR', 3, ['Dee Wideout', 'Eli Slot', 'Finn Deep']),
    te: pick('TE', 1, ['Gus Tightend'])[0],
    k: { ...k, tok: short(k) },
  };
}

const ordinal = (d) => ['', '1st', '2nd', '3rd', '4th'][d] || '';

function simulate(g) {
  const R = rng(g.seed);
  const rand = (a, b) => Math.floor(a + R() * (b - a + 1));
  const ro = { [g.home]: roster(g.home), [g.away]: roster(g.away) };
  const other = (t) => (t === g.home ? g.away : g.home);
  const plays = [];
  const score = { [g.home]: 0, [g.away]: 0 };
  let seq = 0, period = 1, clock = 900;
  let poss = g.away, yte = 65, down = 1, dist = 10;
  const spot = (team, y) => { const own = 100 - y; return own === 50 ? '50' : own < 50 ? `${team} ${own}` : `${other(team)} ${y}`; };
  const clk = () => `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`;

  const push = (type, text, extra = {}) => {
    const p = {
      id: `${g.id}-${++seq}`,
      sequenceNumber: String(seq),
      type: { text: type },
      text,
      period: { number: period },
      clock: { displayValue: clk() },
      start: { down, distance: dist, yardsToEndzone: yte, team: { id: TEAMS[poss].id },
        shortDownDistanceText: down ? `${ordinal(down)} & ${dist}` : '', possessionText: spot(poss, yte) },
      scoringPlay: !!extra.scoring,
      statYardage: extra.yards || 0,
      ...extra.raw,
    };
    plays.push(p);
    return p;
  };
  const after = (p) => {
    p.homeScore = score[g.home]; p.awayScore = score[g.away];
    p.end = { down, distance: dist, yardsToEndzone: yte, team: { id: TEAMS[poss].id } };
  };
  const kickoff = (kicking) => {
    const recv = other(kicking);
    const k = ro[kicking].k;
    poss = kicking; down = 0; dist = 0; yte = 65;
    const p = push('Kickoff', `${k.tok} kicks 65 yards from ${kicking} 35 to ${recv} 0. Touchback.`);
    poss = recv; yte = 65; down = 1; dist = 10; after(p);
  };
  const tick = (s) => {
    clock -= s;
    if (clock <= 0) {
      period += 1; clock = 900;
      if (period === 3) { kickoff(g.away); } // home received first-half kick... away kicks 2nd half
    }
  };

  kickoff(g.home);
  while (period <= 4 && plays.length < 200) {
    const off = ro[poss];
    const defT = other(poss);
    if (down === 4) {
      if (yte <= 37) {
        const d = yte + 17;
        const good = R() < (d < 40 ? 0.95 : d < 50 ? 0.82 : 0.62);
        const p = push(good ? 'Field Goal Good' : 'Field Goal Missed', `${off.k.tok} ${d} yard field goal is ${good ? 'GOOD' : 'No Good, Wide Right'}, Center-L.Snapper, Holder-P.Holder.`, { scoring: good });
        if (good) { score[poss] += 3; after(p); tick(5); if (period > 4) break; kickoff(poss); continue; }
        poss = defT; yte = Math.min(80, 100 - (yte + 7)); down = 1; dist = 10; after(p); tick(5); continue;
      }
      const net = rand(36, 48);
      const p = push('Punt', `P.Punter punts ${net + 5} yards to ${spot(poss, Math.max(1, yte - net))}, Center-L.Snapper, fair catch.`);
      const ny = yte - net;
      poss = defT; yte = ny <= 0 ? 80 : 100 - ny; down = 1; dist = 10; after(p); tick(rand(6, 10)); continue;
    }

    let type, text, y = 0, td = false, turnover = false;
    if (R() < 0.58) {
      const r = R();
      const tgts = [[off.wr[0], 0.27], [off.wr[1], 0.19], [off.te, 0.17], [off.wr[2], 0.13], [off.rb[0], 0.15], [off.rb[1], 0.09]];
      let x = R(), t = tgts[0][0];
      for (const [pl, w] of tgts) { if ((x -= w) <= 0) { t = pl; break; } }
      const deep = R() < 0.25;
      const dir = ['left', 'middle', 'right'][rand(0, 2)];
      if (r < 0.065) { y = -rand(3, 10); type = 'Sack'; text = `${off.qb.tok} sacked at ${spot(poss, yte - y)} for ${y} yards (D.Rusher).`; }
      else if (r < 0.09) { type = 'Pass Interception Return'; text = `${off.qb.tok} pass ${deep ? 'deep' : 'short'} ${dir} intended for ${t.tok} INTERCEPTED by C.Corner at ${spot(poss, Math.max(1, yte - 12))}. C.Corner to ${spot(poss, Math.max(1, yte - 18))} for 6 yards.`; turnover = true; y = 18; }
      else if (r < 0.43) { type = 'Pass Incompletion'; text = `${off.qb.tok} pass incomplete ${deep ? 'deep' : 'short'} ${dir} to ${t.tok}.`; }
      else {
        y = deep ? rand(16, 48) : (R() < 0.12 ? rand(-3, 0) : rand(2, 14));
        if (R() < 0.05) y += rand(15, 40);
        if (y >= yte) { y = yte; td = true; }
        type = td ? 'Passing Touchdown' : 'Pass Reception';
        text = `${off.qb.tok} pass ${deep ? 'deep' : 'short'} ${dir} to ${t.tok}${td ? '' : ` to ${spot(poss, yte - y)}`} for ${y} yards${td ? ', TOUCHDOWN' : ' (S.Safety)'}.`;
      }
    } else {
      const r = R();
      const runner = r < 0.62 ? off.rb[0] : r < 0.88 ? off.rb[1] : off.qb;
      const scramble = runner === off.qb;
      const lane = ['up the middle', 'left end', 'right tackle', 'left guard', 'right end'][rand(0, 4)];
      y = R() < 0.09 ? rand(10, 28) : R() < 0.02 ? rand(30, 70) : rand(-2, 7);
      if (y >= yte) { y = yte; td = true; }
      type = td ? 'Rushing Touchdown' : 'Rush';
      text = `${runner.tok} ${scramble ? 'scrambles right end' : lane}${td ? '' : ` to ${spot(poss, yte - y)}`} for ${y === 0 ? 'no gain' : `${y} yards`}${td ? ', TOUCHDOWN' : ' (L.Backer)'}.`;
      if (y === 0) text = text.replace('for no gain', 'for no gain');
      if (!td && R() < 0.015) { text += ` FUMBLES (L.Backer), RECOVERED by ${defT}-L.Backer at ${spot(poss, yte - y)}.`; turnover = true; type = 'Fumble Recovery (Opponent)'; }
    }

    if (td) {
      score[poss] += 6;
      const good = R() < 0.94;
      text += ` ${off.k.tok} extra point is ${good ? 'GOOD' : 'No Good'}, Center-L.Snapper, Holder-P.Holder.`;
      if (good) score[poss] += 1;
    }
    const p = push(type, text, { yards: y, scoring: td });
    if (td) { after(p); tick(rand(5, 9)); if (period > 4) break; kickoff(poss); continue; }
    if (turnover) {
      const ny = Math.max(1, yte - y);
      poss = defT; yte = 100 - ny; down = 1; dist = 10;
    } else {
      yte -= y; dist -= y;
      if (dist <= 0) { down = 1; dist = Math.min(10, yte); } else down += 1;
      if (yte >= 100) { // safety
        score[defT] += 2; p.text += ' SAFETY'; p.scoringPlay = true;
        poss = defT; yte = 65; down = 1; dist = 10;
      }
    }
    after(p);
    tick(type === 'Pass Incompletion' ? rand(5, 8) : rand(26, 40));
  }
  return { plays, ro };
}

function wpFor(plays, g) {
  return plays.map((p) => {
    const diff = (p.homeScore || 0) - (p.awayScore || 0);
    const left = Math.max(0, (4 - p.period) * 900 + Number(p.clock.displayValue.split(':')[0]) * 60 + Number(p.clock.displayValue.split(':')[1]));
    const possHome = p.end?.team?.id === TEAMS[g.home].id ? 1 : -1;
    const field = possHome * (100 - (p.end?.yardsToEndzone ?? 50)) / 100 * 3;
    const x = (diff + field + 1.5) / (1.5 + 11 * Math.sqrt(left / 3600));
    return { playId: p.id, homeWinPercentage: Math.round(1000 / (1 + Math.exp(-x * 1.4))) / 1000 };
  });
}

function boxscore(plays, g, ro) {
  const players = [];
  const find = new Map();
  for (const t of [g.away, g.home]) {
    const r = ro[t];
    for (const p of [r.qb, ...r.rb, ...r.wr, r.te]) find.set(p.tok, { ...p, team: t });
  }
  const s = new Map();
  const st = (tok) => { if (!s.has(tok)) s.set(tok, { cmp: 0, att: 0, py: 0, ptd: 0, int: 0, car: 0, ry: 0, rtd: 0, rec: 0, recy: 0, rectd: 0, tgt: 0, lost: 0 }); return s.get(tok); };
  const tok = "[A-Z][A-Za-z']{0,3}\\.[A-Z][A-Za-z'\\- .]*?";
  for (const p of plays) {
    const t = p.text; let m;
    const y = Number((t.match(/for (-?\d+) yards/) || [])[1]) || 0;
    const td = /TOUCHDOWN/.test(t);
    if ((m = t.match(new RegExp(`^(${tok}) pass (?:deep|short) \\w+ to (${tok})(?: to| for)`)))) {
      const q = st(m[1]); q.cmp++; q.att++; q.py += y; if (td) q.ptd++;
      const r = st(m[2]); r.rec++; r.tgt++; r.recy += y; if (td) r.rectd++;
    } else if ((m = t.match(new RegExp(`^(${tok}) pass incomplete \\w+ \\w+ to (${tok})\\.`)))) { st(m[1]).att++; st(m[2]).tgt++; }
    else if ((m = t.match(new RegExp(`^(${tok}) pass .*intended for (${tok}) INTERCEPTED`)))) { const q = st(m[1]); q.att++; q.int++; st(m[2]).tgt++; }
    else if ((m = t.match(new RegExp(`^(${tok}) (?:up the middle|left end|right tackle|left guard|right end|scrambles right end)`)))) {
      const r = st(m[1]); r.car++; r.ry += /no gain/.test(t) ? 0 : y; if (td) r.rtd++; if (/FUMBLES.*RECOVERED/.test(t)) r.lost++;
    }
  }
  for (const t of [g.away, g.home]) {
    const ath = (labels, fn, filter) => [...s.entries()].filter(([k, v]) => find.get(k)?.team === t && filter(v))
      .map(([k, v]) => { const p = find.get(k); return { athlete: { id: p.id, displayName: p.name, headshot: { href: p.headshot || '' } }, stats: fn(v) }; });
    players.push({
      team: { id: TEAMS[t].id, abbreviation: t },
      statistics: [
        { name: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT'], athletes: ath(0, (v) => [`${v.cmp}/${v.att}`, String(v.py), '', String(v.ptd), String(v.int)], (v) => v.att > 0) },
        { name: 'rushing', labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], athletes: ath(0, (v) => [String(v.car), String(v.ry), '', String(v.rtd), ''], (v) => v.car > 0) },
        { name: 'receiving', labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], athletes: ath(0, (v) => [String(v.rec), String(v.recy), '', String(v.rectd), '', String(v.tgt)], (v) => v.tgt > 0) },
        { name: 'fumbles', labels: ['FUM', 'LOST', 'REC'], athletes: ath(0, (v) => [String(v.lost), String(v.lost), '0'], (v) => v.lost > 0) },
      ],
    });
  }
  return { players };
}

const sims = new Map();
async function getSim(g) {
  if (!sims.has(g.id)) {
    if (nflverse.state.loading) await nflverse.state.loading;
    const { plays, ro } = simulate(g);
    const total = plays.length;
    let start, wall;
    if (g.mode === 'final') { start = g.start; wall = (i) => start + i * 45000; }
    else {
      // live: ~40% of the game already played at boot, then one play every DEMO_PLAY_MS
      const already = Math.floor(total * 0.4);
      const liveStart = BOOT - already * cfg.DEMO_PLAY_MS;
      start = liveStart - 5 * 60e3;
      wall = (i) => liveStart + i * cfg.DEMO_PLAY_MS;
    }
    plays.forEach((p, i) => { p.wallclock = new Date(wall(i)).toISOString(); });
    g.start = start;
    sims.set(g.id, { plays, ro, wall });
  }
  return sims.get(g.id);
}

function visible(sim, g) {
  if (g.mode === 'final') return sim.plays;
  const now = Date.now();
  return sim.plays.filter((p) => Date.parse(p.wallclock) <= now);
}

function compFor(g, vis, total) {
  const last = vis[vis.length - 1];
  let state = 'pre', detail = new Date(g.start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
  let period = 0, clock = '15:00';
  if (g.mode === 'final' || (vis && vis.length && vis.length >= total)) { state = 'post'; detail = 'Final'; period = 4; clock = '0:00'; }
  else if (vis && vis.length) { state = 'in'; period = last.period.number; clock = last.clock.displayValue; detail = `${['', '1st', '2nd', '3rd', '4th'][period]} ${clock}`; }
  const comp = (abbr, ha) => ({
    homeAway: ha,
    score: String(last ? (ha === 'home' ? last.homeScore : last.awayScore) : 0),
    team: { id: TEAMS[abbr].id, abbreviation: abbr, shortDisplayName: TEAMS[abbr].name, color: TEAMS[abbr].color, logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png` },
    records: [{ summary: TEAMS[abbr].rec }],
  });
  const sit = state === 'in' && last?.end ? {
    possession: last.end.team.id,
    shortDownDistanceText: last.end.down ? `${ordinal(last.end.down)} & ${last.end.distance}` : '',
    isRedZone: last.end.yardsToEndzone <= 20,
  } : undefined;
  return {
    date: new Date(g.start).toISOString(),
    status: { type: { state, shortDetail: detail, completed: state === 'post' }, period, displayClock: clock },
    competitors: [comp(g.home, 'home'), comp(g.away, 'away')],
    odds: [{ details: g.details, overUnder: g.total, provider: { name: 'Consensus' } }],
    broadcasts: [{ names: [g.tv] }],
    situation: sit,
  };
}

async function scoreboard() {
  const events = [];
  for (const g of SLATE) {
    let vis = [], total = 0;
    if (g.mode !== 'pre') { const sim = await getSim(g); vis = visible(sim, g); total = sim.plays.length; }
    const comp = compFor(g, vis, total);
    events.push({ id: g.id, date: comp.date, shortName: `${g.away} @ ${g.home}`, season: { year: cfg.SEASON }, week: { number: 8 }, status: comp.status, competitions: [comp] });
  }
  return { season: { year: cfg.SEASON }, week: { number: 8 }, events };
}

async function summary(id) {
  const g = SLATE.find((x) => x.id === id);
  if (!g) throw new Error('unknown demo game');
  if (g.mode === 'pre') {
    const comp = compFor(g, [], 0);
    return { header: { season: { year: cfg.SEASON }, week: 8, competitions: [comp] }, drives: { previous: [] } };
  }
  const sim = await getSim(g);
  const vis = visible(sim, g);
  const comp = compFor(g, vis, sim.plays.length);
  return {
    header: { season: { year: cfg.SEASON }, week: 8, competitions: [comp] },
    drives: { previous: [{ plays: vis }] },
    winprobability: wpFor(vis, g),
    boxscore: boxscore(vis, g, sim.ro),
    pickcenter: [{ details: g.details, overUnder: g.total, provider: { name: 'Consensus' } }],
  };
}

module.exports = { scoreboard, summary, SLATE };
