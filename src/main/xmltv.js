// XMLTV guide (the "url-tvg" of an M3U playlist): what's on now / next for each channel.
// Guides can be hundreds of MB, so the file is read as a stream and only programmes of channels in
// the playlist, from an hour ago to a day and a half ahead, are kept.
const zlib = require('zlib');
const { Readable } = require('stream');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);

// "20261028150000 +0200" -> ms
function xmltvTime(s) {
  const m = String(s || '').match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/);
  if (!m) return NaN;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) t -= (m[7][0] === '-' ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3))) * 60_000;
  return t;
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

class XmltvGuide {
  constructor(url, { usage, getUserAgent }) {
    this.url = url;
    this.usage = usage;
    this.getUserAgent = getUserAgent;
    this.programmes = new Map(); // xmltv channel id -> [{ start, stop, title, desc }]
    this.names = new Map(); // display name -> xmltv channel id
  }

  async load(channels) {
    const wanted = new Set();
    for (const c of channels) {
      if (c.epg_channel_id) wanted.add(c.epg_channel_id);
    }
    const res = await fetch(this.url, { headers: { 'User-Agent': this.getUserAgent() }, redirect: 'follow', signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let body = Readable.fromWeb(res.body);
    body.on('data', (b) => this.usage.add('', b.length));
    const gz = /\.gz($|\?)/i.test(this.url) || /gzip/i.test(res.headers.get('content-type') || '');
    if (gz) body = body.pipe(zlib.createGunzip());

    const from = Date.now() - 3_600_000;
    const to = Date.now() + 36 * 3_600_000;
    const names = new Map(channels.map((c) => [norm(c.name), c]));
    let buf = '';
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      buf += decoder.decode(chunk, { stream: true });
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
          const startT = xmltvTime((block.match(/start="([^"]*)"/) || [])[1]);
          const stopT = xmltvTime((block.match(/stop="([^"]*)"/) || [])[1]);
          if (!(stopT > from && startT < to)) continue;
          const title = unescape((block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
          const desc = unescape((block.match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1] || '').trim();
          const list = this.programmes.get(ch) || [];
          list.push({ start: startT, stop: stopT, title, desc });
          this.programmes.set(ch, list);
        } else {
          // channels without tvg-id are matched to the guide by name
          const chId = unescape((block.match(/id="([^"]*)"/) || [])[1] || '');
          const dn = block.match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g) || [];
          for (const d of dn) {
            const n = norm(unescape(d.replace(/<[^>]+>/g, '')));
            if (names.has(n)) {
              this.names.set(n, chId);
              wanted.add(chId);
            }
          }
        }
      }
      buf = buf.slice(pos);
      if (buf.length > 4_000_000) buf = buf.slice(-1_000_000); // broken file: don't grow forever
    }
    for (const list of this.programmes.values()) list.sort((a, b) => a.start - b.start);
  }

  // Xtream get_short_epg shape (titles base64 like Xtream servers send them)
  now(channel, limit = 2) {
    const list = this.programmes.get(channel.epg_channel_id) || this.programmes.get(this.names.get(norm(channel.name))) || [];
    const t = Date.now();
    return list
      .filter((p) => p.stop > t)
      .slice(0, limit)
      .map((p) => ({ title: b64(p.title), description: b64(p.desc), start_timestamp: String(Math.floor(p.start / 1000)), stop_timestamp: String(Math.floor(p.stop / 1000)) }));
  }
}

module.exports = { XmltvGuide, xmltvTime };
