// Runs the real API handler against a LOCAL fake GitHub server (no network, no token needed).
// Run: node test/e2e.mjs
import crypto from "node:crypto"; import assert from "node:assert/strict"; import { startMock } from "./mock-github.mjs";
import { handle } from "../server/router.js";

const sha = (b) => crypto.createHash("sha1").update(b).digest("hex");
const { port: _p, files, releases, blobs, close } = await startMock(); const port = _p; const srv = { close };

const env = { GITHUB_TOKEN: "test-token", GITHUB_OWNER: "o", GITHUB_REPO: "r", GITHUB_BRANCH: "main", ADMIN_PASSWORD: "correct horse battery", SESSION_SECRET: "x".repeat(40),
  GITHUB_API: `http://127.0.0.1:${port}`, GITHUB_UPLOADS: `http://127.0.0.1:${port}`, MAX_UPLOAD_MB: "3" };
let ck = "";
const call = async (method, path, b, extra = {}) => {
  const isBin = b instanceof Uint8Array || Buffer.isBuffer(b);
  const r = await handle(new Request("http://site.test/api/" + path, { method, headers: { "x-rym-admin": "1", cookie: ck, ...(isBin ? { "content-length": String(b.length) } : {}), ...(b && !isBin ? { "content-type": "application/json" } : {}), ...extra }, body: b ? (isBin ? b : JSON.stringify(b)) : undefined }), env);
  return { status: r.status, json: await r.json(), r };
};
const ok = (n) => console.log("  ✓", n);

assert.equal((await call("GET", "products")).status, 401); ok("admin API refuses anonymous requests");
assert.equal((await call("POST", "login", { password: "nope" })).status, 401); ok("wrong password rejected");
assert.equal((await handle(new Request("http://site.test/api/products", { method: "PUT", body: "{}" }), env)).status, 403); ok("mutations without CSRF header rejected");
const lg = await call("POST", "login", { password: env.ADMIN_PASSWORD }); assert.equal(lg.status, 200);
ck = lg.r.headers.get("set-cookie").split(";")[0]; assert.match(lg.r.headers.get("set-cookie"), /HttpOnly/); ok("login sets HttpOnly session cookie");
assert.equal((await call("GET", "products")).status, 200); ok("session grants access");

let r = await call("PUT", "products/demo", { name: "Demo", description: "d", platforms: ["Android"], links: [{ label: "x", url: "http://bad" }, { label: "ok", url: "https://ok.dev" }], published: true });
assert.equal(r.status, 200); assert.equal(r.json.links.length, 1); ok("create product (non-https links dropped)");
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), crypto.randomBytes(500)]);
r = await call("POST", "products/demo/media?kind=icon", png); assert.equal(r.status, 200); assert.ok(files.has("public/media/demo/icon.png")); ok("icon uploaded to repo");
assert.equal((await call("POST", "products/demo/media?kind=icon", Buffer.from("<svg onload=alert(1)>"))).status, 400); ok("SVG / fake image rejected");
r = await call("POST", "products/demo/versions", { version: "1.0.0", notes: "First" }); assert.equal(r.status, 200); ok("release created");
assert.equal((await call("POST", "products/demo/versions", { version: "1.0.0" })).status, 409); ok("duplicate version rejected");
const apk = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), crypto.randomBytes(2 * 1024 * 1024)]);
r = await call("POST", "products/demo/versions/1.0.0/assets?name=Demo-1.0.0.apk&platform=Android", apk); assert.equal(r.status, 200, JSON.stringify(r.json));
const a = r.json.versions[0].assets[0];
const dl = Buffer.from(await (await fetch(a.url)).arrayBuffer()); assert.equal(sha(dl), sha(apk)); ok(`upload + download round-trip byte-identical (${(dl.length / 1048576).toFixed(1)} MB)`);
assert.equal((await call("POST", "products/demo/versions/1.0.0/assets?name=run.sh&platform=Linux", Buffer.from("#!/bin/sh"))).status, 400); ok(".sh rejected");
assert.equal((await call("POST", "products/demo/versions/1.0.0/assets?name=fake.exe&platform=Windows", Buffer.from("not an exe at all"))).status, 400); ok("fake .exe rejected (magic bytes)");
assert.equal((await call("POST", "products/demo/versions/1.0.0/assets?name=big.apk&platform=Android", Buffer.concat([Buffer.from([0x50, 0x4b]), Buffer.alloc(4 * 1048576)]))).status, 413); ok("oversize upload rejected");
r = await call("PATCH", "products/demo/versions/1.0.0", { notes: "Edited" }); assert.equal(releases.get(101).body, "Edited"); ok("release notes edited on GitHub");
await call("POST", "products/demo/versions", { version: "1.1.0", notes: "Second" }); r = await call("GET", "products");
assert.deepEqual(r.json.products[0].versions.map((v) => v.version), ["1.1.0", "1.0.0"]); ok("versions kept, newest first");
r = await call("DELETE", `products/demo/versions/1.0.0/assets/${a.id}`); assert.equal(r.json.versions[1].assets.length, 0); ok("asset deleted");
r = await call("DELETE", "products/demo/versions/1.1.0"); assert.equal(r.json.versions.length, 1); assert.equal(releases.size, 1); ok("version + release deleted");
r = await call("PUT", "products/demo", { name: "Demo", published: false }); assert.equal(r.json.published, false); assert.equal(r.json.versions.length, 1); ok("unpublish keeps versions/media");
r = await call("DELETE", "products/demo?purge=1"); assert.equal(r.status, 200); assert.equal(releases.size, 0); assert.ok(!files.has("public/media/demo/icon.png")); ok("product deleted with releases + media");
assert.deepEqual(JSON.parse(files.get("public/data/products.json").b).products, []); ok("products.json committed to repo");
srv.close(); console.log("\nAll checks passed.");
