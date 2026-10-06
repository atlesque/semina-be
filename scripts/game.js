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
  const textCache = new WeakMap();
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
    backgroundTrack: { title: "Pini Arcade Theme", src: "audio/pini-arcade-theme.mp3" },
    tracks: [
      { title: "Pini — Metal Spark", src: "audio/pini-metal.mp3" },
      { title: "Semina — MBP Melody", src: "audio/semina-mbp-melody.mp3" },
      { title: "Get Well Soon", src: "audio/20260916-142727-77c9dd-web-small.mp3" },
      { title: "Pini Macedonini", src: "audio/pini-background.mp3" },
      { title: "Pini Arcade — Lounge", src: "audio/pini-arcade-lounge.mp3" },
      { title: "Pini Arcade — Attract Mode", src: "audio/pini-arcade-attract.mp3" },
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
  // Per-frame renders only touch the DOM when a value actually changes.
  function setText(node, text) {
    if (textCache.get(node) === text) return;
    textCache.set(node, text);
    node.textContent = text;
  }
  const still = () => game.state.stationary || motion.matches;
  // Restarts a one-shot CSS animation class.
  function kick(node, className) {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }
  function buzz(pattern) {
    if (effectsEnabled && !still()) navigator.vibrate?.(pattern);
  }
  function announce(message) { $("live-events").textContent = message; }
  function feedback(message) {
    $("feedback").textContent = message;
    $("feedback").hidden = false;
    kick($("feedback"), "pop");
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
    $("combo").classList.remove("pulse", "bump", "dropped");
    $("damage-flash").classList.remove("on");
    $("game-screen").classList.remove("shake");
  }
  function addVisual(className, x, y, duration, text = "") {
    const node = document.createElement("span");
    node.className = className;
    node.textContent = text;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.setAttribute("aria-hidden", "true");
    field.append(node);
    visuals.push({ node, age: 0, duration });
    return node;
  }
  function catchEffect(object, points) {
    const bounds = objectNodes.get(object.id)?.getBoundingClientRect();
    const fieldBounds = field.getBoundingClientRect();
    const x = bounds ? bounds.left + bounds.width / 2 - fieldBounds.left : field.clientWidth * (object.lane + .5) / 4;
    const y = bounds ? bounds.top + bounds.height / 2 - fieldBounds.top : field.clientHeight / 2;
    const fever = game.state.feverTime > 0;
    const tier = PiniGame.multiplier(game.state.combo);
    const popup = addVisual(`points${fever ? " fever" : tier > 1 ? ` x${tier}` : ""}`, x, Math.max(24, y), 750, `+${points}`);
    if (still()) { popup.dataset.fade = ""; return; }
    addVisual("catch-ring", x, y, 450);
    const count = fever ? 10 : tier > 2 ? 8 : 6;
    const glyphs = fever ? ["✦", "🔥", "💖"] : ["🌸", "✦", "🌼"];
    for (let i = 0; i < count; i++) {
      const angle = i * Math.PI * 2 / count + Math.random() * .4;
      const reach = 45 + Math.random() * 25 + (fever ? 15 : 0);
      const petal = addVisual("particle", x, y, 650, glyphs[i % 3]);
      petal.style.setProperty("--dx", `${Math.cos(angle) * reach}px`);
      petal.style.setProperty("--dy", `${Math.sin(angle) * reach}px`);
      petal.style.setProperty("--rot", `${(Math.random() - .5) * 240}deg`);
    }
  }
  function damageEffect() {
    kick($("damage-flash"), "on");
    kick($("hearts").parentElement, "hit");
    if (!still()) kick($("game-screen"), "shake");
    buzz(60);
  }
  // Each wave quickens the lane streaks a little.
  function setTempo() {
    const s = game.state;
    field.style.setProperty("--tempo", `${s.mode === "zen" ? 3 : 2.4 - s.wave * .32}s`);
    field.style.setProperty("--intensity", s.mode === "zen" ? .2 : .25 + s.wave * .08);
  }
  function handleEvent(event) {
    switch (event.type) {
      case "wave":
        clearVisuals();
        document.body.style.backgroundColor = palettes[game.state.wave];
        setTempo();
        announce(game.state.mode === "zen" ? `Zen mode. Catch ${event.target.word}, ${event.target.emoji}. Every catch counts.` : `Wave ${event.wave}. Catch ${event.target.word}, ${event.target.emoji}. Avoid the others.`);
        break;
      case "target": announce(`Catch ${event.target.word}, ${event.target.emoji}.`); break;
      case "catch":
        catchEffect(event.object, event.points);
        kick($("score"), "bump");
        if (game.state.mode !== "zen") kick($("combo"), "bump");
        tone(520 + Math.min(game.state.combo, 20) * 18);
        break;
      case "combo-break": feedback("Combo broken — keep going!"); kick($("combo"), "dropped"); break;
      case "milestone":
        feedback(`×${event.multiplier} multiplier!`);
        announce(`Combo multiplier ${event.multiplier}.`);
        $("combo").classList.remove("pulse");
        void $("combo").offsetWidth;
        $("combo").classList.add("pulse");
        tone(1040, .2);
        break;
      case "damage": feedback("Ouch! −1 heart"); announce(`${game.state.hearts} hearts remaining.`); damageEffect(); tone(160, .18); break;
      case "fever":
        feedback("FEVER! Double points ✦");
        announce("Fever! Double points for eight seconds.");
        buzz([30, 40, 30]);
        tone(1400, .3);
        break;
      case "wave-clear": feedback("Wave clear! +500 ✦"); announce("Wave catch goal complete. 500 bonus points."); tone(880, .2); break;
      case "finish": showResults(event.reason); break;
      case "pause": announce("Game paused."); break;
    }
  }
  function updateRecordKey() {
    recordKey = `${mode}-${$("stationary").checked ? "stationary" : "falling"}`;
    setText($("best"), number(records[recordKey] || 0));
  }
  function selectMode(selected) {
    mode = selected;
    $("arcade-mode").setAttribute("aria-pressed", String(mode === "arcade"));
    $("zen-mode").setAttribute("aria-pressed", String(mode === "zen"));
    setText($("timer"), mode === "arcade" ? "1:30" : "∞");
    setText($("hearts"), mode === "arcade" ? "♥ ♥ ♥" : "—");
    updateRecordKey();
  }
  function start() {
    player.playPlaylist();
    document.body.classList.remove("home-screen", "results-open");
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
    hideTrophy();
    $("leaderboards").hidden = !Board.isValidCategory(category);
    if ($("leaderboards").hidden) return canSubmit;
    // Each mode keeps its own boards, so name the mode to avoid reading a fresh board as a reset.
    const modeName = category.endsWith("-stationary") ? "Stationary" : "Falling";
    setText($("local-board-title"), `This browser · ${modeName}`);
    setText($("global-board-title"), `Global · ${modeName}`);
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
      showTrophy(result.rank);
    } catch {
      if (token !== resultToken) return;
      status.textContent = `${localText}. The global board is unavailable right now.`;
    }
    announce(status.textContent);
  }
  function showTrophy(rank) {
    const tier = Board.podiumTier(rank);
    if (!tier) return;
    const label = `${tier[0].toUpperCase()}${tier.slice(1)} trophy`;
    const figure = $("trophy");
    figure.className = `trophy ${tier}`;
    $("trophy-caption").textContent = `${label} · #${rank} worldwide`;
    $("trophy-canvas").setAttribute("aria-label", `${label} for finishing #${rank} on the global board`);
    figure.hidden = false;
    if (!PiniTrophy.show($("trophy-canvas"), tier, motion.matches)) figure.classList.add("flat");
  }
  function hideTrophy() {
    PiniTrophy.stop();
    $("trophy").hidden = true;
  }
  function showResults(reason) {
    if (savedResult) return;
    savedResult = true;
    clearVisuals();
    const s = game.state;
    const isBest = rememberBest();
    $("game-screen").hidden = true;
    $("results-screen").hidden = false;
    document.body.classList.add("results-open");
    $("result-title").textContent = reason === "hearts" ? "Out of hearts. Another try?" : "90 seconds. Nicely caught!";
    $("personal-best").textContent = `${isBest ? "✦ New personal best!" : "Personal best:"} ${number(records[recordKey] || 0)}`;
    $("result-combo").textContent = s.bestCombo;
    $("result-waves").textContent = `${s.wavesCompleted} / 6`;
    $("result-catches").textContent = s.correct;
    $("result-mistakes").textContent = s.mistakes;
    $("result-record-note").textContent = storageAvailable ? "Records belong to this browser." : "Storage is unavailable. This record lasts for this visit only.";
    const canSubmit = prepareLeaderboards(s.score);
    countUp($("final-score"), s.score);
    render();
    announce(`Run finished. Score ${s.score}. ${isBest ? "New personal best." : ""}`);
    // Avoid raising the on-screen keyboard on touch devices.
    if (canSubmit && matchMedia("(pointer: fine)").matches) $("player-name").focus();
    else $("retry").focus();
  }
  function countUp(node, value) {
    const token = resultToken;
    if (motion.matches || value < 100) { node.textContent = number(value); return; }
    const begin = performance.now();
    const tick = now => {
      // A newer results screen owns the node once resultToken moves on.
      if (token !== resultToken || $("results-screen").hidden) return;
      const progress = Math.min(1, (now - begin) / 900);
      node.textContent = number(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) requestAnimationFrame(tick);
    };
    node.textContent = "0";
    requestAnimationFrame(tick);
  }
  function home() {
    player.playBackgroundTheme();
    document.body.classList.add("home-screen");
    document.body.classList.remove("results-open");
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
    setText($("score"), "0");
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
    const height = field.clientHeight;
    const sway = !still();
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
      // Transforms keep falling objects on the compositor instead of re-running layout each frame.
      const y = s.stationary ? Math.max(8, (height - 58) / 2) : 4 + object.age / object.travel * Math.max(0, height - 66);
      const tilt = sway ? Math.sin(object.age / 260 + object.id) * 7 : 0;
      node.style.transform = `translate3d(-50%, ${y.toFixed(1)}px, 0) rotate(${tilt.toFixed(1)}deg)`;
      node.disabled = s.phase !== "playing";
    }
    const ready = new Set();
    for (const [lane, button] of lanes.entries()) {
      const object = game.catchable(lane);
      if (object) ready.add(object.id);
      setText(button.querySelector(".lane-emoji"), object?.emoji || "—");
      const label = `Catch lane ${lane + 1}: ${object?.emoji || "empty"}${object?.kind === "bomb" ? ", bomb, avoid" : ""}`;
      if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    }
    for (const [id, node] of objectNodes) node.classList.toggle("in-zone", ready.has(id));
  }
  function render() {
    const s = game.state;
    setText($("score"), number(s.score));
    setText($("best"), number(records[recordKey] || 0));
    if (s.phase === "title") {
      selectMode(mode);
      return;
    }
    const secondsLeft = Math.ceil((90000 - s.elapsed) / 1000);
    setText($("timer"), s.mode === "zen" ? "∞" : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`);
    $("timer").parentElement.classList.toggle("urgent", s.mode === "arcade" && s.phase === "playing" && secondsLeft <= 10);
    $("hearts").parentElement.classList.toggle("critical", s.mode === "arcade" && s.hearts === 1);
    setText($("hearts"), s.mode === "zen" ? "—" : "♥ ".repeat(s.hearts).trim() || "♡ ♡ ♡");
    $("hearts").setAttribute("aria-label", s.mode === "zen" ? "Unlimited lives" : `${s.hearts} hearts`);
    document.body.classList.toggle("fever", s.feverTime > 0 && !["title", "results"].includes(s.phase));
    document.body.classList.toggle("paused", s.phase !== "playing");
    if (!s.target) return;
    const word = displayWord(s.target.word);
    if (textCache.get($("wordmark")) !== word && !still()) kick($("wordmark"), "enter");
    setText($("wordmark"), word);
    setText($("target-emoji"), s.target.emoji);
    setText($("instruction"), s.mode === "zen" ? `Catch ${s.target.emoji}. Take your time.` : `Catch ${s.target.emoji}. Avoid the others.`);
    setText($("wave-label"), s.mode === "zen" ? "Zen · just for joy" : `Wave ${s.wave + 1} / 6`);
    setText($("wave-goal"), s.mode === "zen" ? "Every catch counts" : s.waveAwarded ? "Goal complete! +500" : `Goal: ${s.waveCatches} / ${PiniGame.WAVES[s.wave].goal} · +500`);
    setText($("combo"), `${s.combo} combo · ×${PiniGame.multiplier(s.combo)}`);
    $("combo").classList.toggle("hot", s.combo >= 10);
    setText($("fever-label"), s.feverTime ? `✦ Fever! ×2 · ${(s.feverTime / 1000).toFixed(1)}s` : `Fever ${s.feverCharge} / 20`);
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
      if (!still()) kick(overlay, "enter");
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
      // CSS animates movement; without motion the popup simply fades in place.
      if ("fade" in visual.node.dataset) visual.node.style.opacity = 1 - visual.age / visual.duration;
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
  // Lanes only light up when pressed: a bright flash on a catch, a dull one on an empty hit zone.
  function pressLane(lane) {
    if (game.state.phase !== "playing") return;
    const button = lanes[lane];
    button.classList.remove("hit", "miss");
    kick(button, game.catchable(lane) ? "hit" : "miss");
    game.catchLane(lane);
    render();
  }
  for (const button of lanes) button.addEventListener("click", () => pressLane(Number(button.dataset.lane)));
  document.addEventListener("keydown", event => {
    if (menu.open || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
    if (["1", "2", "3", "4"].includes(event.key) && !event.repeat && game.state.phase === "playing") {
      event.preventDefault();
      pressLane(Number(event.key) - 1);
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
