/* sideline live: every NFL play, scored in PPR, with reactions, votes, comments,
   free picks on Vegas lines and weekly salary-cap lineups. No build step. */
(() => {
  'use strict';

  // The API lives next to this page (works at / and under a sub-path like sidelineff.com/live/).
  // If the page is served from a different host than the API, set window.SIDELINE_API.
  const API = (window.SIDELINE_API ?? new URL('.', location.href).pathname).replace(/\/$/, '');
  const EMOJIS = ['🔥', '😂', '😭', '🤯', '💀', '👏'];
  const FILTERS = [['all', 'All'], ['scoring', 'Scoring'], ['ppr5', '5+ PPR'], ['ppr10', '10+ PPR'], ['big', 'Big plays'], ['mine', 'My lineup']];

  const S = {
    token: (() => { try { return localStorage.getItem('sl_token'); } catch { return null; } })(),
    me: null,
    demo: false,
    games: [],
    gamesById: new Map(),
    week: null,
    feed: { plays: [], next: null, filter: 'all', game: null, loading: false },
    pending: [],
    pickerFor: null,
    myLineupIds: new Set(),
    slate: null,
    draft: {},
    luTab: 'build',
    pos: 'ALL',
    q: '',
    sort: 'salary',
    sheetPlay: null,
    sel: null,        // week being viewed
    schedule: [],     // every week of the season
    sync: null,       // progress loading past games
  };

  const $ = (sel, el = document) => el.querySelector(sel);
  const view = $('#view');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);
  const signed = (n, d = 1) => { const r = Number(fmt(Math.abs(n), d)); return `${r === 0 ? '' : n > 0 ? '+' : '−'}${fmt(Math.abs(n), d)}`; };
  const money = (n) => `$${Number(n).toLocaleString()}`;
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } } };

  // ---------- scoring format (PPR, half PPR, standard) ----------
  const FORMATS = { ppr: { rec: 1, label: 'PPR', name: 'Full PPR' }, half: { rec: 0.5, label: 'Half', name: 'Half PPR' }, std: { rec: 0, label: 'Std', name: 'Standard' } };
  S.fmt = FORMATS[ls.get('sl-scoring')] ? ls.get('sl-scoring') : 'ppr';
  const recVal = () => FORMATS[S.fmt].rec;
  const unit = () => FORMATS[S.fmt].label === 'PPR' ? 'PPR' : FORMATS[S.fmt].label === 'Half' ? 'Half PPR' : 'Pts';
  // a player's points on one play, in the chosen format
  const adj = (pl) => (pl ? pl.ppr - (pl.stat?.rec || 0) * (1 - recVal()) : 0);
  // a player's total today, in the chosen format (catches read from the game line)
  const adjToday = (pl) => {
    const today = pl.gamePpr ?? pl.ppr;
    const m = /(\d+) rec\b/.exec(pl.gameLine || '');
    return today - (m ? Number(m[1]) : 0) * (1 - recVal());
  };
  // a box-score total from raw stats, in the chosen format or a league's own settings
  function fpts(row, sc) {
    const s = row?.s;
    if (!row) return 0;
    if (!s || !Object.keys(s).length || row.pos === 'K') return sc ? row.ppr || 0 : (row.ppr || 0) - (s?.rec || 0) * (1 - recVal());
    const g = (k, d) => (sc && sc[k] != null ? sc[k] : d);
    const recPts = sc ? g('rec', 1) + (g(`bonus_rec_${String(row.pos).toLowerCase()}`, 0)) : recVal();
    return (s.passYds || 0) * g('pass_yd', 0.04) + (s.passTd || 0) * g('pass_td', 4) + (s.int || 0) * g('pass_int', -2)
      + (s.rushYds || 0) * g('rush_yd', 0.1) + (s.rushTd || 0) * g('rush_td', 6)
      + (s.rec || 0) * recPts + (s.recYds || 0) * g('rec_yd', 0.1) + (s.recTd || 0) * g('rec_td', 6)
      + (s.fumLost || 0) * g('fum_lost', -2) + (s.twoPt || 0) * 2 + (s.retTd || 0) * 6;
  }
  function fmtSeg() {
    return `<span class="fmt-seg" role="radiogroup" aria-label="Scoring">${Object.entries(FORMATS).map(([k, f]) => `<button type="button" class="${S.fmt === k ? 'on' : ''}" data-act="fmt" data-v="${k}" role="radio" aria-checked="${S.fmt === k}" title="${f.name}">${f.label}</button>`).join('')}</span>`;
  }

  // ---------- your fantasy team (filled from your sidelineff.com leagues once connected) ----------
  S.myFantasyIds = new Set();
  S.alerts = ls.get('sl-alerts') === '1';
  ls.set('sl-sleeper', null); ls.set('sl-sleeper-ids', null);

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  }

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  // ---------- team logos ----------
  function teamInfo(abbr) {
    for (const g of S.games) {
      if (g.home.abbr === abbr) return g.home;
      if (g.away.abbr === abbr) return g.away;
    }
    return { abbr, color: '#33415a', logo: '' };
  }
  // sidelineff.com's neon logos use a few different team codes
  const NEON_CODE = { WSH: 'WAS' };
  function tlogo(abbr) {
    const t = teamInfo(abbr);
    const bg = t.color || '#33415a';
    const neon = document.documentElement.dataset.logos === 'neon';
    const src = neon ? `https://sidelineff.com/team-logos/neon/tube/${NEON_CODE[abbr] || abbr}.png` : t.logo;
    const text = `this.replaceWith(document.createTextNode('${esc(abbr)}'))`;
    const fallback = neon && t.logo ? `if(this.dataset.f){${text}}else{this.dataset.f=1;this.src='${esc(t.logo)}'}` : text;
    return `<span class="tlogo" style="background:${esc(bg)}" title="${esc(abbr)}">${src
      ? `<img src="${esc(src)}" alt="${esc(abbr)}" loading="lazy" onerror="${fallback}">`
      : esc(abbr)}</span>`;
  }
  function initials(name) { return esc((name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2)); }
  function face(p, cls = 'face') {
    if (p?.headshot) return `<img class="${cls}" src="${esc(p.headshot)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;initials&quot;>${initials(p.name)}</div>'">`;
    return `<div class="initials">${p?.pos === 'DST' ? 'D' : initials(p?.name)}</div>`;
  }

  // A team's code as a link to its page
  const tlink = (abbr) => abbr ? `<a class="tlink" href="#/team/${encodeURIComponent(abbr)}">${esc(abbr)}</a>` : '';

  // ---------- me ----------
  async function loadMe() {
    if (!S.token && S.auth?.mode !== 'sideline') {
      // still ask once, so we learn whether this site uses sidelineff.com accounts
      if (!S.auth) { try { const r = await api('/api/me'); S.auth = r.auth; S.me = r.user; } catch { /* ignore */ } }
      if (S.auth?.mode !== 'sideline') { S.me = null; renderMe(); return; }
    }
    try { const r = await api('/api/me'); S.me = r.user; S.auth = r.auth || S.auth; } catch { S.me = null; }
    if (!S.me && S.auth?.mode !== 'sideline') { S.token = null; try { localStorage.removeItem('sl_token'); } catch {} }
    renderMe();
    loadMyLineupIds();
  }
  function renderMe() {
    const b = $('#meBtn');
    b.innerHTML = S.me ? `<span class="nm">${esc(S.me.name)}</span><b>${S.me.credits.toLocaleString()}</b>` : S.auth?.mode === 'sideline' ? 'Sign in' : 'Join free';
    b.title = S.me ? `${S.me.name}: ${S.me.tier}, rank #${S.me.rank}` : 'Pick a username';
  }
  async function loadMyLineupIds() {
    if (!S.me) { S.myLineupIds = new Set(); return; }
    try {
      const { lineup } = await api('/api/lineups/me');
      S.myLineupIds = new Set((lineup?.players || []).map((p) => String(p.id)));
    } catch { /* ignore */ }
  }

  function requireUser(then) {
    if (S.me) return true;
    if (S.auth?.mode === 'sideline') {
      const join = S.auth.loginUrl.includes('?') ? '&' : '?';
      const url = `${S.auth.loginUrl}${join}next=${encodeURIComponent(location.href)}`;
      const signup = `${S.auth.loginUrl}${join}mode=signup&next=${encodeURIComponent(location.href)}`;
      openSheet('Sign in', `
        <p class="intro">Use your sidelineff.com account. Your picks, credits and lineups follow you on both sites.</p>
        <div class="field"><a class="btn" href="${esc(url)}">Sign in with Sideline</a></div>
        <p class="rules">No account yet? <a href="${esc(signup)}">Create one free</a>.</p>`);
      return false;
    }
    openSheet('Pick a username', `
      <p class="intro">A username lets you react, vote, comment, make picks and save a lineup. Free, no email needed.</p>
      <form id="joinForm" class="field">
        <label for="joinName">Username</label>
        <input id="joinName" maxlength="20" autocomplete="nickname" placeholder="e.g. waiverwire_wizard" required>
        <div class="err" id="joinErr"></div>
        <button class="btn" type="submit">Join free</button>
      </form>`);
    $('#joinName').focus();
    $('#joinForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/users', { method: 'POST', body: { name: $('#joinName').value.trim() } });
        S.token = r.token;
        try { localStorage.setItem('sl_token', r.token); } catch {}
        await loadMe();
        closeSheet();
        toast(`Welcome, ${S.me.name}. You have ${S.me.credits.toLocaleString()} credits.`);
        if (then) then();
        else route();
      } catch (err) { $('#joinErr').textContent = err.message; }
    };
    return false;
  }

  // ---------- games strip ----------
  function setGames(list) {
    S.games = list;
    S.gamesById = new Map(list.map((g) => [g.id, g]));
    renderStrip();
    renderLive();
  }
  function kickoff(g, long = false) {
    const d = new Date(g.start);
    const day = d.toLocaleDateString([], long ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'numeric', day: 'numeric' });
    if (g.timeValid === false) return `${day} · TBD`;
    return `${day} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  function gameStatus(g) {
    if (g.state === 'in') return `<span class="live">${esc(g.detail)}</span>`;
    if (g.state === 'post') return 'Final';
    return esc(kickoff(g));
  }

  // ---------- weeks ----------
  const isCurrentWeek = () => !S.sel || !S.week?.week || S.sel === S.week.week;
  const shortDate = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  function renderWeeks() {
    const el = $('#weeks');
    if (!el) return;
    if (!S.schedule.length) { el.innerHTML = ''; return; }
    el.innerHTML = S.schedule.map((w) => {
      const cur = S.week?.week === w.week;
      const range = w.start === w.end || !isFinite(w.start) ? shortDate(w.start) : `${shortDate(w.start)}–${new Date(w.end).getMonth() === new Date(w.start).getMonth() ? new Date(w.end).getDate() : shortDate(w.end)}`;
      const status = w.live ? '<i class="dot live"></i>' : cur ? '<i class="dot"></i>' : '';
      return `<button class="wk ${S.sel === w.week ? 'on' : ''} ${cur ? 'cur' : ''} ${w.final === w.games ? 'done' : ''}" data-act="week" data-w="${w.week}" aria-pressed="${S.sel === w.week}">
        <b>${esc(w.short || `W${w.week}`)}${status}</b><span>${esc(range)}</span></button>`;
    }).join('');
    const on = el.querySelector('.wk.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  async function loadSchedule() {
    try {
      const r = await api('/api/schedule');
      S.schedule = r.weeks || [];
      S.sync = r.sync;
      renderWeeks();
      renderSync();
    } catch { /* ignore */ }
  }
  function renderSync() {
    const el = $('#syncBanner');
    const s = S.sync;
    if (!el) return;
    if (!s || !s.running || !s.total) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<span>Loading every play from this season: ${s.done} of ${s.total} games</span><i style="width:${Math.round(s.done / s.total * 100)}%"></i>`;
  }
  async function selectWeek(w) {
    S.sel = w;
    renderWeeks();
    await refreshGames();
    const r = currentRoute();
    if (r === 'game') location.hash = '#/feed';
    else if (r === 'feed' || r === '') showFeed();
    else if (r === 'picks') showPicks();
    renderSide();
  }
  function lineText(g) {
    if (!g.odds) return '';
    const parts = [];
    if (g.odds.spread != null) parts.push(g.odds.fav ? `${g.odds.fav} −${g.odds.spread}` : 'PK');
    if (g.odds.total != null) parts.push(`O/U ${g.odds.total}`);
    return parts.join(' · ');
  }
  function renderStrip() {
    const cur = currentGameId();
    $('#strip').innerHTML = S.games.map((g) => {
      const started = g.state !== 'pre';
      const row = (t, other) => `<div class="row ${g.state === 'post' && t.score < other.score ? 'lose' : ''}">${tlogo(t.abbr)}<span class="${g.state === 'in' && g.possession === t.id ? 'poss' : ''}">${esc(t.abbr)}</span><span class="sc ${started ? '' : 'rec'}">${started ? t.score : esc(t.record || '')}</span></div>`;
      return `<button class="chip-game ${cur === g.id ? 'on' : ''} ${g.state === 'in' ? 'is-live' : ''}" style="--a:${esc(g.away.color || '#555')};--h:${esc(g.home.color || '#555')}" data-act="go" data-href="#/game/${esc(g.id)}">
        ${row(g.away, g.home)}${row(g.home, g.away)}
        <div class="meta"><span>${gameStatus(g)}</span><span>${esc(g.state === 'pre' ? lineText(g) : g.downDistance || g.broadcast || '')}</span></div>
      </button>`;
    }).join('') || '<span style="color:var(--muted)">No games this week yet.</span>';
  }

  // ---------- play cards ----------
  function primaryOf(p) {
    return p.players.find((x) => x.pos !== 'DST' && x.role !== 'target') || p.players.find((x) => x.pos !== 'DST') || p.players[0] || null;
  }
  function scoreLine(p) {
    const g = S.gamesById.get(p.gameId);
    const away = p.game?.away || g?.away.abbr, home = p.game?.home || g?.home.abbr;
    return `<span class="sl">${tlogo(away)}<span class="score">${p.awayScore}–${p.homeScore}</span>${tlogo(home)}</span>`;
  }
  // How a player's points on this play add up
  function breakdown(pl) {
    const st = pl.stat || {};
    const out = [];
    const add = (label, pts) => { if (Math.abs(pts) > 0.001) out.push([label, pts]); };
    if (pl.pos === 'DST') {
      add(st.sack > 1 ? `${st.sack} sacks` : 'sack', st.sack || 0);
      add('interception', (st.int || 0) * 2);
      add('fumble recovery', (st.fumRec || 0) * 2);
      add('safety', (st.safety || 0) * 2);
      add('defensive TD', pl.ppr - out.reduce((a, [, v]) => a + v, 0));
      return out;
    }
    if (st.rec) add(st.rec > 1 ? `${st.rec} catches` : 'catch', st.rec * recVal());
    if (st.recYds) add(`${st.recYds} rec yd`, st.recYds * 0.1);
    if (st.recTd) add('TD catch', st.recTd * 6);
    if (st.passYds) add(`${st.passYds} pass yd`, st.passYds * 0.04);
    if (st.passTd) add('TD pass', st.passTd * 4);
    if (st.int) add('interception', st.int * -2);
    if (st.rushYds) add(`${st.rushYds} rush yd`, st.rushYds * 0.1);
    if (st.rushTd) add('TD run', st.rushTd * 6);
    if (st.retTd) add('return TD', st.retTd * 6);
    if (st.fumLost) add('fumble lost', st.fumLost * -2);
    if (st.twoPt) add('2-pt conversion', st.twoPt * 2);
    if (st.fga || st.xpa) {
      const xp = (st.xpm || 0) - ((st.xpa || 0) - (st.xpm || 0));
      if (st.fga) add(st.fgm ? 'field goal' : 'missed FG', pl.ppr - xp);
      if (st.xpa) add(st.xpm ? 'extra point' : 'missed PAT', xp);
    }
    return out;
  }
  function breakdownHtml(pl) {
    const parts = breakdown(pl);
    if (!parts.length) return '';
    const items = parts.map(([l, v]) => `<li class="${v < 0 ? 'minus' : ''}"><b>${signed(v, v % 1 && Math.abs(v * 10 % 1) > 0.01 ? 2 : 1)}</b>${esc(l)}</li>`).join('');
    const total = parts.length > 1 ? `<li class="eq"><b>${signed(adj(pl), 1)}</b>total</li>` : '';
    return `<ul class="breakdown" aria-label="How the points add up">${items}${total}</ul>`;
  }
  // Running total today vs the player's season average
  function paceHtml(pl) {
    if (!pl || pl.pos === 'DST') return '';
    const today = adjToday(pl);
    const avg = pl.season?.games ? pl.season.ppg : null;
    const extra = [];
    if (pl.season && ['WR', 'TE', 'RB'].includes(pl.pos) && pl.season.tgtShare) extra.push(`${fmt(pl.season.tgtShare, 0)}% target share`);
    if (pl.season && ['WR', 'TE'].includes(pl.pos) && pl.season.adot) extra.push(`${fmt(pl.season.adot)} aDOT`);
    const bar = avg ? `<div class="pace-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, today / (avg * 2) * 100))}%"></i><em style="left:50%"></em></div>` : '';
    const note = avg ? `<div class="pace-note"><b>${Math.round(today / avg * 100)}%</b> of his ${fmt(avg)} PPR season average${extra.length ? ` · ${esc(extra.join(' · '))}` : ''}</div>` : '';
    return `<div class="pace"><div class="pace-top"><span class="today">${fmt(today)}</span><span class="label">${unit()} today</span>${pl.gameLine ? `<span class="line">${esc(pl.gameLine)}</span>` : ''}</div>${bar}${note}</div>`;
  }
  const chatIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4C6.8 4 3 7.3 3 11.2c0 2.2 1.2 4.1 3.2 5.4L5.5 20l4-2.1c.8.2 1.6.3 2.5.3 5.2 0 9-3.3 9-7S17.2 4 12 4z"/></svg>';
  function actions(p) {
    const s = p.social || { reactions: {}, mine: [], score: 0, myVote: 0, comments: 0 };
    const reacts = Object.entries(s.reactions).filter(([, n]) => n > 0)
      .map(([e, n]) => `<button class="react ${s.mine.includes(e) ? 'on' : ''}" data-act="react" data-id="${esc(p.id)}" data-e="${e}" aria-label="React ${e}">${e}<span class="c">${n}</span></button>`).join('');
    const picker = S.pickerFor === p.id
      ? `<span class="picker">${EMOJIS.map((e) => `<button data-act="react" data-id="${esc(p.id)}" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('')}</span>`
      : `<button class="react add" data-act="picker" data-id="${esc(p.id)}" aria-label="Add reaction">React</button>`;
    return `<div class="actions" data-social="${esc(p.id)}">
      <span class="vote" role="group" aria-label="Rate this play">
        <button class="up ${s.myVote === 1 ? 'on' : ''}" data-act="vote" data-id="${esc(p.id)}" data-v="1" aria-label="Upvote">▲</button>
        <span class="n">${s.score}</span>
        <button class="down ${s.myVote === -1 ? 'on' : ''}" data-act="vote" data-id="${esc(p.id)}" data-v="-1" aria-label="Downvote">▼</button>
      </span>
      ${reacts}${picker}
      <button class="cmt-btn" data-act="comments" data-id="${esc(p.id)}" aria-label="Comments">${chatIcon}${s.comments}</button>
    </div>`;
  }
  // A mini field showing where the play started and where it ended
  const FIELD_KINDS = new Set(['catch', 'rush', 'sack']);
  function spotName(yte, off, def) {
    if (yte <= 0) return 'End zone';
    if (yte === 50) return '50';
    return yte > 50 ? `${off} ${100 - yte}` : `${def} ${yte}`;
  }
  function fieldBar({ start, end = start, off, def, loss = false, td = false, label = '' }) {
    const lo = Math.min(start, end), hi = Math.max(start, end);
    const o = teamInfo(off), d = teamInfo(def);
    return `<div class="fieldbar" style="--off:${esc(o.color || '#555')};--def:${esc(d.color || '#555')}" aria-hidden="true">
      <div class="fb-field"><i class="ez l"></i><i class="ez r"></i><div class="fb-yards">
        <span class="fb-los" style="left:${start}%"></span>
        ${hi > lo ? `<span class="fb-run ${loss ? 'loss' : ''} ${td ? 'td' : ''}" style="left:${lo}%;width:${hi - lo}%"></span>` : ''}
        <span class="fb-ball" style="left:${end}%"></span></div></div>
      ${label ? `<div class="fb-label">${label}</div>` : ''}</div>`;
  }
  function playField(p) {
    if (p.yte == null || !FIELD_KINDS.has(p.kind) || !p.offense || !p.defense) return '';
    const yards = Number(p.yards) || 0;
    const start = 100 - p.yte;
    const end = p.td ? 100 : Math.max(0, Math.min(100, start + yards));
    const from = spotName(p.yte, p.offense, p.defense), to = p.td ? 'End zone' : spotName(100 - end, p.offense, p.defense);
    const label = `<span>${esc(from)} <em>→</em> ${esc(to)}</span><b class="${yards < 0 ? 'minus' : ''}">${yards > 0 ? '+' : ''}${yards} yd</b>`;
    return fieldBar({ start, end, off: p.offense, def: p.defense, loss: yards < 0, td: p.td, label });
  }
  const isMine = (p) => p.players?.some((x) => S.myFantasyIds.has(String(x.id)));
  function badges(p) {
    const out = [];
    if (p.quick && Date.now() - p.ts < 90e3) out.push('<span class="badge first" title="ESPN\'s first look at this play. Details fill in as soon as they\'re posted.">First look</span>');
    if (isMine(p)) out.push('<span class="badge mine">Your team</span>');
    if (p.td) out.push('<span class="badge td">Touchdown</span>');
    if (p.kind === 'int' || p.players.some((x) => x.stat?.fumLost)) out.push('<span class="badge to">Turnover</span>');
    else if (p.explosive && !p.td) out.push('<span class="badge big">Big play</span>');
    return out.join('');
  }
  // Fresh plays count their points up from zero
  function countUp(root) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.querySelectorAll('.ppr .v').forEach((el) => {
      const txt = el.textContent, m = txt.match(/^([+−]?)(\d+(?:\.\d+)?)$/);
      if (!m) return;
      const target = Number(m[2]), dec = (m[2].split('.')[1] || '').length, t0 = performance.now(), dur = 700;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
        el.textContent = `${m[1]}${(target * e).toFixed(dec)}`;
        if (k < 1) requestAnimationFrame(step); else el.textContent = txt;
      };
      requestAnimationFrame(step);
    });
  }

  function playCard(p, { fresh = false, full = false } = {}) {
    const prim = primaryOf(p);
    const minor = !full && (p.kind === 'kickoff' || p.kind === 'punt' || p.kind === 'penalty' || p.kind === 'other') && !p.players.length;
    const when = `Q${p.period} ${esc(p.clock)}`;
    if (minor) {
      return `<div class="play-mini" data-play="${esc(p.id)}"><span>${when}</span><b>${esc(p.headline)}</b><span>${esc(p.offense || '')}</span>
        <button class="cmt-btn" data-act="comments" data-id="${esc(p.id)}" aria-label="Comments">${chatIcon}${p.social?.comments || 0}</button></div>`;
    }
    const pts = prim ? Math.round(adj(prim) * 100) / 100 : 0;
    const cls = pts >= 10 ? 'boom' : pts < 0 ? 'neg' : pts === 0 ? 'zero' : '';
    const others = p.players.filter((x) => x !== prim);
    const meta = [when, p.downText ? esc(p.downText) : '', ago(p.ts)].filter(Boolean).map((x) => `<span>${x}</span>`).join('<span>·</span>') + badges(p);
    const who = prim
      ? `<div class="who-row">${face(prim)}<div><h3 class="pname">${prim.id && prim.pos !== 'DST' ? `<button class="plink" data-act="player" data-pid="${esc(prim.id)}">${esc(prim.name)}</button>` : esc(prim.name)}<small>${esc(prim.pos || '')}${prim.pos && prim.team ? ' · ' : ''}${tlink(prim.team)}</small></h3><div class="headline ${p.td ? 'td' : ''}">${esc(p.headline)}</div></div></div>`
      : `<div class="who-row"><div><h3 class="pname">${esc(p.headline)}</h3></div></div>`;
    const also = others.length ? `<div class="also"><span class="label">Also on the play</span>${others.map((o) => {
      const ov = adj(o);
      const v = o.role === 'target' && !o.ppr ? '<b class="zero">target</b>' : `<b class="${ov < 0 ? 'minus' : ov === 0 ? 'zero' : ''}">${signed(ov, 1)}</b>`;
      return `<span>${o.id && o.pos !== 'DST' ? `<button class="plink" data-act="player" data-pid="${esc(o.id)}">${esc(o.name)}</button>` : esc(o.name)} ${v}${o.pos !== 'DST' && o.gamePpr != null ? ` <small>${fmt(adjToday(o))} today</small>` : ''}</span>`;
    }).join('')}</div>` : '';
    const teamColor = prim?.team ? teamInfo(prim.team).color : '';
    const spot = pts >= 10 && teamColor ? ` spot" style="--team:${esc(teamColor)}` : '';
    return `<article class="play ${fresh ? 'fresh' : ''} ${p.td ? 'is-td' : ''} ${isMine(p) ? 'is-mine' : ''}${spot}" data-play="${esc(p.id)}">
      <div class="ppr ${cls}" title="${esc(prim?.name || 'No one')} scored ${signed(pts, 2)} ${unit()} points on this play"><span class="v">${signed(pts, 1)}</span><span class="u">${unit()}</span></div>
      <div class="body">
        <div class="play-meta">${scoreLine(p)}${meta}</div>
        ${who}
        ${playField(p)}
        ${prim ? breakdownHtml(prim) : ''}
        ${paceHtml(prim)}
        ${also}
        ${p.tags.length ? `<ul class="tags">${p.tags.map((t) => `<li>${t.icon} ${esc(t.text)}</li>`).join('')}</ul>` : ''}
        ${actions(p)}
      </div>
    </article>`;
  }

  function matchesFeed(p) {
    if (S.feed.game && p.gameId !== S.feed.game) return false;
    if (!S.feed.game && !S.gamesById.has(p.gameId)) return false;
    switch (S.feed.filter) {
      case 'scoring': return p.scoring;
      case 'ppr5': return p.ppr >= 5;
      case 'ppr10': return p.ppr >= 10;
      case 'big': return p.explosive || p.ppr >= 8;
      case 'mine': return p.players.some((x) => S.myLineupIds.has(String(x.id)));
      case 'team': return isMine(p);
      default: return true;
    }
  }

  // ---------- live now ----------
  S.lastPlay = new Map();   // gameId -> most recent play seen
  S.hot = new Map();        // gameId -> best PPR player seen today
  function notePlays(plays) {
    for (const p of plays) {
      const cur = S.lastPlay.get(p.gameId);
      if (!cur || p.seq > cur.seq) S.lastPlay.set(p.gameId, p);
      for (const x of p.players || []) {
        if (x.pos === 'DST' || x.gamePpr == null) continue;
        const h = S.hot.get(p.gameId);
        if (!h || x.gamePpr > h.gamePpr || (h.id === x.id && p.seq > (h.seq || 0))) S.hot.set(p.gameId, { ...x, seq: p.seq });
      }
    }
  }
  function liveCard(g) {
    const last = S.lastPlay.get(g.id);
    const possTeam = g.possession === g.home.id ? g.home : g.possession === g.away.id ? g.away : null;
    let field = '';
    if (last && possTeam && last.offense === possTeam.abbr && last.yte != null && !last.td && !last.scoring) {
      const yte = Math.max(1, Math.min(99, last.yte - (Number(last.yards) || 0)));
      const def = possTeam === g.home ? g.away.abbr : g.home.abbr;
      field = fieldBar({ start: 100 - yte, off: possTeam.abbr, def, label: `<span>${esc(possTeam.abbr)} ball · ${esc(spotName(yte, possTeam.abbr, def))}</span><b>${esc(g.downDistance || '')}</b>` });
    }
    const hot = S.hot.get(g.id);
    const side = (t, o) => `<div class="lc-team ${t.score < o.score ? 'trail' : ''}">${tlogo(t.abbr)}<span class="ab">${esc(t.abbr)}</span>${possTeam === t ? '<i class="lc-poss" title="Has the ball"></i>' : ''}<b>${t.score}</b></div>`;
    return `<a class="live-card ${g.redZone ? 'rz' : ''}" href="#/game/${esc(g.id)}" style="--a:${esc(g.away.color || '#555')};--h:${esc(g.home.color || '#555')}">
      <div class="lc-top"><span class="lc-live"><i></i>Live</span><span>${esc(g.detail || '')}</span>${g.redZone ? '<span class="lc-rz">Red zone</span>' : ''}<span class="lc-tv">${esc(g.broadcast || '')}</span></div>
      <div class="lc-score">${side(g.away, g.home)}${side(g.home, g.away)}</div>
      ${field}
      ${hot ? `<div class="lc-hot">${face(hot, 'face sm')}<span><small>Hottest right now</small>${esc(hot.name)}</span><b>${fmt(adjToday(hot))}</b></div>` : ''}
    </a>`;
  }
  function renderLive() {
    const el = $('#liveNow');
    if (!el) return;
    const live = isCurrentWeek() ? S.games.filter((g) => g.state === 'in') : [];
    el.hidden = !live.length;
    el.innerHTML = live.length ? `<div class="label lc-label"><i class="pulse"></i>Live now · ${live.length} game${live.length > 1 ? 's' : ''}</div><div class="live-grid">${live.map(liveCard).join('')}</div>` : '';
  }

  // ---------- feed view ----------
  async function loadFeed(append = false) {
    if (S.feed.loading) return;
    S.feed.loading = true;
    const qs = new URLSearchParams({ filter: S.feed.filter === 'team' ? 'all' : S.feed.filter, limit: 30 });
    if (S.feed.filter === 'team') {
      if (!S.myFantasyIds.size) { S.feed.plays = []; S.feed.next = null; S.feed.loading = false; renderFeedList(); return; }
      qs.set('players', [...S.myFantasyIds].join(','));
    }
    if (S.feed.game) qs.set('game', S.feed.game);
    else if (S.sel) qs.set('week', S.sel);
    if (append && S.feed.next) qs.set('before', S.feed.next);
    try {
      const r = await api(`/api/feed?${qs}`);
      S.feed.plays = append ? S.feed.plays.concat(r.plays) : r.plays;
      notePlays(r.plays);
      renderLive();
      S.feed.next = r.next;
      if (!append) S.pending = [];
      renderFeedList();
    } catch (e) { toast(e.message); }
    S.feed.loading = false;
  }
  function filterTabs() {
    return `<div class="pills" role="tablist" aria-label="Filter plays">${FILTERS.map(([k, l]) => `<button class="pill ${S.feed.filter === k ? 'on' : ''}" role="tab" aria-selected="${S.feed.filter === k}" data-act="filter" data-f="${k}">${l}</button>`).join('')}</div>`;
  }
  function pageHead(label, title, aside = '') {
    return `<div class="page-head"><div><div class="label">${label}</div><h1>${title}</h1></div>${aside ? `<div class="aside">${aside}</div>` : ''}</div>`;
  }
  const weekLabel = () => {
    const w = S.sel || S.week?.week;
    if (!w) return 'This week';
    const sw = S.schedule.find((x) => x.week === w);
    return `${sw?.label || `Week ${w}`} · ${S.week?.season || ''}`;
  };
  function renderFeedList() {
    const el = $('#feedList');
    if (!el) return;
    let html = '';
    if (S.pending.length) html += `<button class="new-plays" data-act="show-new">${S.pending.length} new play${S.pending.length > 1 ? 's' : ''}</button>`;
    if (!S.feed.plays.length) {
      const msg = S.feed.filter === 'mine'
        ? (S.me ? '<b>No plays from your lineup yet</b>Your players show up here as soon as they touch the ball. <a href="#/lineups">Build a lineup</a>' : '<b>Join to follow your lineup</b><a href="#" data-act="join">Pick a username</a>, then build a lineup.')
        : (() => {
          const next = S.games.filter((g) => g.state === 'pre').sort((a, b) => a.start - b.start)[0];
          return next && !S.games.some((g) => g.state !== 'pre')
            ? `<b>No plays yet</b>First kickoff ${esc(kickoff(next, true))}: ${esc(next.away.abbr)} @ ${esc(next.home.abbr)}. Plays appear here the second they happen.`
            : '<b>No plays yet</b>Plays appear here the second they happen.';
        })();
      html += `<div class="empty">${msg}</div>`;
    } else {
      html += S.feed.plays.map((p) => playCard(p)).join('');
      if (S.feed.next) html += '<button class="more" data-act="more">Load earlier plays</button>';
    }
    el.innerHTML = html;
  }
  function showFeed() {
    S.feed.game = null;
    const games = S.games.length, done = S.games.filter((g) => g.state === 'post').length;
    const aside = isCurrentWeek() ? 'Standard PPR · updated every play<br>Plays from ESPN · season stats from nflverse'
      : `Standard PPR · ${games} games${done && done < games ? `, ${done} final` : done ? ', all final' : ''}<br>Plays from ESPN · season stats from nflverse`;
    view.innerHTML = `${pageHead(`${weekLabel()}${isCurrentWeek() ? ' · Live' : ''}`, 'Every play, in PPR', `${aside}<div class="fmt-row">${fmtSeg()}</div>`)}<section id="liveNow" class="live-now" hidden></section>${filterTabs()}<div class="feed" id="feedList"></div>`;
    renderLive();
    loadFeed();
  }

  // ---------- game view ----------
  let gameTab = 'plays';
  function gameHeader(g) {
    const st = g.state === 'in' ? `<div class="st live">${esc(g.detail)}</div>` : `<div class="st">${g.state === 'post' ? 'Final' : esc(kickoff(g, true))}</div>`;
    const side = (t, o, r) => `<div class="gh-team ${r ? 'r' : ''} ${g.state === 'post' && t.score < o.score ? 'lose' : ''}"><a href="#/team/${encodeURIComponent(t.abbr)}" aria-label="${esc(t.name || t.abbr)} team page">${tlogo(t.abbr)}</a><div><div class="big">${g.state === 'pre' ? '' : t.score}</div><div class="nm"><a class="tlink" href="#/team/${encodeURIComponent(t.abbr)}">${esc(t.name)}</a> ${esc(t.record || '')}</div></div></div>`;
    return `<div class="game-head">${side(g.away, g.home)}<div class="gh-mid">${st}<div class="ln">${esc(lineText(g))}</div>${g.state === 'in' && g.downDistance ? `<div class="ln">${esc(g.downDistance)}</div>` : ''}</div>${side(g.home, g.away, true)}</div>`;
  }
  async function showGame(id) {
    if (!S.gamesById.has(id)) {
      // A game from another week: switch to that week first
      try {
        const { game } = await api(`/api/games/${encodeURIComponent(id)}`);
        if (game?.week && game.week !== S.sel) { S.sel = game.week; renderWeeks(); await refreshGames(); }
      } catch { /* not found */ }
    }
    const g = S.gamesById.get(id);
    if (!g) { view.innerHTML = '<div class="empty"><b>Game not found</b><a href="#/feed">Back to all plays</a></div>'; return; }
    S.feed.game = id;
    const tabs = [['plays', 'Plays'], ['fantasy', 'Fantasy'], ['picks', 'Picks']];
    view.innerHTML = `${gameHeader(g)}<div class="pills">${tabs.map(([k, l]) => `<button class="pill ${gameTab === k ? 'on' : ''}" data-act="gtab" data-t="${k}">${l}</button>`).join('')}</div><div id="gbody"></div>`;
    const body = $('#gbody');
    if (gameTab === 'plays') {
      body.innerHTML = `${filterTabs()}<div class="feed" id="feedList"></div>`;
      loadFeed();
    } else if (gameTab === 'fantasy') {
      const r = await api(`/api/games/${encodeURIComponent(id)}/fantasy`);
      const wp = r.homeWp != null ? `<div class="wp-bar" aria-label="Win probability"><i style="width:${100 - r.homeWp}%;background:${esc(g.away.color || '#888')}"></i><i style="width:${r.homeWp}%;background:${esc(g.home.color || '#ccc')}"></i></div>
        <div class="wp-label"><span>${esc(g.away.abbr)} ${fmt(100 - r.homeWp)}%</span><span>Win probability</span><span>${esc(g.home.abbr)} ${fmt(r.homeWp)}%</span></div>` : '';
      body.innerHTML = `${wp}<table class="box"><thead><tr><th>Player</th><th class="num">Season avg</th><th class="num">PPR today</th></tr></thead><tbody>
        ${r.players.map((p) => `<tr><td><div class="nm">${esc(p.name)}<span class="pos">${esc(p.pos)} · ${tlink(p.team)}</span></div><div class="sub">${esc(p.line)}</div></td><td class="num sub">${p.ppg != null ? `${fmt(p.ppg)}/g` : ''}</td><td class="num pp">${fmt(p.ppr)}</td></tr>`).join('')
          || '<tr><td colspan="3" class="sub">Fantasy points show up once the game kicks off.</td></tr>'}
      </tbody></table>`;
    } else {
      body.innerHTML = pickGame(g);
    }
  }

  // ---------- picks ----------
  function pickGame(g) {
    const mine = Object.fromEntries((g.myPicks || []).map((p) => [p.market, p]));
    const open = g.pickOpen;
    const split = (m, sel) => {
      const s = g.splits?.[m] || {};
      const tot = Object.values(s).reduce((a, b) => a + b, 0);
      return tot ? `${Math.round((s[sel] || 0) / tot * 100)}% picked` : '';
    };
    const opt = (m, sel, label) => {
      const on = mine[m]?.selection === sel;
      return `<button class="opt ${on ? 'on' : ''}" ${open ? '' : 'disabled'} data-act="pick" data-game="${esc(g.id)}" data-m="${m}" data-sel="${esc(sel)}" aria-pressed="${on}">${esc(label)}<small>${split(m, sel)}</small></button>`;
    };
    const res = (m) => {
      const p = mine[m];
      if (!p || !p.result) return '';
      const txt = p.result === 'win' ? `Won · +${p.delta} credits` : p.result === 'loss' ? `Lost · ${p.delta} credits` : 'Push · no change';
      return `<span class="result ${p.result}">${esc(txt)}</span>`;
    };
    if (!g.odds) return `<div class="pick-game"><div class="pg-top"><h3>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</h3><span class="when">${gameStatus(g)}</span></div><p class="rules">No line posted yet.</p></div>`;
    const sp = (t) => (!g.odds.fav ? 'PK' : t === g.odds.fav ? `−${g.odds.spread}` : `+${g.odds.spread}`);
    const locked = !open && g.state === 'pre' ? '' : !open ? ' · locked' : '';
    return `<div class="pick-game">
      <div class="pg-top"><h3><a href="#/game/${esc(g.id)}" style="color:inherit">${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</a></h3><span class="when">${gameStatus(g)}${locked}</span></div>
      <div class="markets">
        <div class="market"><span class="lbl">Spread${mine.spread && !open ? ` · your line ${mine.spread.selection === mine.spread.fav ? '−' : '+'}${mine.spread.line}` : ''}</span>${opt('spread', g.away.abbr, `${g.away.abbr} ${sp(g.away.abbr)}`)}${opt('spread', g.home.abbr, `${g.home.abbr} ${sp(g.home.abbr)}`)}${res('spread')}</div>
        <div class="market"><span class="lbl">Total points</span>${opt('total', 'over', `Over ${g.odds.total}`)}${opt('total', 'under', `Under ${g.odds.total}`)}${res('total')}</div>
      </div>
    </div>`;
  }
  async function showPicks() {
    const me = S.me;
    view.innerHTML = `${pageHead(weekLabel(), 'Free picks', 'Vegas spread and total<br>Free to play · picks lock at kickoff')}
      ${me ? `<div class="wallet"><div><b class="amber">${me.credits.toLocaleString()}</b><span>Credits</span></div><div><b>#${me.rank}</b><span>${esc(me.tier)}</span></div><div><b>${me.record.w}-${me.record.l}${me.record.p ? `-${me.record.p}` : ''}</b><span>Record</span></div></div>` : ''}
      <p class="rules">Pick against the Vegas spread and total. Right pick +100 credits, wrong pick −50, push 0. Picks lock at kickoff. Credits decide your rank.</p>
      <div id="pickList"></div>`;
    await refreshGames();
    $('#pickList').innerHTML = S.games.map(pickGame).join('') || '<div class="empty"><b>No games this week yet</b></div>';
  }
  async function refreshGames() {
    const r = await api(`/api/games${S.sel ? `?week=${S.sel}` : ''}`);
    S.week = r.week; S.demo = r.demo;
    if (!S.sel) S.sel = r.selected || r.week?.week;
    $('#demoBanner').hidden = !r.demo;
    setGames(r.games);
  }

  // ---------- lineups ----------
  const SLOT_POS = { QB: ['QB'], RB1: ['RB'], RB2: ['RB'], WR1: ['WR'], WR2: ['WR'], WR3: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'] };
  const SLOT_LABEL = { QB: 'QB', RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', WR3: 'WR', TE: 'TE', FLEX: 'FLEX' };
  async function showLineups() {
    view.innerHTML = `${pageHead(weekLabel(), 'Weekly lineups', `$${(S.slate?.cap || 50000).toLocaleString()} cap · QB, 2 RB, 3 WR, TE, FLEX<br>Scored live in PPR`)}
      <div class="pills"><button class="pill ${S.luTab === 'build' ? 'on' : ''}" data-act="lutab" data-t="build">My lineup</button><button class="pill ${S.luTab === 'top' ? 'on' : ''}" data-act="lutab" data-t="top">Top lineups</button></div>
      <div id="luBody"></div>`;
    if (S.luTab === 'top') return renderTopLineups();
    if (!S.slate) S.slate = await api('/api/slate');
    S.slateById = new Map(S.slate.players.map((p) => [p.id, p]));
    if (S.me && !Object.keys(S.draft).length) {
      const { lineup } = await api('/api/lineups/me');
      if (lineup) { S.draft = Object.fromEntries(lineup.players.map((p) => [p.slot, String(p.id)])); S.savedLineup = lineup; }
    }
    renderBuilder();
  }
  function draftSalary() { return Object.values(S.draft).reduce((s, id) => s + (S.slateById.get(id)?.salary || 0), 0); }
  function renderBuilder() {
    const cap = S.slate.cap;
    const used = draftSalary();
    const over = used > cap;
    const filled = S.slate.slots.filter((s) => S.draft[s]).length;
    const left = cap - used;
    const openSlots = S.slate.slots.filter((s) => !S.draft[s]).length;
    const live = S.savedLineup ? new Map(S.savedLineup.players.map((p) => [String(p.id), p])) : new Map();
    const slots = S.slate.slots.map((slot) => {
      const p = S.slateById.get(S.draft[slot]);
      if (!p) return `<div class="slot empty-slot"><span class="sl">${SLOT_LABEL[slot]}</span><span class="nm">${slot === 'FLEX' ? 'RB, WR or TE' : `Add a ${SLOT_LABEL[slot]}`}</span><span></span></div>`;
      const lv = live.get(p.id);
      const right = lv && lv.gameState !== 'pre' ? `<span class="pp">${fmt(lv.points)}</span>` : `<span class="sal">${money(p.salary)}</span>`;
      return `<button class="slot" data-act="remove" data-slot="${slot}" ${p.locked ? 'disabled title="Game started: locked"' : 'title="Remove"'}><span class="sl">${SLOT_LABEL[slot]}</span><span class="nm">${esc(p.name)}${p.locked ? ' 🔒' : ''}<small>${esc(p.team)} ${p.home ? 'vs' : '@'} ${esc(p.opp)}${lv?.line ? ` · ${esc(lv.line)}` : ''}</small></span>${right}</button>`;
    }).join('');
    const pool = S.slate.players
      .filter((p) => (S.pos === 'ALL' || p.pos === S.pos) && (!S.q || p.name.toLowerCase().includes(S.q) || p.team.toLowerCase() === S.q))
      .sort((a, b) => (S.sort === 'ppg' ? b.ppg - a.ppg : S.sort === 'value' ? b.ppg / b.salary - a.ppg / a.salary : b.salary - a.salary));
    const inLineup = new Set(Object.values(S.draft));
    const rows = pool.slice(0, 150).map((p) => {
      const isIn = inLineup.has(p.id);
      const canAdd = !p.locked && !isIn && S.slate.slots.some((s) => !S.draft[s] && S.slate.slotPos[s].includes(p.pos));
      return `<div class="prow">${p.headshot ? `<img src="${esc(p.headshot)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;ph&quot;></div>'">` : '<div class="ph"></div>'}
        <div class="nm">${esc(p.name)} <small>${esc(p.pos)} · ${esc(p.team)} ${p.home ? 'vs' : '@'} ${esc(p.opp)} · ${fmt(p.ppg)} PPR/g${p.tgtShare && p.pos !== 'QB' ? ` · ${fmt(p.tgtShare, 0)}% tgt` : ''}${p.locked ? ' · 🔒 started' : ''}</small></div>
        <div class="sal">${money(p.salary)}<small>${fmt(p.ppg / (p.salary / 1000), 2)} pts/$1k</small></div>
        <button class="add-btn ${isIn ? 'in' : ''}" data-act="${isIn ? 'unpick' : 'add'}" data-pid="${esc(p.id)}" ${isIn || canAdd ? '' : 'disabled'} aria-label="${isIn ? 'Remove' : 'Add'} ${esc(p.name)}">${isIn ? '✓' : '+'}</button></div>`;
    }).join('');
    $('#luBody').innerHTML = `<div class="lu-grid build">
      <div class="slots-col">
        <div class="cap"><div class="cap-row"><span>${over ? 'Over the cap by' : 'Salary left'}</span><b class="${over ? 'over' : ''}">${money(Math.abs(left))}</b></div>
          <div class="cap-bar"><i class="${over ? 'over' : ''}" style="width:${Math.min(100, used / cap * 100)}%"></i></div>
          <div class="cap-row" style="margin-top:6px"><span>${filled}/${S.slate.slots.length} filled</span><span>${openSlots ? `${money(Math.max(0, Math.floor(left / openSlots / 100) * 100))} per open spot` : ''}</span></div></div>
        <div class="slots">${slots}</div>
        <div class="save-row"><button class="btn" data-act="save-lineup" ${filled === S.slate.slots.length && !over ? '' : 'disabled'}>Save lineup</button>
          <button class="btn ghost" data-act="clear-lineup">Clear</button></div>
      </div>
      <div>
        <div class="pills seg">${['ALL', 'QB', 'RB', 'WR', 'TE'].map((x) => `<button class="pill ${S.pos === x ? 'on' : ''}" data-act="pos" data-p="${x}">${x === 'ALL' ? 'All' : x}</button>`).join('')}</div>
        <div class="pool-tools">
          <select id="sortSel" aria-label="Sort">${[['salary', 'Salary'], ['ppg', 'PPR per game'], ['value', 'Value (pts per $1k)']].map(([k, l]) => `<option ${S.sort === k ? 'selected' : ''} value="${k}">Sort: ${l}</option>`).join('')}</select>
          <input id="qInp" type="search" placeholder="Search player or team" value="${esc(S.q)}">
        </div>
        <div class="pool">${rows || '<div class="empty">No players match.</div>'}</div>
      </div>
    </div>`;
    $('#sortSel').onchange = (e) => { S.sort = e.target.value; renderBuilder(); };
    const q = $('#qInp');
    q.oninput = (e) => { S.q = e.target.value.trim().toLowerCase(); clearTimeout(q._t); q._t = setTimeout(() => { renderBuilder(); const n = $('#qInp'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200); };
  }
  function lineupTable(l) {
    return `<table class="box"><tbody>${l.players.map((p) => `<tr><td style="width:44px" class="sub">${SLOT_LABEL[p.slot]}</td><td><div class="nm">${esc(p.name)} <span class="sub">${esc(p.team)}</span></div><div class="sub">${p.gameState === 'pre' ? 'Not started' : esc(p.line || 'No stats yet')}</div></td><td class="num sub">${money(p.salary)}</td><td class="num pp">${fmt(p.points)}</td></tr>`).join('')}</tbody></table>`;
  }
  async function renderTopLineups() {
    const r = await api('/api/lineups');
    const el = $('#luBody');
    if (!el) return;
    el.innerHTML = `${r.popular.length ? `<p class="rules">Most rostered this week</p><div class="popular">${r.popular.map((p) => `<span>${esc(p.name)} <b>${p.pct}%</b></span>`).join('')}</div>` : ''}
      ${r.lineups.map((l) => `<details class="lu-card ${l.me ? 'me' : ''}" ${l.rank <= 1 || l.me ? 'open' : ''}><summary><span class="rk">${l.rank}</span><span class="nm">${esc(l.name)}<small>${money(l.salary)} salary</small></span><span class="tot">${fmt(l.points)}</span></summary>${lineupTable(l)}</details>`).join('')
        || '<div class="empty"><b>No lineups yet</b>Be the first: build yours under My lineup.</div>'}`;
  }
  function addToDraft(id) {
    const p = S.slateById.get(id);
    if (!p) return;
    const order = S.slate.slots.filter((s) => s !== 'FLEX').concat('FLEX');
    const slot = order.find((s) => !S.draft[s] && S.slate.slotPos[s].includes(p.pos));
    if (!slot) return toast(`No open spot for a ${p.pos}.`);
    S.draft[slot] = id;
    renderBuilder();
  }

  // ---------- players ----------
  // Every player's PPR points this week, live. Position buttons + search; your lineup players are marked.
  S.pl = { pos: 'ALL', q: '', rows: [], at: 0 };
  const kick = (ms) => ms ? new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  async function showPlayers() {
    view.innerHTML = `${pageHead(weekLabel(), 'Players', `Every player's fantasy points<br>Updates live with each play<div class="fmt-row">${fmtSeg()}</div>`)}
      <div class="pills seg" id="plPos">${['ALL', 'QB', 'RB', 'WR', 'TE'].map((x) => `<button class="pill ${S.pl.pos === x ? 'on' : ''}" data-p="${x}">${x === 'ALL' ? 'All' : x}</button>`).join('')}</div>
      <div class="pool-tools"><input id="plQ" type="search" placeholder="Search player or team" value="${esc(S.pl.q)}"></div>
      <div id="plList"><div class="empty">Loading players…</div></div>`;
    $('#plPos').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      S.pl.pos = b.dataset.p; $('#plPos').querySelectorAll('.pill').forEach((x) => x.classList.toggle('on', x === b)); drawPlayers();
    });
    $('#plQ').addEventListener('input', (e) => { S.pl.q = e.target.value; drawPlayers(); });
    await loadPlayers();
  }
  async function loadPlayers() {
    try {
      const r = await api(`/api/players${S.sel ? `?week=${S.sel}` : ''}`);
      S.pl.rows = r.players || []; S.pl.at = Date.now();
    } catch { S.pl.rows = S.pl.rows || []; }
    drawPlayers();
  }
  function drawPlayers() {
    const list = $('#plList'); if (!list) return;
    const q = S.pl.q.trim().toLowerCase();
    const rows = S.pl.rows.filter((p) => (S.pl.pos === 'ALL' || p.pos === S.pl.pos) && (!q || `${p.name} ${p.team}`.toLowerCase().includes(q)))
      .map((p) => ({ ...p, pts: fpts(p) })).sort((a, b) => b.pts - a.pts || (b.ppg || 0) - (a.ppg || 0)).slice(0, 200);
    list.innerHTML = rows.length ? `<table class="box players"><thead><tr><th style="width:36px">#</th><th>Player</th><th class="num">Avg</th><th class="num">${unit()}</th></tr></thead><tbody>
      ${rows.map((p, i) => `<tr class="${S.myLineupIds.has(String(p.id)) || S.myFantasyIds.has(String(p.id)) ? 'mine' : ''}"><td class="sub">${i + 1}</td>
        <td><div class="nm">${face(p, 'face sm')}<span><button class="plink" data-act="player" data-pid="${esc(p.id)}">${esc(p.name)}</button>${p.inj ? ` <span class="inj">${esc(p.inj)}</span>` : ''}<span class="pos">${esc(p.pos)} · ${tlink(p.team)}${p.opp ? ` ${p.home ? 'vs' : '@'} ${tlink(p.opp)}` : ''}</span></span></div>
        <div class="sub">${esc(p.line || (p.gameState === 'pre' ? (p.kickoff ? `Kicks off ${kick(p.kickoff)}` : 'Not started') : p.gameState === 'post' ? 'Final' : ''))}</div></td>
        <td class="num sub">${p.ppg != null ? fmt(p.ppg) : '—'}</td><td class="num pp">${fmt(p.pts || 0)}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">${S.pl.rows.length ? 'No players match.' : '<b>No players yet</b>They show up once this week\'s slate loads.'}</div>`;
  }

  // ---------- one team ----------
  S.tm = { pos: 'ALL', sort: 'season', view: 'points' };
  function currentTeam() { const m = location.hash.match(/^#\/team\/([^/]+)/); return m ? decodeURIComponent(m[1]).toUpperCase() : null; }
  async function showTeam(abbr) {
    view.innerHTML = '<div class="empty">Loading team…</div>';
    await loadTeam(abbr);
  }
  async function loadTeam(abbr = currentTeam()) {
    if (!abbr) return;
    try { S.tm.data = await api(`/api/teams/${encodeURIComponent(abbr)}${S.sel ? `?week=${S.sel}` : ''}`); S.tm.abbr = abbr; }
    catch (e) { view.innerHTML = `<div class="empty"><b>Team not found</b>${esc(e.message)}<a href="#/players">All players</a></div>`; return; }
    drawTeam();
  }
  // Season points in the chosen format: season PPR minus the reception points the format doesn't give.
  const seasonPts = (p) => p.seasonPpr - (p.seasonRec || 0) * (1 - recVal());
  function drawTeam() {
    const d = S.tm.data; if (!d || currentRoute() !== 'team') return;
    const t = d.team || teamInfo(d.abbr), g = d.game;
    const opp = g ? (g.home.abbr === d.abbr ? g.away : g.home) : null;
    const status = g ? (g.state === 'in' ? `<span class="tp-live"><i></i>${esc(g.detail || 'Live')}</span>` : g.state === 'post' ? 'Final' : esc(kickoff(g, true))) : '';
    const mine = g ? (g.home.abbr === d.abbr ? g.home : g.away) : null;
    const gameLine = g ? `<a class="tp-game" href="#/game/${esc(g.id)}">${g.home.abbr === d.abbr ? 'vs' : '@'} ${tlogo(opp.abbr)}<b>${esc(opp.abbr)}</b>${g.state !== 'pre' ? `<span class="tp-sc">${mine.score}–${opp.score}</span>` : ''}<span class="sub">${status}</span></a>` : '<span class="sub">No game this week</span>';
    const rows = d.players.filter((p) => S.tm.pos === 'ALL' || p.pos === S.tm.pos)
      .map((p) => ({ ...p, wk: fpts(p), sea: d.college ? 0 : seasonPts(p) }))
      .map((p) => ({ ...p, tot: p.sea + p.wk, avg: (p.games + (p.played ? 1 : 0)) ? (p.sea + p.wk) / (p.games + (p.played ? 1 : 0)) : 0 }))
      .sort((a, b) => S.tm.sort === 'week' || d.college ? b.wk - a.wk || b.tot - a.tot : b.tot - a.tot || b.wk - a.wk);
    const teamWk = rows.reduce((a, p) => a + p.wk, 0);
    const pos = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'].filter((x) => x === 'ALL' || d.players.some((p) => p.pos === x));
    const sortBtn = (k, l) => `<button class="pill ${S.tm.sort === k ? 'on' : ''}" data-act="tmsort" data-v="${k}">${l}</button>`;
    const viewBtn = (k, l) => `<button class="pill ${S.tm.view === k ? 'on' : ''}" data-act="tmview" data-v="${k}">${l}</button>`;
    const usage = S.tm.view === 'usage';
    // Usage view: most involved this game first, then by recent snap share.
    if (usage) rows.sort((a, b) => ((b.tgtShare || 0) + (b.carShare || 0)) - ((a.tgtShare || 0) + (a.carShare || 0)) || (b.snap3 || 0) - (a.snap3 || 0));
    const share = (n, pct, of) => n || pct ? `<span class="tp-share"><b>${pct ?? 0}%</b><i><i style="width:${Math.min(100, pct || 0)}%"></i></i><small>${n} of ${of}</small></span>` : '<span class="sub">–</span>';
    const pctCell = (v, sub) => v != null ? `<b class="tp-pct">${v}%</b>${sub ? `<small class="sub tp-sub">${sub}</small>` : ''}` : '<span class="sub">–</span>';
    const started = g && g.state !== 'pre';
    const usageTable = () => `<div class="tp-scroll"><table class="box players tp-table tp-usage"><thead><tr><th>Player</th><th class="num">${d.byCatches ? 'Catch share' : 'Target share'}</th><th class="num">Rush share</th>${d.college ? '' : '<th class="num">Snaps last game</th><th class="num">Snaps · 3 games</th><th class="num">Season tgt share</th>'}</tr></thead><tbody>
        ${rows.map((p) => `<tr class="${S.myLineupIds.has(String(p.id)) || S.myFantasyIds.has(String(p.id)) ? 'mine' : ''}">
          <td><div class="nm">${face(p, 'face sm')}<span><button class="plink" data-act="player" data-pid="${esc(p.id)}">${esc(p.name)}</button><span class="pos">${esc(p.pos || '')}</span></span></div></td>
          <td class="num">${started ? share(p.tgt, p.tgtShare, d.teamTgt) : '<span class="sub">–</span>'}</td>
          <td class="num">${started ? share(p.car, p.carShare, d.teamCar) : '<span class="sub">–</span>'}</td>
          ${d.college ? '' : `<td class="num">${pctCell(p.snapLast, p.snapLastWeek ? `Wk ${p.snapLastWeek}` : '')}</td><td class="num">${pctCell(p.snap3)}</td><td class="num">${pctCell(p.seasonTgtShare != null ? Math.round(p.seasonTgtShare) : null)}</td>`}</tr>`).join('')}
      </tbody></table></div>
      <p class="rules tp-note">${d.byCatches ? 'Catch' : 'Target'} and rush shares update live with each play. ${d.byCatches ? 'College box scores don’t list targets, so this uses catches. ' : ''}${d.college ? '' : 'Snap counts are official NFL numbers, posted the day after each game, so they run through last week.'}</p>`;
    view.innerHTML = `<div class="tp-head" style="--tc:${esc(t.color || '#33415a')}">
        <div class="tp-id">${tlogo(d.abbr)}<div><div class="label">${esc(weekLabel())}${d.college ? ' · College' : ''}</div><h1>${esc(t.name || d.abbr)}</h1><div class="sub">${esc(t.record || '')}</div></div></div>
        <div class="tp-side">${gameLine}<div class="tp-total"><b>${fmt(teamWk)}</b> ${unit()} this week</div><div class="fmt-row">${fmtSeg()}</div></div>
      </div>
      <div class="tp-bar"><div class="pills seg" id="tmPos">${pos.map((x) => `<button class="pill ${S.tm.pos === x ? 'on' : ''}" data-p="${x}">${x === 'ALL' ? 'All' : x}</button>`).join('')}</div>
        <div class="tp-bar-r"><div class="pills seg">${viewBtn('points', 'Points')}${viewBtn('usage', 'Usage')}</div>${d.college || usage ? '' : `<div class="pills seg">${sortBtn('season', 'Season')}${sortBtn('week', 'This week')}</div>`}</div></div>
      ${rows.length && usage ? usageTable() : rows.length ? `<div class="tp-scroll"><table class="box players tp-table"><thead><tr><th>Player</th><th class="num">${d.college ? unit() : 'This week'}</th>${d.college ? '' : '<th class="num">Season</th><th class="num">Per game</th><th class="num gp">GP</th>'}</tr></thead><tbody>
        ${rows.map((p) => `<tr class="${S.myLineupIds.has(String(p.id)) || S.myFantasyIds.has(String(p.id)) ? 'mine' : ''}">
          <td><div class="nm">${face(p, 'face sm')}<span><button class="plink" data-act="player" data-pid="${esc(p.id)}">${esc(p.name)}</button><span class="pos">${esc(p.pos || '')}</span></span></div>
          <div class="sub">${esc(p.line || (p.played ? '' : g && g.state === 'pre' ? 'Not started' : g ? 'No stats' : ''))}</div></td>
          <td class="num ${d.college ? 'pp' : ''}">${p.played || (g && g.state !== 'pre') ? fmt(p.wk) : '–'}</td>
          ${d.college ? '' : `<td class="num pp">${fmt(p.tot)}</td><td class="num sub">${fmt(p.avg)}</td><td class="num sub gp">${p.games + (p.played ? 1 : 0)}</td>`}</tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No fantasy points for this team yet.</div>'}
      ${d.others?.length ? `<div class="tp-others"><span class="label">Other teams this week</span><div>${d.others.map((x) => `<a class="tp-chip" href="#/team/${encodeURIComponent(x)}">${tlogo(x)}${esc(x)}</a>`).join('')}</div></div>` : ''}`;
    $('#tmPos').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; S.tm.pos = b.dataset.p; drawTeam(); });
  }

  // ---------- one player's day ----------
  async function openPlayer(pid) {
    openSheet('Player', '<div class="empty">Loading…</div>');
    try {
      const [{ plays }, pl] = await Promise.all([api(`/api/feed?player=${encodeURIComponent(pid)}&limit=100${S.sel ? `&week=${S.sel}` : ''}`), api(`/api/players${S.sel ? `?week=${S.sel}` : ''}`)]);
      const row = pl.players.find((p) => String(p.id) === String(pid));
      const me = plays.map((p) => p.players.find((x) => String(x.id) === String(pid))).find(Boolean);
      const info = row || me || { name: 'Player' };
      $('#sheetTitle').textContent = info.name;
      let run = 0;
      const items = plays.slice().reverse().map((p) => { const x = p.players.find((y) => String(y.id) === String(pid)); const v = x ? adj(x) : 0; run += v; return { p, v, run }; }).reverse();
      const total = row ? fpts(row) : run;
      $('#sheetBody').innerHTML = `<div class="pl-head">${face(info)}<div><div class="label">${esc([info.pos, info.team].filter(Boolean).join(' · '))}${row?.inj ? ` · <span class="inj">${esc(row.inj)}</span>` : ''}</div><div class="pl-total"><b>${fmt(total)}</b> ${unit()} this week</div><div class="sub">${esc(row?.line || '')}</div></div></div>
        ${items.length ? `<div class="pl-plays">${items.map(({ p, v, run: r }) => `<button class="pl-play" data-act="comments" data-id="${esc(p.id)}"><span class="q">Q${p.period} ${esc(p.clock)}</span><span class="h">${esc(p.headline)}</span><b class="${v < 0 ? 'minus' : v === 0 ? 'zero' : ''}">${signed(v, 1)}</b><small>${fmt(r)}</small></button>`).join('')}</div>` : '<p class="rules">No plays yet this week.</p>'}`;
    } catch (e) { $('#sheetBody').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  // ---------- score alerts for your players ----------
  function alertFor(p) {
    if (!S.alerts || !S.myFantasyIds.size) return;
    if (!S.alerted) S.alerted = new Set();
    if (S.alerted.has(p.id)) return;
    S.alerted.add(p.id);
    const x = p.players?.find((y) => S.myFantasyIds.has(String(y.id)));
    if (!x) return;
    const v = adj(x);
    if (!(p.td || v >= 4 || v <= -2)) return;
    const title = `${x.name} ${signed(v, 1)} ${unit()}`;
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body: p.headline, tag: p.id }); } catch { /* ignore */ }
    } else toast(`${title}: ${p.headline}`);
  }

  // ---------- ranks ----------
  async function showRanks() {
    const r = await api('/api/leaderboard');
    view.innerHTML = `${pageHead('Season · free picks', 'Ranks', 'Ranked by credits<br>Everyone starts with 1,000')}
      <table class="box ranks"><thead><tr><th style="width:44px">#</th><th>Player</th><th class="num">Record</th><th class="num">Credits</th></tr></thead><tbody>
      ${r.rows.map((u) => `<tr class="${u.me ? 'me' : ''}"><td>${u.rank}</td><td><div class="nm">${esc(u.name)}</div><div class="tier">${esc(u.tier)}</div></td><td class="num">${u.record.w}-${u.record.l}${u.record.p ? `-${u.record.p}` : ''}</td><td class="num pp">${u.credits.toLocaleString()}</td></tr>`).join('')
        || '<tr><td colspan="4" class="sub">No one has joined yet.</td></tr>'}
      </tbody></table>`;
  }

  // ---------- sidebar ----------
  async function renderSide() {
    const side = $('#side');
    if (getComputedStyle(side).display === 'none') return;
    const [leaders, mine, board] = await Promise.all([
      api(`/api/leaders${S.sel ? `?week=${S.sel}` : ''}`).catch(() => null),
      S.me ? api('/api/lineups/me').catch(() => null) : null,
      api('/api/leaderboard').catch(() => null),
    ]);
    let html = '';
    if (leaders) {
      const top = leaders.players[0]?.ppr || 1;
      html += `<section><span class="label">${esc(weekLabel())} · PPR leaders</span>${leaders.players.slice(0, 8).map((p, i) => `<div class="mini lead ${S.myLineupIds.has(String(p.id)) ? 'mine' : ''} ${i === 0 ? 'first' : ''}">${face(p, 'face sm')}<span class="who">${esc(p.name)}<small>${esc(p.pos)} · ${esc(p.team)}</small><i class="lead-bar"><i style="width:${Math.max(4, Math.round(p.ppr / top * 100))}%"></i></i></span><span class="v amber">${fmt(p.ppr)}</span></div>`).join('')
        || '<p>Leaders show up once games kick off.</p>'}<a class="foot" href="#/feed">All plays →</a></section>`;
    }
    if (S.me) {
      const lineup = mine?.lineup;
      html += lineup
        ? `<section><span class="label">My lineup · live</span>${lineup.players.map((p) => `<div class="mini"><em>${esc(SLOT_LABEL[p.slot])}</em><span class="who">${esc(p.name)}</span><span class="v ${p.gameState !== 'pre' ? 'amber' : ''}">${p.gameState === 'pre' ? '–' : fmt(p.points)}</span></div>`).join('')}
            <div class="total"><span class="label" style="margin:0">Total PPR</span><b>${fmt(lineup.points)}</b></div></section>`
        : `<section><span class="label">My lineup</span><h2>Build this week's team</h2><p>Pick eight players under the $50,000 cap. They score live with every play.</p><a class="btn" href="#/lineups">Build lineup</a></section>`;
    } else {
      html += '<section><span class="label">Play along</span><h2>Join free</h2><p>Pick a username to react to plays, make free picks and build a weekly lineup.</p><button class="btn" data-act="join">Join free</button></section>';
    }
    if (board) {
      html += `<section><span class="label">Top pickers</span>${board.rows.slice(0, 5).map((u) => `<div class="mini"><em>${u.rank}</em><span class="who">${esc(u.name)}<small>${esc(u.tier)}</small></span><span class="v amber">${u.credits.toLocaleString()}</span></div>`).join('') || '<p>No one yet.</p>'}<a class="foot" href="#/ranks">All ranks →</a></section>`;
    }
    html += '<section><span class="label">How plays are scored</span><p style="margin:0">Standard PPR: 1 per catch, 0.1 per rushing or receiving yard, 0.04 per passing yard, 6 per rushing or receiving TD, 4 per passing TD, −2 per interception or lost fumble. EPA is a live estimate; win probability comes from ESPN.</p></section>';
    side.innerHTML = html;
  }

  // ---------- comments sheet ----------
  function openSheet(title, html) {
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = html;
    $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    S.sheetPlay = null;
    S.sheetObj = null;
    S.czOpen = false;
    document.body.style.overflow = '';
  }
  async function openComments(id) {
    S.sheetPlay = id;
    openSheet('Comments', '<div class="empty">Loading…</div>');
    try {
      const [{ play }, { comments }] = await Promise.all([api(`/api/plays/${encodeURIComponent(id)}`), api(`/api/plays/${encodeURIComponent(id)}/comments`)]);
      S.sheetObj = play;
      $('#sheetBody').innerHTML = `${playCard(play, { full: true })}
        <form class="cmt-form" id="cmtForm"><input id="cmtInp" maxlength="500" placeholder="${S.me ? 'Add a comment' : 'Join to comment'}" aria-label="Comment"><button class="btn" type="submit">Post</button></form>
        <div id="cmtList">${comments.map(cmtHtml).join('') || '<p class="rules" id="noCmt">No comments yet. Start the thread.</p>'}</div>`;
      $('#cmtForm').onsubmit = async (e) => {
        e.preventDefault();
        if (!requireUser(() => openComments(id))) return;
        const inp = $('#cmtInp');
        const body = inp.value.trim();
        if (!body) return;
        try {
          await api(`/api/plays/${encodeURIComponent(id)}/comments`, { method: 'POST', body: { body } });
          inp.value = '';
        } catch (err) { toast(err.message); }
      };
    } catch (e) { $('#sheetBody').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  function cmtHtml(c) {
    return `<div class="cmt"><div class="by">${esc(c.name)}<span>${ago(c.created_at)}</span></div><p>${esc(c.body)}</p></div>`;
  }

  // ---------- social updates ----------
  function findPlay(id) {
    return S.feed.plays.find((x) => x.id === id) || S.pending.find((x) => x.id === id) || (S.sheetObj?.id === id ? S.sheetObj : null);
  }
  function applySocial(id, social, keepMine = true) {
    const targets = [S.feed.plays.find((x) => x.id === id), S.pending.find((x) => x.id === id), S.sheetObj?.id === id ? S.sheetObj : null].filter(Boolean);
    for (const p of targets) {
      const mine = p.social?.mine || [];
      const myVote = p.social?.myVote || 0;
      p.social = { ...social, mine: keepMine ? mine : social.mine, myVote: keepMine ? myVote : social.myVote };
    }
    rerenderActions(id);
  }

  // ---------- events ----------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act], [data-close]');
    if (!t) {
      if (S.pickerFor && !e.target.closest('.picker')) { const id = S.pickerFor; S.pickerFor = null; rerenderActions(id); }
      return;
    }
    if (t.hasAttribute('data-close')) return closeSheet();
    const act = t.dataset.act;
    const id = t.dataset.id;
    try {
      switch (act) {
        case 'go': location.hash = t.dataset.href; break;
        case 'tmsort': S.tm.sort = t.dataset.v; drawTeam(); break;
        case 'tmview': S.tm.view = t.dataset.v; drawTeam(); break;
        case 'week': selectWeek(Number(t.dataset.w)); break;
        case 'cz': setSetting(t.dataset.k, t.dataset.v); break;
        case 'join': e.preventDefault(); requireUser(); break;
        case 'filter': S.feed.filter = t.dataset.f; document.querySelectorAll('[data-act="filter"]').forEach((b) => { b.classList.toggle('on', b === t); b.setAttribute('aria-selected', b === t); }); if (S.feed.filter === 'mine') await loadMyLineupIds(); loadFeed(); break;
        case 'more': loadFeed(true); break;
        case 'show-new': S.feed.plays = S.pending.concat(S.feed.plays); S.pending = []; renderFeedList(); window.scrollTo({ top: 0 }); break;
        case 'gtab': gameTab = t.dataset.t; showGame(S.feed.game); break;
        case 'picker': S.pickerFor = S.pickerFor === id ? null : id; rerenderActions(id); break;
        case 'react': {
          if (!requireUser()) return;
          S.pickerFor = null;
          const r = await api(`/api/plays/${encodeURIComponent(id)}/react`, { method: 'POST', body: { emoji: t.dataset.e } });
          applySocial(id, r.social, false);
          break;
        }
        case 'vote': {
          if (!requireUser()) return;
          const cur = findPlay(id)?.social?.myVote || 0;
          const v = Number(t.dataset.v) === cur ? 0 : Number(t.dataset.v);
          const r = await api(`/api/plays/${encodeURIComponent(id)}/vote`, { method: 'POST', body: { value: v } });
          applySocial(id, r.social, false);
          break;
        }
        case 'comments': openComments(id); break;
        case 'player': e.preventDefault(); openPlayer(t.dataset.pid); break;
        case 'fmt': {
          S.fmt = t.dataset.v; ls.set('sl-scoring', S.fmt); ls.set('sl-scoring-set', '1');
          document.querySelectorAll('.fmt-seg button').forEach((b) => { b.classList.toggle('on', b.dataset.v === S.fmt); b.setAttribute('aria-checked', b.dataset.v === S.fmt); });
          if ($('#feedList')) renderFeedList();
          if ($('#plList')) drawPlayers();
          if (currentRoute() === 'team') drawTeam();
          renderLive();
          break;
        }
        case 'alerts': {
          if (!S.alerts && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* ignore */ } }
          S.alerts = !S.alerts; ls.set('sl-alerts', S.alerts ? '1' : null);
          t.classList.toggle('on', S.alerts); t.textContent = S.alerts ? 'Score alerts on' : 'Alert me when my players score';
          toast(S.alerts ? 'You\'ll get an alert when your players score or turn it over.' : 'Score alerts off.');
          break;
        }
        case 'pick': {
          if (!requireUser()) return;
          await api('/api/picks', { method: 'POST', body: { gameId: t.dataset.game, market: t.dataset.m, selection: t.dataset.sel } });
          await refreshGames();
          const g = S.gamesById.get(t.dataset.game);
          const holder = t.closest('.pick-game');
          if (holder && g) holder.outerHTML = pickGame(g);
          toast('Pick saved. You can change it until kickoff.');
          break;
        }
        case 'lutab': S.luTab = t.dataset.t; showLineups(); break;
        case 'add': addToDraft(t.dataset.pid); break;
        case 'pos': S.pos = t.dataset.p; renderBuilder(); break;
        case 'unpick': {
          const slot = Object.keys(S.draft).find((s) => S.draft[s] === t.dataset.pid);
          if (slot && !S.slateById.get(t.dataset.pid)?.locked) { delete S.draft[slot]; renderBuilder(); }
          break;
        }
        case 'remove': delete S.draft[t.dataset.slot]; renderBuilder(); break;
        case 'clear-lineup': for (const s of Object.keys(S.draft)) if (!S.slateById.get(S.draft[s])?.locked) delete S.draft[s]; renderBuilder(); break;
        case 'save-lineup': {
          if (!requireUser(() => showLineups())) return;
          const players = Object.entries(S.draft).map(([slot, pid]) => ({ slot, id: pid }));
          await api('/api/lineups', { method: 'POST', body: { players } });
          S.myLineupIds = new Set(Object.values(S.draft));
          const { lineup } = await api('/api/lineups/me');
          S.savedLineup = lineup;
          toast('Lineup saved. It scores live with every play.');
          renderBuilder();
          renderSide();
          break;
        }
        default: break;
      }
    } catch (err) { toast(err.message); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
  // ---------- Customize (same options and storage keys as sidelineff.com) ----------
  const ACCENTS = window.SL_ACCENTS || {};
  const LOOKS = [
    ['editorial', 'Editorial', 'Serif headlines, warm paper tones and roomy rows. Easy on the eyes, like a magazine.', '<span class="cz-prev ed"><span class="h">Every play</span><span class="r"><span>M. Lloyd</span><b>+11.9</b></span><span class="r"><span>J. Love</span><b>+3.0</b></span></span>'],
    ['classic', 'Classic newspaper', 'The original sports page: condensed headlines, ruled tables and ink on newsprint.', '<span class="cz-prev cl"><span class="h">Every play</span><span class="r"><span>LLOYD</span><b>+11.9</b></span><span class="r"><span>LOVE</span><b>+3.0</b></span></span>'],
    ['modern', 'Modern', 'Always dark. Bold type and full-width team-color banners for big plays.', '<span class="cz-prev mo"><span class="h">Marshawn Lloyd</span><span class="r"><span>59-yd TD run</span><b>+11.9</b></span></span>'],
  ];
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const html = document.documentElement;
  function applySettings() {
    const d = html.dataset;
    if (d.look === 'modern') d.theme = 'dark';
    const ac = ACCENTS[d.accent];
    if (ac) { html.style.setProperty('--accent-d', ac[0]); html.style.setProperty('--accent-l', ac[1]); }
    else { html.style.removeProperty('--accent-d'); html.style.removeProperty('--accent-l'); }
    const tb = $('#themeBtn');
    if (tb) tb.setAttribute('aria-label', d.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  }
  function setSetting(key, value) {
    const map = { look: 'sideline-look', theme: 'sideline-theme', accent: 'sideline-accent', photos: 'sideline-photos', logos: 'sideline-logos' };
    html.dataset[key] = value;
    store(map[key], value);
    if (key === 'look' && value !== 'modern') {
      let t = null; try { t = localStorage.getItem('sideline-theme'); } catch { /* ignore */ }
      if (t === 'light' || t === 'dark') html.dataset.theme = t;
    }
    applySettings();
    if (key === 'logos') { renderStrip(); if ($('#feedList')) renderFeedList(); if (currentRoute() === 'game') showGame(currentGameId()); }
    if (!$('#sheet').hidden && S.czOpen) renderCustomize();
  }
  function renderCustomize() {
    const d = html.dataset;
    const darkOnly = d.look === 'modern';
    const opt = (key, val, title, small, extra = '') => `<button type="button" class="cz-opt ${d[key] === val ? 'on' : ''}" data-act="cz" data-k="${key}" data-v="${val}" role="radio" aria-checked="${d[key] === val}">${extra}<strong>${title}</strong><small>${small}</small></button>`;
    const logos = (neon) => `<span class="logos">${['DET', 'KC', 'MIA', 'CIN'].map((t) => `<img alt="" src="${neon ? `https://sidelineff.com/team-logos/neon/tube/${t}.png` : `https://a.espncdn.com/i/teamlogos/nfl/500/${t.toLowerCase()}.png`}">`).join('')}</span>`;
    $('#sheetBody').innerHTML = `
      <p class="cz-intro">Make Sideline yours. Saved on this device.</p>
      <div class="cz-sec"><span class="label">Site look</span><div class="cz-looks" role="radiogroup">
        ${LOOKS.map(([v, t, sm, prev]) => `<button type="button" class="cz-look ${d.look === v ? 'on' : ''}" data-act="cz" data-k="look" data-v="${v}" role="radio" aria-checked="${d.look === v}">${prev}<span><strong>${t}</strong><small>${sm}</small></span></button>`).join('')}
      </div></div>
      <div class="cz-sec"><span class="label">Mode</span>
        <div class="cz-seg" role="radiogroup">
          <button type="button" class="${d.theme === 'light' ? 'on' : ''}" data-act="cz" data-k="theme" data-v="light" ${darkOnly ? 'disabled' : ''}>Light</button>
          <button type="button" class="${d.theme === 'dark' ? 'on' : ''}" data-act="cz" data-k="theme" data-v="dark">Dark</button>
        </div>
        ${darkOnly ? '<p class="cz-note">Modern is always dark.</p>' : ''}
      </div>
      <div class="cz-sec"><span class="label">Accent color</span><div class="cz-accents" role="radiogroup">
        ${Object.entries(ACCENTS).map(([k, [dk, lt]]) => {
          const on = (d.accent || (d.look === 'classic' ? '' : 'tan')) === k;
          return `<button type="button" class="cz-acc ${on ? 'on' : ''}" style="--sw:${d.theme === 'light' ? lt : dk}" data-act="cz" data-k="accent" data-v="${k}" role="radio" aria-checked="${on}" title="${k[0].toUpperCase() + k.slice(1)}"><i></i>${k[0].toUpperCase() + k.slice(1)}</button>`;
        }).join('')}
      </div>${d.look === 'classic' && !d.accent ? '<p class="cz-note">Classic uses lilac until you pick an accent.</p>' : ''}</div>
      <div class="cz-sec"><span class="label">Player photos</span><div class="cz-opts">
        ${opt('photos', 'color', 'Color', 'Full-color headshots', '<span class="faces"><span></span><span></span><span></span></span>')}
        ${opt('photos', 'mono', 'Black and white', 'The newspaper look', '<span class="faces mono"><span></span><span></span><span></span></span>')}
      </div></div>
      <div class="cz-sec"><span class="label">Logo style</span><div class="cz-opts">
        ${opt('logos', 'classic', 'Classic', 'The official logos', logos(false))}
        ${opt('logos', 'neon', 'Neon', 'Logos lit up like a neon sign', logos(true))}
      </div></div>`;
  }
  function openCustomize() {
    S.czOpen = true;
    openSheet('Customize.', '');
    renderCustomize();
  }
  $('#customizeBtn').addEventListener('click', openCustomize);
  $('#themeBtn').addEventListener('click', () => setSetting('theme', html.dataset.theme === 'light' ? 'dark' : 'light'));
  applySettings();
  $('#meBtn').addEventListener('click', () => { if (!S.me) requireUser(); else location.hash = '#/ranks'; });

  function rerenderActions(id) {
    const p = findPlay(id);
    if (!p) return;
    document.querySelectorAll(`[data-social="${CSS.escape(id)}"]`).forEach((el) => { el.outerHTML = actions(p); });
  }

  // ---------- live stream ----------
  function connect() {
    const es = new EventSource(`${API}/api/stream`);
    // Auto-refresh while developing: after a file change, or when the server restarts with new code
    let boot = null;
    es.addEventListener('hello', (e) => {
      const d = JSON.parse(e.data);
      if (boot && d.dev && d.boot !== boot) location.reload();
      boot = d.boot;
    });
    es.addEventListener('reload', () => location.reload());
    es.addEventListener('games', (e) => {
      if (!isCurrentWeek()) return;
      const fresh = JSON.parse(e.data);
      // keep per-user fields from the last full load
      for (const g of fresh) { const old = S.gamesById.get(g.id); if (old) Object.assign(g, { pickOpen: old.pickOpen && g.state === 'pre', splits: old.splits, myPicks: old.myPicks }); }
      setGames(fresh);
    });
    es.addEventListener('schedule', (e) => { S.schedule = JSON.parse(e.data); renderWeeks(); });
    es.addEventListener('sync', (e) => {
      const was = S.sync?.running;
      S.sync = JSON.parse(e.data);
      renderSync();
      if (S.sync.done % 12 === 0 || (was && !S.sync.running)) {
        loadSchedule();
        if ($('#feedList') && !isCurrentWeek() && window.scrollY < 300) loadFeed();
        renderSide();
      }
    });
    es.addEventListener('game', (e) => {
      const g = JSON.parse(e.data);
      const old = S.gamesById.get(g.id);
      if (!old) return;
      Object.assign(old, g, { pickOpen: old.pickOpen && g.state === 'pre', splits: old.splits, myPicks: old.myPicks });
      renderStrip();
      renderLive();
    });
    es.addEventListener('play', (e) => {
      const p = JSON.parse(e.data);
      notePlays([p]);
      renderLive();
      alertFor(p);
      if (currentRoute() === 'players' && Date.now() - S.pl.at > 8000) loadPlayers();
      if (currentRoute() === 'team' && S.tm.data?.game?.id === p.gameId && Date.now() - (S.tm.at || 0) > 5000) { S.tm.at = Date.now(); loadTeam(); }
      if (!$('#feedList') || !matchesFeed(p)) return;
      if (S.feed.plays.some((x) => x.id === p.id)) return;
      if (window.scrollY < 300 && !S.pending.length) {
        S.feed.plays.unshift(p);
        const list = $('#feedList');
        const empty = list.querySelector('.empty');
        if (empty) empty.remove();
        list.insertAdjacentHTML('afterbegin', playCard(p, { fresh: true }));
        countUp(list.firstElementChild);
      } else {
        S.pending.unshift(p);
        renderFeedList();
      }
    });
    es.addEventListener('play_update', (e) => {
      const p = JSON.parse(e.data);
      const i = S.feed.plays.findIndex((x) => x.id === p.id);
      if (i < 0) return;
      p.social = S.feed.plays[i].social;
      S.feed.plays[i] = p;
      const el = document.querySelector(`#feedList [data-play="${CSS.escape(p.id)}"]`);
      if (el) {
        el.outerHTML = playCard(p);
        const now = document.querySelector(`#feedList [data-play="${CSS.escape(p.id)}"]`);
        if (now) { now.classList.add('filled'); countUp(now); }
      }
    });
    es.addEventListener('refresh', (e) => {
      const { gameId } = JSON.parse(e.data);
      if ($('#feedList') && (!S.feed.game || S.feed.game === gameId) && window.scrollY < 300) loadFeed();
    });
    es.addEventListener('social', (e) => { const { id, social } = JSON.parse(e.data); applySocial(id, social, true); });
    es.addEventListener('comment', (e) => {
      const { playId, comment } = JSON.parse(e.data);
      if (S.sheetPlay === playId && $('#cmtList')) { $('#noCmt')?.remove(); $('#cmtList').insertAdjacentHTML('afterbegin', cmtHtml(comment)); }
    });
    es.addEventListener('splits', (e) => {
      const { gameId, splits } = JSON.parse(e.data);
      const g = S.gamesById.get(gameId);
      if (g) g.splits = splits;
    });
    let pt;
    const refreshPoints = () => { clearTimeout(pt); pt = setTimeout(() => { renderSide(); if (currentRoute() === 'lineups' && S.luTab === 'top') renderTopLineups(); }, 1500); };
    es.addEventListener('points', refreshPoints);
    es.addEventListener('lineups', refreshPoints);
    es.addEventListener('leaderboard', () => { loadMe(); renderSide(); });
  }

  // ---------- router ----------
  function currentRoute() { return (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'feed'; }
  function currentGameId() { const m = location.hash.match(/^#\/game\/(.+)$/); return m ? decodeURIComponent(m[1]) : null; }
  function route() {
    const r = currentRoute();
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === r || (r === 'game' && a.dataset.nav === 'feed') || (r === 'team' && a.dataset.nav === 'players')));
    S.pickerFor = null;
    renderStrip();
    if (r === 'game') { showGame(currentGameId()); }
    else if (r === 'picks') showPicks();
    else if (r === 'lineups') showLineups();
    else if (r === 'ranks') showRanks();
    else if (r === 'players') showPlayers();
    else if (r === 'team') showTeam(currentTeam());
    else { gameTab = 'plays'; showFeed(); }
    window.scrollTo({ top: 0 });
  }
  window.addEventListener('hashchange', route);

  (async () => {
    await Promise.all([loadMe(), refreshGames().catch(() => {}), loadSchedule()]);
    renderWeeks();
    route();
    renderSide();
    connect();
  })();
})();
