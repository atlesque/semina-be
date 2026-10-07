// On the admin hostname, the site root opens the dashboard instead of the game.
// ADMIN_HOST defaults to admin.semina.be; every other hostname gets the game as before.
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (url.hostname === (env.ADMIN_HOST || "admin.semina.be")) return Response.redirect(new URL("/admin/", url), 302);
  return next();
}
