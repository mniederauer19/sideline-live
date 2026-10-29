# sideline live

Every NFL play, the moment it happens, scored in standard PPR. People can vote on each play, react with emoji, and comment. Free picks against the Vegas spread and total earn credits that set your rank. A weekly salary-cap lineup builder lets everyone build their best team and see everyone else's, scored live.

## Try it in 1 minute

You need Node.js 22.13 or newer (https://nodejs.org).

```
npm install
npm run demo
```

Open http://localhost:3000. While `npm run demo` (or `npm run dev` for live data) is running, editing any file updates the site by itself: page files refresh open browsers, and server files restart the server. Demo mode simulates a slate (one live game adding a play every 6 seconds, one final, two upcoming) using real 2026 player names and salaries, so you can test every feature when no game is on.

For real NFL data:

```
npm start
```

## The full season

With `npm start` or `npm run dev`, the server loads the whole season's schedule (all 18 weeks plus playoffs: dates, kickoff times, TV, Vegas lines) from ESPN, then stores every play of every finished game, scored in PPR. The first run takes a few minutes; a bar at the top of the site shows progress. After that it checks for newly finished games every 10 minutes, refreshes the schedule every 6 hours, and re-checks each game once about 12 hours after it ends to pick up stat corrections.

Accuracy check against ESPN's official box scores for Weeks 1–7 of 2026 (19,815 plays): 97.6% of player-games match exactly and 100% are within 1 PPR point. Lineup totals always use the official box score.

## Where the data comes from

| What | Source |
|---|---|
| Live plays, scores, game clock, box scores, Vegas lines, win probability | ESPN's public site API (`site.api.espn.com`, no key needed) |
| Season stats, target share, aDOT, headshots, salaries | nflverse (the same data sidelineff.com already credits) |
| PPR per play, live EPA estimate, 1st downs, explosive plays, red zone, target share today | Calculated here from each play |

**About connecting to Real:** Real doesn't offer a public API, and copying their feed would break their terms of use. This app follows the same NFL plays directly from ESPN, so you get every play Real shows, at the same speed, without depending on them. ESPN's endpoints are unofficial and can change; if you outgrow them, swap `src/espn.js` for a paid feed like Sportradar or SportsDataIO. Nothing else needs to change.

## What's in each file

```
server.js          API routes + live push to browsers (Server-Sent Events)
src/engine.js      Polls the scoreboard and every live game, stores new plays, grades picks
src/parse.js       Turns ESPN play text into players, PPR points, headline and tags
src/ep.js          Expected-points model for live EPA estimates
src/nflverse.js    Season stats, ESPN↔nflverse player IDs, salaries
src/espn.js        ESPN client
src/demo.js        Simulated games in ESPN's exact format (for testing)
src/db.js          SQLite tables: users, games, plays, reactions, votes, comments, picks, lineups
src/sideline-auth.js  Shared login with sidelineff.com accounts (AUTH_MODE=sideline)
src/persist.js     Saves people's data to Postgres when DATABASE_URL is set
render.yaml        Free hosting on Render (Dockerfile, railway.json, fly.toml for others)
public/            The site: index.html, styles.css, app.js (no build step)
```

## Scoring

- **Per play (PPR):** 1 per catch, 0.1 per rushing/receiving yard, 0.04 per passing yard, 6 per rushing/receiving TD, 4 per passing TD, −2 per interception or lost fumble, 2 per 2-pt conversion. Kickers: 3/4/5 for FGs under 40/40–49/50+, 1 per PAT, −1 per miss. D/ST: 1 per sack, 2 per takeaway or safety, 6 per defensive TD.
- **Lineup totals** use the official box score, so they always match the final stat line.
- **Picks:** right pick +100 credits, wrong pick −50, push 0. Everyone starts with 1,000. Lines lock at the moment you pick, and picks lock at kickoff. Ranks: Practice squad, Rookie, Starter, Pro Bowl, All-Pro, Hall of Fame.
- **Lineups:** QB, RB, RB, WR, WR, WR, TE, FLEX under a $50,000 cap. Salaries come from a blend of last-3-games and season PPR per game. Each player locks when their game kicks off.

## Putting it online

This needs an always-on Node server (it polls every few seconds and keeps a live connection open to every visitor). The free setup is **Render** (runs the site) plus **Neon** (a free Postgres database that keeps people's data). Everything Render needs is in `render.yaml`.

Why two services: Render's free plan erases the server's files whenever it restarts. Plays, scores and stats rebuild themselves from ESPN, but accounts, comments, reactions, votes, picks and lineups can't, so they're also saved to Neon and copied back on every start (`src/persist.js`).

**1. Deploy (about 15 minutes, no card needed)**

1. **GitHub:** make a free account at github.com, create a repository called `sideline-live`, and upload this folder's files (everything except `node_modules` and `data`).
2. **Neon:** make a free account at neon.tech and create a project (region: AWS US East, Virginia). On the dashboard click **Connect** and copy the connection string (starts with `postgresql://`).
3. **Render:** make a free account at render.com (sign in with GitHub), then **New > Blueprint**, pick the `sideline-live` repository, paste the Neon string into `DATABASE_URL`, and click **Apply**.

You get a link like `sideline-live.onrender.com`. The first start loads the whole season, which takes a while on the free server; a bar at the top shows progress. To update the site later, change the files on GitHub and Render redeploys by itself.

Free-plan notes:
- Render puts free sites to sleep after 15 minutes without visitors. The server visits its own `/api/health` every 10 minutes so it keeps following live games. For a backup, add a free monitor at uptimerobot.com pointing at `https://YOUR-APP.onrender.com/api/health` every 5 minutes.
- Render's free plan includes 750 hours a month (enough for one site running all month) and a monthly bandwidth limit, so pages are sent compressed.
- `/api/health` shows `saved: { restored, pending, failed }` so you can check that data is reaching Neon.
- If you outgrow the free plans, Render's paid Starter plan with a disk, Railway (`railway.json`) and Fly.io (`fly.toml`) also work; without `DATABASE_URL` the app keeps everything in its SQLite file.

**2. Put it on sidelineff.com** (needs the site owner's access). Pick one:

- **A. `sidelineff.com/live` (recommended).** Add one rewrite to sidelineff.com so `/live/*` is served by the Render app. Visitors never leave sidelineff.com, so the login cookie and the Customize settings (look, accent, mode, photos) are shared automatically. sidelineff.com runs on vinext, which supports Next-style rewrites:

  ```js
  // next.config.js (or the equivalent in vinext's config)
  async rewrites() {
    return [{ source: '/live/:path*', destination: 'https://YOUR-APP.onrender.com/:path*' }];
  }
  ```
  Also redirect `/live` to `/live/` (trailing slash), and point the site's **Games** or a new **Live** nav link at `/live/`.

- **B. `live.sidelineff.com`.** Add the custom domain `live.sidelineff.com` in Render (Settings > Custom Domains) and the CNAME record it shows you. For shared login, the sidelineff.com session cookie must be set with `Domain=.sidelineff.com` so it reaches the subdomain. Customize settings would be saved separately on each site.

**3. Shared login** (set `AUTH_MODE=sideline` in Render > Environment once step 2 is done)

The app asks sidelineff.com who is signed in by calling `GET https://sidelineff.com/api/profile` with the visitor's cookie, then matches them to a local account (picks, credits and lineups are keyed to their Sideline account). No passwords pass through this app. Things to confirm with the site owner:
- `/api/profile` returns `{ signedIn: true, profile: { id, username, ... } }` for a signed-in visitor. If the field names differ, adjust `identity()` in `src/sideline-auth.js`.
- The login page sends people back after signing in when given `?next=<url>` (the "Sign in with Sideline" button passes it).

## Customize

The header has a light/dark button and a Customize button with the same options as sidelineff.com: **site look** (Editorial, Classic newspaper, Modern), **mode** (light or dark; Modern is always dark), **12 accent colors**, **player photos** (color or black and white) and **logo style** (classic or neon). Settings are saved on the device using the same keys as sidelineff.com (`sideline-look`, `sideline-theme`, `sideline-accent`, `sideline-photos`, plus `sideline-logos`), so on `sidelineff.com/live` they follow whatever the visitor picked on the main site.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/games` | This week's games, lines, your picks, community pick splits |
| GET | `/api/games/:id/fantasy` | PPR leaders and win probability for one game |
| GET | `/api/feed?filter=all\|scoring\|ppr5\|ppr10\|big\|mine&game=&player=&before=` | Play feed with reactions, votes and comment counts |
| GET | `/api/stream` | Live events: `play`, `play_update`, `game`, `social`, `comment`, `points`… |
| POST | `/api/users` `{name}` | Create a username, returns a token |
| POST | `/api/plays/:id/react` `{emoji}` | Toggle a reaction |
| POST | `/api/plays/:id/vote` `{value: 1\|-1\|0}` | Vote on a play |
| GET/POST | `/api/plays/:id/comments` `{body}` | Read or post comments |
| POST | `/api/picks` `{gameId, market: spread\|total, selection}` | Make or change a pick before kickoff |
| GET | `/api/leaderboard` | Ranks by credits |
| GET | `/api/slate` | This week's player pool with salaries |
| GET/POST | `/api/lineups/me`, `/api/lineups` `{players:[{slot,id}]}` | Your lineup; save it |
| GET | `/api/lineups` | Everyone's lineups ranked by live points, plus most-rostered players |

## Before you launch

- **Comment moderation:** there's a length limit and a 3-second rate limit, but no word filter or report button yet.
- **Live EPA** is an estimate from a simple model. nflverse publishes official EPA the next morning; use that on your Advanced stats page.
- **Inactives:** the lineup pool doesn't know about injuries yet. Players who haven't played in 3 weeks are hidden.
- **Keep picks free.** No entry fee and no prizes keeps this a game. Adding paid entry or cash prizes brings in gambling and sweepstakes laws, so talk to a lawyer first.
