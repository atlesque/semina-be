function createAudioPlayerController({
  audioElement,
  playerElement,
  visualizer,
  tracks,
  playlistElement,
  isEnabled = () => true,
}) {
  let currentTrackIndex = 0;

  function startBackgroundMusic() {
    if (!isEnabled()) return;
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

  function updatePlaylistSelection() {
    [...playlistElement.querySelectorAll("button")].forEach(
      (button, index) => {
        button.setAttribute(
          "aria-current",
          index === currentTrackIndex ? "true" : "false",
        );
      },
    );
  }

  function loadTrack(index, { autoplay = true } = {}) {
    currentTrackIndex = (index + tracks.length) % tracks.length;
    audioElement.src = tracks[currentTrackIndex].src;
    audioElement.loop = false;
    audioElement.load();
    updatePlaylistSelection();
    if (autoplay) startBackgroundMusic();
  }

  tracks.forEach((track, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = track.title;
    button.setAttribute("aria-current", "false");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      loadTrack(index);
      visualizer.enableFromUserGesture();
    });
    playlistElement.append(button);
  });

  playerElement.addEventListener("pointerdown", (event) => {
    visualizer.enableFromUserGesture();
    event.stopPropagation();
  });
  audioElement.addEventListener("ended", () => loadTrack(currentTrackIndex + 1));
  updatePlaylistSelection();
  return { startBackgroundMusic };
}

window.PiniAudioPlayer = { createAudioPlayerController };
