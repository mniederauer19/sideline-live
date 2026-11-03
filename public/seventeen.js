/* sideline live: 17-0. Spin a team and a decade (the '70s to today), draft one player's best season
   with that team, fill 6 spots, then watch your lineup play a 17-game season.
   Arcade look to match the games on sidelineff.com (Hail Mary): pixel stadium, pixel type, chunky buttons.
   Builds on window.SL. */
(() => {
  'use strict';
  const SL = window.SL;
  if (!SL) return;
  const { S, api, esc, fmt, toast, tlogo } = SL;
  const $ = (q, el = document) => el.querySelector(q);
  const view = $('#view');
  const calm = SL.calm;
  const SLOTS = ['QB', 'RB1', 'WR1', 'WR2', 'TE', 'FLEX'];
  const LABEL = { QB: 'QB', RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', TE: 'TE', FLEX: 'FLEX', SF: 'SUPERFLEX' };
  const FITS = { QB: ['QB'], RB1: ['RB'], RB2: ['RB'], WR1: ['WR'], WR2: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], SF: ['QB', 'RB', 'WR', 'TE'] };
  SL.navFor['170'] = 'arcade';
  S.s17 = { run: null, st: null };
  const num = (v) => Number(v || 0).toLocaleString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function statLine(p) {
    if (p.pos === 'QB') return [`${num(p.passYds)} pass yds`, `${p.passTd} TD`, `${p.int ?? 0} INT`, p.rushYds > 99 ? `${num(p.rushYds)} rush yds` : ''].filter(Boolean).join(' · ');
    if (p.pos === 'RB') return [`${num(p.rushYds)} rush yds`, `${p.rushTd + p.recTd} TD`, p.rec ? `${p.rec} rec, ${num(p.recYds)} yds` : ''].filter(Boolean).join(' · ');
    return [`${p.rec} rec`, `${num(p.recYds)} yds`, `${p.recTd} TD`].join(' · ');
  }
  const ini = (n) => String(n || '?').split(' ').map((w) => w[0]).join('').slice(0, 2);
  const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

  // ---------- the pixel stadium behind every 17-0 screen ----------
  // Drawn small (320 wide) and scaled up with crisp pixels. The crowd twinkles, jumps on a win,
  // and the sky lights up with fireworks on a perfect season.
  function stadium(cv) {
    const W = 320;
    const g = cv.getContext('2d');
    let H = 180, base = null, crowd = [], stars = [], excite = 0, flash = 0, flashC = '255,255,255', sparks = [];
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const CROWD = ['#d9555a', '#f4c44e', '#4fc1b0', '#e9ecff', '#7d86d6', '#ff9a4a', '#9fbf8a', '#c86bd8'];
    function build() {
      const wpx = cv.parentElement.clientWidth || 390, hpx = cv.parentElement.clientHeight || 700;
      // tall enough for long pages from the start, and it only ever grows, so the scene never jumps
      H = Math.max(H, 180, Math.min(1600, Math.round(W * Math.max(hpx, innerHeight * 2) / wpx)));
      cv.width = W * 2; cv.height = H * 2; // drawn at 2x so motion can move in half pixels
      base = document.createElement('canvas'); base.width = W; base.height = H;
      const b = base.getContext('2d'); seed = 7;
      const px = (x, y, w, h, c) => { b.fillStyle = c; b.fillRect(x, y, w, h); };
      // night sky in hard bands
      px(0, 0, W, H, '#070b22'); px(0, 22, W, 18, '#080d27'); px(0, 40, W, 18, '#0a102e');
      stars = Array.from({ length: 46 }, () => ({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * 50), t: rnd() }));
      // the stands: a back wall, rows and a dark lip above the field
      px(0, 56, W, 44, '#141a40');
      for (let y = 58; y < 98; y += 4) px(0, y, W, 1, '#10153a');
      px(0, 54, W, 2, '#252c66'); px(0, 98, W, 3, '#0b0f2b');
      // scoreboard on the stands
      px(126, 26, 68, 26, '#0b0e27'); px(126, 26, 68, 2, '#3d4590'); px(126, 50, 68, 2, '#3d4590'); px(126, 26, 2, 26, '#3d4590'); px(192, 26, 2, 26, '#3d4590');
      px(158, 52, 4, 6, '#2b3060');
      for (let i = 0; i < 9; i++) px(131 + i * 7, 31, 4, 3, i % 2 ? '#f4c44e' : '#4fc1b0');
      px(134, 38, 22, 9, '#1d2250'); px(164, 38, 22, 9, '#1d2250');
      // light towers
      for (const x0 of [22, 272]) {
        px(x0 + 12, 22, 2, 36, '#2b3060');
        px(x0 - 4, 8, 34, 16, 'rgba(255,240,190,0.06)'); px(x0 - 2, 10, 30, 12, 'rgba(255,240,190,0.08)');
        px(x0, 12, 26, 9, '#fff4cf');
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) px(x0 + 2 + i * 6, 13 + j * 4, 4, 3, '#ffe9a0');
      }
      // the field, looking up it from the end zone
      const top = 101, vh = H - top;
      const xl = (y) => 40 - ((y - top) / vh) * 200, xr = (y) => 280 + ((y - top) / vh) * 200;
      const yards = Array.from({ length: 12 }, (_, k) => Math.round(top + vh * Math.pow(k / 11, 1.55)));
      for (let k = 0; k < yards.length - 1; k++) {
        for (let y = yards[k]; y < yards[k + 1]; y++) { const a = Math.max(0, Math.round(xl(y))), z = Math.min(W, Math.round(xr(y))); px(a, y, z - a, 1, k % 2 ? '#2a7434' : '#2f8a3b'); }
        const y = yards[k]; const a = Math.max(0, Math.round(xl(y))), z = Math.min(W, Math.round(xr(y))); px(a, y, z - a, 1, 'rgba(242,246,234,0.85)');
      }
      for (let y = top; y < H; y++) { px(Math.round(xl(y)), y, 2, 1, '#f2f6ea'); px(Math.round(xr(y)) - 2, y, 2, 1, '#f2f6ea'); }
      // hash marks
      for (let k = 1; k < yards.length - 1; k++) { const y = yards[k]; for (const f of [0.42, 0.58]) { const x = Math.round(xl(y) + (xr(y) - xl(y)) * f); px(x, y - 1, 1, 3, '#f2f6ea'); } }
      // two little lines of players near the far end
      for (let i = 0; i < 7; i++) { px(140 + i * 6, 112, 2, 3, '#d9555a'); px(140 + i * 6, 111, 2, 1, '#f4c44e'); px(141 + i * 6, 118, 2, 3, '#e9ecff'); px(141 + i * 6, 117, 2, 1, '#3d4590'); }
      // dark below the content so panels read well on tall screens
      const gr = b.createLinearGradient(0, top, 0, H); gr.addColorStop(0, 'rgba(7,11,34,0)'); gr.addColorStop(1, 'rgba(7,11,34,0.55)');
      b.fillStyle = gr; b.fillRect(0, top, W, vh);
      crowd = [];
      for (let y = 60; y < 97; y += 4) for (let x = 1; x < W - 1; x += 3) {
        if (x > 120 && x < 200 && y < 62) continue;
        if (rnd() < 0.12) continue;
        crowd.push({ x, y, c: CROWD[Math.floor(rnd() * CROWD.length)], j: rnd() });
      }
    }
    // One frame, timed in seconds so it runs at the screen's own refresh rate
    function frame(t) {
      g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false;
      g.drawImage(base, 0, 0, W * 2, H * 2);
      g.setTransform(2, 0, 0, 2, 0, 0);
      for (const s of stars) { const v = 0.5 + 0.5 * Math.sin(t * 1.6 + s.t * 40); g.globalAlpha = 0.25 + 0.75 * v; g.fillStyle = s.t > 0.8 ? '#e9ecff' : '#8e95c4'; g.fillRect(s.x, s.y, 1, 1); }
      g.globalAlpha = 1;
      for (const p of crowd) {
        // the crowd bobs on a sine wave, harder the more excited they are
        const amp = p.j < 0.12 ? 0.5 : 0; const hype = p.j < excite * 0.9 ? excite * 2.6 : 0;
        const lift = Math.max(0, Math.sin(t * (hype ? 13 : 2) + p.j * 37)) * (hype || amp);
        g.fillStyle = p.c; g.fillRect(p.x, Math.round((p.y - lift) * 2) / 2, 2, 2);
        if (hype && p.j < excite * 0.3) { g.fillStyle = '#ffffff'; g.fillRect(p.x, Math.round((p.y - lift - 1) * 2) / 2, 1, 1); }
      }
      for (const k of sparks) { g.globalAlpha = Math.min(1, k.life / 0.5); g.fillStyle = k.c; g.fillRect(Math.round(k.x * 2) / 2, Math.round(k.y * 2) / 2, 1.5, 1.5); }
      g.globalAlpha = 1;
      if (flash > 0.01) { g.fillStyle = `rgba(${flashC},${(flash * 0.35).toFixed(3)})`; g.fillRect(0, 0, W, H); }
    }
    let last = 0, raf = 0, still = 0;
    function loop(now) {
      if (!cv.isConnected) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      excite = Math.max(0, excite - dt * 0.55); flash = Math.max(0, flash - dt * 2.6);
      for (const k of sparks) { k.x += k.vx * dt * 60; k.y += k.vy * dt * 60; k.vy += 0.07 * dt * 60; k.vx *= 0.985; k.life -= dt; }
      sparks = sparks.filter((k) => k.life > 0);
      // when nothing is happening, the stars and crowd idle at 30 frames a second to save battery
      if (!excite && !flash && !sparks.length && (still = (still + 1) % 2)) return;
      frame(now / 1000);
    }
    build(); frame(0);
    if (!calm.matches) raf = requestAnimationFrame(loop);
    let rt = null;
    let lastW = cv.parentElement.clientWidth;
    const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => {
      if (!cv.isConnected) { ro.disconnect(); cancelAnimationFrame(raf); return; }
      const wpx = cv.parentElement.clientWidth, need = Math.round(W * cv.parentElement.clientHeight / wpx);
      if (wpx !== lastW) { lastW = wpx; H = 180; } else if (need <= H) return; // only redraw for a new width or a taller page
      build(); frame(performance.now() / 1000);
    }, 120); });
    ro.observe(cv.parentElement);
    return {
      cheer(level = 1) { excite = Math.min(1, Math.max(excite, level)); },
      flash(rgb = '255,255,255', v = 1) { flash = v; flashC = rgb; },
      fireworks(n = 6) {
        if (calm.matches) return;
        const burst = () => { const x = 40 + Math.random() * 240, y = 10 + Math.random() * 40, c = CROWD[Math.floor(Math.random() * CROWD.length)];
          for (let i = 0; i < 34; i++) { const a = (i / 34) * Math.PI * 2, v = 0.5 + Math.random() * 0.7; sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.25, c, life: 1.1 + Math.random() * 0.6 }); } };
        for (let i = 0; i < n; i++) setTimeout(burst, i * 380);
      },
    };
  }
  // Every 17-0 screen sits in one arcade scene; the stadium keeps running between screens
  function paint(html) {
    let scene = $('.px17', view);
    if (!scene) {
      view.innerHTML = '<div class="px17"><canvas class="px17-bg" aria-hidden="true"></canvas><div class="px17-in"></div></div>';
      scene = $('.px17', view);
      S.s17.st = stadium($('.px17-bg', scene));
    }
    $('.px17-in', scene).innerHTML = html;
    return scene;
  }
  const title = (t) => `<h1 class="px17-title" data-text="${esc(t)}">${esc(t)}</h1>`;
  const back = (right) => `<div class="px17-top"><a class="px17-back" href="#/170">‹ 17-0</a>${right || ''}</div>`;

  // ---------- home ----------
  async function showHome() {
    paint(`<p class="px17-kick c">Arcade · unlimited · free</p>${title('17-0')}<p class="px17-sub">Spin a team and a decade. Draft a six-man lineup.<br>Run the table.</p><div class="px-panel"><p class="px17-kick">Loading…</p></div>`);
    let t = null; try { t = await api('/api/170/today'); } catch { /* still playable */ }
    if (!/^#\/?170\/?$/.test(location.hash) || !$('.px17')) return; // moved on while this loaded
    const b = t?.best;
    paint(`<p class="px17-kick c">Arcade · unlimited · free</p>${title('17-0')}<p class="px17-sub">Spin a team and a decade. Draft a six-man lineup.<br>Run the table.</p>
      <div class="px-panel">
        <p class="px17-kick">Unlimited · 6 rounds · the '70s to today</p>
        <h2 class="px17-h">Go undefeated</h2>
        <p class="px17-txt">Every round spins a team and a decade, like the <b>1980s 49ers</b>. Grab any player's best season with them. Your lineup plays a 14-week season, then the playoffs: quarterfinal, semifinal, championship. Win them all for 17-0. Scoring is era-adjusted PPR per game, so a 1977 season counts as much as one from today.</p>
        <button type="button" class="px-go big" data-act="s17start" data-mode="decades">▶ Start a season</button>
        <div class="px17-stats"><div><small>Best</small><b>${b ? `${b.wins}-${b.losses ?? 17 - b.wins}` : '--'}</b></div><div><small>Perfect</small><b>${b ? b.perfect : 0}</b></div><div><small>Seasons</small><b>${b ? b.played : 0}</b></div></div>
      </div>
      <div class="px-panel">
        <p class="px17-kick">How it works</p>
        <ol class="px17-how">
          <li><b>Spin.</b> A random team and decade, from the 1970s to today.</li>
          <li><b>Draft.</b> Take one player's best season with that team in that decade: QB, RB, 2 WR, TE or FLEX.</li>
          <li><b>Re-spin.</b> One per round: a new team, or the same team in a new decade.</li>
          <li><b>Play.</b> Each player scores his era-adjusted PPR points per game, with hot and cold weeks, and misses the games he missed that year.</li>
          <li><b>Make the playoffs.</b> 14 weeks in a 12-team league. The top 8 make it. Lose once in the playoffs and you're out.</li>
          <li><b>17-0</b> means 14-0 plus a title. It wins the Perfect 17-0 badge and a card pack.</li>
        </ol>
      </div>`);
  }
  SL.acts.s17start = async (t) => {
    t.disabled = true; buzz(10);
    try { const r = await api('/api/170/start', { method: 'POST', body: { mode: 'decades' } }); S.s17.run = r.run; S.s17.fresh = true; location.hash = `#/170/${r.run.id}`; }
    catch (e) { toast(e.message); t.disabled = false; }
  };

  // ---------- a run ----------
  async function showRun(id) {
    if (!S.s17.run || S.s17.run.id !== id) {
      paint(`${back()}<div class="px-panel"><p class="px17-kick">Loading your season…</p></div>`);
      let run; try { run = (await api(`/api/170/run/${encodeURIComponent(id)}`)).run; } catch (e) { if (location.hash.includes(id)) paint(`${back()}<div class="px-panel"><h2 class="px17-h">${esc(e.message)}</h2><a class="px-go" href="#/170">Start a new run</a></div>`); return; }
      if (!location.hash.includes(id)) return; // moved on while this loaded
      S.s17.run = run;
    }
    draw(true);
  }
  const openSlots = (run) => SLOTS.filter((s) => !run.picks.some((p) => p.slot === s));
  // where a player can go: his own position first, then FLEX
  function slotsFor(run, pos) {
    const open = openSlots(run);
    const own = open.filter((s) => s !== 'FLEX' && s !== 'SF' && FITS[s].includes(pos)).slice(0, 1);
    return [...own, ...(open.includes('FLEX') && FITS.FLEX.includes(pos) ? ['FLEX'] : [])];
  }
  function lineupBar(run, fresh) {
    const order = run.picks.map((p) => p.slot);
    return `<div class="px17-line">${SLOTS.map((s) => {
      const p = run.picks.find((x) => x.slot === s);
      const isNew = fresh && p && order[order.length - 1] === s;
      return `<div class="px17-slot ${p ? 'full' : ''} ${isNew ? 'pop' : ''}"><small>${LABEL[s]}</small>${p ? `<b>${esc(p.name)}</b><span>${tlogo(p.team)}'${String(p.year).slice(2)} · ${fmt(p.adj, 1)}/g</span>` : '<b class="open">open</b>'}</div>`;
    }).join('')}</div>`;
  }
  // Team power: your lineup's points per week so far, against the average opponent
  function power(run) {
    const opp = run.opp || 93;
    // each pick's adjusted points per game, times the share of games he played
    const per = run.picks.reduce((a, p) => a + (p.adj || 0) * Math.min(1, (p.g || 0) / (p.games || 17)), 0);
    const max = Math.max(opp * 1.6, per * 1.1);
    const left = SLOTS.length - run.picks.length;
    const tier = left ? `${left} pick${left === 1 ? '' : 's'} to go` : per > opp * 1.25 ? '17-0 threat' : per > opp * 1.1 ? 'Contender' : per > opp ? 'Playoff team' : 'Underdog';
    return `<div class="px17-power"><div class="row"><span>Team power</span><b>${fmt(per, 1)}<small> pts/week</small></b><em>${esc(tier)}</em></div>
      <div class="bar"><i style="width:${Math.min(100, (per / max) * 100).toFixed(1)}%"></i><u style="left:${((opp / max) * 100).toFixed(1)}%" title="Average opponent"></u></div>
      <small class="note">The line is the average opponent: ${fmt(opp, 0)} a week.</small></div>`;
  }
  function boardHtml(run, sp) {
    const ro = sp.roster;
    return `<p class="px17-kick">Draft board · best season with the ${esc(sp.name)}</p>
      ${ro.players.map((p, i) => {
        const taken = run.picks.some((x) => x.name === p.name);
        const where = taken ? [] : slotsFor(run, p.pos);
        return `<div class="px17-p ${where.length ? '' : 'no'}" style="--d:${Math.min(i, 10) * 45}ms"><span class="pos ${p.pos}">${p.pos}</span>
          <div class="pi"><b>${esc(p.name)}</b><small>${sp.decade ? `<em>${p.year}</em> · ` : ''}${p.g} of ${p.games || ro.games} games · ${esc(statLine(p))}</small></div>
          <div class="pts"><b>${fmt(p.adj, 1)}</b><small>ADJ PPG</small></div>
          <div class="go">${taken ? '<small>On your team</small>' : where.length ? where.map((s, j) => `<button type="button" class="px-go small ${j ? 'teal' : ''}" data-act="s17pick" data-id="${esc(p.id)}" data-slot="${s}">${j ? LABEL[s] : `Draft · ${LABEL[s]}`}</button>`).join('') : '<small>No open spot</small>'}</div></div>`;
      }).join('')}
      <p class="px17-foot">Adj PPG: his PPR points per game that season, compared with the average starter at his position that year and put on today's scale. He sits out the games he missed that year.</p>`;
  }
  function draw(animate) {
    const run = S.s17.run;
    if (run.done) return drawSeason(run);
    const sp = run.spin;
    const fresh = S.s17.fresh; S.s17.fresh = false;
    const roll = animate && !calm.matches;
    // a re-spin only rolls the reel you changed: 'team' keeps the decade, 'year' keeps the team (and its logo and colors)
    const kind = roll ? S.s17.respin : null; S.s17.respin = null;
    const keepTeam = kind === 'year';
    const yr = sp.decade ? `${sp.year}s` : String(sp.year), tm = sp.decade ? sp.name.replace(/^\d{4}s /, '') : sp.name;
    const pips = SLOTS.map((_, i) => `<i class="${i < run.round ? 'done' : i === run.round ? 'now' : ''}"></i>`).join('');
    paint(`${back(`<span class="px17-kick">Round ${run.round + 1} of ${SLOTS.length}</span><span class="px17-pips">${pips}</span>`)}
      ${lineupBar(run, !fresh)}
      ${power(run)}
      <section class="px-panel px17-spin ${!roll || keepTeam ? 'set' : ''}" id="s17Spin" style="--tc:${esc(SL.teamInfo(sp.team).color || '#3d4590')}">
        <i class="px17-tint" aria-hidden="true"></i>
        <p class="px17-kick">${!roll ? 'Your spin' : kind === 'team' ? 'New team…' : kind === 'year' ? `New ${sp.decade ? 'decade' : 'year'}…` : 'Spinning…'}</p>
        <div class="px17-reels ${keepTeam ? 'landed' : ''}" id="s17Wheel">
          <div class="reel logo"><span class="q">?</span><span class="lg">${tlogo(sp.team)}</span></div>
          <div class="reel yr"><div class="rstrip"><b class="s17-year">${esc(yr)}</b></div></div>
          <div class="reel tm"><div class="rstrip"><b class="s17-team">${esc(tm)}</b></div></div>
        </div>
        <div class="px17-re"><button type="button" class="px-go teal small" data-act="s17re" data-k="team" ${sp.canTeam ? '' : 'disabled'}>↻ New team</button><button type="button" class="px-go teal small" data-act="s17re" data-k="year" ${sp.canYear ? '' : 'disabled'}>↻ ${sp.decade ? 'New decade' : 'New year'}</button><small>${sp.canTeam || sp.canYear ? 'One re-spin this round' : 'Re-spin used'}</small></div>
      </section>
      <section class="px-panel px17-board ${roll ? 'wait' : 'in'}" id="s17Board">${roll ? '<p class="px17-kick">Draft board</p><p class="px17-wait">The players show up when the spin lands.</p>' : boardHtml(run, sp)}</section>`);
    if (roll) spinAnim(run, sp, yr, tm, kind); else { const w = $('#s17Wheel'); w?.classList.add('landed'); }
  }
  // A slot machine: each reel is a strip of names that glides up and eases to a stop.
  // The decade stops first, then the team; only then do the logo, team colors and players appear.
  const NICK = ['Cowboys', 'Dolphins', 'Packers', 'Steelers', '49ers', 'Chiefs', 'Bills', 'Lions', 'Broncos', 'Giants', 'Raiders', 'Bears', 'Eagles', 'Rams', 'Vikings', 'Saints', 'Patriots', 'Jets', 'Colts', 'Browns', 'Bengals', 'Seahawks', 'Falcons', 'Chargers', 'Cardinals', 'Buccaneers', 'Titans', 'Jaguars', 'Ravens', 'Texans', 'Panthers', 'Commanders'];
  function spinAnim(run, sp, yr, tm, kind) {
    const w = $('#s17Wheel'); if (!w) return;
    const token = (S.s17.spinToken = (S.s17.spinToken || 0) + 1);
    const pick = (list, n, not) => Array.from({ length: n }, () => { let v; do v = list[Math.floor(Math.random() * list.length)]; while (v === not); return v; });
    const decs = ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
    const reel = (sel, items, finalCls, final, ms) => new Promise((done) => {
      const box = $(sel, w), strip = $('.rstrip', box);
      strip.innerHTML = [...items, final].map((v, k) => `<b class="${finalCls}${k === items.length ? ' final' : ''}">${esc(v)}</b>`).join('');
      const h = strip.firstElementChild.getBoundingClientRect().height;
      const a = strip.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-items.length * h}px)` }],
        { duration: ms, easing: 'cubic-bezier(.16,.78,.26,1.04)', fill: 'forwards' });
      a.onfinish = () => { box.classList.add('stop'); buzz(8); done(); };
    });
    w.classList.add('rolling');
    const reels = kind === 'team' ? [reel('.reel.tm', pick(NICK, 22, tm), 's17-team', tm, 1500)]
      : kind === 'year' ? [reel('.reel.yr', pick(decs, 16, yr), 's17-year', yr, 1400)]
        : [reel('.reel.yr', pick(decs, 14, yr), 's17-year', yr, 1150), reel('.reel.tm', pick(NICK, 24, tm), 's17-team', tm, 1750)];
    Promise.all(reels).then(() => {
      if (S.s17.spinToken !== token || !w.isConnected) return;
      w.classList.remove('rolling'); w.classList.add('landed');
      const spin = $('#s17Spin'); spin?.classList.add('set');
      const k = $('.px17-kick', spin); if (k) k.textContent = 'Your spin';
      landed(); buzz(14);
      const b = $('#s17Board');
      if (b) { b.innerHTML = boardHtml(run, sp); requestAnimationFrame(() => { b.classList.remove('wait'); b.classList.add('in'); }); }
    });
  }
  function landed() { S.s17.st?.flash('244,196,78', 0.45); S.s17.st?.cheer(0.35); }
  SL.acts.s17re = async (t) => {
    t.disabled = true;
    try { S.s17.run = (await api('/api/170/respin', { method: 'POST', body: { runId: S.s17.run.id, kind: t.dataset.k } })).run; S.s17.respin = t.dataset.k; draw(true); }
    catch (e) { toast(e.message); t.disabled = false; }
  };
  SL.acts.s17pick = async (t) => {
    document.querySelectorAll('[data-act="s17pick"]').forEach((b) => { b.disabled = true; });
    try {
      S.s17.run = (await api('/api/170/pick', { method: 'POST', body: { runId: S.s17.run.id, playerId: t.dataset.id, slot: t.dataset.slot } })).run;
      buzz(15); S.s17.st?.cheer(0.6);
      draw(true); window.scrollTo({ top: 0, behavior: calm.matches ? 'auto' : 'smooth' });
    } catch (e) { toast(e.message); draw(false); }
  };

  // ---------- the season: a scoreboard that plays out week by week ----------
  // How the season ended, in words
  const PO = { qf: 'Quarterfinal', sf: 'Semifinal', final: 'Championship' };
  const verdict = (r) => (r.wins === 17 ? 'Perfect season' : r.champ ? 'League champions' : r.playoff === 'final' ? 'Runner-up' : r.playoff === 'sf' ? 'Lost in the semis' : r.playoff === 'qf' ? 'Lost in the quarters' : 'Missed the playoffs');
  const verdictCls = (r) => (r.wins === 17 || r.champ ? 'gold' : r.playoff === 'final' || r.playoff === 'sf' ? 'good' : r.playoff === 'missed' ? 'bad' : '');
  const ord = (n) => `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;
  function drawSeason(run) {
    const r = run.result;
    const reg = r.weeks.filter((w) => w.stage !== 'qf' && w.stage !== 'sf' && w.stage !== 'final');
    const po = r.weeks.filter((w) => PO[w.stage]);
    const best = r.weeks.reduce((a, w) => (w.you > a.you ? w : a), r.weeks[0]);
    const losses = r.weeks.filter((w) => !w.win).sort((a, b) => (b.you - b.opp) - (a.you - a.opp));
    const rw = r.reg?.wins ?? reg.filter((w) => w.win).length, rl = r.reg?.losses ?? reg.length - rw;
    const bracket = ['qf', 'sf', 'final'].map((k) => { const g = po.find((w) => w.stage === k); return `<div class="px17-wk po ${k} ${g ? (g.win ? 'w' : 'l') : 'x'}" data-stage="${k}"><small>${k === 'final' ? '🏆' : k.toUpperCase()}</small><b>${g ? (g.win ? 'W' : 'L') : '–'}</b></div>`; }).join('');
    paint(`${back('<span class="px17-kick">The season</span>')}
      <section class="px-panel px17-sb ${r.wins === 17 ? 'perfect' : ''}" id="s17Sb">
        <div class="px17-sb-top"><span id="s17Wk">Kickoff</span><button type="button" class="px17-skip" data-act="s17skip">Skip ›</button></div>
        <div class="px17-rec"><b id="s17W">0</b><i>-</i><b id="s17L">0</b></div>
        <div class="px17-game" id="s17G">&nbsp;</div>
        <div class="px17-banner" id="s17B"></div>
        <div class="px17-label">Regular season</div>
        <div class="px17-weeks">${reg.map((w) => `<div class="px17-wk ${w.win ? 'w' : 'l'}" title="Week ${w.week}: ${fmt(w.you)} to ${fmt(w.opp)}"><small>${w.week}</small><b>${w.win ? 'W' : 'L'}</b></div>`).join('')}</div>
        <div class="px17-label">Playoffs <span id="s17Seed"></span></div>
        <div class="px17-bracket">${bracket}</div>
      </section>
      <div class="px17-after" id="s17After">
        <div class="px17-stats wide"><div><small>Regular season</small><b>${rw}-${rl}</b></div><div><small>Seed</small><b>${r.playoff === 'missed' ? '--' : `#${r.seed}`}</b><em>${r.playoff === 'missed' ? `finished ${ord(r.seed)}` : 'made playoffs'}</em></div><div><small>Best week</small><b>${fmt(best.you, 0)}</b><em>${PO[best.stage] || `W${best.week}`}</em></div><div><small>${losses[0] ? 'Closest loss' : 'Season pts'}</small><b>${losses[0] ? fmt(losses[0].opp - losses[0].you, 1) : fmt(r.points, 0)}</b>${losses[0] ? `<em>${PO[losses[0].stage] || `W${losses[0].week}`}</em>` : ''}</div></div>
        <div class="px-panel"><p class="px17-kick">Your lineup</p>${lineupBar(run)}</div>
        <div class="px17-btns"><button type="button" class="px-go big" data-act="s17start" data-mode="decades">▶ Run it back</button><button type="button" class="px-go teal" data-act="s17share">Share my season</button><a class="px17-link" href="#/170">17-0 home</a></div>
      </div>`);
    S.s17.play = playSeason(run, reg, po);
  }
  async function playSeason(run, reg, po) {
    const r = run.result, me = run.id;
    const tiles = [...document.querySelectorAll('.px17-weeks .px17-wk')];
    const ptiles = Object.fromEntries([...document.querySelectorAll('.px17-bracket .px17-wk')].map((t) => [t.dataset.stage, t]));
    const W = $('#s17W'), L = $('#s17L'), wk = $('#s17Wk'), gm = $('#s17G'), bn = $('#s17B'), sb = $('#s17Sb'), after = $('#s17After'), seedEl = $('#s17Seed');
    const st = S.s17.st;
    let w = 0, l = 0, skip = false, snapped = false;
    S.s17.skip = () => { skip = true; };
    const alive = () => !skip && S.s17.run?.id === me && sb.isConnected;
    const banner = (cls, text) => { bn.className = `px17-banner ${cls}`; bn.textContent = text; };
    const showGame = (x) => {
      gm.innerHTML = `<span class="you">${fmt(x.you, 1)}</span><i>vs</i><span class="opp">${fmt(x.opp, 1)}</span>`;
      gm.classList.remove('hit'); void gm.offsetWidth; gm.classList.add('hit');
    };
    const lost = () => { sb.classList.remove('shake'); void sb.offsetWidth; sb.classList.add('shake'); st?.flash('217,85,90', 0.6); buzz(25); };
    const finish = () => {
      tiles.forEach((t) => t.classList.add('show')); Object.values(ptiles).forEach((t) => t.classList.add('show'));
      W.textContent = r.wins; L.textContent = r.losses;
      wk.textContent = 'Final';
      seedEl.textContent = r.playoff === 'missed' ? '· missed' : `· #${r.seed} seed`;
      gm.innerHTML = `<b class="px17-verdict ${verdictCls(r)}">${verdict(r)}</b>`;
      banner(r.wins === 17 ? 'hot' : r.champ ? 'hot' : r.playoff === 'missed' ? 'cold' : '', r.wins === 17 ? '14-0, then three playoff wins. 17-0.' : r.champ ? `Champions as the #${r.seed} seed` : r.playoff === 'missed' ? `Finished ${ord(r.seed)} of 12. Top 8 make it.` : (() => { const g = r.weeks[r.weeks.length - 1]; return `Lost ${fmt(g.you, 1)} to ${fmt(g.opp, 1)} in the ${PO[r.playoff].toLowerCase()}`; })());
      after.classList.add('show');
      $('.px17-skip')?.remove();
      if (r.champ) { sb.classList.add('champ'); st?.fireworks(r.wins === 17 ? 10 : 6); st?.cheer(1); buzz([30, 40, 30, 40, 80]); }
    };
    if (calm.matches) { finish(); return; }
    // the regular season, week by week
    for (let i = 0; i < reg.length; i++) {
      if (!alive()) break;
      const x = reg[i];
      wk.textContent = `Week ${x.week}`;
      showGame(x); tiles[i].classList.add('show');
      if (x.win) {
        W.textContent = ++w; st?.cheer(0.5 + Math.min(0.5, w / 30));
        if (!l && w >= 5) banner('hot', `Undefeated · ${w}-0`);
      } else {
        L.textContent = ++l; lost();
        if (!snapped) { snapped = true; banner('cold', w ? `Streak snapped in week ${x.week} at ${w}-0` : 'Lost the opener'); }
      }
      await sleep(270);
    }
    if (!alive()) { if (S.s17.run?.id === me && sb.isConnected) finish(); return; }
    // standings
    await sleep(300);
    wk.textContent = 'Standings';
    if (r.playoff === 'missed') { gm.innerHTML = `<span class="opp">${ord(r.seed)} of 12</span>`; await sleep(500); finish(); return; }
    seedEl.textContent = `· #${r.seed} seed`;
    gm.innerHTML = `<span class="you">#${r.seed} seed</span>`; gm.classList.remove('hit'); void gm.offsetWidth; gm.classList.add('hit');
    banner('hot', l ? `Playoffs! ${w}-${l} gets the #${r.seed} seed` : `14-0. Three wins from perfect.`);
    st?.cheer(0.8); buzz(20);
    await sleep(1300);
    // the playoffs: one game at a time, slower, and a loss ends it
    for (const x of po) {
      if (!alive()) break;
      sb.classList.add('playoff');
      wk.textContent = PO[x.stage] + (x.oppSeed ? ` · vs #${x.oppSeed}` : '');
      gm.innerHTML = '<span class="opp">Kickoff…</span>';
      await sleep(650);
      if (!alive()) break;
      showGame(x); ptiles[x.stage]?.classList.add('show');
      if (x.win) {
        W.textContent = ++w; st?.cheer(1); st?.flash('244,196,78', 0.35); buzz(18);
        banner('hot', x.stage === 'final' ? (l ? 'Champions!' : '17-0!') : l ? `Into the ${x.stage === 'qf' ? 'semis' : 'championship'}` : `Still perfect · ${w}-0`);
      } else {
        L.textContent = ++l; lost(); banner('cold', `Eliminated in the ${PO[x.stage].toLowerCase()}`);
      }
      await sleep(1100);
    }
    if (S.s17.run?.id === me && sb.isConnected) finish();
  }
  SL.acts.s17skip = () => { S.s17.skip?.(); };
  SL.acts.s17share = async () => {
    const run = S.s17.run, r = run.result;
    const sq = (ws) => ws.map((w) => (w.win ? '🟩' : '🟥')).join('');
    const reg = r.weeks.filter((w) => !PO[w.stage]), po = r.weeks.filter((w) => PO[w.stage]);
    const text = `Sideline 17-0\n${r.wins}-${r.losses}${r.champ ? ' 🏆' : ''} · ${verdict(r)}\n${sq(reg)}${po.length ? ` | ${sq(po)}` : ''}\n${run.picks.map((p) => `${LABEL[p.slot]} ${p.name} '${String(p.year).slice(2)}`).join(', ')}\n${location.href.split('#')[0]}#/170`;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it anywhere.'); } catch { prompt('Copy your season', text); }
  };

  SL.routes['170'] = (hash) => { const id = hash.split('/')[2]; if (id) showRun(decodeURIComponent(id)); else showHome(); };
})();
