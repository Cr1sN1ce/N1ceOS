// User Management Service — runs ONLY in the Electron main process.
// Passwords: scrypt (memory-hard KDF, built into Node) with a unique 16-byte salt per user.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const NAME = /^[a-z][a-z0-9_-]{2,31}$/;
const RESERVED = new Set(["root", "system", "nobody", "daemon", "admin", "n1ce", "guest"]);
const IDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEYRE = /^[\w.:-]{1,100}$/;
const MAXMEM = 128 * 1024 * 1024;

module.exports = function (root, onWipe = () => {}) {
  const sysDir = path.join(root, "system"), usersDir = path.join(root, "users"), trashDir = path.join(root, "trash");
  const sysFile = path.join(sysDir, "users.json");
  [sysDir, usersDir, trashDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const atomic = (f, data) => { const t = f + ".tmp"; fs.writeFileSync(t, data); fs.renameSync(t, f); };
  const loadDb = () => { try { return JSON.parse(fs.readFileSync(sysFile, "utf8")); } catch { return { users: [] }; } };
  const saveDb = (db) => atomic(sysFile, JSON.stringify(db));
  const udir = (id) => { // users are addressed ONLY by random id; path is verified
    if (typeof id !== "string" || !IDRE.test(id)) throw new Error("invalid user id");
    const p = path.join(usersDir, id);
    if (path.dirname(p) !== usersDir) throw new Error("invalid path");
    return p;
  };
  const hash = (pw) => {
    const s = crypto.randomBytes(16), N = 32768, r = 8, p = 1;
    return ["scrypt", N, r, p, s.toString("base64"), crypto.scryptSync(pw, s, 64, { N, r, p, maxmem: MAXMEM }).toString("base64")].join("$");
  };
  const verify = (pw, st) => {
    try {
      if (typeof pw !== "string") return false;
      const [, N, r, p, s, h] = st.split("$");
      const x = crypto.scryptSync(pw, Buffer.from(s, "base64"), 64, { N: +N, r: +r, p: +p, maxmem: MAXMEM });
      return crypto.timingSafeEqual(x, Buffer.from(h, "base64"));
    } catch { return false; }
  };
  const DUMMY = hash("dummy-password");
  const pub = (u) => ({ id: u.id, username: u.username, display: u.display, role: u.role, created: u.created });

  // ---- per-user key/value store (all user data lives under users/<id>/) ----
  const kvs = new Map(), dirty = new Set(); let tm = null;
  const kvFile = (id) => path.join(udir(id), "kv.json");
  const kvOf = (id) => { if (!kvs.has(id)) { let o = {}; try { o = JSON.parse(fs.readFileSync(kvFile(id), "utf8")); } catch {} kvs.set(id, o); } return kvs.get(id); };
  const flush = (id) => { if (!kvs.has(id) || !dirty.has(id)) return; dirty.delete(id); try { fs.mkdirSync(udir(id), { recursive: true }); atomic(kvFile(id), JSON.stringify(kvs.get(id))); } catch {} };
  const mark = (id) => { dirty.add(id); clearTimeout(tm); tm = setTimeout(() => [...dirty].forEach(flush), 300); };
  const flushAll = () => [...dirty].forEach(flush);

  const sessions = new Map(); // webContents id -> { token, uid }  (in memory only)
  const fails = new Map();
  const cur = (wc) => { const s = sessions.get(wc); return s ? s.uid : null; };
  const me = (wc) => { const uid = cur(wc); const u = uid && loadDb().users.find((x) => x.id === uid); if (!u) throw new Error("Not authenticated"); return u; };
  const adminOnly = (wc) => { const u = me(wc); if (u.role !== "admin") throw new Error("Permission denied"); return u; };

  const checkNew = (db, { username, display, password, role }) => {
    username = String(username || "").trim().toLowerCase(); display = String(display || "").trim();
    if (!NAME.test(username)) throw new Error("Invalid username: 3-32 chars, a-z, 0-9, _ or -, starting with a letter");
    if (RESERVED.has(username)) throw new Error("This username is reserved");
    if (db.users.some((u) => u.username === username)) throw new Error("Username already exists");
    if (!display || display.length > 40) throw new Error("Display name must be 1-40 characters");
    if (typeof password !== "string" || password.length < 8 || password.length > 128) throw new Error("Password must be 8-128 characters");
    return { username, display, role: role === "admin" ? "admin" : "user" };
  };
  const addUser = (db, o) => {
    const v = checkNew(db, o);
    const u = { id: crypto.randomUUID(), ...v, created: Date.now(), pw: hash(o.password) };
    fs.mkdirSync(udir(u.id), { recursive: true }); atomic(path.join(udir(u.id), "kv.json"), "{}");
    db.users.push(u); saveDb(db); return u;
  };
  const start = (wc, u) => { flushAll(); sessions.set(wc, { token: crypto.randomBytes(32).toString("hex"), uid: u.id }); return { ok: true, user: pub(u), kv: kvOf(u.id) }; };

  const delRules = (reqU, db, name) => {
    name = String(name || "");
    if (!NAME.test(name)) return `deluser: invalid username '${name.slice(0, 40)}'`;
    if (reqU.role !== "admin") return "deluser: permission denied (administrator required)";
    const t = db.users.find((u) => u.username === name);
    if (!t) return `deluser: user '${name}' does not exist`;
    if (t.id === reqU.id) return "deluser: cannot remove the currently logged-in user";
    if (t.role === "admin" && db.users.filter((u) => u.role === "admin").length <= 1) return "deluser: cannot remove the last administrator";
    return null;
  };
  const wipe = (db, t) => { // move dir to trash -> commit db -> delete; roll back on failure
    const d = udir(t.id), tr = path.join(trashDir, t.id + "-" + Date.now()); let moved = false;
    try {
      kvs.delete(t.id); dirty.delete(t.id);
      if (fs.existsSync(d)) { fs.renameSync(d, tr); moved = true; }
      db.users = db.users.filter((u) => u.id !== t.id); saveDb(db);
      for (const [k, s] of sessions) if (s.uid === t.id) sessions.delete(k);
      fs.rmSync(tr, { recursive: true, force: true });
    } catch (e) { if (moved && !fs.existsSync(d) && fs.existsSync(tr)) fs.renameSync(tr, d); throw e; }
    try { onWipe(t.id); } catch {}
  };

  return {
    _udir: udir, cur, flushAll,
    // Downloads are stored in the user's own folder: users/<id>/downloads/ (removed with the account).
    downloadPath(wc) {
      const uid = cur(wc); if (!uid) throw new Error("Not authenticated");
      const dir = path.join(udir(uid), "downloads"); fs.mkdirSync(dir, { recursive: true });
      const name = arguments[1];
      let base = path.basename(String(name || "download")).replace(/[^\w.\- ()]/g, "_").replace(/^\.+/, "").slice(0, 120) || "download";
      const ext = path.extname(base), stem = path.basename(base, ext); let n = base, i = 1;
      while (fs.existsSync(path.join(dir, n))) n = `${stem} (${i++})${ext}`;
      return path.join(dir, n);
    },
    filePath(wc, name) {
      const uid = cur(wc); if (!uid) throw new Error("Not authenticated");
      const dir = path.join(udir(uid), "downloads"), f = path.join(dir, path.basename(String(name)));
      if (path.dirname(f) !== dir) throw new Error("bad path"); return f;
    },
    fileRemove(wc, name) { fs.rmSync(this.filePath(wc, name), { force: true }); return { ok: true }; },
    status(wc) { flushAll(); sessions.delete(wc); const db = loadDb(); return { ok: true, hasUsers: db.users.length > 0, users: db.users.map((u) => ({ username: u.username, display: u.display })) }; },
    setup(wc, a) { const db = loadDb(); if (db.users.length) throw new Error("Setup already completed"); return start(wc, addUser(db, { ...a, role: "admin" })); },
    login(wc, { username, password }) {
      username = String(username || "").toLowerCase(); const f = fails.get(username) || { n: 0, until: 0 };
      if (Date.now() < f.until) throw new Error("Too many attempts. Try again in a moment.");
      const u = loadDb().users.find((x) => x.username === username);
      const ok = verify(password, u ? u.pw : DUMMY) && !!u;
      if (!ok) { f.n++; if (f.n >= 5) { f.until = Date.now() + 30000; f.n = 0; } fails.set(username, f); throw new Error("Incorrect username or password"); }
      fails.delete(username); return start(wc, u);
    },
    logout(wc) { flushAll(); sessions.delete(wc); return { ok: true }; },
    kvSet(wc, { k, v }) { const u = me(wc); if (!KEYRE.test(String(k))) throw new Error("bad key"); kvOf(u.id)[k] = v; mark(u.id); return { ok: true }; },
    kvClear(wc) { const u = me(wc); kvs.set(u.id, {}); mark(u.id); return { ok: true }; },
    info(wc) { return { ok: true, info: pub(me(wc)) }; },
    setDisplay(wc, d) { const u = me(wc); d = String(d || "").trim(); if (!d || d.length > 40) throw new Error("Display name must be 1-40 characters"); const db = loadDb(); db.users.find((x) => x.id === u.id).display = d; saveDb(db); return { ok: true, display: d }; },
    setPassword(wc, { oldPassword, newPassword }) {
      const u = me(wc); if (!verify(oldPassword, u.pw)) throw new Error("Current password is incorrect");
      if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) throw new Error("Password must be 8-128 characters");
      const db = loadDb(); db.users.find((x) => x.id === u.id).pw = hash(newPassword); saveDb(db); return { ok: true };
    },
    deleteSelf(wc, { password, confirm }) {
      const u = me(wc); if (!verify(password, u.pw)) throw new Error("Password is incorrect");
      if (confirm !== u.username) throw new Error("Username confirmation does not match");
      const db = loadDb();
      if (u.role === "admin" && db.users.length > 1 && db.users.filter((x) => x.role === "admin").length <= 1) throw new Error("You are the last administrator: promote or create another administrator first");
      wipe(db, u); return { ok: true };
    },
    list(wc) { adminOnly(wc); return { ok: true, users: loadDb().users.map(pub) }; },
    create(wc, a) { adminOnly(wc); return { ok: true, user: pub(addUser(loadDb(), a)) }; },
    check(wc, { username }) { const e = delRules(me(wc), loadDb(), username); return e ? { ok: false, error: e } : { ok: true }; },
    remove(wc, { username }) {
      const db = loadDb(), e = delRules(me(wc), db, username); if (e) return { ok: false, error: e };
      wipe(db, db.users.find((u) => u.username === username)); return { ok: true, msg: `deluser: user '${username}' successfully removed` };
    },
  };
};
