// 17-0: spins repeat for the same seed, team names follow the era, and the season is reproducible
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path'); const fs = require('fs');
process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sl-17-')), 'test.db');
const S = require('../src/seventeen');

test('seasons from 1970 to 2025, every team with a QB', () => {
  assert.equal(S.YEARS[0], 1970);
  assert.ok(S.YEARS.includes(2025));
  assert.ok(S.teamsIn(1970).length >= 26 && S.teamsIn(2025).length === 32);
  assert.ok(S.roster('CHI', 1977).players.some((p) => p.name === 'Walter Payton'));
});
test('team names follow the era', () => {
  assert.equal(S.eraName('IND', 1975), 'Baltimore Colts');
  assert.equal(S.eraName('TEN', 1990), 'Houston Oilers');
  assert.equal(S.eraName('LV', 1985), 'Los Angeles Raiders');
  assert.equal(S.eraName('LAR', 2001), 'St. Louis Rams');
  assert.equal(S.eraName('ARI', 1980), 'St. Louis Cardinals');
  assert.equal(S.eraName('LAC', 2010), 'San Diego Chargers');
});
test('the same seed gives the same spins; franchise mode stays on one team', () => {
  assert.deepEqual(S.spins('daily', '2026-11-03'), S.spins('daily', '2026-11-03'));
  const f = S.spins('franchise', 'x');
  assert.ok(f.rounds.every((r) => r.team === f.franchise && !r.altTeam));
  assert.equal(new Set(f.rounds.map((r) => r.year)).size, S.ROUNDS);
});
test('a season is 14 regular weeks then up to 3 playoff games; the same lineup + seed plays out the same', () => {
  const ro = S.roster('LAR', 1999);
  const lineup = ro.players.slice(0, 6).map((p) => ({ ...p, games: ro.games }));
  const a = S.simulate(lineup, 's'), b = S.simulate(lineup, 's');
  assert.deepEqual(a, b);
  for (let i = 0; i < 300; i++) {
    const x = S.simulate(lineup, `t${i}`);
    const reg = x.weeks.filter((w) => w.stage === 'reg'), po = x.weeks.filter((w) => w.stage !== 'reg');
    assert.equal(reg.length, 14); assert.equal(x.wins + x.losses, x.weeks.length);
    if (x.playoff === 'missed') assert.equal(po.length, 0);
    else { assert.ok(x.seed <= 8); assert.deepEqual(po.map((w) => w.stage), ['qf', 'sf', 'final'].slice(0, po.length)); assert.ok(po.slice(0, -1).every((w) => w.win)); }
    if (x.champ) assert.ok(po.length === 3 && po.every((w) => w.win));
    if (x.wins === 17) assert.ok(x.champ && x.losses === 0);
  }
});
test('decades: a team + decade, each player once with his best season', () => {
  const sp = S.spins('decades', 'z');
  assert.ok(sp.rounds.every((r) => r.decade && S.DECADES.includes(r.year)));
  const ro = S.roster('SF', 1980, true);
  assert.equal(ro.name, '1980s 49ers');
  const names = ro.players.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(ro.players.every((p) => p.year >= 1980 && p.year <= 1989));
  assert.equal(S.roster('IND', 1970, true).name, '1970s Colts');
});
