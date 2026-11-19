#!/usr/bin/env node
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mutateDb, readDb, gh, must, repoPath, cfg } from "./github.js";

const BIN = {
  apk: [0x50, 0x4b], aab: [0x50, 0x4b], zip: [0x50, 0x4b],
  exe: [0x4d, 0x5a], msi: [0xd0, 0xcf, 0x11, 0xe0],
  deb: [0x21, 0x3c, 0x61, 0x72], appimage: [0x7f, 0x45, 0x4c, 0x46],
  gz: [0x1f, 0x8b], pkg: [0x78, 0x61, 0x72, 0x21], dmg: null,
};

const startsWith = (u8, sig) => !sig || sig.every((b, i) => u8[i] === b);

export function loadEnv() {
  const env = { ...process.env };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const fn of [".dev.vars", ".env"]) {
    const fp = path.join(root, fn);
    if (fs.existsSync(fp)) {
      const content = fs.readFileSync(fp, "utf-8");
      for (const line of content.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq > 0) {
          const k = t.slice(0, eq).trim();
          let v = t.slice(eq + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (!env[k]) env[k] = v;
        }
      }
    }
  }
  return env;
}

export async function ensureRelease(env, slug, version) {
  const tag = `${slug}-v${version}`;
  const tagRes = await gh(env, `${repoPath(env)}/releases/tags/${encodeURIComponent(tag)}`);
  if (tagRes.ok) {
    return await tagRes.json();
  }

  // Check products.json if releaseId was recorded
  const { db } = await readDb(env);
  const prod = db.products.find((p) => p.slug === slug);
  const verObj = prod?.versions.find((v) => v.version === version);
  if (verObj?.releaseId) {
    const idRes = await gh(env, `${repoPath(env)}/releases/${verObj.releaseId}`);
    if (idRes.ok) return await idRes.json();
  }

  // Create new release
  const name = `${prod?.name || slug} ${version}`;
  const createRes = await gh(env, `${repoPath(env)}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: cfg(env).b,
      name,
      body: `Release v${version}`,
      draft: false,
      prerelease: false,
    }),
  });
  const rel = await (await must(createRes, `create release ${tag}`)).json();

  // If not yet in products.json, ensure version entry exists
  await mutateDb(env, (d) => {
    const p = d.products.find((x) => x.slug === slug);
    if (!p) return;
    if (!p.versions.some((v) => v.version === version)) {
      p.versions.unshift({
        version,
        date: new Date().toISOString().slice(0, 10),
        notes: `Release v${version}`,
        tag,
        releaseId: rel.id,
        assets: [],
      });
    } else {
      const v = p.versions.find((x) => x.version === version);
      v.releaseId = rel.id;
      v.tag = tag;
    }
    return p;
  }, `admin: record release ${tag}`).catch(() => {});

  return rel;
}

export function startUploadServer(port = 8790, customEnv = null) {
  const env = customEnv || loadEnv();

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Content-Length, X-RYM-Admin, X-Requested-With",
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      return res.end();
    }

    if (url.pathname === "/health" || url.pathname === "/status") {
      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
      return res.end(JSON.stringify({
        ok: true,
        service: "rym-upload-helper",
        maxUploadMb: 2048,
        repo: `${cfg(env).o}/${cfg(env).r}`,
      }));
    }

    if (url.pathname === "/upload" && req.method === "POST") {
      try {
        const slug = url.searchParams.get("slug");
        const version = (url.searchParams.get("version") || "").replace(/^v/i, "");
        const platform = url.searchParams.get("platform") || "Android";
        const rawName = url.searchParams.get("name") || "app.apk";
        const name = rawName.replace(/[^A-Za-z0-9._-]/g, "_");
        const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();

        if (!slug || !version) {
          res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
          return res.end(JSON.stringify({ error: "Missing slug or version" }));
        }

        if (!(ext in BIN)) {
          res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
          return res.end(JSON.stringify({ error: `File extension .${ext} is not allowed` }));
        }

        const lenHeader = req.headers["content-length"];
        if (!lenHeader) {
          res.writeHead(411, { "Content-Type": "application/json", ...corsHeaders });
          return res.end(JSON.stringify({ error: "Content-Length header required" }));
        }
        const totalBytes = Number(lenHeader);

        // Ensure GitHub release exists
        const rel = await ensureRelease(env, slug, version);

        // If asset with same name exists, delete it first
        if (rel.assets && rel.assets.length) {
          const oldAsset = rel.assets.find((a) => a.name === name);
          if (oldAsset) {
            await gh(env, `${repoPath(env)}/releases/assets/${oldAsset.id}`, { method: "DELETE" }).catch(() => {});
          }
        }

        // Stream upload to GitHub Releases
        const upBase = env.GITHUB_UPLOADS || cfg(env).up || "https://uploads.github.com";
        const targetUrl = new URL(`${upBase}/repos/${cfg(env).o}/${cfg(env).r}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`);

        const isHttp = targetUrl.protocol === "http:";
        const client = isHttp ? http : https;

        const ghReq = client.request(targetUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
            "Content-Type": "application/octet-stream",
            "Content-Length": String(totalBytes),
            "User-Agent": "rym-store-upload-helper",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }, (ghRes) => {
          let chunks = [];
          ghRes.on("data", (c) => chunks.push(c));
          ghRes.on("end", async () => {
            const rawBody = Buffer.concat(chunks).toString("utf-8");
            if (ghRes.statusCode >= 200 && ghRes.statusCode < 300) {
              const asset = JSON.parse(rawBody);
              asset.platform = platform;
              asset.url = asset.browser_download_url;

              // Update products.json with real asset URL, version and file size
              const updatedProduct = await mutateDb(env, (db) => {
                const prod = db.products.find((p) => p.slug === slug);
                if (!prod) throw new Error("Product not found: " + slug);
                let ver = prod.versions.find((v) => v.version === version);
                if (!ver) {
                  ver = {
                    version,
                    date: new Date().toISOString().slice(0, 10),
                    notes: `Release v${version}`,
                    tag: `${slug}-v${version}`,
                    releaseId: rel.id,
                    assets: [],
                  };
                  prod.versions.unshift(ver);
                }
                ver.assets = (ver.assets || []).filter((a) => a.name !== name);
                ver.assets.push({
                  id: asset.id,
                  name: asset.name,
                  size: asset.size,
                  platform,
                  url: asset.browser_download_url,
                });
                return prod;
              }, `admin: upload large asset ${name} for ${slug} v${version}`);

              res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
              res.end(JSON.stringify({ ok: true, asset, product: updatedProduct }));
            } else {
              res.writeHead(ghRes.statusCode || 502, { "Content-Type": "application/json", ...corsHeaders });
              res.end(JSON.stringify({ error: `GitHub asset upload failed (${ghRes.statusCode}): ${rawBody}` }));
            }
          });
        });

        ghReq.on("error", (err) => {
          res.writeHead(502, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: `Upload helper network error: ${err.message}` }));
        });

        // Pipe directly from client to GitHub
        req.pipe(ghReq);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" ? address.port : port;
      resolve({
        server,
        port: actualPort,
        close: () => new Promise((cb) => server.close(cb)),
      });
    });
  });
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  const fileArg = getArg("--file");
  const slugArg = getArg("--slug");
  const verArg = getArg("--version");
  const plArg = getArg("--platform") || "Android";
  const portArg = Number(getArg("--port") || process.env.PORT || 8790);

  if (fileArg && slugArg && verArg) {
    // CLI direct upload mode
    const env = loadEnv();
    if (!fs.existsSync(fileArg)) {
      console.error(`File not found: ${fileArg}`);
      process.exit(1);
    }
    const stat = fs.statSync(fileArg);
    const fileName = path.basename(fileArg);
    console.log(`Uploading ${fileName} (${(stat.size / 1048576).toFixed(1)} MB) to release ${slugArg}-v${verArg}...`);

    const rel = await ensureRelease(env, slugArg, verArg);
    console.log(`GitHub release confirmed (ID: ${rel.id})`);

    const upBase = env.GITHUB_UPLOADS || cfg(env).up || "https://uploads.github.com";
    const targetUrl = new URL(`${upBase}/repos/${cfg(env).o}/${cfg(env).r}/releases/${rel.id}/assets?name=${encodeURIComponent(fileName)}`);

    const client = targetUrl.protocol === "http:" ? http : https;
    const ghReq = client.request(targetUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(stat.size),
        "User-Agent": "rym-store-upload-helper",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }, (ghRes) => {
      let chunks = [];
      ghRes.on("data", (c) => chunks.push(c));
      ghRes.on("end", async () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        if (ghRes.statusCode >= 200 && ghRes.statusCode < 300) {
          const asset = JSON.parse(body);
          console.log(`Asset uploaded successfully! Asset ID: ${asset.id}`);
          console.log(`Download URL: ${asset.browser_download_url}`);
          await mutateDb(env, (db) => {
            const p = db.products.find((x) => x.slug === slugArg);
            if (!p) throw new Error("Product not found: " + slugArg);
            let ver = p.versions.find((v) => v.version === verArg);
            if (!ver) {
              ver = {
                version: verArg,
                date: new Date().toISOString().slice(0, 10),
                notes: `Release v${verArg}`,
                tag: `${slugArg}-v${verArg}`,
                releaseId: rel.id,
                assets: [],
              };
              p.versions.unshift(ver);
            }
            ver.assets = (ver.assets || []).filter((a) => a.name !== fileName);
            ver.assets.push({
              id: asset.id,
              name: asset.name,
              size: asset.size,
              platform: plArg,
              url: asset.browser_download_url,
            });
            return p;
          }, `admin: upload large asset ${fileName} for ${slugArg} v${verArg}`);
          console.log(`products.json updated and committed to GitHub.`);
          process.exit(0);
        } else {
          console.error(`Upload failed (${ghRes.statusCode}): ${body}`);
          process.exit(1);
        }
      });
    });

    const fileStream = fs.createReadStream(fileArg);
    let uploaded = 0;
    fileStream.on("data", (chunk) => {
      uploaded += chunk.length;
      process.stdout.write(`\rProgress: ${(uploaded / stat.size * 100).toFixed(1)}% (${(uploaded / 1048576).toFixed(1)} MB / ${(stat.size / 1048576).toFixed(1)} MB)`);
    });
    fileStream.pipe(ghReq);
  } else {
    // Daemon server mode
    startUploadServer(portArg).then(({ port }) => {
      console.log(`RYM Upload Helper running on http://127.0.0.1:${port}`);
      console.log(`Supports APK and large asset uploads up to 2 GB with direct GitHub streaming.`);
    });
  }
}
