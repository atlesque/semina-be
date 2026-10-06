function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(value, edge0, edge1) {
  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] =
    segment < 1
      ? [chroma, x, 0]
      : segment < 2
        ? [x, chroma, 0]
        : segment < 3
          ? [0, chroma, x]
          : segment < 4
            ? [0, x, chroma]
            : segment < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const match = l - chroma / 2;

  return [red + match, green + match, blue + match].map((channel) =>
    Math.round(channel * 255),
  );
}

function mixWithWhite([red, green, blue], whiteAmount) {
  return [red, green, blue].map((channel) =>
    Math.round(channel + (255 - channel) * whiteAmount),
  );
}

function toRgba([red, green, blue], alpha) {
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(2)})`;
}

function averageBand(data, startRatio, endRatio) {
  const start = Math.floor(data.length * startRatio);
  const end = Math.max(
    start + 1,
    Math.min(data.length, Math.floor(data.length * endRatio)),
  );
  let total = 0;

  for (let index = start; index < end; index++) {
    total += data[index];
  }

  return total / (end - start) / 255;
}

function createAudioVisualizer({
  audioElement,
  targetElement,
  canvasElement,
}) {
  let audioContext = null;
  let analyser = null;
  let frequencyData = null;
  let loudnessAnalyser = null;
  let loudnessData = null;
  let loudnessHighpass = null;
  let loudnessShelf = null;
  let loudnessSilencer = null;
  let audioSource = null;
  let isAvailable = false;
  let animationFrame = null;
  let viewportWidth = 1;
  let viewportHeight = 1;
  const renderScale = 0.5;
  const canvasContext = canvasElement.getContext("2d");
  let glowVisibility = 0;
  let targetGlowVisibility = 0;
  let lastFrameTime = 0;
  // Measured from ResizeObserver callbacks, which run right after layout. Reading the
  // rect in every animation frame forced a synchronous layout whenever the game had
  // just changed the DOM.
  let textBounds = targetElement.getBoundingClientRect();
  let lastLoudnessTime = 0;
  let loudnessEnergy = 0;
  let lufs = -Infinity;
  // Web Audio does not expose LUFS directly, so use a BS.1770-style
  // K-weighted signal and a short-term window for visual modulation.
  const lufsFloor = -48;
  const lufsCeiling = -6;
  const lufsWindow = 400;
  let lastGlow = {
    colors: [
      [255, 255, 255],
      [255, 255, 255],
      [255, 255, 255],
    ],
    alpha: 0.52,
    centerX: 0,
    centerY: 0,
    radius: 100,
    spread: 16,
  };

  function isPlaying() {
    return (
      !audioElement.paused &&
      !audioElement.ended &&
      audioElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    );
  }

  function resizeCanvas() {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    canvasElement.width = Math.max(1, Math.floor(viewportWidth * renderScale));
    canvasElement.height = Math.max(
      1,
      Math.floor(viewportHeight * renderScale),
    );
  }

  function clearCanvas() {
    canvasContext.clearRect(0, 0, canvasElement.width, canvasElement.height);
  }

  function drawHalo(color, centerX, centerY, radius, alpha) {
    const gradient = canvasContext.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      radius,
    );
    gradient.addColorStop(0, toRgba(color, alpha));
    gradient.addColorStop(0.18, toRgba(color, alpha * 0.62));
    gradient.addColorStop(0.56, toRgba(color, alpha * 0.16));
    gradient.addColorStop(1, toRgba(color, 0));
    canvasContext.fillStyle = gradient;
    canvasContext.fillRect(0, 0, canvasElement.width, canvasElement.height);
  }

  function readLufs(timestamp) {
    loudnessAnalyser.getFloatTimeDomainData(loudnessData);
    let blockEnergy = 0;

    for (let index = 0; index < loudnessData.length; index++) {
      const sample = loudnessData[index];
      blockEnergy += sample * sample;
    }

    blockEnergy /= loudnessData.length;
    const elapsed = lastLoudnessTime
      ? Math.min(100, timestamp - lastLoudnessTime)
      : 16;
    const smoothing = 1 - Math.exp(-elapsed / lufsWindow);
    loudnessEnergy += (blockEnergy - loudnessEnergy) * smoothing;
    lastLoudnessTime = timestamp;
    lufs = loudnessEnergy > 1e-9 ? 10 * Math.log10(loudnessEnergy) : -Infinity;

    const lufsActivity = clamp(
      (lufs - lufsFloor) / (lufsCeiling - lufsFloor),
      0,
      1,
    );

    return {
      activity: lufsActivity,
      gate: smoothStep(lufsActivity, 0.015, 0.16),
    };
  }

  function readGlowState(timestamp) {
    const { activity: lufsActivity, gate: lufsGate } = readLufs(timestamp);
    analyser.getByteFrequencyData(frequencyData);
    let totalEnergy = 0;
    let weightedFrequency = 0;
    let peakEnergy = 0;

    for (let index = 0; index < frequencyData.length; index++) {
      const energy = frequencyData[index] / 255;
      const frequencyRatio = index / Math.max(1, frequencyData.length - 1);
      totalEnergy += energy;
      weightedFrequency += energy * frequencyRatio;
      peakEnergy = Math.max(peakEnergy, energy);
    }

    const averageEnergy = totalEnergy / frequencyData.length;
    const rawIntensity =
      Math.pow(averageEnergy, 0.48) * 2 + peakEnergy * 0.25;
    const spectrumIntensity = clamp(
      rawIntensity <= 0.8
        ? rawIntensity
        : 0.8 + (rawIntensity - 0.8) * 0.3,
      0,
      1,
    );
    const intensity = clamp(
      spectrumIntensity * (0.38 + lufsActivity * 0.62) + lufsActivity * 0.12,
      0,
      1,
    );
    const spectralCentroid = totalEnergy
      ? weightedFrequency / totalEnergy
      : 0;
    let weightedSpread = 0;

    for (let index = 0; index < frequencyData.length; index++) {
      const energy = frequencyData[index] / 255;
      const frequencyRatio = index / Math.max(1, frequencyData.length - 1);
      weightedSpread +=
        energy * Math.pow(frequencyRatio - spectralCentroid, 2);
    }

    const spectralSpread = totalEnergy
      ? Math.sqrt(weightedSpread / totalEnergy)
      : 0;
    const spreadScore = clamp((spectralSpread - 0.04) / 0.22, 0, 1);
    const highFrequencyScore = clamp(
      (averageBand(frequencyData, 0.62, 1) - 0.02) / 0.2,
      0,
      1,
    );
    const spectrumColorMix = clamp(
      spreadScore * 0.8 + highFrequencyScore * 0.6,
      0,
      1,
    );
    const colorfulness = clamp(
      spectrumColorMix * (0.55 + intensity * 0.8),
      0,
      1,
    );
    const baseHue = (spectralCentroid * 360 + highFrequencyScore * 40) % 360;
    const colors = [
      hslToRgb(baseHue, 100, 58),
      hslToRgb((baseHue + 120) % 360, 100, 58),
      hslToRgb((baseHue + 240) % 360, 100, 58),
    ].map((color) => mixWithWhite(color, 1 - colorfulness));
    const glowAlpha = (0.52 + intensity * 0.48) * lufsGate;
    const textCenterX = ((textBounds.left + textBounds.right) / 2) * renderScale;
    const textCenterY = ((textBounds.top + textBounds.bottom) / 2) * renderScale;
    const radius =
      Math.min(viewportWidth, viewportHeight) *
      (0.2 + intensity * 0.42) *
      renderScale;
    const spread = radius * 0.16;

    return {
      colors,
      alpha: glowAlpha,
      centerX: textCenterX,
      centerY: textCenterY,
      radius,
      spread,
    };
  }

  function drawGlow(
    { colors, alpha, centerX, centerY, radius, spread },
    opacity,
  ) {
    canvasContext.globalCompositeOperation = "screen";
    drawHalo(
      colors[0],
      centerX - spread,
      centerY,
      radius,
      alpha * opacity,
    );
    drawHalo(
      colors[1],
      centerX + spread,
      centerY - spread * 0.45,
      radius * 0.92,
      alpha * 0.72 * opacity,
    );
    drawHalo(
      colors[2],
      centerX,
      centerY + spread * 0.65,
      radius * 0.8,
      alpha * 0.55 * opacity,
    );
    canvasContext.globalCompositeOperation = "source-over";
  }

  function renderGlow(timestamp) {
    const elapsed = lastFrameTime
      ? Math.min(100, timestamp - lastFrameTime)
      : 16;
    lastFrameTime = timestamp;
    const fadeDuration = targetGlowVisibility > glowVisibility ? 180 : 280;
    const fadeStep = 1 - Math.exp(-elapsed / fadeDuration);
    glowVisibility +=
      (targetGlowVisibility - glowVisibility) * fadeStep;

    if (isPlaying() && isAvailable) {
      lastGlow = readGlowState(timestamp);
    }

    clearCanvas();
    if (glowVisibility > 0.001) {
      drawGlow(lastGlow, glowVisibility);
    }

    const isFading = Math.abs(targetGlowVisibility - glowVisibility) > 0.001;
    if (targetGlowVisibility > 0 || isFading) {
      animationFrame = requestAnimationFrame(renderGlow);
      return;
    }

    animationFrame = null;
    lastFrameTime = 0;
  }

  function scheduleRender() {
    if (animationFrame === null) {
      animationFrame = requestAnimationFrame(renderGlow);
    }
  }

  async function enableFromUserGesture() {
    if (isAvailable) {
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => {});
      }
      targetGlowVisibility = isPlaying() ? 1 : 0;
      scheduleRender();
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      audioContext = new AudioContextClass();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      if (audioContext.state !== "running") {
        audioContext.close().catch(() => {});
        audioContext = null;
        return;
      }

      analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.82;
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      loudnessHighpass = audioContext.createBiquadFilter();
      loudnessHighpass.type = "highpass";
      loudnessHighpass.frequency.value = 38;
      loudnessHighpass.Q.value = 0.5;
      loudnessShelf = audioContext.createBiquadFilter();
      loudnessShelf.type = "highshelf";
      loudnessShelf.frequency.value = 1680;
      loudnessShelf.gain.value = 4;
      loudnessAnalyser = audioContext.createAnalyser();
      loudnessAnalyser.fftSize = 1024;
      loudnessAnalyser.smoothingTimeConstant = 0;
      loudnessData = new Float32Array(loudnessAnalyser.fftSize);
      loudnessSilencer = audioContext.createGain();
      loudnessSilencer.gain.value = 0;
      audioSource = audioContext.createMediaElementSource(audioElement);
      audioSource.connect(analyser);
      analyser.connect(audioContext.destination);
      audioSource.connect(loudnessHighpass);
      loudnessHighpass.connect(loudnessShelf);
      loudnessShelf.connect(loudnessAnalyser);
      loudnessAnalyser.connect(loudnessSilencer);
      loudnessSilencer.connect(audioContext.destination);
      isAvailable = true;
      targetGlowVisibility = isPlaying() ? 1 : 0;
      scheduleRender();
    } catch {
      const failedAudioContext = audioContext;
      audioContext = null;
      analyser = null;
      frequencyData = null;
      loudnessAnalyser = null;
      loudnessData = null;
      loudnessHighpass = null;
      loudnessShelf = null;
      loudnessSilencer = null;
      audioSource = null;
      if (failedAudioContext && failedAudioContext.state !== "closed") {
        failedAudioContext.close().catch(() => {});
      }
      clearCanvas();
    }
  }

  function handlePlaying() {
    if (isAvailable) targetGlowVisibility = 1;
    scheduleRender();
  }

  function handleStopped() {
    targetGlowVisibility = 0;
    scheduleRender();
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  const measureTarget = () => {
    textBounds = targetElement.getBoundingClientRect();
  };
  const boundsObserver = new ResizeObserver(measureTarget);
  boundsObserver.observe(targetElement);
  boundsObserver.observe(document.documentElement);
  audioElement.addEventListener("playing", handlePlaying);
  audioElement.addEventListener("pause", handleStopped);
  audioElement.addEventListener("ended", handleStopped);
  clearCanvas();

  return { enableFromUserGesture };
}

window.PiniAudioVisualizer = { createAudioVisualizer };
