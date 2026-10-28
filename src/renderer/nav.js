// Router with back/forward history + keyboard (arrow keys) spatial navigation.
const Router = {
  views: {},
  stack: [],
  fwd: [],
  cleanup: null,
  token: 0,
  keyHook: null, // a view (the player) can grab keys first
  lastJump: 0,

  register(name, title, fn) {
    this.views[name] = { title, fn };
  },

  get current() {
    return this.stack[this.stack.length - 1];
  },

  go(name, params = {}, { replace = false } = {}) {
    if (this.current) this.snapshot(this.current);
    if (replace) this.stack.pop();
    this.stack.push({ name, params });
    this.fwd = [];
    this.render();
  },

  // Reset history (e.g. after login, so "back" doesn't return to the login form).
  reset(name, params = {}) {
    this.stack = [{ name, params }];
    this.fwd = [];
    this.render();
  },

  back() {
    if (!this.debounced() || this.stack.length <= 1) return false;
    const cur = this.stack.pop();
    this.snapshot(cur);
    this.fwd.push(cur);
    this.render();
    return true;
  },

  forward() {
    if (!this.debounced() || !this.fwd.length) return false;
    this.snapshot(this.current);
    this.stack.push(this.fwd.pop());
    this.render();
    return true;
  },

  // Change params of the current entry without a new history step (e.g. selected category).
  update(params) {
    Object.assign(this.current.params, params);
  },

  // Mouse back button can fire both a mouseup and a Windows app-command; count it once.
  debounced() {
    const now = Date.now();
    if (now - this.lastJump < 250) return false;
    this.lastJump = now;
    return true;
  },

  snapshot(entry) {
    const root = document.getElementById('view');
    const a = document.activeElement;
    entry.focusKey = a && root.contains(a) ? a.dataset.key : undefined;
    entry.scroll = { __page: root.scrollTop };
    root.querySelectorAll('[data-scroll]').forEach((el) => (entry.scroll[el.dataset.scroll] = el.scrollTop));
  },

  async render() {
    const entry = this.current;
    const token = ++this.token;
    if (this.cleanup) {
      const c = this.cleanup;
      this.cleanup = null;
      try { c(); } catch (e) { console.error(e); }
    }
    this.keyHook = null;
    const old = document.getElementById('view');
    const root = old.cloneNode(false);
    old.replaceWith(root);
    const view = this.views[entry.name];
    document.body.dataset.view = entry.name;
    const title = typeof view.title === 'function' ? view.title(entry.params) : view.title;
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
    if (typeof updateTopbar === 'function') updateTopbar();

    let cleanup;
    try {
      cleanup = await view.fn(root, entry.params, { alive: () => token === this.token, entry });
    } catch (e) {
      console.error(e);
      if (token === this.token) root.replaceChildren(errorBox(e.message, () => this.render()));
    }
    if (token !== this.token) {
      if (typeof cleanup === 'function') cleanup(); // user already left this view
      return;
    }
    this.cleanup = typeof cleanup === 'function' ? cleanup : null;
    this.restore(root, entry);
  },

  restore(root, entry) {
    // The player starts without focus: arrows seek / switch channels until OK brings up the controls.
    if (entry.name === 'player') return;
    for (const [k, top] of Object.entries(entry.scroll || {})) {
      const el = k === '__page' ? root : root.querySelector(`[data-scroll="${k}"]`);
      if (el) el.scrollTop = top;
    }
    let target = entry.focusKey && root.querySelector(`[data-key="${CSS.escape(entry.focusKey)}"]`);
    if (!target) target = root.querySelector('[data-autofocus]') || root.querySelector('.focusable');
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  },
};

function errorBox(message, retry) {
  return h('div.center-box',
    h('div.error-text', tErr(message)),
    retry && h('button.btn.focusable', { onclick: retry, 'data-autofocus': true }, t('إعادة المحاولة')),
  );
}

// ---------- spatial navigation ----------
function focusables() {
  // the page plus the top bar (nav links, search, profile menu)
  return [...document.querySelectorAll('#view .focusable, #topbar .focusable')].filter((el) => !el.disabled && el.offsetParent !== null);
}

function moveFocus(dir) {
  const cur = document.activeElement;
  const all = focusables();
  if (!all.length) return;
  if (!cur || !all.includes(cur)) {
    (document.querySelector('#view [data-autofocus]') || all[0]).focus();
    return;
  }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === cur) continue;
    const q = el.getBoundingClientRect();
    const qx = q.left + q.width / 2;
    const qy = q.top + q.height / 2;
    let primary, secondary;
    if (dir === 'right') { primary = q.left - r.right; secondary = Math.abs(qy - cy); if (qx <= cx) continue; }
    if (dir === 'left') { primary = r.left - q.right; secondary = Math.abs(qy - cy); if (qx >= cx) continue; }
    if (dir === 'down') { primary = q.top - r.bottom; secondary = Math.abs(qx - cx); if (qy <= cy) continue; }
    if (dir === 'up') { primary = r.top - q.bottom; secondary = Math.abs(qx - cx); if (qy >= cy) continue; }
    if (primary < -Math.min(r.width, r.height) / 2) continue; // overlapping too much, not in that direction
    // left/right stay on the same line (end of a row doesn't jump to another row or the top bar)
    if ((dir === 'left' || dir === 'right') && (q.bottom <= r.top + 4 || q.top >= r.bottom - 4)) continue;
    const score = Math.max(primary, 0) + secondary * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

document.addEventListener('keydown', (e) => {
  if (Router.keyHook && Router.keyHook(e)) {
    e.preventDefault();
    if (e.key === 'Escape') window.__escapeConsumed = true; // see android-bridge.js
    return;
  }
  const tg = e.target;
  const typing = tg.matches && tg.matches('input:not([type=checkbox]):not([type=radio]), textarea');
  const isSelect = tg.tagName === 'SELECT';

  // Back/forward: Alt+←/→ (Windows/Linux), Cmd+[ / Cmd+] and Cmd+←/→ (macOS), browser keys.
  const cmd = e.metaKey && !typing;
  if ((e.altKey && e.key === 'ArrowLeft') || (cmd && (e.key === '[' || e.key === 'ArrowLeft')) || e.key === 'BrowserBack') {
    e.preventDefault();
    return Router.back();
  }
  if ((e.altKey && e.key === 'ArrowRight') || (cmd && (e.key === ']' || e.key === 'ArrowRight')) || e.key === 'BrowserForward') {
    e.preventDefault();
    return Router.forward();
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (typing && tg.value) {
      tg.value = '';
      tg.dispatchEvent(new Event('input', { bubbles: true }));
      window.__escapeConsumed = true;
      return;
    }
    // Android back at the first screen is not consumed: the app goes to the background then.
    window.__escapeConsumed = Router.stack.length > 1;
    return Router.back();
  }
  if (e.key === 'Backspace' && !typing) {
    e.preventDefault();
    return Router.back();
  }
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) {
    if (!S.account) return;
    e.preventDefault();
    const s = document.querySelector('#view [data-search]');
    if (s) {
      s.focus();
      s.select();
    } else Router.go('search');
    return;
  }
  // F on a focused movie / series / channel: add to or remove from My List.
  if ((e.key === 'f' || e.key === 'F') && !typing && !e.metaKey && !e.ctrlKey && tg.dataset && tg.dataset.favKind) {
    e.preventDefault();
    toggleFav(tg.dataset.favKind, tg.dataset.favId, tg.dataset.favName);
    return;
  }
  if (ARROWS[e.key] && !e.altKey && !e.ctrlKey && !e.metaKey) {
    const dir = ARROWS[e.key];
    if (typing && (dir === 'left' || dir === 'right')) return; // move the text cursor
    if (isSelect && (dir === 'up' || dir === 'down')) return; // change the option
    e.preventDefault();
    moveFocus(dir);
    return;
  }
  if (e.key === 'Enter' && tg.classList && tg.classList.contains('focusable') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(tg.tagName)) {
    e.preventDefault();
    tg.click();
  }
});

// Mouse side buttons: 3 = back, 4 = forward.
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) {
    e.preventDefault();
    Router.back();
  } else if (e.button === 4) {
    e.preventDefault();
    Router.forward();
  }
});
