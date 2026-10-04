(function (root) {
  "use strict";
  const WAVES = [
    { interval: 1000, travel: 5000, target: .85, bomb: 0, goal: 8 },
    { interval: 910, travel: 4600, target: .82, bomb: 0, goal: 9 },
    { interval: 820, travel: 4200, target: .78, bomb: .06, goal: 10 },
    { interval: 730, travel: 3800, target: .75, bomb: .08, goal: 11 },
    { interval: 640, travel: 3400, target: .72, bomb: .10, goal: 12 },
    { interval: 550, travel: 3000, target: .70, bomb: .12, goal: 13 },
  ];
  const multiplier = combo => combo >= 20 ? 4 : combo >= 10 ? 3 : combo >= 5 ? 2 : 1;

  function createGame({ words, random = Math.random, emit = () => {} }) {
    let s;
    let nextId = 0;
    let wordBag = [];
    let laneGap = .28;
    function setPlayfieldHeight(height) {
      if (Number.isFinite(height)) laneGap = Math.min(1, Math.max(.28, 70 / Math.max(1, height - 66)));
    }
    function nextWord() {
      if (!wordBag.length) {
        wordBag = [...words];
        for (let i = wordBag.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [wordBag[i], wordBag[j]] = [wordBag[j], wordBag[i]];
        }
        if (wordBag.length > 1 && wordBag.at(-1).emoji === s.target?.emoji) {
          [wordBag[0], wordBag[wordBag.length - 1]] = [wordBag.at(-1), wordBag[0]];
        }
      }
      return wordBag.pop();
    }
    function reset(mode = "arcade", stationary = false) {
      nextId = 0;
      wordBag = [];
      s = { mode, stationary, phase: "title", previousPhase: null, countdown: 0,
        score: 0, combo: 0, bestCombo: 0, hearts: 3, correct: 0, mistakes: 0,
        wavesCompleted: 0, wave: 0, waveTime: 0, elapsed: 0, waveCatches: 0,
        waveAwarded: false, feverCharge: 0, feverTime: 0, cooldown: 0,
        spawnIn: 0, objects: [], target: null };
      return s;
    }
    function beginWave() {
      s.target = nextWord();
      s.waveTime = 0;
      s.waveCatches = 0;
      s.waveAwarded = false;
      s.spawnIn = 0;
      s.objects = [];
      s.phase = "wave";
      s.countdown = 1400;
      emit({ type: "wave", target: s.target, wave: s.wave + 1 });
    }
    function start(mode = "arcade", stationary = false) {
      reset(mode, stationary);
      beginWave();
    }
    function finish(reason) {
      s.phase = "results";
      s.objects = [];
      emit({ type: "finish", reason });
    }
    function pause() {
      if (!["playing", "wave", "resume"].includes(s.phase)) return;
      s.previousPhase = s.phase === "resume" ? s.previousPhase : s.phase;
      s.phase = "paused";
      emit({ type: "pause" });
    }
    function resume() {
      if (s.phase !== "paused") return;
      s.phase = "resume";
      s.resumeTime = 3000;
    }
    function breakCombo() {
      if (s.combo) emit({ type: "combo-break" });
      s.combo = 0;
    }
    function resolve(id, caught) {
      if (s.phase !== "playing") return false;
      const index = s.objects.findIndex(object => object.id === id);
      if (index === -1) return false;
      const [object] = s.objects.splice(index, 1);
      if (s.mode === "zen") {
        if (caught) {
          s.score++;
          s.correct++;
          emit({ type: "catch", points: 1, object });
          if (object.emoji === s.target.emoji) {
            s.target = nextWord();
            emit({ type: "target", target: s.target });
          }
        }
        return true;
      }
      if (!caught) {
        if (object.kind === "target") breakCombo();
        return true;
      }
      if (object.kind !== "target") {
        // Resolve the object even during invulnerability; one gesture cannot drain lives.
        if (s.cooldown > 0) return true;
        s.mistakes++;
        s.hearts--;
        s.cooldown = 700;
        breakCombo();
        if (object.kind === "bomb") s.feverCharge = Math.max(0, s.feverCharge - 5);
        emit({ type: "damage", object });
        if (!s.hearts) finish("hearts");
        return true;
      }
      s.combo++;
      s.bestCombo = Math.max(s.bestCombo, s.combo);
      s.correct++;
      s.waveCatches++;
      const points = 100 * multiplier(s.combo) * (s.feverTime > 0 ? 2 : 1);
      s.score += points;
      emit({ type: "catch", points, object });
      if ([5, 10, 20].includes(s.combo)) emit({ type: "milestone", multiplier: multiplier(s.combo) });
      if (s.feverTime === 0 && ++s.feverCharge === 20) {
        s.feverCharge = 0;
        s.feverTime = 8000;
        emit({ type: "fever" });
      }
      if (!s.waveAwarded && s.waveCatches >= WAVES[s.wave].goal) {
        s.waveAwarded = true;
        s.score += 500;
        emit({ type: "wave-clear", points: 500 });
      }
      return true;
    }
    function catchLane(lane) {
      const object = s.objects.find(object => object.lane === lane);
      return object ? resolve(object.id, true) : false;
    }
    function spawn() {
      const tuning = WAVES[s.wave];
      const freeLanes = [0, 1, 2, 3].filter(lane => {
        const occupants = s.objects.filter(object => object.lane === lane);
        return s.stationary ? !occupants.length : occupants.length < 2 && occupants.every(object => object.age > object.travel * laneGap);
      });
      if (!freeLanes.length || s.objects.length >= (s.stationary ? 4 : 8)) return;
      const lane = freeLanes[Math.floor(random() * freeLanes.length)];
      const roll = random();
      const kind = s.mode === "zen" || roll < tuning.target ? "target" : roll < tuning.target + tuning.bomb ? "bomb" : "decoy";
      // Decoys come from distinct silhouettes, excluding the target itself.
      const decoys = ["🍎", "🐬", "🍕", "🪐", "🎹", "🌲", "💻"].filter(emoji => emoji !== s.target.emoji);
      const emoji = kind === "target" ? s.target.emoji : kind === "bomb" ? "💣" : decoys[Math.floor(random() * decoys.length)];
      s.objects.push({ id: ++nextId, kind, emoji, lane, age: 0,
        travel: s.mode === "zen" ? 7000 : tuning.travel });
    }
    function step(dt) {
      if (s.phase === "resume") {
        const used = Math.min(dt, s.resumeTime);
        s.resumeTime -= used;
        if (!s.resumeTime) s.phase = s.previousPhase;
        return used;
      }
      if (s.phase === "wave") {
        const used = Math.min(dt, s.countdown);
        s.countdown -= used;
        if (!s.countdown) s.phase = "playing";
        return used;
      }
      if (s.phase !== "playing") return dt;
      const used = s.mode === "arcade" ? Math.min(dt, 15000 - s.waveTime) : dt;
      s.elapsed += used;
      s.waveTime += used;
      s.feverTime = Math.max(0, s.feverTime - used);
      s.cooldown = Math.max(0, s.cooldown - used);
      // Clear at the boundary before resolving escapes: transitions never penalize.
      if (s.mode === "arcade" && s.waveTime >= 15000) {
        s.wavesCompleted++;
        if (s.wave === 5) finish("time");
        else { s.wave++; beginWave(); }
        return used;
      }
      for (const object of [...s.objects]) {
        object.age += used;
        if (object.age >= object.travel) resolve(object.id, false);
      }
      s.spawnIn -= used;
      if (s.spawnIn <= 0) {
        spawn();
        s.spawnIn += s.mode === "zen" ? 850 : WAVES[s.wave].interval;
      }
      return used;
    }
    function advance(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      while (dt > 0) dt -= step(Math.min(dt, 50));
    }
    reset();
    return { get state() { return s; }, start, reset, pause, resume, resolve, catchLane, advance, setPlayfieldHeight };
  }
  const api = { createGame, multiplier, WAVES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PiniGame = api;
})(typeof window !== "undefined" ? window : globalThis);
