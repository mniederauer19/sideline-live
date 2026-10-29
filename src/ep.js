// Lightweight expected-points model for live EPA estimates.
// Live EPA from a simple model is an estimate; nflverse publishes official
// EPA after each game, which is what the Advanced stats page should use.

// 1st & 10 expected points by yards to the end zone (approximate league values).
const TABLE = [
  [1, 6.0], [5, 5.3], [10, 4.8], [20, 4.1], [30, 3.6], [40, 3.0],
  [50, 2.4], [60, 1.8], [70, 1.2], [75, 0.9], [80, 0.4], [90, -0.2], [99, -0.6],
];

function base(yte) {
  const y = Math.max(1, Math.min(99, yte));
  for (let i = 1; i < TABLE.length; i++) {
    const [y1, v1] = TABLE[i - 1], [y2, v2] = TABLE[i];
    if (y <= y2) return v1 + ((y - y1) / (y2 - y1)) * (v2 - v1);
  }
  return TABLE[TABLE.length - 1][1];
}

function ep(down, distance, yte) {
  if (!yte || !down || down < 1 || down > 4) return null;
  const d = Math.max(1, Math.min(distance || 10, 30));
  let v = base(yte);
  if (down === 1) v -= 0.04 * (d - 10);
  if (down === 2) v -= 0.35 + 0.05 * (d - 7);
  if (down === 3) v -= 0.9 + 0.08 * (d - 5);
  if (down === 4) v -= 1.6 + 0.1 * (d - 3);
  return v;
}

module.exports = { ep };
