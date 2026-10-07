// Guards the static dashboard under /admin/ with the same Access check as the admin API.
import { AccessError, verifyAccess } from "../_shared/access.js";

export async function onRequest(context) {
  try {
    await verifyAccess(context.request, context.env);
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    return new Response(`${error.message}\n`, {
      status: error.status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const response = await context.next();
  const guarded = new Response(response.body, response);
  guarded.headers.set("cache-control", "no-store");
  guarded.headers.set("x-robots-tag", "noindex");
  return guarded;
}
