// M3U playlists (a link or a file from the device). The playlist is turned into the same answers
// the Xtream API gives (categories, channels, movies, series, episodes), so the screens work the
// same for both kinds of account. Channels/movies/series are told apart from the links and names.
const crypto = require('crypto');
const { XmltvGuide } = require('./xmltv');

const VOD_EXT = /^(mp4|mkv|avi|mov|wmv|flv|m4v|webm|mpg|mpeg|divx|xvid|3gp|vob|rmvb|m2ts|mts|ogv)$/i;
const EPISODE = /^(.*?)[\s._\-|:([]*S(\d{1,2})[\s._-]*E(\d{1,4})\b/i;

const id = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function attrs(s) {
  const out = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

function extOf(url) {
  try {
    return (new URL(url).pathname.match(/\.(\w{1,5})$/) || [])[1] || '';
  } catch {
    return '';
  }
}

// -> { epgUrl, entries: [{ name, url, logo, group, tvgId, tvgName, ua, referrer }] }
function parseM3U(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  let epgUrl = '';
  const entries = [];
  let cur = null;
  let group = '';
  let opts = {};
  for (let raw of lines) {
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
        // "url|User-Agent=...&Referer=..." (Kodi style)
        const [url, extra] = line.split('|');
        const e = { name: '', logo: '', group: '', tvgId: '', tvgName: '', ...cur, url: url.trim(), ...opts };
        if (extra) {
          for (const part of extra.split('&')) {
            const [k, v = ''] = part.split('=');
            if (/^user-agent$/i.test(k)) e.ua = decodeURIComponent(v);
            if (/^referr?er$/i.test(k)) e.referrer = decodeURIComponent(v);
          }
        }
        if (!e.group) e.group = group;
        if (!e.name) e.name = decodeURIComponent((e.url.split('?')[0].split('/').pop() || e.url).replace(/\.\w{1,5}$/, ''));
        entries.push(e);
      }
      cur = null;
      opts = {};
    }
  }
  return { epgUrl, entries };
}

// live | movie | episode (+ show / season / episode number)
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
      // "Show S01E02 - Title" -> "Title"; nothing left -> the app shows "Episode 2"
      title: m ? e.name.slice(m[0].length).replace(/^[\s._\-|:)\]]+/, '').trim() : e.name,
    };
  }
  return { kind: 'movie', ext };
}

// Turns a parsed playlist into Xtream-shaped lists.
function buildLibrary(entries) {
  const lib = {
    live: [], movie: [], series: [],
    cats: { live: new Map(), movie: new Map(), series: new Map() },
    byId: new Map(), // stream/episode id -> entry
    shows: new Map(), // series id -> { info, episodes: { season: [] } }
  };
  const cat = (kind, name) => {
    const n = name || 'Other';
    const key = id(`${kind}:${n}`);
    if (!lib.cats[kind].has(key)) lib.cats[kind].set(key, { category_id: key, category_name: n, parent_id: 0 });
    return key;
  };
  let num = 0;
  entries.forEach((e, i) => {
    const c = classify(e);
    const sid = id(e.url);
    if (c.kind === 'live') {
      lib.byId.set(`live:${sid}`, e);
      lib.live.push({ num: ++num, stream_id: sid, name: e.name, stream_icon: e.logo, category_id: cat('live', e.group), epg_channel_id: e.tvgId, ext: c.ext });
    } else if (c.kind === 'movie') {
      lib.byId.set(`movie:${sid}`, e);
      lib.movie.push({ stream_id: sid, name: e.name, stream_icon: e.logo, category_id: cat('movie', e.group), container_extension: c.ext, added: String(entries.length - i), rating: '' });
    } else {
      const showId = id(`series:${c.show.toLowerCase()}`);
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
  for (const show of lib.shows.values()) {
    for (const s of Object.keys(show.episodes)) show.episodes[s].sort((a, b) => a.episode_num - b.episode_num);
  }
  return lib;
}

class M3UClient {
  // source: { text } (already loaded). deps: { usage, getUserAgent, fetchText }
  constructor({ text, label }, { usage, getUserAgent }) {
    const { epgUrl, entries } = parseM3U(text);
    if (!entries.length) throw new Error('الملف ده مش قائمة M3U أو مفيهوش قنوات');
    this.label = label;
    this.lib = buildLibrary(entries);
    this.epgUrl = epgUrl;
    this.guide = epgUrl ? new XmltvGuide(epgUrl, { usage, getUserAgent }) : null;
    if (this.guide) this.guide.load(this.lib.live).catch((e) => console.warn('EPG', e.message));
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
        const listings = ch && this.guide ? this.guide.now(ch, Number(params.limit) || 2) : [];
        return { epg_listings: listings };
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

  // #EXTVLCOPT / "url|User-Agent=..." headers for this stream
  headersFor(kind, id) {
    const e = this.entry(kind, id);
    const h = {};
    if (e.ua) h['User-Agent'] = e.ua;
    if (e.referrer) h.Referer = e.referrer;
    return h;
  }
}

module.exports = { M3UClient, parseM3U, classify, buildLibrary };
