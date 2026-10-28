// All screens except the player and the usage page.

// ---------------- accounts: "who's watching?" + sign in ----------------
// Black & white theme: profile squares are shades of grey, with ink that stays readable on each.
const AVATAR_SHADES = [['#ffffff', '#000'], ['#9e9e9e', '#000'], ['#4d4d4d', '#fff'], ['#d4d4d4', '#000'], ['#2b2b2b', '#fff'], ['#737373', '#fff']];
function avatarStyle(i) {
  const [background, color] = AVATAR_SHADES[Math.max(0, i) % AVATAR_SHADES.length];
  return { background, color };
}

async function accountsView(root, params) {
  const adding = params.add || !S.accounts.length;
  root.append(h('div.auth-bg'));
  const page = h('div.auth');
  root.append(page);

  if (!adding) {
    let manage = !!params.manage;
    const profiles = h('div.profiles');
    const render = () => {
      fill(profiles,
        S.accounts.map((a, i) =>
          h('button.profile.focusable', {
            'data-key': `acc:${a.id}`,
            'data-autofocus': a.id === S.settings.lastAccountId || null,
            onclick: async (e) => {
              const btn = e.currentTarget;
              if (manage) {
                if (!confirm(t('حذف الحساب «{0}»؟', [a.name]))) return;
                S.accounts = await window.api.removeAccount(a.id);
                return S.accounts.length ? render() : Router.reset('accounts');
              }
              btn.classList.add('busy');
              try {
                await enterAccount(await window.api.connect(a.id));
              } catch (err) {
                btn.classList.remove('busy');
                if (err.message === 'NEED_PASSWORD') return Router.go('accounts', { add: true, reauth: a.id });
                toast(tErr(err.message), 5000);
              }
            },
          },
            h('div.avatar', { style: avatarStyle(i) },
              h('span', initial(a.name)),
              manage ? h('div.avatar-edit', icon('trash')) : null,
              h('div.avatar-spin'),
            ),
            h('div.profile-name', a.name),
            h('div.profile-sub', { dir: 'ltr' }, a.type === 'm3u' ? 'M3U' : a.username),
          ),
        ),
        !manage && h('button.profile.add.focusable', { 'data-key': 'acc:add', onclick: () => Router.go('accounts', { add: true }) },
          h('div.avatar', icon('plus')),
          h('div.profile-name', t('إضافة حساب')),
        ),
      );
    };
    render();
    const manageBtn = h('button.btn.btn-outline.focusable', {
      onclick: () => {
        manage = !manage;
        Router.update({ manage });
        manageBtn.textContent = manage ? t('تم') : t('إدارة الحسابات');
        render();
      },
    }, manage ? t('تم') : t('إدارة الحسابات'));
    fill(page,
      h('h1.auth-title', t('مين بيتفرج؟')),
      params.error ? h('div.error-text.center', tErr(params.error)) : null,
      profiles,
      manageBtn,
    );
    return;
  }

  // ---- sign-in form ----
  const field = (label, attrs) => {
    const input = h('input.field-input.focusable', { placeholder: ' ', ...attrs });
    return { input, el: h('label.field', input, h('span.field-label', label)) };
  };
  const server = field(t('عنوان السيرفر (مع البورت)'), { dir: 'ltr', 'data-autofocus': true });
  const user = field(t('اسم المستخدم'), { dir: 'ltr' });
  const pass = field(t('كلمة المرور'), { type: 'password', dir: 'ltr' });
  const name = field(t('اسم الحساب (اختياري)'), {});
  const m3u = field(t('أو الصق رابط M3U (get.php)'), { dir: 'ltr' });
  const msg = h('div.form-msg');
  const submit = h('button.btn.btn-red.btn-block.focusable', { type: 'submit' }, t('تسجيل الدخول'));
  // M3U playlist: a link, or a file from this device
  const mode = params.reauth ? 'xtream' : params.mode || 'xtream';
  const m3uUrl = field(t('رابط القائمة (M3U / M3U8)'), { dir: 'ltr', 'data-autofocus': true });
  const m3uName = field(t('اسم الحساب (اختياري)'), {});
  let pickedFile = null;
  const fileLabel = h('span.file-name.muted', t('مفيش ملف متختار'));
  const fileInput = h('input', { type: 'file', accept: '.m3u,.m3u8,.txt,audio/x-mpegurl,audio/mpegurl,application/vnd.apple.mpegurl,application/x-mpegurl,text/plain', hidden: true });
  fileInput.addEventListener('change', () => {
    pickedFile = fileInput.files[0] || null;
    fileLabel.textContent = pickedFile ? pickedFile.name : t('مفيش ملف متختار');
    fileLabel.classList.toggle('muted', !pickedFile);
    if (pickedFile) m3uUrl.input.value = '';
  });
  m3uUrl.input.addEventListener('input', () => {
    if (!m3uUrl.input.value.trim() || !pickedFile) return;
    pickedFile = null;
    fileInput.value = '';
    fileLabel.textContent = t('مفيش ملف متختار');
    fileLabel.classList.add('muted');
  });
  const filePicker = h('div.file-pick',
    h('button.btn.btn-outline.focusable', { type: 'button', onclick: () => fileInput.click() }, icon('down'), t('اختار ملف من الجهاز')),
    fileLabel, fileInput);
  const tabs = h('div.mode-tabs', { role: 'tablist' },
    ...[['xtream', 'Xtream Codes'], ['m3u', t('قائمة M3U')]].map(([k, label]) =>
      h(`button.seg-btn.focusable${mode === k ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(mode === k), 'data-key': `mode:${k}`,
        onclick: () => mode !== k && Router.go('accounts', { add: true, mode: k }, { replace: true }) }, label)));
  // Re-enter the password of a saved account (e.g. after the app was renamed to KLABYTV).
  const reauth = params.reauth && S.accounts.find((a) => a.id === params.reauth);
  if (reauth) {
    server.input.value = reauth.server;
    user.input.value = reauth.username;
    name.input.value = reauth.name;
    for (const f of [server, user, name]) f.input.disabled = true;
    server.input.removeAttribute('data-autofocus');
    pass.input.setAttribute('data-autofocus', '');
  }

  m3u.input.addEventListener('input', () => {
    try {
      const u = new URL(m3u.input.value.trim());
      const un = u.searchParams.get('username');
      const pw = u.searchParams.get('password');
      if (un && pw) {
        server.input.value = `${u.protocol}//${u.host}`;
        user.input.value = un;
        pass.input.value = pw;
        msg.className = 'form-msg ok';
        msg.textContent = t('تم استخراج البيانات من الرابط');
      }
    } catch { /* not a URL yet */ }
  });

  async function onSubmit(e) {
    e.preventDefault();
    submit.disabled = true;
    msg.className = 'form-msg';
    msg.textContent = t('جاري الاتصال بالسيرفر…');
    try {
      if (reauth) return await enterAccount(await window.api.updatePassword(reauth.id, pass.input.value));
      if (mode === 'm3u') {
        if (pickedFile) msg.textContent = t('جاري قراءة الملف…');
        const r = await window.api.addAccount(pickedFile
          ? { type: 'm3u', name: m3uName.input.value, text: await pickedFile.text(), fileName: pickedFile.name }
          : { type: 'm3u', name: m3uName.input.value, url: m3uUrl.input.value.trim() });
        S.accounts = (await window.api.init()).accounts;
        return await enterAccount(r);
      }
      const r = await window.api.addAccount({
        name: name.input.value,
        server: server.input.value,
        username: user.input.value.trim(),
        password: pass.input.value,
      });
      S.accounts = (await window.api.init()).accounts;
      await enterAccount(r);
    } catch (err) {
      msg.className = 'form-msg error-text';
      msg.textContent = tErr(err.message);
      submit.disabled = false;
    }
  }

  const back = S.accounts.length ? h('button.link.focusable', { type: 'button', onclick: () => Router.back() }, t('رجوع للحسابات')) : null;
  if (mode === 'm3u') {
    return fill(page,
      h('form.auth-card', { onsubmit: onSubmit },
        h('h1', t('تسجيل الدخول')),
        tabs,
        h('p.muted', t('رابط قائمة M3U من مزود الخدمة، أو ملف M3U على الجهاز. دليل البرامج (EPG) بيتحمّل لوحده لو القائمة فيها رابط XMLTV.')),
        m3uUrl.el,
        h('div.or', h('span', t('أو'))),
        filePicker,
        m3uName.el,
        submit,
        msg,
        back,
      ),
    );
  }
  fill(page,
    h('form.auth-card', { onsubmit: onSubmit },
      h('h1', reauth ? t('أدخل كلمة المرور') : t('تسجيل الدخول')),
      reauth ? null : tabs,
      h('p.muted', reauth ? t('البرنامج بقى اسمه {0} — محتاجين كلمة مرور «{1}» مرة واحدة بس.', [APP_NAME, reauth.name]) : t('اشتراك Xtream Codes')),
      server.el, user.el, pass.el, name.el,
      reauth ? null : h('div.or', h('span', t('أو'))),
      reauth ? null : m3u.el,
      submit,
      msg,
      back,
    ),
  );
}

async function enterAccount({ account, info }) {
  S.account = account;
  S.info = info;
  S.cache = {};
  S.favorites = await window.api.favorites();
  const formats = (info.user_info && info.user_info.allowed_output_formats) || [];
  S.liveFormatFallback = formats.length && !formats.includes(S.settings.liveFormat) ? formats.find((f) => f === 'ts' || f === 'm3u8') : null;
  renderTopbar();
  Router.reset('home');
  let reopen = null;
  try {
    reopen = sessionStorage.getItem('reopen');
    sessionStorage.removeItem('reopen');
  } catch { /* no storage */ }
  if (reopen === 'settings') Router.go('settings');
}

function liveFormat() {
  return S.liveFormatFallback || S.settings.liveFormat || 'ts';
}

async function loadAll(kinds) {
  const actions = { movie: 'get_vod_streams', series: 'get_series', live: 'get_live_streams' };
  const maps = { movie: movieItem, series: seriesItem, live: liveItem };
  const res = await Promise.allSettled(kinds.map((k) => cached(actions[k])));
  const out = {};
  kinds.forEach((k, i) => (out[k] = res[i].status === 'fulfilled' ? asArray(res[i].value).map(maps[k]) : []));
  return out;
}

function playHistoryEntry(e) {
  S.playlist = [e];
  Router.go('player', { ...e, idx: 0 });
}

function historyRows(all) {
  const hist = History.list();
  const cont = hist.filter((e) => e.kind !== 'live' && e.pos > 0 && (!e.dur || e.pos < e.dur - 60));
  const recentLive = hist.filter((e) => e.kind === 'live').slice(0, 20);
  const liveById = new Map((all.live || []).map((c) => [c.id, c]));
  const recentItems = recentLive.map((e) => liveById.get(String(e.id)) || { kind: 'live', id: String(e.id), name: e.title, logo: e.logo });
  return [
    contentRow(t('كمّل مشاهدة'), cont.slice(0, 20).map((e) =>
      posterCard({ kind: e.kind, id: e.seriesId || e.id, name: e.seriesTitle || e.title, poster: e.poster }, {
        key: `cont:${e.kind}:${e.id}`,
        progress: e.dur ? e.pos / e.dur : 0,
        label: e.label || e.title,
        onClick: () => playHistoryEntry(e),
      }))),
    contentRow(t('قنوات شاهدتها مؤخرًا'), recentItems.map((c) => channelTile(c, { key: `rl:${c.id}`, list: recentItems })), { cls: '.wide' }),
  ];
}

// ---------------- home ----------------
async function homeView(root, params, ctx) {
  root.append(loading());
  const [all, vodCats] = await Promise.all([loadAll(['movie', 'series', 'live']), cached('get_vod_categories').catch(() => [])]);
  if (!ctx.alive()) return;
  const { movie: movies, series, live } = all;
  const byAdded = (a, b) => b.added - a.added;
  const latestMovies = [...movies].sort(byAdded);
  const latestSeries = [...series].sort(byAdded);

  // Featured title stays the same when coming back to Home.
  if (!ctx.entry.featured) {
    const pool = latestMovies.slice(0, 15).concat(latestSeries.slice(0, 6)).filter((x) => x.poster);
    ctx.entry.featured = pool[Math.floor(Math.random() * pool.length)] || latestMovies[0] || latestSeries[0] || null;
  }
  const f = ctx.entry.featured;
  let heroEl = null;
  if (f) {
    let info = {};
    if (f.kind === 'movie') {
      info = await Promise.race([cached('get_vod_info', { vod_id: f.id }).then((r) => (r && r.info) || {}).catch(() => ({})), new Promise((r) => setTimeout(() => r({}), 4000))]);
    }
    if (!ctx.alive()) return;
    const year = String(info.releasedate || info.year || '').slice(0, 4);
    heroEl = hero({
      image: asArray(info.backdrop_path)[0] || f.backdrop || info.movie_image || f.poster,
      posterOnly: !asArray(info.backdrop_path)[0] && !f.backdrop,
      title: f.name,
      meta: [f.kind === 'movie' ? t('فيلم') : t('مسلسل'), year, info.genre, Number(f.rating) ? `★ ${Number(f.rating).toFixed(1)}` : null],
      plot: info.plot || info.description || f.plot,
      buttons: [
        playButton(t('تشغيل'), () => {
          if (f.kind !== 'movie') return openItem(f);
          S.playlist = [{ kind: 'movie', id: f.id, ext: f.ext, title: f.name, poster: f.poster }];
          Router.go('player', { ...S.playlist[0], idx: 0 });
        }, { 'data-key': 'hero:play', 'data-autofocus': true }),
        ghostButton('info', t('مزيد من المعلومات'), () => openItem(f), { 'data-key': 'hero:info' }),
      ],
    });
  }

  const favMovies = movies.filter((x) => isFav('movie', x.id));
  const favSeries = series.filter((x) => isFav('series', x.id));
  const favLive = live.filter((x) => isFav('live', x.id));
  const catName = new Map(asArray(vodCats).map((c) => [String(c.category_id), c.category_name]));
  const byCat = new Map();
  for (const m of latestMovies) {
    if (!byCat.has(m.cat)) byCat.set(m.cat, []);
    byCat.get(m.cat).push(m);
  }
  const catRows = [...byCat.entries()].filter(([c]) => catName.has(c)).slice(0, 8);
  const posters = (list, prefix) => list.slice(0, 30).map((x) => posterCard(x, { key: `${prefix}:${x.kind}:${x.id}` }));

  fill(root,
    heroEl,
    h('div.rows', heroEl ? null : { style: { paddingTop: '90px' } },
      historyRows(all),
      contentRow(t('قائمتي'), posters([...favMovies, ...favSeries], 'my'), { more: () => Router.go('mylist') }),
      contentRow(t('قنواتك المفضلة'), favLive.slice(0, 30).map((c) => channelTile(c, { key: `fl:${c.id}`, list: favLive })), { cls: '.wide', more: () => Router.go('live', { cat: 'fav' }) }),
      contentRow(t('أحدث الأفلام'), posters(latestMovies, 'nm'), { more: () => Router.go('browse', { kind: 'movie' }) }),
      contentRow(t('أحدث المسلسلات'), posters(latestSeries, 'ns'), { more: () => Router.go('browse', { kind: 'series' }) }),
      contentRow(t('قنوات مباشرة'), live.slice(0, 30).map((c) => channelTile(c, { key: `lv:${c.id}`, list: live })), { cls: '.wide', more: () => Router.go('live', { cat: 'all' }) }),
      contentRow(t('الأعلى تقييمًا'), posters([...movies].filter((m) => Number(m.rating) > 0).sort((a, b) => b.rating - a.rating), 'tr')),
      catRows.map(([c, list]) => contentRow(catName.get(c), posters(list, `c${c}`), { more: () => Router.go('browse', { kind: 'movie', cat: c }) })),
    ),
  );
  if (!movies.length && !series.length && !live.length) root.append(emptyBox(t('السيرفر مرجعش أي محتوى')));
}

// ---------------- live TV ----------------
async function liveView(root, params, ctx) {
  root.append(loading());
  const [cats, all] = await Promise.all([cached('get_live_categories').catch(() => []), loadAll(['live'])]);
  if (!ctx.alive()) return;
  const channels = all.live;
  const counts = new Map();
  for (const c of channels) counts.set(c.cat, (counts.get(c.cat) || 0) + 1);
  let cat = params.cat || ((S.favorites.live || []).length ? 'fav' : 'all');
  let stop = null;

  const chips = h('div.chips');
  const grid = h('div.grid.channels');
  const count = h('span.muted');
  const catList = [
    { id: 'fav', name: t('قائمتي') },
    { id: 'all', name: t('كل القنوات'), count: channels.length },
    ...asArray(cats).map((c) => ({ id: String(c.category_id), name: c.category_name, count: counts.get(String(c.category_id)) || 0 })),
  ];

  function current() {
    if (cat === 'fav') {
      const favIds = S.favorites.live || [];
      const idx = new Map(channels.map((c) => [c.id, c]));
      return favIds.map((id) => idx.get(id)).filter(Boolean);
    }
    return cat === 'all' ? channels : channels.filter((c) => c.cat === cat);
  }

  function renderChips() {
    fill(chips, catList.map((c) =>
      h(`button.chip.focusable${c.id === cat ? '.active' : ''}`, { 'data-key': `cat:${c.id}`, onclick: () => select(c.id) },
        c.id === 'fav' ? icon('check') : null, c.name, c.count != null ? h('span.chip-count', c.count) : null)));
  }

  function renderGrid(ensureKey) {
    if (stop) stop();
    stop = null;
    const list = current();
    count.textContent = t('{0} قناة', [list.length]);
    if (!list.length) return fill(grid, emptyBox(cat === 'fav' ? t('مفيش قنوات في قائمتك — اضغط F على أي قناة علشان تضيفها') : t('مفيش قنوات هنا')));
    stop = chunkedGrid(grid, list, (c) => channelTile(c, { list }), { ensureKey: ensureKey && ensureKey.replace(/^live:/, ''), keyOf: (c) => c.id });
  }

  function select(id) {
    cat = id;
    Router.update({ cat });
    renderChips();
    chips.querySelector('.active').focus({ preventScroll: true });
    renderGrid();
  }

  fill(root,
    h('div.page',
      h('div.page-head', h('h1', t('البث المباشر')), count),
      chips,
      grid,
    ),
  );
  renderChips();
  renderGrid(ctx.entry.focusKey);
  const active = chips.querySelector('.active');
  if (active) {
    active.setAttribute('data-autofocus', '');
    active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  return () => stop && stop();
}

// ---------------- movies / series ----------------
const KINDS = {
  movie: { title: t('الأفلام'), cats: 'get_vod_categories' },
  series: { title: t('المسلسلات'), cats: 'get_series_categories' },
};

async function browseView(root, params, ctx) {
  const K = KINDS[params.kind];
  root.append(loading());
  const [cats, all] = await Promise.all([cached(K.cats).catch(() => []), loadAll([params.kind])]);
  if (!ctx.alive()) return;
  const items = all[params.kind].sort((a, b) => b.added - a.added);
  const cat = params.cat || 'all';
  const catList = asArray(cats).map((c) => ({ id: String(c.category_id), name: c.category_name }));
  const byCat = new Map();
  for (const x of items) {
    if (!byCat.has(x.cat)) byCat.set(x.cat, []);
    byCat.get(x.cat).push(x);
  }
  const head = h('div.page-head.browse-head',
    h('h1', K.title),
    selectBox([['all', t('كل الأقسام')], ...catList.filter((c) => byCat.has(c.id)).map((c) => [c.id, c.name])], cat,
      (v) => Router.go('browse', { kind: params.kind, cat: v }, { replace: true }), { 'data-key': 'cat-select' }),
  );

  if (cat !== 'all') {
    const list = byCat.get(cat) || [];
    const grid = h('div.grid.posters');
    fill(root, h('div.page', head, h('div.muted.small', t('{0} عنوان', [list.length])), grid));
    if (!list.length) grid.append(emptyBox(t('القسم ده فاضي')));
    const stop = chunkedGrid(grid, list, (x) => posterCard(x), { ensureKey: ctx.entry.focusKey && ctx.entry.focusKey.replace(/^\w+:/, ''), keyOf: (x) => x.id });
    const first = grid.querySelector('.pcard');
    if (first) first.setAttribute('data-autofocus', '');
    return stop;
  }

  // All categories: billboard + one row per category, added while scrolling.
  const f = items.find((x) => x.poster) || null;
  let fInfo = {};
  if (f && params.kind === 'movie') {
    fInfo = await Promise.race([cached('get_vod_info', { vod_id: f.id }).then((r) => (r && r.info) || {}).catch(() => ({})), new Promise((r) => setTimeout(() => r({}), 4000))]);
    if (!ctx.alive()) return;
  }
  const fBackdrop = asArray(fInfo.backdrop_path)[0] || f && f.backdrop;
  const rows = h('div.rows');
  fill(root,
    f ? hero({
      image: fBackdrop || f.poster,
      posterOnly: !fBackdrop,
      title: f.name,
      meta: [t('جديد'), String(fInfo.releasedate || '').slice(0, 4), fInfo.genre, Number(f.rating) ? `★ ${Number(f.rating).toFixed(1)}` : null],
      plot: fInfo.plot || f.plot,
      buttons: [playButton(params.kind === 'movie' ? t('تشغيل') : t('شوف الحلقات'), () => (params.kind === 'movie'
        ? (S.playlist = [{ kind: 'movie', id: f.id, ext: f.ext, title: f.name, poster: f.poster }], Router.go('player', { ...S.playlist[0], idx: 0 }))
        : openItem(f)), { 'data-key': 'hero:play', 'data-autofocus': true }),
      ghostButton('info', t('مزيد من المعلومات'), () => openItem(f), { 'data-key': 'hero:info' })],
    }) : null,
    h('div.overlay-head', head),
    rows,
  );
  const groups = [[t('أحدث الإضافات'), items.slice(0, 30), null], ...catList.filter((c) => byCat.has(c.id)).map((c) => [c.name, byCat.get(c.id), c.id])];
  let next = 0;
  const sentinel = h('div.sentinel');
  rows.append(sentinel);
  const addRows = (n) => {
    for (const end = Math.min(groups.length, next + n); next < end; next++) {
      const [title, list, id] = groups[next];
      sentinel.before(contentRow(title, list.slice(0, 30).map((x) => posterCard(x, { key: `r${next}:${x.kind}:${x.id}` })),
        { more: id ? () => Router.go('browse', { kind: params.kind, cat: id }) : null }));
    }
  };
  const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && addRows(4), { rootMargin: '600px' });
  addRows(6);
  // When coming back, make sure the row that had focus exists again.
  const m = ctx.entry.focusKey && ctx.entry.focusKey.match(/^r(\d+):/);
  if (m) addRows(Number(m[1]) + 1 - next);
  io.observe(sentinel);
  return () => io.disconnect();
}

// ---------------- my list ----------------
async function mylistView(root, params, ctx) {
  root.append(loading());
  const all = await loadAll(['movie', 'series', 'live']);
  if (!ctx.alive()) return;
  const pick = (kind) => {
    const idx = new Map(all[kind].map((x) => [x.id, x]));
    return (S.favorites[kind] || []).map((id) => idx.get(id)).filter(Boolean);
  };
  const movies = pick('movie');
  const series = pick('series');
  const live = pick('live');
  const section = (title, nodes, cls) => (nodes.length ? h('section.list-section', h('h2.row-title', title), h(`div.grid.${cls}`, ...nodes)) : null);
  fill(root,
    h('div.page',
      h('div.page-head', h('h1', t('قائمتي'))),
      section(t('الأفلام'), movies.map((x) => posterCard(x)), 'posters'),
      section(t('المسلسلات'), series.map((x) => posterCard(x)), 'posters'),
      section(t('القنوات'), live.map((c) => channelTile(c, { list: live })), 'channels'),
      !movies.length && !series.length && !live.length ? emptyBox(t('قائمتك فاضية — اضغط F على أي فيلم أو مسلسل أو قناة، أو زرار "قائمتي" في صفحته')) : null,
    ),
  );
}

// ---------------- movie details ----------------
function favButton(kind, id, name) {
  const b = h('button.btn.btn-circle.focusable', { title: t('قائمتي (F)'), 'data-key': 'fav' });
  const paint = () => b.replaceChildren(icon(isFav(kind, id) ? 'check' : 'plus'));
  paint();
  b.addEventListener('click', async () => {
    await toggleFav(kind, id, name);
    paint();
  });
  return b;
}

async function movieView(root, params, ctx) {
  root.append(loading());
  const [r, all, usage] = await Promise.all([
    cached('get_vod_info', { vod_id: params.id }).catch(() => null),
    loadAll(['movie']),
    window.api.usage().catch(() => ({ sessions: [] })),
  ]);
  if (!ctx.alive()) return;
  const info = (r && r.info) || {};
  const md = (r && r.movie_data) || {};
  const self = all.movie.find((x) => x.id === String(params.id));
  const title = md.name || info.name || params.title;
  const poster = info.movie_image || info.cover_big || (self && self.poster);
  const main = { id: String(md.stream_id || params.id), ext: md.container_extension || params.ext || (self && self.ext) || 'mp4', name: title };
  // Same movie in other qualities on the server (4K / 1080p / 720p ...): pick one before playing.
  const variants = self ? variantsOf(self, all.movie) : [];
  let chosen = main;
  const resumeOf = (v) => store.get(`resume:${S.account.id}:movie:${v.id}`, 0);
  const play = (fromStart) => {
    if (fromStart) store.del(`resume:${S.account.id}:movie:${chosen.id}`);
    S.playlist = [{ kind: 'movie', id: chosen.id, ext: chosen.ext || 'mp4', title: chosen.name, poster }];
    Router.go('player', { ...S.playlist[0], idx: 0 });
  };
  const playBtn = playButton('', () => play(false), { 'data-autofocus': true, 'data-key': 'play' });
  const restartBtn = ghostButton('replay', t('من البداية'), () => play(true), { 'data-key': 'restart' });
  const paintButtons = () => {
    const resume = resumeOf(chosen);
    playBtn.lastChild.textContent = resume > 30 ? t('استكمال من {0}', [fmtDuration(resume * 1000)]) : t('تشغيل');
    restartBtn.hidden = !(resume > 30);
  };
  paintButtons();

  let qualityRow = null;
  if (variants.length > 1) {
    const chips = variants.map((v) => {
      const est = perHourFromHistory(usage.sessions || [], v.id);
      const b = h(`button.chip.focusable${v.id === main.id ? '.active' : ''}`, { 'data-key': `q:${v.id}`, title: v.name },
        qualityOf(v.name).label, est ? h('span.chip-count', t('≈ {0}/ساعة', [fmtBytes(est)])) : null);
      b.addEventListener('click', () => {
        chosen = { id: v.id, ext: v.ext, name: v.name };
        qualityRow.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
        paintButtons();
      });
      return b;
    });
    qualityRow = h('div.quality-row', h('span.muted', t('الجودة:')), chips);
  }

  const year = String(info.releasedate || info.year || '').slice(0, 4);
  const variantIds = new Set(variants.map((v) => v.id));
  const similar = self ? all.movie.filter((x) => x.cat === self.cat && !variantIds.has(x.id) && x.id !== self.id).slice(0, 30) : [];

  fill(root,
    hero({
      small: true,
      image: asArray(info.backdrop_path)[0] || poster,
      posterOnly: !asArray(info.backdrop_path)[0],
      title,
      meta: [year, info.duration, info.genre, Number(info.rating) ? `★ ${Number(info.rating).toFixed(1)}` : null],
      plot: info.plot || info.description,
      buttons: [playBtn, restartBtn, favButton('movie', params.id, title)],
      after: qualityRow,
    }),
    h('div.details-extra',
      info.cast || info.actors ? h('div', h('span.muted', t('بطولة: ')), info.cast || info.actors) : null,
      info.director ? h('div', h('span.muted', t('إخراج: ')), info.director) : null,
      info.country ? h('div', h('span.muted', t('البلد: ')), info.country) : null,
    ),
    h('div.rows', contentRow(t('أفلام مشابهة'), similar.map((x) => posterCard(x, { key: `sim:${x.id}` })))),
  );
}

// ---------------- series details ----------------
async function seriesInfoView(root, params, ctx) {
  root.append(loading());
  const [r, all] = await Promise.all([cached('get_series_info', { series_id: params.id }), loadAll(['series'])]);
  if (!ctx.alive()) return;
  const info = (r && r.info) || {};
  const self = all.series.find((x) => x.id === String(params.id));
  const eps = r && r.episodes;
  const seasonsMap = new Map();
  if (Array.isArray(eps)) {
    for (const e of eps.flat()) {
      const s = String(e.season ?? 1);
      if (!seasonsMap.has(s)) seasonsMap.set(s, []);
      seasonsMap.get(s).push(e);
    }
  } else if (eps && typeof eps === 'object') {
    for (const [s, list] of Object.entries(eps)) seasonsMap.set(String(s), asArray(list));
  }
  const seasons = [...seasonsMap.keys()].sort((a, b) => Number(a) - Number(b));
  const name = info.name || params.title;
  const cover = info.cover || (self && self.poster);
  const last = History.list().find((e) => e.kind === 'series' && String(e.seriesId) === String(params.id));
  let season = params.season && seasonsMap.has(params.season) ? params.season : (last && last.season) || seasons[0];

  const episodeItems = (s) => (seasonsMap.get(s) || []).map((e) => ({
    kind: 'series',
    id: String(e.id),
    ext: e.container_extension || 'mp4',
    title: `${name} - S${s}E${e.episode_num}`,
    seriesId: String(params.id),
    seriesTitle: name,
    season: s,
    label: t('الموسم {0} · الحلقة {1}', [s, e.episode_num]),
    poster: cover,
    raw: e,
  }));
  const playEp = (items, i) => {
    S.playlist = items.map(({ raw, ...x }) => x);
    Router.go('player', { ...S.playlist[i], idx: i });
  };

  const epBox = h('div.episodes');
  function renderEpisodes() {
    const items = episodeItems(season);
    fill(epBox, items.map((it, i) => {
      const e = it.raw;
      const ei = e.info || {};
      const pos = store.get(`resume:${S.account.id}:series:${it.id}`, 0);
      const dur = Number(ei.duration_secs) || 0;
      return h('button.episode.focusable', { 'data-key': `ep:${it.id}`, onclick: () => playEp(items, i) },
        h('div.ep-num', e.episode_num),
        h('div.ep-thumb', ei.movie_image ? imgOrInitial(ei.movie_image, '') : h('div.no-img', icon('play')),
          h('div.ep-play', icon('play')),
          pos > 30 ? h('div.progress', h('div', { style: { width: `${dur ? Math.min(100, (pos / dur) * 100) : 50}%` } })) : null),
        h('div.ep-body',
          h('div.ep-head', h('span.ep-title', e.title || t('الحلقة {0}', [e.episode_num])), ei.duration ? h('span.muted', ei.duration) : null),
          ei.plot ? h('div.ep-plot', ei.plot) : null,
        ),
      );
    }));
    if (!items.length) epBox.append(emptyBox(t('مفيش حلقات')));
  }

  const firstItems = episodeItems(season);
  const lastIdx = last ? firstItems.findIndex((x) => x.id === String(last.id)) : -1;
  const similar = self ? all.series.filter((x) => x.cat === self.cat && x.id !== self.id).slice(0, 30) : [];

  fill(root,
    hero({
      small: true,
      image: asArray(info.backdrop_path)[0] || cover,
      posterOnly: !asArray(info.backdrop_path)[0],
      title: name,
      meta: [String(info.releaseDate || info.year || '').slice(0, 4), seasons.length ? t('{0} {1}', [seasons.length, seasons.length > 1 ? t('مواسم') : t('موسم')]) : null, info.genre, Number(info.rating) ? `★ ${Number(info.rating).toFixed(1)}` : null],
      plot: info.plot,
      buttons: [
        firstItems.length ? playButton(lastIdx >= 0 ? t('كمّل {0}', [firstItems[lastIdx].label]) : t('تشغيل الحلقة 1'), () => playEp(firstItems, Math.max(0, lastIdx)), { 'data-key': 'play', 'data-autofocus': true }) : null,
        favButton('series', params.id, name),
      ],
    }),
    h('section.page.episodes-section',
      h('div.page-head',
        h('h2', t('الحلقات')),
        seasons.length > 1 ? selectBox(seasons.map((s) => [s, t('الموسم {0}', [s])]), season, (v) => {
          season = v;
          Router.update({ season });
          renderEpisodes();
        }, { 'data-key': 'season' }) : seasons.length ? h('span.muted', t('الموسم {0}', [season])) : null,
      ),
      epBox,
    ),
    h('div.rows', contentRow(t('مسلسلات مشابهة'), similar.map((x) => posterCard(x, { key: `sim:${x.id}` })))),
  );
  renderEpisodes();
}

// ---------------- search ----------------
async function searchView(root, params, ctx) {
  const input = h('input.search-input.focusable', { placeholder: t('دوّر على فيلم، مسلسل أو قناة'), value: params.q || '', 'data-search': true, 'data-autofocus': true });
  const results = h('div');
  fill(root, h('div.page', h('div.search-bar', icon('search'), input), results));
  results.append(loading());
  const all = await loadAll(['live', 'movie', 'series']);
  if (!ctx.alive()) return;

  const run = () => {
    const q = input.value.trim().toLowerCase();
    Router.update({ q: input.value });
    if (!q) return fill(results, emptyBox(t('اكتب اسم اللي بتدور عليه')));
    const match = (x) => String(x.name || '').toLowerCase().includes(q);
    const live = all.live.filter(match).slice(0, 40);
    const movies = all.movie.filter(match).slice(0, 60);
    const series = all.series.filter(match).slice(0, 60);
    const section = (title, nodes, cls) => (nodes.length ? h('section.list-section', h('h2.row-title', title), h(`div.grid.${cls}`, ...nodes)) : null);
    fill(results,
      section(t('الأفلام'), movies.map((x) => posterCard(x)), 'posters'),
      section(t('المسلسلات'), series.map((x) => posterCard(x)), 'posters'),
      section(t('القنوات'), live.map((c) => channelTile(c, { list: live })), 'channels'),
      !live.length && !movies.length && !series.length ? emptyBox(t('مفيش نتايج لـ "{0}"', [input.value])) : null,
    );
  };
  input.addEventListener('input', debounce(run, 250));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      const first = results.querySelector('.focusable');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  run();
}

// ---------------- settings ----------------
async function settingsView(root) {
  const ua = h('input.input.focusable', { value: S.settings.userAgent, dir: 'ltr' });
  const deviceName = h('input.input.focusable', { value: S.settings.deviceName || '', placeholder: t('اسم الجهاز') });
  const u = (S.info && S.info.user_info) || {};
  const exp = Number(u.exp_date) ? new Date(Number(u.exp_date) * 1000).toLocaleDateString(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' }) : t('غير محدود');
  const daysLeft = Number(u.exp_date) ? Math.ceil((Number(u.exp_date) * 1000 - Date.now()) / 86_400_000) : null;
  let liveFmt = S.settings.liveFormat;
  const isM3U = S.account && S.account.type === 'm3u';
  const m3u = (S.info && S.info.m3u) || {};
  // links are downloaded again; a file from the device is read again from the saved copy
  const reloadPlaylist = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await enterAccount(await window.api.connect(S.account.id));
      toast(t('تم تحديث القائمة'));
    } catch (err) {
      btn.disabled = false;
      toast(tErr(err.message), 5000);
    }
  };

  const save = async (patch, msg = t('تم الحفظ')) => {
    S.settings = await window.api.saveSettings(patch);
    S.liveFormatFallback = null;
    toast(msg);
  };
  const settingRow = (title, desc, control) => h('div.setting', h('div.setting-text', h('div.setting-title', title), desc ? h('div.setting-desc', desc) : null), control);

  const keys = [
    [t('الأسهم'), t('التنقل بين العناصر')],
    ['Enter', t('اختيار / تشغيل')],
    [t('Esc · Backspace · Alt+← · ⌘[ · زرار الماوس الخلفي'), t('رجوع')],
    [t('Alt+→ · ⌘] · زرار الماوس الأمامي'), t('تقدم')],
    [t('/ أو ⌘F / Ctrl+F'), t('بحث')],
    ['F', t('إضافة/شيل من قائمتي (على أي فيلم أو مسلسل أو قناة)')],
    ['Space', t('تشغيل / إيقاف مؤقت')],
    ['↑ ↓ · PageUp/PageDown', t('القناة السابقة / التالية')],
    [t('← → · دبل كليك على جنب الشاشة'), t('تقديم وتأخير (المدة من هنا)')],
    [t('+ / - · عجلة الماوس'), t('الصوت')],
    ['M', t('كتم الصوت')],
    [t('F · دبل كليك في نص الشاشة'), t('ملء الشاشة')],
    ['I', t('إظهار/إخفاء عداد الاستهلاك في المشغل')],
    ['C', t('وضع التوافق (تشغيل أي صيغة بالتحويل)')],
    ['Q', t('اختيار الجودة (لو فيه أكتر من جودة)')],
  ];

  root.append(
    h('div.page.narrow',
      h('h1', t('الإعدادات')),
      h('section.settings-card',
        h('h2', t('الحساب')),
        settingRow(S.account ? S.account.name : '—', S.account ? (isM3U ? t('قائمة M3U · {0}', [S.account.server]) : `${S.account.username} @ ${S.account.server}`) : null,
          h('div.btn-pair',
            isM3U ? h('button.btn.btn-outline.focusable', { onclick: reloadPlaylist }, t('تحديث القائمة')) : null,
            h('button.btn.btn-outline.focusable', { onclick: switchAccount }, t('تبديل الحساب')))),
        isM3U ? h('div.account-facts',
          h('div', h('span.muted', t('قنوات')), h('b', String(m3u.live ?? '—'))),
          h('div', h('span.muted', t('أفلام')), h('b', String(m3u.movie ?? '—'))),
          h('div', h('span.muted', t('مسلسلات')), h('b', String(m3u.series ?? '—'))),
          h('div', h('span.muted', t('دليل البرامج')), h('b', m3u.epg ? t('موجود') : t('مش موجود في القائمة'))),
        ) : h('div.account-facts',
          h('div', h('span.muted', t('الحالة')), h('b', u.status || '—')),
          h('div', h('span.muted', t('ينتهي')), h('b', exp, daysLeft != null ? t(' ({0} يوم)', [daysLeft]) : '')),
          h('div', h('span.muted', t('الأجهزة')), h('b', `${u.active_cons ?? '—'} / ${u.max_connections ?? '—'}`)),
        ),
      ),
      // the title is in both languages, so it can be found whichever language is on
      h('section.settings-card',
        h('h2', RTL ? 'اللغة · Language' : 'Language · اللغة'),
        settingRow(t('لغة البرنامج'), t('تلقائي = نفس لغة الجهاز.'),
          selectBox([['', t('تلقائي (لغة الجهاز)')], ['ar', 'العربية'], ['en', 'English']], languageSetting(), (v) => setLanguage(v), { 'data-key': 'language' })),
      ),
      S.platform === 'android' ? h('section.settings-card',
        h('h2', t('الشاشة')),
        settingRow(t('شكل الواجهة'), S.formFactor === 'phone' ? t('تلقائي: شكل الموبايل.') : t('تلقائي: شكل التلفزيون — بالريموت على التي في وباللمس على التابلت.'),
          selectBox([['auto', t('تلقائي')], ['mobile', t('موبايل (لمس)')], ['tv', t('تلفزيون (ريموت)')]], S.settings.uiMode || 'auto', async (v) => {
            await save({ uiMode: v }, t('تم تغيير شكل الواجهة'));
            applyUiMode();
            renderTopbar();
            Router.render();
          }, { 'data-key': 'ui-mode' })),
      ) : null,
      h('section.settings-card',
        h('h2', t('المشغل')),
        settingRow(t('عداد الاستهلاك جوه المشغل'), t('السرعة والاستهلاك ومدة المشاهدة فوق الفيديو. الاستهلاك بيتحسب برضه وبيبان في صفحة "الاستهلاك" حتى لو العداد مخفي.'),
          switchButton(S.settings.showPlayerStats !== false, (on) => save({ showPlayerStats: on }, on ? t('العداد هيظهر في المشغل') : t('العداد اتخفى من المشغل')), { 'data-autofocus': true, 'data-key': 'stats-switch' })),
        settingRow(t('مدة التقديم والتأخير'), t('للأسهم ← → وزراير التقديم والتأخير في المشغل. ودبل كليك على يمين الشاشة بيقدّم وعلى شمالها بيرجّع (ودبل كليك في النص = ملء الشاشة).'),
          selectBox([[5, t('5 ثواني')], [10, t('10 ثواني')], [15, t('15 ثانية')], [30, t('30 ثانية')], [60, t('دقيقة')], [300, t('5 دقايق')]], S.settings.seekStep || 10, (v) => save({ seekStep: Number(v) }), { 'data-key': 'seek-step' })),
        settingRow(t('صيغة البث المباشر'), t('TS أسرع غالبًا، HLS أكثر توافقًا مع بعض السيرفرات.'),
          selectBox([['ts', 'MPEG-TS'], ['m3u8', 'HLS']], liveFmt, (v) => save({ liveFormat: (liveFmt = v) }))),
        h('div.setting-desc', { style: { marginTop: '10px' } }, S.platform === 'android'
          ? t('أي فيلم أو قناة صيغتها مش مدعومة في المشغل العادي (MKV، صوت AC3/DTS، HEVC…) بيتفتح لوحده في مشغل أندرويد الأصلي، والاستهلاك بيتحسب برضه.')
          : t('أي فيلم أو قناة صيغتها مش مدعومة (MKV، صوت AC3/DTS، HEVC…) بيتحول تلقائيًا لـ"وضع التوافق" ويشتغل جوه البرنامج.')),
      ),
      h('section.settings-card',
        h('h2', t('توفير الاستهلاك')),
        settingRow(t('لسه بتتفرج؟'), t('لو مفيش أي حركة من الكيبورد أو الماوس للمدة دي، التشغيل بيقف وبيسألك — علشان البث ميفضلش شغال ويسحب باقة وانت مش قاعد.'),
          h('div.row',
            selectBox([[1, t('ساعة')], [2, t('ساعتين')], [3, t('3 ساعات')], [4, t('4 ساعات')]], S.settings.stillWatchingHours || 2, (v) => save({ stillWatchingHours: Number(v) })),
            switchButton(S.settings.stillWatching !== false, (on) => save({ stillWatching: on }, on ? t('سؤال "لسه بتتفرج؟" شغال') : t('سؤال "لسه بتتفرج؟" اتقفل')), { 'data-key': 'still-switch' }),
          )),
        settingRow(t('مدة البافر (الأفلام والمسلسلات)'), t('البرنامج بيحمّل قدامك المدة دي بس، ولو قدّمت أو رجعت بيبدأ من المكان الجديد. أقل = توفير أكتر، بس لو النت بيقطع ممكن يقف يحمّل. البث المباشر مش داخل في ده.'),
          selectBox([[30, t('30 ثانية')], [60, t('دقيقة')], [120, t('دقيقتين')], [300, t('5 دقايق')]], S.settings.bufferSeconds || 60, (v) => save({ bufferSeconds: Number(v) }), { 'data-key': 'buffer' })),
        settingRow(t('وقّف التشغيل لما البرنامج يتصغّر'), S.platform === 'android'
          ? t('البث بيقف لما تخرج من التطبيق أو تقفل الشاشة، وبيكمّل لوحده لما ترجعله.')
          : t('البث بيقف وانت مصغّر البرنامج (أو مخبيه بـ ⌘H)، وبيكمّل لوحده لما ترجعله.'),
          switchButton(S.settings.pauseWhenMinimized !== false, (on) => save({ pauseWhenMinimized: on }), { 'data-key': 'min-switch' })),
        h('div.setting-desc', { style: { marginTop: '10px' } }, t('اختيار الجودة: لو القناة أو الفيلم موجودين بأكتر من جودة على السيرفر (4K / FHD / HD / SD)، اختار من زرار الجودة في المشغل (Q) أو من صفحة الفيلم. الجودة الأقل = استهلاك أقل، وجنب كل جودة بيظهر استهلاكها في الساعة من مشاهداتك قبل كده.')),
      ),
      h('section.settings-card',
        h('h2', t('الجهاز')),
        h('div.setting-desc', t('الاستهلاك بيتحسب لكل جهاز لوحده — الجهاز ده بيعرض استهلاكه هو بس.')),
        h('div.row', deviceName, h('button.btn.btn-red.focusable', { onclick: () => save({ deviceName: deviceName.value }, t('تم حفظ اسم الجهاز')) }, t('حفظ'))),
      ),
      h('section.settings-card',
        h('h2', t('متقدم')),
        h('div.setting-title', 'User-Agent'),
        h('div.setting-desc', t('بعض السيرفرات بتطلب قيمة معينة.')),
        h('div.row', ua, h('button.btn.btn-red.focusable', { onclick: () => save({ userAgent: ua.value.trim() }) }, t('حفظ'))),
      ),
      S.platform === 'android' ? null : h('section.settings-card', h('h2', t('اختصارات الكيبورد والماوس')),
        h('table.keys', h('tbody', ...keys.map(([k, v]) => h('tr', h('td', h('kbd', k)), h('td', v)))))),
    ),
  );
}

async function switchAccount() {
  await window.api.logout();
  S.account = null;
  renderTopbar();
  Router.reset('accounts');
}
