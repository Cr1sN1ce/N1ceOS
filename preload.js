// Runs in the N1ceOS window only (never inside websites). The renderer gets NO file-system access.
const { contextBridge, ipcRenderer } = require("electron");
const sub = (ch, cb) => { const f = (_, d) => cb(d); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
const inv = (ch) => (a) => ipcRenderer.invoke(ch, a);
contextBridge.exposeInMainWorld("n1ce", {
  electron: true,
  openExternal: inv("open-external"), download: inv("download"), showFile: inv("show-file"),
  onDownload: (cb) => sub("dl", cb), onOpenUrl: (cb) => sub("open-url", cb), onKey: (cb) => sub("guest-key", cb),
  auth: { status: inv("auth:status"), setup: inv("auth:setup"), login: inv("auth:login"), logout: inv("auth:logout") },
  kv: { set: (k, v) => ipcRenderer.invoke("kv:set", { k, v }), clear: inv("kv:clear") },
  account: { info: inv("account:info"), setDisplay: inv("account:display"), setPassword: inv("account:password"), delete: inv("account:delete") },
  file: { remove: inv("file:remove"), reveal: inv("file:reveal") },
  users: { list: inv("users:list"), create: inv("users:create"), check: inv("users:check"), remove: inv("users:remove") },
});
