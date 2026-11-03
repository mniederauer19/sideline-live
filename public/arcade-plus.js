/* sideline live: player props, moment cards, red zone alerts and the Locker (levels + unlockables).
   Builds on window.SL from app.js and arcade.js. Free to play: credits only. */
(() => {
  'use strict';
  const SL = window.SL;
  if (!SL) return;
  const { S, api, esc, fmt, toast, openSheet, closeSheet, requireUser, face, pageHead, skel, refreshAnim, avatarHtml } = SL;
  const $ = (q, el = document) => el.querySelector(q);
  const view = $('#view');
  const ls = SL.ls;
  const buzz = (p) => { try { if (!document.hidden) navigator.vibrate?.(p); } catch { /* not supported */ } };
  const linkTo = (hash) => `${location.href.split('#')[0]}${hash}`;
  async function shareLink(url, text) {
    if (navigator.share) { try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Link copied. Send it to a friend.'); } catch { prompt('Copy this link', url); }
  }
  const signedPts = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`;

  // ================= PLAYER PROPS =================
  S.props = { data: null, slip: new Map() };
  const SIDE = { more: 'More', less: 'Less' };
  async function showProps() {
    view.innerHTML = `${pageHead(SL.weekLabel(), 'Player props', 'Pick 2 to 5: More or Less<br>All of them hit and you win credits')}
      <div class="pp-pay" id="ppPay"></div><div id="ppSlips"></div><div id="ppBoard">${skel(5, 'rows')}</div><div class="pp-slip" id="ppSlip" hidden></div>`;
    await loadProps();
  }
  async function loadProps() {
    try { S.props.data = await api('/api/props'); } catch (e) { $('#ppBoard').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    drawProps();
  }
  function drawProps() {
    const d = S.props.data; if (!d || !$('#ppBoard')) return;
    $('#ppPay').innerHTML = `${Object.entries(d.payouts).map(([n, c]) => `<span><b>${n}</b> picks <em>+${c}</em></span>`).join('')}<small>Free · lines from sidelineff.com's weekly projections · ${d.slipsLeft} slip${d.slipsLeft === 1 ? '' : 's'} left this week</small>`;
    $('#ppSlips').innerHTML = d.slips.length ? `<div class="label">Your slips</div>${d.slips.map(slipCard).join('')}` : '';
    const open = d.players.filter((p) => !p.locked);
    if (!open.length) {
      $('#ppBoard').innerHTML = `<div class="empty"><b>${d.players.length ? 'Every game on the board has started' : 'Props aren\'t posted yet'}</b>${d.players.length ? 'New lines go up when next week\'s projections land.' : 'They go up as soon as this week\'s projections are out on sidelineff.com.'}</div>`;
      drawSlip(); return;
    }
    const games = new Map();
    for (const p of open) { const k = p.gameId || p.team; if (!games.has(k)) games.set(k, []); games.get(k).push(p); }
    $('#ppBoard').innerHTML = [...games.values()].map((list) => {
      const p0 = list[0];
      const g = S.gamesById.get(p0.gameId);
      const title = g ? `${g.away.abbr} @ ${g.home.abbr}` : `${p0.team} ${p0.home ? 'vs' : '@'} ${p0.opp}`;
      return `<section class="pp-game"><div class="pp-gh"><b>${esc(title)}</b><span>${p0.kickoff ? esc(SL.kick(p0.kickoff)) : ''}</span></div>${list.map(propRow).join('')}</section>`;
    }).join('');
    drawSlip();
  }
  function propRow(p) {
    const pick = S.props.slip.get(p.id);
    const sp = S.props.data.splits || {};
    const chips = Object.entries(p.lines).map(([stat, line]) => {
      const s = sp[`${p.id}:${stat}`], tot = s ? s.more + s.less : 0;
      const on = (side) => (pick?.stat === stat && pick.side === side ? 'on' : '');
      return `<div class="pp-chip"><span class="pp-l"><b>${fmt(line)}</b>${esc(S.props.data.labels[stat])}${tot ? `<small>${Math.round(s.more / tot * 100)}% more</small>` : ''}</span>
        <button type="button" class="pp-b pp-more ${on('more')}" data-act="pp" data-pid="${esc(p.id)}" data-stat="${stat}" data-side="more">↑ More</button>
        <button type="button" class="pp-b pp-less ${on('less')}" data-act="pp" data-pid="${esc(p.id)}" data-stat="${stat}" data-side="less">↓ Less</button></div>`;
    }).join('');
    return `<div class="pp-row ${pick ? 'picked' : ''}" data-pp="${esc(p.id)}">${face(p, 'face sm')}<div class="pp-who"><button class="plink" data-act="player" data-pid="${esc(p.id)}">${esc(p.name)}</button><small>${esc(p.pos)}${p.rank ? `${p.rank}` : ''} · ${esc(p.team)} ${p.home ? 'vs' : '@'} ${esc(p.opp)}</small></div><div class="pp-chips">${chips}</div></div>`;
  }
  function drawSlip() {
    const el = $('#ppSlip'); if (!el) return;
    const legs = [...S.props.slip.entries()];
    el.hidden = !legs.length;
    if (!legs.length) return;
    const byId = new Map(S.props.data.players.map((p) => [p.id, p]));
    const pay = S.props.data.payouts[legs.length];
    el.innerHTML = `<div class="ps-legs">${legs.map(([pid, l]) => { const p = byId.get(pid); return `<span class="ps-leg">${esc(p?.name.split(' ').slice(-1)[0] || '')} <b>${l.side === 'more' ? '↑' : '↓'} ${fmt(p?.lines[l.stat] ?? 0)}</b> ${esc(S.props.data.labels[l.stat])}<button type="button" data-act="pp-x" data-pid="${esc(pid)}" aria-label="Remove">✕</button></span>`; }).join('')}</div>
      <div class="ps-go"><span>${legs.length} pick${legs.length > 1 ? 's' : ''}${pay ? ` · win <b>+${pay}</b>` : ' · add at least 2'}</span><button class="btn" data-act="pp-submit" ${legs.length >= 2 && legs.length <= 5 ? '' : 'disabled'}>Lock it in</button></div>`;
  }
  function slipCard(s) {
    const st = s.result === 'win' ? `<b class="ok">Won +${s.delta}</b>` : s.result === 'loss' ? '<b class="no">Lost</b>' : s.result === 'void' ? '<b>Void</b>' : `<b>${s.legs.some((l) => l.state === 'in') ? '<span class="live">Live</span>' : 'Locked in'} · for +${s.payout}</b>`;
    return `<div class="ps-card ${s.result || 'open'}"><div class="ps-top"><span class="label">${s.legs.length}-pick slip</span>${st}</div>${s.legs.map((l) => {
      const pct = l.now != null ? Math.min(100, (l.now / (l.line * 1.6)) * 100) : 0;
      const mark = l.result === 'hit' ? '✅' : l.result === 'miss' ? '❌' : l.result === 'void' ? '➖' : l.trend === 'up' ? '🟢' : l.trend === 'down' ? '🟠' : '⏳';
      return `<div class="ps-l"><span class="ps-m">${mark}</span><span class="ps-n">${esc(l.name)}<small>${l.side === 'more' ? 'More' : 'Less'} than ${fmt(l.line)} ${esc(l.label)}</small></span><span class="ps-v">${l.now != null ? fmt(l.now) : '–'}<i class="ps-bar"><i style="width:${pct}%"></i><em style="left:${100 / 1.6}%"></em></i></span></div>`;
    }).join('')}</div>`;
  }
  SL.acts.pp = (t) => {
    const { pid, stat, side } = t.dataset;
    const cur = S.props.slip.get(pid);
    if (cur && cur.stat === stat && cur.side === side) S.props.slip.delete(pid);
    else {
      if (!cur && S.props.slip.size >= 5) return toast('5 picks max on one slip.');
      S.props.slip.set(pid, { stat, side });
    }
    buzz(8);
    const p = S.props.data.players.find((x) => x.id === pid);
    const row = document.querySelector(`[data-pp="${CSS.escape(pid)}"]`);
    if (row && p) row.outerHTML = propRow(p);
    drawSlip();
  };
  SL.acts['pp-x'] = (t) => { S.props.slip.delete(t.dataset.pid); drawProps(); };
  SL.acts['pp-submit'] = async () => {
    if (!requireUser()) return;
    const legs = [...S.props.slip.entries()].map(([pid, l]) => ({ pid, ...l }));
    try {
      await api('/api/props', { method: 'POST', body: { legs } });
      S.props.slip.clear();
      toast('Slip locked in. Watch it live right here.');
      buzz([30, 30, 60]);
      await loadProps();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { toast(e.message); }
  };

  // ================= MOMENT CARDS =================
  const RARITY = { legendary: 'Legendary', epic: 'Epic', rare: 'Rare', common: 'Common' };
  function momentCard(c, { big = false, act = 'card' } = {}) {
    return `<button type="button" class="mc mc-${c.rarity} ${big ? 'big' : ''}" data-act="${act}" data-id="${c.id}" aria-label="${esc(c.name)}, ${RARITY[c.rarity]}">
      <span class="mc-in"><span class="mc-top"><span class="mc-r">${RARITY[c.rarity]}</span><span>W${c.week}</span></span>
        <span class="mc-face">${face({ id: c.pid, name: c.name, headshot: c.headshot, pos: c.pos, team: c.team })}</span>
        <span class="mc-name">${esc(c.name)}</span><span class="mc-sub">${esc(c.pos)} · ${esc(c.team)}</span>
        <span class="mc-hl">${esc(c.headline)}</span>
        <span class="mc-pts">${signedPts(c.pts)}<small>PPR</small></span>
        <span class="mc-foot"><span>${esc(c.matchup)} · Q${c.q} ${esc(c.clock || '')}</span><span>#${c.serial}/${c.of}</span></span></span></button>`;
  }
  S.cards = { filter: 'all', data: null };
  async function showCards() {
    view.innerHTML = `${pageHead('Collect the week\'s biggest plays', 'Moment cards', 'Earn packs in the Arcade<br>Swap with friends')}<div id="mcBody">${skel(3, 'cards')}</div>`;
    if (!S.me) { $('#mcBody').innerHTML = '<div class="empty"><b>Sign in to collect</b>Your first pack is free. <a href="#" data-act="join">Sign in</a></div>'; return; }
    await loadCards();
  }
  async function loadCards() {
    try { S.cards.data = await api('/api/cards'); } catch (e) { $('#mcBody').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    drawCards();
  }
  function drawCards() {
    const d = S.cards.data, el = $('#mcBody'); if (!d || !el) return;
    const counts = { legendary: 0, epic: 0, rare: 0, common: 0 };
    for (const c of d.cards) counts[c.rarity]++;
    const list = d.cards.filter((c) => S.cards.filter === 'all' || c.rarity === S.cards.filter);
    const offers = d.trades.filter((t) => t.me === 'from' && t.status === 'offered');
    const mine = d.trades.filter((t) => t.me === 'from' && t.status === 'open');
    const sent = d.trades.filter((t) => t.me === 'to');
    el.innerHTML = `<div class="mc-packs ${d.packs ? 'has' : ''}"><div class="mc-pack" aria-hidden="true"><span>🃏</span>${d.packs ? `<b>${d.packs}</b>` : ''}</div>
        <div><h2>${d.packs ? `${d.packs} pack${d.packs > 1 ? 's' : ''} to open` : 'No packs right now'}</h2><p>Earn a pack for every 3 right calls in Call It, solving the Daily, winning a duel or a props slip, a take that hits, and 3 for finishing the week's challenges.</p></div>
        ${d.packs ? '<button class="btn" data-act="mc-open">Open a pack</button>' : '<a class="btn ghost" href="#/arcade">Go earn one</a>'}</div>
      ${offers.length ? `<section class="mc-trades"><div class="label">Swap offers for you</div>${offers.map((t) => `<div class="mc-tr">${momentCard(t.card, { act: 'noop' })}<span class="mc-swap">⇄</span>${momentCard(t.offer, { act: 'noop' })}<div class="mc-tr-b"><p>${SL.nameTag(t.to)} wants to swap.</p><button class="btn" data-act="tr-ans" data-code="${esc(t.code)}" data-a="accept">Accept swap</button><button class="btn ghost" data-act="tr-ans" data-code="${esc(t.code)}" data-a="decline">No thanks</button></div></div>`).join('')}</section>` : ''}
      ${mine.length || sent.length ? `<section class="mc-trades"><div class="label">Swaps waiting</div>${mine.map((t) => `<div class="mc-wait">Your <b>${esc(t.card.name)}</b> (${RARITY[t.card.rarity]}) is up for a swap. <button class="linkish" data-act="tr-link" data-code="${esc(t.code)}">Send the link</button> · <button class="linkish" data-act="tr-ans" data-code="${esc(t.code)}" data-a="cancel">cancel</button></div>`).join('')}${sent.map((t) => `<div class="mc-wait">You offered <b>${esc(t.offer?.name || '')}</b> for ${SL.nameTag(t.from)}'s <b>${esc(t.card?.name || '')}</b>. Waiting on them.</div>`).join('')}</section>` : ''}
      <div class="pills mc-f">${[['all', `All ${d.cards.length}`], ...Object.entries(RARITY).map(([k, l]) => [k, `${l} ${counts[k]}`])].map(([k, l]) => `<button class="pill ${S.cards.filter === k ? 'on' : ''}" data-act="mc-f" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="mc-grid">${list.map((c) => momentCard(c)).join('') || '<div class="empty"><b>No cards yet</b>Open your free pack to start your collection.</div>'}</div>`;
    refreshAnim($('.mc-grid'));
  }
  SL.acts['mc-f'] = (t) => { S.cards.filter = t.dataset.f; drawCards(); };
  SL.acts.noop = () => {};
  SL.acts['mc-open'] = async () => {
    let r;
    try { r = await api('/api/cards/open', { method: 'POST' }); } catch (e) { return toast(e.message); }
    openSheet('Pack opened', `<div class="mc-reveal">${r.cards.map((c, i) => `<div class="mc-flip" style="--d:${i * 0.55 + 0.3}s">${momentCard(c, { act: 'noop' })}<span class="mc-back" aria-hidden="true">🃏</span></div>`).join('')}</div>
      <div class="share-btns" style="justify-content:center"><button class="btn" data-close>Add to collection</button></div>`);
    const best = r.cards.find((c) => c.rarity === 'legendary') || r.cards.find((c) => c.rarity === 'epic');
    setTimeout(() => { buzz(best ? [60, 40, 160] : 30); if (best) toast(`${RARITY[best.rarity]} pull: ${best.name}! 🔥`); }, 2100);
    loadCards();
  };
  SL.acts.card = (t) => {
    const c = S.cards.data?.cards.find((x) => x.id === Number(t.dataset.id)); if (!c) return;
    openSheet(RARITY[c.rarity], `<div class="mc-one">${momentCard(c, { big: true, act: 'noop' })}</div>
      <div class="share-btns" style="justify-content:center"><button class="btn" data-act="mc-trade" data-id="${c.id}">Offer a swap</button><button class="btn ghost" data-act="comments" data-id="${esc(c.playId)}">See the play</button><button class="btn ghost" data-act="share" data-id="${esc(c.playId)}">Share the play</button></div>
      <p class="rules" style="text-align:center">Card #${c.serial} of ${c.of} pulled for this play.</p>`);
  };
  SL.acts['mc-trade'] = async (t) => {
    try {
      const r = await api(`/api/cards/${t.dataset.id}/trade`, { method: 'POST' });
      closeSheet();
      await shareLink(linkTo(`#/trade/${r.trade.code}`), `Swap me for my ${RARITY[r.trade.card.rarity]} ${r.trade.card.name} card on Sideline Live 🃏`);
      loadCards();
    } catch (e) { toast(e.message); }
  };
  SL.acts['tr-link'] = (t) => shareLink(linkTo(`#/trade/${t.dataset.code}`), 'Swap cards with me on Sideline Live 🃏');
  SL.acts['tr-ans'] = async (t) => {
    try {
      const r = await api(`/api/trades/${encodeURIComponent(t.dataset.code)}/${t.dataset.a}`, { method: 'POST' });
      toast(t.dataset.a === 'accept' ? `Swapped! ${r.trade.offer?.name || 'The card'} is yours.` : t.dataset.a === 'cancel' ? 'Swap cancelled.' : 'Declined. Your card is still up for a swap.');
      if (SL.currentRoute() === 'trade') showTrade(location.hash); else loadCards();
    } catch (e) { toast(e.message); }
  };
  async function showTrade(hash) {
    const codeId = decodeURIComponent(hash.split('/')[2] || '');
    view.innerHTML = `${pageHead('Card swap', 'Swap?')}<div id="trBody">${skel(2, 'cards')}</div>`;
    let r;
    try { r = await api(`/api/trades/${encodeURIComponent(codeId)}`); } catch (e) { $('#trBody').innerHTML = `<div class="empty"><b>${esc(e.message)}</b><a href="#/cards">Your cards</a></div>`; return; }
    const t = r.trade, el = $('#trBody');
    const head = `<div class="tr-head">${t.card ? momentCard(t.card, { big: true, act: 'noop' }) : ''}<div><p>${SL.nameTag(t.from)} is offering this ${t.card ? `<b>${RARITY[t.card.rarity]}</b>` : ''} card.</p>${t.status === 'done' ? '<p class="ok">This swap is done.</p>' : t.status === 'cancelled' ? '<p>This swap was cancelled.</p>' : ''}</div></div>`;
    if (t.me === 'from') {
      el.innerHTML = `${head}${t.status === 'offered' ? `<div class="mc-tr">${momentCard(t.offer, { act: 'noop' })}<div class="mc-tr-b"><p>${SL.nameTag(t.to)} offered this.</p><button class="btn" data-act="tr-ans" data-code="${esc(t.code)}" data-a="accept">Accept swap</button><button class="btn ghost" data-act="tr-ans" data-code="${esc(t.code)}" data-a="decline">No thanks</button></div></div>` : t.status === 'open' ? `<div class="share-btns"><button class="btn" data-act="tr-link" data-code="${esc(t.code)}">Send the link</button><button class="btn ghost" data-act="tr-ans" data-code="${esc(t.code)}" data-a="cancel">Cancel swap</button></div>` : ''}`;
      return;
    }
    if (t.status !== 'open') { el.innerHTML = `${head}${t.status === 'offered' && t.me === 'to' ? '<p class="rules">You made an offer. Waiting on them.</p>' : t.status === 'offered' ? '<p class="rules">Someone already made an offer.</p>' : ''}`; return; }
    if (!S.me) { el.innerHTML = `${head}<div class="empty"><b>Sign in to swap</b><a href="#" data-act="join">Sign in</a></div>`; return; }
    const mine = await api('/api/cards');
    S.cards.data = mine;
    const busy = new Set(mine.trades.flatMap((x) => [x.card?.id, x.offer?.id]));
    const options = mine.cards.filter((c) => !busy.has(c.id));
    el.innerHTML = `${head}<div class="label" style="margin:18px 0 8px">Pick one of yours to offer</div><div class="mc-grid">${options.map((c) => momentCard(c, { act: 'tr-offer' })).join('') || '<div class="empty"><b>No cards to offer</b>Open your free pack first. <a href="#/cards">Your cards</a></div>'}</div>`;
    S.tradeCode = t.code;
  }
  SL.acts['tr-offer'] = async (t) => {
    const c = S.cards.data?.cards.find((x) => x.id === Number(t.dataset.id)); if (!c) return;
    if (!confirm(`Offer your ${RARITY[c.rarity]} ${c.name} card for this one?`)) return;
    try { await api(`/api/trades/${encodeURIComponent(S.tradeCode)}/offer`, { method: 'POST', body: { cardId: c.id } }); toast('Offer sent. They get to say yes or no.'); showTrade(`#/trade/${S.tradeCode}`); }
    catch (e) { toast(e.message); }
  };

  // ================= RED ZONE =================
  const rzPref = () => ls.get('sl-rz') || 'mine';
  function myOnOffense(abbr) {
    const rows = S.lg?.plRows || [];
    const out = [];
    for (const id of S.myFantasyIds) { const r = rows.find((x) => String(x.id) === id); if (r && r.team === abbr) out.push(r.name); }
    return out;
  }
  function showRedZone(a) {
    const pref = rzPref();
    if (pref === 'off') return;
    const mine = myOnOffense(a.offense);
    if (pref === 'mine' && S.myFantasyIds.size && !mine.length) return;
    let el = $('#rzBanner');
    if (!el) { el = document.createElement('div'); el.id = 'rzBanner'; el.className = 'rz-banner'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `<span class="rz-dot"></span><span class="rz-t"><b>${a.goal ? 'GOAL TO GO' : 'RED ZONE'}</b> ${esc(a.offense)}${a.text ? ` · ${esc(a.text)}` : ''}${mine.length ? `<small>${esc(mine.slice(0, 3).join(', '))} in range</small>` : `<small>${esc(a.score || '')}</small>`}</span>
      <a class="btn" href="#/game/${esc(a.gameId)}">Watch</a><button type="button" class="icon-btn" data-act="rz-x" aria-label="Dismiss">✕</button>`;
    el.classList.remove('out'); el.hidden = false;
    if (mine.length) buzz([50, 40, 50]);
    clearTimeout(el._t); el._t = setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.hidden = true; }, 300); }, 30000);
    // Red zone mode: jump straight to the game
    if (ls.get('sl-rz-jump') === '1' && ['feed', 'game', ''].includes(SL.currentRoute()) && location.hash !== `#/game/${a.gameId}`) location.hash = `#/game/${a.gameId}`;
  }
  SL.acts['rz-x'] = () => { const el = $('#rzBanner'); if (el) el.hidden = true; };
  SL.acts['rz-settings'] = () => {
    const pref = rzPref();
    const opt = (v, l, s) => `<button type="button" class="rz-opt ${pref === v ? 'on' : ''}" data-act="rz-set" data-v="${v}"><b>${l}</b><small>${s}</small></button>`;
    openSheet('Red zone alerts', `<p class="intro">A heads-up the second a game reaches the red zone, so you never miss the touchdown.</p>
      <div class="rz-opts">${opt('mine', 'My players', 'Only when someone on your synced teams is on offense')}${opt('all', 'Every game', 'Any team, any game')}${opt('off', 'Off', 'No red zone alerts')}</div>
      <label class="rz-jump"><input type="checkbox" id="rzJump" ${ls.get('sl-rz-jump') === '1' ? 'checked' : ''}> <span><b>Red zone mode</b><small>While you're on Plays or a game, jump straight to the game in the red zone.</small></span></label>
      <p class="rules">With score alerts on (My teams), red zone alerts reach your phone too, even when the app is closed.</p>`);
    $('#rzJump').onchange = (e) => { ls.set('sl-rz-jump', e.target.checked ? '1' : null); toast(e.target.checked ? 'Red zone mode on.' : 'Red zone mode off.'); };
  };
  SL.acts['rz-set'] = (t) => {
    ls.set('sl-rz', t.dataset.v);
    document.querySelectorAll('.rz-opt').forEach((b) => b.classList.toggle('on', b === t));
    SL.pushRefresh?.();
    toast(t.dataset.v === 'off' ? 'Red zone alerts off.' : t.dataset.v === 'all' ? 'You\'ll hear about every red zone trip.' : 'You\'ll hear when your players are in the red zone.');
  };
  SL.hooks.lgTools = () => `<button class="pill" data-act="rz-settings">🔴 Red zone: ${({ mine: 'my players', all: 'all games', off: 'off' })[rzPref()]}</button>`;

  // ================= LOCKER =================
  const TEAM_COLORS = { ARI: ['#e0475f', '#97233F'], ATL: ['#e8414f', '#A71930'], BAL: ['#9b7ff0', '#241773'], BUF: ['#4f8fff', '#00338D'], CAR: ['#3fb3ef', '#0085CA'], CHI: ['#f26a2e', '#0B162A'],
    CIN: ['#fb6a1e', '#c4410a'], CLE: ['#ff6a2b', '#311D00'], DAL: ['#8fb3e8', '#003594'], DEN: ['#fb6a1e', '#c4410a'], DET: ['#3ea1e4', '#0076B6'], GB: ['#ffcb2f', '#203731'],
    HOU: ['#e8475a', '#03202F'], IND: ['#4f8fe8', '#002C5F'], JAX: ['#2bb3c0', '#006778'], KC: ['#ff4057', '#E31837'], LV: ['#c4c8cc', '#222222'], LAC: ['#3fb4f2', '#0080C6'],
    LAR: ['#ffd13f', '#003594'], MIA: ['#2ec4c6', '#008E97'], MIN: ['#a07ae8', '#4F2683'], NE: ['#e8475a', '#002244'], NO: ['#d3bc8d', '#8a7650'], NYG: ['#4f7fe8', '#0B2265'],
    NYJ: ['#3fbf7f', '#125740'], PHI: ['#2fa6ad', '#004C54'], PIT: ['#ffc72c', '#8a6a00'], SF: ['#e8584a', '#AA0000'], SEA: ['#69be28', '#002244'], TB: ['#ff5a4f', '#D50A0A'],
    TEN: ['#5fb4f2', '#0C2340'], WSH: ['#ffb612', '#5A1414'] };
  const THEMES = { volt: ['#c6f432', '#5f7a10'], pink: ['#ff4fa3', '#b0246a'], holo: ['#a58bff', '#5a40c0'], champ: ['#ffd54a', '#8a6a00'] };
  S.locker = (() => { try { return JSON.parse(ls.get('sl-locker') || 'null'); } catch { return null; } })();
  function applyTheme() {
    const eq = S.locker?.equipped;
    const html = document.documentElement;
    const pair = !eq || eq.theme === 'default' ? null : eq.theme === 'team' ? TEAM_COLORS[eq.team] : THEMES[eq.theme];
    if (!pair) return;
    html.style.setProperty('--accent-d', pair[0]); html.style.setProperty('--accent-l', pair[1]);
  }
  SL.hooks.theme = applyTheme;
  applyTheme();
  async function loadLocker() {
    if (!S.me) return null;
    try { S.locker = await api('/api/locker'); ls.set('sl-locker', JSON.stringify({ equipped: S.locker.equipped, level: S.locker.level })); applyTheme(); } catch { /* ignore */ }
    return S.locker;
  }
  // frames drawn around share images
  SL.hooks.frameCard = (ctx, W, H) => {
    const f = S.locker?.equipped?.frame;
    if (!f || f === 'classic') return;
    ctx.save();
    const inset = 26, r = 46;
    const path = () => { ctx.beginPath(); ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, r); };
    if (f === 'neon') { ctx.shadowColor = '#4ff0ff'; ctx.shadowBlur = 40; ctx.strokeStyle = '#7ff6ff'; ctx.lineWidth = 10; path(); ctx.stroke(); ctx.shadowColor = '#ff4fa3'; ctx.strokeStyle = 'rgba(255,79,163,0.8)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(inset + 18, inset + 18, W - inset * 2 - 36, H - inset * 2 - 36, r - 10); ctx.stroke(); }
    else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      const stops = f === 'gold' ? ['#fff3b0', '#c9962e', '#ffe08a', '#8a6214', '#fff3b0'] : f === 'holo' ? ['#ff6ad5', '#c774e8', '#ad8cff', '#8795e8', '#94d0ff', '#7ef9c2', '#ff6ad5'] : ['#ffb300', '#ff3d00', '#ff7a00', '#d50000', '#ffb300'];
      stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
      ctx.strokeStyle = g; ctx.lineWidth = f === 'gold' ? 24 : 20; path(); ctx.stroke();
      if (f === 'fire') { ctx.font = '90px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; for (const [x, y] of [[80, 80], [W - 80, 80], [80, H - 80], [W - 80, H - 80]]) ctx.fillText('🔥', x, y); }
      if (f === 'gold') { ctx.strokeStyle = 'rgba(255,240,180,0.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(inset + 26, inset + 26, W - inset * 2 - 52, H - inset * 2 - 52, r - 14); ctx.stroke(); }
    }
    ctx.restore();
  };
  async function showLocker() {
    view.innerHTML = `${pageHead('Level up, unlock stuff', 'Locker', 'Everything you do earns XP<br>Unlock frames, colors and name tags')}<div id="lkBody">${skel(3, 'cards')}</div>`;
    if (!S.me) { $('#lkBody').innerHTML = '<div class="empty"><b>Sign in to start leveling</b><a href="#" data-act="join">Sign in</a></div>'; return; }
    await loadLocker();
    drawLocker();
  }
  const PART_LABEL = { picks: 'Picks', callit: 'Call It', daily: 'Daily', takes: 'Hot takes', duels: 'Duels', props: 'Props', badges: 'Badges', cards: 'Cards', comments: 'Comments', lineups: 'Lineups' };
  function drawLocker() {
    const l = S.locker, el = $('#lkBody'); if (!l || !el) return;
    const pct = Math.round((l.xp - l.thisLevel) / Math.max(1, l.nextLevel - l.thisLevel) * 100);
    const next = Object.values(l.unlocks).flat().filter((u) => !u.unlocked).sort((a, b) => a.level - b.level)[0];
    const me = { name: S.me.name, profile: S.me.profile, tag: l.equipped.tag, level: l.level };
    const item = (kind, u) => `<button type="button" class="lk-i lk-${kind}-${u.id} ${l.equipped[kind] === u.id ? 'on' : ''} ${u.unlocked ? '' : 'locked'}" data-act="lk" data-k="${kind}" data-v="${u.id}" ${u.unlocked ? '' : 'disabled'}>
      <span class="lk-prev">${kind === 'frame' ? '' : kind === 'theme' ? `<i style="background:${esc(u.id === 'team' ? (TEAM_COLORS[l.equipped.team || S.me.profile?.team] || TEAM_COLORS.DET)[0] : u.id === 'default' ? 'var(--gold)' : THEMES[u.id]?.[0] || '#888')}"></i>` : `<span class="nt nt-${u.id}"><b>${esc(S.me.profile?.username || S.me.name)}</b></span>`}</span>
      <b>${esc(u.label)}</b><small>${u.unlocked ? (l.equipped[kind] === u.id ? 'Equipped' : 'Tap to equip') : `🔒 Level ${u.level}`}</small></button>`;
    el.innerHTML = `<div class="lk-lv"><div class="lk-badge"><small>Level</small><b>${l.level}</b></div><div class="lk-xp"><div class="lk-me">${SL.nameTag(me)}</div><div class="lk-bar"><i style="width:${pct}%"></i></div><small>${l.xp.toLocaleString()} XP · ${(l.nextLevel - l.xp).toLocaleString()} to level ${l.level + 1}${next ? ` · next unlock: ${esc(next.label)} (level ${next.level})` : ''}</small></div></div>
      <section class="lk-sec"><div class="label">Share-card frames</div><p class="rules">Shows on every play, take and Wrapped image you share.</p><div class="lk-grid">${l.unlocks.frame.map((u) => item('frame', u)).join('')}</div></section>
      <section class="lk-sec"><div class="label">Color themes</div><p class="rules">Recolors Live for you (it overrides your accent color while it's on).</p><div class="lk-grid">${l.unlocks.theme.map((u) => item('theme', u)).join('')}</div>
        ${l.equipped.theme === 'team' ? `<label class="lk-team">Team <select id="lkTeam">${Object.keys(TEAM_COLORS).map((t) => `<option ${((l.equipped.team || S.me.profile?.team) === t) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}</section>
      <section class="lk-sec"><div class="label">Name tags</div><p class="rules">How your name shows to everyone in takes, rooms and duels.</p><div class="lk-grid">${l.unlocks.tag.map((u) => item('tag', u)).join('')}</div></section>
      <section class="lk-sec"><div class="label">Where your XP comes from</div><div class="lk-parts">${Object.entries(l.parts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${esc(PART_LABEL[k] || k)} <b>${v.toLocaleString()}</b></span>`).join('') || '<p class="rules">Make a pick, call a play or solve the Daily to get started.</p>'}</div></section>`;
    const sel = $('#lkTeam'); if (sel) sel.onchange = (e) => equip({ team: e.target.value });
  }
  async function equip(body) {
    try {
      S.locker = await api('/api/locker', { method: 'POST', body });
      ls.set('sl-locker', JSON.stringify({ equipped: S.locker.equipped, level: S.locker.level }));
      const html = document.documentElement;
      if (S.locker.equipped.theme === 'default') { html.style.removeProperty('--accent-d'); html.style.removeProperty('--accent-l'); const a = (window.SL_ACCENTS || {})[html.dataset.accent]; if (a) { html.style.setProperty('--accent-d', a[0]); html.style.setProperty('--accent-l', a[1]); } }
      applyTheme(); drawLocker(); buzz(15);
    } catch (e) { toast(e.message); }
  }
  SL.acts.lk = (t) => {
    const body = { [t.dataset.k]: t.dataset.v };
    if (t.dataset.k === 'theme' && t.dataset.v === 'team' && !S.locker.equipped.team) body.team = S.me.profile?.team && TEAM_COLORS[S.me.profile.team] ? S.me.profile.team : 'DET';
    equip(body);
  };
  // level + best card in the account sheet
  const prevAccount = SL.hooks.account;
  SL.hooks.account = async () => {
    await prevAccount?.();
    const box = $('#acctExtra'); if (!box) return;
    const l = await loadLocker();
    if (l && $('#acctExtra')) box.insertAdjacentHTML('afterbegin', `<a class="acct-lv" href="#/locker" data-close><b>Level ${l.level}</b><span><i style="width:${Math.round((l.xp - l.thisLevel) / Math.max(1, l.nextLevel - l.thisLevel) * 100)}%"></i></span><small>${l.xp.toLocaleString()} XP · Locker →</small></a>`);
  };

  // ================= live updates =================
  const prevStream = SL.hooks.stream;
  SL.hooks.stream = (es) => {
    prevStream?.(es);
    const j = (e) => { try { return JSON.parse(e.data); } catch { return {}; } };
    es.addEventListener('redzone', (e) => showRedZone(j(e)));
    es.addEventListener('packs', () => { if (SL.currentRoute() === 'cards') loadCards(); });
    es.addEventListener('points', () => { if (SL.currentRoute() === 'props' && S.props.data?.slips?.length) { clearTimeout(S.props.t); S.props.t = setTimeout(loadProps, 2500); } });
  };
  // load your level/theme once you're known
  setTimeout(() => { if (S.me) loadLocker(); }, 1500);

  // ================= PROFILES =================
  // Anyone's profile on Live: record, credits, streaks, receipts, badges, best cards, this week's lineup
  async function showProfile(hash) {
    const name = decodeURIComponent(hash.split('/')[2] || '');
    view.innerHTML = `${pageHead('Profile', esc(name) || 'Profile')}<div id="pfBody">${skel(4, 'cards')}</div>`;
    let u;
    try { u = await api(`/api/u/${encodeURIComponent(name)}`); }
    catch (e) {
      const main = SL.profileUrl(name);
      $('#pfBody').innerHTML = `<div class="empty"><b>${esc(e.message)}</b>${main ? `<a href="${esc(main)}">See their sidelineff.com profile</a>` : '<a href="#/ranks">Ranks</a>'}</div>`;
      return;
    }
    const el = $('#pfBody'); if (!el) return;
    const pr = u.profile, main = pr?.username ? SL.profileUrl(pr.username) : null;
    $('.page-head h1').innerHTML = esc(pr?.username || u.name);
    const rec = u.record, pct = (a, b) => (a + b ? `${Math.round(a / (a + b) * 100)}%` : '–');
    const stat = (big, label, sub = '') => `<div class="pf-s"><b>${big}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const since = u.joined ? new Date(u.joined).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '';
    el.innerHTML = `<section class="pf-head">${avatarHtml(pr || { username: u.name }, 84)}
        <div class="pf-id"><div class="pf-name">${SL.nameTag({ name: u.name, profile: pr, tag: u.tag, level: u.level })}</div>
          <div class="sub">${[pr?.title, `Live level ${u.level}`, since ? `on Live since ${since}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
          <div class="share-btns">${main ? `<a class="btn ghost" href="${esc(main)}">sidelineff.com profile ↗</a>` : ''}${u.me ? '<a class="btn ghost" href="#/locker">Locker</a><a class="btn ghost" href="/account">Edit profile</a>' : ''}<button class="btn ghost" type="button" data-act="pf-share">Share profile</button></div></div></section>
      <div class="pf-grid">
        ${stat(u.credits.toLocaleString(), 'Credits', `#${u.rank} · ${esc(u.tier)}`)}
        ${stat(`${rec.w}-${rec.l}${rec.p ? `-${rec.p}` : ''}`, 'Winner picks', pct(rec.w, rec.l))}
        ${stat(`${u.callit.right}/${u.callit.called}`, 'Plays called', `best streak 🔥 ${u.callit.best}`)}
        ${stat(`🔥 ${u.daily.streak}`, 'Daily streak', `${u.daily.solved} solved`)}
        ${stat(`${u.takes.hit}-${u.takes.miss}`, 'Take receipts', 'hit-miss')}
        ${stat(`${u.duels.w}-${u.duels.l}`, 'Duels')}
        ${stat(`${u.props.w}-${u.props.l}`, 'Props slips')}
        ${stat(u.cardCount, 'Moment cards')}
      </div>
      ${u.badges.length ? `<section class="pf-sec"><div class="label">Badges</div><div class="bdg-row">${u.badges.map((b) => `<span class="bdg" title="Earned ${new Date(b.earned_at).toLocaleDateString()}">🏅 ${esc(b.label)}</span>`).join('')}</div></section>` : ''}
      ${u.showcase.length ? `<section class="pf-sec"><div class="label">Best cards</div><div class="mc-grid pf-cards">${u.showcase.map((c) => momentCard(c, { act: 'noop' })).join('')}</div></section>` : ''}
      ${u.lineup ? `<section class="pf-sec"><div class="label">Week ${u.lineup.week} lineup · ${fmt(u.lineup.total)} pts</div><div class="pf-lu">${u.lineup.players.map((x) => `<div class="pf-lp">${face(x, 'face sm')}<span>${esc(x.name)}<small>${esc(x.slot.replace(/\d/, ''))} · ${esc(x.team)}</small></span><b>${x.state === 'pre' ? '–' : fmt(x.points)}</b></div>`).join('')}</div></section>` : ''}
      ${u.takes.recent.length ? `<section class="pf-sec"><div class="label">Hot takes</div>${u.takes.recent.map((t) => `<div class="pf-take"><p>“${esc(t.body)}”</p><span class="tk-stamp ${t.result || ''}">${t.result === 'hit' ? 'HIT ✅' : t.result === 'miss' ? 'MISS ❌' : t.result === 'unsettled' ? 'Unsettled' : Date.now() < t.settle_at ? 'Open' : 'Being graded'}</span></div>`).join('')}<a class="foot" href="#/takes">All takes →</a></section>` : ''}`;
    S.pfName = pr?.username || u.name;
    refreshAnim($('.pf-grid'));
  }
  SL.acts['pf-share'] = () => shareLink(linkTo(`#/u/${encodeURIComponent(S.pfName || '')}`), `${S.pfName} on Sideline Live`);
  SL.navFor.u = 'ranks';

  Object.assign(SL.routes, { props: showProps, cards: showCards, trade: showTrade, locker: showLocker, u: showProfile });
})();
