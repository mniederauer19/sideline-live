// Who gets charged with a fumble. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const { parsePlay, rosterIndex } = require('../src/parse.js');

const index = rosterIndex([
  { id: '1', name: 'Bryce Young', team: 'CAR' }, { id: '2', name: 'Tetairoa McMillan', team: 'CAR' }, { id: '3', name: 'Jalen Coker', team: 'CAR' },
  { id: '4', name: 'Christian Watson', team: 'GB' }, { id: '5', name: 'Jordan Love', team: 'GB' }, { id: '6', name: 'Josh Jacobs', team: 'GB' }, { id: '9', name: 'Brenton Cox', team: 'GB' },
]);
const ctx = { gameId: 'g', teamsById: { c: 'CAR', g: 'GB' }, homeAbbr: 'GB', awayAbbr: 'CAR', index };
const play = (text, team) => parsePlay({ id: 'x', text, type: { text: 'Pass Reception' }, start: { team: { id: team }, yardsToEndzone: 70 } }, ctx);
const lost = (p) => p.players.filter((x) => x.stat.fumLost).map((x) => x.name);

test('fumble after a lateral is charged to the player who caught the lateral', () => {
  const p = play('(Shotgun) B.Young pass short middle to T.McMillan to CAR 24 for 8 yards. Lateral to J.Coker to CAR 26 for 2 yards (J.Bullard). FUMBLES (J.Bullard), RECOVERED by GB-B.Cox at CAR 25. B.Cox to CAR 22 for 3 yards (B.Young).', 'c');
  assert.deepStrictEqual(lost(p), ['Jalen Coker']);
  assert.strictEqual(p.lead, '3', 'the card leads with Coker');
  assert.strictEqual(p.players.find((x) => x.name === 'Tetairoa McMillan').stat.recYds, 8);
});

test('fumble on a catch with no lateral is charged to the receiver', () => {
  const p = play('(Shotgun) J.Love pass short left to C.Watson to CAR 42 for 8 yards (N.Scott). FUMBLES (N.Scott), touched at CAR 40, RECOVERED by CAR-B.Okereke at CAR 37.', 'g');
  assert.deepStrictEqual(lost(p), ['Christian Watson']);
  assert.strictEqual(p.lead, '4');
});

test('named fumbler wins', () => {
  const p = parsePlay({ id: 'y', text: 'J.Jacobs right tackle to CAR 30 for 4 yards (D.Smith). J.Jacobs FUMBLES (D.Smith), RECOVERED by CAR-T.Moehrig at CAR 29.', type: { text: 'Rush' }, start: { team: { id: 'g' }, yardsToEndzone: 34 } }, ctx);
  assert.deepStrictEqual(lost(p), ['Josh Jacobs']);
});

test('a fumble the offense recovers costs nobody', () => {
  const p = play('(Shotgun) J.Love pass short left to C.Watson to CAR 42 for 8 yards (N.Scott). FUMBLES (N.Scott), RECOVERED by GB-J.Jacobs at CAR 41.', 'g');
  assert.deepStrictEqual(lost(p), []);
});
