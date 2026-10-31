// Shared login with sidelineff.com.
//
// sidelineff.com keeps each visitor's login in a cookie and answers
// GET /api/profile with { signedIn, profile }. When this app runs where that
// cookie is sent along (sidelineff.com/live, or live.sidelineff.com once the
// cookie is set for ".sidelineff.com"), we forward the cookie to
// sidelineff.com, ask who it belongs to, and match them to a local account.
// No passwords ever pass through this app.
const crypto = require('crypto');
const cfg = require('./config');
const db = require('./db');
const persist = require('./persist');
const { isOffensive } = require('./moderation');

const cache = new Map(); // sha256(cookie) -> { at, user }
const TTL = 60e3;

const q = {
  byExt: db.prepare('SELECT id, name, credits, profile FROM users WHERE ext_id=?'),
  setProfile: db.prepare('UPDATE users SET profile=? WHERE id=?'),
  byName: db.prepare('SELECT id FROM users WHERE name=?'),
  insert: db.prepare('INSERT INTO users (name, token, credits, created_at, ext_id) VALUES (?, ?, ?, ?, ?)'),
  rename: db.prepare('UPDATE users SET name=? WHERE id=?'),
};

// sidelineff.com's profile shape isn't published, so accept the usual field names
function identity(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const id = profile.id ?? profile.userId ?? profile.user_id ?? profile.uid ?? profile.username ?? profile.handle ?? profile.email;
  const name = profile.username ?? profile.handle ?? profile.displayName ?? profile.display_name ?? profile.name ?? (profile.email ? String(profile.email).split('@')[0] : null);
  if (id == null || !name) return null;
  const clean = String(name).replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
  return { id: String(id), name: clean && !isOffensive(clean) ? clean : 'player' };
}

// The parts of a sidelineff.com profile shown next to someone's name (same as the main site)
function publicProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const pick = { username: p.username ?? p.handle ?? null, color: p.color ?? null, team: p.team ?? null, avatar: p.avatar ?? null,
    level: p.level ?? null, title: p.title ?? null, shown: p.shown ?? null, badges: Array.isArray(p.badges) ? p.badges.slice(0, 8) : undefined };
  return pick.username ? pick : null;
}
const state = { lastStatus: null, lastError: null, lastAt: 0 };

function localUserFor(ident, profile) {
  const pub = profile ? JSON.stringify(publicProfile(profile)) : null;
  const found = q.byExt.get(ident.id);
  if (found) {
    if (pub && found.profile !== pub) { q.setProfile.run(pub, found.id); found.profile = pub; persist.upsert('users', { id: found.id }); }
    // keep the display name in step with sidelineff.com
    if (found.name !== ident.name && !q.byName.get(ident.name)) { q.rename.run(ident.name, found.id); found.name = ident.name; persist.upsert('users', { id: found.id }); }
    return found;
  }
  let name = ident.name;
  for (let i = 2; q.byName.get(name); i++) name = `${ident.name.slice(0, 17)}${i}`;
  q.insert.run(name, `ext:${crypto.randomBytes(24).toString('hex')}`, cfg.START_CREDITS, Date.now(), ident.id);
  const user = q.byExt.get(ident.id);
  if (pub) { q.setProfile.run(pub, user.id); user.profile = pub; }
  persist.upsert('users', { id: user.id });
  return user;
}

async function userFromCookie(cookie) {
  if (!cookie) return null;
  const key = crypto.createHash('sha256').update(cookie).digest('hex');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.user ? q.byExt.get(hit.ext) || null : null;
  let user = null, ext = null;
  try {
    const res = await fetch(cfg.SIDELINE_URL + cfg.SIDELINE_PROFILE_PATH, {
      headers: { cookie, accept: 'application/json', 'user-agent': 'sideline-live' },
      signal: AbortSignal.timeout(4000),
    });
    Object.assign(state, { lastStatus: res.status, lastError: null, lastAt: Date.now() });
    if (res.ok) {
      const body = await res.json();
      const prof = body.profile ?? body.user ?? body;
      const ident = body?.signedIn !== false ? identity(prof) : null;
      if (ident) { user = localUserFor(ident, prof); ext = ident.id; }
    }
  } catch (e) {
    console.warn('[auth] could not reach sidelineff.com:', e.message);
    Object.assign(state, { lastStatus: null, lastError: e.message, lastAt: Date.now() });
    if (hit) return hit.user ? q.byExt.get(hit.ext) || null : null; // keep people signed in through a blip
  }
  cache.set(key, { at: Date.now(), user: !!user, ext });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return user;
}

// Can this server reach sidelineff.com's login check? (shown on /api/health)
async function selfCheck() {
  try {
    const res = await fetch(cfg.SIDELINE_URL + cfg.SIDELINE_PROFILE_PATH, { headers: { accept: 'application/json', 'user-agent': 'sideline-live' }, signal: AbortSignal.timeout(5000) });
    const body = await res.json().catch(() => null);
    Object.assign(state, { lastStatus: res.status, lastError: body && 'signedIn' in body ? null : 'unexpected answer', lastAt: Date.now() });
  } catch (e) { Object.assign(state, { lastStatus: null, lastError: e.message, lastAt: Date.now() }); }
  return state;
}

module.exports = { userFromCookie, identity, publicProfile, state, selfCheck };
