// Regression test for admin login password field interaction
// Run: node test/login-regression.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import os from "node:os";

import { fileURLToPath } from "node:url";

const ok = (n) => console.log("  ✓", n);
console.log("Running admin login password field regression tests...\n");

// 1. Static source code checks
const adminHtmlPath = fileURLToPath(new URL("../public/admin/index.html", import.meta.url));
const html = fs.readFileSync(adminHtmlPath, "utf-8");

assert.ok(html.includes('id="pw"'), "Password input exists with id='pw'");
assert.ok(html.includes('type="password"'), "Password input has type='password'");
assert.ok(!html.includes('e=>e.key==="Enter"&&go()'), "Bug pattern 'e=>e.key===\"Enter\"&&go()' must NOT be present (causes return false on non-Enter, blocking keystrokes)");
assert.ok(
  html.includes('$("#pw").onkeydown=e=>{if(e.key==="Enter"') ||
  html.includes('addEventListener("keydown"') ||
  html.includes('e.key==="Enter"'),
  "Password input onkeydown handles Enter without returning false on other keys"
);
ok("source code check: onkeydown does not suppress default keydown action");

// 2. Headless Chrome / Edge real browser interaction test
async function findBrowser() {
  const candidates = [
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    process.env.CHROME_BIN,
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const browserPath = await findBrowser();
if (!browserPath) {
  console.log("  ⚠ No Chrome/Edge binary found, skipping headless browser interaction test.");
  console.log("\nRegression tests passed (source verification).");
  process.exit(0);
}

let lastLoginReceived = null;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/admin/" || url.pathname === "/admin/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }
  if (url.pathname === "/api/me") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ authenticated: false }));
  }
  if (url.pathname === "/api/login" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => body += chunk);
    req.on("end", () => {
      lastLoginReceived = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const srvPort = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});

const debugPort = srvPort + 100;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-test-"));
const proc = spawn(browserPath, [
  "--headless=new",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${tmpDir}`,
  "--no-first-run",
  "--no-default-browser-check"
]);

try {
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      const data = await res.json();
      wsUrl = data.webSocketDebuggerUrl;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(wsUrl, "Browser CDP started");

  const listRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const pages = await listRes.json();
  const page = pages.find((p) => p.type === "page") || pages[0];
  const pageWs = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => pageWs.onopen = r);

  let idCounter = 1;
  const pending = new Map();
  let loadResolve = null;
  const loadPromise = new Promise((r) => loadResolve = r);

  pageWs.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Page.loadEventFired") {
      if (loadResolve) loadResolve();
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };

  const send = (method, params = {}) => new Promise((resolve) => {
    const id = idCounter++;
    pending.set(id, resolve);
    pageWs.send(JSON.stringify({ id, method, params }));
  });

  await send("Page.enable");
  await send("Runtime.enable");

  // Load deployed-style /admin/ route
  await send("Page.navigate", { url: `http://127.0.0.1:${srvPort}/admin/` });
  await loadPromise;

  // Wait for #pw input to be rendered after boot() checks /api/me
  let pwReady = false;
  for (let i = 0; i < 50; i++) {
    const check = await send("Runtime.evaluate", { expression: "Boolean(document.querySelector('#pw'))" });
    if (check.result?.result?.value) { pwReady = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(pwReady, "#pw input must be rendered on the page");

  // Check input accessibility & properties
  const props = (await send("Runtime.evaluate", {
    expression: "JSON.stringify({ disabled: document.querySelector('#pw').disabled, readOnly: document.querySelector('#pw').readOnly, visible: document.querySelector('#pw').offsetParent !== null })"
  })).result.result.value;
  const parsedProps = JSON.parse(props);
  assert.equal(parsedProps.disabled, false);
  assert.equal(parsedProps.readOnly, false);
  assert.equal(parsedProps.visible, true);
  ok("password input is visible, enabled, editable, and not readonly");

  // Mouse focus test
  const box = (await send("Runtime.evaluate", {
    expression: "const r = document.querySelector('#pw').getBoundingClientRect(); ({ x: r.x + r.width/2, y: r.y + r.height/2 })",
    returnByValue: true
  })).result.result.value;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left" });
  let activeId = (await send("Runtime.evaluate", { expression: "document.activeElement.id" })).result.result.value;
  assert.equal(activeId, "pw");
  ok("mouse click successfully focuses password input");

  // Keyboard typing test
  const testSecret = "SuperSecret_123$!";
  for (const char of testSecret) {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: char });
    await send("Input.dispatchKeyEvent", { type: "char", text: char });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: char });
  }
  const typedVal = (await send("Runtime.evaluate", { expression: "document.querySelector('#pw').value" })).result.result.value;
  assert.equal(typedVal, testSecret);
  ok(`keyboard input received properly (typed "${testSecret}")`);

  // Enter key submission test
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(lastLoginReceived, { password: testSecret });
  ok("Enter key correctly submits entered password to /api/login");

  // Test re-rendering via showLogin()
  await send("Runtime.evaluate", { expression: "showLogin()" });
  await new Promise((r) => setTimeout(r, 200));
  await send("Runtime.evaluate", { expression: "document.querySelector('#pw').focus()" });
  for (const char of "reRenderTest") {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: char });
    await send("Input.dispatchKeyEvent", { type: "char", text: char });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: char });
  }
  const reRenderVal = (await send("Runtime.evaluate", { expression: "document.querySelector('#pw').value" })).result.result.value;
  assert.equal(reRenderVal, "reRenderTest");
  ok("password input remains fully functional after showLogin() replaces innerHTML");

} finally {
  proc.kill();
  server.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log("\nAll regression tests passed successfully.");
