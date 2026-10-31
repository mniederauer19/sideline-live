// Thin client for ESPN's public site API (no key required) + normalizers.
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sideline-live/1.0' } });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}

// ESPN's core API posts each play ~20s before the game summary does (measured Oct 31, 2026)
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

// Other leagues (e.g. one college game added for a day) use the same endpoints
const siteFor = (league) => (league && league !== 'nfl' ? SITE.replace('/nfl', `/${league}`) : SITE);
const coreFor = (league) => (league && league !== 'nfl' ? CORE.replace('/nfl', `/${league}`) : CORE);

const live = {
  corePlays: (eventId, page, size, league) => getJSON(`${coreFor(league)}/events/${eventId}/competitions/${eventId}/plays?limit=${size}&page=${page}&_=${Date.now()}`),
  scoreboard: (params = '') => getJSON(`${SITE}/scoreboard${params}`),
  summary: (eventId, league) => getJSON(`${siteFor(league)}/summary?event=${eventId}`),
  // One week of the schedule. type 2 = regular season, 3 = postseason
  week: (season, type, week) => getJSON(`${SITE}/scoreboard?dates=${season}&seasontype=${type}&week=${week}`),
};

// Postseason weeks continue after week 18 so every game has one week number
const POST_LABELS = { 19: 'Wild Card', 20: 'Divisional', 21: 'Conference', 22: 'Pro Bowl', 23: 'Super Bowl' };
function weekNumber(seasonType, week) {
  if (!week) return week;
  return seasonType === 3 ? 18 + week : week;
}

// "GB -3.5" -> { fav: 'GB', spread: 3.5 }, "EVEN" -> { fav: null, spread: 0 }
function parseDetails(details) {
  if (!details) return null;
  if (/even|pk|pick/i.test(details)) return { fav: null, spread: 0 };
  const m = details.match(/^([A-Z]{2,4})\s*-?(\d+(?:\.\d+)?)/);
  return m ? { fav: m[1], spread: Number(m[2]) } : null;
}

function normalizeOdds(o) {
  if (!o) return null;
  const d = parseDetails(o.details);
  const total = o.overUnder != null ? Number(o.overUnder) : null;
  if (!d && total == null) return null;
  return {
    details: o.details || '',
    fav: d?.fav ?? null,
    spread: d?.spread ?? null,
    total,
    provider: o.provider?.name || '',
  };
}

function team(c) {
  return {
    id: c.team?.id,
    abbr: c.team?.abbreviation,
    name: c.team?.shortDisplayName || c.team?.name,
    logo: c.team?.logo || '',
    color: c.team?.color ? `#${c.team.color}` : '',
    score: c.score != null ? Number(c.score) : 0,
    record: c.records?.[0]?.summary || c.record?.[0]?.displayValue || '',
  };
}

function normalizeEvent(ev) {
  const comp = ev.competitions?.[0] || {};
  const comps = comp.competitors || [];
  const home = comps.find((c) => c.homeAway === 'home') || comps[0] || {};
  const away = comps.find((c) => c.homeAway === 'away') || comps[1] || {};
  const st = ev.status || comp.status || {};
  const sit = comp.situation || {};
  return {
    id: String(ev.id),
    name: ev.shortName || ev.name,
    start: Date.parse(ev.date || comp.date),
    season: ev.season?.year,
    seasonType: ev.season?.type,
    week: weekNumber(ev.season?.type, ev.week?.number),
    timeValid: comp.timeValid !== false,
    state: st.type?.state || 'pre', // pre | in | post
    detail: st.type?.shortDetail || '',
    period: st.period || 0,
    clock: st.displayClock || '',
    home: team(home),
    away: team(away),
    odds: normalizeOdds((comp.odds || [])[0]),
    broadcast: comp.broadcasts?.[0]?.names?.[0] || comp.geoBroadcasts?.[0]?.media?.shortName || '',
    possession: sit.possession || null,
    lastPlayId: sit.lastPlay?.id || null,
    downDistance: sit.shortDownDistanceText || sit.downDistanceText || '',
    redZone: !!sit.isRedZone,
  };
}

module.exports = { live, normalizeEvent, normalizeOdds, parseDetails, POST_LABELS, weekNumber };
