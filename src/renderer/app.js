// Entry point: register screens, top bar, restore the last account.
Router.register('accounts', t('الحسابات'), accountsView);
Router.register('home', t('الرئيسية'), homeView);
Router.register('live', t('البث المباشر'), liveView);
Router.register('browse', (p) => KINDS[p.kind].title, browseView);
Router.register('mylist', t('قائمتي'), mylistView);
Router.register('movie', (p) => p.title || t('فيلم'), movieView);
Router.register('seriesInfo', (p) => p.title || t('مسلسل'), seriesInfoView);
Router.register('search', t('بحث'), searchView);
Router.register('player', (p) => p.title, playerView);
Router.register('usage', t('استهلاك الإنترنت'), usageView);
Router.register('settings', t('الإعدادات'), settingsView);

const NAV = [
  ['home', t('الرئيسية')],
  ['live', t('البث المباشر')],
  ['movie', t('الأفلام')],
  ['series', t('المسلسلات')],
  ['mylist', t('قائمتي')],
  ['usage', t('الاستهلاك')],
];

function navGo(key) {
  if (key === 'movie' || key === 'series') Router.go('browse', { kind: key });
  else Router.go(key);
}

function renderTopbar() {
  const bar = document.getElementById('topbar');
  const signedIn = !!S.account;
  const menu = h('div.menu',
    h('button.menu-item.focusable', { onclick: () => Router.go('settings') }, icon('gear'), t('الإعدادات')),
    h('button.menu-item.focusable', { onclick: () => Router.go('usage') }, icon('stats'), t('استهلاك الإنترنت')),
    h('button.menu-item.focusable', { onclick: switchAccount }, icon('person'), t('تبديل الحساب')),
  );
  const profile = h('div.profile-menu',
    h('button.avatar-btn.focusable', {
      title: S.account ? S.account.name : '',
      onclick: (e) => {
        e.stopPropagation();
        profile.classList.toggle('open');
      },
    }, h('span.avatar-sm', { style: avatarStyle(S.accounts.findIndex((a) => S.account && a.id === S.account.id)) }, initial(S.account && S.account.name)), icon('chevronDown')),
    menu,
  );
  fill(bar,
    h('div.tb-start',
      h('button.logo-btn', { tabindex: -1, onclick: () => signedIn && Router.go('home') }, logo(28)),
      signedIn ? h('nav.mainnav', NAV.map(([k, l]) => h('button.nav-link.focusable', { 'data-nav': k, onclick: () => navGo(k) }, l))) : null,
    ),
    h('div.tb-end',
      h('button#btn-back.icon-btn.focusable', { title: t('رجوع (Esc / Backspace / ⌘[)'), onclick: () => Router.back() }, icon('back')),
      h('button#btn-fwd.icon-btn.focusable', { title: t('تقدم (⌘] / Alt+→)'), onclick: () => Router.forward() }, icon('forward')),
      signedIn ? h('button.icon-btn.focusable', { title: t('بحث (/)'), onclick: () => Router.go('search') }, icon('search')) : null,
      signedIn ? h('button#top-usage.usage-pill.focusable', { title: t('استهلاك النهارده'), onclick: () => Router.go('usage') }, icon('down'), h('span')) : null,
      signedIn ? profile : null,
    ),
  );
  renderTabbar(signedIn);
  updateTopbar();
  refreshTopUsage();
}

// Phones: Netflix-style tab bar at the bottom instead of the links in the top bar.
const TABS = [
  ['home', 'home', t('الرئيسية')],
  ['live', 'tv', t('مباشر')],
  ['movie', 'movie', t('أفلام')],
  ['series', 'layers', t('مسلسلات')],
  ['mylist', 'bookmark', t('قائمتي')],
];
function renderTabbar(signedIn) {
  let bar = document.getElementById('tabbar');
  if (!bar) {
    bar = h('nav#tabbar');
    document.body.append(bar);
  }
  fill(bar, signedIn ? TABS.map(([k, ic, l]) => h('button.tab.nav-link', { 'data-nav': k, onclick: () => navGo(k) }, icon(ic), h('span', l))) : null);
}

// Layout: phones/tablets get the touch layout, Android TV the 10-foot layout, the desktop app its own.
function applyUiMode() {
  const choice = S.settings.uiMode || 'auto';
  let mode = 'desktop';
  if (choice === 'mobile' || choice === 'tv') mode = choice;
  // phone APK: mobile layout; TV APK: TV layout, also on tablets (with touch)
  else if (S.platform === 'android') mode = S.formFactor === 'phone' ? 'mobile' : 'tv';
  document.body.classList.remove('ui-desktop', 'ui-mobile', 'ui-tv', 'ui-touch');
  document.body.classList.add(`ui-${mode}`);
  if (mode === 'mobile' || (S.platform === 'android' && S.formFactor !== 'tv')) document.body.classList.add('ui-touch');
  S.uiMode = mode;
}

// Called by the router after every navigation.
function updateTopbar() {
  const cur = Router.current;
  const back = document.getElementById('btn-back');
  const fwd = document.getElementById('btn-fwd');
  if (back) back.disabled = Router.stack.length <= 1;
  if (fwd) fwd.disabled = !Router.fwd.length;
  const active = cur && (cur.name === 'browse' ? cur.params.kind : cur.name);
  document.querySelectorAll('.nav-link').forEach((b) => b.classList.toggle('active', b.dataset.nav === active));
  document.body.classList.remove('scrolled');
  document.querySelectorAll('.profile-menu.open').forEach((m) => m.classList.remove('open'));
}

async function refreshTopUsage() {
  const el = document.querySelector('#top-usage span');
  if (!el) return;
  try {
    const s = await window.api.usage();
    const d = s.days[dayKey()] || { video: 0, other: 0 };
    el.textContent = fmtBytes(d.video + d.other);
  } catch { /* ignore */ }
}

// Solid top bar once the page is scrolled (transparent over the billboard).
document.addEventListener('scroll', (e) => {
  if (e.target && e.target.id === 'view') document.body.classList.toggle('scrolled', e.target.scrollTop > 30);
}, true);
document.addEventListener('click', () => document.querySelectorAll('.profile-menu.open').forEach((m) => m.classList.remove('open')));
window.api.onNav((dir) => (dir === 'back' ? Router.back() : Router.forward()));
// Window minimized / restored: the open player decides what to do (see playerView).
window.api.onWindowState((state) => S.windowListener && S.windowListener(state));

// Android: back from the native player — keep its position for "continue watching" and show
// the usage summary like the web player does.
if (window.api.onNativePlayerClosed) {
  window.api.onNativePlayerClosed((r) => {
    const item = S.nativeItem;
    S.nativeItem = null;
    if (r.kind !== 'live' && S.account) {
      const key = `resume:${S.account.id}:${r.kind}:${r.id}`;
      if (r.dur && r.pos > r.dur - 60) {
        store.del(key);
        if (item) History.remove(item);
      } else if (r.pos > 5) {
        store.set(key, Math.floor(r.pos));
        if (item) {
          const { idx, ...rest } = item;
          History.upsert({ ...rest, pos: Math.floor(r.pos), dur: Math.floor(r.dur || 0) });
        }
      }
    }
    const s = r.session;
    if (s && s.bytes > 0 && s.end - s.start > 10_000) toast(t('«{0}»: شاهدت {1} واستهلكت {2}', [s.title, fmtDuration(s.end - s.start), fmtBytes(s.bytes)]), 6000);
    refreshTopUsage();
    if (Router.current) Router.render();
  });
}

(async function start() {
  const init = await window.api.init();
  S.settings = init.settings;
  S.accounts = init.accounts;
  S.proxyOrigin = init.proxyOrigin;
  S.platform = init.platform;
  S.proxyToken = init.proxyToken || '';
  S.formFactor = init.formFactor || 'desktop';
  document.body.classList.add(`os-${init.platform}`);
  applyUiMode();
  renderTopbar();
  setInterval(refreshTopUsage, 30_000);

  const last = S.accounts.find((a) => a.id === S.settings.lastAccountId);
  if (!last) return Router.reset('accounts');
  const view = document.getElementById('view');
  view.replaceChildren(h('div.splash', logoMark(84), h('div.spinner')));
  try {
    await enterAccount(await window.api.connect(last.id));
  } catch (e) {
    if (e.message === 'NEED_PASSWORD') Router.reset('accounts', { add: true, reauth: last.id });
    else Router.reset('accounts', { error: e.message });
  }
})();
