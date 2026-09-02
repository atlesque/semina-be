function createAudioPlayerController({
  audioElement,
  playerElement,
  loopButton,
  visualizer,
}) {
  function startBackgroundMusic() {
    const playback = audioElement.play();
    if (!playback || typeof playback.then !== "function") return;

    playback
      .then(() => {
        window.removeEventListener("pointerdown", unlockBackgroundMusic);
      })
      .catch(() => {
        // Browsers may require a user gesture before allowing audible autoplay.
      });
  }

  function unlockBackgroundMusic() {
    startBackgroundMusic();
    visualizer.enableFromUserGesture();
  }

  function updateLoopControl() {
    const isLooping = audioElement.loop;
    loopButton.setAttribute("aria-pressed", String(isLooping));
    loopButton.setAttribute(
      "aria-label",
      isLooping ? "Disable looping" : "Enable looping",
    );
    loopButton.setAttribute(
      "title",
      isLooping ? "Disable looping" : "Enable looping",
    );
  }

  playerElement.addEventListener("pointerdown", (event) => {
    visualizer.enableFromUserGesture();
    event.stopPropagation();
  });
  loopButton.addEventListener("click", (event) => {
    event.stopPropagation();
    audioElement.loop = !audioElement.loop;
    updateLoopControl();
  });
  updateLoopControl();
  window.addEventListener("load", startBackgroundMusic, { once: true });
  window.addEventListener("pointerdown", unlockBackgroundMusic, {
    once: true,
    passive: true,
  });
}

window.PiniAudioPlayer = { createAudioPlayerController };
