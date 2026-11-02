// The Arcade's rules: Call It grading, aura, the House lineup, days in Eastern time
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sl-arcade-')), 'test.db');
const db = require('../src/db');
const engine = require('../src/engine');
const arcade = require('../src/arcade');

const play = (o) => ({ id: 'p', gameId: 'g1', kind: 'rush', players: [], tags: [], yards: 0, ...o });

test('Call It: what each play counts as', () => {
  assert.equal(arcade.callCategory(play({ kind: 'rush' })), 'run');
  assert.equal(arcade.callCategory(play({ kind: 'catch', depth: 'short right', yards: 45 })), 'short');
  assert.equal(arcade.callCategory(play({ kind: 'incomplete', depth: 'deep left' })), 'deep');
  assert.equal(arcade.callCategory(play({ kind: 'catch', yards: 24 })), 'deep');
  assert.equal(arcade.callCategory(play({ kind: 'int', depth: 'short middle' })), 'short');
  assert.equal(arcade.callCategory(play({ kind: 'sack' })), 'void');
  assert.equal(arcade.callCategory(play({ kind: 'punt' })), 'void');
  assert.equal(arcade.callCategory(play({ kind: 'other', headline: 'Extra point good' })), 'void');
  assert.equal(arcade.callCategory(play({ kind: 'penalty' })), 'skip');
  assert.equal(arcade.callCategory(play({ kind: 'rush', nullified: true })), 'skip');
  assert.equal(arcade.opensWindow(play({ kind: 'rush' })), true);
  assert.equal(arcade.opensWindow(play({ kind: 'rush', td: true, scoring: true })), false);
  assert.equal(arcade.opensWindow(play({ kind: 'kickoff' })), true);
  assert.equal(arcade.opensWindow(play({ kind: 'other', headline: 'Extra point good' })), false);
});

test('Call It: a call made before the snap is graded and paid; a late one is voided', () => {
  const now = Date.now();
  engine.games.set('g1', { id: 'g1', state: 'in', home: { abbr: 'GB' }, away: { abbr: 'CAR' }, week: 1 });
  db.prepare("INSERT INTO users (id, name, token, credits, created_at) VALUES (1, 'a', 't1', 1000, 0), (2, 'b', 't2', 1000, 0)").run();
  arcade._onPlay(play({ id: 'p1', kind: 'rush' }));
  assert.ok(arcade._windows.get('g1'), 'a window opens after a run');
  db.prepare("INSERT INTO callit (user_id, game_id, win, choice, created_at) VALUES (1, 'g1', 'p1', 'deep', ?), (2, 'g1', 'p1', 'run', ?)").run(now - 15000, now - 1000);
  const p2 = play({ id: 'p2', kind: 'catch', depth: 'deep right', yards: 31, headline: '31-yd catch' });
  db.prepare("INSERT INTO plays (id, game_id, seq, ts, hash, data) VALUES ('p2', 'g1', 2, ?, 'h', ?)").run(now, JSON.stringify(p2));
  arcade._onPlay(p2);
  arcade._grade('p2', 'g1');
  const rows = Object.fromEntries(db.prepare('SELECT user_id, result, credits_delta FROM callit').all().map((r) => [r.user_id, r]));
  assert.equal(rows[1].result, 'win');
  assert.equal(rows[1].credits_delta, 5);
  assert.equal(rows[2].result, 'void', 'called 1 second before the play posted: too late');
  assert.equal(db.prepare('SELECT credits FROM users WHERE id=1').get().credits, 1005);
});

test('Aura: big moments up, mistakes down', () => {
  const td = { id: '1', role: 'receiver', stat: { rec: 1, recYds: 45, recTd: 1 } };
  assert.equal(arcade.auraOf(td, { explosive: true, yards: 45 }), 200);
  assert.equal(arcade.auraOf({ id: '2', role: 'passer', stat: { int: 1 } }, {}), -100);
  assert.equal(arcade.auraOf({ id: '3', role: 'kicker', stat: { fga: 1, fgm: 1 } }, { text: 'J.Bates 54 yard field goal is GOOD' }), 60);
  assert.equal(arcade.auraOf({ id: '4', pos: 'DST', stat: { int: 1 } }, {}), 0);
});

test('The House: most projected points that fit under the cap', () => {
  const P = (id, pos, salary, proj) => ({ id, name: id, pos, team: 'X', salary, proj });
  const players = [P('q1', 'QB', 9000, 24), P('q2', 'QB', 6000, 20), P('r1', 'RB', 9000, 22), P('r2', 'RB', 8000, 19), P('r3', 'RB', 4000, 13), P('r4', 'RB', 3000, 10),
    P('w1', 'WR', 9000, 21), P('w2', 'WR', 7000, 17), P('w3', 'WR', 5000, 14), P('w4', 'WR', 3000, 9), P('t1', 'TE', 6000, 14), P('t2', 'TE', 3000, 8)];
  const slots = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX'];
  const SP = { QB: ['QB'], RB1: ['RB'], RB2: ['RB'], WR1: ['WR'], WR2: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'] };
  const l = arcade.bestLineup(players, 40000, slots, SP);
  assert.equal(l.length, 7);
  assert.ok(l.reduce((a, p) => a + p.salary, 0) <= 40000);
  assert.equal(new Set(l.map((p) => p.id)).size, 7);
  assert.ok(l.reduce((a, p) => a + p.proj, 0) >= 105, 'close to the best possible');
});

test('Days follow Eastern time', () => {
  const t = Date.parse('2026-11-03T03:30:00Z'); // 10:30pm ET on Nov 2
  assert.equal(arcade.etDay(t), '2026-11-02');
  assert.equal(arcade.etDayStart('2026-11-02'), Date.parse('2026-11-02T05:00:00Z'));
  assert.equal(arcade.etDayStart('2026-10-15'), Date.parse('2026-10-15T04:00:00Z'));
  assert.equal(arcade.addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(arcade.divOf('WSH'), 'NFC East');
});
