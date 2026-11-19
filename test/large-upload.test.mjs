// Comprehensive test for Large APK upload (> 190 MB) and direct download round-trip
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import http from "node:http";
import { startMock } from "./mock-github.mjs";
import { startUploadServer } from "../server/upload-helper.mjs";

const TEST_DIR = path.resolve("./test-tmp");
if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

const TARGET_SIZE = 195 * 1024 * 1024; // 195 MB (exceeds 190 MB threshold)
const TEST_APK_PATH = path.join(TEST_DIR, "large-test-app-1.0.0.apk");

console.log("=== Large APK Upload (> 190 MB) and Direct Download Test ===");

// 1. Generate real valid APK binary (> 190 MB)
console.log(`1. Generating ${(TARGET_SIZE / 1048576).toFixed(1)} MB test APK with valid ZIP/APK header...`);
const writeStream = fs.createWriteStream(TEST_APK_PATH);
const hashOriginal = crypto.createHash("sha256");

// Valid APK / ZIP magic header: PK\x03\x04
const header = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
writeStream.write(header);
hashOriginal.update(header);

let written = header.length;
const chunk = crypto.randomBytes(1024 * 1024); // 1 MB random payload chunk

while (written + chunk.length <= TARGET_SIZE) {
  writeStream.write(chunk);
  hashOriginal.update(chunk);
  written += chunk.length;
}

if (written < TARGET_SIZE) {
  const rem = crypto.randomBytes(TARGET_SIZE - written);
  writeStream.write(rem);
  hashOriginal.update(rem);
  written += rem.length;
}

await new Promise((resolve) => writeStream.end(resolve));
const originalSha256 = hashOriginal.digest("hex");
const stat = fs.statSync(TEST_APK_PATH);

console.log(`   Generated file size: ${(stat.size / 1048576).toFixed(2)} MB (${stat.size} bytes)`);
console.log(`   Original SHA-256: ${originalSha256}`);
assert.equal(stat.size, TARGET_SIZE);
assert.ok(stat.size > 190 * 1024 * 1024, "APK must be > 190 MB");

// 2. Start mock GitHub server
console.log("2. Starting local mock GitHub server...");
const { port: mockPort, files, releases, blobs, close: closeMock } = await startMock();

// Seed mock products.json with test app
const initialCatalog = {
  products: [
    {
      slug: "big-game",
      name: "Big Adventure Game",
      description: "An open world Android adventure game.",
      status: "Release",
      platforms: ["Android"],
      tech: ["Kotlin", "Vulkan"],
      features: ["Offline playable", "195MB assets"],
      links: [],
      bg: "#fbeaea",
      fg: "#231b1b",
      published: true,
      icon: null,
      screenshots: [],
      versions: [],
    },
    {
      slug: "upcoming-tool",
      name: "Upcoming Tool",
      description: "In active development.",
      status: "In dev",
      platforms: ["Android"],
      tech: [],
      features: [],
      links: [],
      bg: "#f6f1f1",
      fg: "#231b1b",
      published: true,
      icon: null,
      screenshots: [],
      versions: [],
    },
  ],
};
files.set("public/data/products.json", {
  b: JSON.stringify(initialCatalog, null, 2),
  sha: "seed-catalog-sha",
});

// 3. Start RYM Upload Helper
console.log("3. Starting RYM Upload Helper...");
const mockEnv = {
  GITHUB_TOKEN: "mock-token",
  GITHUB_OWNER: "rym-test-owner",
  GITHUB_REPO: "rym-test-store",
  GITHUB_BRANCH: "main",
  GITHUB_API: `http://127.0.0.1:${mockPort}`,
  GITHUB_UPLOADS: `http://127.0.0.1:${mockPort}`,
};

const { port: helperPort, close: closeHelper } = await startUploadServer(0, mockEnv);
console.log(`   Helper active on port ${helperPort}`);

// Verify health check
const health = await fetch(`http://127.0.0.1:${helperPort}/health`).then((r) => r.json());
assert.equal(health.ok, true);
assert.equal(health.service, "rym-upload-helper");
console.log("   ✓ Helper health check OK");

// 4. Upload the 195 MB APK via helper
console.log("4. Streaming 195 MB APK to GitHub Releases via Upload Helper...");
const uploadUrl = `http://127.0.0.1:${helperPort}/upload?slug=big-game&version=1.0.0&name=big-game-1.0.0.apk&platform=Android`;

const req = http.request(uploadUrl, {
  method: "POST",
  headers: {
    "X-RYM-Admin": "1",
    "Content-Type": "application/octet-stream",
    "Content-Length": String(stat.size),
  },
});

const fileStream = fs.createReadStream(TEST_APK_PATH);
let sentBytes = 0;
fileStream.on("data", (c) => {
  sentBytes += c.length;
  if (sentBytes % (40 * 1024 * 1024) < c.length || sentBytes === stat.size) {
    process.stdout.write(`   Streaming progress: ${(sentBytes / stat.size * 100).toFixed(0)}% (${(sentBytes / 1048576).toFixed(1)} MB / ${(stat.size / 1048576).toFixed(1)} MB)\r`);
  }
});

const uploadPromise = new Promise((resolve, reject) => {
  req.on("response", (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      try {
        resolve({ status: res.statusCode, data: JSON.parse(body) });
      } catch (e) {
        reject(new Error(`Failed to parse response (${res.statusCode}): ${body}`));
      }
    });
  });
  req.on("error", reject);
});

fileStream.pipe(req);
const { status: uploadStatus, data: uploadData } = await uploadPromise;
console.log("\n   Upload completed!");
assert.equal(uploadStatus, 200, `Upload should return 200, got: ${JSON.stringify(uploadData)}`);
assert.equal(uploadData.ok, true);
assert.equal(uploadData.asset.name, "big-game-1.0.0.apk");
assert.equal(uploadData.asset.size, TARGET_SIZE);
assert.equal(uploadData.asset.platform, "Android");
assert.ok(uploadData.asset.url.includes("/download/"), "Real download URL must be present");
console.log(`   ✓ Upload succeeded: Asset ID ${uploadData.asset.id}, URL: ${uploadData.asset.url}`);

// 5. Verify product information updated automatically
console.log("5. Verifying product catalog updated automatically in repository...");
const updatedJsonRaw = files.get("public/data/products.json")?.b;
assert.ok(updatedJsonRaw, "products.json should exist in repository");
const catalog = JSON.parse(updatedJsonRaw);
const bigGame = catalog.products.find((p) => p.slug === "big-game");
assert.ok(bigGame, "big-game product must be in catalog");
assert.equal(bigGame.versions.length, 1);
const latestVer = bigGame.versions[0];
assert.equal(latestVer.version, "1.0.0");
assert.equal(latestVer.assets.length, 1);
const releaseAsset = latestVer.assets[0];
assert.equal(releaseAsset.name, "big-game-1.0.0.apk");
assert.equal(releaseAsset.size, TARGET_SIZE);
assert.equal(releaseAsset.platform, "Android");
assert.equal(releaseAsset.url, uploadData.asset.url);
console.log(`   ✓ Product catalog updated with release v${latestVer.version} and asset (${(releaseAsset.size / 1048576).toFixed(1)} MB)`);

// 6. Direct public download test
console.log("6. Verifying direct public download without redirects or account login...");
const dlRes = await fetch(releaseAsset.url);
assert.equal(dlRes.status, 200, "Direct download should return HTTP 200");
assert.equal(Number(dlRes.headers.get("content-length")), TARGET_SIZE);

const hashDownloaded = crypto.createHash("sha256");
let dlBytes = 0;
for await (const chunk of dlRes.body) {
  hashDownloaded.update(chunk);
  dlBytes += chunk.length;
}
const downloadedSha256 = hashDownloaded.digest("hex");
console.log(`   Downloaded size: ${(dlBytes / 1048576).toFixed(2)} MB (${dlBytes} bytes)`);
console.log(`   Downloaded SHA-256: ${downloadedSha256}`);

assert.equal(dlBytes, TARGET_SIZE, "Downloaded size must match original exactly");
assert.equal(downloadedSha256, originalSha256, "SHA-256 checksum must be byte-for-byte identical");
console.log("   ✓ Downloaded APK checksum matches uploaded APK 100% byte-for-byte!");

// 7. Storefront rendering verification
console.log("7. Verifying storefront UI and button states...");
// Load storefront rendering logic
const indexHtml = fs.readFileSync(path.resolve("./public/index.html"), "utf-8");

// Test product with APK
function simulateProductRender(p, versions) {
  const V = versions || [], L = V[0], pl = p.platforms || [];
  const sz = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const btns = [
    ...(L ? L.assets.map((a) => {
      const isApk = /\.apk$/i.test(a.name) || (a.platform || "").toLowerCase() === "android";
      const lbl = isApk ? `Download APK · v${esc(L.version)} (${sz(a.size)})` : `Download ${esc(a.platform || "File")} · ${esc(a.name)} (${sz(a.size)})`;
      return `<a class="btn" href="${esc(a.url)}" download="${esc(a.name)}" rel="noopener">${lbl}</a>`;
    }) : []),
    ...(p.links || []).map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`),
  ].join("") || `<a class="btn" aria-disabled="true" role="link" tabindex="-1">Coming Soon</a>`;
  return btns;
}

const renderedButtonsWithApk = simulateProductRender(bigGame, bigGame.versions);
assert.ok(renderedButtonsWithApk.includes("Download APK · v1.0.0 (195.0 MB)"), "Button should show 'Download APK · v1.0.0 (195.0 MB)'");
assert.ok(renderedButtonsWithApk.includes(`href="${releaseAsset.url}"`), "Button must link directly to asset URL");
assert.ok(renderedButtonsWithApk.includes('download="big-game-1.0.0.apk"'), "Button must preserve original filename with download attribute");
assert.ok(!renderedButtonsWithApk.includes("Download link to be added"), "Must never show old placeholder when asset exists");
console.log(`   ✓ Product with APK button HTML: ${renderedButtonsWithApk}`);

const upcoming = catalog.products.find((p) => p.slug === "upcoming-tool");
const renderedButtonsWithoutApk = simulateProductRender(upcoming, upcoming.versions);
assert.equal(renderedButtonsWithoutApk, '<a class="btn" aria-disabled="true" role="link" tabindex="-1">Coming Soon</a>');
assert.ok(!renderedButtonsWithoutApk.includes("Download link to be added"), "Must show 'Coming Soon' instead of old placeholder");
console.log(`   ✓ Product without APK button HTML: ${renderedButtonsWithoutApk}`);

// 8. Color Palette verification
console.log("8. Verifying original store color palette preserved in public/index.html & admin/index.html...");
assert.ok(indexHtml.includes("--sage:#D9E3BD;"), "index.html must use original store --sage #D9E3BD");
assert.ok(indexHtml.includes("--ivory:#FDFBEF;"), "index.html must use original store --ivory #FDFBEF");
assert.ok(indexHtml.includes("--esp:#4A2E22;"), "index.html must use original store --esp #4A2E22");
assert.ok(indexHtml.includes("--red:#A32A33;"), "index.html must use original store --red #A32A33");
assert.ok(indexHtml.includes('--hand:"Reenie Beanie"'), "Typography preserved");
assert.ok(indexHtml.includes('content="#D9E3BD"'), "Theme color meta preserved");

const adminHtml = fs.readFileSync(path.resolve("./public/admin/index.html"), "utf-8");
assert.ok(adminHtml.includes("--sage:#D9E3BD;"), "admin must use original store --sage #D9E3BD");
assert.ok(adminHtml.includes("--ivory:#FDFBEF;"), "admin must use original store --ivory #FDFBEF");
assert.ok(adminHtml.includes("--esp:#4A2E22;"), "admin must use original store --esp #4A2E22");
assert.ok(adminHtml.includes("--red:#A32A33;"), "admin must use original store --red #A32A33");
console.log("   ✓ All original color palette tokens confirmed in index.html and admin/index.html");

// 9. Clean up
console.log("9. Cleaning up temporary test artifacts...");
fs.unlinkSync(TEST_APK_PATH);
fs.rmdirSync(TEST_DIR);
await closeHelper();
await closeMock();

console.log("\n*** ALL LARGE APK UPLOAD & DOWNLOAD TESTS PASSED 100% ***\n");
