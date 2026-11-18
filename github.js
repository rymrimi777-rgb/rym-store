export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export const cfg = (env) => ({
  api: env.GITHUB_API || "https://api.github.com",
  up: env.GITHUB_UPLOADS || "https://uploads.github.com",
  o: env.GITHUB_OWNER, r: env.GITHUB_REPO, b: env.GITHUB_BRANCH || "main",
});
export const repoPath = (env) => { const c = cfg(env); return `/repos/${c.o}/${c.r}`; };

export function gh(env, path, init = {}, base) {
  return fetch((base || cfg(env).api) + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rym-store-admin", ...(init.headers || {}),
    },
  });
}
export async function must(res, what) {
  if (res.ok) return res;
  let m = ""; try { m = (await res.json()).message; } catch {}
  throw new HttpError(502, `GitHub: ${what} failed (${res.status}) ${m}`.trim());
}
export const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b) => Uint8Array.from(atob(b.replace(/\n/g, "")), (c) => c.charCodeAt(0));

export async function getFile(env, path) {
  const res = await gh(env, `${repoPath(env)}/contents/${encodeURI(path)}?ref=${cfg(env).b}`);
  if (res.status === 404) return null;
  const j = await (await must(res, "read file " + path)).json();
  return { sha: j.sha, bytes: j.content ? fromB64(j.content) : new Uint8Array() };
}
export const putFile = (env, path, b64, message, sha) => gh(env, `${repoPath(env)}/contents/${encodeURI(path)}`, {
  method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, content: b64, branch: cfg(env).b, ...(sha ? { sha } : {}) }),
});
export async function delFile(env, path, message) {
  const f = await getFile(env, path); if (!f) return;
  await must(await gh(env, `${repoPath(env)}/contents/${encodeURI(path)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha: f.sha, branch: cfg(env).b }),
  }), "delete file " + path);
}

export const DB = "public/data/products.json";
export async function readDb(env) {
  const f = await getFile(env, DB);
  if (!f) return { db: { products: [] }, sha: null };
  return { db: JSON.parse(new TextDecoder().decode(f.bytes)), sha: f.sha };
}
/** Read-modify-write the products JSON with a commit; retries on concurrent edits. */
export async function mutateDb(env, fn, message) {
  for (let i = 0; i < 4; i++) {
    const { db, sha } = await readDb(env);
    const out = await fn(db);
    const res = await putFile(env, DB, toB64(new TextEncoder().encode(JSON.stringify(db, null, 2) + "\n")), message, sha);
    if (res.ok) return out;
    if (res.status !== 409 && res.status !== 422) await must(res, "commit products.json");
  }
  throw new HttpError(409, "The catalogue changed while saving. Please try again.");
}
export async function deleteRelease(env, v) {
  if (v.releaseId) await must(await gh(env, `${repoPath(env)}/releases/${v.releaseId}`, { method: "DELETE" }), "delete release");
  if (v.tag) await gh(env, `${repoPath(env)}/git/refs/tags/${encodeURIComponent(v.tag)}`, { method: "DELETE" });
}
