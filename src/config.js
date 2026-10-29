// All settings can be overridden with environment variables (see .env.example).
const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));

module.exports = {
  PORT: num(process.env.PORT, 3000),
  SEASON: num(process.env.SEASON, 2026),

  // How often each LIVE game is re-checked for new plays (ms).
  // ESPN updates roughly every few seconds; 3000 is a good balance.
  LIVE_POLL_MS: num(process.env.LIVE_POLL_MS, 3000),
  // While games are live: how often the scoreboard is checked for changes (ms), and the
  // longest a live game goes without a full refresh even if nothing seems to change (ms).
  LIVE_SCOREBOARD_MS: num(process.env.LIVE_SCOREBOARD_MS, 5000),
  LIVE_MAX_GAP_MS: num(process.env.LIVE_MAX_GAP_MS, 45000),
  // How often the scoreboard (schedule, scores, Vegas lines) is refreshed (ms).
  SCOREBOARD_POLL_MS: num(process.env.SCOREBOARD_POLL_MS, 30000),

  // DEMO=1 runs a simulated slate (one live game, one final, one upcoming)
  // so you can see everything working when no NFL game is on.
  DEMO: process.argv.includes('--demo') || process.env.DEMO === '1' || process.env.DEMO === 'true',
  DEMO_PLAY_MS: num(process.env.DEMO_PLAY_MS, 6000),

  // Demo mode uses its own database so simulated games never mix with real ones
  DB_FILE: process.env.DB_FILE || require('path').join(__dirname, '..', 'data',
    process.argv.includes('--demo') || process.env.DEMO === '1' || process.env.DEMO === 'true' ? 'demo.db' : 'sideline.db'),
  CACHE_DIR: process.env.CACHE_DIR || require('path').join(__dirname, '..', 'data', 'cache'),

  // Free picks economy
  START_CREDITS: num(process.env.START_CREDITS, 1000),
  PICK_WIN: num(process.env.PICK_WIN, 100),
  PICK_LOSS: num(process.env.PICK_LOSS, -50),

  // Weekly salary-cap lineups
  SALARY_CAP: num(process.env.SALARY_CAP, 50000),
  ROSTER_SLOTS: ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'WR3', 'TE', 'FLEX'],

  // Login: 'local' = pick a username on this site, 'sideline' = use sidelineff.com accounts
  AUTH_MODE: process.env.AUTH_MODE === 'sideline' ? 'sideline' : 'local',
  SIDELINE_URL: (process.env.SIDELINE_URL || 'https://sidelineff.com').replace(/\/$/, ''),
  SIDELINE_PROFILE_PATH: process.env.SIDELINE_PROFILE_PATH || '/api/profile',
  SIDELINE_LOGIN_URL: process.env.SIDELINE_LOGIN_URL || 'https://sidelineff.com/login',

  // Comma-separated list of sites allowed to call the API from the browser,
  // e.g. "https://sidelineff.com,https://www.sidelineff.com". Empty = same origin only.
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};
