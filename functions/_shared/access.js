// Verifies the Cloudflare Access JWT that Access adds to every request it lets through, so the
// admin routes stay closed even if they are reached without Access in front (another hostname, a
// preview deploy, or a misconfigured application). Configured through Pages environment variables:
//   ACCESS_TEAM_DOMAIN  Zero Trust team domain, e.g. "pini" or "pini.cloudflareaccess.com"
//   ACCESS_AUD          Application Audience (AUD) tag of the admin.semina.be Access application
//   ADMIN_EMAILS        Comma-separated emails allowed in, e.g. "someone@example.com"
// Any missing variable keeps the admin closed.
const CERTS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;
let certsCache = { issuer: "", keys: null, expires: 0 };

export class AccessError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}

export function accessConfig(env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "").trim()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.cloudflareaccess\.com$/, "");
  const audience = String(env.ACCESS_AUD || "").trim();
  const emails = String(env.ADMIN_EMAILS || "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
  if (!team || !audience || !emails.length) return null;
  return { issuer: `https://${team}.cloudflareaccess.com`, audience, emails };
}

const base64UrlBytes = text => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const base64UrlJson = text => JSON.parse(new TextDecoder().decode(base64UrlBytes(text)));

async function signingKeys(issuer, fetchImpl, now) {
  if (certsCache.issuer === issuer && certsCache.keys && certsCache.expires > now) return certsCache.keys;
  const response = await fetchImpl(`${issuer}/cdn-cgi/access/certs`);
  if (!response.ok) throw new AccessError("Could not load Access signing keys.", 502);
  const { keys } = await response.json();
  certsCache = { issuer, keys: Array.isArray(keys) ? keys : [], expires: now + CERTS_TTL_MS };
  return certsCache.keys;
}

export function tokenFrom(request) {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header;
  const cookie = request.headers.get("cookie") || "";
  return cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] || "";
}

// Resolves to the signed-in admin's email, or throws AccessError.
export async function verifyAccess(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const config = accessConfig(env);
  if (!config) throw new AccessError("Admin access is not configured.", 503);
  const token = tokenFrom(request);
  const parts = token.split(".");
  if (parts.length !== 3) throw new AccessError("Sign in through Cloudflare Access.");

  let header, payload;
  try { header = base64UrlJson(parts[0]); payload = base64UrlJson(parts[1]); }
  catch { throw new AccessError("Malformed Access token."); }
  if (header.alg !== "RS256") throw new AccessError("Unexpected Access token algorithm.");

  const jwk = (await signingKeys(config.issuer, fetchImpl, now)).find(key => key.kid === header.kid);
  if (!jwk) throw new AccessError("Unknown Access signing key.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let valid = false;
  try { valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(parts[2]), signed); } catch {}
  if (!valid) throw new AccessError("Invalid Access token signature.");

  const seconds = now / 1000;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== config.issuer) throw new AccessError("Access token has the wrong issuer.");
  if (!audiences.includes(config.audience)) throw new AccessError("Access token is for another application.");
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_S < seconds) throw new AccessError("Access token has expired.");
  if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_S > seconds) throw new AccessError("Access token is not valid yet.");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!config.emails.includes(email)) throw new AccessError("This account is not an admin.");
  return email;
}

export function resetAccessCache() { certsCache = { issuer: "", keys: null, expires: 0 }; }
