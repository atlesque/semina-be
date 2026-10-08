// Browser fingerprint sent with each global score so the admin can spot bots and repeat cheaters.
// It collects signals that stay the same across visits and cleared storage for one browser on one
// device (rendering quirks of the GPU, audio stack and installed fonts, plus screen, locale and
// hardware hints). The server hashes them into the fingerprint ID (functions/api/scores.js), so the
// raw signals stay readable on the admin details screen. A determined cheater can still spoof all of
// this; the point is to make casual repeat abuse and simple bots stand out.
(function (root) {
  "use strict";
  const TIMEOUT_MS = 1500;
  const FONT_CANDIDATES = [
    "Arial", "Arial Narrow", "Avenir", "Bahnschrift", "Calibri", "Cambria", "Candara", "Comic Sans MS",
    "Consolas", "Courier New", "DejaVu Sans", "Futura", "Georgia", "Gill Sans", "Helvetica Neue",
    "Impact", "Liberation Sans", "Lucida Grande", "Menlo", "Monaco", "Noto Sans", "Optima", "Palatino",
    "Roboto", "Segoe UI", "SF Pro Text", "Tahoma", "Trebuchet MS", "Ubuntu", "Verdana",
  ];

  // FNV-1a, 32-bit, as hex: enough to shrink canvas and audio output to a short comparable value.
  function shortHash(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  const attempt = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

  function canvasSignal() {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f60";
    ctx.fillRect(100, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.font = "15px 'Arial'";
    ctx.fillText("Pini Arcade ⭐ 🍓 Ωж", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.font = "18px 'Times New Roman'";
    ctx.fillText("Pini Arcade ⭐ 🍓 Ωж", 4, 45);
    ctx.globalCompositeOperation = "multiply";
    for (const [color, x] of [["#f2f", 40], ["#2ff", 80], ["#ff2", 60]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, 30, 25, 0, Math.PI * 2);
      ctx.fill();
    }
    return shortHash(canvas.toDataURL());
  }

  function webglSignal() {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return { webglVendor: null, webglRenderer: null, webglParams: null };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const params = [
      gl.MAX_TEXTURE_SIZE, gl.MAX_RENDERBUFFER_SIZE, gl.MAX_VERTEX_ATTRIBS, gl.MAX_VERTEX_UNIFORM_VECTORS,
      gl.MAX_FRAGMENT_UNIFORM_VECTORS, gl.MAX_VARYING_VECTORS, gl.MAX_TEXTURE_IMAGE_UNITS,
      gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS, gl.ALIASED_LINE_WIDTH_RANGE, gl.ALIASED_POINT_SIZE_RANGE,
      gl.MAX_VIEWPORT_DIMS,
    ].map(param => String(attempt(() => [...[].concat(gl.getParameter(param))].join("x"), "")));
    const extensions = (gl.getSupportedExtensions() || []).slice().sort();
    return {
      webglVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      webglRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      webglParams: shortHash(`${params.join("|")}#${extensions.join(",")}`),
    };
  }

  // Renders a fixed oscillator through a compressor offline; the floating-point output differs
  // between audio stacks and CPUs. No sound plays and no user gesture is needed.
  async function audioSignal() {
    const Offline = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Offline) return null;
    const context = new Offline(1, 5000, 44100);
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.value = 10000;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;
    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start(0);
    const buffer = await new Promise((resolve, reject) => {
      context.oncomplete = event => resolve(event.renderedBuffer);
      const started = context.startRendering();
      if (started && started.catch) started.catch(reject);
    });
    const samples = buffer.getChannelData(0);
    let sum = 0;
    for (let i = 4500; i < 5000; i++) sum += Math.abs(samples[i]);
    return sum.toFixed(8);
  }

  // A font counts as installed when it changes the width of a sample next to each generic fallback.
  function fontsSignal() {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    const sample = "mmmmmmmmmmlliWW@#0123";
    const bases = ["monospace", "sans-serif", "serif"];
    const width = font => { ctx.font = `72px ${font}`; return ctx.measureText(sample).width; };
    const baseWidths = bases.map(width);
    return FONT_CANDIDATES.filter(name => bases.some((base, i) => width(`'${name}', ${base}`) !== baseWidths[i]));
  }

  const media = query => attempt(() => root.matchMedia(query).matches, null);

  function basicSignals() {
    const nav = root.navigator || {};
    const screen = root.screen || {};
    const intl = attempt(() => Intl.DateTimeFormat().resolvedOptions(), {});
    return {
      platform: nav.platform || null,
      languages: Array.isArray(nav.languages) ? nav.languages.slice(0, 5) : [nav.language || ""],
      timezone: intl.timeZone || null,
      timezoneOffset: new Date(2026, 0, 1).getTimezoneOffset(),
      screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
      pixelRatio: root.devicePixelRatio || 1,
      hardwareConcurrency: nav.hardwareConcurrency ?? null,
      deviceMemory: nav.deviceMemory ?? null,
      maxTouchPoints: nav.maxTouchPoints ?? 0,
      cookieEnabled: nav.cookieEnabled ?? null,
      pdfViewer: nav.pdfViewerEnabled ?? null,
      colorGamut: media("(color-gamut: p3)") ? "p3" : media("(color-gamut: srgb)") ? "srgb" : null,
      hdr: media("(dynamic-range: high)"),
      pointer: media("(pointer: coarse)") ? "coarse" : media("(pointer: fine)") ? "fine" : null,
      // Automation flags: true for Selenium/Puppeteer/Playwright-driven browsers unless they hide it.
      webdriver: nav.webdriver === true,
    };
  }

  async function gather() {
    const signals = basicSignals();
    signals.canvas = attempt(canvasSignal);
    Object.assign(signals, attempt(webglSignal, { webglVendor: null, webglRenderer: null, webglParams: null }));
    signals.fonts = attempt(fontsSignal);
    signals.audio = await audioSignal().catch(() => null);
    return signals;
  }

  let gathered = null;
  // Resolves to the signals, or null if collecting fails or is still running after the timeout;
  // never rejects. Collection runs once per page, so a later call can still pick up a slow result.
  function collect(timeoutMs = TIMEOUT_MS) {
    if (!gathered) gathered = gather().catch(() => null);
    return Promise.race([gathered, new Promise(resolve => setTimeout(() => resolve(null), timeoutMs))]);
  }

  const api = { collect, shortHash };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PiniFingerprint = api;
})(typeof window !== "undefined" ? window : globalThis);
