const { app, BrowserWindow, ipcMain, shell, session } = require("electron");
const path = require("path"), fs = require("fs");
const isHttp = (u) => /^https?:\/\//i.test(String(u));
let win, svc; const hooked = new Set();

function hookDownloads(ses) {
  ses.on("will-download", (_e, item) => {
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
    const send = (d) => win && !win.isDestroyed() && win.webContents.send("dl", { id, ...d });
    let sp; try { sp = svc.downloadPath(win.webContents.id, item.getFilename()); } catch { item.cancel(); return; }
    if (item.getTotalBytes() > 1024 ** 3) { item.cancel(); send({ name: item.getFilename(), st: "Too large (limit 1 GB)" }); return; }
    item.setSavePath(sp); // saved straight into the user's own N1ceOS Downloads folder
    send({ name: item.getFilename(), u: item.getURL(), st: "Starting…" });
    item.on("updated", (_ev, state) => { const t = item.getTotalBytes(); send({ st: state === "interrupted" ? "Interrupted" : t ? `Downloading ${Math.round((item.getReceivedBytes() / t) * 100)}%` : "Downloading…" }); });
    item.once("done", (_ev, state) => {
      if (state !== "completed") { try { fs.rmSync(sp, { force: true }); } catch {} }
      send({ name: item.getFilename(), st: state === "completed" ? "Completed" : state === "cancelled" ? "Cancelled" : "Failed", path: sp, stored: state === "completed" ? path.basename(sp) : undefined, size: item.getReceivedBytes() });
    });
  });
}
function hookPartition(name) { // one isolated browser profile (cookies/cache/storage) per user
  if (hooked.has(name)) return; hooked.add(name);
  const ses = session.fromPartition(name);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(["fullscreen", "clipboard-sanitized-write"].includes(perm)));
  hookDownloads(ses);
}
function wipeBrowserProfile(uid) {
  const name = "persist:n1b-" + uid, ses = session.fromPartition(name);
  ses.clearStorageData().then(() => ses.clearCache()).catch(() => {});
  setTimeout(() => { try { fs.rmSync(path.join(app.getPath("userData"), "Partitions", "n1b-" + uid), { recursive: true, force: true }); } catch {} }, 1500);
}

function create() {
  win = new BrowserWindow({ width: 1440, height: 900, backgroundColor: "#000", autoHideMenuBar: true, title: "N1ceOS",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true } });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (isHttp(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-attach-webview", (e, wp, params) => {
    const uid = svc.cur(win.webContents.id);
    if (!uid) { e.preventDefault(); return; }           // no browsing without a logged-in user
    delete wp.preload; wp.nodeIntegration = false; wp.contextIsolation = true; wp.sandbox = true;
    params.partition = "persist:n1b-" + uid;            // enforced here, not trusted from the UI
    hookPartition(params.partition);
  });
}

app.whenReady().then(() => {
  svc = require("./users")(path.join(app.getPath("userData"), "n1ceos"), wipeBrowserProfile);
  hookDownloads(session.defaultSession);
  // All user-management IPC: sender must be the N1ceOS window (file://); errors become {ok:false,error}.
  const h = (ch, fn) => ipcMain.handle(ch, (e, a) => {
    try { if (!e.senderFrame || !e.senderFrame.url.startsWith("file://")) throw new Error("denied"); return fn(e.sender.id, a); }
    catch (err) { return { ok: false, error: err.message }; }
  });
  h("auth:status", (w) => svc.status(w)); h("auth:setup", (w, a) => svc.setup(w, a)); h("auth:login", (w, a) => svc.login(w, a)); h("auth:logout", (w) => svc.logout(w));
  h("kv:set", (w, a) => svc.kvSet(w, a)); h("kv:clear", (w) => svc.kvClear(w));
  h("account:info", (w) => svc.info(w)); h("account:display", (w, a) => svc.setDisplay(w, a)); h("account:password", (w, a) => svc.setPassword(w, a)); h("account:delete", (w, a) => svc.deleteSelf(w, a));
  h("file:remove", (w, n) => svc.fileRemove(w, n)); h("file:reveal", (w, n) => { shell.showItemInFolder(svc.filePath(w, n)); return { ok: true }; });
  h("users:list", (w) => svc.list(w)); h("users:create", (w, a) => svc.create(w, a)); h("users:check", (w, a) => svc.check(w, a)); h("users:remove", (w, a) => svc.remove(w, a));
  ipcMain.handle("open-external", (_e, u) => { if (isHttp(u)) return shell.openExternal(u); });
  ipcMain.handle("download", (_e, u) => { if (isHttp(u) && win && svc.cur(win.webContents.id)) win.webContents.downloadURL(u); });
  ipcMain.handle("show-file", (_e, p) => { if (typeof p === "string" && p) shell.showItemInFolder(p); });
  create();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) create(); });
});
app.on("before-quit", () => svc && svc.flushAll());
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

app.on("web-contents-created", (_e, c) => {
  if (c.getType() !== "webview") return;
  c.setWindowOpenHandler(({ url }) => { if (isHttp(url) && win) win.webContents.send("open-url", url); return { action: "deny" }; });
  c.on("before-input-event", (e, i) => {
    if (i.type !== "keyDown") return;
    const k = i.key.toLowerCase(), ctl = i.control || i.meta;
    const hit = (ctl && ["t", "w", "l", "r", "d", "h", "j", "f", "+", "=", "-", "0", "tab"].includes(k)) || (i.alt && (k === "arrowleft" || k === "arrowright"));
    if (hit && win) { e.preventDefault(); win.webContents.send("guest-key", { key: i.key, ctrl: i.control, meta: i.meta, shift: i.shift, alt: i.alt }); }
  });
});
