/* sideline live: the Arcade. Call It, Sideline Daily, league rooms, hot takes, duels,
   aura, Wrapped, the House, weekly challenges, share cards and phone alerts.
   Uses the helpers app.js shares on window.SL. Free to play: credits only. */
(() => {
  'use strict';
  const SL = window.SL;
  if (!SL) return;
  const { S, api, esc, fmt, signed, toast, openSheet, requireUser, tlogo, face, avatarHtml, userTag, pageHead, skel, markEnter, refreshAnim } = SL;
  const $ = (q, el = document) => el.querySelector(q);
  const view = $('#view');
  const ls = SL.ls;
  const calm = SL.calm;
  const buzz = (p) => { try { if (!document.hidden) navigator.vibrate?.(p); } catch { /* not supported */ } };
  const pageBase = () => location.href.split('#')[0];
  const linkTo = (hash) => `${pageBase()}${hash}`;
  // a name with the tag style its owner picked in the Locker
  const TAG_EMOJI = { flame: '🔥', crown: '👑', diamond: '💎' };
  const nameTag = (w) => `<span class="nt nt-${esc(w?.tag || 'plain')}">${userTag(w?.profile, w?.name)}${TAG_EMOJI[w?.tag] ? `<i class="nt-e">${TAG_EMOJI[w.tag]}</i>` : ''}${w?.level > 1 ? `<span class="nt-lv" title="Live level">L${esc(w.level)}</span>` : ''}</span>`;
  SL.nameTag = nameTag;
  const timeLeft = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };

  // Which tab lights up for each page
  SL.navFor = { props: 'arcade', cards: 'arcade', trade: 'arcade', locker: 'arcade', arcade: 'arcade', daily: 'arcade', takes: 'arcade', aura: 'arcade', duels: 'arcade', duel: 'arcade', house: 'arcade', wrapped: 'arcade', room: 'leagues', play: 'feed' };

  // ================= confetti =================
  function confetti(el, n = 22) {
    if (calm.matches || !el) return;
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'confetti';
    box.style.left = `${r.left + r.width / 2}px`; box.style.top = `${r.top + r.height / 2}px`;
    const colors = ['var(--gold)', '#e3b341', '#5cc2bb', '#d9555a', '#9fbf8a', '#ece5d6'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 120;
      s.style.setProperty('--x', `${Math.cos(a) * d}px`); s.style.setProperty('--y', `${Math.sin(a) * d - 40}px`);
      s.style.setProperty('--r', `${Math.random() * 720 - 360}deg`); s.style.background = colors[i % colors.length];
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1100);
  }

  // ================= CALL IT =================
  const CHOICES = ['run', 'short', 'deep', 'td'];
  const LABEL = { run: 'Run', short: 'Short pass', deep: 'Deep shot', td: 'Touchdown' };
  const EMO = { run: '🏃', short: '🎯', deep: '🚀', td: '🔥' };
  S.call = { games: {}, offset: 0, streak: 0, best: 0, loaded: false, seen: new Map() };
  const callNow = () => Date.now() + S.call.offset;
  async function loadCalls() {
    try {
      const r = await api('/api/callit');
      S.call.offset = r.now - Date.now();
      const before = S.call.games;
      S.call.games = r.games || {};
      Object.assign(S.call, { streak: r.streak || 0, best: r.best || 0, called: r.called || 0, right: r.right || 0, loaded: true });
      // a call that just got graded: celebrate (or not)
      for (const [gid, g] of Object.entries(S.call.games)) {
        const l = g.last;
        if (!l || l.result === 'pending') continue;
        const key = `${gid}:${l.headline}:${l.result}`;
        const was = S.call.seen.get(gid);
        S.call.seen.set(gid, key);
        if (!was || was === key || !before[gid]) continue;
        const el = document.querySelector(`[data-call="${CSS.escape(gid)}"]`);
        if (l.result === 'win') { toast(`✅ Called it! ${LABEL[l.choice]} · +${l.delta} credits${S.call.streak > 1 ? ` · 🔥 ${S.call.streak} in a row` : ''}`); confetti(el); buzz([40, 30, 90]); }
        else if (l.result === 'loss') toast(`❌ Not this time: ${l.headline}`);
      }
      drawCalls();
    } catch { /* offline: try again on the next play */ }
  }
  let callT = 0;
  const loadCallsSoon = (ms = 400) => { clearTimeout(callT); callT = setTimeout(loadCalls, ms); };
  function callInner(gid) {
    const st = S.call.games[gid] || {};
    const w = st.win, now = callNow();
    const open = !!w && now < w.until;
    const mine = st.mine?.choice;
    const counts = st.counts || {}, tot = CHOICES.reduce((a, c) => a + (counts[c] || 0), 0);
    const opts = CHOICES.map((c) => `<button type="button" class="ci-opt ${mine === c ? 'on' : ''}" data-act="call" data-game="${esc(gid)}" data-c="${c}" ${open ? '' : 'disabled'} aria-pressed="${mine === c}"><span class="ci-e">${EMO[c]}</span>${LABEL[c]}${tot ? `<small>${Math.round((counts[c] || 0) / tot * 100)}%</small>` : ''}</button>`).join('');
    const l = st.last;
    let msg;
    if (open) msg = mine ? `Locked in: <b>${LABEL[mine]}</b>. Switch any time before the clock runs out.` : 'Call the next play before the snap.';
    else if (mine) msg = `Locked: <b>${LABEL[mine]}</b> · waiting for the snap…`;
    else if (l && l.result === 'pending') msg = `Grading your <b>${LABEL[l.choice]}</b> call: ${esc(l.headline)}`;
    else if (l && l.result === 'win') msg = `✅ Called it: <b>${LABEL[l.choice]}</b> (+${l.delta})`;
    else if (l && l.result === 'loss') msg = `❌ You said ${LABEL[l.choice]}: ${esc(l.headline)}`;
    else if (l && l.result === 'void') msg = 'No snap (a kick or a flag), so that call is off.';
    else msg = 'Opens right after each play.';
    const left = open ? Math.ceil((w.until - now) / 1000) : 0;
    return `<div class="ci-top"><span class="ci-title">Call It</span><span class="ci-timer ${open ? 'on' : ''}">${open ? `${left}s` : 'closed'}</span>${S.call.streak ? `<span class="ci-streak" title="Calls in a row">🔥 ${S.call.streak}</span>` : ''}</div>
      <div class="ci-bar" aria-hidden="true"><i style="width:${open ? Math.min(100, (w.until - now) / 200) : 0}%"></i></div>
      <div class="ci-opts">${opts}</div><div class="ci-msg">${msg}</div>`;
  }
  SL.hooks.liveExtra = (g) => (g.state === 'in' ? `<div class="callit" data-call="${esc(g.id)}">${callInner(g.id)}</div>` : '');
  function drawCalls(gid) {
    document.querySelectorAll(gid ? `[data-call="${CSS.escape(gid)}"]` : '[data-call]').forEach((el) => { el.innerHTML = callInner(el.dataset.call); el.dataset.open = ''; });
  }
  setInterval(() => {
    const now = callNow();
    document.querySelectorAll('[data-call]').forEach((el) => {
      const w = S.call.games[el.dataset.call]?.win;
      const left = w ? w.until - now : 0;
      const t = el.querySelector('.ci-timer'), bar = el.querySelector('.ci-bar i');
      if (left > 0) { if (t) t.textContent = `${Math.ceil(left / 1000)}s`; if (bar) bar.style.width = `${Math.min(100, left / 200)}%`; el.dataset.open = '1'; }
      else if (el.dataset.open === '1') { el.innerHTML = callInner(el.dataset.call); el.dataset.open = ''; }
    });
  }, 250);
  SL.acts.call = async (t) => {
    if (!requireUser()) return;
    const gid = t.dataset.game, c = t.dataset.c;
    buzz(15);
    const r = await api('/api/callit', { method: 'POST', body: { gameId: gid, choice: c } });
    S.call.offset = r.now - Date.now();
    S.call.games = r.games || S.call.games;
    Object.assign(S.call, { streak: r.streak || 0, best: r.best || 0 });
    drawCalls();
  };

  // ================= AURA =================
  function auraOf(x, p) {
    if (!x || x.pos === 'DST') return 0;
    const s = x.stat || {};
    let a = ((s.recTd || 0) + (s.rushTd || 0) + (s.retTd || 0)) * 100 + (s.passTd || 0) * 50 - (s.int || 0) * 100 - (s.fumLost || 0) * 100 - (s.sacked || 0) * 15 + (s.twoPt || 0) * 30;
    if ((x.role === 'rusher' || x.role === 'receiver') && p.explosive) a += 40;
    if ((x.role === 'rusher' || x.role === 'receiver') && (Number(p.yards) || 0) >= 40) a += 60;
    if (s.fga) { const dist = Number((/(\d+) yard field goal/i.exec(p.text || '') || [])[1]) || 0; a += s.fgm ? (dist >= 50 ? 60 : 10) : -60; }
    if (s.xpa && !s.xpm) a -= 40;
    return a;
  }
  SL.hooks.aura = (p) => {
    const x = SL.primaryOf(p);
    const a = auraOf(x, p);
    if (Math.abs(a) < 40) return '';
    return `<a class="badge aura ${a > 0 ? 'up' : 'down'}" href="#/aura" title="Aura: points for big moments, lost for fumbles, picks and misses">${a > 0 ? '+' : '−'}${Math.abs(a)} aura</a>`;
  };


  // ================= SHARE CARDS =================
  const W = 1080, H = 1920;
  const proxied = (u) => (u ? `${SL.API}/api/img?u=${encodeURIComponent(new URL(u, location.href).href)}` : '');
  function loadImg(u) {
    return new Promise((res) => {
      if (!u) return res(null);
      const img = new Image();
      img.onload = () => res(img); img.onerror = () => res(null);
      img.src = proxied(u);
      setTimeout(() => res(null), 6000);
    });
  }
  const css = (v, d) => (getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d);
  async function fontsReady() {
    try { await Promise.all(['700 200px "Barlow Condensed"', '400 80px "Instrument Serif"', 'italic 400 80px "Instrument Serif"', '600 60px "DM Sans"', '500 40px "DM Sans"'].map((f) => document.fonts.load(f))); } catch { /* use fallbacks */ }
  }
  function wrap(ctx, text, x, y, maxW, lh, maxLines = 3) {
    const words = String(text || '').split(/\s+/);
    let line = '', lines = [];
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, '')}…`; }
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
    return lines.length;
  }
  function frame(ctx, color) {
    ctx.fillStyle = '#0d0c0a'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, 560, 40, W / 2, 560, 1000);
    g.addColorStop(0, `${color}cc`); g.addColorStop(0.55, `${color}33`); g.addColorStop(1, '#0d0c0a00');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // thin yard lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 3;
    for (let y = 200; y < H; y += 160) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const gold = css('--gold', '#c9b78a');
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = gold; ctx.textAlign = 'left';
    ctx.font = '400 72px "Instrument Serif", Georgia, serif'; ctx.fillText('sideline', 72, 140);
    const w1 = ctx.measureText('sideline').width;
    ctx.font = 'italic 400 72px "Instrument Serif", Georgia, serif'; ctx.fillText('Live', 72 + w1 + 16, 140);
    ctx.fillStyle = 'rgba(236,229,214,0.75)'; ctx.font = '500 38px "DM Sans", system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('sidelineff.com/live', W / 2, H - 92);
    ctx.fillStyle = 'rgba(236,229,214,0.4)'; ctx.font = '500 28px "DM Sans", system-ui, sans-serif';
    ctx.fillText('every play, live, scored in PPR', W / 2, H - 48);
    return gold;
  }
  function circleImg(ctx, img, cx, cy, r, ring, fallbackText) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.fillStyle = '#1b1a16'; ctx.fill(); ctx.clip();
    if (img) { const s = Math.max((2 * r) / img.width, (2 * r) / img.height); ctx.drawImage(img, cx - img.width * s / 2, cy - img.height * s / 2 + r * 0.08, img.width * s, img.height * s); }
    else { ctx.fillStyle = '#ece5d6'; ctx.font = `700 ${Math.round(r * 0.8)}px "Barlow Condensed", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(fallbackText || '?', cx, cy); }
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }
  function pill(ctx, text, cx, y, bg, fg, font = '600 40px "DM Sans", sans-serif') {
    ctx.font = font; const w = ctx.measureText(text).width + 64, h = 78;
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(cx - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, cx, y + 2); ctx.textBaseline = 'alphabetic';
  }
  const initialsOf = (n) => String(n || '?').split(' ').map((w) => w[0]).join('').slice(0, 2);
  async function drawPlayCard(p, opts) {
    await fontsReady();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const x = SL.primaryOf(p);
    const team = SL.teamInfo(x?.team || p.offense || '');
    const color = /^#[0-9a-f]{6}$/i.test(team.color || '') ? team.color : '#33415a';
    const bad = opts.style === 'badbeat';
    const gold = frame(ctx, bad ? '#8a1f24' : color);
    // score line
    const g = S.gamesById.get(p.gameId);
    const away = p.game?.away || g?.away.abbr || '', home = p.game?.home || g?.home.abbr || '';
    ctx.textAlign = 'right'; ctx.fillStyle = '#ece5d6'; ctx.font = '700 52px "Barlow Condensed", sans-serif';
    ctx.fillText(`${away} ${p.awayScore}–${p.homeScore} ${home}`, W - 72, 128);
    ctx.fillStyle = 'rgba(236,229,214,0.6)'; ctx.font = '500 30px "DM Sans", sans-serif';
    ctx.fillText(`Q${p.period} ${p.clock || ''}`, W - 72, 172);
    if (bad) {
      ctx.save(); ctx.translate(W / 2, 300); ctx.rotate(-0.05);
      ctx.fillStyle = '#d9555a'; ctx.beginPath(); ctx.roundRect(-300, -66, 600, 132, 18); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 104px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('BAD BEAT 💀', 0, 6);
      ctx.restore(); ctx.textBaseline = 'alphabetic';
    } else if (p.td || (x && SL.adj(x) >= 10)) {
      pill(ctx, p.td ? '🔥 TOUCHDOWN' : '💥 BIG PLAY', W / 2, 300, gold, '#111', '700 52px "Barlow Condensed", sans-serif');
    }
    const img = await loadImg(x?.headshot || (x && /^\d+$/.test(String(x.id)) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${x.id}.png` : ''));
    circleImg(ctx, img, W / 2, 660, 230, color, initialsOf(x?.name || p.headline));
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '700 92px "DM Sans", sans-serif';
    wrap(ctx, x?.name || p.headline, W / 2, 1010, W - 140, 96, 1);
    ctx.fillStyle = 'rgba(236,229,214,0.65)'; ctx.font = '500 40px "DM Sans", sans-serif';
    ctx.fillText([x?.pos, x?.team].filter(Boolean).join(' · '), W / 2, 1070);
    ctx.fillStyle = '#ece5d6'; ctx.font = 'italic 400 62px "Instrument Serif", Georgia, serif';
    const n = wrap(ctx, p.headline, W / 2, 1170, W - 160, 70, 2);
    const pts = x ? SL.adj(x) : 0;
    ctx.fillStyle = pts < 0 ? '#e0736a' : gold; ctx.font = '700 300px "Barlow Condensed", sans-serif';
    ctx.fillText(signed(pts, 1), W / 2, 1170 + n * 70 + 290);
    ctx.fillStyle = 'rgba(236,229,214,0.6)'; ctx.font = '600 40px "DM Sans", sans-serif'; ctx.fillText(SL.unit(), W / 2, 1170 + n * 70 + 350);
    const note = opts.caption || '';
    if (note) pill(ctx, note.slice(0, 44), W / 2, 1690, bad ? 'rgba(217,85,90,0.25)' : 'rgba(236,229,214,0.12)', '#fff');
    const reacts = Object.entries(p.social?.reactions || {}).filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (reacts.length) { ctx.font = '600 44px "DM Sans", sans-serif'; ctx.fillStyle = '#ece5d6'; ctx.fillText(reacts.map(([e, k]) => `${e} ${k}`).join('    '), W / 2, 1600); }
    SL.hooks.frameCard?.(ctx, W, H);
    return c;
  }
  async function drawStatCard({ title, sub, big, bigLabel, rows, color, avatarUrl, avatarText }) {
    await fontsReady();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const gold = frame(ctx, color || '#6b5a2e');
    ctx.textAlign = 'center';
    if (avatarUrl !== undefined) { const img = await loadImg(avatarUrl); circleImg(ctx, img, W / 2, 400, 140, gold, avatarText); }
    ctx.fillStyle = '#fff'; ctx.font = '700 84px "DM Sans", sans-serif'; wrap(ctx, title, W / 2, 640, W - 140, 92, 2);
    ctx.fillStyle = 'rgba(236,229,214,0.7)'; ctx.font = 'italic 400 54px "Instrument Serif", Georgia, serif'; ctx.fillText(sub || '', W / 2, 760);
    if (big != null) {
      ctx.fillStyle = gold; ctx.font = '700 260px "Barlow Condensed", sans-serif'; ctx.fillText(String(big), W / 2, 1040);
      ctx.fillStyle = 'rgba(236,229,214,0.6)'; ctx.font = '600 40px "DM Sans", sans-serif'; ctx.fillText(bigLabel || '', W / 2, 1100);
    }
    let y = big != null ? 1220 : 900;
    for (const [k, v] of rows.slice(0, 6)) {
      ctx.fillStyle = 'rgba(236,229,214,0.08)'; ctx.beginPath(); ctx.roundRect(110, y - 62, W - 220, 96, 20); ctx.fill();
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(236,229,214,0.75)'; ctx.font = '500 38px "DM Sans", sans-serif'; ctx.fillText(k, 150, y);
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = '700 50px "Barlow Condensed", sans-serif'; ctx.fillText(String(v), W - 150, y + 2);
      y += 118;
    }
    SL.hooks.frameCard?.(ctx, W, H);
    return c;
  }
  async function shareCanvas(canvas, { text, url, filename }) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const file = new File([blob], filename || 'sideline.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text: [text, url].filter(Boolean).join(' ') }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    saveCanvas(canvas, filename);
    toast('Image saved. Post it anywhere.');
  }
  function saveCanvas(canvas, filename) {
    canvas.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename || 'sideline.png'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }, 'image/png');
  }
  async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Link copied.'); } catch { prompt('Copy this link', text); } }
  // Who a play hurts or helps on your synced teams
  function oppIds() {
    const out = new Set();
    for (const snap of Object.values(S.lg?.snaps || {})) {
      const m = SL.lgMine(snap); if (!m?.opp) continue;
      for (const sl of SL.lgLineup(m.opp, SL.lgWeek()).starters || []) { const id = SL.lgPid(sl.player); if (id) out.add(id); }
    }
    return out;
  }
  function suggest(p) {
    const x = SL.primaryOf(p); const v = x ? SL.adj(x) : 0;
    const mine = x && S.myFantasyIds.has(String(x.id)), theirs = x && oppIds().has(String(x.id));
    if (mine && v < 0) return { style: 'badbeat', caption: `${x.name.split(' ').slice(-1)[0]} just cost me ${fmt(Math.abs(v))} 💀` };
    if (theirs && v >= 6) return { style: 'badbeat', caption: `${x.name.split(' ').slice(-1)[0]} just put ${fmt(v)} on me 😭` };
    if (mine && v > 0) return { style: 'hype', caption: `${signed(v, 1)} for my team 🔥` };
    return { style: 'hype', caption: '' };
  }
  SL.acts.share = async (t) => {
    const id = t.dataset.id;
    let p = SL.findPlay(id) || S.roomPlays?.find((x) => x.id === id);
    if (!p) { try { p = (await api(`/api/plays/${encodeURIComponent(id)}`)).play; } catch { return toast('Play not found.'); } }
    const st = { ...suggest(p) };
    openSheet('Share this play', `<div class="share-wrap"><div class="share-prev" id="shPrev">${skel(1, 'cards')}</div>
      <div class="share-side">
        <span class="fmt-seg sh-style" role="radiogroup" aria-label="Card style"><button type="button" data-st="hype" class="${st.style === 'hype' ? 'on' : ''}">Hype</button><button type="button" data-st="badbeat" class="${st.style === 'badbeat' ? 'on' : ''}">Bad beat 💀</button></span>
        <label class="label" for="shCap">Caption on the card</label>
        <input id="shCap" maxlength="44" placeholder="${st.style === 'badbeat' ? 'lost my matchup by 0.3 on this 💀' : 'say something (optional)'}" value="${esc(st.caption)}">
        <div class="share-btns"><button class="btn" type="button" id="shGo">Share</button><button class="btn ghost" type="button" id="shSave">Save image</button><button class="btn ghost" type="button" id="shLink">Copy link</button></div>
        <p class="rules">Sized for TikTok, Instagram and Snapchat stories (9:16).</p>
      </div></div>`);
    let canvas = null, tok = 0;
    const draw = async () => {
      const mine = ++tok;
      const cv = await drawPlayCard(p, st);
      if (mine !== tok || !$('#shPrev')) return;
      canvas = cv;
      $('#shPrev').innerHTML = ''; const img = new Image(); img.src = cv.toDataURL('image/png'); img.alt = 'Share card preview'; $('#shPrev').appendChild(img);
    };
    draw();
    $('.sh-style').addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (!b) return; st.style = b.dataset.st; $('.sh-style').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    let capT; $('#shCap').addEventListener('input', (e) => { st.caption = e.target.value; clearTimeout(capT); capT = setTimeout(draw, 250); });
    const url = linkTo(`#/play/${encodeURIComponent(p.id)}`);
    $('#shGo').onclick = async () => { if (!canvas) await draw(); shareCanvas(canvas, { text: st.caption || p.headline, url, filename: 'sideline-play.png' }); };
    $('#shSave').onclick = async () => { if (!canvas) await draw(); saveCanvas(canvas, 'sideline-play.png'); };
    $('#shLink').onclick = () => copy(url);
  };
  // a shared link to one play opens it
  let keepSheet = 0;
  SL.routes.play = async (hash) => {
    const id = decodeURIComponent(hash.split('/')[2] || '');
    keepSheet = Date.now() + 800;
    location.replace('#/feed');
    if (id) setTimeout(() => SL.openComments(id), 120);
  };
  // going to another page closes whatever sheet was open
  window.addEventListener('hashchange', () => { if (Date.now() > keepSheet && !$('#sheet').hidden) SL.closeSheet(); });

  // ================= SIDELINE DAILY =================
  S.daily = { players: null, data: null, guesses: [], result: null };
  const etParts = () => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const untilMidnight = () => { const p = etParts(); return (86400 - (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second))) * 1000; };
  const dKey = (day) => `sl-daily-${day}`;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '');
  function localDailyStats() {
    let log = {}; try { log = JSON.parse(ls.get('sl-daily-log') || '{}'); } catch { /* ignore */ }
    const days = Object.keys(log).sort();
    const solved = days.filter((d) => log[d] > 0);
    let streak = 0;
    const today = S.daily.data?.day;
    if (today) {
      const set = new Set(solved);
      let d = new Date(`${today}T12:00:00Z`);
      if (!set.has(today)) d = new Date(d - 86400e3);
      while (set.has(d.toISOString().slice(0, 10))) { streak++; d = new Date(d - 86400e3); }
    }
    const dist = [0, 0, 0, 0, 0, 0]; for (const d of solved) dist[log[d] - 1]++;
    return { played: days.length, solved: solved.length, streak, dist };
  }
  async function showDaily() {
    view.innerHTML = `${pageHead('Free · one a day', 'Sideline Daily', 'Guess the player from a real stat line<br>6 tries · new puzzle at midnight ET')}<div id="dlBody">${skel(3, 'cards')}</div>`;
    const [d, pl] = await Promise.all([api('/api/daily'), S.daily.players ? { players: S.daily.players } : api('/api/daily/players')]);
    S.daily.players = pl.players; S.daily.data = d;
    if (!d.puzzle) { $('#dlBody').innerHTML = '<div class="empty"><b>Today\'s puzzle is warming up</b>It needs last week\'s box scores. Check back in a minute.</div>'; return; }
    if (d.saved) { S.daily.result = d.saved; S.daily.guesses = d.saved.rows.map((r) => r.id); }
    else {
      let g = []; try { g = JSON.parse(ls.get(dKey(d.day)) || '[]'); } catch { /* ignore */ }
      S.daily.guesses = g;
      S.daily.result = g.length ? await api('/api/daily/check', { method: 'POST', body: { day: d.day, guesses: g } }) : null;
    }
    drawDaily();
  }
  const cell = (cls, html) => `<span class="dl-c ${cls}">${html}</span>`;
  function drawDaily() {
    const el = $('#dlBody'); if (!el) return;
    const d = S.daily.data, r = S.daily.result || { rows: [], hints: [], done: false, solved: false };
    const stats = d.stats || (S.me ? null : localDailyStats());
    const rows = r.rows.map((x) => `<div class="dl-row ${x.fb.hit ? 'win' : ''}">
      <span class="dl-who">${face({ id: x.id, name: x.name, headshot: x.headshot, pos: x.pos, team: x.team }, 'face sm')}<b>${esc(x.name)}</b></span>
      ${cell(x.fb.pos, esc(x.pos))}${cell(x.fb.team, `${tlogo(x.team)}${esc(x.team)}`)}${cell(x.fb.conf, esc((x.div || '').slice(0, 3) || '–'))}${cell(x.fb.ppg === 'hit' ? 'hit' : 'miss', `${fmt(x.ppg || 0)} ${x.fb.ppg === 'up' ? '↑' : x.fb.ppg === 'down' ? '↓' : ''}`)}</div>`).join('');
    const left = 6 - r.rows.length;
    const ans = r.answer;
    el.innerHTML = `<div class="dl-card">
        <div class="label">Sideline Daily #${d.number} · ${esc(d.puzzle.gameDay)}, Week ${d.puzzle.week}</div>
        <div class="dl-line">${esc(d.puzzle.line)}</div>
        <div class="dl-pts"><b>${fmt(d.puzzle.ppr)}</b> PPR · who was it?</div>
        ${r.hints.length ? `<div class="dl-hints">${r.hints.map((h) => `<span><small>${esc(h.k)}</small>${esc(h.v)}</span>`).join('')}</div>` : '<p class="rules">Each miss unlocks a clue: position, opponent, division, team, initials.</p>'}
      </div>
      ${r.done ? '' : `<div class="dl-guess"><input id="dlInp" autocomplete="off" placeholder="Type a player (${left} ${left === 1 ? 'try' : 'tries'} left)" aria-label="Guess a player"><div class="dl-sug" id="dlSug" role="listbox"></div></div>`}
      ${rows ? `<div class="dl-grid"><div class="dl-row dl-headrow"><span>Guess</span><span>Pos</span><span>Team</span><span>Conf</span><span>PPG</span></div>${rows}</div>` : ''}
      ${r.rows.length && !r.done ? '<p class="rules">🟩 match · 🟨 same division · ↑↓ the answer averages more or fewer PPR points per game.</p>' : ''}
      ${r.done ? `<div class="dl-done ${r.solved ? 'win' : ''}">${ans ? face({ id: ans.id, name: ans.name, headshot: ans.headshot, pos: ans.pos, team: ans.team }) : ''}
          <div><div class="label">${r.solved ? `Got it in ${r.rows.length}` : 'So close'}</div><h2>${esc(ans?.name || '')}</h2><div class="sub">${esc(ans?.pos || '')} · ${esc(ans?.team || '')}</div></div></div>
        <div class="share-btns"><button class="btn" data-act="dshare">Share result</button><a class="btn ghost" href="#/arcade">More games</a></div>
        <p class="rules">Next puzzle in <b id="dlNext">${timeLeft(untilMidnight())}</b>.</p>` : ''}
      ${stats ? `<div class="dl-stats"><div><b>${stats.played}</b><span>Played</span></div><div><b>${stats.played ? Math.round(stats.solved / stats.played * 100) : 0}%</b><span>Solved</span></div><div><b>🔥 ${stats.streak}</b><span>Streak</span></div></div>` : ''}`;
    const inp = $('#dlInp');
    if (inp) {
      const sug = $('#dlSug');
      const list = () => {
        const q = norm(inp.value).trim();
        if (q.length < 2) { sug.innerHTML = ''; return []; }
        const hits = S.daily.players.filter((p) => !S.daily.guesses.includes(p[0]) && norm(p[1]).includes(q)).slice(0, 8);
        sug.innerHTML = hits.map((p, i) => `<button type="button" role="option" class="${i === 0 ? 'on' : ''}" data-act="dguess" data-id="${esc(p[0])}">${esc(p[1])}<small>${esc(p[3])} · ${esc(p[2])}</small></button>`).join('');
        return hits;
      };
      inp.addEventListener('input', list);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const h = list(); if (h[0]) guess(h[0][0]); } });
      if (!matchMedia('(max-width: 720px)').matches) inp.focus();
    }
  }
  async function guess(id) {
    const d = S.daily.data;
    const g = S.daily.guesses.concat(id);
    const r = await api('/api/daily/check', { method: 'POST', body: { day: d.day, guesses: g } });
    S.daily.guesses = r.rows.map((x) => x.id); S.daily.result = r;
    if (r.stats) d.stats = r.stats;
    if (!S.me) {
      ls.set(dKey(d.day), JSON.stringify(S.daily.guesses));
      if (r.done) { let log = {}; try { log = JSON.parse(ls.get('sl-daily-log') || '{}'); } catch { /* ignore */ } log[d.day] = r.solved ? r.rows.length : 0; ls.set('sl-daily-log', JSON.stringify(log)); }
    }
    drawDaily();
    if (r.solved) { confetti($('.dl-done')); buzz([40, 30, 120]); }
  }
  SL.acts.dguess = (t) => guess(t.dataset.id);
  SL.acts.dshare = async () => {
    const d = S.daily.data, r = S.daily.result;
    const sq = (v) => (v === 'hit' ? '🟩' : v === 'near' ? '🟨' : '⬛');
    const grid = r.rows.map((x) => `${sq(x.fb.pos)}${sq(x.fb.team)}${sq(x.fb.conf)}${x.fb.ppg === 'hit' ? '🟩' : x.fb.ppg === 'up' ? '⬆️' : '⬇️'}`).join('\n');
    const text = `Sideline Daily #${d.number} ${r.solved ? r.rows.length : 'X'}/6\n${grid}\n${linkTo('#/daily')}`;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text); toast('Result copied. Paste it anywhere.'); } catch { prompt('Copy your result', text); }
  };

  // ================= HOT TAKES =================
  S.takes = { tab: 'fresh', horizon: 'week' };
  const TAKE_TABS = [['fresh', 'Fresh'], ['hot', 'Hot'], ['grade', 'Grade ’em'], ['receipts', 'Receipts'], ['mine', 'Mine']];
  const HORIZON = { week: 'This week', month: 'This month', season: 'This season' };
  async function showTakes() {
    view.innerHTML = `${pageHead('Hot takes', 'Receipts', 'Post a take. Everyone votes W or L.<br>When it\'s time, the crowd grades it.')}
      <form class="take-new" id="takeForm"><textarea id="takeInp" maxlength="200" rows="2" placeholder="Drop a take: “The Jets make the playoffs.”"></textarea>
        <div class="take-row"><span class="fmt-seg" id="takeH">${Object.entries(HORIZON).map(([k, l]) => `<button type="button" data-h="${k}" class="${S.takes.horizon === k ? 'on' : ''}">${l}</button>`).join('')}</span><span class="take-n" id="takeN">200</span><button class="btn" type="submit">Post take</button></div></form>
      <div class="pills" id="takeTabs">${TAKE_TABS.map(([k, l]) => `<button class="pill ${S.takes.tab === k ? 'on' : ''}" data-act="ttab" data-t="${k}">${l}</button>`).join('')}</div>
      <div id="takeList">${skel(4, 'cards')}</div>`;
    $('#takeH').addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (!b) return; S.takes.horizon = b.dataset.h; $('#takeH').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
    $('#takeInp').addEventListener('input', (e) => { $('#takeN').textContent = 200 - e.target.value.length; });
    $('#takeForm').onsubmit = async (e) => {
      e.preventDefault();
      if (!requireUser(() => { location.hash = '#/takes'; })) return;
      const body = $('#takeInp').value.trim(); if (!body) return;
      try { await api('/api/takes', { method: 'POST', body: { body, horizon: S.takes.horizon } }); $('#takeInp').value = ''; toast('Take posted. Receipts incoming.'); S.takes.tab = 'fresh'; loadTakes(); }
      catch (err) { toast(err.message); }
    };
    loadTakes();
  }
  async function loadTakes() {
    const r = await api(`/api/takes?tab=${S.takes.tab}`);
    S.takes.list = r.takes; S.takes.record = r.record;
    document.querySelectorAll('#takeTabs .pill').forEach((b) => b.classList.toggle('on', b.dataset.t === S.takes.tab));
    const el = $('#takeList'); if (!el) return;
    el.innerHTML = r.takes.length ? r.takes.map(takeCard).join('') : `<div class="empty"><b>${S.takes.tab === 'grade' ? 'Nothing to grade right now' : S.takes.tab === 'receipts' ? 'No receipts yet' : 'No takes yet'}</b>${S.takes.tab === 'grade' ? 'Takes land here when their time is up. Then you decide: did it hit?' : 'Be the first to say something bold.'}</div>`;
    refreshAnim(el);
  }
  function takeCard(t) {
    const rec = t.author.record, recTxt = rec.hit + rec.miss ? `<span class="tk-rec" title="Takes that hit vs. missed">${rec.hit}-${rec.miss} receipts</span>` : '';
    const v = t.votes, tot = v.w + v.l, gt = v.hit + v.miss;
    let foot;
    if (t.phase === 'call') foot = `<div class="tk-vote"><button class="tk-b w ${t.my.call === 1 ? 'on' : ''}" data-act="tvote" data-id="${t.id}" data-p="call" data-v="1" ${t.mine ? 'disabled' : ''}>W <b>${v.w}</b></button><div class="tk-bar"><i style="width:${tot ? v.w / tot * 100 : 50}%"></i></div><button class="tk-b l ${t.my.call === -1 ? 'on' : ''}" data-act="tvote" data-id="${t.id}" data-p="call" data-v="-1" ${t.mine ? 'disabled' : ''}>L <b>${v.l}</b></button></div>
      <div class="tk-meta">${HORIZON[t.horizon]} · graded in ${timeLeft(t.settleAt - Date.now())}${t.mine && !tot ? ` · <button class="linkish" data-act="tdel" data-id="${t.id}">delete</button>` : ''}</div>`;
    else if (t.phase === 'grade') foot = `<div class="tk-grade"><span>Time's up. Did it hit?</span><button class="tk-b w ${t.my.grade === 1 ? 'on' : ''}" data-act="tvote" data-id="${t.id}" data-p="grade" data-v="1" ${t.mine ? 'disabled' : ''}>✅ Hit <b>${v.hit}</b></button><button class="tk-b l ${t.my.grade === -1 ? 'on' : ''}" data-act="tvote" data-id="${t.id}" data-p="grade" data-v="-1" ${t.mine ? 'disabled' : ''}>❌ Miss <b>${v.miss}</b></button></div>
      <div class="tk-meta">Voting closes in ${timeLeft(t.settleAt + 72 * 3600e3 - Date.now())} · it was ${v.w}-${v.l} W/L when posted</div>`;
    else foot = `<div class="tk-stamp ${t.result}">${t.result === 'hit' ? 'RECEIPT ✅ It hit' : t.result === 'miss' ? 'MISS ❌ It aged badly' : 'Unsettled: not enough votes'}</div><div class="tk-meta">${gt} graded · ${v.w}-${v.l} W/L when posted</div>`;
    return `<article class="take ${t.phase}" data-take="${t.id}"><div class="tk-by">${avatarHtml(t.author.profile, 30)}${nameTag(t.author)}${recTxt}<span class="sub">${SL.ago(t.at)}</span><button class="share-btn sm" data-act="tshare" data-id="${t.id}" aria-label="Share this take">Share</button></div>
      <p class="tk-body">“${esc(t.body)}”</p>${foot}</article>`;
  }
  SL.acts.ttab = (t) => { S.takes.tab = t.dataset.t; loadTakes(); };
  SL.acts.tvote = async (t) => {
    if (!requireUser()) return;
    const tk = S.takes.list.find((x) => x.id === Number(t.dataset.id)); if (!tk) return;
    const phase = t.dataset.p, cur = tk.my[phase] || 0, v = Number(t.dataset.v) === cur ? 0 : Number(t.dataset.v);
    const r = await api(`/api/takes/${tk.id}/vote`, { method: 'POST', body: { phase, value: v } });
    Object.assign(tk, r.take);
    const el = document.querySelector(`[data-take="${tk.id}"]`); if (el) el.outerHTML = takeCard(tk);
    buzz(10);
  };
  SL.acts.tdel = async (t) => { await api(`/api/takes/${t.dataset.id}`, { method: 'DELETE' }); loadTakes(); };
  SL.acts.tshare = async (t) => {
    const tk = S.takes.list.find((x) => x.id === Number(t.dataset.id)); if (!tk) return;
    const pr = tk.author.profile;
    const cv = await drawStatCard({ title: `“${tk.body}”`, sub: `${pr?.username || tk.author.name} · ${HORIZON[tk.horizon].toLowerCase()}`, rows: [['W / L', `${tk.votes.w}-${tk.votes.l}`], ['Status', tk.result === 'hit' ? 'Hit ✅' : tk.result === 'miss' ? 'Missed ❌' : tk.phase === 'grade' ? 'Being graded' : 'Open']], avatarUrl: pr?.avatar?.kind === 'upload' ? pr.avatar.url : '', avatarText: (pr?.username || tk.author.name || '?')[0].toUpperCase(), color: '#5a3a1a' });
    shareCanvas(cv, { text: 'Receipts or it didn\'t happen', url: linkTo('#/takes'), filename: 'sideline-take.png' });
  };

  // ================= DUELS =================
  const duelSide = (s, label) => {
    if (!s) return `<div class="du-side empty"><div class="du-ava">?</div><b>Waiting for a challenger</b><small>Send the link to a friend</small></div>`;
    const l = s.lineup;
    return `<div class="du-side">${avatarHtml(s.profile, 56)}<div class="du-name">${nameTag(s)}</div><div class="du-tot">${l ? fmt(l.total) : '–'}</div><small>${l ? `${label} · ${l.players.filter((p) => p.state !== 'pre').length}/${l.players.length} played` : 'No lineup yet'}</small>
      ${l ? `<div class="du-list">${l.players.map((p) => `<div><span>${esc(p.slot.replace(/\d/, ''))}</span>${esc(p.name)}<b>${p.state === 'pre' ? '–' : fmt(p.points)}</b></div>`).join('')}</div>` : ''}</div>`;
  };
  function duelHtml(d) {
    const res = d.result === 'tie' ? 'Tie' : d.result === 'expired' ? 'Nobody took it' : d.result ? `${(d.result === 'from' ? d.from : d.to)?.name || ''} wins` : '';
    return `<section class="duel ${d.status}"><div class="du-top"><span class="label">Week ${d.week} duel · ${d.status === 'open' ? 'open' : d.status === 'set' ? 'locked in' : d.status === 'live' ? '<span class="live">live</span>' : 'final'}</span>${res ? `<b class="du-res">${esc(res)}</b>` : ''}</div>
      <div class="du-vs">${duelSide(d.from, 'Challenger')}<div class="du-x">VS</div>${duelSide(d.to, 'Opponent')}</div>
      <div class="share-btns">${d.status === 'open' && d.me !== 'from' ? `<button class="btn" data-act="daccept" data-code="${esc(d.code)}">Accept the duel</button>` : ''}${d.status === 'open' && d.me === 'from' ? `<button class="btn" data-act="dlink" data-code="${esc(d.code)}">Send the link</button>` : ''}${d.me && !(d.me === 'from' ? d.from : d.to)?.lineup ? '<a class="btn ghost" href="#/lineups">Build your lineup</a>' : ''}<a class="btn ghost" href="#/duel/${esc(d.code)}">Open</a></div></section>`;
  }
  async function showDuels() {
    view.innerHTML = `${pageHead(SL.weekLabel(), 'Duels', 'Your salary-cap lineup vs. a friend\'s<br>Winner gets +50 credits')}
      <div class="du-new"><p>Make a link, send it to a friend, and whoever's lineup scores more this week wins.</p><button class="btn" data-act="dnew">Create a duel link</button></div><div id="duList">${skel(2, 'cards')}</div>`;
    if (!S.me) { $('#duList').innerHTML = '<div class="empty"><b>Sign in to duel</b><a href="#" data-act="join">Sign in</a></div>'; return; }
    const r = await api('/api/duels');
    const el = $('#duList'); if (!el) return;
    el.innerHTML = r.duels.length ? r.duels.map(duelHtml).join('') : '<div class="empty"><b>No duels yet</b>Create one above and send it to the group chat.</div>';
  }
  async function showDuel(hash) {
    const code = decodeURIComponent(hash.split('/')[2] || '');
    view.innerHTML = `${pageHead('Lineup duel', 'Who you got?')}<div id="duOne">${skel(2, 'cards')}</div>`;
    try { const r = await api(`/api/duels/${encodeURIComponent(code)}`); $('#duOne').innerHTML = duelHtml(r.duel) + '<p class="rules">Lineups score live with every play. Build or change yours on the Lineups tab before each player\'s game starts.</p>'; }
    catch (e) { $('#duOne').innerHTML = `<div class="empty"><b>${esc(e.message)}</b><a href="#/duels">Your duels</a></div>`; }
  }
  const duelLink = (code) => linkTo(`#/duel/${code}`);
  async function sendDuel(code) {
    const url = duelLink(code), text = 'I challenge you to a lineup duel on Sideline Live ⚔️';
    if (navigator.share) { try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copy(url);
  }
  SL.acts.dnew = async () => { if (!requireUser()) return; const r = await api('/api/duels', { method: 'POST' }); await sendDuel(r.duel.code); showDuels(); };
  SL.acts.dlink = (t) => sendDuel(t.dataset.code);
  SL.acts.daccept = async (t) => { if (!requireUser()) return; await api(`/api/duels/${encodeURIComponent(t.dataset.code)}/accept`, { method: 'POST' }); toast('Duel on. May the best lineup win.'); showDuel(`#/duel/${t.dataset.code}`); };

  // ================= AURA =================
  async function showAura() {
    view.innerHTML = `${pageHead(SL.weekLabel(), 'Aura', 'Touchdowns and big plays add aura<br>Fumbles, picks and misses take it away')}<div id="auBody">${skel(6, 'rows')}</div>`;
    const r = await api(`/api/aura${S.sel ? `?week=${S.sel}` : ''}`);
    const row = (e, i, neg) => `<div class="au-row ${neg ? 'neg' : ''}"><span class="au-rk">${i + 1}</span>${face(e, 'face sm')}<span class="au-who"><button class="plink" data-act="player" data-pid="${esc(e.id)}">${esc(e.name)}</button><small>${esc(e.pos)} · ${esc(e.team)} · ${esc((neg ? e.worst : e.best)?.headline || '')}</small></span><b>${e.aura > 0 ? '+' : '−'}${Math.abs(e.aura)}</b></div>`;
    const el = $('#auBody'); if (!el) return;
    el.innerHTML = `<div class="au-grid"><section><div class="label">Most aura ✨</div>${r.top.map((e, i) => row(e, i)).join('') || '<p class="rules">No aura yet. It starts with the first big play.</p>'}</section>
      <section><div class="label">Negative aura 💀</div>${r.bottom.map((e, i) => row(e, i, true)).join('') || '<p class="rules">Nobody\'s been cooked yet.</p>'}</section></div>
      <p class="rules">TD +100 · TD pass +50 · explosive play +40 (40+ yards +60 more) · 50+ yard FG +60 · interception or lost fumble −100 · sack −15 · missed FG −60 · missed PAT −40.</p>`;
    refreshAnim(el);
  }

  // ================= THE HOUSE + CREATORS =================
  async function showHouse() {
    view.innerHTML = `${pageHead(SL.weekLabel(), 'Beat the House', 'The House builds the lineup with the most projected points<br>under the cap. Can you beat it?')}<div id="hoBody">${skel(3, 'cards')}</div>`;
    const r = await api('/api/creators');
    const el = $('#hoBody'); if (!el) return;
    const card = (title, sub, l, badge) => `<section class="ho-card"><div class="ho-top"><div><div class="label">${sub}</div><h2>${title}</h2></div><div class="ho-tot">${fmt(l.total || 0)}<small>${badge}</small></div></div>
      <div class="ho-list">${l.players.map((p) => `<div class="ho-p">${face(p, 'face sm')}<span>${esc(p.name)}<small>${esc(p.slot.replace(/\d/, ''))} · ${esc(p.team)}${p.salary ? ` · $${Number(p.salary).toLocaleString()}` : ''}${p.proj ? ` · proj ${fmt(p.proj)}` : ''}</small></span><b>${p.state === 'pre' ? '–' : fmt(p.points)}</b></div>`).join('')}</div></section>`;
    const h = r.house;
    const me = r.me;
    el.innerHTML = `${me && h ? `<div class="ho-me ${me.beatHouse ? 'up' : 'down'}">${me.beatHouse ? `😎 You're beating the House by <b>${fmt(me.total - h.total)}</b>` : `😬 The House is up <b>${fmt(h.total - me.total)}</b> on you`}</div>` : `<div class="ho-me"><a href="#/lineups">Build your lineup</a> to take on the House.</div>`}
      ${h ? card('The House', `$${Number(h.salary).toLocaleString()} of $${Number(h.cap).toLocaleString()} · proj ${fmt(h.proj)}`, h, `${h.beatenBy} of ${h.of} lineups beat it`) : '<div class="empty"><b>The House is still drafting</b>It builds its lineup once this week\'s rankings are posted.</div>'}
      ${r.creators.length ? `<div class="label ho-cr">Creators</div>${r.creators.map((c) => c.lineup ? card(userTag(c.profile, c.name, { link: true }), esc(c.handle || 'Creator'), c.lineup, `${c.beatenBy} of ${c.of} beat them`) : '').join('')}` : '<p class="rules">Creator lineups show up here as creators join. Make a lineup good enough and you could be one.</p>'}`;
  }

  // ================= WRAPPED =================
  function benchRegret(week) {
    let best = null;
    for (const l of S.lg?.leagues || []) {
      const snap = S.lg.snaps[l.id], m = SL.lgMine(snap); if (!m) continue;
      const lu = SL.lgLineup(m.me, week);
      for (const b of lu.bench || []) {
        if (!b.player || b.player.score == null) continue;
        const sameSpot = (lu.starters || []).filter((s) => s.player && s.player.position === b.player.position && s.player.score != null).sort((a, z) => a.player.score - z.player.score)[0];
        if (!sameSpot) continue;
        const diff = b.player.score - sameSpot.player.score;
        if (diff > 0 && (!best || diff > best.diff)) best = { league: l.name, bench: b.player.name, pts: b.player.score, starter: sameSpot.player.name, spts: sameSpot.player.score, diff };
      }
    }
    return best;
  }
  S.wr = { week: null, season: false };
  async function showWrapped() {
    const cur = S.week?.week || 1;
    if (S.wr.week == null) S.wr.week = S.games.length && S.games.every((g) => g.state === 'post') ? cur : Math.max(1, cur - 1);
    view.innerHTML = `${pageHead('Your week, wrapped', 'Wrapped', 'Picks, calls, puzzles and lineups<br>in one card to post')}
      <div class="pills" id="wrTabs">${[cur, cur - 1, cur - 2].filter((w) => w >= 1).map((w) => `<button class="pill ${!S.wr.season && S.wr.week === w ? 'on' : ''}" data-act="wrweek" data-w="${w}">${w === cur ? 'This week' : `Week ${w}`}</button>`).join('')}<button class="pill ${S.wr.season ? 'on' : ''}" data-act="wrweek" data-w="season">Season</button></div>
      <div id="wrBody">${skel(3, 'cards')}</div>`;
    if (!S.me) { $('#wrBody').innerHTML = '<div class="empty"><b>Sign in to see your Wrapped</b>It\'s built from your picks, calls, Dailies and lineups. <a href="#" data-act="join">Sign in</a></div>'; return; }
    let r;
    try { r = await api(`/api/wrapped?${S.wr.season ? 'season=1' : `week=${S.wr.week}`}`); } catch (e) { $('#wrBody').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const regret = !S.wr.season && S.wr.week === SL.lgWeek() ? benchRegret(S.wr.week) : null;
    const slides = [];
    const pr = r.me.profile;
    slides.push({ k: 'intro', big: '', title: `${pr?.username || r.me.name}'s ${r.label}`, line: 'wrapped. tap to flip through.' });
    if (r.picks.made) slides.push({ big: `${r.picks.w}-${r.picks.l}${r.picks.p ? `-${r.picks.p}` : ''}`, title: 'picking winners', line: r.picks.upset ? `You called the ${r.picks.upset.team} upset (+${r.picks.upset.spread}) 🐶` : r.picks.w > r.picks.l ? 'Sharp. Vegas is nervous.' : 'Rough one. Next week.' });
    if (r.callit.called) slides.push({ big: `${r.callit.right}/${r.callit.called}`, title: 'plays called', line: `Best streak: ${r.callit.best} 🔥` });
    if (r.lineup) slides.push(S.wr.season ? { big: fmt(r.lineup.total), title: 'lineup points', line: `over ${r.lineup.weeks} week${r.lineup.weeks > 1 ? 's' : ''}` } : { big: fmt(r.lineup.total), title: 'lineup points', line: r.lineup.of > 1 ? `Top ${Math.max(1, 100 - r.lineup.pct + 1)}% of ${r.lineup.of} lineups${r.lineup.top ? ` · MVP ${r.lineup.top.name} (${fmt(r.lineup.top.points)})` : ''}` : r.lineup.top ? `MVP: ${r.lineup.top.name} (${fmt(r.lineup.top.points)})` : '' });
    if (regret) slides.push({ big: fmt(regret.pts), title: 'points on your bench 💀', line: `${regret.bench} sat while ${regret.starter} put up ${fmt(regret.spts)} (${regret.league})` });
    if (r.daily.played) slides.push({ big: r.daily.solved, title: `Dailies solved`, line: r.daily.avg ? `${r.daily.avg} tries on average` : 'The puzzles won this time.' });
    if (r.takes.posted || r.duels.w || r.duels.l) slides.push({ big: `${r.duels.w}-${r.duels.l}`, title: 'in duels', line: `${r.takes.posted} hot take${r.takes.posted === 1 ? '' : 's'} posted${r.takes.hit ? ` · ${r.takes.hit} receipt${r.takes.hit > 1 ? 's' : ''}` : ''}` });
    slides.push({ big: `${r.credits >= 0 ? '+' : ''}${r.credits}`, title: 'credits', line: 'Free to play, always.' });
    S.wr.data = { r, regret, slides };
    let i = 0;
    const el = $('#wrBody');
    const draw = () => {
      const s = slides[i];
      el.innerHTML = `<div class="wr-story" data-act="wrnext" role="button" tabindex="0" aria-label="Next">
          <div class="wr-dots">${slides.map((_, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</div>
          ${s.k === 'intro' ? `<div class="wr-ava">${avatarHtml(pr || { username: r.me.name }, 96)}</div>` : ''}
          ${s.big !== '' ? `<div class="wr-big">${esc(s.big)}</div>` : ''}<div class="wr-title">${esc(s.title)}</div><div class="wr-line">${esc(s.line)}</div>
          <div class="wr-tap">${i < slides.length - 1 ? 'tap →' : 'that\'s a wrap'}</div></div>
        <div class="share-btns"><button class="btn" data-act="wrshare">Share my Wrapped</button><button class="btn ghost" data-act="wrsave">Save image</button></div>`;
      if (i === slides.length - 1) confetti($('.wr-story'), 30);
    };
    S.wr.next = () => { i = (i + 1) % slides.length; draw(); };
    draw();
  }
  SL.acts.wrweek = (t) => { if (t.dataset.w === 'season') S.wr.season = true; else { S.wr.season = false; S.wr.week = Number(t.dataset.w); } showWrapped(); };
  SL.acts.wrnext = () => S.wr.next?.();
  async function wrappedCanvas() {
    const { r, regret } = S.wr.data;
    const pr = r.me.profile;
    const rows = [];
    if (r.picks.made) rows.push(['Winners picked', `${r.picks.w}-${r.picks.l}${r.picks.p ? `-${r.picks.p}` : ''}`]);
    if (r.callit.called) rows.push(['Plays called', `${r.callit.right}/${r.callit.called} · 🔥${r.callit.best}`]);
    if (r.lineup) rows.push(['Lineup', r.lineup.of > 1 ? `${fmt(r.lineup.total)} · top ${Math.max(1, 100 - r.lineup.pct + 1)}%` : fmt(r.lineup.total)]);
    if (regret) rows.push(['Left on the bench 💀', fmt(regret.pts)]);
    if (r.daily.played) rows.push(['Dailies solved', `${r.daily.solved}/${r.daily.played}`]);
    if (r.duels.w || r.duels.l) rows.push(['Duels', `${r.duels.w}-${r.duels.l}`]);
    return drawStatCard({ title: `${pr?.username || r.me.name}'s ${r.label}`, sub: 'wrapped', big: `${r.credits >= 0 ? '+' : ''}${r.credits}`, bigLabel: 'credits', rows, avatarUrl: pr?.avatar?.kind === 'upload' ? pr.avatar.url : '', avatarText: (pr?.username || r.me.name || '?')[0].toUpperCase(), color: '#6b5a2e' });
  }
  SL.acts.wrshare = async (t, e) => { e?.stopPropagation(); shareCanvas(await wrappedCanvas(), { text: `My ${S.wr.data.r.label} on Sideline Live`, url: linkTo('#/wrapped'), filename: 'sideline-wrapped.png' }); };
  SL.acts.wrsave = async (t, e) => { e?.stopPropagation(); saveCanvas(await wrappedCanvas(), 'sideline-wrapped.png'); };

  // ================= LEAGUE ROOMS + SWEAT METER =================
  const phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
  function teamOutlook(lu) {
    let mean = 0, v = 0;
    for (const sl of lu?.starters || []) {
      const p = sl.player; if (!p) continue;
      const sc = p.score || 0, pj = p.proj ?? 0;
      if (p.gameState === 'final') mean += sc;
      else if (p.gameState === 'live') { mean += sc + Math.max(0, pj - sc) * 0.5; v += 20; }
      else { mean += pj || 0; v += 49; }
    }
    return { mean, v };
  }
  function sweatPct(A, B) {
    const a = teamOutlook(A), b = teamOutlook(B);
    const sd = Math.sqrt(a.v + b.v);
    if (!sd) return { pct: a.mean > b.mean ? 100 : a.mean < b.mean ? 0 : 50, a, b };
    return { pct: Math.round(phi((a.mean - b.mean) / sd) * 100), a, b };
  }
  const mood = (p) => (p >= 85 ? ['Cruising', '😎'] : p >= 60 ? ['Feeling good', '🙂'] : p >= 40 ? ['Coin flip', '😬'] : p >= 15 ? ['Sweating', '😰'] : ['Cooked', '💀']);
  SL.hooks.sweat = (A, B, mine) => {
    if (!B || !mine?.opp) return '';
    const { pct, a, b } = sweatPct(A, B);
    const [label, emoji] = mood(pct);
    return `<div class="sweat" style="--p:${pct}%"><div class="sw-top"><span class="label">Sweat meter</span><b>${pct}%</b><em>${emoji} ${label}</em></div><div class="sw-bar"><i></i></div><small>Projected ${fmt(a.mean)} – ${fmt(b.mean)}</small></div>`;
  };
  S.room = { id: null, last: 0, owners: new Map() };
  async function showRoom(hash) {
    const id = decodeURIComponent(hash.split('/')[2] || '');
    S.room = { id, last: 0, owners: new Map() };
    view.innerHTML = `${pageHead('League room', 'Loading…')}<div id="rmBody">${skel(3, 'cards')}</div>`;
    await SL.loadLeagues();
    const el = $('#rmBody'); if (!el || S.room.id !== id) return;
    const l = (S.lg.leagues || []).find((x) => String(x.id) === id);
    if (!l) {
      el.innerHTML = S.lg.status === 'signedout' ? '<div class="empty"><b>Sign in to use league rooms</b><a href="#" data-act="join">Sign in</a></div>'
        : S.lg.status === 'offsite' ? '<div class="empty"><b>Open Live on sidelineff.com</b>League rooms use your synced leagues. <a href="https://sidelineff.com/live/#/leagues">Go to sidelineff.com/live</a></div>'
        : '<div class="empty"><b>Room not found</b>Rooms are only for leagues you\'ve synced. <a href="#/leagues">My teams</a></div>';
      return;
    }
    const snap = S.lg.snaps[l.id], mine = SL.lgMine(snap), week = SL.lgWeek();
    for (const m of snap?.matchups || []) for (const t of [m.home, m.away]) {
      if (!t) continue;
      for (const sl of SL.lgLineup(t, week).starters || []) { const pid = SL.lgPid(sl.player); if (pid) S.room.owners.set(pid, { team: t.name, you: !!t.isYou }); }
    }
    $('.page-head h1').textContent = l.name || snap?.leagueName || 'League';
    const A = mine ? SL.lgLineup(mine.me, week) : null, B = mine?.opp ? SL.lgLineup(mine.opp, week) : null;
    const games = (snap?.matchups || []).map((m) => `<div class="rm-m ${m.home?.isYou || m.away?.isYou ? 'you' : ''}"><span>${esc(m.away?.name || 'Bye')}</span><b>${m.away?.score != null ? fmt(m.away.score) : '–'}</b><b>${m.home?.score != null ? fmt(m.home.score) : '–'}</b><span>${esc(m.home?.name || 'Bye')}</span></div>`).join('');
    el.innerHTML = `<div class="rm-grid"><div class="rm-main">
        ${mine && B ? `<div class="rm-sweat"><div class="tm-head"><div class="tm-side me"><small>${esc(mine.me.name)}</small><b>${fmt(mine.me.score || 0)}</b></div><div class="tm-vs">vs</div><div class="tm-side"><small>${esc(mine.opp.name)}</small><b>${fmt(mine.opp.score || 0)}</b></div></div>${SL.hooks.sweat(A, B, mine)}</div>` : ''}
        <section class="rm-sec"><div class="label">Every matchup</div><div class="rm-ms">${games || '<p class="rules">No matchups this week.</p>'}</div></section>
        <section class="rm-sec"><div class="label">Everyone's players, live</div><div id="rmPlays">${skel(3, 'rows')}</div></section>
      </div>
      <aside class="rm-chat"><div class="label">Trash talk</div><div class="rm-msgs" id="rmMsgs"><p class="rules">Loading…</p></div>
        <form class="cmt-form" id="rmForm"><input id="rmInp" maxlength="400" placeholder="Say something to the league" aria-label="Message"><button class="btn" type="submit">Send</button></form></aside></div>`;
    $('#rmForm').onsubmit = async (e) => {
      e.preventDefault();
      if (!requireUser()) return;
      const body = $('#rmInp').value.trim(); if (!body) return;
      try { await api(`/api/rooms/${encodeURIComponent(id)}`, { method: 'POST', body: { body } }); $('#rmInp').value = ''; loadRoomMsgs(); } catch (err) { toast(err.message); }
    };
    loadRoomMsgs();
    loadRoomPlays();
  }
  const roomRow = (p) => {
    const xs = (p.players || []).filter((x) => S.room.owners.has(String(x.id)));
    const x = xs[0] || SL.primaryOf(p); const o = x && S.room.owners.get(String(x.id));
    const v = x ? SL.adj(x) : 0;
    return `<button class="rm-play ${o?.you ? 'you' : ''}" data-act="comments" data-id="${esc(p.id)}">${face(x || {}, 'face sm')}<span><small>${o ? `${esc(o.team)}${o.you ? ' (you)' : ''}` : ''} · Q${p.period} ${esc(p.clock)}</small>${esc(x?.name || '')}: ${esc(p.headline)}</span><b class="${v < 0 ? 'minus' : ''}">${signed(v, 1)}</b></button>`;
  };
  async function loadRoomPlays() {
    const ids = [...S.room.owners.keys()].slice(0, 150);
    const el = $('#rmPlays'); if (!el) return;
    if (!ids.length) { el.innerHTML = '<p class="rules">No lineups loaded for this league yet.</p>'; return; }
    try {
      const r = await api(`/api/feed?players=${ids.join(',')}&limit=25`);
      S.roomPlays = r.plays;
      el.innerHTML = r.plays.map(roomRow).join('') || '<p class="rules">Plays from anyone\'s starters show up here the second they happen.</p>';
    } catch { el.innerHTML = '<p class="rules">Plays couldn\'t load.</p>'; }
  }
  async function loadRoomMsgs() {
    const id = S.room.id, el = $('#rmMsgs'); if (!id || !el) return;
    try {
      const r = await api(`/api/rooms/${encodeURIComponent(id)}${S.room.last ? `?after=${S.room.last}` : ''}`);
      if (!S.room.last) el.innerHTML = '';
      if (!r.messages.length && !S.room.last) { el.innerHTML = '<p class="rules" id="rmNone">Quiet in here. Start the trash talk.</p>'; return; }
      $('#rmNone')?.remove();
      for (const m of r.messages) {
        el.insertAdjacentHTML('beforeend', `<div class="rm-msg ${m.mine ? 'mine' : ''}">${avatarHtml(m.profile, 26)}<div><div class="by">${nameTag(m)}<span>${SL.ago(m.at)}</span></div><p>${esc(m.body)}</p></div></div>`);
        S.room.last = Math.max(S.room.last, m.id);
      }
      el.scrollTop = el.scrollHeight;
    } catch (e) { el.innerHTML = `<p class="rules">${esc(e.message)}</p>`; }
  }

  // ================= ARCADE HUB =================
  async function showArcade() {
    view.innerHTML = `${pageHead('Free to play · credits only', 'Arcade', 'Games between the snaps<br>New stuff every day')}<div id="arBody">${skel(4, 'cards')}</div>`;
    const [ch, d] = await Promise.all([api('/api/challenges').catch(() => null), api('/api/daily').catch(() => null)]);
    if (!S.call.loaded) await loadCalls();
    const el = $('#arBody'); if (!el) return;
    const live = S.games.filter((g) => g.state === 'in');
    const next = S.games.filter((g) => g.state === 'pre').sort((a, b) => a.start - b.start)[0];
    let dailyStatus = 'Guess today\'s player';
    if (d?.saved?.done) dailyStatus = d.saved.solved ? `Solved in ${d.saved.rows.length} ✅` : 'Missed today 💀';
    else if (!S.me) { try { const g = JSON.parse(ls.get(`sl-daily-${d?.day}`) || '[]'); if (g.length) dailyStatus = `${g.length}/6 tries used`; } catch { /* ignore */ } }
    const streak = ch?.daily?.streak ?? localDailyStats().streak;
    const tile = (href, emoji, title, line, status, cls = '') => `<a class="ar-tile ${cls}" href="${href}"><span class="ar-e">${emoji}</span><span class="ar-t">${title}</span><span class="ar-l">${line}</span>${status ? `<span class="ar-s">${status}</span>` : ''}</a>`;
    el.innerHTML = `${installBanner()}
      <div class="ar-grid">
        ${tile(live.length ? `#/game/${esc(live[0].id)}` : '#/feed', '📣', 'Call It', 'Guess the next play before the snap: run, short pass, deep shot or TD.', live.length ? `<span class="live">${live.length} live</span> · tap a game` : next ? `Opens at kickoff · ${esc(SL.kickoff(next))}` : 'Opens when games are live', live.length ? 'hot' : '')}
        ${tile('#/daily', '🧩', `Sideline Daily${d?.number ? ` #${d.number}` : ''}`, 'Name the player from a real stat line. 6 tries.', `${dailyStatus}${streak ? ` · 🔥 ${streak}` : ''}`)}
        ${tile('#/props', '🎯', 'Player props', 'Pick 2 to 5 More or Less. All hit and win up to +600.', '')}
        ${tile('#/cards', '🃏', 'Moment cards', 'Collect the week\'s biggest plays. Open packs, swap with friends.', '')}
        ${tile('#/takes', '🌶️', 'Hot takes', 'Post a take, get voted W or L, collect receipts.', ch?.takes ? `Your receipts: ${ch.takes.hit}-${ch.takes.miss}` : '')}
        ${tile('#/aura', '✨', 'Aura', 'Who\'s got it, and who\'s cooked this week.', '')}
        ${tile('#/duels', '⚔️', 'Duels', 'Your lineup vs. a friend\'s, from one link.', '')}
        ${tile('#/house', '🏠', 'Beat the House', 'The best projected lineup under the cap. Beat it.', '')}
        ${tile('#/wrapped', '🎁', 'Wrapped', 'Your week in one card to post.', '')}
        ${tile('#/locker', '🔓', 'Locker', 'Level up to unlock card frames, colors and name tags.', '')}
      </div>
      ${ch?.list?.length ? `<section class="ch-sec"><div class="ch-head"><div><div class="label">Week ${ch.week} challenges</div><h2>${ch.list.filter((c) => c.done).length}/${ch.list.length} done${ch.allDone ? ' 🏆' : ''}</h2></div><span class="sub">Finish any ${ch.need || ch.list.length} for the Week ${ch.week} Grinder badge and 3 card packs</span></div>
        ${ch.list.map((c) => `<div class="ch ${c.done ? 'done' : ''}"><span class="ch-e">${c.emoji}</span><span class="ch-l">${esc(c.label)}<i class="ch-bar"><i style="width:${c.progress / c.goal * 100}%"></i></i></span><b>${c.done ? '✓' : `${c.progress}/${c.goal}`}</b></div>`).join('')}
        ${S.me ? '' : '<p class="rules"><a href="#" data-act="join">Sign in</a> to track your progress and earn badges.</p>'}</section>` : ''}
      ${ch?.badges?.length ? `<section class="ch-sec"><div class="label">Your badges</div><div class="bdg-row">${ch.badges.map((b) => `<span class="bdg" title="Earned ${new Date(b.earned_at).toLocaleDateString()}">🏅 ${esc(b.label)}</span>`).join('')}</div></section>` : ''}`;
    refreshAnim($('.ar-grid'));
  }

  // ================= account sheet extras =================
  SL.hooks.account = async () => {
    const box = $('#acctExtra'); if (!box) return;
    try {
      const r = await api('/api/challenges');
      if (!$('#acctExtra')) return;
      box.innerHTML = `<div class="acct-stats"><div><b>🔥 ${r.callit?.best || 0}</b><span>Best Call It streak</span></div><div><b>${r.daily?.streak || 0}</b><span>Daily streak</span></div><div><b>${r.takes?.hit || 0}-${r.takes?.miss || 0}</b><span>Take receipts</span></div></div>
        ${r.badges.length ? `<div class="bdg-row">${r.badges.map((b) => `<span class="bdg">🏅 ${esc(b.label)}</span>`).join('')}</div>` : '<p class="rules">Earn badges in the <a href="#/arcade" data-close>Arcade</a>: weekly challenges, Call It streaks, Daily streaks and receipts.</p>'}`;
    } catch { /* ignore */ }
  };

  // ================= More (phones) + install =================
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const iOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  function installBanner() {
    if (standalone() || ls.get('sl-install-hide')) return '';
    if (!installEvt && !iOS()) return '';
    return `<div class="install"><span>📲 <b>Get the app.</b> Add Sideline Live to your home screen for one-tap access and score alerts.</span><button class="btn" data-act="install">Install</button><button class="icon-btn" data-act="install-hide" aria-label="Hide">✕</button></div>`;
  }
  SL.acts.install = async () => {
    if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); installEvt = null; if (r?.outcome === 'accepted') toast('Installed. Find Sideline on your home screen.'); return; }
    openSheet('Add to your home screen', `<ol class="steps-list"><li>Tap the <b>Share</b> button <span aria-hidden="true">(the square with an arrow)</span> at the bottom of Safari.</li><li>Scroll and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Open Sideline from your home screen, then turn on score alerts in My teams.</li></ol>`);
  };
  SL.acts['install-hide'] = (t) => { ls.set('sl-install-hide', '1'); t.closest('.install')?.remove(); };
  SL.acts.navmore = () => {
    openSheet('More', `<div class="more-list">
      <a href="#/lineups" data-close><span>📋</span>Lineups<small>Weekly salary-cap lineup</small></a>
      <a href="#/players" data-close><span>📈</span>Players<small>Everyone's points this week</small></a>
      <a href="#/ranks" data-close><span>🏆</span>Ranks<small>Top pickers by credits</small></a>
      <a href="#/arcade" data-close><span>🕹️</span>Arcade<small>Call It, Daily, takes, duels…</small></a>
      ${standalone() ? '' : '<button type="button" data-act="install"><span>📲</span>Install the app<small>Home screen + score alerts</small></button>'}
      <a href="#/locker" data-close><span>🔓</span>Locker<small>Your level, frames, colors and name tags</small></a>
      <button type="button" data-act="rz-settings"><span>🔴</span>Red zone alerts<small>Get pinged when a game hits the red zone</small></button>
      <button type="button" data-act="customize-open"><span>🎨</span>Customize<small>Look, colors, logos</small></button>
      <a href="https://sidelineff.com/"><span>↗</span>sidelineff.com<small>Rankings, trade analyzer, more</small></a></div>`);
  };
  SL.acts['customize-open'] = () => $('#customizeBtn')?.click();

  // ================= phone alerts (installed app, Web Push) =================
  const swUrl = () => `${SL.API}/sw.js`;
  let swReg = null;
  async function swReady() {
    if (!('serviceWorker' in navigator)) return null;
    if (swReg) return swReg;
    try { swReg = await navigator.serviceWorker.register(swUrl(), { scope: SL.API || '/' }); return swReg; } catch { return null; }
  }
  const b64 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  async function pushSubscribe(quiet) {
    const reg = await swReady();
    if (!reg || !('PushManager' in window)) { if (!quiet && iOS() && !standalone()) toast('On iPhone, install the app first (Share → Add to Home Screen) to get alerts with the screen off.'); return false; }
    if (Notification.permission !== 'granted') return false;
    try {
      const { key } = await api('/api/push/key');
      if (!key) return false;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      await api('/api/push/subscribe', { method: 'POST', body: { sub: sub.toJSON(), players: [...S.myFantasyIds], base: pageBase(), prefs: { redzone: ls.get('sl-rz') || 'mine' } } });
      ls.set('sl-push', '1');
      return true;
    } catch { return false; }
  }
  async function pushOff() {
    const reg = await swReady(); const sub = await reg?.pushManager?.getSubscription().catch(() => null);
    if (sub) { api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {}); sub.unsubscribe().catch(() => {}); }
    ls.set('sl-push', null);
  }
  SL.pushRefresh = () => (ls.get('sl-push') === '1' ? pushSubscribe(true) : Promise.resolve(false));
  SL.hooks.alerts = async (on) => { if (on) { if (await pushSubscribe(false)) toast('Alerts on, even with the screen off.'); } else pushOff(); };
  let idsT;
  SL.hooks.fantasyIds = () => { if (!S.alerts || ls.get('sl-push') !== '1') return; clearTimeout(idsT); idsT = setTimeout(() => pushSubscribe(true), 2000); };
  if ('serviceWorker' in navigator) setTimeout(swReady, 3000);

  // ================= live updates =================
  SL.hooks.stream = (es) => {
    const j = (e) => { try { return JSON.parse(e.data); } catch { return {}; } };
    es.addEventListener('callit_open', (e) => {
      const d = j(e);
      const g = S.call.games[d.gameId] || (S.call.games[d.gameId] = { counts: {} });
      if (d.now) S.call.offset = d.now - Date.now();
      g.win = d.win; g.counts = d.counts || g.counts;
      if (g.mine) loadCallsSoon(300); else drawCalls(d.gameId);
    });
    es.addEventListener('callit_n', (e) => { const d = j(e); const g = S.call.games[d.gameId]; if (g) { g.counts = d.counts; drawCalls(d.gameId); } });
    es.addEventListener('callit', (e) => { const d = j(e); const g = S.call.games[d.gameId]; if (g?.last?.result === 'pending' || g?.mine) loadCallsSoon(200); });
    es.addEventListener('room', (e) => { const d = j(e); if (SL.currentRoute() === 'room' && S.room.id === d.room) loadRoomMsgs(); });
    es.addEventListener('takes', () => { if (SL.currentRoute() === 'takes' && S.takes.tab === 'fresh') { clearTimeout(S.takes.t); S.takes.t = setTimeout(loadTakes, 1500); } });
    es.addEventListener('play', (e) => {
      const p = j(e);
      if (SL.currentRoute() === 'room' && (p.players || []).some((x) => S.room.owners.has(String(x.id)))) {
        S.roomPlays = [p, ...(S.roomPlays || [])].slice(0, 40);
        const el = $('#rmPlays'); if (el) { el.querySelector('.rules')?.remove(); el.insertAdjacentHTML('afterbegin', roomRow(p)); }
      }
    });
    es.addEventListener('games', () => { if (S.games.some((g) => g.state === 'in') && !S.call.loaded) loadCalls(); });
  };
  // Call It needs to know who's live as soon as the page opens
  setTimeout(() => { if (S.games.some((g) => g.state === 'in')) loadCalls(); }, 1200);
  setInterval(() => { if (S.games.some((g) => g.state === 'in') && !document.hidden) loadCalls(); }, 60000);

  // ================= routes =================
  Object.assign(SL.routes, {
    arcade: showArcade, daily: showDaily, takes: showTakes, aura: showAura,
    duels: showDuels, duel: showDuel, house: showHouse, wrapped: showWrapped, room: showRoom,
  });
  void markEnter;
})();
