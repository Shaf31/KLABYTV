// KLABYTV core for the web version and Samsung TVs (Tizen): what the desktop app's main process
// does (src/main.js), in plain JavaScript inside the page — accounts, Xtream Codes and M3U
// playlists, the XMLTV guide, favorites, settings and data usage.
//
// In a browser, requests to IPTV servers go through the small relay server (server.js), because
// those servers don't allow web pages to call them directly (CORS). On a TV they go direct.
// Data usage is counted here, in the page, from what the players download.
(function () {
  if (window.api) return; // desktop (preload) or Android (android-bridge.js)

  const PLATFORM = typeof window.tizen !== 'undefined' ? 'tizen' : 'web';
  const RELAY = PLATFORM === 'web' ? `${location.origin}/r` : '';
  const DEFAULT_UA = 'VLC/3.0.20 LibVLC/3.0.20';
  const LIVE_FORMATS = ['ts', 'm3u8'];

  // ---------------------------------------------------------------- storage
  const LS = 'klabytv:';
  const load = (k, d) => {
    try {
      const v = localStorage.getItem(LS + k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  };
  const save = (k, v) => {
    try {
      localStorage.setItem(LS + k, JSON.stringify(v));
    } catch (e) {
      console.warn('KLABYTV: could not save', k, e);
    }
  };

  // IndexedDB: M3U playlists (too big for localStorage) and the password key.
  const idb = (() => {
    let opening = null;
    const db = () =>
      (opening ||= new Promise((resolve, reject) => {
        const r = indexedDB.open('klabytv', 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('playlists');
          r.result.createObjectStore('keys');
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }));
    const run = (store, mode, fn) =>
      db().then((d) => new Promise((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }));
    return {
      get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
      set: (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key)),
      del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
    };
  })();

  // ---------------------------------------------------------------- small helpers
  const b64 = {
    fromBytes(bytes) {
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
    toBytes(text) {
      return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    },
    fromText(text) {
      return this.fromBytes(new TextEncoder().encode(text));
    },
    toText(text) {
      return new TextDecoder().decode(this.toBytes(text));
    },
  };

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // SHA-1 (synchronous), so M3U ids are the same as in the desktop and Android apps.
  function sha1Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const words = new Uint32Array((((bytes.length + 8) >> 6) + 1) * 16);
    for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
    words[words.length - 1] = bytes.length * 8;
    let [a, b, c, d, e] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const w = new Uint32Array(80);
    const rol = (x, n) => (x << n) | (x >>> (32 - n));
    for (let i = 0; i < words.length; i += 16) {
      for (let t = 0; t < 80; t++) w[t] = t < 16 ? words[i + t] : rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
      let [A, B, C, D, E] = [a, b, c, d, e];
      for (let t = 0; t < 80; t++) {
        const f = t < 20 ? (B & C) | (~B & D) : t < 40 ? B ^ C ^ D : t < 60 ? (B & C) | (B & D) | (C & D) : B ^ C ^ D;
        const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        const tmp = (rol(A, 5) + f + E + k + w[t]) >>> 0;
        [E, D, C, B, A] = [D, C, rol(B, 30) >>> 0, A, tmp];
      }
      [a, b, c, d, e] = [(a + A) >>> 0, (b + B) >>> 0, (c + C) >>> 0, (d + D) >>> 0, (e + E) >>> 0];
    }
    return [a, b, c, d, e].map((x) => x.toString(16).padStart(8, '0')).join('');
  }
  const shortId = (s) => sha1Hex(s).slice(0, 12);

  // ---------------------------------------------------------------- passwords
  // Encrypted with a key that can't leave this browser/TV (WebCrypto, kept in IndexedDB).
  async function passwordKey() {
    if (!window.crypto || !crypto.subtle) return null;
    let key = await idb.get('keys', 'password').catch(() => null);
    if (!key) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await idb.set('keys', 'password', key);
    }
    return key;
  }
  async function encrypt(text) {
    const key = await passwordKey().catch(() => null);
    if (!key) return 'raw:' + b64.fromText(text);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
    return `aes:${b64.fromBytes(iv)}:${b64.fromBytes(data)}`;
  }
  async function decrypt(value) {
    try {
      if (value.startsWith('raw:')) return b64.toText(value.slice(4));
      const [, iv, data] = value.split(':');
      const key = await passwordKey();
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.toBytes(iv) }, key, b64.toBytes(data));
      return new TextDecoder().decode(plain);
    } catch {
      throw new Error('NEED_PASSWORD');
    }
  }

  // ---------------------------------------------------------------- settings
  function defaultDeviceName() {
    if (PLATFORM === 'tizen') return 'Samsung TV';
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} · ${os}` : browser;
  }
  const settings = {
    userAgent: DEFAULT_UA,
    liveFormat: 'ts',
    showPlayerStats: true,
    stillWatching: true,
    stillWatchingHours: 2,
    pauseWhenMinimized: true,
    seekStep: 10,
    bufferSeconds: 60,
    deviceName: '',
    lastAccountId: null,
    ...load('settings', {}),
  };
  if (!settings.deviceName) settings.deviceName = defaultDeviceName();
  const saveSettings = () => save('settings', settings);

  let accounts = load('accounts', []);
  const favorites = load('favorites', {});
  const publicAccount = (a) => ({ id: a.id, type: a.type || 'xtream', name: a.name, server: a.server, username: a.username || '' });
  const userAgent = () => settings.userAgent || DEFAULT_UA;

  // ---------------------------------------------------------------- data usage
  const dayKey = (ts = Date.now()) => new Date(ts).toLocaleDateString('en-CA');
  const usage = {
    data: load('usage', { days: {}, sessions: [] }),
    active: new Map(),
    dirty: false,
    start({ title, kind, streamId }) {
      const s = { id: uuid(), title: String(title || ''), kind: kind || 'live', streamId: streamId ?? null, start: Date.now(), end: Date.now(), bytes: 0 };
      this.active.set(s.id, s);
      this.data.sessions.unshift(s);
      if (this.data.sessions.length > 2000) this.data.sessions.length = 2000;
      this.dirty = true;
      return s;
    },
    // bytes for a viewing session (sid) or, without one, for "other" (lists, posters, the guide)
    add(sid, n) {
      if (!n) return;
      const day = (this.data.days[dayKey()] ||= { video: 0, other: 0 });
      const s = sid && this.active.get(sid);
      if (s) {
        s.bytes += n;
        s.end = Date.now();
        day.video += n;
      } else day.other += n;
      this.dirty = true;
    },
    get(sid) {
      const s = this.active.get(sid);
      return s ? { ...s, now: Date.now() } : null;
    },
    end(sid) {
      const s = this.active.get(sid);
      if (!s) return null;
      this.active.delete(sid);
      s.end = Date.now();
      if (s.bytes === 0) this.data.sessions = this.data.sessions.filter((x) => x.id !== sid);
      this.dirty = true;
      this.flush();
      return { ...s };
    },
    flush() {
      if (!this.dirty) return;
      this.dirty = false;
      save('usage', this.data);
    },
  };
  setInterval(() => usage.flush(), 10_000);
  addEventListener('pagehide', () => usage.flush());

  // ---------------------------------------------------------------- network
  // The address the page actually loads for a remote URL (through the relay in a browser).
  function remote(url, { ua, referer } = {}) {
    if (!RELAY) return url;
    let r = `${RELAY}?u=${encodeURIComponent(url)}&ua=${encodeURIComponent(ua || userAgent())}`;
    if (referer) r += `&ref=${encodeURIComponent(referer)}`;
    return r;
  }

  // Downloads a whole response, counting its bytes. On a TV, an https:// address on a port that
  // only speaks http is retried over http (the relay does the same in a browser).
  async function request(url, { sid = '', timeout = 45_000, headers } = {}) {
    const attempt = async (u) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(remote(u, headers), { signal: ctrl.signal });
        const buf = await res.arrayBuffer();
        usage.add(sid, buf.byteLength);
        return { status: res.status, ok: res.ok, buf, relayError: decodeURIComponent(res.headers.get('x-relay-error') || ''), finalUrl: res.headers.get('x-final-url') || (RELAY ? '' : res.url) };
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      return await attempt(url);
    } catch (e) {
      if (!RELAY && /^https:/i.test(url) && e.name !== 'AbortError') return attempt(url.replace(/^https:/i, 'http:'));
      throw e;
    }
  }
  const text = (r) => new TextDecoder().decode(r.buf);
  function networkError(e, prefix) {
    const why = e.name === 'AbortError' ? 'انتهت مهلة الاتصال' : e.message;
    return new Error(`${prefix}: ${why}`);
  }

  // mpegts.js reads streams with fetch(): count them as they arrive.
  const watched = new Map(); // address given to the player -> session id
  const pageFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const sid = url && watched.get(url);
    const p = pageFetch(input, init);
    if (!sid) return p;
    return p.then((res) => {
      if (!res.body || typeof ReadableStream === 'undefined') return res;
      const reader = res.body.getReader();
      const body = new ReadableStream({
        pull(ctrl) {
          return reader.read().then(({ done, value }) => {
            if (done) return ctrl.close();
            usage.add(sid, value.byteLength);
            ctrl.enqueue(value);
          });
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      const counted = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
      Object.defineProperty(counted, 'url', { value: res.url }); // the player checks it for redirects
      return counted;
    });
  };

  // ---------------------------------------------------------------- Xtream Codes
  function normalizeServer(input) {
    let s = String(input || '').trim();
    if (!s) throw new Error('عنوان السيرفر مطلوب');
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    let u;
    try {
      u = new URL(s);
    } catch {
      throw new Error('عنوان السيرفر غير صحيح');
    }
    return `${u.protocol}//${u.host}`;
  }

  class XtreamClient {
    constructor({ server, username, password }) {
      this.type = 'xtream';
      this.server = normalizeServer(server);
      this.username = username;
      this.password = password;
    }

    async call(action, params = {}) {
      const url = new URL(this.server + '/player_api.php');
      url.searchParams.set('username', this.username);
      url.searchParams.set('password', this.password);
      if (action) url.searchParams.set('action', action);
      for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') url.searchParams.set(k, v);
      let r;
      try {
        r = await request(url.href);
      } catch (e) {
        throw networkError(e, 'تعذر الاتصال بالسيرفر');
      }
      if (r.relayError) throw new Error(`تعذر الاتصال بالسيرفر: ${r.relayError}`);
      // https:// on a port that only speaks http: keep using http (saved like that, streams too)
      if (/^https:/i.test(this.server) && /^http:/i.test(r.finalUrl || '') && new URL(r.finalUrl).host === new URL(this.server).host) {
        this.server = this.server.replace(/^https:/i, 'http:');
      }
      if (r.status === 401 || r.status === 403) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
      if (!r.ok) throw new Error(`السيرفر رد بخطأ HTTP ${r.status}`);
      const body = text(r).trim();
      if (!body) return action ? [] : null;
      try {
        return JSON.parse(body);
      } catch {
        throw new Error('رد السيرفر غير مفهوم (تأكد إنه سيرفر Xtream)');
      }
    }

    async login() {
      const data = await this.call('');
      const info = data && data.user_info;
      if (!info || Number(info.auth) !== 1) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
      if (info.status && info.status !== 'Active') throw new Error(`الاشتراك غير فعال (${info.status})`);
      return data;
    }

    streamUrl(kind, id, ext) {
      const base = `${this.server}/${kind}/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${id}`;
      if (kind === 'live') return `${base}.${LIVE_FORMATS.includes(ext) ? ext : 'ts'}`;
      return ext ? `${base}.${ext}` : base;
    }

    headersFor() {
      return {};
    }
  }

  // ---------------------------------------------------------------- M3U playlists (port of src/main/m3u.js)
  const VOD_EXT = /^(mp4|mkv|avi|mov|wmv|flv|m4v|webm|mpg|mpeg|divx|xvid|3gp|vob|rmvb|m2ts|mts|ogv)$/i;
  const EPISODE = /^(.*?)[\s._\-|:([]*S(\d{1,2})[\s._-]*E(\d{1,4})\b/i;
  const extOf = (url) => {
    try {
      return (new URL(url).pathname.match(/\.(\w{1,5})$/) || [])[1] || '';
    } catch {
      return '';
    }
  };
  function attrs(s) {
    const out = {};
    const re = /([\w-]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2].trim();
    return out;
  }
  const decode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  function parseM3U(body) {
    const lines = String(body || '').replace(/^﻿/, '').split(/\r?\n/);
    let epgUrl = '';
    const entries = [];
    let cur = null;
    let group = '';
    let opts = {};
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTM3U')) {
        const a = attrs(line);
        epgUrl = (a['url-tvg'] || a['x-tvg-url'] || a['tvg-url'] || '').split(',')[0].trim();
      } else if (line.startsWith('#EXTINF')) {
        const comma = line.indexOf(',', line.lastIndexOf('"') + 1);
        const a = attrs(comma > 0 ? line.slice(0, comma) : line);
        const name = (comma > 0 ? line.slice(comma + 1) : '').trim() || a['tvg-name'] || '';
        cur = { name, logo: a['tvg-logo'] || '', group: a['group-title'] || '', tvgId: a['tvg-id'] || '', tvgName: a['tvg-name'] || '' };
      } else if (line.startsWith('#EXTGRP:')) {
        group = line.slice(8).trim();
      } else if (line.startsWith('#EXTVLCOPT:')) {
        const [k, ...v] = line.slice(11).split('=');
        const val = v.join('=').trim();
        if (/^http-user-agent$/i.test(k.trim())) opts.ua = val;
        if (/^http-referr?er$/i.test(k.trim())) opts.referrer = val;
      } else if (!line.startsWith('#')) {
        if (/^(https?|rtmp|rtsp|udp):\/\//i.test(line)) {
          const [url, extra] = line.split('|');
          const e = { name: '', logo: '', group: '', tvgId: '', tvgName: '', ...cur, url: url.trim(), ...opts };
          if (extra) {
            for (const part of extra.split('&')) {
              const [k, v = ''] = part.split('=');
              if (/^user-agent$/i.test(k)) e.ua = decode(v);
              if (/^referr?er$/i.test(k)) e.referrer = decode(v);
            }
          }
          if (!e.group) e.group = group;
          if (!e.name) e.name = decode((e.url.split('?')[0].split('/').pop() || e.url).replace(/\.\w{1,5}$/, ''));
          entries.push(e);
        }
        cur = null;
        opts = {};
      }
    }
    return { epgUrl, entries };
  }

  function classify(e) {
    const lower = e.url.toLowerCase();
    const ext = extOf(e.url);
    const vod = VOD_EXT.test(ext) || /\/(movies?|vod|series)\//.test(lower);
    if (!vod) return { kind: 'live', ext: /^m3u8?$/i.test(ext) ? 'm3u8' : 'ts' };
    const m = e.name.match(EPISODE);
    if (m || /\/series\//.test(lower)) {
      return {
        kind: 'episode',
        ext,
        show: (m && m[1].replace(/[\s._\-|:([]+$/, '').trim()) || e.group || e.name,
        season: m ? Number(m[2]) : 1,
        episode: m ? Number(m[3]) : 0,
        title: m ? e.name.slice(m[0].length).replace(/^[\s._\-|:)\]]+/, '').trim() : e.name,
      };
    }
    return { kind: 'movie', ext };
  }

  function buildLibrary(entries) {
    const lib = { live: [], movie: [], series: [], cats: { live: new Map(), movie: new Map(), series: new Map() }, byId: new Map(), shows: new Map() };
    const cat = (kind, name) => {
      const n = name || 'Other';
      const key = shortId(`${kind}:${n}`);
      if (!lib.cats[kind].has(key)) lib.cats[kind].set(key, { category_id: key, category_name: n, parent_id: 0 });
      return key;
    };
    let num = 0;
    entries.forEach((e, i) => {
      const c = classify(e);
      const sid = shortId(e.url);
      if (c.kind === 'live') {
        lib.byId.set(`live:${sid}`, e);
        lib.live.push({ num: ++num, stream_id: sid, name: e.name, stream_icon: e.logo, category_id: cat('live', e.group), epg_channel_id: e.tvgId, ext: c.ext });
      } else if (c.kind === 'movie') {
        lib.byId.set(`movie:${sid}`, e);
        lib.movie.push({ stream_id: sid, name: e.name, stream_icon: e.logo, category_id: cat('movie', e.group), container_extension: c.ext, added: String(entries.length - i), rating: '' });
      } else {
        const showId = shortId(`series:${c.show.toLowerCase()}`);
        let show = lib.shows.get(showId);
        if (!show) {
          show = { info: { name: c.show, cover: e.logo, plot: '', genre: '', category_id: cat('series', e.group) }, episodes: {} };
          lib.shows.set(showId, show);
          lib.series.push({ series_id: showId, name: c.show, cover: e.logo, category_id: show.info.category_id, last_modified: String(entries.length - i), rating: '' });
        }
        const list = (show.episodes[c.season] ||= []);
        lib.byId.set(`series:${sid}`, e);
        list.push({ id: sid, episode_num: c.episode || list.length + 1, title: c.title, container_extension: c.ext, season: c.season, info: { movie_image: e.logo } });
      }
    });
    for (const show of lib.shows.values()) for (const s of Object.keys(show.episodes)) show.episodes[s].sort((a, b) => a.episode_num - b.episode_num);
    return lib;
  }

  // ---------------------------------------------------------------- XMLTV guide (port of src/main/xmltv.js)
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unescapeXml = (s) =>
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);
  function xmltvTime(s) {
    const m = String(s || '').match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/);
    if (!m) return NaN;
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) t -= (m[7][0] === '-' ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3))) * 60_000;
    return t;
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  class XmltvGuide {
    constructor(url) {
      this.url = url;
      this.programmes = new Map();
      this.names = new Map();
    }

    async load(channels) {
      const wanted = new Set(channels.map((c) => c.epg_channel_id).filter(Boolean));
      const names = new Set(channels.map((c) => norm(c.name)));
      const res = await fetch(remote(this.url));
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      let reader = res.body.getReader();
      let first = await reader.read();
      const gz = !first.done && first.value[0] === 0x1f && first.value[1] === 0x8b;
      // counted as it downloads (compressed size), then unzipped if needed
      let stream = new ReadableStream({
        start(ctrl) {
          if (!first.done) {
            usage.add('', first.value.byteLength);
            ctrl.enqueue(first.value);
          }
        },
        pull(ctrl) {
          return reader.read().then(({ done, value }) => {
            if (done) return ctrl.close();
            usage.add('', value.byteLength);
            ctrl.enqueue(value);
          });
        },
      });
      if (gz) {
        if (typeof DecompressionStream === 'undefined') throw new Error('gzip guide not supported here');
        stream = stream.pipeThrough(new DecompressionStream('gzip'));
      }
      reader = stream.getReader();
      const decoder = new TextDecoder();
      const from = Date.now() - 3_600_000;
      const to = Date.now() + 36 * 3_600_000;
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let pos = 0;
        for (;;) {
          const pi = buf.indexOf('<programme', pos);
          const ci = buf.indexOf('<channel', pos);
          const start = pi < 0 ? ci : ci < 0 ? pi : Math.min(pi, ci);
          if (start < 0) {
            pos = Math.max(pos, buf.length - 16);
            break;
          }
          const isProg = start === pi;
          const end = buf.indexOf(isProg ? '</programme>' : '</channel>', start);
          if (end < 0) {
            pos = start;
            break;
          }
          const block = buf.slice(start, end);
          pos = end + 1;
          if (isProg) {
            const ch = (block.match(/channel="([^"]*)"/) || [])[1];
            if (!ch || !wanted.has(ch)) continue;
            const a = xmltvTime((block.match(/start="([^"]*)"/) || [])[1]);
            const b = xmltvTime((block.match(/stop="([^"]*)"/) || [])[1]);
            if (!(b > from && a < to)) continue;
            const title = unescapeXml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
            const desc = unescapeXml((block.match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1] || '').trim();
            if (!this.programmes.has(ch)) this.programmes.set(ch, []);
            this.programmes.get(ch).push({ start: a, stop: b, title, desc });
          } else {
            const chId = unescapeXml((block.match(/id="([^"]*)"/) || [])[1] || '');
            for (const d of block.match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g) || []) {
              const n = norm(unescapeXml(d.replace(/<[^>]+>/g, '')));
              if (names.has(n)) {
                this.names.set(n, chId);
                wanted.add(chId);
              }
            }
          }
        }
        buf = buf.slice(pos);
        if (buf.length > 4_000_000) buf = buf.slice(-1_000_000);
      }
      for (const list of this.programmes.values()) list.sort((x, y) => x.start - y.start);
    }

    now(channel, limit = 2) {
      const list = this.programmes.get(channel.epg_channel_id) || this.programmes.get(this.names.get(norm(channel.name))) || [];
      const t = Date.now();
      return list
        .filter((p) => p.stop > t)
        .slice(0, limit)
        .map((p) => ({ title: b64.fromText(p.title), description: b64.fromText(p.desc), start_timestamp: String(Math.floor(p.start / 1000)), stop_timestamp: String(Math.floor(p.stop / 1000)) }));
    }
  }

  class M3UClient {
    constructor(body) {
      const { epgUrl, entries } = parseM3U(body);
      if (!entries.length) throw new Error('الملف ده مش قائمة M3U أو مفيهوش قنوات');
      this.type = 'm3u';
      this.lib = buildLibrary(entries);
      this.epgUrl = epgUrl;
      this.guide = epgUrl ? new XmltvGuide(epgUrl) : null;
      if (this.guide) this.guide.load(this.lib.live).catch((e) => console.warn('KLABYTV guide:', e.message));
    }

    async login() {
      const n = (k) => this.lib[k].length;
      return {
        type: 'm3u',
        user_info: { auth: 1, status: 'Active', exp_date: null, max_connections: null, active_cons: null },
        m3u: { live: n('live'), movie: n('movie'), series: n('series'), epg: !!this.epgUrl },
      };
    }

    async call(action, params = {}) {
      const L = this.lib;
      const inCat = (list) => (params.category_id ? list.filter((x) => x.category_id === String(params.category_id)) : list);
      switch (action) {
        case 'get_live_categories': return [...L.cats.live.values()];
        case 'get_vod_categories': return [...L.cats.movie.values()];
        case 'get_series_categories': return [...L.cats.series.values()];
        case 'get_live_streams': return inCat(L.live);
        case 'get_vod_streams': return inCat(L.movie);
        case 'get_series': return inCat(L.series);
        case 'get_series_info': {
          const s = L.shows.get(String(params.series_id));
          if (!s) return { info: {}, episodes: {}, seasons: [] };
          return { info: s.info, episodes: s.episodes, seasons: Object.keys(s.episodes).map((n) => ({ season_number: Number(n), name: '' })) };
        }
        case 'get_vod_info': {
          const m = L.movie.find((x) => x.stream_id === String(params.vod_id));
          return m ? { info: { name: m.name, movie_image: m.stream_icon }, movie_data: { stream_id: m.stream_id, name: m.name, container_extension: m.container_extension } } : { info: {} };
        }
        case 'get_short_epg': {
          const ch = L.live.find((x) => x.stream_id === String(params.stream_id));
          return { epg_listings: ch && this.guide ? this.guide.now(ch, Number(params.limit) || 2) : [] };
        }
        default: return [];
      }
    }

    entry(kind, id) {
      const e = this.lib.byId.get(`${kind}:${id}`);
      if (!e) throw new Error('المحتوى غير موجود على السيرفر.');
      return e;
    }

    streamUrl(kind, id) {
      return this.entry(kind, id).url;
    }

    headersFor(kind, id) {
      const e = this.entry(kind, id);
      return { ua: e.ua, referer: e.referrer };
    }
  }

  // A link is downloaded again on every sign-in (a copy is kept for when that fails); a file from
  // the device is kept as that copy.
  async function downloadPlaylist(url) {
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    let r;
    try {
      r = await request(url, { timeout: 90_000 });
    } catch (e) {
      throw networkError(e, 'تعذر تحميل القائمة');
    }
    if (r.relayError) throw new Error(`تعذر تحميل القائمة: ${r.relayError}`);
    if (!r.ok) throw new Error(`تعذر تحميل القائمة: HTTP ${r.status}`);
    return text(r);
  }

  async function m3uClient(a, body) {
    if (body == null && a.url) {
      try {
        body = await downloadPlaylist(await decrypt(a.url));
        await idb.set('playlists', a.id, body);
      } catch (e) {
        if (e.message === 'NEED_PASSWORD' || !(await idb.get('playlists', a.id).catch(() => null))) throw e;
        console.warn('KLABYTV: playlist download failed, using the saved copy:', e.message);
      }
    }
    if (body == null) body = await idb.get('playlists', a.id);
    if (body == null) throw new Error('تعذر قراءة الملف: playlist not found');
    return new M3UClient(body);
  }

  // ---------------------------------------------------------------- the API the screens use
  let client = null;
  let currentAccountId = null;
  const playback = new Map(); // sid -> what's being played (for usage estimates)
  const requireClient = () => {
    if (!client) throw new Error('لا يوجد حساب متصل');
    return client;
  };
  const connected = (account, c, info) => {
    client = c;
    currentAccountId = account.id;
    settings.lastAccountId = account.id;
    saveSettings();
    return { account: publicAccount(account), info };
  };
  const findAccount = (id) => {
    const a = accounts.find((x) => x.id === id);
    if (!a) throw new Error('الحساب غير موجود');
    return a;
  };
  const listeners = {};
  const on = (event, fn) => (listeners[event] ||= []).push(fn);
  const emit = (event, data) => (listeners[event] || []).forEach((fn) => fn(data));
  document.addEventListener('visibilitychange', () => emit('window-state', document.hidden ? 'hidden' : 'shown'));

  // Played by the browser itself (MP4 ...): it downloads the file on its own, so usage is
  // estimated from how much of the video it has buffered.
  async function measureFile(sid, upstream, headers) {
    try {
      const res = await fetch(remote(upstream, headers), { headers: { Range: 'bytes=0-0' } });
      const range = (res.headers.get('content-range') || '').match(/\/(\d+)/);
      const total = range ? Number(range[1]) : Number(res.headers.get('content-length')) || 0;
      res.body && res.body.cancel().catch(() => {});
      const p = playback.get(sid);
      if (p && total > 1) p.total = total;
    } catch { /* no estimate */ }
  }

  const api = {
    init: async () => ({
      settings,
      accounts: accounts.map(publicAccount),
      proxyOrigin: RELAY ? location.origin : '',
      proxyToken: '',
      platform: PLATFORM,
      formFactor: PLATFORM === 'tizen' ? 'tv' : 'desktop',
    }),

    addAccount: async ({ type, name, server, username, password, url, text: body, fileName }) => {
      if (type === 'm3u') {
        const id = uuid();
        url = String(url || '').trim();
        if (!url && body == null) throw new Error('اختار ملف M3U أو اكتب رابط القائمة');
        if (url && body == null) body = await downloadPlaylist(url);
        const c = await m3uClient({ id }, body);
        const info = await c.login();
        let label = fileName || 'M3U';
        if (url) try { label = new URL(/^https?:\/\//i.test(url) ? url : 'http://' + url).hostname; } catch { /* keep */ }
        const account = { id, type: 'm3u', name: (name || '').trim() || label.replace(/\.m3u8?$/i, ''), server: label, username: '', url: url ? await encrypt(url) : '' };
        await idb.set('playlists', id, body);
        accounts.push(account);
        save('accounts', accounts);
        return connected(account, c, info);
      }
      username = String(username || '').trim();
      if (!username || !password) throw new Error('اسم المستخدم وكلمة المرور مطلوبين');
      const c = new XtreamClient({ server, username, password });
      const info = await c.login();
      const account = { id: uuid(), type: 'xtream', name: (name || '').trim() || `${username}@${new URL(c.server).hostname}`, server: c.server, username, password: await encrypt(password) };
      accounts = accounts.filter((a) => !(a.server === account.server && a.username === username));
      accounts.push(account);
      save('accounts', accounts);
      return connected(account, c, info);
    },

    connect: async (id) => {
      const a = findAccount(id);
      const c = a.type === 'm3u' ? await m3uClient(a) : new XtreamClient({ server: a.server, username: a.username, password: await decrypt(a.password) });
      const info = await c.login();
      if (c.type === 'xtream' && c.server !== a.server) {
        a.server = c.server;
        save('accounts', accounts);
      }
      return connected(a, c, info);
    },

    updatePassword: async (id, password) => {
      const a = findAccount(id);
      const c = new XtreamClient({ server: a.server, username: a.username, password });
      const info = await c.login();
      a.password = await encrypt(password);
      save('accounts', accounts);
      return connected(a, c, info);
    },

    removeAccount: async (id) => {
      accounts = accounts.filter((a) => a.id !== id);
      save('accounts', accounts);
      idb.del('playlists', id).catch(() => {});
      delete favorites[id];
      save('favorites', favorites);
      if (settings.lastAccountId === id) {
        settings.lastAccountId = null;
        saveSettings();
      }
      return accounts.map(publicAccount);
    },

    logout: async () => {
      client = null;
      currentAccountId = null;
      settings.lastAccountId = null;
      saveSettings();
    },

    xtream: async (action, params) => requireClient().call(action, params),

    favorites: async () => favorites[currentAccountId] || { live: [], movie: [], series: [] },
    toggleFavorite: async (kind, id) => {
      const fav = (favorites[currentAccountId] ||= { live: [], movie: [], series: [] });
      const list = (fav[kind] ||= []);
      const i = list.indexOf(String(id));
      if (i >= 0) list.splice(i, 1);
      else list.unshift(String(id));
      save('favorites', favorites);
      return fav;
    },

    // The address the player loads (through the relay in a browser). Passing an existing sid keeps
    // counting into the same session.
    openStream: async ({ kind, id, ext, title, sid, compat }) => {
      const c = requireClient();
      if (compat) throw new Error('NO_COMPAT');
      const session = (sid && usage.get(sid)) || usage.start({ title, kind, streamId: id });
      const upstream = c.streamUrl(kind, id, ext);
      const headers = c.headersFor(kind, id);
      const url = remote(upstream, headers);
      watched.set(url, session.id);
      const engine = /^(ts|m3u8)$/i.test(ext || '') || (kind === 'live' && !ext) ? 'player' : 'browser';
      playback.set(session.id, { url, upstream, headers, engine, buffered: 0, total: 0 });
      if (engine === 'browser' && kind !== 'live') measureFile(session.id, upstream, headers);
      return { sid: session.id, url };
    },
    streamStats: async (sid) => usage.get(sid),
    streamPosition: async (sid, { dur, buffered }) => {
      const p = playback.get(sid);
      if (!p || p.engine !== 'browser' || !(dur > 0) || !(p.total > 0) || !(buffered >= 0)) return;
      if (buffered > p.buffered) usage.add(sid, ((buffered - p.buffered) / dur) * p.total);
      p.buffered = Math.max(p.buffered, buffered);
    },
    closeStream: async (sid) => {
      const p = playback.get(sid);
      if (p) watched.delete(p.url);
      playback.delete(sid);
      return usage.end(sid);
    },

    usage: async () => ({ days: usage.data.days, sessions: usage.data.sessions, activeIds: [...usage.active.keys()] }),
    clearUsage: async () => {
      usage.data = { days: {}, sessions: [...usage.active.values()] };
      usage.dirty = true;
      usage.flush();
    },

    saveSettings: async (patch) => {
      for (const k of ['userAgent', 'liveFormat', 'deviceName']) if (k in patch) settings[k] = String(patch[k] ?? '').trim();
      for (const k of ['showPlayerStats', 'stillWatching', 'pauseWhenMinimized']) if (k in patch) settings[k] = !!patch[k];
      if ('seekStep' in patch) settings.seekStep = Math.min(600, Math.max(3, Number(patch.seekStep) || 10));
      if ('bufferSeconds' in patch) settings.bufferSeconds = Math.min(1800, Math.max(15, Number(patch.bufferSeconds) || 60));
      if ('stillWatchingHours' in patch) settings.stillWatchingHours = Math.min(6, Math.max(0.5, Number(patch.stillWatchingHours) || 2));
      if (!settings.deviceName) settings.deviceName = defaultDeviceName();
      if (!LIVE_FORMATS.includes(settings.liveFormat)) settings.liveFormat = 'ts';
      saveSettings();
      return settings;
    },

    onNav: () => {},
    onWindowState: (fn) => on('window-state', fn),
    reloadApp: async () => location.reload(),

    // What the player does differently here (see player.js)
    web: {
      // hls.js: every request goes through the relay in a browser, and its bytes are counted
      hlsConfig: (sid) => ({
        xhrSetup(xhr, url) {
          if (RELAY && !url.startsWith(RELAY)) {
            const p = playback.get(sid);
            xhr.open('GET', remote(url, p && p.headers), true);
          }
          // the event's own byte count: hls.js hands the data to its worker, emptying xhr.response
          xhr.addEventListener('loadend', (e) => usage.add(sid, e.loaded || 0));
        },
      }),
    },
  };

  window.api = api;
})();
