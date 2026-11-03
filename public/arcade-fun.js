/* sideline live: the hype meter. Every live game has a meter that jumps on big plays, reactions and
   comments and cools off over time; the loudest game is marked and its card shakes on a big jump.
   Builds on window.SL from app.js, arcade.js and arcade-plus.js. */
(() => {
  'use strict';
  const SL = window.SL;
  if (!SL) return;
  const { S, api, esc } = SL;
  const calm = SL.calm;
  // settings from features that were taken out (spoiler shield, radio mode)
  SL.ls.set('sl-delay', null); SL.ls.set('sl-radio', null);

  S.hype = { games: {}, loudest: null };
  const hypeHtml = (g) => {
    if (g.state !== 'in') return '';
    const v = S.hype.games[g.id] || 0;
    return `<div class="hype ${v >= 70 ? 'hot' : ''}" data-hype="${esc(g.id)}"><span class="hy-l">🔥 Hype</span><span class="hy-bar"><i style="width:${v}%"></i></span><b>${v}</b>${S.hype.loudest === g.id ? '<em>Loudest game</em>' : ''}</div>`;
  };
  function quake(gameId) {
    if (calm.matches) return;
    document.querySelectorAll(`.lc-wrap[data-lc="${CSS.escape(gameId)}"]`).forEach((el) => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); });
    if (SL.currentRoute() === 'game' && location.hash.endsWith(`/${gameId}`)) { document.body.classList.remove('quake'); void document.body.offsetWidth; document.body.classList.add('quake'); setTimeout(() => document.body.classList.remove('quake'), 700); }
  }
  function drawHype(prev) {
    for (const el of document.querySelectorAll('[data-hype]')) {
      const id = el.dataset.hype, v = S.hype.games[id] || 0;
      el.outerHTML = hypeHtml(S.gamesById.get(id) || { id, state: 'in' });
      if (prev && v - (prev[id] || 0) >= 25) quake(id);
    }
  }
  // the meter sits above Call It on live game cards and game pages
  const prevLive = SL.hooks.liveExtra;
  SL.hooks.liveExtra = (g) => `${hypeHtml(g)}${prevLive ? prevLive(g) : ''}`;
  setTimeout(() => { if (S.games.some((g) => g.state === 'in')) api('/api/hype').then((r) => { Object.assign(S.hype, r); drawHype(); }).catch(() => {}); }, 1500);

  const prevStream = SL.hooks.stream;
  SL.hooks.stream = (es) => {
    prevStream?.(es);
    es.addEventListener('hype', (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { /* ignore */ } const before = { ...S.hype.games }; Object.assign(S.hype, d); drawHype(before); });
  };
})();
