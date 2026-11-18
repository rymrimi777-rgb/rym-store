// Local preview server with mock GitHub
// Run: node test/dev.mjs [port]
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { startMock } from "./mock-github.mjs";
import { handle } from "../server/router.js";

const port = Number(process.argv[2]) || 8788;
const { port: mockPort, files } = await startMock();

const env = {
  GITHUB_TOKEN: "dev-token",
  GITHUB_OWNER: "local",
  GITHUB_REPO: "store",
  GITHUB_BRANCH: "main",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "local-dev-password",
  SESSION_SECRET: "local-dev-session-secret-40-chars-long-secure",
  GITHUB_API: `http://127.0.0.1:${mockPort}`,
  GITHUB_UPLOADS: `http://127.0.0.1:${mockPort}`,
  MAX_UPLOAD_MB: "95",
};

// Seed initial products.json if it exists on disk
const prodFile = fileURLToPath(new URL("../public/data/products.json", import.meta.url));
if (fs.existsSync(prodFile)) {
  const content = fs.readFileSync(prodFile, "utf-8");
  files.set("public/data/products.json", { b: content, sha: "init-sha" });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = url.pathname;

  // API router
  if (pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuf = Buffer.concat(chunks);
    const body = bodyBuf.length === 0 ? undefined : bodyBuf;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }

    const webReq = new Request(`http://localhost:${port}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      duplex: "half",
    });

    try {
      const resp = await handle(webReq, env);
      const respHeaders = {};
      resp.headers.forEach((v, k) => {
        if (k === "set-cookie") {
          respHeaders[k] = resp.headers.getSetCookie ? resp.headers.getSetCookie() : v;
        } else {
          respHeaders[k] = v;
        }
      });
      res.writeHead(resp.status, respHeaders);
      const ab = await resp.arrayBuffer();
      res.end(Buffer.from(ab));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Admin route
  if (pathname === "/admin" || pathname === "/admin/") {
    const adminHtml = fileURLToPath(new URL("../public/admin/index.html", import.meta.url));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(adminHtml));
  }

  // Storefront & public files
  let filePath = fileURLToPath(new URL("../public" + (pathname === "/" ? "/index.html" : pathname), import.meta.url));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = "." + filePath.split(".").pop();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    return res.end(fs.readFileSync(filePath));
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(port, () => {
  console.log(`\nRYM Store preview server running at:`);
  console.log(`  Store:       http://localhost:${port}/`);
  console.log(`  Admin panel: http://localhost:${port}/admin/`);
  console.log(`  Password:    ${env.ADMIN_PASSWORD}\n`);
});
