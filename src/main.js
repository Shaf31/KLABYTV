const { app, BrowserWindow, ipcMain, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { JsonStore } = require('./main/store');
const { UsageTracker } = require('./main/usage');
const { createProxy } = require('./main/proxy');
const { XtreamClient } = require('./main/xtream');
const { M3UClient } = require('./main/m3u');
const { Transcoder } = require('./main/transcode');

const DEFAULT_SETTINGS = {
  userAgent: 'VLC/3.0.20 LibVLC/3.0.20',
  liveFormat: 'ts', // ts | m3u8
  showPlayerStats: true, // data usage overlay in the player
  stillWatching: true, // "Still watching?" stops playback after a long time without input
  stillWatchingHours: 2,
  pauseWhenMinimized: true, // stop streaming while the window is minimized/hidden
  seekStep: 10, // seconds for ← → and the skip buttons
  bufferSeconds: 60, // movies/episodes: download only this far ahead of the playback position
  deviceName: '', // shown on the usage page; defaults to the computer name
  lastAccountId: null,
};

const APP_NAME = 'KLABYTV';
const OLD_DATA_DIR_NAMES = ['Nile IPTV Player'];

function defaultDeviceName() {
  return os.hostname().replace(/\.local$/i, '').replace(/[-_]+/g, ' ').trim() || 'هذا الجهاز';
}

// The app used to be called "Nile IPTV Player": bring its accounts, favorites, usage history and
// local storage (resume points, continue watching) over on first start under the new name.
function migrateOldData(dir) {
  if (fs.existsSync(path.join(dir, 'settings.json'))) return;
  for (const name of OLD_DATA_DIR_NAMES) {
    const old = path.join(app.getPath('appData'), name);
    if (!fs.existsSync(path.join(old, 'settings.json'))) continue;
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['settings.json', 'accounts.json', 'favorites.json', 'usage.json']) {
      if (fs.existsSync(path.join(old, f))) fs.copyFileSync(path.join(old, f), path.join(dir, f));
    }
    const ls = path.join(old, 'Local Storage');
    if (fs.existsSync(ls)) fs.cpSync(ls, path.join(dir, 'Local Storage'), { recursive: true });
    return;
  }
}

let win, settings, accounts, favorites, usage, proxy, transcoder;
let client = null; // XtreamClient / M3UClient for the connected account
const playback = new Map(); // sid -> { pos, dur, buffer } for movies/episodes being played
let currentAccountId = null;

// ---- password encryption (OS keychain when available) ----
function encrypt(text) {
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64');
  return 'raw:' + Buffer.from(text, 'utf8').toString('base64');
}
// After the rename, passwords saved with the old app's keychain key can't be read anymore:
// the renderer then asks for the password again (NEED_PASSWORD) and keeps the same account.
function decrypt(value) {
  try {
    if (value.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
    return Buffer.from(value.slice(4), 'base64').toString('utf8');
  } catch {
    throw new Error('NEED_PASSWORD');
  }
}

const publicAccount = (a) => ({ id: a.id, type: a.type || 'xtream', name: a.name, server: a.server, username: a.username || '' });
const getUserAgent = () => settings.data.userAgent || DEFAULT_SETTINGS.userAgent;
const deps = () => ({ usage, getUserAgent });

// ---- M3U playlists ----
// A playlist link is downloaded again on every sign-in (a copy is kept for when that fails);
// a playlist file from the device is kept as that copy.
const playlistFile = (id) => path.join(app.getPath('userData'), 'playlists', `${id}.m3u`);

async function downloadPlaylist(url) {
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': getUserAgent() }, redirect: 'follow', signal: AbortSignal.timeout(90_000) });
  } catch (e) {
    throw new Error(`تعذر تحميل القائمة: ${e.name === 'TimeoutError' ? 'انتهت مهلة الاتصال' : e.cause?.message || e.message}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  usage.add('', buf.length);
  if (!res.ok) throw new Error(`تعذر تحميل القائمة: HTTP ${res.status}`);
  return buf.toString('utf8');
}

function savePlaylist(id, text) {
  fs.mkdirSync(path.dirname(playlistFile(id)), { recursive: true });
  fs.writeFileSync(playlistFile(id), text);
}

async function m3uClient(a, text) {
  if (text == null && a.url) {
    try {
      text = await downloadPlaylist(decrypt(a.url));
      savePlaylist(a.id, text);
    } catch (e) {
      if (!fs.existsSync(playlistFile(a.id))) throw e;
      console.warn('playlist download failed, using the saved copy:', e.message);
    }
  }
  if (text == null) {
    try {
      text = fs.readFileSync(playlistFile(a.id), 'utf8');
    } catch (e) {
      throw new Error(`تعذر قراءة الملف: ${e.message}`);
    }
  }
  return new M3UClient({ text, label: a.server }, deps());
}

function requireClient() {
  if (!client) throw new Error('لا يوجد حساب متصل');
  return client;
}

function registerIpc() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    });

  handle('app:init', () => ({
    settings: settings.data,
    accounts: accounts.data.list.map(publicAccount),
    proxyOrigin: proxy && proxy.origin,
    platform: process.platform,
  }));

  handle('app:reload', () => {
    setTimeout(() => win && win.webContents.reload(), 50); // after the answer reaches the page
  });

  // ---- accounts ----
  handle('accounts:add', async ({ type, name, server, username, password, url, text, fileName }) => {
    if (type === 'm3u') {
      const id = crypto.randomUUID();
      url = String(url || '').trim();
      if (!url && !text) throw new Error('اختار ملف M3U أو اكتب رابط القائمة');
      if (url && !text) text = await downloadPlaylist(url);
      const c = await m3uClient({ id }, text);
      const info = await c.login();
      let label = fileName || 'M3U';
      if (url) try { label = new URL(/^https?:\/\//i.test(url) ? url : 'http://' + url).hostname; } catch { /* keep */ }
      const account = { id, type: 'm3u', name: (name || '').trim() || label.replace(/\.m3u8?$/i, ''), server: label, username: '', url: url ? encrypt(url) : '' };
      savePlaylist(id, text);
      accounts.data.list.push(account);
      accounts.save();
      client = c;
      currentAccountId = id;
      settings.data.lastAccountId = id;
      settings.save();
      return { account: publicAccount(account), info };
    }
    if (!username || !password) throw new Error('اسم المستخدم وكلمة المرور مطلوبين');
    const c = new XtreamClient({ server, username, password }, deps());
    const info = await c.login();
    const account = {
      id: crypto.randomUUID(),
      name: (name || '').trim() || `${username}@${new URL(c.server).hostname}`,
      server: c.server,
      username,
      password: encrypt(password),
    };
    accounts.data.list = accounts.data.list.filter((a) => !(a.server === account.server && a.username === username));
    accounts.data.list.push(account);
    accounts.save();
    client = c;
    currentAccountId = account.id;
    settings.data.lastAccountId = account.id;
    settings.save();
    return { account: publicAccount(account), info };
  });

  handle('accounts:connect', async (id) => {
    const a = accounts.data.list.find((x) => x.id === id);
    if (!a) throw new Error('الحساب غير موجود');
    const c = a.type === 'm3u' ? await m3uClient(a) : new XtreamClient({ server: a.server, username: a.username, password: decrypt(a.password) }, deps());
    const info = await c.login();
    client = c;
    currentAccountId = a.id;
    settings.data.lastAccountId = a.id;
    settings.save();
    return { account: publicAccount(a), info };
  });

  handle('accounts:password', async (id, password) => {
    const a = accounts.data.list.find((x) => x.id === id);
    if (!a) throw new Error('الحساب غير موجود');
    const c = new XtreamClient({ server: a.server, username: a.username, password }, deps());
    const info = await c.login();
    a.password = encrypt(password);
    accounts.save();
    client = c;
    currentAccountId = a.id;
    settings.data.lastAccountId = a.id;
    settings.save();
    return { account: publicAccount(a), info };
  });

  handle('accounts:remove', (id) => {
    accounts.data.list = accounts.data.list.filter((a) => a.id !== id);
    accounts.save();
    fs.rmSync(playlistFile(id), { force: true });
    delete favorites.data[id];
    favorites.save();
    if (settings.data.lastAccountId === id) {
      settings.data.lastAccountId = null;
      settings.save();
    }
    return accounts.data.list.map(publicAccount);
  });

  handle('accounts:logout', () => {
    client = null;
    currentAccountId = null;
    settings.data.lastAccountId = null;
    settings.save();
  });

  // ---- xtream API ----
  const ALLOWED_ACTIONS = new Set([
    'get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams',
    'get_series_categories', 'get_series', 'get_series_info', 'get_vod_info', 'get_short_epg',
  ]);
  handle('xtream:call', (action, params) => {
    if (!ALLOWED_ACTIONS.has(action)) throw new Error('unknown action');
    return requireClient().call(action, params);
  });

  // ---- favorites (per account) ----
  handle('favorites:get', () => favorites.data[currentAccountId] || { live: [], movie: [], series: [] });
  handle('favorites:toggle', (kind, id) => {
    const fav = (favorites.data[currentAccountId] ||= { live: [], movie: [], series: [] });
    const list = (fav[kind] ||= []);
    const i = list.indexOf(String(id));
    if (i >= 0) list.splice(i, 1);
    else list.unshift(String(id));
    favorites.save();
    return fav;
  });

  // ---- playback + data usage ----
  // Passing an existing sid (e.g. switching ts -> m3u8 or to compatibility mode) keeps counting
  // into the same session. compat: true -> ffmpeg converts the stream for the built-in player.
  handle('stream:open', async ({ kind, id, ext, title, sid, compat }) => {
    const c = requireClient();
    const session = (sid && usage.get(sid)) || usage.startSession({ title, kind, streamId: id });
    const input = proxy.wrap(c.streamUrl(kind, id, ext), session.id);
    if (c.headersFor) proxy.setHeaders(session.id, c.headersFor(kind, id));
    if (!compat) return { sid: session.id, url: input };
    const job = await transcoder.createJob({ input, sid: session.id, live: kind === 'live' });
    return {
      sid: session.id,
      url: `${proxy.origin}/t?j=${job.id}`,
      duration: job.info.duration,
      transcodeVideo: job.transcodeVideo,
      transcodeAudio: job.transcodeAudio,
    };
  });
  handle('stream:stats', (sid) => usage.get(sid));
  // The player reports where it is in a movie/episode; the proxy keeps the download bufferSeconds ahead.
  handle('stream:position', (sid, { pos, dur }) => {
    if (!usage.get(sid) || !(dur > 0)) return;
    playback.set(sid, { pos: Math.max(0, Number(pos) || 0), dur: Number(dur), buffer: settings.data.bufferSeconds });
  });
  handle('stream:close', (sid) => {
    transcoder.dropSession(sid);
    playback.delete(sid);
    proxy.setHeaders(sid, null);
    return usage.endSession(sid);
  });

  handle('usage:summary', () => usage.summary());
  handle('usage:clear', () => usage.clear());

  // ---- settings ----
  handle('settings:set', (patch) => {
    for (const k of ['userAgent', 'liveFormat', 'deviceName']) if (k in patch) settings.data[k] = String(patch[k] ?? '').trim();
    for (const k of ['showPlayerStats', 'stillWatching', 'pauseWhenMinimized']) if (k in patch) settings.data[k] = !!patch[k];
    if ('seekStep' in patch) settings.data.seekStep = Math.min(600, Math.max(3, Number(patch.seekStep) || 10));
    if ('bufferSeconds' in patch) settings.data.bufferSeconds = Math.min(1800, Math.max(15, Number(patch.bufferSeconds) || 60));
    if ('stillWatchingHours' in patch) settings.data.stillWatchingHours = Math.min(6, Math.max(0.5, Number(patch.stillWatchingHours) || 2));
    if (!settings.data.deviceName) settings.data.deviceName = defaultDeviceName();
    if (!['ts', 'm3u8'].includes(settings.data.liveFormat)) settings.data.liveFormat = 'ts';
    settings.save();
    return settings.data;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#141414',
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    // macOS: content runs under the title bar (traffic lights float over the top bar), Netflix-like
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // macOS needs a menu for Cmd+Q / Cmd+C / Cmd+V to work; other platforms run without one.
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      : null,
  );
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Windows: mouse side buttons / keyboard browser keys arrive as app commands.
  // Minimized / hidden (Cmd+H) / restored: the player can stop streaming meanwhile.
  for (const [ev, state] of [['minimize', 'hidden'], ['hide', 'hidden'], ['restore', 'shown'], ['show', 'shown']]) {
    win.on(ev, () => win.webContents.send('window-state', state));
  }
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') win.webContents.send('nav', 'back');
    if (cmd === 'browser-forward') win.webContents.send('nav', 'forward');
  });
  // Never navigate the app window away (e.g. a dropped file or link).
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(async () => {
  const dir = app.getPath('userData');
  try { migrateOldData(dir); } catch (e) { console.error('migration failed', e); }
  settings = new JsonStore(path.join(dir, 'settings.json'), { ...DEFAULT_SETTINGS });
  if (!settings.data.deviceName) settings.data.deviceName = defaultDeviceName();
  accounts = new JsonStore(path.join(dir, 'accounts.json'), { list: [] });
  favorites = new JsonStore(path.join(dir, 'favorites.json'), {});
  usage = new UsageTracker(path.join(dir, 'usage.json'));
  transcoder = new Transcoder({ app, getUserAgent });
  proxy = createProxy({
    usage,
    getUserAgent,
    transcoder,
    getPlayback: (sid) => playback.get(sid),
    isVod: (sid) => {
      const s = usage.get(sid);
      return !!s && s.kind !== 'live';
    },
  });
  proxy.origin = await proxy.start();

  registerIpc();
  if (process.platform === 'darwin' && !app.isPackaged) app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit on every platform (incl. macOS) when the window closes, so open viewing sessions get closed out.
app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  usage && usage.close();
  proxy && proxy.close();
});
