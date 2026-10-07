// Admin view of the global leaderboard. functions/api/admin/_middleware.js has already checked
// the Cloudflare Access JWT before these handlers run.
import { CATEGORIES } from "../scores.js";

export const ADMIN_BOARD_SIZE = 50;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export async function onRequestGet({ env, data }) {
  if (!env.DB) return json({ error: "Leaderboard is not configured." }, 503);
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

// DELETE /api/admin/scores?category=arcade-falling clears one global board; category=all clears both.
export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ error: "Leaderboard is not configured." }, 503);
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Cross-origin requests are not allowed." }, 403);
  const category = url.searchParams.get("category");
  if (category !== "all" && !CATEGORIES.includes(category)) return json({ error: "Unknown category." }, 400);
  const { meta } = category === "all"
    ? await env.DB.prepare("DELETE FROM scores").run()
    : await env.DB.prepare("DELETE FROM scores WHERE category = ?1").bind(category).run();
  return json({ category, deleted: meta.changes });
}
