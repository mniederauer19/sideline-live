// Turns one ESPN play into a fantasy-first play card:
// who was involved, standard PPR points each player earned on the play,
// a Real-style headline, and analytics tags (1st down, explosive, EPA, WPA...).
const { ep } = require('./ep');

// ESPN abbreviated names in play text: "J.Hurts", "A.St. Brown", "Ja.Chase", "C.McCaffrey"
const N = "[A-Z][A-Za-z']{0,3}\\.(?:[A-Z]\\.)?(?:St\\. ?)?[A-Z][A-Za-z'\\-]+";

const RX = {
  admin: /timeout|end period|end of (?:half|game|quarter)|two-minute|two minute|coin toss|end quarter/i,
  noPlay: /\bNo Play\b/i,
  fg: new RegExp(`(${N}) (\\d+) yard field goal is (GOOD|No Good|BLOCKED)`, 'i'),
  pat: new RegExp(`(${N}) extra point is (GOOD|No Good|BLOCKED|Aborted)`, 'i'),
  kickoff: new RegExp(`(${N}) kicks (?:onside )?-?\\d+ yards? from`),
  punt: new RegExp(`(${N}) punts -?\\d+ yards?`),
  returnTd: new RegExp(`(?:kicks|punts)[^.]*?\\.\\s*(?:[^.]*?\\.\\s*)?(${N})(?: to [A-Z]{2,3} \\d+| to \\d+)? for (\\d+) yards?,? TOUCHDOWN`),
  twoPt: /TWO-POINT CONVERSION ATTEMPT/i,
  int: new RegExp(`(${N}) pass[^.]*?(?:intended for (${N}) )?INTERCEPTED by (${N})`),
  sack: new RegExp(`(${N}) sacked`),
  incomplete: new RegExp(`(${N}) pass incomplete(?: (short|deep))?(?: (left|middle|right))?(?: (?:to|intended for) (${N}))?`),
  complete: new RegExp(`(${N}) pass(?: (short|deep))?(?: (left|middle|right))? to (${N})`),
  rush: new RegExp(`(${N}) (up the middle|left end|left tackle|left guard|right end|right tackle|right guard|scrambles|rushes|runs|kneels|to the left|to the right|middle|left|right)`),
  yards: /for (-?\d+) yards?|for no gain|for a loss of (\d+) yards?/i,
  fumble: /(?:FUMBLES|MUFFS)[^]*?(?:RECOVERED|recovered) by ([A-Z]{2,3})-/,
  fumbler: new RegExp(`(${N}) FUMBLES`),
  penalty: /PENALTY on ([A-Z]{2,3})-?(?:[A-Z][A-Za-z.' -]+)?, ([A-Za-z \-]+?),/,
  twoPtPass: new RegExp(`(${N}) pass(?: to (${N}))?[^.]*?\\. ATTEMPT (SUCCEEDS|FAILS)`, 'i'),
  twoPtRush: new RegExp(`(${N}) (?:rushes|up the middle|left|right|scrambles)[^.]*?\\. ATTEMPT (SUCCEEDS|FAILS)`, 'i'),
  spike: new RegExp(`(${N}) spiked the ball`),
  aborted: new RegExp(`(${N}) (?:Aborted|FUMBLES \\(Aborted\\))`),
  lateral: new RegExp(`Lateral to (${N})[^.]*? for (-?\\d+) yards?`, 'g'),
  enforced: /PENALTY on [^]*?enforced at (?:([A-Z]{2,3}) )?(\d+)/,
  // Scoring-summary style text ESPN sometimes uses for touchdowns:
  // "Ollie Gordon II 1 Yd Run (Zane Gonzalez Kick)", "Darren Waller 50 Yd pass from Bryce Young (Ryan Fitzgerald PAT blocked)"
  sumPass: /^(.+?) (\d+) Yd pass from (.+?)(?: \((.*)\))?\.?$/i,
  sumRun: /^(.+?) (\d+) Yd Run(?: \((.*)\))?\.?$/i,
  sumRet: /^(.+?) (\d+) Yd (Interception|Fumble|Kickoff|Punt|Blocked Punt|Blocked Field Goal|Blocked FG|Missed Field Goal|Missed FG|Fumble Recovery|Blocked Punt Recovery)(?: Return)?(?: \((.*)\))?\.?$/i,
  sumFg: /^(.+?) (\d+) Yd Field Goal\.?$/i,
  // Full-name format a few games use: "Daniel Jones Pass Complete for 48 Yds to Laquon Treadwell"
  altComplete: /^(.+?) Pass Complete for (-?\d+) Yds? to (.+?)(?: (\3) Fumble(?: (.+?) -?\d+ Yd Fumble Recovery)?)?(?:,? (?:for a )?(?:TD|Touchdown))?\.?$/i,
  altIncomplete: /^(.+?) Incomplete Pass(?:, Intended For (.+?))?\.?$/i,
  altRush: /^(.+?) (-?\d+) Yd Rush\.?$/i,
  // Ball carrier with no run direction: "C.Williams to MIN 45 for 19 yards"
  runTo: new RegExp(`(${N}) (?:pushed ob |ran ob )?(?:at |to )(?:[A-Z]{2,3} )?-?\\d+ for (?:-?\\d+ yards?|no gain)`),
  returner: new RegExp(`(?:kicks|punts)[^]*?(?:\\.\\s+|, )(${N}) (?:to |for |pushed ob|ran ob|MUFFS|muffs|FUMBLES|Touchback)`),
  blocked: /(punt) is BLOCKED/i,
  recovered: /(?:RECOVERED|recovered) by ([A-Z]{2,3})-/,
};

// Play text sometimes uses older team codes than the rest of ESPN's data
const ALIAS = { HST: 'HOU', CLV: 'CLE', ARZ: 'ARI', BLT: 'BAL', LA: 'LAR', WAS: 'WSH', JAC: 'JAX', SL: 'LAR', SD: 'LAC', OAK: 'LV' };
const canonTeam = (t, ctx) => {
  if (!t) return t;
  if (t === ctx.homeAbbr || t === ctx.awayAbbr) return t;
  if (ALIAS[t]) return ALIAS[t];
  // last resort: same first letter as one of the two teams
  const c = [ctx.homeAbbr, ctx.awayAbbr].filter((x) => x && x[0] === t[0]);
  return c.length === 1 ? c[0] : t;
};

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
const r2 = (x) => Math.round(x * 100) / 100;

// ---------- roster index: maps "J.Hurts" in play text to an ESPN athlete ----------
function rosterIndex(entries) {
  // entries: [{id, name, team, pos, headshot}]
  const byTeam = new Map();
  for (const e of entries) {
    if (!e.id || !e.name || !e.team) continue;
    const clean = e.name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim();
    const parts = clean.split(/\s+/);
    const first = norm(parts[0]);
    const last = norm(parts.slice(1).join(' '));
    if (!byTeam.has(e.team)) byTeam.set(e.team, []);
    const list = byTeam.get(e.team);
    if (!list.some((x) => x.id === String(e.id))) list.push({ ...e, id: String(e.id), first, last });
  }
  return byTeam;
}

function lookup(index, token, preferTeams) {
  if (!token) return null;
  const dot = token.indexOf('.');
  const abbr = norm(token.slice(0, dot));
  const last = norm(token.slice(dot + 1).replace(/^([A-Z]\.)+/, ''));
  const teams = [...preferTeams, ...[...index.keys()].filter((t) => !preferTeams.includes(t))];
  for (const t of teams) {
    const cands = (index.get(t) || []).filter((p) => p.last === last || p.last.endsWith(last));
    if (!cands.length) continue;
    const best = cands.find((p) => p.first.startsWith(abbr)) || (cands.length === 1 ? cands[0] : null);
    if (best) return best;
  }
  return null;
}

function lookupFull(index, fullName, preferTeams) {
  if (!fullName) return null;
  const clean = fullName.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, '').trim();
  const parts = clean.split(/\s+/);
  const first = norm(parts[0]);
  const last = norm(parts.slice(1).join(' '));
  const teams = [...preferTeams, ...[...index.keys()].filter((t) => !preferTeams.includes(t))];
  for (const t of teams) {
    const hit = (index.get(t) || []).find((p) => p.last === last && (p.first === first || p.first.startsWith(first.slice(0, 2))));
    if (hit) return hit;
  }
  return null;
}

// "NYJ 22" -> yards to the end zone for the offense
function spotYte(label, n, offense, ctx) {
  if (!label) return 50;
  return canonTeam(label, ctx) === offense ? 100 - Number(n) : Number(n);
}

// Official stats only count yards up to the spot where an accepted penalty is enforced
function creditedYards(yards, main, raw, offense, ctx) {
  if (/TOUCHDOWN/.test(main) && !/TOUCHDOWN NULLIFIED/.test(main)) return yards;
  const em = main.match(RX.enforced);
  const startYte = raw.start?.yardsToEndzone;
  if (!em || startYte == null) return yards;
  const n = Number(em[2]);
  const label = em[1] ? canonTeam(em[1], ctx) : null;
  const spotYte = !label ? 50 : label === offense ? 100 - n : n;
  const toSpot = startYte - spotYte;
  return toSpot >= 0 && toSpot < yards ? toSpot : yards;
}

// ---------- the parser ----------
function parsePlay(raw, ctx) {
  // ctx: { gameId, teamsById: {id: abbr}, homeAbbr, awayAbbr, index, prevScore: {home, away} }
  const typeText = raw.type?.text || '';
  let text = (raw.text || '').trim();
  const offense = ctx.teamsById[raw.start?.team?.id] || null;
  const defense = offense === ctx.homeAbbr ? ctx.awayAbbr : offense === ctx.awayAbbr ? ctx.homeAbbr : null;

  const out = {
    id: String(raw.id),
    gameId: ctx.gameId,
    seq: Number(raw.sequenceNumber) || 0,
    period: raw.period?.number || 0,
    clock: raw.clock?.displayValue || '',
    ts: Date.parse(raw.wallclock || raw.modified || '') || null,
    offense, defense,
    down: raw.start?.down || 0,
    distance: raw.start?.distance || 0,
    yte: raw.start?.yardsToEndzone ?? null,
    downText: raw.start?.shortDownDistanceText || raw.start?.downDistanceText || '',
    typeText,
    text,
    homeScore: Number(raw.homeScore ?? 0),
    awayScore: Number(raw.awayScore ?? 0),
    scoring: !!raw.scoringPlay,
    kind: 'other',
    headline: typeText || 'Play',
    yards: 0,
    players: [],
    tags: [],
    epa: null,
    nullified: false,
    explosive: false,
  };

  if (RX.admin.test(typeText) || (!text && !typeText)) { out.kind = 'admin'; return out; }

  // Replay reversal: the official result follows "REVERSED."
  const rev = text.split(/REVERSED\.\s*/);
  let main = rev[rev.length - 1];
  // Strip formation tags like "(Shotgun)" / "(No Huddle, Shotgun)"
  while (/^\s*\([^)]*\)\s*/.test(main)) main = main.replace(/^\s*\([^)]*\)\s*/, '');
  let twoPtText = '';
  const tp = main.search(RX.twoPt);
  if (tp > 0) { twoPtText = main.slice(tp); main = main.slice(0, tp); }

  out.nullified = RX.noPlay.test(main);
  const players = new Map();
  const team = (p) => p?.team || null;
  const who = (tok, prefer) => lookup(ctx.index, tok, prefer.filter(Boolean));
  const add = (p, role, pts, stat = {}, fallbackName, fallbackTeam) => {
    const key = p?.id || `name:${fallbackName}`;
    const cur = players.get(key) || {
      id: p?.id || null,
      name: p?.name || fallbackName || '',
      short: fallbackName || p?.name || '',
      team: p?.team || fallbackTeam || null,
      pos: p?.pos || '',
      headshot: p?.headshot || '',
      role, ppr: 0, stat: {},
    };
    cur.ppr = r2(cur.ppr + pts);
    for (const [k, v] of Object.entries(stat)) cur.stat[k] = (cur.stat[k] || 0) + v;
    players.set(key, cur);
    return cur;
  };
  const dst = (abbr, pts, stat) => abbr && add({ id: `DST-${abbr}`, name: `${abbr} D/ST`, team: abbr, pos: 'DST' }, 'defense', pts, stat);
  // Yards after a lateral count for the player who caught the lateral (and for the QB on pass plays)
  const addLaterals = (kind, qb, qbTok) => {
    const lats = [...main.matchAll(RX.lateral)];
    lats.forEach((lm, i) => {
      const ly = Number(lm[2]);
      const last = i === lats.length - 1;
      const scores = last && tdAfterLat;
      const p = who(lm[1], [offense]);
      if (kind === 'catch') {
        add(p, 'receiver', ly * 0.1 + (scores ? 6 : 0), { recYds: ly, recTd: scores ? 1 : 0 }, lm[1], offense);
        add(qb, 'passer', ly * 0.04, { passYds: ly }, qbTok, offense);
      } else {
        add(p, 'rusher', ly * 0.1 + (scores ? 6 : 0), { rushYds: ly, rushTd: scores ? 1 : 0 }, lm[1], offense);
      }
    });
  };

  // Yards from the first "for N yards" at or after a position in the text
  const yardsFrom = (idx = 0) => {
    const ym = main.slice(idx).match(RX.yards);
    return ym ? (ym[1] != null ? Number(ym[1]) : ym[2] != null ? -Number(ym[2]) : 0) : Number(raw.statYardage) || 0;
  };
  let yards = yardsFrom(0);
  let td = /TOUCHDOWN/.test(main) && !/TOUCHDOWN NULLIFIED/.test(main) && !out.nullified;
  const latIdx = main.search(/Lateral to /);
  const tdAfterLat = td && latIdx >= 0 && main.lastIndexOf('TOUCHDOWN') > latIdx;
  const fumIdx = main.search(/FUMBLES|MUFFS/);
  const tdAfterFum = td && fumIdx >= 0 && main.lastIndexOf('TOUCHDOWN') > fumIdx;
  let returner = null;
  const full = (name, prefer) => lookupFull(ctx.index, name, prefer.filter(Boolean));
  let summaryExtra = '';

  let m;
  if ((m = main.match(RX.altComplete))) {
    const qb = full(m[1], [offense]);
    const rec = full(m[3], [offense]);
    yards = Number(m[2]);
    out.kind = 'catch';
    out.headline = td ? `${yards}-yd TD catch` : `${yards}-yd catch`;
    if (!out.nullified) {
      add(rec, 'receiver', 1 + yards * 0.1 + (td ? 6 : 0), { rec: 1, tgt: 1, recYds: yards, recTd: td ? 1 : 0 }, m[3], offense);
      add(qb, 'passer', yards * 0.04 + (td ? 4 : 0), { cmp: 1, att: 1, passYds: yards, passTd: td ? 1 : 0 }, m[1], offense);
      if (m[4]) {
        const recBy = m[5] ? full(m[5], [defense, offense]) : null;
        if (!recBy || recBy.team !== offense) {
          add(rec, 'receiver', -2, { fumLost: 1 }, m[3], offense);
          dst(recBy?.team || defense, 2, { fumRec: 1 });
          out.headline = 'Fumble lost'; out.turnover = true;
        }
      }
    }
  } else if ((m = main.match(RX.sumPass))) {
    const rec = full(m[1], [offense]);
    const qb = full(m[3], [offense]);
    yards = Number(m[2]); td = true; summaryExtra = m[4] || '';
    out.kind = 'catch';
    out.headline = `${yards}-yd TD catch`;
    add(rec, 'receiver', 1 + yards * 0.1 + 6, { rec: 1, tgt: 1, recYds: yards, recTd: 1 }, m[1], offense);
    add(qb, 'passer', yards * 0.04 + 4, { cmp: 1, att: 1, passYds: yards, passTd: 1 }, m[3], offense);
  } else if ((m = main.match(RX.sumRun))) {
    const rb = full(m[1], [offense]);
    yards = Number(m[2]); td = true; summaryExtra = m[3] || '';
    out.kind = 'rush';
    out.headline = `${yards}-yd TD run`;
    add(rb, 'rusher', yards * 0.1 + 6, { car: 1, rushYds: yards, rushTd: 1 }, m[1], offense);
  } else if ((m = main.match(RX.sumRet))) {
    const what = m[3].toLowerCase();
    const scorer = full(m[1], [defense, offense]);
    yards = Number(m[2]); td = true; summaryExtra = m[4] || '';
    const takeaway = /interception|fumble/.test(what) && !/recovery$/.test(what);
    out.kind = takeaway ? (what.startsWith('interception') ? 'int' : 'fumble') : 'return_td';
    out.headline = what.startsWith('interception') ? 'Pick-six' : what.startsWith('fumble') ? 'Fumble return TD' : `${yards}-yd ${what.replace(/ return$/, '')} return TD`;
    const team = scorer?.team || (takeaway ? defense : null);
    if (team) dst(team, 6 + (takeaway ? 2 : 0), takeaway ? (what.startsWith('interception') ? { int: 1 } : { fumRec: 1 }) : {});
    if (!takeaway && scorer) add(scorer, 'returner', 6, { retTd: 1 }, m[1], scorer.team);
    out.defender = scorer?.name || m[1];
  } else if ((m = main.match(RX.sumFg))) {
    const k = full(m[1], [offense]);
    const dist = Number(m[2]);
    out.kind = 'fg_good';
    out.headline = `${dist}-yd FG good`;
    add(k, 'kicker', dist >= 50 ? 5 : dist >= 40 ? 4 : 3, { fgm: 1, fga: 1 }, m[1], offense);
    yards = 0;
  } else if ((m = main.match(RX.altIncomplete))) {
    out.kind = 'incomplete';
    out.headline = 'Incomplete pass';
    if (!out.nullified) {
      add(full(m[1], [offense]), 'passer', 0, { att: 1 }, m[1], offense);
      if (m[2]) add(full(m[2], [offense]), 'target', 0, { tgt: 1 }, m[2], offense);
    }
    yards = 0;
  } else if ((m = main.replace(/^.*?\d+ Yd Pnlty /i, '').match(RX.altRush))) {
    yards = Number(m[2]);
    out.kind = 'rush';
    out.headline = td ? `${yards}-yd TD run` : yards > 0 ? `${yards}-yd run` : yards === 0 ? 'Run, no gain' : `Run, loss of ${-yards}`;
    if (!out.nullified) add(full(m[1], [offense]), 'rusher', yards * 0.1 + (td ? 6 : 0), { car: 1, rushYds: yards, rushTd: td ? 1 : 0 }, m[1], offense);
  } else if ((m = main.match(RX.blocked))) {
    const what = m[1].toLowerCase();
    out.kind = 'blocked';
    out.headline = what === 'punt' ? 'Blocked punt' : what === 'field goal' ? 'Blocked FG' : 'Blocked extra point';
    if (!out.nullified) {
      dst(defense, 2, { blk: 1 });
      const rec = main.match(RX.recovered);
      if (td && rec) { dst(canonTeam(rec[1], ctx), 6, { stTd: 1 }); out.headline += ' returned for a TD'; }
    }
    yards = 0;
  } else if ((m = main.match(RX.fg))) {
    const k = who(m[1], [offense]);
    const dist = Number(m[2]);
    const good = /^good$/i.test(m[3]);
    out.kind = good ? 'fg_good' : 'fg_miss';
    out.headline = good ? `${dist}-yd FG good` : /blocked/i.test(m[3]) ? `${dist}-yd FG blocked` : `Missed ${dist}-yd FG`;
    if (!out.nullified) {
      add(k, 'kicker', good ? (dist >= 50 ? 5 : dist >= 40 ? 4 : 3) : -1, good ? { fgm: 1, fga: 1 } : { fga: 1 }, m[1], offense);
      if (/blocked/i.test(m[3])) dst(defense, 2, { blk: 1 });
    }
    yards = 0;
  } else if (RX.kickoff.test(main) || RX.punt.test(main)) {
    const isPunt = RX.punt.test(main);
    out.kind = isPunt ? 'punt' : 'kickoff';
    out.headline = isPunt ? 'Punt' : 'Kickoff';
    const rm = main.match(RX.returner);
    if (rm) returner = { tok: rm[1], p: who(rm[1], [defense]) };
    const rt = main.match(RX.returnTd);
    if (rt && td) {
      const ret = who(rt[1], [defense, offense]);
      out.headline = isPunt ? `${rt[2]}-yd punt return TD` : `${rt[2]}-yd kick return TD`;
      add(ret, 'returner', 6, { retTd: 1 }, rt[1], defense);
    }
    yards = 0;
  } else if (/^\s*(?:TWO-POINT CONVERSION ATTEMPT)/i.test(main)) {
    twoPtText = main; out.kind = 'two_pt'; out.headline = '2-pt try';
  } else if ((m = main.match(RX.int))) {
    const qb = who(m[1], [offense]);
    const tgt = m[2] ? who(m[2], [offense]) : null;
    const pick = who(m[3], [defense]);
    out.kind = 'int';
    out.headline = td ? 'Pick-six' : 'Interception';
    if (!out.nullified) {
      add(qb, 'passer', -2, { att: 1, int: 1 }, m[1], offense);
      if (tgt || m[2]) add(tgt, 'target', 0, { tgt: 1 }, m[2], offense);
      dst(defense, 2 + (td ? 6 : 0), { int: 1 });
      if (pick) out.defender = pick.name; else out.defender = m[3];
    }
    yards = 0;
  } else if ((m = main.match(RX.spike))) {
    out.kind = 'spike';
    out.headline = 'Spike';
    add(who(m[1], [offense]), 'passer', 0, { att: 1 }, m[1], offense);
    yards = 0;
  } else if ((m = main.match(RX.sack))) {
    const qb = who(m[1], [offense]);
    out.kind = 'sack';
    out.headline = yards < 0 ? `Sacked, loss of ${-yards}` : 'Sack';
    if (!out.nullified) { add(qb, 'passer', 0, { sacked: 1 }, m[1], offense); dst(defense, 1, { sack: 1 }); }
  } else if ((m = main.match(RX.incomplete))) {
    const qb = who(m[1], [offense]);
    const tgt = m[4] ? who(m[4], [offense]) : null;
    out.kind = 'incomplete';
    out.depth = [m[2], m[3]].filter(Boolean).join(' ');
    out.headline = m[2] === 'deep' ? 'Incomplete deep pass' : 'Incomplete pass';
    if (!out.nullified) {
      add(qb, 'passer', 0, { att: 1 }, m[1], offense);
      if (m[4]) add(tgt, 'target', 0, { tgt: 1 }, m[4], offense);
    }
    yards = 0;
  } else if ((m = main.match(RX.complete)) && /\bfor\b/.test(main)) {
    const qb = who(m[1], [offense]);
    const rec = who(m[4], [offense]);
    out.kind = 'catch';
    out.depth = [m[2], m[3]].filter(Boolean).join(' ');
    yards = creditedYards(yardsFrom(m.index), main, raw, offense, ctx);
    const recTd = td && !tdAfterLat && !tdAfterFum;
    out.headline = recTd ? `${yards}-yd TD catch` : yards >= 0 ? `${yards}-yd catch` : `Catch, loss of ${-yards}`;
    if (!out.nullified) {
      // Receiver first so the card leads with them (like Real)
      add(rec, 'receiver', 1 + yards * 0.1 + (recTd ? 6 : 0), { rec: 1, tgt: 1, recYds: yards, recTd: recTd ? 1 : 0 }, m[4], offense);
      add(qb, 'passer', yards * 0.04 + (td && !tdAfterFum ? 4 : 0), { cmp: 1, att: 1, passYds: yards, passTd: td && !tdAfterFum ? 1 : 0 }, m[1], offense);
      addLaterals('catch', qb, m[1]);
    }
  } else if ((m = main.match(RX.rush)) && (RX.yards.test(main) || /kneels/.test(main))) {
    const rb = who(m[1], [offense]);
    const scramble = /scrambles/.test(m[2]);
    yards = creditedYards(yardsFrom(m.index), main, raw, offense, ctx);
    out.kind = 'rush';
    if (/kneels/.test(m[2])) out.headline = 'QB kneel';
    else if (td) out.headline = `${yards}-yd TD ${scramble ? 'scramble' : 'run'}`;
    else if (yards > 0) out.headline = `${yards}-yd ${scramble ? 'scramble' : 'run'}`;
    else if (yards === 0) out.headline = 'Run, no gain';
    else out.headline = `Run, loss of ${-yards}`;
    const rushTd = td && !tdAfterLat && !tdAfterFum;
    if (!out.nullified) {
      add(rb, 'rusher', yards * 0.1 + (rushTd ? 6 : 0), { car: 1, rushYds: yards, rushTd: rushTd ? 1 : 0 }, m[1], offense);
      addLaterals('rush');
    }
  } else if ((m = main.match(RX.runTo)) && !/kicks|punts/.test(main.slice(0, m.index))) {
    const rb = who(m[1], [offense]);
    yards = creditedYards(yardsFrom(m.index), main, raw, offense, ctx);
    const rushTd = td && !tdAfterFum;
    out.kind = 'rush';
    out.headline = rushTd ? `${yards}-yd TD run` : yards > 0 ? `${yards}-yd run` : yards === 0 ? 'Run, no gain' : `Run, loss of ${-yards}`;
    if (!out.nullified) add(rb, 'rusher', yards * 0.1 + (rushTd ? 6 : 0), { car: 1, rushYds: yards, rushTd: rushTd ? 1 : 0 }, m[1], offense);
  } else if ((m = main.match(RX.aborted))) {
    out.kind = 'aborted';
    out.headline = 'Aborted snap';
    add(who(m[1], [offense]), 'rusher', 0, { car: 1, rushYds: 0 }, m[1], offense);
    yards = 0;
  } else if (/penalty/i.test(typeText) || /^PENALTY/i.test(main)) {
    out.kind = 'penalty';
    const pm = main.match(RX.penalty);
    out.headline = pm ? `Penalty: ${pm[2].trim()}` : 'Penalty';
    yards = 0;
  } else if (/safety/i.test(typeText)) {
    out.kind = 'safety'; out.headline = 'Safety';
  } else {
    out.headline = typeText || 'Play';
  }

  // Fumbles (can ride on top of a run/catch/sack/return)
  const fm = main.match(RX.fumble);
  if (fm && !out.nullified && out.kind !== 'int') {
    // Fumbler: named right before "FUMBLES", else the returner on kicks, else the ball carrier
    const named = main.match(RX.fumbler);
    // After a lateral, the ball carrier is whoever caught the last lateral before the fumble
    const latBefore = [...main.matchAll(RX.lateral)].filter((lm) => lm.index < fumIdx).pop();
    const latP = latBefore && who(latBefore[1], [offense]);
    const latCarrier = latP && [...players.values()].find((p) => (latP.id ? p.id === latP.id : p.short === latBefore[1]) && ['rusher', 'receiver'].includes(p.role));
    const carrier = latCarrier || [...players.values()].find((p) => ['rusher', 'receiver'].includes(p.role) && p.team === offense)
      || [...players.values()].find((p) => p.role === 'passer');
    let fumbler, fumblerTok, fumblerTeam;
    if (named) { fumbler = who(named[1], [offense, defense]); fumblerTok = named[1]; }
    else if (returner) { fumbler = returner.p; fumblerTok = returner.tok; fumblerTeam = defense; }
    else { fumbler = carrier; fumblerTok = carrier?.short; }
    fumblerTeam = fumbler?.team || fumblerTeam || offense;
    const recTeam = canonTeam(fm[1], ctx);

    // Official stats take yards back off the carrier when the ball goes backward before it's recovered
    if (carrier && fumbler && (fumbler.id ? fumbler.id === carrier.id : fumblerTok === carrier.short) && ['rusher', 'receiver'].includes(carrier.role)) {
      const before = [...main.slice(0, fumIdx).matchAll(/ to (?:([A-Z]{2,3}) )?(-?\d+)/g)].pop();
      const after = main.slice(fumIdx).match(/(?:touched|recovered|RECOVERED)[^,]*? at (?:([A-Z]{2,3}) )?(-?\d+)/);
      if (before && after) {
        const back = spotYte(after[1], after[2], offense, ctx) - spotYte(before[1], before[2], offense, ctx);
        if (back > 0 && back < 40) {
          const k = carrier.role === 'receiver' ? 'recYds' : 'rushYds';
          add(carrier, carrier.role, -back * 0.1, { [k]: -back }, carrier.short, carrier.team);
          const qb = carrier.role === 'receiver' && [...players.values()].find((p) => p.role === 'passer');
          if (qb) add(qb, 'passer', -back * 0.04, { passYds: -back }, qb.short, qb.team);
          yards -= back;
        }
      }
    }

    if (recTeam && fumblerTeam && recTeam !== fumblerTeam) {
      add(fumbler && fumbler.id ? fumbler : null, (fumbler && players.get(fumbler.id)?.role) || (returner ? 'returner' : 'fumbler'), -2, { fumLost: 1 },
        fumblerTok, fumblerTeam);
      const defTd = tdAfterFum;
      dst(recTeam, 2 + (defTd ? 6 : 0), { fumRec: 1 });
      out.headline = defTd ? 'Fumble return TD' : /MUFFS/.test(main) ? 'Muffed punt lost' : 'Fumble lost';
      if (out.kind === 'other') out.kind = 'fumble';
      out.turnover = true;
    }
  }
  if (/SAFETY/.test(main) && defense && !out.nullified) dst(defense, 2, { safety: 1 });

  // PAT on the same play
  const pat = main.match(RX.pat);
  if (pat && !out.nullified) {
    const k = who(pat[1], [offense, defense]);
    const good = /^good$/i.test(pat[2]);
    add(k, 'kicker', good ? 1 : -1, good ? { xpm: 1, xpa: 1 } : { xpa: 1 }, pat[1], team(k) || offense);
    out.tags.push(good ? { icon: '🟢', text: 'Extra point is good' } : { icon: '🔴', text: 'Extra point missed' });
    if (out.kind === 'other') out.headline = good ? 'Extra point good' : 'Extra point missed';
  }

  // Extra point / 2-pt try written in scoring-summary style: "(Zane Gonzalez Kick)"
  if (summaryExtra) {
    const scorerTeam = out.players.find((p) => p.pos !== 'DST')?.team || offense;
    let sm;
    if ((sm = summaryExtra.match(/^(.+?) (?:Kick|PAT)$/i))) {
      add(full(sm[1], [scorerTeam]), 'kicker', 1, { xpm: 1, xpa: 1 }, sm[1], scorerTeam);
      out.tags.push({ icon: '🟢', text: 'Extra point is good' });
    } else if ((sm = summaryExtra.match(/^(.+?) (?:PAT|Kick) (?:blocked|failed|missed|no good)/i))) {
      add(full(sm[1], [scorerTeam]), 'kicker', -1, { xpa: 1 }, sm[1], scorerTeam);
      out.tags.push({ icon: '🔴', text: 'Extra point missed' });
    } else if ((sm = summaryExtra.match(/^(.+?) Pass to (.+?) for Two-Point Conversion/i))) {
      add(full(sm[1], [scorerTeam]), 'passer', 2, { twoPt: 1 }, sm[1], scorerTeam);
      add(full(sm[2], [scorerTeam]), 'receiver', 2, { twoPt: 1 }, sm[2], scorerTeam);
      out.tags.push({ icon: '🟢', text: '2-pt conversion good' });
    } else if ((sm = summaryExtra.match(/^(.+?) (?:Run|Rush) for Two-Point Conversion/i))) {
      add(full(sm[1], [scorerTeam]), 'rusher', 2, { twoPt: 1 }, sm[1], scorerTeam);
      out.tags.push({ icon: '🟢', text: '2-pt conversion good' });
    } else if (/Two-Point .*Failed/i.test(summaryExtra)) {
      out.tags.push({ icon: '🔴', text: '2-pt conversion failed' });
    }
  }

  // Two-point try (separate section of the text)
  if (twoPtText) {
    const ok = /SUCCEEDS/i.test(twoPtText);
    const pp = twoPtText.match(RX.twoPtPass);
    const pr = twoPtText.match(RX.twoPtRush);
    if (ok && pp) {
      add(who(pp[1], [offense]), 'passer', 2, { twoPt: 1 }, pp[1], offense);
      if (pp[2]) add(who(pp[2], [offense]), 'receiver', 2, { twoPt: 1 }, pp[2], offense);
    } else if (ok && pr) {
      add(who(pr[1], [offense]), 'rusher', 2, { twoPt: 1 }, pr[1], offense);
    }
    out.tags.push({ icon: ok ? '🟢' : '🔴', text: ok ? '2-pt conversion good' : '2-pt conversion failed' });
    if (out.kind === 'two_pt') out.headline = ok ? '2-pt conversion good' : '2-pt conversion failed';
  }

  out.yards = yards;
  out.players = [...players.values()];
  // The play's headline number: what the featured player (catcher, runner, kicker...) scored
  const featured = out.players.find((p) => p.pos !== 'DST' && p.role !== 'target') || out.players.find((p) => p.pos !== 'DST') || out.players[0];
  out.ppr = featured ? featured.ppr : 0;
  out.td = td;
  if (td && !out.scoring) out.scoring = true;
  if (out.kind === 'fg_good') out.scoring = true;

  // ---------- analytics tags ----------
  if (out.nullified) out.tags.unshift({ icon: '🚫', text: 'No play: penalty' });
  if (!out.nullified && (out.kind === 'catch' || out.kind === 'rush')) {
    if (out.down && !td && yards >= out.distance && out.distance > 0) out.tags.unshift({ icon: '✅', text: '1st down' });
    if ((out.kind === 'rush' && yards >= 10) || (out.kind === 'catch' && yards >= 20)) {
      out.explosive = true;
      out.tags.push({ icon: '💥', text: `Explosive ${out.kind === 'rush' ? 'run' : 'pass'}` });
    }
  }
  if (out.depth) out.tags.push({ icon: '🎯', text: `Thrown ${out.depth}` });
  if (out.yte != null && out.yte <= 20 && out.yte > 0 && ['catch', 'rush', 'incomplete', 'int', 'sack'].includes(out.kind)) {
    out.tags.push({ icon: '🔺', text: out.yte <= 5 ? 'Goal line' : 'Red zone' });
  }

  // EPA estimate (scrimmage plays only)
  if (['catch', 'rush', 'incomplete', 'int', 'sack', 'fumble', 'fg_good', 'fg_miss', 'punt'].includes(out.kind) && !out.nullified) {
    const before = ep(out.down, out.distance, out.yte);
    let after = null;
    const endTeam = ctx.teamsById[raw.end?.team?.id];
    if (td) after = out.turnover || out.kind === 'int' ? -7 : 7;
    else if (out.kind === 'fg_good') after = 3;
    else if (out.kind === 'fg_miss') after = -(ep(1, 10, Math.min(80, 100 - (out.yte + 7))) ?? 0);
    else if (raw.end && raw.end.yardsToEndzone != null && raw.end.down) {
      const e = ep(raw.end.down, raw.end.distance, raw.end.yardsToEndzone);
      if (e != null) after = endTeam && endTeam !== offense ? -e : e;
    }
    if (before != null && after != null) out.epa = Math.round((after - before) * 10) / 10;
  }
  return out;
}

// College play text is written a little differently from NFL text, e.g.
// "(07:20) Shotgun #8 J.Gutierrez rush middle for 0 yards to the NotreD21".
// Rewrite it into the NFL wording the patterns above already understand.
function collegeText(text) {
  let t = String(text || '');
  t = t.replace(/^\(\d{1,2}:\d{2}\)\s*/, '');                       // leading clock
  t = t.replace(/#\d{1,2}\s+(?=[A-Z])/g, '');                          // jersey numbers
  t = t.replace(new RegExp(`(${N}),? (?:Jr\\.?|Sr\\.?|II|III|IV|V)(?=[ ,.;)])`, 'g'), '$1');   // name suffixes
  t = t.replace(new RegExp(`(${N}) rush (left|middle|right)`, 'g'), (m, who, dir) => `${who} ${dir === 'middle' ? 'up the middle' : `${dir} end`}`);
  t = t.replace(new RegExp(`(${N}) rush\\b`, 'g'), '$1 rushes');
  t = t.replace(/ pass complete /g, ' pass ');
  t = t.replace(/ pass complete$/g, ' pass');
  t = t.replace(/ pass intercepted /gi, ' pass INTERCEPTED ');
  t = t.replace(/ (?:yards?|yd) gain\b/g, (m) => m.replace(/ gain$/, ''));
  t = t.replace(/ for a (\d+) yard loss/g, ' for a loss of $1 yards');
  t = t.replace(new RegExp(`(${N}) field goal attempt from (\\d+) yards? (GOOD|MISSED|BLOCKED|NO GOOD)`, 'i'),
    (m, who, yds, res) => `${who} ${yds} yard field goal is ${/good/i.test(res) && !/no/i.test(res) ? 'GOOD' : /block/i.test(res) ? 'BLOCKED' : 'No Good'}`);
  t = t.replace(new RegExp(`(${N}) (?:extra point|PAT|kick attempt|KICK)(?: attempt)? (GOOD|good|MISSED|missed|NO GOOD|no good|BLOCKED|blocked)`),
    (m, who, res) => `${who} extra point is ${/^good$/i.test(res) ? 'GOOD' : /block/i.test(res) ? 'BLOCKED' : 'No Good'}`);
  t = t.replace(/ fumbled,? recovered by ([A-Z]{2,4})/gi, ' FUMBLES, RECOVERED by $1-');
  t = t.replace(/ for a TD\b/gi, ', TOUCHDOWN');
  t = t.replace(/(\d+) yds\b/g, '$1 yards').replace(/(\d+) yd\b/g, '$1 yard');
  return t;
}

module.exports = { parsePlay, rosterIndex, lookup, lookupFull, canonTeam, collegeText, RX, N };
