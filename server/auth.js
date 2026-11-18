const enc = new TextEncoder();
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const key = (secret) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

/** Stateless signed session token: base64url(payload).base64url(HMAC-SHA256) */
export async function signSession(env, ttlSeconds = 8 * 3600) {
  const p = b64u(enc.encode(JSON.stringify({ exp: Date.now() + ttlSeconds * 1000 })));
  return p + "." + b64u(await crypto.subtle.sign("HMAC", await key(env.SESSION_SECRET), enc.encode(p)));
}
export async function verifySession(env, token) {
  try {
    const [p, s] = String(token || "").split(".");
    if (!p || !s) return false;
    const ok = await crypto.subtle.verify("HMAC", await key(env.SESSION_SECRET), unb64u(s), enc.encode(p));
    return ok && JSON.parse(new TextDecoder().decode(unb64u(p))).exp > Date.now();
  } catch { return false; }
}
/** Constant-time password check (compares SHA-256 digests). */
export async function checkPassword(env, pw) {
  const h = async (x) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(x))));
  const [a, b] = await Promise.all([h(pw), h(env.ADMIN_PASSWORD)]);
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
