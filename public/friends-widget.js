/* Sideline friends, for any page on sidelineff.com.
   It uses the same friends as Sideline Live (sidelineff.com/live), with the visitor's own login.

   On a profile page (shows that person's friends and an Add friend button):
     <div data-sideline-friends="profile" data-user="USERNAME"></div>
     (leave out data-user on /u/USERNAME pages and it reads the name from the address)

   On the visitor's own page, e.g. /account (their friends, requests to answer, and a search):
     <div data-sideline-friends="mine"></div>

   Then once per page:
     <script src="/live/friends-widget.js" defer></script>
*/
(() => {
  'use strict';
  const me = document.currentScript || document.querySelector('script[src*="friends-widget.js"]');
  const BASE = me ? new URL('.', me.src).pathname.replace(/\/$/, '') : '/live';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (path, method = 'GET') => {
    const r = await fetch(BASE + path, { method, credentials: 'same-origin', headers: { accept: 'application/json' } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error || `Request failed (${r.status})`), { status: r.status });
    return body;
  };
  const loginUrl = () => `/login?return_to=${encodeURIComponent(location.pathname + location.search)}`;
  const profileHref = (u) => `/u/${encodeURIComponent(u.profile?.username || u.name)}`;

  if (!document.getElementById('slf-style')) {
    const st = document.createElement('style');
    st.id = 'slf-style';
    st.textContent = `
.slf { font: inherit; color: inherit; }
.slf-box { border: 1px solid var(--line, rgba(255,255,255,.14)); border-radius: 14px; padding: 14px 16px; background: var(--card, rgba(255,255,255,.03)); }
.slf-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.slf-title { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; opacity: .7; }
.slf-list { display: flex; flex-wrap: wrap; gap: 8px; }
.slf-p { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px 5px 5px; border: 1px solid var(--line, rgba(255,255,255,.14)); border-radius: 99px; color: inherit; text-decoration: none; font-size: 14px; }
.slf-p:hover { border-color: var(--gold, #c9b78a); }
.slf-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line, rgba(255,255,255,.1)); }
.slf-row:last-child { border-bottom: 0; }
.slf-row .slf-n { flex: 1; color: inherit; text-decoration: none; font-weight: 600; }
.slf-av { width: 28px; height: 28px; border-radius: 50%; display: inline-grid; place-items: center; overflow: hidden; flex: 0 0 auto; font-weight: 700; font-size: 13px; color: #111; background: #8b8476; }
.slf-av img { width: 100%; height: 100%; object-fit: cover; }
.slf-btn { padding: 8px 14px; border-radius: 99px; border: 1px solid var(--gold, #c9b78a); background: var(--gold, #c9b78a); color: var(--bg, #111); font: inherit; font-size: 12px; font-weight: 600; letter-spacing: .5px; cursor: pointer; text-decoration: none; }
.slf-btn.ghost { background: none; color: inherit; border-color: var(--line-2, rgba(255,255,255,.3)); }
.slf-btn:disabled { opacity: .5; cursor: default; }
.slf-input { width: 100%; box-sizing: border-box; padding: 10px 14px; border-radius: 12px; border: 1px solid var(--line-2, rgba(255,255,255,.3)); background: none; color: inherit; font: inherit; margin: 6px 0 4px; }
.slf-note { font-size: 13px; opacity: .7; margin: 6px 0 0; }
.slf-sec + .slf-sec { margin-top: 14px; }
.slf a.slf-more { font-size: 12px; opacity: .75; color: inherit; }`;
    document.head.appendChild(st);
  }
  const avatar = (u) => {
    const a = u.profile?.avatar;
    if (a?.kind === 'upload' && a.url) return `<span class="slf-av"><img src="${esc(a.url)}" alt=""></span>`;
    return `<span class="slf-av" style="background:${esc(a?.kind === 'initial' && a.value ? a.value : u.profile?.color || '#8b8476')}">${esc(String(u.profile?.username || u.name || '?').replace(/_/g, '').charAt(0).toUpperCase())}</span>`;
  };
  const LABEL = { none: 'Add friend', sent: 'Request sent', received: 'Accept friend request', friends: '✓ Friends' };
  const friendBtn = (status, name) => (status && status !== 'self' ? `<button type="button" class="slf-btn ${status === 'none' || status === 'received' ? '' : 'ghost'}" data-slf="friend" data-name="${esc(name)}" data-s="${status}">${LABEL[status]}</button>` : '');
  async function act(btn, refresh) {
    const { name, s } = btn.dataset;
    if (s === 'friends' && !confirm(`Remove ${name} from your friends?`)) return;
    if (s === 'sent' && !confirm(`Cancel your friend request to ${name}?`)) return;
    btn.disabled = true;
    try { await api(`/api/friends/${encodeURIComponent(name)}`, s === 'none' || s === 'received' ? 'POST' : 'DELETE'); }
    catch (e) { if (e.status === 401) { location.href = loginUrl(); return; } alert(e.message); }
    refresh();
    document.dispatchEvent(new CustomEvent('slf:changed', { detail: refresh }));
  }
  // every friends box on the page updates after a change in any of them
  const onChange = (draw) => document.addEventListener('slf:changed', (e) => { if (e.detail !== draw) draw(); });

  // ---- someone's profile ----
  async function profile(el) {
    const name = el.dataset.user || decodeURIComponent((location.pathname.match(/\/u\/([^/?#]+)/) || [])[1] || '');
    if (!name) return;
    const draw = async () => {
      let d;
      try { d = await api(`/api/u/${encodeURIComponent(name)}/friends`); } catch { el.innerHTML = ''; return; }
      if (!d.joined) {
        el.innerHTML = `<div class="slf slf-box"><div class="slf-top"><span class="slf-title">Friends</span></div><p class="slf-note">${esc(name)} hasn't joined Sideline Live yet, so they can't get friend requests. Friends show up here once they open <a href="${BASE}/">Sideline Live</a>.</p></div>`;
        return;
      }
      const btn = d.status === 'self' ? `<a class="slf-btn ghost" href="${BASE}/#/people">Find friends</a>` : d.signedIn ? friendBtn(d.status, d.name) : `<a class="slf-btn" href="${loginUrl()}">Sign in to add friend</a>`;
      el.innerHTML = `<div class="slf slf-box"><div class="slf-top"><span class="slf-title">Friends · ${d.friends.length}</span>${btn}</div>
        ${d.friends.length ? `<div class="slf-list">${d.friends.slice(0, 24).map((f) => `<a class="slf-p" href="${profileHref(f)}">${avatar(f)}${esc(f.profile?.username || f.name)}</a>`).join('')}</div>` : `<p class="slf-note">No friends yet.</p>`}
        <p class="slf-note"><a class="slf-more" href="${BASE}/#/u/${encodeURIComponent(d.name)}">See ${esc(d.name)} on Sideline Live →</a></p></div>`;
      el.querySelectorAll('[data-slf="friend"]').forEach((b) => b.addEventListener('click', () => act(b, draw)));
    };
    onChange(draw);
    draw();
  }

  // ---- your own friends, requests and search ----
  async function mine(el) {
    const draw = async () => {
      let d;
      try { d = await api('/api/friends'); }
      catch (e) {
        el.innerHTML = `<div class="slf slf-box"><div class="slf-top"><span class="slf-title">Friends</span></div><p class="slf-note">${e.status === 401 ? `<a href="${loginUrl()}">Sign in</a> to see your friends.` : 'Friends couldn\'t load. Try again in a moment.'}</p></div>`;
        return;
      }
      const row = (u, extra) => `<div class="slf-row">${avatar(u)}<a class="slf-n" href="${profileHref(u)}">${esc(u.profile?.username || u.name)}</a>${extra}</div>`;
      el.innerHTML = `<div class="slf slf-box">
        ${d.incoming.length ? `<div class="slf-sec"><div class="slf-title">Friend requests · ${d.incoming.length}</div>${d.incoming.map((u) => row(u, `${friendBtn('received', u.name).replace('Accept friend request', 'Accept')}<button type="button" class="slf-btn ghost" data-slf="decline" data-name="${esc(u.name)}">Decline</button>`)).join('')}</div>` : ''}
        <div class="slf-sec"><div class="slf-top"><span class="slf-title">Your friends · ${d.friends.length}</span><a class="slf-more" href="${BASE}/#/people">Friends leaderboard on Live →</a></div>
          ${d.friends.length ? d.friends.map((u) => row(u, `<span class="slf-note" style="margin:0">${(u.credits || 0).toLocaleString()} credits</span>`)).join('') : '<p class="slf-note">No friends yet. Search below to add some.</p>'}</div>
        <div class="slf-sec"><div class="slf-title">Find people</div><input class="slf-input" type="search" placeholder="Search usernames" aria-label="Search usernames"><div class="slf-res"></div></div>
        ${d.outgoing.length ? `<div class="slf-sec"><div class="slf-title">Requests you sent</div>${d.outgoing.map((u) => row(u, friendBtn('sent', u.name))).join('')}</div>` : ''}</div>`;
      el.querySelectorAll('[data-slf="friend"]').forEach((b) => b.addEventListener('click', () => act(b, draw)));
      el.querySelectorAll('[data-slf="decline"]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; try { await api(`/api/friends/${encodeURIComponent(b.dataset.name)}`, 'DELETE'); } catch { /* ignore */ } draw(); document.dispatchEvent(new CustomEvent('slf:changed', { detail: draw })); }));
      const inp = el.querySelector('.slf-input'), res = el.querySelector('.slf-res');
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const q = inp.value.trim();
          if (q.length < 2) { res.innerHTML = ''; return; }
          try {
            const r = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
            if (inp.value.trim() !== q) return;
            res.innerHTML = r.users.length ? r.users.map((u) => row(u, friendBtn(u.friend, u.name))).join('') : `<p class="slf-note">No one named “${esc(q)}” on Sideline Live yet.</p>`;
            res.querySelectorAll('[data-slf="friend"]').forEach((b) => b.addEventListener('click', () => act(b, draw)));
          } catch { res.innerHTML = ''; }
        }, 220);
      });
    };
    onChange(draw);
    draw();
  }

  const boot = () => document.querySelectorAll('[data-sideline-friends]:not([data-slf-ready])').forEach((el) => {
    el.setAttribute('data-slf-ready', '1');
    (el.dataset.sidelineFriends === 'mine' ? mine : profile)(el);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // pages that change without reloading (like Next.js) can call this after showing a new page
  window.SidelineFriends = { refresh: boot };
})();
