/* sideline live: spoiler shield, radio mode, hype meter and video clips for sharing.
   Builds on window.SL from app.js, arcade.js and arcade-plus.js. */
(() => {
  'use strict';
  const SL = window.SL;
  if (!SL) return;
  const { S, api, esc, fmt, toast, openSheet, closeSheet } = SL;
  const $ = (q, el = document) => el.querySelector(q);
  const ls = SL.ls;
  const calm = SL.calm;
  const serverNow = () => Date.now() + (S.call?.offset || 0);

  // ================= SPOILER SHIELD =================
  // TV and streams run 30-90 seconds behind. With the shield on, everything live (plays, scores,
  // alerts, red zone, hype) waits that long, so Live never shows you a play before your TV does.
  S.shield = { delay: Math.max(0, Math.min(120, Number(ls.get('sl-delay')) || 0)), at: null, until: 0 };
  const D = () => S.shield.delay * 1000;
  const DELAYED = new Set(['play', 'play_update', 'game', 'games', 'refresh', 'points', 'redzone', 'hype', 'callit', 'callit_open', 'callit_n', 'lineups', 'leaderboard', 'splits']);
  // plays newer than your TV are held back, then the feed refreshes when your TV catches up
  let shieldT = 0;
  SL.hooks.shieldPlays = (plays) => {
    if (!D()) return plays;
    const cut = serverNow() - D();
    const shown = plays.filter((p) => (p.ts || 0) <= cut);
    const held = plays.filter((p) => (p.ts || 0) > cut);
    if (held.length) {
      const wait = Math.max(...held.map((p) => p.ts)) - cut + 400;
      clearTimeout(shieldT);
      shieldT = setTimeout(() => { if ($('#feedList') && window.scrollY < 300) SL.loadFeed?.(); }, Math.min(wait, 130000));
    }
    return shown;
  };
  // scores on the page match your TV, not the real game, until the delayed live updates take over
  SL.hooks.shieldGames = (list) => {
    if (!D() || !S.shield.at || Date.now() > S.shield.until) return list;
    return list.map((g) => {
      const a = S.shield.at[g.id];
      if (!a || g.state === 'pre') return g;
      return { ...g, state: a.before ? 'pre' : g.state, away: { ...g.away, score: a.away }, home: { ...g.home, score: a.home }, detail: a.period ? `Q${a.period} ${a.clock || ''}` : g.detail, redZone: false, downDistance: '' };
    });
  };
  if (D()) {
    S.shield.until = Date.now() + D();
    api(`/api/scores-at?ago=${S.shield.delay}`).then((r) => { S.shield.at = r.games; SL.refreshGames?.().catch(() => {}); }).catch(() => {});
  }
  const shieldLabel = () => (S.shield.delay ? `${S.shield.delay}s` : 'off');
  function setDelay(sec) {
    ls.set('sl-delay', sec ? String(sec) : null);
    SL.pushRefresh?.();
    toast(sec ? `Spoiler shield on: Live runs ${sec} seconds behind.` : 'Spoiler shield off: everything is live again.');
    setTimeout(() => location.reload(), 900);
  }
  SL.acts.shield = () => {
    const opts = [0, 15, 30, 45, 60, 90];
    openSheet('Spoiler shield', `<p class="intro">Your TV or stream is probably 30–90 seconds behind real life, so Live can spoil plays. Set how far behind you are and Live waits: plays, scores, alerts, red zone and hype all show up when your TV gets there.</p>
      <div class="sh-opts">${opts.map((s) => `<button type="button" class="sh-opt ${S.shield.delay === s ? 'on' : ''}" data-act="shield-set" data-s="${s}"><b>${s ? `${s}s` : 'Off'}</b><small>${s === 0 ? 'Real time' : s <= 15 ? 'Cable TV' : s <= 45 ? 'Most streams' : 'Slow streams'}</small></button>`).join('')}</div>
      <div class="sh-sync"><div class="label">Not sure? Sync with your TV</div><p class="rules">Shows the most recent play. Tap the button the moment you see it happen on your TV.</p><button class="btn" type="button" data-act="shield-sync">Start syncing</button><div id="shSync"></div></div>
      ${S.shield.delay > 10 ? '<p class="rules">Call It is paused while the shield is on, because it runs in real time.</p>' : ''}`);
  };
  SL.acts['shield-set'] = (t) => { closeSheet(); setDelay(Number(t.dataset.s)); };
  SL.acts['shield-sync'] = async () => {
    const box = $('#shSync'); if (!box) return;
    box.innerHTML = '<p class="rules">Finding the latest play…</p>';
    let p;
    try { p = (await api('/api/feed?limit=1')).plays?.[0]; } catch { /* ignore */ }
    if (!p) { box.innerHTML = '<p class="rules">No plays yet. Try again once a game is on.</p>'; return; }
    const g = S.gamesById.get(p.gameId);
    box.innerHTML = `<div class="sh-play"><small>${esc(g ? `${g.away.abbr} @ ${g.home.abbr}` : '')} · Q${p.period} ${esc(p.clock)}</small><b>${esc(p.headline)}</b></div><button class="btn sh-now" type="button" data-act="shield-now" data-ts="${p.ts}">It just happened on my TV</button>`;
  };
  SL.acts['shield-now'] = (t) => {
    const sec = Math.max(0, Math.min(120, Math.round((serverNow() - Number(t.dataset.ts)) / 1000) + 2));
    closeSheet();
    if (sec > 118) return toast('That play is too old to sync with. Try again on the next one.');
    setDelay(sec);
  };
  // a small badge in the header while the shield is on
  if (S.shield.delay) {
    const tools = $('.hdr-tools');
    if (tools) tools.insertAdjacentHTML('afterbegin', `<button type="button" class="shield-pill" data-act="shield" title="Spoiler shield: Live runs ${S.shield.delay} seconds behind">🛡 ${S.shield.delay}s</button>`);
  }

  // ================= RADIO MODE =================
  // Reads plays out loud with the phone's built-in voice, for when you're not looking at the screen.
  S.radio = ls.get('sl-radio') || 'off';
  let wake = null;
  const synth = window.speechSynthesis;
  function voice() {
    const vs = synth?.getVoices?.() || [];
    return vs.find((v) => /en-US/i.test(v.lang) && /Samantha|Google US English|Aaron|Daniel|Alex/i.test(v.name)) || vs.find((v) => /^en/i.test(v.lang)) || null;
  }
  function say(text) {
    if (!synth || !text) return;
    if (synth.pending || synth.speaking) { if ((say.q = (say.q || 0) + 1) > 2) synth.cancel(); }
    const u = new SpeechSynthesisUtterance(text);
    const v = voice(); if (v) u.voice = v;
    u.rate = 1.06; u.pitch = 1;
    u.onend = () => { say.q = Math.max(0, (say.q || 1) - 1); };
    synth.speak(u);
  }
  const spoken = (s) => String(s || '')
    .replace(/(\d+)-yd\b/g, '$1 yard').replace(/\byds?\b/g, 'yards').replace(/\bTD\b/g, 'touchdown').replace(/\bFG\b/g, 'field goal')
    .replace(/\bINT\b/g, 'interception').replace(/\bPAT\b/g, 'extra point').replace(/\b2-pt\b/gi, 'two point').replace(/·/g, ',');
  function radioPlay(p) {
    if (S.radio === 'off') return;
    const x = SL.primaryOf(p); if (!x) return;
    const v = SL.adj(x);
    const mine = SL.isMine(p);
    const big = p.td || Math.abs(v) >= 8 || p.kind === 'int' || p.turnover;
    if (S.radio === 'mine' ? !(mine && (p.td || Math.abs(v) >= 1)) : S.radio === 'big' ? !(big || (mine && Math.abs(v) >= 3)) : false) return;
    const pts = Math.abs(v) >= 0.05 ? ` ${v > 0 ? 'Plus' : 'Minus'} ${fmt(Math.abs(v))}.` : '';
    say(`${mine ? 'Your guy! ' : ''}${x.name}. ${spoken(p.headline)}.${pts}`);
  }
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener?.('release', () => { wake = null; }); }
      if (!on && wake) { await wake.release(); wake = null; }
    } catch { /* not allowed right now */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.radio !== 'off') keepAwake(true); });
  if (S.radio !== 'off') keepAwake(true);
  SL.acts.radio = () => {
    if (!synth) return toast('This browser can\'t read plays out loud.');
    const opt = (v, l, s) => `<button type="button" class="rz-opt ${S.radio === v ? 'on' : ''}" data-act="radio-set" data-v="${v}"><b>${l}</b><small>${s}</small></button>`;
    openSheet('Radio mode', `<p class="intro">Live reads plays out loud, like a radio call, so you can follow along while you drive, cook or watch another game. Keep this page open; your screen stays on while radio mode is on.</p>
      <div class="rz-opts">${opt('mine', 'My players', 'Every touch by someone on your synced teams')}${opt('big', 'Big plays', 'Touchdowns, turnovers and 8+ point plays, plus your players')}${opt('all', 'Every play', 'The whole game, play by play')}${opt('off', 'Off', 'Quiet')}</div>`);
  };
  SL.acts['radio-set'] = (t) => {
    S.radio = t.dataset.v;
    ls.set('sl-radio', S.radio === 'off' ? null : S.radio);
    document.querySelectorAll('.rz-opt').forEach((b) => b.classList.toggle('on', b === t));
    keepAwake(S.radio !== 'off');
    // the first words have to come from a tap (phones only allow sound after one)
    if (S.radio !== 'off') say(`Radio mode on. ${S.radio === 'mine' ? 'Following your players.' : S.radio === 'big' ? 'Calling the big plays.' : 'Calling every play.'}`);
    else synth?.cancel();
    const b = $('.radio-pill'); if (b) { b.classList.toggle('on', S.radio !== 'off'); b.textContent = S.radio !== 'off' ? '📻 Radio on' : '📻 Radio'; }
  };

  // ================= HYPE METER =================
  S.hype = { games: {}, loudest: null };
  const hypeHtml = (g) => {
    if (g.state !== 'in') return '';
    const v = S.hype.games[g.id] || 0;
    return `<div class="hype ${v >= 70 ? 'hot' : ''}" data-hype="${esc(g.id)}"><span class="hy-l">🔥 Hype</span><span class="hy-bar"><i style="width:${v}%"></i></span><b>${v}</b>${S.hype.loudest === g.id ? '<em>Loudest game</em>' : ''}</div>`;
  };
  function drawHype(prev) {
    for (const el of document.querySelectorAll('[data-hype]')) {
      const id = el.dataset.hype, v = S.hype.games[id] || 0;
      el.outerHTML = hypeHtml(S.gamesById.get(id) || { id, state: 'in' });
      if (prev && v - (prev[id] || 0) >= 25) quake(id);
    }
  }
  function quake(gameId) {
    if (calm.matches) return;
    document.querySelectorAll(`.lc-wrap[data-lc="${CSS.escape(gameId)}"]`).forEach((el) => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); });
    if (SL.currentRoute() === 'game' && location.hash.endsWith(`/${gameId}`)) { document.body.classList.remove('quake'); void document.body.offsetWidth; document.body.classList.add('quake'); setTimeout(() => document.body.classList.remove('quake'), 700); }
  }
  // Call It is paused while the spoiler shield is on (it runs in real time)
  const prevLive = SL.hooks.liveExtra;
  SL.hooks.liveExtra = (g) => `${hypeHtml(g)}${D() > 10000 && g.state === 'in' ? '<div class="callit ci-paused"><span class="ci-title">Call It</span> <span class="ci-note">Paused while your spoiler shield is on (it runs in real time).</span></div>' : prevLive ? prevLive(g) : ''}`;
  setTimeout(() => { if (S.games.some((g) => g.state === 'in')) api('/api/hype').then((r) => { Object.assign(S.hype, r); drawHype(); }).catch(() => {}); }, 1500);

  // ================= VIDEO CLIPS =================
  // A 6-second vertical video of the play: the ball flies down the field, the photo pops in,
  // the points count up. Recorded right in the browser, ready for TikTok, Reels and Snapchat.
  const VTYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const vtype = () => (window.MediaRecorder && HTMLCanvasElement.prototype.captureStream ? VTYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) : null);
  SL.hooks.shareExtra = () => (vtype() ? '<button class="btn ghost" type="button" data-act="vclip">🎬 Make a video</button>' : '');
  const ease = (k) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
  const back = (k) => { k = Math.min(1, Math.max(0, k)); const c = 1.7; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };
  const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  async function recordClip(p, st, onProgress) {
    const C = SL.card;
    await C.fontsReady();
    const x = SL.primaryOf(p);
    const team = SL.teamInfo(x?.team || p.offense || '');
    const color = /^#[0-9a-f]{6}$/i.test(team.color || '') ? team.color : '#33415a';
    const off = SL.teamInfo(p.offense || ''), def = SL.teamInfo(p.defense || '');
    const bad = st.style === 'badbeat';
    const img = await C.loadImg(x?.headshot || (x && /^\d+$/.test(String(x.id)) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${x.id}.png` : ''));
    const pts = x ? SL.adj(x) : 0;
    const yards = Number(p.yards) || 0;
    const start = p.yte != null ? 100 - p.yte : 30;
    const end = p.yte == null ? 70 : p.td ? 100 : Math.max(0, Math.min(100, start + yards));
    const pass = ['catch', 'incomplete', 'int'].includes(p.kind);
    const g = S.gamesById.get(p.gameId);
    const away = p.game?.away || g?.away.abbr || '', home = p.game?.home || g?.home.abbr || '';
    const cv = document.createElement('canvas'); cv.width = 720; cv.height = 1280;
    const ctx = cv.getContext('2d');
    ctx.scale(720 / C.W, 1280 / C.H);
    const W = C.W, H = C.H, DUR = 6500;
    const draw = (t) => {
      const gold = C.frame(ctx, bad ? '#8a1f24' : color);
      ctx.textAlign = 'right'; ctx.fillStyle = '#ece5d6'; ctx.font = '700 52px "Barlow Condensed", sans-serif';
      ctx.fillText(`${away} ${p.awayScore}–${p.homeScore} ${home}`, W - 72, 128);
      ctx.fillStyle = 'rgba(236,229,214,0.6)'; ctx.font = '500 30px "DM Sans", sans-serif'; ctx.fillText(`Q${p.period} ${p.clock || ''}`, W - 72, 172);
      // the field: the ball goes from where the play started to where it ended
      const fx = 90, fw = W - 180, fy = 250, fh = 150, k = ease(seg(t, 200, 1700));
      const zoneW = fw * 0.08, yardsW = fw - zoneW * 2, X = (yd) => fx + zoneW + yardsW * yd / 100;
      ctx.save(); ctx.globalAlpha = Math.min(1, t / 300);
      ctx.fillStyle = '#1f4d2b'; ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 16); ctx.fill();
      ctx.fillStyle = off.color || '#555'; ctx.fillRect(fx, fy, zoneW, fh);
      ctx.fillStyle = def.color || '#555'; ctx.fillRect(fx + fw - zoneW, fy, zoneW, fh);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
      for (let yd = 10; yd < 100; yd += 10) { ctx.beginPath(); ctx.moveTo(X(yd), fy + 8); ctx.lineTo(X(yd), fy + fh - 8); ctx.stroke(); }
      ctx.strokeStyle = '#7fb7ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(X(start), fy); ctx.lineTo(X(start), fy + fh); ctx.stroke();
      const bx = X(start + (end - start) * k), by = fy + fh / 2 - (pass ? Math.sin(Math.PI * k) * 110 : 0);
      ctx.strokeStyle = p.td ? gold : yards < 0 ? '#e0736a' : '#fff'; ctx.lineWidth = 6; ctx.setLineDash([14, 10]);
      ctx.beginPath(); for (let i = 0; i <= 24; i++) { const kk = k * i / 24; const xx = X(start + (end - start) * kk), yy = fy + fh / 2 - (pass ? Math.sin(Math.PI * kk) * 110 : 0); if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); } ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#8b4a26'; ctx.beginPath(); ctx.ellipse(bx, by, 20, 13, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx - 8, by); ctx.lineTo(bx + 8, by); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '700 40px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
      if (k >= 1) ctx.fillText(`${yards > 0 ? '+' : ''}${yards} YDS`, W / 2, fy + fh + 54);
      ctx.restore();
      // the player
      const s = back(seg(t, 1300, 2100));
      if (s > 0) { ctx.save(); ctx.translate(W / 2, 700); ctx.scale(s, s); ctx.translate(-W / 2, -700); C.circleImg(ctx, img, W / 2, 700, 200, color, C.initialsOf(x?.name || p.headline)); ctx.restore(); }
      const a1 = ease(seg(t, 1700, 2300));
      ctx.save(); ctx.globalAlpha = a1; ctx.textAlign = 'center';
      ctx.fillStyle = '#fff'; ctx.font = '700 88px "DM Sans", sans-serif'; C.wrap(ctx, x?.name || p.headline, W / 2, 1010 + (1 - a1) * 40, W - 140, 92, 1);
      ctx.fillStyle = 'rgba(236,229,214,0.65)'; ctx.font = '500 40px "DM Sans", sans-serif'; ctx.fillText([x?.pos, x?.team].filter(Boolean).join(' · '), W / 2, 1070 + (1 - a1) * 40);
      ctx.restore();
      const hl = String(p.headline || ''), n = Math.round(hl.length * seg(t, 2100, 2900));
      ctx.textAlign = 'center'; ctx.fillStyle = '#ece5d6'; ctx.font = 'italic 400 64px "Instrument Serif", Georgia, serif';
      C.wrap(ctx, hl.slice(0, n), W / 2, 1170, W - 160, 72, 2);
      // the points count up, then flash
      const kp = ease(seg(t, 2900, 4000));
      if (t > 2900) {
        ctx.save();
        const flash = t > 4000 && t < 4400 ? 1 - (t - 4000) / 400 : 0;
        ctx.shadowColor = pts < 0 ? '#e0736a' : gold; ctx.shadowBlur = 60 * flash;
        ctx.fillStyle = pts < 0 ? '#e0736a' : gold; ctx.font = `700 ${Math.round(290 * (1 + flash * 0.08))}px "Barlow Condensed", sans-serif`;
        ctx.fillText(`${pts >= 0 ? '+' : '−'}${fmt(Math.abs(pts * kp))}`, W / 2, 1530);
        ctx.restore();
        ctx.fillStyle = 'rgba(236,229,214,0.6)'; ctx.font = '600 40px "DM Sans", sans-serif'; ctx.fillText(SL.unit(), W / 2, 1590);
      }
      const label = bad ? 'BAD BEAT 💀' : p.td ? '🔥 TOUCHDOWN' : Math.abs(pts) >= 10 ? '💥 BIG PLAY' : '';
      const kl = back(seg(t, 3300, 3800));
      if (label && kl > 0) { ctx.save(); ctx.translate(W / 2, 520); ctx.scale(kl, kl); ctx.rotate(bad ? -0.05 : 0); C.pill(ctx, label, 0, 0, bad ? '#d9555a' : gold, bad ? '#fff' : '#111', '700 58px "Barlow Condensed", sans-serif'); ctx.restore(); }
      if (st.caption && t > 4300) { ctx.save(); ctx.globalAlpha = ease(seg(t, 4300, 4800)); C.pill(ctx, st.caption.slice(0, 44), W / 2, 1700, bad ? 'rgba(217,85,90,0.3)' : 'rgba(236,229,214,0.14)', '#fff'); ctx.restore(); }
      SL.hooks.frameCard?.(ctx, W, H);
    };
    draw(0);
    const type = vtype();
    const stream = cv.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start(250);
    const t0 = performance.now();
    await new Promise((res) => {
      const step = () => {
        const t = performance.now() - t0;
        draw(Math.min(t, DUR));
        onProgress?.(Math.min(1, t / DUR));
        if (t < DUR) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    rec.stop();
    await done;
    const ext = /mp4/.test(type) ? 'mp4' : 'webm';
    return new File([new Blob(chunks, { type: type.split(';')[0] })], `sideline-play.${ext}`, { type: type.split(';')[0] });
  }
  SL.acts.vclip = async (t) => {
    if (t.disabled) return;
    const p = (S.lastShareId && (SL.findPlay(S.lastShareId) || S.lastSharePlay)) || null;
    if (!p) return toast('Open Share on a play first.');
    const st = { style: $('.sh-style .on')?.dataset.st || 'hype', caption: $('#shCap')?.value || '' };
    t.disabled = true; const label = t.textContent;
    try {
      const file = await recordClip(p, st, (k) => { t.textContent = `🎬 Recording… ${Math.round(k * 100)}%`; });
      const url = URL.createObjectURL(file);
      const prev = $('#shPrev');
      if (prev) prev.innerHTML = `<video src="${url}" autoplay loop muted playsinline></video>`;
      t.textContent = '📤 Share video';
      t.disabled = false;
      t.dataset.act = 'vshare';
      S.lastClip = file;
    } catch (e) {
      t.disabled = false; t.textContent = label;
      toast(`Couldn't make the video here (${e.message}). Try Chrome or Safari.`);
    }
  };
  SL.acts.vshare = async () => {
    if (!S.lastClip) return;
    const shared = await SL.card.shareFile(S.lastClip, { text: $('#shCap')?.value || '', url: `${location.href.split('#')[0]}#/play/${encodeURIComponent(S.lastShareId || '')}` });
    if (!shared) toast('Video saved. Post it on TikTok, Reels or Snapchat.');
  };
  // remember which play the share sheet is open for
  const prevShare = SL.acts.share;
  SL.acts.share = async (t, e) => {
    S.lastShareId = t.dataset.id; S.lastClip = null;
    S.lastSharePlay = SL.findPlay(t.dataset.id) || S.roomPlays?.find((x) => x.id === t.dataset.id) || null;
    if (!S.lastSharePlay) { try { S.lastSharePlay = (await api(`/api/plays/${encodeURIComponent(t.dataset.id)}`)).play; } catch { /* the share sheet will say */ } }
    return prevShare(t, e);
  };

  // ================= feed tools + More =================
  SL.hooks.feedTools = () => `<button type="button" class="pill shield-btn ${S.shield.delay ? 'on' : ''}" data-act="shield" title="Hold plays until your TV shows them">🛡 Spoiler shield: ${shieldLabel()}</button>
    <button type="button" class="pill radio-pill ${S.radio !== 'off' ? 'on' : ''}" data-act="radio" title="Hear plays read out loud">${S.radio !== 'off' ? '📻 Radio on' : '📻 Radio'}</button>`;
  const prevMore = SL.acts.navmore;
  SL.acts.navmore = () => {
    prevMore?.();
    $('.more-list')?.insertAdjacentHTML('afterbegin', `<button type="button" data-act="shield"><span>🛡</span>Spoiler shield<small>${S.shield.delay ? `On: Live runs ${S.shield.delay}s behind` : 'Hold plays until your TV shows them'}</small></button>
      <button type="button" data-act="radio"><span>📻</span>Radio mode<small>${S.radio !== 'off' ? 'On' : 'Hear plays read out loud'}</small></button>`);
  };

  // ================= live updates =================
  const prevStream = SL.hooks.stream;
  SL.hooks.stream = (es) => {
    // the spoiler shield holds every live update back by your delay
    const add = es.addEventListener.bind(es);
    es.addEventListener = (type, fn, o) => add(type, DELAYED.has(type) ? (e) => { const d = D(); if (d > 0) setTimeout(() => fn(e), d); else fn(e); } : fn, o);
    prevStream?.(es);
    const j = (e) => { try { return JSON.parse(e.data); } catch { return {}; } };
    es.addEventListener('hype', (e) => { const before = { ...S.hype.games }; Object.assign(S.hype, j(e)); drawHype(before); });
    es.addEventListener('play', (e) => radioPlay(j(e)));
    es.addEventListener('redzone', (e) => {
      const a = j(e);
      if (S.radio === 'off') return;
      if (S.radio === 'mine' && !(S.lg?.plRows || []).some((r) => r.team === a.offense && S.myFantasyIds.has(String(r.id)))) return;
      say(`Red zone. ${a.offense}${a.text ? `, ${spoken(a.text).replace(/&/g, 'and')}` : ''}.`);
    });
  };
})();
