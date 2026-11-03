// Builds src/data/seasons.json for the 17-0 game: every team's QB/RB/WR/TE seasons from 1970 on,
// in PPR, with an era-adjusted points-per-game so a 1977 season compares fairly with a 2023 one.
//   node scripts/build-seasons.js <folder>
// <folder> holds fantasydatapros/data's yearly/<year>.csv (1970-1998) and nflverse's
// stats_player_reg_<year>.csv saved as reg_<year>.csv (1999 on).
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/build-seasons.js <folder>'); process.exit(1); }

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}
const n = (v) => (v === '' || v == null || isNaN(Number(v)) ? 0 : Number(v));
const seasonGames = (y) => (y <= 1977 ? 14 : y === 1982 ? 9 : y === 1987 ? 15 : y <= 2020 ? 16 : 17);

// Old team codes -> today's franchise
function franchise(code, y) {
  const m = { GNB: 'GB', KAN: 'KC', NOR: 'NO', SFO: 'SF', TAM: 'TB', SDG: 'LAC', SD: 'LAC', NWE: 'NE', BOS: 'NE', RAI: 'LV', OAK: 'LV', RAM: 'LAR', LA: 'LAR', PHO: 'ARI', WSH: 'WAS' };
  if (code === 'BAL' && y <= 1983) return 'IND';
  if (code === 'HOU' && y <= 1996) return 'TEN';
  if (code === 'STL') return y <= 1987 ? 'ARI' : 'LAR';
  return m[code] || code;
}
const keep = { QB: 3, RB: 5, WR: 6, TE: 3 };
const out = {};
function add(y, team, p) {
  if (!['QB', 'RB', 'WR', 'TE'].includes(p.pos) || p.g < 1 || p.ppr < 8) return;
  const t = ((out[y] ||= {})[team] ||= []);
  t.push(p);
}
const ppr = (s) => s.py * 0.04 + s.ptd * 4 - s.int * 2 + s.ry * 0.1 + s.rtd * 6 + s.rec + s.recy * 0.1 + s.rectd * 6 - s.fl * 2 + (s.two || 0) * 2;

for (let y = 1970; y <= 1998; y++) {
  const rows = parseCsv(fs.readFileSync(path.join(dir, 'fdp', 'yearly', `${y}.csv`), 'utf8'));
  const h = rows[0], ix = (k) => h.indexOf(k);
  for (const r of rows.slice(1)) {
    const tm = r[ix('Tm')];
    if (/\dTM/.test(tm)) continue; // traded mid-season: no single team to put him on
    let pos = String(r[ix('Pos')] || '').toUpperCase();
    if (pos === 'FB' || pos === 'HB') pos = 'RB';
    const s = { py: n(r[ix('PassingYds')]), ptd: n(r[ix('PassingTD')]), int: n(r[ix('Int')]), ry: n(r[ix('RushingYds')]), rtd: n(r[ix('RushingTD')]),
      rec: n(r[ix('Rec')]), recy: n(r[ix('ReceivingYds')]), rectd: n(r[ix('ReceivingTD')]), fl: n(r[ix('FumblesLost')]) };
    add(y, franchise(tm, y), { name: String(r[ix('Player')]).replace(/[*+]/g, '').trim(), pos, g: n(r[ix('G')]), ppr: ppr(s), s });
  }
}
for (let y = 1999; y <= 2025; y++) {
  const f = path.join(dir, `reg_${y}.csv`);
  if (!fs.existsSync(f)) continue;
  const rows = parseCsv(fs.readFileSync(f, 'utf8'));
  const h = rows[0], ix = (k) => h.indexOf(k);
  for (const r of rows.slice(1)) {
    let pos = String(r[ix('position')] || '').toUpperCase();
    if (pos === 'FB') pos = 'RB';
    const s = { py: n(r[ix('passing_yards')]), ptd: n(r[ix('passing_tds')]), int: n(r[ix('passing_interceptions')]), ry: n(r[ix('rushing_yards')]), rtd: n(r[ix('rushing_tds')]),
      rec: n(r[ix('receptions')]), recy: n(r[ix('receiving_yards')]), rectd: n(r[ix('receiving_tds')]),
      fl: n(r[ix('rushing_fumbles_lost')]) + n(r[ix('receiving_fumbles_lost')]) + n(r[ix('sack_fumbles_lost')]),
      two: n(r[ix('passing_2pt_conversions')]) * 0 + n(r[ix('rushing_2pt_conversions')]) + n(r[ix('receiving_2pt_conversions')]) };
    const p = n(r[ix('fantasy_points_ppr')]) || ppr(s);
    add(y, franchise(r[ix('recent_team')], y), { name: r[ix('player_display_name')], pos, g: n(r[ix('games')]), ppr: p, s });
  }
}

// Era adjustment: points per game against the average starter at that position that season
const TOPN = { QB: 12, RB: 24, WR: 24, TE: 12 };
const base = {};
for (const [y, teams] of Object.entries(out)) {
  const all = Object.values(teams).flat();
  base[y] = {};
  for (const pos of Object.keys(TOPN)) {
    const top = all.filter((p) => p.pos === pos && p.g >= seasonGames(+y) / 2).sort((a, b) => b.ppr - a.ppr).slice(0, TOPN[pos]);
    base[y][pos] = top.length ? top.reduce((a, p) => a + p.ppr / p.g, 0) / top.length : 10;
  }
}
const modern = {};
for (const pos of Object.keys(TOPN)) { const ys = [2015, 2016, 2017, 2018, 2019, 2021, 2022, 2023, 2024]; modern[pos] = +(ys.reduce((a, y) => a + base[y][pos], 0) / ys.length).toFixed(2); }

const seasons = {};
for (const [y, teams] of Object.entries(out)) {
  seasons[y] = { g: seasonGames(+y), teams: {} };
  for (const [team, list] of Object.entries(teams)) {
    const rows = [];
    for (const pos of Object.keys(keep)) {
      for (const p of list.filter((x) => x.pos === pos).sort((a, b) => b.ppr - a.ppr).slice(0, keep[pos])) {
        const adj = (p.ppr / p.g) * modern[pos] / base[y][pos];
        const s = p.s;
        rows.push([p.name, pos, p.g, +p.ppr.toFixed(1), +adj.toFixed(2), s.py, s.ptd, s.int, s.ry, s.rtd, s.rec, s.recy, s.rectd]);
      }
    }
    if (rows.some((r) => r[1] === 'QB')) seasons[y].teams[team] = rows;
  }
}
const file = path.join(__dirname, '..', 'src', 'data', 'seasons.json');
fs.writeFileSync(file, JSON.stringify({ built: new Date().toISOString().slice(0, 10), cols: ['name', 'pos', 'g', 'ppr', 'adj', 'passYds', 'passTd', 'int', 'rushYds', 'rushTd', 'rec', 'recYds', 'recTd'], modern, seasons }));
console.log('years', Object.keys(seasons).length, 'team-seasons', Object.values(seasons).reduce((a, s) => a + Object.keys(s.teams).length, 0), 'bytes', fs.statSync(file).size, 'modern', modern);
