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
  byExt: db.prepare('SELECT id, name, credits FROM users WHERE ext_id=?'),
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

function localUserFor(ident) {
  const found = q.byExt.get(ident.id);
  if (found) {
    // keep the display name in step with sidelineff.com
    if (found.name !== ident.name && !q.byName.get(ident.name)) { q.rename.run(ident.name, found.id); found.name = ident.name; persist.upsert('users', { id: found.id }); }
    return found;
  }
  let name = ident.name;
  for (let i = 2; q.byName.get(name); i++) name = `${ident.name.slice(0, 17)}${i}`;
  q.insert.run(name, `ext:${crypto.randomBytes(24).toString('hex')}`, cfg.START_CREDITS, Date.now(), ident.id);
  const user = q.byExt.get(ident.id);
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
    if (res.ok) {
      const body = await res.json();
      const ident = body?.signedIn !== false ? identity(body.profile ?? body.user ?? body) : null;
      if (ident) { user = localUserFor(ident); ext = ident.id; }
    }
  } catch (e) {
    console.warn('[auth] could not reach sidelineff.com:', e.message);
    if (hit) return hit.user ? q.byExt.get(hit.ext) || null : null; // keep people signed in through a blip
  }
  cache.set(key, { at: Date.now(), user: !!user, ext });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return user;
}

module.exports = { userFromCookie, identity };
