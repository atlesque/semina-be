(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const number = value => value.toLocaleString();
  const palettes = ["#fff0d9", "#e3f3ec", "#ece6fa", "#ffe6e9", "#e0f1f9", "#fff0cf"];
  const field = $("playfield");
  const audio = $("background-music");
  const menu = $("game-menu");
  const lanes = [...document.querySelectorAll("[data-lane]")];
  const objectNodes = new Map();
  let mode = "arcade";
  let records = {};
  let storageAvailable = true;
  let effectsEnabled = true;
  let musicEnabled = true;
  let audioContext;
  let lastFrame = null;
  let feedbackTime = 0;
  let visuals = [];
  let savedResult = false;
  let recordKey = "arcade-falling";
  let overlaySignature = "";
  const Board = PiniLeaderboard;
  let localBoards = {};
  let playerName = "";
  // Increments per results screen so late responses never paint a newer one.
  let resultToken = 0;
  try {
    const stored = JSON.parse(localStorage.getItem("pini.records.v1") || "{}");
    for (const key of ["arcade-falling", "arcade-stationary", "zen-falling", "zen-stationary"]) {
      if (Number.isSafeInteger(stored?.[key]) && stored[key] >= 0) records[key] = stored[key];
    }
  } catch { storageAvailable = false; }
  try {
    const stored = JSON.parse(localStorage.getItem("pini.leaderboard.v1") || "{}");
    for (const key of Board.CATEGORIES) {
      if (Array.isArray(stored?.[key])) localBoards[key] = stored[key].filter(Board.isValidEntry).slice(0, Board.BOARD_SIZE);
    }
    playerName = Board.cleanName(localStorage.getItem("pini.player.v1"));
  } catch { storageAvailable = false; }
  $("stationary").checked = motion.matches;

  const game = PiniGame.createGame({ words: PiniWords, emit: handleEvent });
  const visualizer = PiniAudioVisualizer.createAudioVisualizer({
    audioElement: audio, targetElement: $("wordmark"), canvasElement: $("audio-glow"),
  });
  const player = PiniAudioPlayer.createAudioPlayerController({
    audioElement: audio, playerElement: $("audio-player"), visualizer,
    tracks: [
      { title: "Semina — MBP Melody", src: "audio/semina-mbp-melody.mp3" },
      { title: "Get Well Soon", src: "audio/20260916-142727-77c9dd-web-small.mp3" },
      { title: "Pini Macedonini", src: "audio/pini-background.mp3" },
      { title: "Pini — Metal Spark", src: "audio/pini-metal.mp3" },
    ],
    playlistElement: $("playlist-menu"), isEnabled: () => musicEnabled,
  });
  // Browsers may require a user gesture before audible playback.
  audio.muted = false;
  audio.volume = .5;
  player.startBackgroundMusic();
  document.addEventListener("pointerdown", () => player.startBackgroundMusic(), { once: true });
  $("music-enabled").addEventListener("change", event => {
    musicEnabled = event.target.checked;
    audio.muted = !musicEnabled;
    if (musicEnabled) player.startBackgroundMusic();
    else audio.pause();
    renderSoundToggle();
  });
  audio.addEventListener("volumechange", () => {
    musicEnabled = !audio.muted && audio.volume > 0;
    $("music-enabled").checked = musicEnabled;
    renderSoundToggle();
  });
  $("effects-enabled").addEventListener("change", event => { effectsEnabled = event.target.checked; renderSoundToggle(); });
  // The HUD toggle mutes everything; unmuting restores both music and effects.
  $("sound-toggle").addEventListener("click", () => {
    const on = !(musicEnabled || effectsEnabled);
    for (const id of ["music-enabled", "effects-enabled"]) {
      $(id).checked = on;
      $(id).dispatchEvent(new Event("change"));
    }
  });
  function renderSoundToggle() {
    const muted = !(musicEnabled || effectsEnabled);
    $("sound-toggle").textContent = muted ? "🔇" : "🔊";
    $("sound-toggle").setAttribute("aria-pressed", String(muted));
    $("sound-toggle").setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
  }

  function tone(frequency = 520, duration = .08) {
    if (!effectsEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      audioContext.resume().catch(() => {});
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.05, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch { /* Sound is optional, including on browsers without Web Audio. */ }
  }
  function announce(message) { $("live-events").textContent = message; }
  function feedback(message) {
    $("feedback").textContent = message;
    $("feedback").hidden = false;
    feedbackTime = 1200;
  }
  function displayWord(word) {
    if (/ie$|ia$/i.test(word)) return word.slice(0, -2) + "ini";
    return word.replace(/[aeiouy]$/i, "") + "ini";
  }
  function clearVisuals() {
    for (const visual of visuals) visual.node.remove();
    visuals = [];
    feedbackTime = 0;
    $("feedback").hidden = true;
    $("combo").classList.remove("pulse");
  }
  function catchEffect(object, points) {
    const bounds = objectNodes.get(object.id)?.getBoundingClientRect();
    const fieldBounds = field.getBoundingClientRect();
    const x = bounds ? bounds.left + bounds.width / 2 - fieldBounds.left : field.clientWidth * (object.lane + .5) / 4;
    const y = bounds ? bounds.top + bounds.height / 2 - fieldBounds.top : field.clientHeight / 2;
    const popup = document.createElement("span");
    popup.className = "points";
    popup.textContent = `+${points}`;
    popup.style.left = `${x}px`;
    popup.style.top = `${Math.max(24, y)}px`;
    popup.setAttribute("aria-hidden", "true");
    field.append(popup);
    visuals.push({ node: popup, age: 0, duration: 700, x, y: Math.max(24, y), dx: 0, dy: -32 });
    if (game.state.stationary || motion.matches) return;
    for (let i = 0; i < (game.state.feverTime ? 9 : 5); i++) {
      const petal = document.createElement("span");
      petal.className = "particle";
      petal.textContent = ["🌸", "✦", "🌼"][i % 3];
      petal.setAttribute("aria-hidden", "true");
      field.append(petal);
      const angle = i * Math.PI * 2 / 5;
      visuals.push({ node: petal, age: 0, duration: 650, x, y, dx: Math.cos(angle) * 55, dy: Math.sin(angle) * 55 });
    }
  }
  function handleEvent(event) {
    switch (event.type) {
      case "wave":
        clearVisuals();
        document.body.style.backgroundColor = palettes[game.state.wave];
        announce(game.state.mode === "zen" ? `Zen mode. Catch ${event.target.word}, ${event.target.emoji}. Every catch counts.` : `Wave ${event.wave}. Catch ${event.target.word}, ${event.target.emoji}. Avoid the others.`);
        break;
      case "target": announce(`Catch ${event.target.word}, ${event.target.emoji}.`); break;
      case "catch": catchEffect(event.object, event.points); tone(520 + Math.min(game.state.combo, 20) * 18); break;
      case "combo-break": feedback("Combo broken — keep going!"); break;
      case "milestone":
        feedback(`×${event.multiplier} multiplier!`);
        announce(`Combo multiplier ${event.multiplier}.`);
        $("combo").classList.remove("pulse");
        void $("combo").offsetWidth;
        $("combo").classList.add("pulse");
        tone(1040, .2);
        break;
      case "damage": feedback("Ouch! −1 heart"); announce(`${game.state.hearts} hearts remaining.`); tone(160, .18); break;
      case "fever": feedback("FEVER! Double points ✦"); announce("Fever! Double points for eight seconds."); tone(1400, .3); break;
      case "wave-clear": feedback("Wave clear! +500 ✦"); announce("Wave catch goal complete. 500 bonus points."); tone(880, .2); break;
      case "finish": showResults(event.reason); break;
      case "pause": announce("Game paused."); break;
    }
  }
  function updateRecordKey() {
    recordKey = `${mode}-${$("stationary").checked ? "stationary" : "falling"}`;
    $("best").textContent = number(records[recordKey] || 0);
  }
  function selectMode(selected) {
    mode = selected;
    $("arcade-mode").setAttribute("aria-pressed", String(mode === "arcade"));
    $("zen-mode").setAttribute("aria-pressed", String(mode === "zen"));
    $("timer").textContent = mode === "arcade" ? "1:30" : "∞";
    $("hearts").textContent = mode === "arcade" ? "♥ ♥ ♥" : "—";
    updateRecordKey();
  }
  function start() {
    player.startBackgroundMusic();
    document.body.classList.remove("home-screen");
    if (game.state.mode === "zen" && game.state.target) rememberBest();
    if (menu.open) menu.close();
    clearVisuals();
    savedResult = false;
    updateRecordKey();
    $("title-screen").hidden = true;
    $("results-screen").hidden = true;
    $("game-screen").hidden = false;
    document.body.classList.toggle("stationary", $("stationary").checked);
    lastFrame = null;
    game.start(mode, $("stationary").checked);
    game.setPlayfieldHeight(field.clientHeight);
    if (document.hidden) game.pause();
    lanes[0].focus({ preventScroll: true });
    render();
  }
  function rememberBest() {
    const isBest = game.state.score > (records[recordKey] || 0);
    if (isBest) {
      records[recordKey] = game.state.score;
      try { localStorage.setItem("pini.records.v1", JSON.stringify(records)); }
      catch { storageAvailable = false; }
    }
    return isBest;
  }
  function renderBoard(list, entries, isMine, emptyText) {
    list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "board-empty";
      empty.textContent = emptyText;
      list.append(empty);
      return;
    }
    for (const entry of entries) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const score = document.createElement("strong");
      name.textContent = entry.name;
      score.textContent = number(entry.score);
      item.append(name, score);
      if (isMine(entry)) item.classList.add("mine");
      list.append(item);
    }
  }
  function renderLocalBoard(category, mine = null) {
    renderBoard($("local-board"), localBoards[category] || [], entry => entry === mine, "No saved scores yet.");
  }
  async function loadGlobalBoard(category, token) {
    const list = $("global-board");
    renderBoard(list, [], () => false, "Loading…");
    try {
      const response = await fetch(`/api/scores?category=${encodeURIComponent(category)}`);
      if (!response.ok) throw new Error(response.status);
      const { scores } = await response.json();
      if (token === resultToken) renderBoard(list, scores, () => false, "No global scores yet. Be the first!");
    } catch {
      if (token === resultToken) renderBoard(list, [], () => false, "The global board is unavailable right now.");
    }
  }
  function prepareLeaderboards(score) {
    const token = ++resultToken;
    const category = recordKey;
    const canSubmit = Board.isValidCategory(category) && Board.isValidScore(score);
    $("score-form").hidden = !canSubmit;
    $("player-name").disabled = $("submit-score").disabled = false;
    $("player-name").value = playerName;
    $("score-form-status").textContent = "";
    $("score-form-error").textContent = "";
    $("results-screen").classList.remove("saved");
    $("leaderboards").hidden = !Board.isValidCategory(category);
    if ($("leaderboards").hidden) return canSubmit;
    renderLocalBoard(category);
    loadGlobalBoard(category, token);
    return canSubmit;
  }
  async function submitScore(event) {
    event.preventDefault();
    const token = resultToken;
    const name = $("player-name").value;
    const status = $("score-form-status");
    if (!Board.isValidName(name)) {
      $("score-form-error").textContent = "Use 1–12 letters or digits.";
      $("player-name").focus();
      return;
    }
    $("score-form-error").textContent = "";
    $("player-name").disabled = $("submit-score").disabled = true;
    // Once saved, the screen narrows to the boards and Play again.
    $("score-form").hidden = true;
    $("results-screen").classList.add("saved");
    $("retry").focus();
    const category = recordKey;
    const score = game.state.score;
    playerName = name;
    const entry = { name, score, at: Date.now() };
    const { board, rank: localRank } = Board.addEntry(localBoards[category] || [], entry);
    localBoards[category] = board;
    try {
      localStorage.setItem("pini.leaderboard.v1", JSON.stringify(localBoards));
      localStorage.setItem("pini.player.v1", name);
    } catch { storageAvailable = false; }
    renderLocalBoard(category, entry);
    const localText = localRank ? `#${localRank} in this browser` : "Saved in this browser";
    status.textContent = `${localText}. Sending to the global board…`;
    try {
      const response = await fetch("/api/scores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, score, category }),
      });
      if (!response.ok) throw new Error(response.status);
      const result = await response.json();
      if (token !== resultToken) return;
      renderBoard($("global-board"), result.scores, item => item.id === result.id, "No global scores yet.");
      status.textContent = `${localText}, #${number(result.rank)} worldwide.`;
    } catch {
      if (token !== resultToken) return;
      status.textContent = `${localText}. The global board is unavailable right now.`;
    }
    announce(status.textContent);
  }
  function showResults(reason) {
    if (savedResult) return;
    savedResult = true;
    clearVisuals();
    const s = game.state;
    const isBest = rememberBest();
    $("game-screen").hidden = true;
    $("results-screen").hidden = false;
    $("result-title").textContent = reason === "hearts" ? "Out of hearts. Another try?" : "90 seconds. Nicely caught!";
    $("final-score").textContent = number(s.score);
    $("personal-best").textContent = `${isBest ? "✦ New personal best!" : "Personal best:"} ${number(records[recordKey] || 0)}`;
    $("result-combo").textContent = s.bestCombo;
    $("result-waves").textContent = `${s.wavesCompleted} / 6`;
    $("result-catches").textContent = s.correct;
    $("result-mistakes").textContent = s.mistakes;
    $("result-record-note").textContent = storageAvailable ? "Records belong to this browser." : "Storage is unavailable. This record lasts for this visit only.";
    const canSubmit = prepareLeaderboards(s.score);
    render();
    announce(`Run finished. Score ${s.score}. ${isBest ? "New personal best." : ""}`);
    // Avoid raising the on-screen keyboard on touch devices.
    if (canSubmit && matchMedia("(pointer: fine)").matches) $("player-name").focus();
    else $("retry").focus();
  }
  function home() {
    document.body.classList.add("home-screen");
    // Zen has no end condition; retain its record when leaving a session.
    if (game.state.mode === "zen" && game.state.target) rememberBest();
    game.reset(mode, $("stationary").checked);
    if (menu.open) menu.close();
    clearVisuals();
    $("title-screen").hidden = false;
    $("game-screen").hidden = true;
    $("results-screen").hidden = true;
    document.body.style.backgroundColor = "#fff5e9";
    document.body.classList.remove("fever", "paused", "stationary");
    selectMode(mode);
    $("score").textContent = "0";
    $("play").focus();
  }
  function openMenu() {
    if (menu.open) return;
    game.pause();
    $("pause-note").textContent = game.state.phase === "paused" ? "Gameplay is paused." : "Choose your sound and mode.";
    $("resume").textContent = game.state.phase === "paused" ? "Resume →" : "Close menu";
    $("restart").hidden = !["paused", "results"].includes(game.state.phase);
    menu.showModal();
    $("menu-button").setAttribute("aria-expanded", "true");
    render();
  }
  function renderObjects() {
    const s = game.state;
    const ids = new Set(s.objects.map(object => object.id));
    for (const [id, node] of objectNodes) {
      if (!ids.has(id)) { node.remove(); objectNodes.delete(id); }
    }
    for (const object of s.objects) {
      let node = objectNodes.get(object.id);
      if (!node) {
        node = document.createElement("button");
        node.type = "button";
        node.className = `game-object ${object.kind}`;
        node.textContent = object.emoji;
        node.tabIndex = -1;
        node.setAttribute("aria-label", `${object.kind === "bomb" ? "Bomb, avoid" : "Emoji"} ${object.emoji}, lane ${object.lane + 1}`);
        node.addEventListener("pointerdown", event => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          game.resolve(object.id, true);
          render();
        });
        node.addEventListener("click", () => {
          // Assistive technology can activate a button without a pointer event.
          game.resolve(object.id, true);
          render();
        });
        objectNodes.set(object.id, node);
        field.append(node);
      }
      node.style.left = `${(object.lane + .5) * 25}%`;
      node.style.top = `${s.stationary ? Math.max(8, (field.clientHeight - 58) / 2) : 4 + object.age / object.travel * Math.max(0, field.clientHeight - 66)}px`;
      node.disabled = s.phase !== "playing";
    }
    for (const [lane, button] of lanes.entries()) {
      const object = game.catchable(lane);
      button.classList.toggle("ready", Boolean(object));
      button.querySelector(".lane-emoji").textContent = object?.emoji || "—";
      button.setAttribute("aria-label", `Catch lane ${lane + 1}: ${object?.emoji || "empty"}${object?.kind === "bomb" ? ", bomb, avoid" : ""}`);
    }
  }
  function render() {
    const s = game.state;
    $("score").textContent = number(s.score);
    $("best").textContent = number(records[recordKey] || 0);
    if (s.phase === "title") {
      selectMode(mode);
      return;
    }
    $("timer").textContent = s.mode === "zen" ? "∞" : `${Math.floor(Math.ceil((90000 - s.elapsed) / 1000) / 60)}:${String(Math.ceil((90000 - s.elapsed) / 1000) % 60).padStart(2, "0")}`;
    $("hearts").textContent = s.mode === "zen" ? "—" : "♥ ".repeat(s.hearts).trim() || "♡ ♡ ♡";
    $("hearts").setAttribute("aria-label", s.mode === "zen" ? "Unlimited lives" : `${s.hearts} hearts`);
    document.body.classList.toggle("fever", s.feverTime > 0 && !["title", "results"].includes(s.phase));
    document.body.classList.toggle("paused", s.phase !== "playing");
    if (!s.target) return;
    $("wordmark").textContent = displayWord(s.target.word);
    $("target-emoji").textContent = s.target.emoji;
    $("instruction").textContent = s.mode === "zen" ? `Catch ${s.target.emoji}. Take your time.` : `Catch ${s.target.emoji}. Avoid the others.`;
    $("wave-label").textContent = s.mode === "zen" ? "Zen · just for joy" : `Wave ${s.wave + 1} / 6`;
    $("wave-goal").textContent = s.mode === "zen" ? "Every catch counts" : s.waveAwarded ? "Goal complete! +500" : `Goal: ${s.waveCatches} / ${PiniGame.WAVES[s.wave].goal} · +500`;
    $("combo").textContent = `${s.combo} combo · ×${PiniGame.multiplier(s.combo)}`;
    $("combo").classList.toggle("hot", s.combo >= 10);
    $("fever-label").textContent = s.feverTime ? `✦ Fever! ×2 · ${(s.feverTime / 1000).toFixed(1)}s` : `Fever ${s.feverCharge} / 20`;
    $("fever-meter").max = s.feverTime ? 8000 : 20;
    $("fever-meter").value = s.feverTime || s.feverCharge;
    $("fever-meter").setAttribute("aria-label", s.feverTime ? "Fever time remaining" : "Fever charge");
    $("combo").hidden = s.mode === "zen";
    $("fever-label").hidden = s.mode === "zen";
    $("fever-meter").hidden = s.mode === "zen";
    const overlay = $("announcement");
    overlay.hidden = !["wave", "resume", "paused"].includes(s.phase) || menu.open;
    const signature = `${s.phase}-${s.wave}-${s.target.emoji}-${Math.ceil((s.resumeTime || 0) / 1000)}`;
    if (!overlay.hidden && signature !== overlaySignature) {
      overlaySignature = signature;
      overlay.replaceChildren();
      if (s.phase === "paused") {
        overlay.append("Paused");
        const button = document.createElement("button");
        button.className = "primary";
        button.textContent = "Resume →";
        button.addEventListener("click", () => { game.resume(); lastFrame = null; render(); lanes[0].focus(); });
        overlay.append(button);
      } else if (s.phase === "resume") {
        overlay.append(`Ready? ${Math.ceil(s.resumeTime / 1000)}`);
      } else {
        overlay.append(s.mode === "zen" ? "A little Zen" : `Wave ${s.wave + 1} / 6`);
        const small = document.createElement("small");
        small.textContent = `Catch ${s.target.emoji} · ${s.target.word}${s.mode === "arcade" ? ". Avoid the others." : ""}`;
        overlay.append(small);
      }
    }
    if (overlay.hidden) overlaySignature = "";
    renderObjects();
  }
  function animateVisuals(dt) {
    if (game.state.phase !== "playing") return;
    feedbackTime = Math.max(0, feedbackTime - dt);
    $("feedback").hidden = !feedbackTime;
    visuals = visuals.filter(visual => {
      visual.age += dt;
      if (visual.age >= visual.duration) { visual.node.remove(); return false; }
      const progress = visual.age / visual.duration;
      const still = game.state.stationary || motion.matches;
      visual.node.style.left = `${visual.x + (still ? 0 : visual.dx * progress)}px`;
      visual.node.style.top = `${visual.y + (still ? 0 : visual.dy * progress)}px`;
      visual.node.style.opacity = 1 - progress;
      return true;
    });
  }
  function frame(timestamp) {
    const dt = lastFrame === null ? 0 : timestamp - lastFrame;
    lastFrame = timestamp;
    if (!document.hidden && !menu.open) {
      game.advance(dt);
      animateVisuals(dt);
    }
    if (!["title", "results"].includes(game.state.phase)) render();
    requestAnimationFrame(frame);
  }
  $("arcade-mode").addEventListener("click", () => selectMode("arcade"));
  $("zen-mode").addEventListener("click", () => selectMode("zen"));
  $("stationary").addEventListener("change", updateRecordKey);
  $("play").addEventListener("click", start);
  $("retry").addEventListener("click", start);
  $("score-form").addEventListener("submit", submitScore);
  $("player-name").addEventListener("input", event => {
    const clean = Board.cleanName(event.target.value);
    if (clean !== event.target.value) event.target.value = clean;
  });
  $("restart").addEventListener("click", start);
  $("result-home").addEventListener("click", home);
  $("return-title").addEventListener("click", home);
  $("brand").addEventListener("click", event => { event.preventDefault(); openMenu(); });
  $("menu-button").addEventListener("click", openMenu);
  $("resume").addEventListener("click", () => menu.close());
  menu.addEventListener("close", () => {
    $("menu-button").setAttribute("aria-expanded", "false");
    if (!document.hidden) game.resume();
    lastFrame = null;
    if (game.state.phase === "resume") announce("Resuming in three seconds.");
    if (["resume", "playing", "wave"].includes(game.state.phase)) lanes[0].focus();
    else if (game.state.phase === "title") $("play").focus();
    else if (game.state.phase === "results") $("retry").focus();
    else $("menu-button").focus();
    render();
  });
  for (const button of lanes) button.addEventListener("click", () => { game.catchLane(Number(button.dataset.lane)); render(); });
  document.addEventListener("keydown", event => {
    if (menu.open || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
    if (["1", "2", "3", "4"].includes(event.key) && !event.repeat && game.state.phase === "playing") {
      event.preventDefault();
      game.catchLane(Number(event.key) - 1);
      render();
    } else if ((event.key === "Escape" || event.key.toLowerCase() === "p") && ["playing", "wave", "resume", "paused"].includes(game.state.phase)) openMenu();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) game.pause();
    lastFrame = null;
    render();
  });
  window.addEventListener("blur", () => { game.pause(); lastFrame = null; render(); });
  motion.addEventListener("change", event => {
    if (game.state.phase === "title") {
      $("stationary").checked = event.matches;
      updateRecordKey();
    } else if (event.matches && !game.state.stationary && game.state.phase !== "results") {
      // Keep the current record category intact; the next run defaults to stationary.
      game.pause();
      $("stationary").checked = true;
      feedback("Reduced motion is available from the title.");
      announce("Game paused. Select stationary targets from the title for reduced motion.");
      render();
    }
  });
  updateRecordKey();
  new ResizeObserver(() => game.setPlayfieldHeight(field.clientHeight)).observe(field);
  requestAnimationFrame(frame);
})();
