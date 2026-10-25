// Heads Up helper: serves the app on this computer, fetches news feeds for it (a web page
// can't read other sites directly), and keeps the app up to date from GitHub.
// Needs only Node.js, no packages.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = +process.env.HEADSUP_PORT || 5178;
const HOST = "127.0.0.1";
const ALLOWED_HOSTS = new Set(["news.google.com", "store.steampowered.com", "www.hltv.org", "wttr.in"]);
const IDLE_EXIT_MS = 20 * 60 * 1000;   // the open app checks in every 4 minutes; quit once it's closed
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// Updates: the files listed in app/version.json on GitHub replace the ones here when its version is higher.
const UPDATE_BASE = process.env.HEADSUP_UPDATE_BASE || "https://raw.githubusercontent.com/THATLMG/heads-up/main/app/";
const UPDATABLE = new Set(["app.html", "server.js", "Heads Up.vbs", "icon.png", "heads-up.ico", "README.txt"]);
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;

// Same document wrapper the Claude artifact viewer puts around the page.
const HEAD = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<link rel="icon" href="/icon.png">'
  + "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}"
  + "body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>";

let lastHit = Date.now();
let lastUpdate = null;   // {from, to, notes, at} after an update this run

const file = (name) => path.join(__dirname, name);
function localVersion() {
  try { return JSON.parse(fs.readFileSync(file("version.json"), "utf8")); } catch { return { version: 0 }; }
}

async function checkForUpdate() {
  try {
    const r = await fetch(UPDATE_BASE + "version.json?t=" + Date.now(), { signal: AbortSignal.timeout(15000), headers: { "Cache-Control": "no-cache" } });
    if (!r.ok) return;
    const remote = await r.json();
    const local = localVersion();
    if (!(Number(remote.version) > Number(local.version))) return;
    const names = Array.isArray(remote.files) ? remote.files.filter((n) => UPDATABLE.has(n)) : [];
    if (!names.length) return;
    // Download everything first, so a dropped connection never leaves a half-updated app.
    const got = [];
    for (const name of names) {
      const f = await fetch(UPDATE_BASE + encodeURIComponent(name) + "?v=" + remote.version, { signal: AbortSignal.timeout(30000) });
      if (!f.ok) return;
      const buf = Buffer.from(await f.arrayBuffer());
      if (!buf.length) return;
      got.push([name, buf]);
    }
    for (const [name, buf] of got) {
      fs.writeFileSync(file(name + ".new"), buf);
      fs.renameSync(file(name + ".new"), file(name));
    }
    fs.writeFileSync(file("version.json"), JSON.stringify(remote, null, 2));
    lastUpdate = { from: local.version, to: remote.version, notes: remote.notes || "", at: Date.now() };
    console.log("Updated Heads Up from version " + local.version + " to " + remote.version);
  } catch (e) {
    console.log("Update check skipped: " + e.message);   // offline or GitHub unreachable; try again later
  }
}

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

async function proxy(target, res) {
  let url;
  try { url = new URL(target); } catch { return send(res, 400, "text/plain", "Bad address"); }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return send(res, 403, "text/plain", "Heads Up only reads its own news sources");
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    if (!r.ok) return send(res, 502, "text/plain", url.hostname + " answered " + r.status);
    send(res, 200, "text/plain; charset=utf-8", text);
  } catch (e) {
    send(res, 502, "text/plain", "Couldn't reach " + url.hostname + " (" + (e.name === "TimeoutError" ? "timed out" : e.message) + ")");
  }
}

const server = http.createServer((req, res) => {
  lastHit = Date.now();
  const hostHeader = (req.headers.host || "").split(":")[0];
  if (hostHeader !== "127.0.0.1" && hostHeader !== "localhost") return send(res, 403, "text/plain", "Forbidden");
  const u = new URL(req.url, "http://127.0.0.1");
  if (u.pathname === "/") return send(res, 200, "text/html; charset=utf-8", HEAD + fs.readFileSync(file("app.html"), "utf8") + "</body></html>");
  if (u.pathname === "/icon.png") return send(res, 200, "image/png", fs.readFileSync(file("icon.png")));
  if (u.pathname === "/api/ping") return send(res, 200, "text/plain", "heads-up ok");
  if (u.pathname === "/api/version") return send(res, 200, "application/json", JSON.stringify({ version: Number(localVersion().version) || 0, lastUpdate }));
  if (u.pathname === "/api/fetch") return void proxy(u.searchParams.get("url") || "", res);
  send(res, 404, "text/plain", "Not found");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") process.exit(0);   // already running: the launcher just opens the window
  throw e;
});
server.listen(PORT, HOST, () => {
  console.log("Heads Up is running at http://" + HOST + ":" + PORT);
  checkForUpdate();
  setInterval(checkForUpdate, UPDATE_EVERY_MS);
});
setInterval(() => { if (Date.now() - lastHit > IDLE_EXIT_MS) process.exit(0); }, 60 * 1000);
