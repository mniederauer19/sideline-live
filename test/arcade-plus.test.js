// Props grading, card rarity tiers and levels
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sl-plus-')), 'test.db');
const db = require('../src/db');
const engine = require('../src/engine');
const plus = require('../src/arcade-plus');

test('Prop lines sit on the half point', () => {
  assert.equal(plus.half(74.2), 74.5);
  assert.equal(plus.half(7.35), 7.5);
  assert.equal(plus.half(18), 18.5);
});

test('Props: a leg is graded only when the game is final; a player who didn\'t play is voided', () => {
  engine.games.set('g9', { id: 'g9', state: 'in', home: { abbr: 'DET' }, away: { abbr: 'GB' } });
  engine.getGS('g9').box.set('11', { id: '11', ppr: 22.4, s: { recYds: 81, rec: 6 } });
  const leg = { pid: '11', stat: 'recYds', line: 74.5, side: 'more', gameId: 'g9' };
  let r = plus.legState(leg);
  assert.equal(r.result, null); assert.equal(r.trend, 'up'); assert.equal(r.now, 81);
  engine.games.get('g9').state = 'post';
  assert.equal(plus.legState(leg).result, 'hit');
  assert.equal(plus.legState({ ...leg, side: 'less' }).result, 'miss');
  assert.equal(plus.legState({ ...leg, pid: '99' }).result, 'void');
});

test('Props: a 2-pick slip that hits pays +60 and gives a pack', () => {
  db.prepare("INSERT INTO users (id, name, token, credits, created_at) VALUES (5, 'p', 't5', 1000, 0)").run();
  engine.getGS('g9').box.set('12', { id: '12', ppr: 9.1, s: { rushYds: 40 } });
  const legs = [{ pid: '11', stat: 'rec', line: 5.5, side: 'more', gameId: 'g9' }, { pid: '12', stat: 'rushYds', line: 55.5, side: 'less', gameId: 'g9' }];
  db.prepare('INSERT INTO prop_slips (user_id, season, week, legs, created_at) VALUES (5, 2026, 8, ?, 0)').run(JSON.stringify(legs));
  plus._settleSlips();
  const s = db.prepare('SELECT result, credits_delta FROM prop_slips').get();
  assert.equal(s.result, 'win'); assert.equal(s.credits_delta, 60);
  assert.equal(db.prepare('SELECT credits FROM users WHERE id=5').get().credits, 1060);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM packs WHERE user_id=5 AND source='props'").get().n, 1);
});

test('Cards: the top 5 plays are legendary, then 10 epic, 15 rare, the rest common', () => {
  assert.deepEqual([0, 4, 5, 14, 15, 29, 30, 59].map(plus.TIER), ['legendary', 'legendary', 'epic', 'epic', 'rare', 'rare', 'common', 'common']);
});

test('Levels grow with XP', () => {
  assert.equal(plus.levelOf(0), 1);
  assert.equal(plus.levelOf(40), 2);
  assert.equal(plus.levelOf(159), 2);
  assert.equal(plus.levelOf(160), 3);
  assert.equal(plus.xpFor(5), 640);
});

test('Hype: touchdowns count most, and the meter cools off', () => {
  const fun = require('../src/arcade-fun');
  const td = fun.playWeight({ td: true, explosive: true, yards: 45, players: [{ ppr: 10.5, role: 'receiver' }] });
  const run = fun.playWeight({ yards: 3, players: [{ ppr: 0.3, role: 'rusher' }] });
  assert.ok(td > 50 && run < 5, `${td} vs ${run}`);
  engine.games.set('h1', { id: 'h1', state: 'in', week: null, home: { abbr: 'A' }, away: { abbr: 'B' } });
});
