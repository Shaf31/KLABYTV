// Shared UI pieces for the Netflix-style screens: icons, logo, cards, rows, hero.
const APP_NAME = 'KLABYTV';

// Material-style 24x24 icons (the Shoor font has no symbol glyphs).
const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  back: 'M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4z', // points right = "back" in RTL
  forward: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z',
  replay: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  mute: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  fullscreenExit: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  stats: 'M3 13h2v8H3zm4-5h2v13H7zm4 3h2v10h-2zm4-7h2v17h-2zm4 9h2v8h-2z',
  tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  chevronStart: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z', // points right
  chevronEnd: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z', // points left
  chevronDown: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  down: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  tv: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  movie: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H5L3 4H2v16h20V4h-4z',
  layers: 'M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
  bookmark: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z',
  quality: 'M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 12H9.5v-2h-2v2H6V9h1.5v2.5h2V9H11v6zm2-6h4c.55 0 1 .45 1 1v4c0 .55-.45 1-1 1h-4V9zm1.5 4.5h2v-3h-2v3z',
  leaf: 'M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8z',
  gear: 'M19.14 12.94a7.5 7.5 0 0 0 .05-.94 7.5 7.5 0 0 0-.05-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58a7.5 7.5 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
};

// Direction-aware icons were drawn for RTL; in English (LTR) they point the other way.
if (!RTL) {
  [ICONS.back, ICONS.forward] = [ICONS.forward, ICONS.back];
  [ICONS.chevronStart, ICONS.chevronEnd] = [ICONS.chevronEnd, ICONS.chevronStart];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// num: the number drawn inside replay10/forward10 (the seek step).
function icon(name, cls = '', num = '10') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `ic ${cls}`.trim());
  const base = name === 'replay10' || name === 'forward10' ? 'replay' : name;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[base]);
  const g = document.createElementNS(SVG_NS, 'g');
  if (name === 'forward10') g.setAttribute('transform', 'translate(24 0) scale(-1 1)');
  g.append(path);
  svg.append(g);
  if (base === 'replay') {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '12');
    t.setAttribute('y', '16.2');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '6.5');
    t.setAttribute('font-weight', '700');
    t.textContent = String(num);
    if (String(num).length > 2) t.setAttribute('font-size', '5');
    svg.append(t);
  }
  return svg;
}

// App mark: the KLABYTV wolf (same drawing as the app icon, clean version for small sizes).
function logoMark(size = 30) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '150 225 1705 1612');
  svg.setAttribute('width', Math.round(size * 1.06));
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'logo-mark');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', '#fff');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', WOLF_PATH);
  svg.append(path);
  return svg;
}

function logo(size) {
  return h('div.logo', logoMark(size), h('span.logo-word', APP_NAME));
}

// ---------- normalized items ----------
function movieItem(x) {
  return { kind: 'movie', id: String(x.stream_id), name: x.name, poster: x.stream_icon, rating: x.rating, ext: x.container_extension, cat: String(x.category_id), added: Number(x.added) || 0 };
}
function seriesItem(x) {
  return { kind: 'series', id: String(x.series_id), name: x.name, poster: x.cover, rating: x.rating, cat: String(x.category_id), added: Number(x.last_modified) || 0, plot: x.plot, backdrop: asArray(x.backdrop_path)[0] };
}
function liveItem(x) {
  return { kind: 'live', id: String(x.stream_id), name: x.name, logo: x.stream_icon, num: x.num, cat: String(x.category_id), ext: x.ext };
}

function isFav(kind, id) {
  return (S.favorites[kind] || []).includes(String(id));
}

async function toggleFav(kind, id, name) {
  S.favorites = await window.api.toggleFavorite(kind, id);
  const on = isFav(kind, id);
  toast(on ? t('اتضاف لقائمتي: {0}', [name || '']) : t('اتشال من قائمتي: {0}', [name || '']));
  document.querySelectorAll(`[data-fav-kind="${kind}"][data-fav-id="${CSS.escape(String(id))}"]`).forEach((el) => el.classList.toggle('is-fav', on));
  return on;
}

function openItem(item, list) {
  if (item.kind === 'movie') return Router.go('movie', { id: item.id, ext: item.ext, title: item.name });
  if (item.kind === 'series') return Router.go('seriesInfo', { id: item.id, title: item.name });
  // live: the list it came from becomes the channel up/down playlist
  const src = list && list.length ? list : [item];
  S.playlist = src.map((c) => ({ kind: 'live', id: c.id, ext: c.ext || liveFormat(), title: c.name, logo: c.logo }));
  const i = Math.max(0, S.playlist.findIndex((c) => c.id === item.id));
  Router.go('player', { ...S.playlist[i], idx: i });
}

function imgOrInitial(url, name, cls = '') {
  const src = img(url);
  const fallback = h(`div.no-img${cls}`, String(name || '').slice(0, 24));
  if (!src) return fallback;
  return h('img', {
    src,
    loading: 'lazy',
    alt: '',
    onerror: (e) => {
      const card = e.target.closest('.ctile');
      if (card) card.classList.add('no-logo');
      e.target.replaceWith(fallback);
    },
  });
}

// First letter for avatars ("البيت" -> "ب", "home" -> "H").
function initial(name) {
  const s = String(name || '?').trim().replace(/^ال(?=.)/, '');
  return s.charAt(0).toUpperCase();
}

// Poster card (movies/series). opts: { key, onClick, progress (0..1), list }
function posterCard(item, opts = {}) {
  const pct = opts.progress != null ? Math.max(2, Math.min(100, opts.progress * 100)) : null;
  return h(`button.pcard.focusable${isFav(item.kind, item.id) ? '.is-fav' : ''}`, {
    'data-key': opts.key || `${item.kind}:${item.id}`,
    'data-fav-kind': item.kind,
    'data-fav-id': item.id,
    'data-fav-name': item.name,
    title: item.name,
    onclick: opts.onClick || (() => openItem(item, opts.list)),
  },
    h('div.pcard-img',
      imgOrInitial(item.poster, item.name),
      Number(item.rating) ? h('span.pcard-rating', icon('star'), Number(item.rating).toFixed(1)) : null,
      h('span.fav-badge', icon('check')),
      pct != null ? h('div.progress', h('div', { style: { width: `${pct}%` } })) : null,
    ),
    h('div.pcard-name', opts.label || item.name),
  );
}

// 16:9 channel tile. opts: { key, list }
function channelTile(item, opts = {}) {
  return h(`button.ctile.focusable${isFav('live', item.id) ? '.is-fav' : ''}${img(item.logo) ? '' : '.no-logo'}`, {
    'data-key': opts.key || `live:${item.id}`,
    'data-fav-kind': 'live',
    'data-fav-id': item.id,
    'data-fav-name': item.name,
    title: item.name,
    onclick: () => openItem(item, opts.list),
  },
    h('div.ctile-img', imgOrInitial(item.logo, item.name, '.ch'), item.num ? h('span.ctile-num', item.num) : null, h('span.fav-badge', icon('check'))),
    h('div.ctile-name', item.name),
  );
}

// Horizontal Netflix row. nodes: card elements.
function contentRow(title, nodes, { more, cls = '' } = {}) {
  if (!nodes.length) return null;
  const track = h('div.row-track', ...nodes);
  const scroll = (dir) => track.scrollBy({ left: (RTL ? dir : -dir) * track.clientWidth * 0.85, behavior: 'smooth' });
  return h(`section.lane${cls}`,
    h('div.row-head',
      h('h2.row-title', title),
      more ? h('button.row-more.focusable', { onclick: more, 'data-key': `more:${title}` }, t('عرض الكل'), icon('chevronEnd')) : null,
    ),
    h('div.row-body',
      h('button.row-arrow.start', { tabindex: -1, onclick: () => scroll(1), 'aria-label': t('السابق') }, icon('chevronStart')),
      track,
      h('button.row-arrow.end', { tabindex: -1, onclick: () => scroll(-1), 'aria-label': t('التالي') }, icon('chevronEnd')),
    ),
  );
}

// Big billboard at the top of a page.
// posterOnly: no wide backdrop available -> the portrait poster is shown blurred behind the text.
function hero({ image, title, meta = [], plot, buttons = [], small = false, posterOnly = false, after = null }) {
  return h(`section.hero${small ? '.small' : ''}${posterOnly ? '.poster-bg' : ''}`,
    h('div.hero-bg', image ? h('img', { src: img(image), alt: '', onerror: (e) => e.target.remove() }) : null),
    h('div.hero-shade'),
    h('div.hero-body',
      h('h1.hero-title', title),
      meta.filter(Boolean).length ? h('div.meta', ...meta.filter(Boolean).map((m) => h('span', m))) : null,
      plot ? h('p.hero-plot', plot) : null,
      h('div.hero-btns', ...buttons),
      after,
    ),
  );
}

function playButton(label, onclick, extra = {}) {
  return h('button.btn.btn-play.focusable', { onclick, ...extra }, icon('play'), label);
}
function ghostButton(iconName, label, onclick, extra = {}) {
  return h('button.btn.btn-ghost.focusable', { onclick, ...extra }, icon(iconName), label);
}

// Grid that renders in chunks while scrolling (thousands of items).
function chunkedGrid(container, items, render, { ensureKey, keyOf, size = 120 } = {}) {
  container.replaceChildren();
  let i = 0;
  const sentinel = h('div.sentinel');
  container.append(sentinel);
  const io = new IntersectionObserver((ents) => ents.some((e) => e.isIntersecting) && more(), { rootMargin: '800px' });
  function more() {
    if (i >= items.length) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(items.length, i + size);
    for (; i < end; i++) frag.append(render(items[i], i));
    sentinel.before(frag);
    if (i >= items.length) io.disconnect();
  }
  more();
  if (ensureKey && keyOf) {
    const idx = items.findIndex((x) => keyOf(x) === ensureKey);
    while (idx >= 0 && i <= idx) more();
  }
  io.observe(sentinel);
  return () => io.disconnect();
}

function loading(text = '') {
  return h('div.center-box', h('div.spinner'), text ? h('div.muted', text) : null);
}

function emptyBox(text) {
  return h('div.center-box', h('div.muted', text));
}

// Netflix-style dropdown (native select so the keyboard works everywhere).
function selectBox(options, value, onchange, extra = {}) {
  const s = h('select.select.focusable', { onchange: (e) => onchange(e.target.value), ...extra },
    ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  return h('div.select-wrap', s, icon('chevronDown'));
}

// On/off switch as a button so Enter/Space/click all toggle it.
function switchButton(on, onchange, extra = {}) {
  const b = h(`button.switch.focusable${on ? '.on' : ''}`, { role: 'switch', 'aria-checked': String(on), ...extra }, h('span'));
  b.addEventListener('click', () => {
    on = !on;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    onchange(on);
  });
  return b;
}

// ---------- qualities ----------
// Providers often list the same channel/movie several times: "beIN Sports 1 FHD", "... HD", "... SD".
// These are grouped by name with the quality tag removed, so the player can offer them as qualities.
const QUALITY_TAGS = [
  [/(\b(4k|uhd|2160p?)\b|⁴ᴷ|ᵁᴴᴰ)/i, '4K', 2160],
  [/(\b(fhd|full\s*hd|1080[pi]?)\b|ᶠᴴᴰ)/i, 'FHD 1080p', 1080],
  [/(\b(hd|720p?)\b|ᴴᴰ)/i, 'HD 720p', 720],
  [/(\b(sd|480p?|576p?)\b|ˢᴰ)/i, 'SD 480p', 480],
  [/\b(lq|low|360p?|240p?)\b/i, t('جودة منخفضة'), 360],
];
const EXTRA_TAGS = /\b(hevc|h\.?265|h\.?264|x265|x264|\d{2,3}\s?fps|raw|multi\s*audio)\b/gi;

function qualityOf(name) {
  for (const [re, label, rank] of QUALITY_TAGS) if (re.test(name || '')) return { label, rank };
  return { label: t('عادي'), rank: 0 };
}

function baseName(name) {
  let n = String(name || '').toLowerCase().replace(EXTRA_TAGS, ' ');
  for (const [re] of QUALITY_TAGS) n = n.replace(new RegExp(re.source, 'gi'), ' ');
  return n.replace(/[|()[\]{}:_\-–—.•·*]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const variantIndex = new WeakMap();
// All entries of `list` that are the same title in another quality (best quality first).
function variantsOf(item, list) {
  if (!item || !list) return [];
  let idx = variantIndex.get(list);
  if (!idx) {
    idx = new Map();
    for (const x of list) {
      const k = baseName(x.name);
      if (!k) continue;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(x);
    }
    variantIndex.set(list, idx);
  }
  const group = idx.get(baseName(item.name)) || [item];
  return [...group].sort((a, b) => qualityOf(b.name).rank - qualityOf(a.name).rank);
}

// Data per hour seen in past sessions of a stream (from the usage history), or 0 if unknown.
function perHourFromHistory(sessions, streamId) {
  let bytes = 0;
  let ms = 0;
  for (const s of sessions) {
    if (String(s.streamId) !== String(streamId)) continue;
    const d = s.end - s.start;
    if (d < 60_000) continue;
    bytes += s.bytes;
    ms += d;
  }
  return ms ? (bytes / ms) * 3_600_000 : 0;
}
