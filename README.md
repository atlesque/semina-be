# Pini Arcade

A dependency-free, static emoji arcade game. Serve this folder over HTTP and open
`index.html` (for example, `python3 -m http.server 8765`).

Arcade runs last 90 seconds of active play across six waves, with three hearts.
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

The pure simulation lives in `scripts/game-engine.js`; presentation and browser
integration are in `scripts/game.js`. Run the rules tests with:

```sh
node --test tests/game-engine.test.cjs
```

This implements the specification's first release. Power-ups, cosmetics, challenge
variants, daily challenges, survival, and bosses remain future releases. Difficulty
values are initial playtest tuning, not a guarantee of a particular success rate.
