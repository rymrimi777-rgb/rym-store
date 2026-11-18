import http from "node:http";
import crypto from "node:crypto";

export async function startMock() {
  const files = new Map();
  const releases = new Map();
  const blobs = new Map();

  let nextRelId = 101;
  let nextAssetId = 1001;
  let port = 0;

  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = decodeURI(parsed.pathname);
    const m = req.method;

    // Helper to read body buffer
    const readBody = () => new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

    // Asset download: /download/:id
    if (pathname.startsWith("/download/")) {
      const id = Number(pathname.split("/")[2]);
      const blob = blobs.get(id);
      if (!blob) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(blob.length) });
      return res.end(blob);
    }

    // Contents API: /repos/:o/:r/contents/*
    const contentsMatch = pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (contentsMatch) {
      const filePath = contentsMatch[1];
      if (m === "GET") {
        const file = files.get(filePath);
        if (!file) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ message: "Not Found" }));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          sha: file.sha,
          content: Buffer.from(file.b).toString("base64"),
        }));
      }
      if (m === "PUT") {
        const raw = await readBody();
        const json = JSON.parse(raw.toString("utf8"));
        const buf = Buffer.from(json.content, "base64");
        const fileSha = crypto.createHash("sha1").update(buf).digest("hex");
        files.set(filePath, { b: buf.toString("utf8"), buf, sha: fileSha });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ content: { sha: fileSha } }));
      }
      if (m === "DELETE") {
        files.delete(filePath);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({}));
      }
    }

    // Release Asset Upload: /repos/:o/:r/releases/:id/assets
    const assetUploadMatch = pathname.match(/^\/repos\/[^/]+\/[^/]+\/releases\/(\d+)\/assets$/);
    if (assetUploadMatch && m === "POST") {
      const relId = Number(assetUploadMatch[1]);
      const name = parsed.searchParams.get("name") || "asset";
      const buf = await readBody();
      const assetId = nextAssetId++;
      blobs.set(assetId, buf);
      const asset = {
        id: assetId,
        name,
        size: buf.length,
        browser_download_url: `http://127.0.0.1:${port}/download/${assetId}`,
      };
      const rel = releases.get(relId);
      if (rel) {
        if (!rel.assets) rel.assets = [];
        rel.assets.push(asset);
      }
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(asset));
    }

    // Release Asset Delete: /repos/:o/:r/releases/assets/:id
    const assetDelMatch = pathname.match(/^\/repos\/[^/]+\/[^/]+\/releases\/assets\/(\d+)$/);
    if (assetDelMatch && m === "DELETE") {
      const assetId = Number(assetDelMatch[1]);
      blobs.delete(assetId);
      for (const rel of releases.values()) {
        if (rel.assets) rel.assets = rel.assets.filter(a => a.id !== assetId);
      }
      res.writeHead(204);
      return res.end();
    }

    // Releases API: /repos/:o/:r/releases
    if (pathname.match(/^\/repos\/[^/]+\/[^/]+\/releases$/) && m === "POST") {
      const raw = await readBody();
      const json = JSON.parse(raw.toString("utf8"));
      const id = nextRelId++;
      const rel = { id, assets: [], ...json };
      releases.set(id, rel);
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(rel));
    }

    // Release Edit / Delete: /repos/:o/:r/releases/:id
    const relMatch = pathname.match(/^\/repos\/[^/]+\/[^/]+\/releases\/(\d+)$/);
    if (relMatch) {
      const id = Number(relMatch[1]);
      if (m === "PATCH") {
        const raw = await readBody();
        const json = JSON.parse(raw.toString("utf8"));
        const rel = releases.get(id);
        if (rel) Object.assign(rel, json);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(rel));
      }
      if (m === "DELETE") {
        releases.delete(id);
        res.writeHead(204);
        return res.end();
      }
    }

    // Git tag delete: /repos/:o/:r/git/refs/tags/:tag
    if (pathname.match(/^\/repos\/[^/]+\/[^/]+\/git\/refs\/tags\//) && m === "DELETE") {
      res.writeHead(204);
      return res.end();
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Not found: " + pathname }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    port = server.address().port;
    resolve();
  }));

  return {
    port,
    files,
    releases,
    blobs,
    close: () => server.close(),
  };
}
