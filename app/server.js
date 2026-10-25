// Heads Up helper: serves the app on this computer, fetches news feeds for it (a web page
// can't read other sites directly), keeps accounts for the people who use it on this PC,
// passes along announcements, and keeps the app up to date from GitHub.
// Needs only Node.js, no packages.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");

const PORT = +process.env.HEADSUP_PORT || 5178;
const HOST = "127.0.0.1";
const ALLOWED_HOSTS = new Set(["news.google.com", "store.steampowered.com", "www.hltv.org", "wttr.in"]);
const IDLE_EXIT_MS = 20 * 60 * 1000;   // the open app checks in every 4 minutes; quit once it's closed
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// Updates: the files listed in app/version.json on GitHub replace the ones here when its version is higher.
const UPDATE_BASE = process.env.HEADSUP_UPDATE_BASE || "https://raw.githubusercontent.com/THATLMG/heads-up/main/app/";
const UPDATABLE = new Set(["app.html", "server.js", "Heads Up.vbs", "icon.png", "heads-up.ico", "README.txt"]);
const UPDATE_EVERY_MS = 30 * 60 * 1000;   // while the app is open (it asks /api/version every 4 minutes)
let lastCheckAt = 0;

// Accounts live outside the app folder so updates never touch them.
const DATA_DIR = process.env.HEADSUP_DATA || path.join(process.env.APPDATA || os.homedir(), "Heads Up");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const SESSION_DAYS = 30;
const MAX_USERS = 50;

// Announcements: everyone reads announcements.json from GitHub. Only the owner's PC, which has the
// repository checked out, can publish new ones (by committing and pushing that file).
const ANNOUNCE_URL = process.env.HEADSUP_ANNOUNCE_URL || "https://raw.githubusercontent.com/THATLMG/heads-up/main/announcements.json";
const REPO_DIR = process.env.HEADSUP_REPO || path.join(os.homedir(), "heads-up");

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
  lastCheckAt = Date.now();
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
    let serverChanged = false;
    try { serverChanged = got.some(([n, buf]) => n === "server.js" && !buf.equals(fs.readFileSync(file("server.js")))); } catch {}
    for (const [name, buf] of got) {
      fs.writeFileSync(file(name + ".new"), buf);
      fs.renameSync(file(name + ".new"), file(name));
    }
    fs.writeFileSync(file("version.json"), JSON.stringify(remote, null, 2));
    lastUpdate = { from: local.version, to: remote.version, notes: remote.notes || "", at: Date.now() };
    console.log("Updated Heads Up from version " + local.version + " to " + remote.version);
    if (serverChanged) restartSelf();
  } catch (e) {
    console.log("Update check skipped: " + e.message);   // offline or GitHub unreachable; try again later
  }
}

// A new server.js only takes effect in a new process: hand the port over to a fresh copy of the helper.
function restartSelf() {
  console.log("Restarting to finish the update");
  server.close();
  setTimeout(() => {
    spawn(process.execPath, [file("server.js")], { cwd: __dirname, detached: true, stdio: "ignore", windowsHide: true,
      env: { ...process.env, HEADSUP_RESTART: "1" } }).unref();
    process.exit(0);
  }, 300);
}

// ---------- accounts ----------
let db = null;
function loadDb() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8")); } catch { db = {}; }
  db.users = db.users || {};
  db.sessions = db.sessions || {};
  return db;
}
let writing = Promise.resolve();
function saveDb() {
  writing = writing.then(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ACCOUNTS_FILE + ".tmp", JSON.stringify(db));
    fs.renameSync(ACCOUNTS_FILE + ".tmp", ACCOUNTS_FILE);
  }).catch((e) => console.log("Couldn't save accounts: " + e.message));
  return writing;
}

// Passwords and recovery codes are stored only as scrypt hashes with a random salt each.
const scrypt = (secret, salt) => new Promise((res, rej) =>
  crypto.scrypt(secret, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  return { salt: salt.toString("hex"), hash: (await scrypt(secret, salt)).toString("hex") };
}
async function checkSecret(secret, rec) {
  const k = await scrypt(secret, Buffer.from(rec?.salt || "00", "hex"));
  const h = Buffer.from(rec?.hash || "", "hex");
  return !!rec && h.length === k.length && crypto.timingSafeEqual(h, k);
}
function makeRecoveryCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = crypto.randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i++) s += A[b[i] % 32] + (i % 4 === 3 && i < 15 ? "-" : "");
  return s;
}
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{4})(?=.)/g, "$1-");
const userKey = (u) => String(u || "").trim().toLowerCase();
const tokenKey = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const publicUser = (u) => ({ username: u.username, createdAt: u.createdAt, settings: u.settings || {}, updatedAt: u.updatedAt || 0 });

function newSession(key) {
  const t = crypto.randomBytes(32).toString("hex");
  db.sessions[tokenKey(t)] = { user: key, at: Date.now() };
  return t;
}
function dropSessions(key) {
  for (const [k, s] of Object.entries(db.sessions)) if (s.user === key) delete db.sessions[k];
}
function sessionUser(req) {
  const m = (req.headers.authorization || "").match(/^Bearer ([a-f0-9]{64})$/);
  if (!m) return null;
  loadDb();
  const tk = tokenKey(m[1]), s = db.sessions[tk];
  if (!s || Date.now() - s.at > SESSION_DAYS * 864e5 || !db.users[s.user]) return null;
  s.at = Date.now();
  return { key: s.user, u: db.users[s.user], tk };
}

// Slow down password guessing: five misses locks that username for a minute.
const misses = new Map();
function lockedFor(key) {
  const m = misses.get(key);
  return m && m.until > Date.now() ? Math.ceil((m.until - Date.now()) / 1000) : 0;
}
function miss(key) {
  const m = misses.get(key) || { n: 0, until: 0 };
  m.n++;
  if (m.n >= 5) { m.n = 0; m.until = Date.now() + 60000; }
  misses.set(key, m);
}

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const pwProblem = (p) => typeof p !== "string" || p.length < 8 ? "Use a password of at least 8 characters." : p.length > 200 ? "That password is too long." : "";

async function accountApi(req, res, route, body) {
  loadDb();
  if (route === "create") {
    const username = String(body.username || "").trim();
    if (!USERNAME_RE.test(username)) return json(res, 400, { error: "Usernames are 3 to 20 letters, numbers, dots, dashes or underscores." });
    if (pwProblem(body.password)) return json(res, 400, { error: pwProblem(body.password) });
    const key = userKey(username);
    if (db.users[key]) return json(res, 409, { error: "That username is taken on this computer. Try another, or sign in." });
    if (Object.keys(db.users).length >= MAX_USERS) return json(res, 400, { error: "This computer already has the most accounts Heads Up allows." });
    const code = makeRecoveryCode();
    db.users[key] = { username, createdAt: Date.now(), pw: await hashSecret(body.password), rc: await hashSecret(code), settings: {}, updatedAt: 0 };
    const token = newSession(key);
    await saveDb();
    return json(res, 200, { token, user: publicUser(db.users[key]), recoveryCode: code });
  }
  if (route === "login") {
    const key = userKey(body.username), wait = lockedFor(key);
    if (wait) return json(res, 429, { error: "Too many wrong passwords. Try again in " + wait + " seconds." });
    const ok = await checkSecret(String(body.password || ""), db.users[key]?.pw);
    if (!ok || !db.users[key]) { miss(key); return json(res, 401, { error: "That username and password don't match." }); }
    misses.delete(key);
    const token = newSession(key);
    await saveDb();
    return json(res, 200, { token, user: publicUser(db.users[key]) });
  }
  if (route === "recover") {
    const key = userKey(body.username), wait = lockedFor(key);
    if (wait) return json(res, 429, { error: "Too many tries. Try again in " + wait + " seconds." });
    if (pwProblem(body.password)) return json(res, 400, { error: pwProblem(body.password) });
    const ok = await checkSecret(normCode(body.code), db.users[key]?.rc);
    if (!ok || !db.users[key]) { miss(key); return json(res, 401, { error: "That username and recovery code don't match." }); }
    misses.delete(key);
    const u = db.users[key], code = makeRecoveryCode();
    u.pw = await hashSecret(body.password);
    u.rc = await hashSecret(code);
    dropSessions(key);
    const token = newSession(key);
    await saveDb();
    return json(res, 200, { token, user: publicUser(u), recoveryCode: code });
  }

  const s = sessionUser(req);
  if (!s) return json(res, 401, { error: "You've been signed out. Sign in again." });
  if (route === "me") return json(res, 200, { user: publicUser(s.u) });
  if (route === "settings") {
    const text = JSON.stringify(body.settings ?? {});
    if (text.length > 200000) return json(res, 413, { error: "Those settings are too big to save." });
    s.u.settings = JSON.parse(text);
    s.u.updatedAt = Date.now();
    await saveDb();
    return json(res, 200, { updatedAt: s.u.updatedAt });
  }
  if (route === "logout") { delete db.sessions[s.tk]; await saveDb(); return json(res, 200, { ok: true }); }
  if (route === "delete") {
    if (!(await checkSecret(String(body.password || ""), s.u.pw))) return json(res, 401, { error: "That password isn't right." });
    dropSessions(s.key);
    delete db.users[s.key];
    await saveDb();
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: "Not found" });
}

// ---------- announcements ----------
let annCache = null;
async function getAnnouncements() {
  if (annCache && Date.now() - annCache.at < 2 * 60 * 1000) return annCache.data;
  const r = await fetch(ANNOUNCE_URL + "?t=" + Date.now(), { signal: AbortSignal.timeout(15000), headers: { "Cache-Control": "no-cache" } });
  const data = r.status === 404 ? { announcements: [] } : r.ok ? await r.json() : null;
  if (!data) throw new Error("GitHub answered " + r.status);
  annCache = { at: Date.now(), data };
  return data;
}
const isOwnerPc = () => fs.existsSync(path.join(REPO_DIR, ".git"));
function git(args) {
  return new Promise((res, rej) => execFile("git", args, { cwd: REPO_DIR, timeout: 90000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    (e, out, err) => (e ? rej(new Error(String(err || e.message).trim().split("\n").pop())) : res(out))));
}
let publishing = Promise.resolve();
function publishAnnouncements(change, message) {
  const job = publishing.then(async () => {
    await git(["pull", "--ff-only", "-q"]);
    const f = path.join(REPO_DIR, "announcements.json");
    let data = { announcements: [] };
    try { data = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    data.announcements = change(Array.isArray(data.announcements) ? data.announcements : []);
    fs.writeFileSync(f, JSON.stringify(data, null, 2) + "\n");
    await git(["add", "announcements.json"]);
    await git(["commit", "-q", "-m", message]);
    await git(["push", "-q"]);
    annCache = { at: Date.now(), data };
    return data;
  });
  publishing = job.catch(() => {});
  return job;
}
async function adminApi(req, res, route, body) {
  if (!isOwnerPc()) return json(res, 403, { error: "Only the owner's computer can send announcements." });
  try {
    if (route === "announce") {
      const title = String(body.title || "").trim(), message = String(body.message || "").trim();
      const link = String(body.link || "").trim(), days = Number(body.days) || 0;
      if (!title || title.length > 80) return json(res, 400, { error: "Give it a title of up to 80 characters." });
      if (message.length > 400) return json(res, 400, { error: "Keep the message under 400 characters." });
      if (link && !/^https:\/\/\S+$/.test(link)) return json(res, 400, { error: "Links have to start with https://" });
      const a = { id: Date.now().toString(36) + crypto.randomBytes(2).toString("hex"), title, message, level: body.level === "important" ? "important" : "info",
        date: new Date().toISOString(), ...(link ? { link } : {}), ...(days > 0 ? { expires: new Date(Date.now() + days * 864e5).toISOString() } : {}) };
      const data = await publishAnnouncements((list) => [a, ...list].slice(0, 15), "Announcement: " + title);
      return json(res, 200, data);
    }
    if (route === "remove") {
      const id = String(body.id || "");
      const data = await publishAnnouncements((list) => list.filter((a) => a.id !== id), "Remove announcement " + id);
      return json(res, 200, data);
    }
  } catch (e) {
    return json(res, 502, { error: "Couldn't publish to GitHub: " + e.message });
  }
  return json(res, 404, { error: "Not found" });
}

// ---------- opening links in the default browser ----------
// Windows' own "open this address" handler, called directly (no command shell), so a link
// can only ever open a web page.
function openInDefaultBrowser(res, target) {
  let url;
  try { url = new URL(String(target)); } catch {}
  if (!url || !/^https?:$/.test(url.protocol) || url.href.length > 2048) return json(res, 400, { error: "Only web addresses can be opened." });
  if (process.env.HEADSUP_OPEN_LOG) fs.appendFileSync(process.env.HEADSUP_OPEN_LOG, url.href + "\n");   // tests
  else execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url.href], { windowsHide: true }, () => {});
  return json(res, 200, { ok: true });
}

// ---------- http ----------
function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, "application/json; charset=utf-8", JSON.stringify(obj));

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 300000) { reject(new Error("too big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
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

const server = http.createServer(async (req, res) => {
  lastHit = Date.now();
  const hostHeader = (req.headers.host || "").split(":")[0];
  if (hostHeader !== "127.0.0.1" && hostHeader !== "localhost") return send(res, 403, "text/plain", "Forbidden");
  const u = new URL(req.url, "http://127.0.0.1");

  if (req.method === "POST") {
    // Only Heads Up's own page may change anything: other websites can't send this header
    // without a CORS preflight, which this helper never approves.
    const origin = req.headers.origin;
    if (req.headers["x-heads-up"] !== "1" || (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))) return json(res, 403, { error: "Forbidden" });
    let body;
    try { body = await readJson(req); } catch { return json(res, 400, { error: "Bad request" }); }
    if (u.pathname === "/api/open") return openInDefaultBrowser(res, body.url);
    const m = u.pathname.match(/^\/api\/(account|admin)\/([a-z]+)$/);
    if (!m) return json(res, 404, { error: "Not found" });
    try { return await (m[1] === "account" ? accountApi : adminApi)(req, res, m[2], body); }
    catch (e) { console.log("Request failed: " + e.message); return json(res, 500, { error: "Something went wrong. Try again." }); }
  }

  if (u.pathname === "/") return send(res, 200, "text/html; charset=utf-8", HEAD + fs.readFileSync(file("app.html"), "utf8") + "</body></html>");
  if (u.pathname === "/icon.png") return send(res, 200, "image/png", fs.readFileSync(file("icon.png")));
  if (u.pathname === "/api/ping") return send(res, 200, "text/plain", "heads-up ok");
  if (u.pathname === "/api/version" && Date.now() - lastCheckAt > UPDATE_EVERY_MS) checkForUpdate();
  if (u.pathname === "/api/version") return json(res, 200, { version: Number(localVersion().version) || 0, lastUpdate });
  if (u.pathname === "/api/fetch") return void proxy(u.searchParams.get("url") || "", res);
  if (u.pathname === "/api/account/me") return accountApi(req, res, "me", {});
  if (u.pathname === "/api/accounts") { loadDb(); return json(res, 200, { users: Object.values(db.users).map((x) => x.username).sort() }); }
  if (u.pathname === "/api/admin") return json(res, 200, { owner: isOwnerPc() });
  if (u.pathname === "/api/announcements") {
    try { return json(res, 200, await getAnnouncements()); }
    catch (e) { return json(res, 200, { announcements: annCache?.data?.announcements || [], error: e.message }); }
  }
  send(res, 404, "text/plain", "Not found");
});

let portTries = 0;
server.on("error", (e) => {
  // After an update restart, the old copy may need a moment to let go of the port.
  if (e.code === "EADDRINUSE" && process.env.HEADSUP_RESTART && ++portTries < 20) return void setTimeout(() => server.listen(PORT, HOST), 250);
  if (e.code === "EADDRINUSE") process.exit(0);   // already running: the launcher just opens the window
  throw e;
});
server.listen(PORT, HOST, () => {
  console.log("Heads Up is running at http://" + HOST + ":" + PORT);
  checkForUpdate();
});
setInterval(() => { if (Date.now() - lastHit > IDLE_EXIT_MS) process.exit(0); }, 60 * 1000);
