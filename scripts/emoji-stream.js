function createEmojiStream({ container }) {
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SPAWN_INTERVAL_MS = 520;
  let activeEmoji = "✨";
  let spawnTimer = null;

  function spawnEmoji() {
    if (reducedMotionQuery.matches) return;

    const emoji = document.createElement("span");
    emoji.className = "scrolling-emoji";
    emoji.textContent = activeEmoji;
    emoji.style.setProperty("--emoji-top", `${8 + Math.random() * 84}%`);
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
    emoji.addEventListener("animationend", () => emoji.remove(), {
      once: true,
    });
  }

  function setEmoji(emoji) {
    activeEmoji = emoji || "✨";
    spawnEmoji();

    if (spawnTimer === null) {
      spawnTimer = window.setInterval(spawnEmoji, SPAWN_INTERVAL_MS);
    }
  }

  setEmoji(activeEmoji);

  return { setEmoji };
}

window.PiniEmojiStream = { createEmojiStream };
