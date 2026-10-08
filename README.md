# Pini Arcade

A dependency-free, static emoji arcade game. Serve this folder over HTTP and open
`index.html` (for example, `python3 -m http.server 8765`).

Arcade waves are endless: a run lasts until all three hearts are gone. Each wave is
15 seconds. Waves 1–6 are hand-tuned; after that, six more waves ramp toward a fixed
ceiling (an emoji every 0.52 s, 1.2 s falls, 18% bombs) that then holds for good.
Catch the displayed emoji before it falls off the screen (letting one through costs a
heart), avoid decoys and bombs, and build a combo. Keys **1–4**
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

### Who submitted a score

To help spot bots and repeat cheaters, each global score also stores where it came from:

- **From Cloudflare** (`functions/api/scores.js`): the IP address (`CF-Connecting-IP`, which the
  browser cannot set), country, ASN, user agent, and network name, city, region, timezone, data
  center and TLS/HTTP version as JSON.
- **From the browser** (`scripts/fingerprint.js`): rendering and hardware signals that stay the same
  for one browser on one device across visits and cleared storage: canvas, WebGL GPU and parameters,
  an offline audio render, installed fonts, screen, pixel ratio, languages, timezone, CPU threads,
  memory, touch and pointer, color gamut, and the `navigator.webdriver` automation flag. Collection
  starts when a run ends and is capped at 1.5 seconds; a score is still saved without it. The
  server keeps only small flat values, stores them as sorted JSON and uses their SHA-256 as the
  fingerprint ID, so the same browser gets the same ID whatever it claims.

A fingerprint is a strong hint, not proof: a determined cheater can spoof every signal, and identical
devices (two stock iPhones of the same model, for example) can share one. A score with no fingerprint
or `webdriver: yes` is worth a closer look.

IP addresses and fingerprints are personal data under the GDPR. They are kept only to protect the
leaderboard from abuse (legitimate interest), are visible only to admins, and should be mentioned in
the site's privacy notice; consider pruning them from old scores, for example
`UPDATE scores SET ip = NULL, user_agent = NULL, request_meta = NULL, fingerprint_data = NULL WHERE created_at < date('now', '-90 days')`.

### Cloudflare setup

The site deploys as a Cloudflare Pages project, which picks up the `functions/` folder automatically.

1. Create a D1 database, for example `npx wrangler d1 create <database-name>`, or in the
   dashboard under **Storage & Databases → D1**.
2. Create the table, then add the submission details columns, by running each migration once in
   order: `npx wrangler d1 execute <database-name> --remote --file=migrations/0001_create_scores.sql`,
   then the same with `migrations/0002_score_origin.sql` (or paste the files into the D1 console).
3. In the Pages project, open **Settings → Bindings → Add → D1 database**, set the variable name
   to `DB` and pick the database. Add it for Production and, if you want previews to work, Preview.
4. Redeploy. Until the binding exists, `/api/scores` answers `503` and the game shows the global
   board as unavailable.

To run the API locally: `npx wrangler pages dev . --d1 DB=<database-name>` after applying the
migration with `--local`.

## Admin dashboard

`admin.semina.be` opens a dashboard (`admin/index.html`) that shows both global boards (top 50 each,
with a line under the top 10 players see, each score's IP and a device badge when one fingerprint has
several scores). It can delete a single score, clear one board or both, and open a details screen
for any score with everything stored about its submission plus the other scores from the same
fingerprint and the same IP. It talks to `GET /api/admin/scores`, `GET /api/admin/scores?id=<id>`,
`DELETE /api/admin/scores?id=<id>` and
`DELETE /api/admin/scores?category=<arcade-falling|arcade-stationary|all>`.

Cloudflare Access is the login, and the server checks it again: `functions/_shared/access.js`
verifies the Access JWT (`Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie) against the
team's signing keys, the application's AUD tag and an email allowlist on every `/admin/*` and
`/api/admin/*` request, whatever hostname it arrives on. Without a valid token, or while the variables
below are missing, those routes answer `403`/`503`.

### Admin setup

1. **Custom domain.** In the Pages project, open **Custom domains → Set up a custom domain** and add
   `admin.semina.be`. The site root on that hostname redirects to `/admin/` (`functions/index.js`;
   set `ADMIN_HOST` to use another hostname).
2. **Access application.** In **Zero Trust → Access → Applications → Add an application →
   Self-hosted**, set the domain to `admin.semina.be` (whole hostname, no path), and add an **Allow**
   policy with the **Emails** selector listing the admin addresses. One-time PIN is the simplest
   login method. Copy the **Application Audience (AUD) Tag** from the application's overview.
3. **Environment variables.** In the Pages project, open **Settings → Variables and Secrets** and add,
   for Production:
   - `ACCESS_TEAM_DOMAIN`: the Zero Trust team domain, for example `pini` or `pini.cloudflareaccess.com`
     (shown under **Zero Trust → Settings**).
   - `ACCESS_AUD`: the AUD tag from step 2.
   - `ADMIN_EMAILS`: comma-separated admin emails, the same addresses as the Access policy.
4. Redeploy so the variables take effect.

Clearing deletes rows from D1 for good as far as the dashboard is concerned. If that was a mistake,
D1 Time Travel can restore the database to an earlier minute:
`npx wrangler d1 time-travel restore <database-name> --timestamp=<ISO time before the clear>`.

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
