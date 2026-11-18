import { signSession, verifySession, checkPassword } from "./auth.js";
import { HttpError, gh, must, repoPath, cfg, getFile, putFile, delFile, mutateDb, readDb, toB64, deleteRelease } from "./github.js";

const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/, VER = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,30}$/;
const PLATFORMS = ["Android", "Windows", "macOS", "Linux", "iOS", "Other"];
const MAX_IMG = 3 * 1024 * 1024;
// allowed binary extensions -> required magic bytes (null = no reliable signature)
const BIN = { apk: [0x50, 0x4b], aab: [0x50, 0x4b], zip: [0x50, 0x4b], exe: [0x4d, 0x5a], msi: [0xd0, 0xcf, 0x11, 0xe0],
  deb: [0x21, 0x3c, 0x61, 0x72], appimage: [0x7f, 0x45, 0x4c, 0x46], gz: [0x1f, 0x8b], pkg: [0x78, 0x61, 0x72, 0x21], dmg: null };
const s = (v, n) => String(v ?? "").trim().slice(0, n);
const list = (v, n, l) => (Array.isArray(v) ? v : []).map((x) => s(x, l)).filter(Boolean).slice(0, n);
const col = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
const startsWith = (u8, sig) => sig.every((b, i) => u8[i] === b);
const cookie = (req) => (req.headers.get("cookie") || "").match(/(?:^|; )rym_admin=([^;]+)/)?.[1];

function cleanProduct(b, slug, old) {
  const name = s(b.name, 60);
  if (!name) throw new HttpError(400, "Name is required");
  return {
    slug, name, description: s(b.description, 600), status: s(b.status, 30),
    platforms: list(b.platforms, 8, 30), tech: list(b.tech, 10, 30), features: list(b.features, 20, 120),
    links: (Array.isArray(b.links) ? b.links : []).map((l) => ({ label: s(l?.label, 40), url: s(l?.url, 300) })).filter((l) => l.label && /^https:\/\//.test(l.url)).slice(0, 6),
    bg: col(b.bg, "#D9E3BD"), fg: col(b.fg, "#4A2E22"), published: !!b.published,
    icon: old?.icon || null, screenshots: old?.screenshots || [], versions: old?.versions || [],
  };
}
async function product(env, slug) {
  const { db } = await readDb(env); const p = db.products.find((x) => x.slug === slug);
  if (!p) throw new HttpError(404, "Product not found"); return p;
}
/** Re-emit a stream after reading its first bytes (for magic-number validation). */
async function peek(body, n) {
  const reader = body.getReader(); let head = new Uint8Array(0), chunks = [];
  while (head.length < n) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); const m = new Uint8Array(head.length + value.length); m.set(head); m.set(value, head.length); head = m;
  }
  const stream = new ReadableStream({
    start(c) { chunks.forEach((x) => c.enqueue(x)); },
    async pull(c) { const { done, value } = await reader.read(); done ? c.close() : c.enqueue(value); },
    cancel: () => reader.cancel(),
  });
  return { head, stream };
}
const imgType = (u) => (startsWith(u, [0x89, 0x50, 0x4e, 0x47]) ? "png" : startsWith(u, [0xff, 0xd8, 0xff]) ? "jpg"
  : startsWith(u, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...u.subarray(8, 12)) === "WEBP" ? "webp" : null);

export async function handle(request, env) {
  try {
    const url = new URL(request.url), m = request.method;
    const seg = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO || !env.ADMIN_PASSWORD || !(env.SESSION_SECRET && env.SESSION_SECRET.length >= 32))
      throw new HttpError(500, "Server is not configured. Set the environment variables listed in README.md.");
    if (m !== "GET" && m !== "HEAD") {
      if (request.headers.get("x-rym-admin") !== "1") throw new HttpError(403, "Forbidden");
      const o = request.headers.get("origin"); if (o && new URL(o).host !== url.host) throw new HttpError(403, "Forbidden");
    }
    const secure = url.protocol === "https:" ? "; Secure" : "";
    if (seg[0] === "login" && m === "POST") {
      const b = await request.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, 400));
      if (!(await checkPassword(env, b.password))) throw new HttpError(401, "Wrong password");
      return json({ ok: true }, 200, { "set-cookie": `rym_admin=${await signSession(env)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}` });
    }
    if (seg[0] === "logout" && m === "POST") return json({ ok: true }, 200, { "set-cookie": `rym_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}` });
    const authed = await verifySession(env, cookie(request));
    if (seg[0] === "me") return json({ authenticated: authed });
    if (!authed) throw new HttpError(401, "Login required");
    if (seg[0] !== "products") throw new HttpError(404, "Not found");

    if (seg.length === 1 && m === "GET") return json((await readDb(env)).db);
    const slug = seg[1]; if (!SLUG.test(slug || "")) throw new HttpError(400, "Invalid product id (a-z, 0-9, dashes)");

    if (seg.length === 2 && m === "PUT") {
      const b = await request.json().catch(() => { throw new HttpError(400, "Invalid JSON"); });
      const out = await mutateDb(env, (db) => {
        const i = db.products.findIndex((x) => x.slug === slug), p = cleanProduct(b, slug, db.products[i]);
        i < 0 ? db.products.push(p) : (db.products[i] = p); return p;
      }, `admin: save product ${slug}`);
      return json(out);
    }
    if (seg.length === 2 && m === "DELETE") {
      const removed = await mutateDb(env, (db) => {
        const i = db.products.findIndex((x) => x.slug === slug); if (i < 0) throw new HttpError(404, "Product not found");
        return db.products.splice(i, 1)[0];
      }, `admin: delete product ${slug}`);
      const errors = [];
      for (const f of [removed.icon, ...removed.screenshots].filter(Boolean)) await delFile(env, "public" + f.split("?")[0], `admin: delete media ${slug}`).catch((e) => errors.push(e.message));
      if (url.searchParams.get("purge") === "1") for (const v of removed.versions) await deleteRelease(env, v).catch((e) => errors.push(e.message));
      return json({ deleted: true, cleanupErrors: errors });
    }

    if (seg[2] === "media") {
      if (m === "POST") {
        const p = await product(env, slug), kind = url.searchParams.get("kind");
        if (kind !== "icon" && kind !== "screenshot") throw new HttpError(400, "kind must be icon or screenshot");
        if (kind === "screenshot" && p.screenshots.length >= 8) throw new HttpError(400, "Maximum 8 screenshots");
        if (Number(request.headers.get("content-length") || 0) > MAX_IMG) throw new HttpError(413, "Image too large (max 3 MB)");
        const u = new Uint8Array(await request.arrayBuffer());
        if (!u.length || u.length > MAX_IMG) throw new HttpError(413, "Image empty or too large (max 3 MB)");
        const ext = imgType(u); if (!ext) throw new HttpError(400, "Only real PNG, JPEG or WebP images are accepted");
        const file = `${kind === "icon" ? "icon" : "shot-" + Date.now()}.${ext}`, path = `public/media/${slug}/${file}`;
        const prev = await getFile(env, path);
        await must(await putFile(env, path, toB64(u), `admin: upload ${kind} for ${slug}`, prev?.sha), "upload image");
        const web = `/media/${slug}/${file}?v=${Date.now()}`;
        const old = p.icon;
        const out = await mutateDb(env, (db) => {
          const q = db.products.find((x) => x.slug === slug); if (!q) throw new HttpError(404, "Product not found");
          kind === "icon" ? (q.icon = web) : q.screenshots.push(web); return q;
        }, `admin: ${kind} for ${slug}`);
        if (kind === "icon" && old && old.split("?")[0] !== web.split("?")[0]) await delFile(env, "public" + old.split("?")[0], "admin: replace icon").catch(() => {});
        return json(out);
      }
      if (m === "DELETE") {
        const path = (url.searchParams.get("path") || "").split("?")[0];
        const out = await mutateDb(env, (db) => {
          const q = db.products.find((x) => x.slug === slug); if (!q) throw new HttpError(404, "Product not found");
          const has = (q.icon || "").split("?")[0] === path || q.screenshots.some((x) => x.split("?")[0] === path);
          if (!has || !path.startsWith(`/media/${slug}/`)) throw new HttpError(400, "Unknown media path");
          if ((q.icon || "").split("?")[0] === path) q.icon = null;
          q.screenshots = q.screenshots.filter((x) => x.split("?")[0] !== path); return q;
        }, `admin: remove media ${slug}`);
        await delFile(env, "public" + path, `admin: delete media ${slug}`);
        return json(out);
      }
    }

    if (seg[2] === "versions") {
      const ver = seg[3];
      if (seg.length === 3 && m === "POST") {
        const b = await request.json().catch(() => ({})), version = s(b.version, 31).replace(/^v/i, "");
        if (!VER.test(version)) throw new HttpError(400, "Invalid version (example: 1.0.0)");
        const p = await product(env, slug);
        if (p.versions.some((v) => v.version === version)) throw new HttpError(409, "This version already exists");
        const tag = `${slug}-v${version}`, notes = s(b.notes, 8000);
        const rel = await (await must(await gh(env, `${repoPath(env)}/releases`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_name: tag, target_commitish: cfg(env).b, name: `${p.name} ${version}`, body: notes, draft: false, prerelease: false }),
        }), "create release")).json();
        try {
          const out = await mutateDb(env, (db) => {
            const q = db.products.find((x) => x.slug === slug); if (!q) throw new HttpError(404, "Product not found");
            q.versions.unshift({ version, date: new Date().toISOString().slice(0, 10), notes, tag, releaseId: rel.id, assets: [] }); return q;
          }, `admin: release ${slug} ${version}`);
          return json(out);
        } catch (e) { await deleteRelease(env, { releaseId: rel.id, tag }).catch(() => {}); throw e; }
      }
      if (seg.length === 4 && (m === "PATCH" || m === "DELETE")) {
        const p = await product(env, slug), v = p.versions.find((x) => x.version === ver);
        if (!v) throw new HttpError(404, "Version not found");
        if (m === "PATCH") {
          const notes = s((await request.json().catch(() => ({}))).notes, 8000);
          await must(await gh(env, `${repoPath(env)}/releases/${v.releaseId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: notes }) }), "update release notes");
          return json(await mutateDb(env, (db) => { const q = db.products.find((x) => x.slug === slug); q.versions.find((x) => x.version === ver).notes = notes; return q; }, `admin: notes ${slug} ${ver}`));
        }
        await deleteRelease(env, v);
        return json(await mutateDb(env, (db) => { const q = db.products.find((x) => x.slug === slug); q.versions = q.versions.filter((x) => x.version !== ver); return q; }, `admin: delete version ${slug} ${ver}`));
      }
      if (seg[4] === "assets") {
        const p = await product(env, slug), v = p.versions.find((x) => x.version === ver);
        if (!v) throw new HttpError(404, "Version not found");
        if (seg.length === 5 && m === "POST") {
          const name = s(url.searchParams.get("name"), 100).replace(/[^A-Za-z0-9._-]/g, "_"), platform = url.searchParams.get("platform") || "Other";
          const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
          if (!(ext in BIN)) throw new HttpError(400, `File type not allowed. Allowed: ${Object.keys(BIN).join(", ")}`);
          if (!PLATFORMS.includes(platform)) throw new HttpError(400, "Invalid platform");
          const len = Number(request.headers.get("content-length") || 0), max = Number(env.MAX_UPLOAD_MB || 95) * 1048576;
          if (!len) throw new HttpError(411, "Content-Length required");
          if (len > max) throw new HttpError(413, `File too large for upload through the site (max ${Math.round(max / 1048576)} MB). Attach larger files on GitHub directly.`);
          if (v.assets.some((a) => a.name === name)) throw new HttpError(409, "A file with this name already exists for this version");
          const { head, stream } = await peek(request.body, 4);
          if (BIN[ext] && !startsWith(head, BIN[ext])) throw new HttpError(400, `File content does not look like a real .${ext} file`);
          const res = await gh(env, `/repos/${cfg(env).o}/${cfg(env).r}/releases/${v.releaseId}/assets?name=${encodeURIComponent(name)}`, {
            method: "POST", headers: { "Content-Type": "application/octet-stream", "Content-Length": String(len) }, body: stream, duplex: "half",
          }, cfg(env).up);
          const a = await (await must(res, "upload asset")).json();
          return json(await mutateDb(env, (db) => {
            const q = db.products.find((x) => x.slug === slug); q.versions.find((x) => x.version === ver).assets.push({ id: a.id, name: a.name, size: a.size, platform, url: a.browser_download_url }); return q;
          }, `admin: asset ${name} for ${slug} ${ver}`));
        }
        if (seg.length === 6 && m === "DELETE") {
          const id = Number(seg[5]); if (!v.assets.some((a) => a.id === id)) throw new HttpError(404, "Asset not found");
          await must(await gh(env, `${repoPath(env)}/releases/assets/${id}`, { method: "DELETE" }), "delete asset");
          return json(await mutateDb(env, (db) => { const q = db.products.find((x) => x.slug === slug), vv = q.versions.find((x) => x.version === ver); vv.assets = vv.assets.filter((a) => a.id !== id); return q; }, `admin: remove asset ${id}`));
        }
      }
    }
    throw new HttpError(404, "Not found");
  } catch (e) {
    return json({ error: e instanceof HttpError ? e.message : "Unexpected server error" }, e instanceof HttpError ? e.status : 500);
  }
}
