// Cloudflare Pages Function serving the global leaderboard from the D1 binding `DB`.
// These rules mirror scripts/leaderboard.js; tests/scores-api.test.mjs keeps them in sync.
export const NAME_PATTERN = /^[A-Za-z0-9]{1,12}$/;
export const CATEGORIES = ["arcade-falling", "arcade-stationary"];
export const MAX_SCORE = 9999999;
export const BOARD_SIZE = 10;
const MAX_BODY_BYTES = 512;

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
  const { name, score, category } = body ?? {};
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    return json({ error: "Names use 1–12 letters or digits." }, 400);
  }
  if (!Number.isSafeInteger(score) || score <= 0 || score > MAX_SCORE) return json({ error: "Invalid score." }, 400);
  if (!CATEGORIES.includes(category)) return json({ error: "Unknown category." }, 400);

  const { meta } = await env.DB
    .prepare("INSERT INTO scores (name, score, category) VALUES (?1, ?2, ?3)")
    .bind(name, score, category)
    .run();
  const id = meta.last_row_id;
  const above = await env.DB
    .prepare("SELECT COUNT(*) AS count FROM scores WHERE category = ?1 AND (score > ?2 OR (score = ?2 AND id < ?3))")
    .bind(category, score, id)
    .first();
  return json({ id, rank: above.count + 1, scores: await topScores(env.DB, category) }, 201);
}
