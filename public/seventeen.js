/* sideline live: 17-0. Spin a team and a season (1970 to today), draft one player from that team
   that year, fill 8 spots, then watch your lineup play a 17-game season. Builds on window.SL. */
(() => {
  'use strict';
  const SL = window.SL;
  if (!SL) return;
  const { S, api, esc, fmt, toast, pageHead, skel, tlogo } = SL;
  const $ = (q, el = document) => el.querySelector(q);
  const view = $('#view');
  const calm = SL.calm;
  const SLOTS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'SF'];
  const LABEL = { QB: 'QB', RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', TE: 'TE', FLEX: 'FLEX', SF: 'SUPERFLEX' };
  const FITS = { QB: ['QB'], RB1: ['RB'], RB2: ['RB'], WR1: ['WR'], WR2: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], SF: ['QB', 'RB', 'WR', 'TE'] };
  const MODES = {
    daily: ['📅', 'Daily', 'Everyone gets the same 8 spins today. One run counts for the leaderboard.'],
    unlimited: ['♾️', 'Unlimited', 'Fresh spins every game. Play as many seasons as you want.'],
    franchise: ['🏟️', 'Franchise', 'One team, 8 different seasons from its history.'],
  };
  SL.navFor['170'] = 'arcade';
  S.s17 = { run: null };
  const num = (v) => Number(v || 0).toLocaleString();
  function statLine(p) {
    if (p.pos === 'QB') return [`${num(p.passYds)} pass yds`, `${p.passTd} TD`, `${p.int ?? 0} INT`, p.rushYds > 99 ? `${num(p.rushYds)} rush yds` : ''].filter(Boolean).join(' · ');
    if (p.pos === 'RB') return [`${num(p.rushYds)} rush yds`, `${p.rushTd + p.recTd} TD`, p.rec ? `${p.rec} rec, ${num(p.recYds)} yds` : ''].filter(Boolean).join(' · ');
    return [`${p.rec} rec`, `${num(p.recYds)} yds`, `${p.recTd} TD`].join(' · ');
  }
  const ini = (n) => String(n || '?').split(' ').map((w) => w[0]).join('').slice(0, 2);
  function confetti(el) {
    if (calm.matches || !el) return;
    const r = el.getBoundingClientRect(), box = document.createElement('div');
    box.className = 'confetti'; box.style.left = `${r.left + r.width / 2}px`; box.style.top = `${r.top + r.height / 2}px`;
    for (let i = 0; i < 40; i++) { const s = document.createElement('i'); const a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 160; s.style.setProperty('--x', `${Math.cos(a) * d}px`); s.style.setProperty('--y', `${Math.sin(a) * d - 50}px`); s.style.setProperty('--r', `${Math.random() * 720 - 360}deg`); s.style.background = ['var(--gold)', '#e3b341', '#5cc2bb', '#d9555a', '#9fbf8a'][i % 5]; box.appendChild(s); }
    document.body.appendChild(box); setTimeout(() => box.remove(), 1200);
  }

  // ---------- home ----------
  async function showHome() {
    view.innerHTML = `${pageHead('Arcade · 1970 to today', '17-0', 'Spin a team and a season. Draft one player.<br>Fill 8 spots. Can your lineup go 17-0?')}<div id="s17Body">${skel(3, 'cards')}</div>`;
    let t = null; try { t = await api('/api/170/today'); } catch { /* still playable */ }
    const el = $('#s17Body'); if (!el) return;
    const mine = t?.mine;
    el.innerHTML = `<div class="s17-modes">${Object.entries(MODES).map(([k, [e, title, line]]) => `<button type="button" class="s17-mode ${k}" data-act="s17start" data-mode="${k}"><span class="e">${e}</span><b>${title}${k === 'daily' && t ? ` #${t.number}` : ''}</b><span>${line}</span>${k === 'daily' && mine?.done ? `<em>Your run today: ${mine.wins}-${mine.losses}</em>` : k === 'daily' && mine ? '<em>Pick up where you left off</em>' : ''}</button>`).join('')}</div>
      ${t?.best ? `<div class="s17-best"><span>Your best <b>${t.best.wins}-${17 - t.best.wins}</b></span><span>Perfect seasons <b>${t.best.perfect}</b></span><span>Seasons played <b>${t.best.played}</b></span></div>` : ''}
      <section class="s17-sec"><div class="label">Today's leaderboard · Daily #${t?.number || ''}</div>
        ${t?.board?.length ? `<table class="box ranks"><tbody>${t.board.map((r) => `<tr><td style="width:40px">${r.rank}</td><td>${SL.nameTag ? SL.nameTag(r) : esc(r.name)}</td><td class="num pp">${r.wins}-${r.losses}</td><td class="num sub">${fmt(r.points, 0)} pts</td></tr>`).join('')}</tbody></table>` : '<p class="rules">No one has finished today\'s run yet. Be first.</p>'}</section>
      <section class="s17-sec s17-how"><div class="label">How it works</div><ol>
        <li>Each round spins a random <b>team and season</b>, anywhere from ${t?.years?.[0] || 1970} to ${t?.years?.[1] || 'today'}.</li>
        <li>Draft one player from that team that year into an open spot: QB, 2 RB, 2 WR, TE, FLEX or SuperFlex (any position).</li>
        <li>Don't like the spin? Each round you get <b>one re-spin</b>: a new team, or the same team in a different year.</li>
        <li>Your lineup plays 17 games. Players score their real season, <b>era-adjusted</b> so a 1977 season counts as much as one from today, and they miss the games they missed that year.</li>
        <li>Go 17-0 for the <b>Perfect 17-0</b> badge and a card pack.</li></ol></section>`;
  }
  SL.acts.s17start = async (t) => {
    t.disabled = true;
    try { const r = await api('/api/170/start', { method: 'POST', body: { mode: t.dataset.mode } }); S.s17.run = r.run; location.hash = `#/170/${r.run.id}`; }
    catch (e) { toast(e.message); t.disabled = false; }
  };

  // ---------- a run ----------
  async function showRun(id) {
    if (!S.s17.run || S.s17.run.id !== id) {
      view.innerHTML = `${pageHead('17-0', 'Loading…')}${skel(3, 'cards')}`;
      try { S.s17.run = (await api(`/api/170/run/${encodeURIComponent(id)}`)).run; } catch (e) { view.innerHTML = `<div class="empty"><b>${esc(e.message)}</b><a href="#/170">Start a new run</a></div>`; return; }
    }
    draw(true);
  }
  const openSlots = (run) => SLOTS.filter((s) => !run.picks.some((p) => p.slot === s));
  // where a player can go: his own position first, then FLEX, then SuperFlex
  function slotsFor(run, pos) {
    const open = openSlots(run);
    const own = open.filter((s) => s !== 'FLEX' && s !== 'SF' && FITS[s].includes(pos)).slice(0, 1);
    return [...own, ...(open.includes('FLEX') && FITS.FLEX.includes(pos) ? ['FLEX'] : []), ...(open.includes('SF') ? ['SF'] : [])];
  }
  function lineupBar(run) {
    return `<div class="s17-lineup">${SLOTS.map((s) => {
      const p = run.picks.find((x) => x.slot === s);
      return `<div class="s17-slot ${p ? 'full' : ''}"><small>${LABEL[s]}</small>${p ? `<b>${esc(p.name)}</b><span>${p.year} ${tlogo(p.team)} ${fmt(p.adj)}/g</span>` : '<b class="s17-open">open</b>'}</div>`;
    }).join('')}</div>`;
  }
  function draw(animate) {
    const run = S.s17.run;
    if (run.done) return drawSeason(run);
    const sp = run.spin, ro = sp.roster;
    const modeTag = run.mode === 'daily' ? `Daily #${run.number}${run.counted === false && !run.mine ? '' : ''}` : run.mode === 'franchise' ? 'Franchise' : 'Unlimited';
    view.innerHTML = `<div class="s17-top"><a class="s17-back" href="#/170">‹ 17-0</a><span class="label">${esc(modeTag)} · Round ${run.round + 1} of 8</span></div>
      ${lineupBar(run)}
      <section class="s17-spin" style="--tc:${esc(SL.teamInfo(sp.team).color || '#33415a')}">
        <div class="s17-wheel" id="s17Wheel">${tlogo(sp.team)}<div><div class="s17-year">${sp.year}</div><div class="s17-team">${esc(sp.name)}</div></div></div>
        <div class="s17-re">${run.mode !== 'franchise' ? `<button type="button" class="pill" data-act="s17re" data-k="team" ${sp.canTeam ? '' : 'disabled'}>🔄 New team</button>` : ''}<button type="button" class="pill" data-act="s17re" data-k="year" ${sp.canYear ? '' : 'disabled'}>🔄 New year</button><small>${sp.canTeam || sp.canYear ? 'One re-spin this round' : 'Re-spin used'}</small></div>
      </section>
      <div class="s17-roster">${ro.players.map((p) => {
        const taken = run.picks.some((x) => x.name === p.name);
        const where = taken ? [] : slotsFor(run, p.pos);
        return `<div class="s17-p ${where.length ? '' : 'no'}"><span class="s17-ini">${esc(ini(p.name))}</span>
          <div class="s17-pi"><b>${esc(p.name)}</b><small>${p.pos} · ${p.g} of ${ro.games} games · ${esc(statLine(p))}</small></div>
          <div class="s17-pts"><b>${fmt(p.adj)}</b><small>adj/g</small></div>
          <div class="s17-go">${taken ? '<small>On your team</small>' : where.length ? where.map((s, i) => `<button type="button" class="btn ${i ? 'ghost' : ''} sm" data-act="s17pick" data-id="${esc(p.id)}" data-slot="${s}">${i ? LABEL[s] : `Draft · ${LABEL[s]}`}</button>`).join('') : '<small>No open spot</small>'}</div></div>`;
      }).join('')}</div>
      <p class="rules s17-note">“adj/g” is era-adjusted points per game in PPR: his points per game that season, against the average starter at his position that year, put on today's scale. ${esc(String(ro.year))} had ${ro.games} games, and missed games count against you.</p>`;
    if (animate && !calm.matches) spinAnim(sp);
  }
  function spinAnim(sp) {
    const w = $('#s17Wheel'); if (!w) return;
    const y = w.querySelector('.s17-year'), tm = w.querySelector('.s17-team');
    const names = ['Dallas Cowboys', 'Miami Dolphins', 'Green Bay Packers', 'Pittsburgh Steelers', 'San Francisco 49ers', 'Kansas City Chiefs', 'Buffalo Bills', 'Detroit Lions', 'Denver Broncos', 'New York Giants'];
    w.classList.add('rolling');
    let i = 0;
    const t = setInterval(() => { y.textContent = 1970 + Math.floor(Math.random() * 56); tm.textContent = names[i++ % names.length]; }, 55);
    setTimeout(() => { clearInterval(t); y.textContent = sp.year; tm.textContent = sp.name; w.classList.remove('rolling'); w.classList.add('landed'); }, 750);
  }
  SL.acts.s17re = async (t) => {
    try { S.s17.run = (await api('/api/170/respin', { method: 'POST', body: { runId: S.s17.run.id, kind: t.dataset.k } })).run; draw(true); }
    catch (e) { toast(e.message); }
  };
  SL.acts.s17pick = async (t) => {
    document.querySelectorAll('[data-act="s17pick"]').forEach((b) => { b.disabled = true; });
    try {
      S.s17.run = (await api('/api/170/pick', { method: 'POST', body: { runId: S.s17.run.id, playerId: t.dataset.id, slot: t.dataset.slot } })).run;
      try { navigator.vibrate?.(15); } catch { /* not supported */ }
      draw(true); window.scrollTo({ top: 0, behavior: calm.matches ? 'auto' : 'smooth' });
    } catch (e) { toast(e.message); draw(false); }
  };

  // ---------- the season ----------
  function drawSeason(run) {
    const r = run.result;
    const perfect = r.wins === 17;
    const best = r.weeks.reduce((a, w) => (w.you > a.you ? w : a), r.weeks[0]);
    const losses = r.weeks.filter((w) => !w.win).sort((a, b) => (b.you - b.opp) - (a.you - a.opp));
    view.innerHTML = `<div class="s17-top"><a class="s17-back" href="#/170">‹ 17-0</a><span class="label">${run.mode === 'daily' ? `Daily #${run.number}` : run.mode === 'franchise' ? 'Franchise' : 'Unlimited'} · The season</span></div>
      <section class="s17-res ${perfect ? 'perfect' : ''}"><div class="s17-rec"><b id="s17W">0</b><i>-</i><b id="s17L">0</b></div><div class="s17-verdict" id="s17V">&nbsp;</div>
        <div class="s17-weeks">${r.weeks.map((w) => `<div class="s17-wk ${w.win ? 'w' : 'l'}" title="Week ${w.week}: ${fmt(w.you)} to ${fmt(w.opp)}${w.out.length ? ` · out: ${esc(w.out.join(', '))}` : ''}"><small>W${w.week}</small><b>${w.win ? 'W' : 'L'}</b><span>${fmt(w.you, 0)}-${fmt(w.opp, 0)}</span></div>`).join('')}</div></section>
      <div class="s17-facts"><span>Season points <b>${fmt(r.points, 0)}</b></span><span>Best week <b>${fmt(best.you)}</b> (W${best.week})</span>${losses[0] ? `<span>Closest loss <b>${fmt(losses[0].opp - losses[0].you)}</b> (W${losses[0].week}${losses[0].out.length ? `, ${esc(losses[0].out.slice(0, 2).join(' & '))} out` : ''})</span>` : ''}</div>
      ${lineupBar(run)}
      <div class="share-btns"><button class="btn" data-act="s17share">Share my season</button><button class="btn ghost" data-act="s17start" data-mode="${run.mode === 'daily' ? 'unlimited' : run.mode}">Play again</button><a class="btn ghost" href="#/170">17-0 home</a></div>
      ${run.mode === 'daily' && run.mine && !run.counted ? '<p class="rules">You already had a run count today, so this one was for fun.</p>' : ''}`;
    // weeks flip over one by one
    const tiles = [...document.querySelectorAll('.s17-wk')];
    let w = 0, l = 0;
    const done = () => { $('#s17V').innerHTML = perfect ? '🏆 PERFECT SEASON' : r.wins >= 14 ? '🔥 Contender' : r.wins >= 10 ? 'Playoff team' : r.wins >= 7 ? 'Bubble team' : '💀 Rebuilding year'; if (perfect) confetti($('.s17-rec')); };
    if (calm.matches) { tiles.forEach((t) => t.classList.add('show')); $('#s17W').textContent = r.wins; $('#s17L').textContent = r.losses; done(); return; }
    tiles.forEach((t, i) => setTimeout(() => {
      t.classList.add('show');
      if (r.weeks[i].win) $('#s17W').textContent = ++w; else $('#s17L').textContent = ++l;
      if (i === tiles.length - 1) done();
    }, 250 + i * 170));
  }
  SL.acts.s17share = async () => {
    const run = S.s17.run, r = run.result;
    const tag = run.mode === 'daily' ? `Daily #${run.number}` : run.mode === 'franchise' ? 'Franchise' : 'Unlimited';
    const text = `Sideline 17-0 · ${tag}\n${r.wins}-${r.losses}${r.wins === 17 ? ' 🏆' : ''}\n${r.weeks.map((w) => (w.win ? '🟩' : '🟥')).join('')}\n${run.picks.map((p) => `${LABEL[p.slot]} ${p.name} '${String(p.year).slice(2)}`).join(', ')}\n${location.href.split('#')[0]}#/170`;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it anywhere.'); } catch { prompt('Copy your season', text); }
  };

  SL.routes['170'] = (hash) => { const id = hash.split('/')[2]; if (id) showRun(decodeURIComponent(id)); else showHome(); };
})();
