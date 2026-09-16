function createEmojiStream({ container, onEmojiClick }) {
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SPAWN_INTERVAL_MS = 520;
  let activeEmoji = "✨";
  let spawnTimer = null;
  let specialEmojiTimer = null;
  let specialEmojis = [];

  function spawnEmoji(emojiOverride = activeEmoji, className = "") {
    if (reducedMotionQuery.matches) return;

    const emoji = document.createElement("span");
    emoji.className = `scrolling-emoji ${className}`.trim();
    emoji.textContent = emojiOverride;
    emoji.style.setProperty("--emoji-left", `${4 + Math.random() * 92}%`);
    emoji.style.setProperty(
      "--emoji-size",
      `${1.35 + Math.random() * 1.45}rem`,
    );
    emoji.style.setProperty(
      "--emoji-duration",
      `${10 + Math.random() * 6}s`,
    );
    emoji.style.setProperty(
      "--emoji-rotation-start",
      `${(Math.random() - 0.5) * 18}deg`,
    );
    emoji.style.setProperty(
      "--emoji-rotation-end",
      `${(Math.random() - 0.5) * 18}deg`,
    );
    container.appendChild(emoji);
    emoji.style.setProperty(
      "--emoji-travel",
      `${container.clientHeight + emoji.offsetHeight + 16}px`,
    );
    emoji.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (emoji.dataset.removing === "true") return;

      emoji.dataset.removing = "true";
      emoji.classList.add("emoji-fade-out");
      onEmojiClick?.(event, emojiOverride);
      window.setTimeout(() => emoji.remove(), EMOJI_FADE_OUT_MS);
    });
    emoji.addEventListener("animationend", () => emoji.remove(), {
      once: true,
    });
  }

  const EMOJI_FADE_OUT_MS = 100;

  function setEmoji(emoji) {
    activeEmoji = emoji || "✨";
    spawnEmoji();

    if (spawnTimer === null) {
      spawnTimer = window.setInterval(spawnEmoji, SPAWN_INTERVAL_MS);
    }
  }

  function spawnSpecialEmoji() {
    if (!specialEmojis.length) return;
    const emoji = specialEmojis[Math.floor(Math.random() * specialEmojis.length)];
    spawnEmoji(emoji, "special-scrolling-emoji");
  }

  function setSpecialEmojiActive(isActive) {
    if (!isActive || !specialEmojis.length) {
      if (specialEmojiTimer !== null) {
        window.clearInterval(specialEmojiTimer);
        specialEmojiTimer = null;
      }
      return;
    }

    if (specialEmojiTimer !== null) return;
    spawnSpecialEmoji();
    specialEmojiTimer = window.setInterval(spawnSpecialEmoji, 620);
  }

  function setSpecialEmojis(emojis) {
    specialEmojis = Array.isArray(emojis) ? emojis.filter(Boolean) : [];
  }

  function reset() {
    if (spawnTimer !== null) {
      window.clearInterval(spawnTimer);
      spawnTimer = null;
    }
    if (specialEmojiTimer !== null) {
      window.clearInterval(specialEmojiTimer);
      specialEmojiTimer = null;
    }
    container.replaceChildren();
    activeEmoji = "✨";
    setEmoji(activeEmoji);
  }

  setEmoji(activeEmoji);

  return { setEmoji, setSpecialEmojis, setSpecialEmojiActive, reset };
}

window.PiniEmojiStream = { createEmojiStream };
