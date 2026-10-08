// Admin view of the global leaderboard. functions/api/admin/_middleware.js has already checked
// the Cloudflare Access JWT before these handlers run.
import { CATEGORIES, pruneOrigins } from "../scores.js";

export const ADMIN_BOARD_SIZE = 50;
export const RELATED_LIMIT = 25;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const scoreId = value => (/^[1-9][0-9]{0,15}$/.test(value || "") ? Number(value) : null);
const parseJson = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

async function related(db, column, value, id) {
  if (!value) return { total: 0, scores: [] };
  const { results } = await db
    .prepare(`SELECT id, name, score, category, created_at FROM scores WHERE ${column} = ?1 AND id != ?2 ORDER BY created_at DESC, id DESC LIMIT ?3`)
    .bind(value, id, RELATED_LIMIT)
    .all();
  const { count } = await db.prepare(`SELECT COUNT(*) AS count FROM scores WHERE ${column} = ?1 AND id != ?2`).bind(value, id).first();
  return { total: count, scores: results };
}

// GET /api/admin/scores?id=123: everything stored for one score, plus other scores from the same
// browser fingerprint and the same IP address.
async function scoreDetails(db, id) {
  const row = await db.prepare("SELECT * FROM scores WHERE id = ?1").bind(id).first();
  if (!row) return json({ error: "Score not found." }, 404);
  const rank = await db
    .prepare("SELECT COUNT(*) AS count FROM scores WHERE category = ?1 AND (score > ?2 OR (score = ?2 AND id < ?3))")
    .bind(row.category, row.score, row.id)
    .first();
  const { request_meta: meta, fingerprint_data: signals, ...score } = row;
  return json({
    score: { ...score, rank: rank.count + 1, request_meta: parseJson(meta), fingerprint_data: parseJson(signals) },
    sameFingerprint: await related(db, "fingerprint", row.fingerprint, row.id),
    sameIp: await related(db, "ip", row.ip, row.id),
  });
}

export async function onRequestGet({ request, env, data }) {
  if (!env.DB) return json({ error: "Leaderboard is not configured." }, 503);
  const idParam = new URL(request.url).searchParams.get("id");
  if (idParam !== null) {
    const id = scoreId(idParam);
    return id ? scoreDetails(env.DB, id) : json({ error: "Invalid score id." }, 400);
  }
  await pruneOrigins(env.DB);
  const boards = [];
  for (const category of CATEGORIES) {
    const { results } = await env.DB
      .prepare("SELECT id, name, score, created_at FROM scores WHERE category = ?1 ORDER BY score DESC, id ASC LIMIT ?2")
      .bind(category, ADMIN_BOARD_SIZE)
      .all();
    const { count } = await env.DB.prepare("SELECT COUNT(*) AS count FROM scores WHERE category = ?1").bind(category).first();
    boards.push({ category, total: count, scores: results });
  }
  return json({ admin: data?.adminEmail ?? null, boards });
}

// DELETE /api/admin/scores?id=123 deletes one score.
// DELETE /api/admin/scores?category=arcade-falling clears one global board; category=all clears both.
export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ error: "Leaderboard is not configured." }, 503);
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Cross-origin requests are not allowed." }, 403);
  if (url.searchParams.has("id")) {
    const id = scoreId(url.searchParams.get("id"));
    if (!id) return json({ error: "Invalid score id." }, 400);
    const { meta } = await env.DB.prepare("DELETE FROM scores WHERE id = ?1").bind(id).run();
    return meta.changes ? json({ id, deleted: meta.changes }) : json({ error: "Score not found." }, 404);
  }
  const category = url.searchParams.get("category");
  if (category !== "all" && !CATEGORIES.includes(category)) return json({ error: "Unknown category." }, 400);
  const { meta } = category === "all"
    ? await env.DB.prepare("DELETE FROM scores").run()
    : await env.DB.prepare("DELETE FROM scores WHERE category = ?1").bind(category).run();
  return json({ category, deleted: meta.changes });
}
