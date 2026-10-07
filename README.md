# Pini Arcade

A dependency-free, static emoji arcade game. Serve this folder over HTTP and open
`index.html` (for example, `python3 -m http.server 8765`).

Arcade waves are endless: a run lasts until all three hearts are gone. Each wave is
15 seconds. Waves 1–6 are hand-tuned; after that, six more waves ramp toward a fixed
ceiling (an emoji every 0.52 s, 1.2 s falls, 18% bombs) that then holds for good.
Catch the displayed emoji, avoid decoys and bombs, and build a combo. Keys **1–4**
catch the oldest object in each lane; **P** or **Escape** opens the pause menu.
Stationary targets are available on the title screen and enabled by default when
the browser prefers reduced motion. Zen keeps the relaxed, untimed loop.

Correct catches earn 100 points with combo tiers at 5, 10, and 20 catches.
Twenty catches charge eight seconds of Fever with double points. Optional wave
goals grant a one-time 500-point bonus. Music and effects have independent controls;
neither influences gameplay. Menus, tab hiding, and window blur pause the simulation.
Resume includes a three-second countdown.

Records are stored locally under `pini.records.v1`, separately for Arcade/Zen and
falling/stationary play. If storage is unavailable, records last for the visit.
Zen records are saved when leaving or restarting a session.

## Leaderboards

When an Arcade run ends, players can enter a name (1–12 letters or digits, checked in the
browser and again on the server). Each saved score goes to two top-10 boards shown side by
side on the results screen, separately for falling and stationary play:

- **This browser**: kept in `localStorage` under `pini.leaderboard.v1`; the last name used is
  remembered under `pini.player.v1`.
- **Global**: stored in Cloudflare D1 through the Pages Function `functions/api/scores.js`
  (`GET /api/scores?category=arcade-falling`, `POST /api/scores` with `{ name, score, category }`).

A score that lands #1, #2 or #3 on the global board shows a gold, silver or bronze trophy,
drawn in plain WebGL by `scripts/trophy.js` (one still frame when the browser prefers reduced motion).

If the API or database is unavailable, the local board still works and the global board says so.
Scores are reported by the browser, so treat the global board as a friendly board rather than a
cheat-proof one; the server only rejects malformed names, categories and implausible scores.

### Cloudflare setup

The site deploys as a Cloudflare Pages project, which picks up the `functions/` folder automatically.

1. Create a D1 database, for example `npx wrangler d1 create <database-name>`, or in the
   dashboard under **Storage & Databases → D1**.
2. Create the table:
   `npx wrangler d1 execute <database-name> --remote --file=migrations/0001_create_scores.sql`
   (or paste the file into the D1 console).
3. In the Pages project, open **Settings → Bindings → Add → D1 database**, set the variable name
   to `DB` and pick the database. Add it for Production and, if you want previews to work, Preview.
4. Redeploy. Until the binding exists, `/api/scores` answers `503` and the game shows the global
   board as unavailable.

To run the API locally: `npx wrangler pages dev . --d1 DB=<database-name>` after applying the
migration with `--local`.

## Development

The pure simulation lives in `scripts/game-engine.js`; presentation and browser
integration are in `scripts/game.js`. Run the tests (Node 22 or newer; the API tests use the
built-in `node:sqlite` as a stand-in for D1) with:

```sh
node --test tests/*.test.*
```

This implements the specification's first release. Power-ups, cosmetics, challenge
variants, daily challenges, survival, and bosses remain future releases. Difficulty
values are initial playtest tuning, not a guarantee of a particular success rate.

## Icons and sharing

The favicon is the pink PINI star (`favicon.svg`), with PNG/ICO fallbacks, an
`apple-touch-icon.png` and `icon-192.png`/`icon-512.png` for `site.webmanifest`. `og-image.png`
(1200×630) is the social sharing card and mirrors the title screen. `robots.txt` and
`sitemap.xml` point crawlers at `https://semina.be/`. If the star or title design changes,
regenerate the PNGs so they stay in sync.
