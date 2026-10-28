// On Android the page runs in a WebView: window.api (the desktop preload API) is built on top of
// the native AndroidBridge. On the desktop this file does nothing.
(function () {
  if (!window.AndroidBridge || window.api) return;
  let seq = 0;
  const pending = new Map();
  const listeners = {};
  let origin = '';
  let token = '';

  window.__bridge = {
    resolve(id, r) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (r.ok) p.resolve(r.data);
      else p.reject(new Error(r.error));
    },
    emit(event, data) {
      (listeners[event] || []).forEach((fn) => fn(data));
    },
  };

  const call = (channel, ...args) =>
    new Promise((resolve, reject) => {
      const id = String(++seq);
      pending.set(id, { resolve, reject });
      window.AndroidBridge.call(id, channel, JSON.stringify(args));
    });
  const on = (event, fn) => (listeners[event] ||= []).push(fn);

  window.api = {
    init: async () => {
      const r = await call('app:init');
      origin = r.proxyOrigin;
      token = r.proxyToken;
      return r;
    },
    // an M3U file picked in the page goes to the local server first (too big for the bridge)
    addAccount: async (a) => {
      if (a && a.text != null) {
        const r = await fetch(`${origin}/upload?t=${token}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: a.text });
        if (!r.ok) throw new Error(await r.text());
        const { text, ...rest } = a;
        a = { ...rest, upload: (await r.json()).id };
      }
      return call('accounts:add', a);
    },
    connect: (id) => call('accounts:connect', id),
    removeAccount: (id) => call('accounts:remove', id),
    updatePassword: (id, password) => call('accounts:password', id, password),
    logout: () => call('accounts:logout'),
    // big lists (thousands of channels) come from the local server instead of the bridge
    xtream: async (action, params) => {
      const r = await fetch(`${origin}/x?t=${token}&action=${encodeURIComponent(action)}&q=${encodeURIComponent(JSON.stringify(params || {}))}`);
      const text = await r.text();
      if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
      return JSON.parse(text);
    },
    favorites: () => call('favorites:get'),
    toggleFavorite: (kind, id) => call('favorites:toggle', kind, id),
    openStream: (o) => call('stream:open', o),
    streamStats: (sid) => call('stream:stats', sid),
    streamPosition: (sid, info) => call('stream:position', sid, info),
    closeStream: (sid) => call('stream:close', sid),
    usage: () => call('usage:summary'),
    clearUsage: () => call('usage:clear'),
    saveSettings: (patch) => call('settings:set', patch),
    onNav: () => {},
    onWindowState: (fn) => on('window-state', fn),
    // Android only
    playNative: (o) => call('native:play', o),
    setPlayerMode: (enabled) => call('ui:player', enabled),
    reloadApp: () => call('app:reload'),
    onNativePlayerClosed: (fn) => on('native-player-closed', fn),
  };

  // Android back button / TV remote back. Returns true when the page used it (closed a menu,
  // went back a screen); false at the first screen, so the app goes to the background.
  window.__androidBack = () => {
    window.__escapeConsumed = false;
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return !!window.__escapeConsumed;
  };
})();
