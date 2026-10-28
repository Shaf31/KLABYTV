// Shared state and small helpers for the renderer.

// localStorage wrapper that never throws (storage can be unavailable).
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch { /* storage unavailable */ }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch { /* storage unavailable */ }
  },
};

const S = {
  proxyOrigin: '',
  settings: {},
  accounts: [],
  account: null,
  info: null, // player_api.php login response (user_info + server_info)
  cache: {}, // API responses for the connected account
  favorites: { live: [], movie: [], series: [] },
  playlist: [], // items the player can step through with channel up/down
};

// h('div.cls#id', {attrs}, ...children)
function h(tag, attrs, ...children) {
  const [, name, rest] = tag.match(/^([a-z0-9]+)(.*)$/i);
  const el = document.createElement(name);
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]);
    else el.id = m[2];
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// replaceChildren that skips null/false (conditional children).
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}

// Values are wrapped in LTR isolates (\u2066…\u2069) so "12.5 MB" never gets reordered inside Arabic text.
const ltr = (s) => `\u2066${s}\u2069`;

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return ltr(`${n} B`);
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return ltr(`${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`);
}

function fmtMbps(bytesPerSec) {
  return ltr(`${((bytesPerSec * 8) / 1e6).toFixed(2)} Mbps`);
}

function fmtDuration(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  const p = (x) => String(x).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toLocaleDateString('en-CA');
}

// EPG titles/descriptions are base64 encoded UTF-8.
function b64(s) {
  if (!s) return '';
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  } catch {
    return s;
  }
}

// Posters and logos also go through the local proxy so their bytes are counted.
function img(url) {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  return `${S.proxyOrigin}/p?s=&u=${encodeURIComponent(url)}${S.proxyToken ? `&t=${S.proxyToken}` : ''}`;
}

function toast(msg, ms = 3500) {
  const t = h('div.toast', msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Cached API call for the connected account.
async function cached(action, params) {
  const key = action + JSON.stringify(params || {});
  if (!(key in S.cache)) {
    S.cache[key] = window.api.xtream(action, params).catch((e) => {
      delete S.cache[key];
      throw e;
    });
  }
  return S.cache[key];
}

function asArray(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') return Object.values(x);
  return [];
}

// Recently watched items for "Continue watching" / recent channels (per account, newest first).
// Episodes are stored under their series so a show appears once.
const History = {
  key: () => `history:${S.account.id}`,
  same: (a, b) => a.kind === b.kind && String(a.seriesId || a.id) === String(b.seriesId || b.id),
  list() {
    return store.get(this.key(), []);
  },
  upsert(item) {
    const list = this.list().filter((x) => !this.same(x, item));
    list.unshift({ ...item, ts: Date.now() });
    store.set(this.key(), list.slice(0, 80));
  },
  remove(item) {
    store.set(this.key(), this.list().filter((x) => !this.same(x, item)));
  },
};
