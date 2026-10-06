// A small raymarched 3D trophy for a global top-three finish. Plain WebGL, no build step.
(function (root) {
  "use strict";
  const METALS = {
    gold: [1.0, 0.78, 0.28],
    silver: [0.76, 0.85, 1.0],
    bronze: [0.86, 0.5, 0.27],
  };
  const VERTEX = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
  const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uAngle;
uniform float uBob;
uniform vec3 uMetal;

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdCone(vec3 p, float h, float r1, float r2) {
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(r2, h), k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, q.y < 0.0 ? r1 : r2), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
float sdCyl(vec3 p, float r, float h) { vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }

// x: distance, y: material (0 metal, 1 plinth).
vec2 map(vec3 p) {
  p.y -= uBob;
  float c = cos(uAngle), s = sin(uAngle);
  p.xz = mat2(c, -s, s, c) * p.xz;
  // Bowl: an open shell around a cone blended into a sphere, cut at the rim.
  float outer = smin(sdCone(p - vec3(0.0, 0.82, 0.0), 0.43, 0.2, 0.67), length(p - vec3(0.0, 0.52, 0.0)) - 0.3, 0.12);
  float cup = max(abs(outer) - 0.022, p.y - 1.05);
  vec2 rim = vec2(length(p.xz) - 0.56, p.y - 1.05);
  cup = min(cup, length(rim) - 0.035);
  // Handles: half tori on both sides.
  vec2 h = vec2(length(vec2(abs(p.x) - 0.56, p.y - 0.72)) - 0.19, p.z);
  cup = min(cup, max(length(h) - 0.042, 0.45 - abs(p.x)));
  // Stem with a knob, then a foot.
  float stem = smin(sdCyl(p - vec3(0.0, 0.12, 0.0), 0.06, 0.26), length(p - vec3(0.0, 0.1, 0.0)) - 0.1, 0.06);
  stem = smin(stem, sdCyl(p - vec3(0.0, -0.17, 0.0), 0.22, 0.03) - 0.015, 0.08);
  float metal = smin(cup, stem, 0.05);
  // Plinth with a metal plate on the front.
  float plinth = sdBox(p - vec3(0.0, -0.39, 0.0), vec3(0.38, 0.18, 0.38), 0.035);
  metal = min(metal, sdBox(p - vec3(0.0, -0.39, 0.38), vec3(0.2, 0.08, 0.012), 0.01));
  return metal < plinth ? vec2(metal, 0.0) : vec2(plinth, 1.0);
}
vec3 normal(vec3 p) {
  const vec2 e = vec2(0.0015, -0.0015);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}
// A warm studio: soft floor, bright sky and two softboxes that the metal reflects.
vec3 env(vec3 d) {
  vec3 col = mix(vec3(0.5, 0.36, 0.32), vec3(1.0, 0.96, 0.9), smoothstep(-0.4, 0.4, d.y));
  vec2 h = normalize(d.xz + 0.0001);
  col += 1.8 * smoothstep(0.9, 0.99, dot(h, normalize(vec2(-0.6, 0.8)))) * smoothstep(-0.6, 0.1, d.y);
  col += 1.1 * smoothstep(0.94, 0.995, dot(h, normalize(vec2(0.8, 0.6))));
  col += 1.6 * smoothstep(0.86, 0.96, dot(d, normalize(vec3(-0.4, 0.75, 0.5))));
  return col;
}
void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  vec3 ro = vec3(0.0, 0.62, 3.4);
  vec3 ta = vec3(0.0, 0.27, 0.0);
  vec3 f = normalize(ta - ro), r = normalize(cross(f, vec3(0.0, 1.0, 0.0))), u = cross(r, f);
  vec3 rd = normalize(uv.x * r + uv.y * u + 2.65 * f);
  float t = 2.0;
  vec2 hit = vec2(1.0, -1.0);
  for (int i = 0; i < 96; i++) {
    hit = map(ro + rd * t);
    if (hit.x < 0.0008 || t > 6.0) break;
    t += hit.x * 0.9;
  }
  if (hit.x > 0.002) { gl_FragColor = vec4(0.0); return; }
  vec3 p = ro + rd * t, n = normal(p), ref = reflect(rd, n);
  float occ = clamp(0.55 + 0.45 * map(p + n * 0.08).x / 0.08, 0.0, 1.0);
  float fres = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
  vec3 col;
  if (hit.y < 0.5) {
    col = uMetal * env(ref);
    col = mix(col, env(ref), fres * 0.45);
  } else {
    float diff = max(dot(n, normalize(vec3(-0.5, 0.8, 0.6))), 0.0);
    col = vec3(0.17, 0.12, 0.2) * (0.35 + 0.8 * diff) + 0.25 * env(ref) * (0.08 + fres);
  }
  col *= occ;
  col = col / (1.0 + col * 0.25);
  gl_FragColor = vec4(pow(col, vec3(0.4545)), 1.0);
}`;

  let state = null;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  function setup(canvas) {
    if (state?.canvas === canvas) return state;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniform = name => gl.getUniformLocation(program, name);
    state = { canvas, gl, frame: 0, res: uniform("uRes"), angle: uniform("uAngle"), bob: uniform("uBob"), metal: uniform("uMetal") };
    return state;
  }
  function draw(s, time) {
    const { gl, canvas } = s;
    // Twice the CSS size keeps the edges smooth without multisampling.
    const scale = Math.min(2, Math.max(1.5, root.devicePixelRatio || 1));
    const width = Math.round(canvas.clientWidth * scale), height = Math.round(canvas.clientHeight * scale);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(s.res, width, height);
    gl.uniform1f(s.angle, s.still ? 0.5 : Math.sin(time * 0.0007) * 0.75);
    gl.uniform1f(s.bob, s.still ? 0 : Math.sin(time * 0.0016) * 0.035);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Draws the trophy for `tier` and keeps it gently turning unless `still`.
  // Returns false when WebGL is unavailable so the caller can fall back.
  function show(canvas, tier, still) {
    stop();
    let s;
    try { s = setup(canvas); } catch { s = null; }
    if (!s || !METALS[tier]) return false;
    s.gl.uniform3fv(s.metal, METALS[tier]);
    s.still = still;
    const tick = time => {
      if (!canvas.isConnected || canvas.offsetParent === null) { s.frame = 0; return; }
      draw(s, time);
      if (!s.still) s.frame = requestAnimationFrame(tick);
    };
    s.frame = requestAnimationFrame(tick);
    return true;
  }
  function stop() {
    if (state?.frame) cancelAnimationFrame(state.frame);
    if (state) state.frame = 0;
  }

  root.PiniTrophy = { show, stop };
})(window);
