// Cloudflare Pages Function serving the global leaderboard from the D1 binding `DB`.
// These rules mirror scripts/leaderboard.js; tests/scores-api.test.mjs keeps them in sync.
export const NAME_PATTERN = /^[A-Za-z0-9]{1,12}$/;
export const CATEGORIES = ["arcade-falling", "arcade-stationary"];
export const MAX_SCORE = 9999999;
export const BOARD_SIZE = 10;
// Room for the browser fingerprint signals that ride along with each score.
const MAX_BODY_BYTES = 8192;
const MAX_FINGERPRINT_JSON = 4096;
const FINGERPRINT_KEY = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
// IP addresses and fingerprints are kept only this long (see privacy.html); scores stay.
export const ORIGIN_RETENTION_DAYS = 90;
const REQUEST_META_KEYS = ["asOrganization", "city", "region", "timezone", "colo", "tlsVersion", "httpProtocol"];

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function topScores(db, category) {
  const { results } = await db
    .prepare("SELECT id, name, score FROM scores WHERE category = ?1 ORDER BY score DESC, id ASC LIMIT ?2")
    .bind(category, BOARD_SIZE)
    .all();
  return results;
}

const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : null);

// Keeps only flat, size-limited values from the browser's fingerprint signals (scripts/fingerprint.js)
// and returns them as canonical JSON with sorted keys, or null when nothing usable was sent.
export function cleanFingerprint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const clean = {};
  for (const key of Object.keys(value).sort().slice(0, 40)) {
    const item = value[key];
    if (!FINGERPRINT_KEY.test(key)) continue;
    if (item === null || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) clean[key] = item;
    else if (typeof item === "string") clean[key] = item.slice(0, 200);
    else if (Array.isArray(item)) clean[key] = item.filter(entry => typeof entry === "string").slice(0, 40).map(entry => entry.slice(0, 80));
  }
  const text = JSON.stringify(clean);
  return Object.keys(clean).length && text.length <= MAX_FINGERPRINT_JSON ? text : null;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// Where the request came from, according to Cloudflare rather than the browser.
export function requestOrigin(request) {
  const cf = request.cf || {};
  const meta = {};
  for (const key of REQUEST_META_KEYS) if (cf[key] != null && cf[key] !== "") meta[key] = clip(String(cf[key]), 120);
  return {
    ip: clip(request.headers.get("cf-connecting-ip"), 64),
    country: clip(cf.country || request.headers.get("cf-ipcountry"), 8),
    asn: Number.isSafeInteger(cf.asn) ? cf.asn : null,
    userAgent: clip(request.headers.get("user-agent"), 512),
    meta: Object.keys(meta).length ? JSON.stringify(meta) : null,
  };
}

// Clears the submission details of scores older than the retention period. Runs whenever a score is
// saved and whenever the admin opens the boards, so nothing outlives it by much.
export async function pruneOrigins(db, now = Date.now()) {
  const cutoff = new Date(now - ORIGIN_RETENTION_DAYS * 86400000).toISOString();
  const { meta } = await db
    .prepare(`UPDATE scores SET ip = NULL, country = NULL, asn = NULL, user_agent = NULL, request_meta = NULL,
        fingerprint = NULL, fingerprint_data = NULL
      WHERE created_at < ?1 AND (ip IS NOT NULL OR country IS NOT NULL OR asn IS NOT NULL OR user_agent IS NOT NULL
        OR request_meta IS NOT NULL OR fingerprint IS NOT NULL)`)
    .bind(cutoff)
    .run();
  return meta.changes;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "Leaderboard is not configured." }, 503);
  const category = new URL(request.url).searchParams.get("category") || CATEGORIES[0];
  if (!CATEGORIES.includes(category)) return json({ error: "Unknown category." }, 400);
  return json({ scores: await topScores(env.DB, category) });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "Leaderboard is not configured." }, 503);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON." }, 400); }
  const { name, score, category, fingerprint } = body ?? {};
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    return json({ error: "Names use 1–12 letters or digits." }, 400);
  }
  if (!Number.isSafeInteger(score) || score <= 0 || score > MAX_SCORE) return json({ error: "Invalid score." }, 400);
  if (!CATEGORIES.includes(category)) return json({ error: "Unknown category." }, 400);

  const origin = requestOrigin(request);
  const fingerprintData = cleanFingerprint(fingerprint);
  const fingerprintId = fingerprintData ? await sha256Hex(fingerprintData) : null;
  const { meta } = await env.DB
    .prepare(`INSERT INTO scores (name, score, category, ip, country, asn, user_agent, request_meta, fingerprint, fingerprint_data)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
    .bind(name, score, category, origin.ip, origin.country, origin.asn, origin.userAgent, origin.meta, fingerprintId, fingerprintData)
    .run();
  const id = meta.last_row_id;
  await pruneOrigins(env.DB);
  const above = await env.DB
    .prepare("SELECT COUNT(*) AS count FROM scores WHERE category = ?1 AND (score > ?2 OR (score = ?2 AND id < ?3))")
    .bind(category, score, id)
    .first();
  return json({ id, rank: above.count + 1, scores: await topScores(env.DB, category) }, 201);
}
