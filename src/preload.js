const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

contextBridge.exposeInMainWorld('api', {
  init: () => call('app:init'),
  addAccount: (a) => call('accounts:add', a),
  connect: (id) => call('accounts:connect', id),
  removeAccount: (id) => call('accounts:remove', id),
  updatePassword: (id, password) => call('accounts:password', id, password),
  logout: () => call('accounts:logout'),
  xtream: (action, params) => call('xtream:call', action, params),
  favorites: () => call('favorites:get'),
  toggleFavorite: (kind, id) => call('favorites:toggle', kind, id),
  openStream: (o) => call('stream:open', o),
  streamStats: (sid) => call('stream:stats', sid),
  streamPosition: (sid, info) => call('stream:position', sid, info),
  closeStream: (sid) => call('stream:close', sid),
  usage: () => call('usage:summary'),
  clearUsage: () => call('usage:clear'),
  saveSettings: (patch) => call('settings:set', patch),
  // language changed (the page itself can't reload: navigation is blocked, see main.js)
  reloadApp: () => call('app:reload'),
  onNav: (fn) => ipcRenderer.on('nav', (_e, dir) => fn(dir)),
  onWindowState: (fn) => ipcRenderer.on('window-state', (_e, state) => fn(state)),
});
