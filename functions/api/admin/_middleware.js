// Every /api/admin/* request must carry a valid Cloudflare Access JWT for an admin email,
// whatever hostname it arrives on. The verified email is passed on as context.data.adminEmail.
import { AccessError, verifyAccess } from "../../_shared/access.js";

export async function onRequest(context) {
  try {
    context.data.adminEmail = await verifyAccess(context.request, context.env);
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return context.next();
}
