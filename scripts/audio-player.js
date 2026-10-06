function createAudioPlayerController({
  audioElement,
  playerElement,
  visualizer,
  tracks,
  backgroundTrack,
  playlistElement,
  isEnabled = () => true,
}) {
  let currentTrackIndex = 0;
  // The looping menu theme plays until gameplay hands over to the playlist.
  let playingPlaylist = !backgroundTrack;

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
          playingPlaylist && index === currentTrackIndex ? "true" : "false",
        );
      },
    );
  }

  function loadTrack(index, { autoplay = true } = {}) {
    playingPlaylist = true;
    currentTrackIndex = (index + tracks.length) % tracks.length;
    audioElement.src = tracks[currentTrackIndex].src;
    audioElement.loop = false;
    audioElement.load();
    updatePlaylistSelection();
    if (autoplay) startBackgroundMusic();
  }

  function playBackgroundTheme() {
    if (!backgroundTrack) return;
    if (!playingPlaylist) return startBackgroundMusic();
    playingPlaylist = false;
    audioElement.src = backgroundTrack.src;
    audioElement.loop = true;
    audioElement.load();
    updatePlaylistSelection();
    startBackgroundMusic();
  }

  function playPlaylist() {
    if (playingPlaylist) return startBackgroundMusic();
    loadTrack(currentTrackIndex);
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
  audioElement.addEventListener("ended", () => {
    if (playingPlaylist) loadTrack(currentTrackIndex + 1);
  });
  if (backgroundTrack) {
    audioElement.src = backgroundTrack.src;
    audioElement.loop = true;
  }
  updatePlaylistSelection();
  return { startBackgroundMusic, playBackgroundTheme, playPlaylist };
}

window.PiniAudioPlayer = { createAudioPlayerController };
