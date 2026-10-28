// Local HTTP proxy between the player and the IPTV server.
// Every stream, playlist segment and poster goes through here, which lets us:
//   - count the exact bytes downloaded (data usage),
//   - send the configured User-Agent (many Xtream servers require one),
//   - follow the server's redirects and avoid CORS problems in the player.
const http = require('http');
const { Readable, Transform } = require('stream');

const PREFERRED_PORT = 17845;

function isPlaylist(contentType, finalUrl) {
  if (/mpegurl/i.test(contentType)) return true;
  try {
    return /\.m3u8?$/i.test(new URL(finalUrl).pathname);
  } catch {
    return false;
  }
}

// Fixed buffer for movies/episodes: lets the file through only up to (playback position + buffer
// seconds), converted to a byte offset with the file's average bytes per second. Holding chunks
// back stops reading upstream (backpressure), so nothing more is downloaded.
// A request that starts beyond that window is either a seek (the player reports the new position
// within a moment) or a read of the index at the end of an MP4/MKV, which must pass or playback
// would never start: after 1.5s without the position catching up it is treated as the latter.
const FREE_BYTES = 6 * 1024 * 1024; // every request may start with this much (also covers ffmpeg's probe)
const NO_POSITION_MS = 6000; // a movie whose player never reports a position isn't held back
const INDEX_BYTES = 32 * 1024 * 1024; // cap for an index read at the end of the file

function positionGate({ getPlayback, sid, start, total }) {
  const t0 = Date.now();
  let free = null; // decided on the first chunk
  let sent = 0;
  let timer = null;
  let done = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      const pass = () => {
        if (done) return;
        const pb = getPlayback(sid);
        const bps = pb && pb.dur > 0 && pb.buffer > 0 ? total / pb.dur : 0;
        if (!bps) {
          // The request can start before the player's first position report (ffmpeg in
          // compatibility mode does): give it the start allowance, then wait for the report.
          if (start + sent + chunk.length <= start + FREE_BYTES || Date.now() - t0 > NO_POSITION_MS) {
            sent += chunk.length;
            return cb(null, chunk);
          }
          return (timer = setTimeout(pass, 300));
        }
        const windowEnd = (pb.pos + pb.buffer) * bps;
        if (free == null) {
          if (start <= windowEnd + FREE_BYTES) free = FREE_BYTES;
          else if (Date.now() - t0 > 1500) free = INDEX_BYTES;
          else return (timer = setTimeout(pass, 250));
        }
        if (start + sent + chunk.length <= Math.max(start + free, windowEnd)) {
          sent += chunk.length;
          return cb(null, chunk);
        }
        timer = setTimeout(pass, 400);
      };
      pass();
    },
    destroy(err, cb) {
      done = true;
      clearTimeout(timer);
      cb(err);
    },
  });
}

function createProxy({ usage, getUserAgent, transcoder, getPlayback, isVod }) {
  let origin = '';
  const sessionHeaders = new Map(); // sid -> extra request headers (M3U #EXTVLCOPT user agent / referrer)

  // The path keeps the target's file extension (/p/x.ts?...) because ffmpeg's HLS reader checks it.
  const wrap = (target, sid = '') => {
    let ext = '';
    try {
      ext = (new URL(target).pathname.match(/\.(\w{1,5})$/) || [])[1] || '';
    } catch { /* keep no extension */ }
    return `${origin}/p${ext ? `/x.${ext}` : ''}?s=${encodeURIComponent(sid)}&u=${encodeURIComponent(target)}`;
  };

  async function handle(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const reqUrl = new URL(req.url, 'http://localhost');
    if (reqUrl.pathname === '/t') {
      // compatibility mode: ffmpeg output (its input already goes through /p and is counted there)
      return transcoder.serve(req, res, reqUrl.searchParams.get('j'), Number(reqUrl.searchParams.get('ss')) || 0);
    }
    const target = reqUrl.searchParams.get('u');
    const sid = reqUrl.searchParams.get('s') || '';
    if (!/^\/p(\/|$)/.test(reqUrl.pathname) || !target || !/^https?:\/\//i.test(target)) {
      res.writeHead(404);
      return res.end();
    }

    const ac = new AbortController();
    res.on('close', () => ac.abort());

    const headers = { 'User-Agent': getUserAgent(), Accept: '*/*', 'Accept-Encoding': 'identity', ...sessionHeaders.get(sid) };
    if (req.headers.range) headers.Range = req.headers.range;

    let up;
    try {
      up = await fetch(target, { headers, redirect: 'follow', signal: ac.signal });
    } catch (e) {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(String(e.cause?.message || e.message));
      }
      return;
    }

    const contentType = up.headers.get('content-type') || '';

    if (up.ok && isPlaylist(contentType, up.url)) {
      // HLS playlist: rewrite every URI so segments/sub-playlists also pass through the proxy.
      let text;
      try {
        text = await up.text();
      } catch {
        return res.destroy();
      }
      usage.add(sid, Buffer.byteLength(text));
      const base = up.url;
      const abs = (uri) => wrap(new URL(uri, base).href, sid);
      const out = text
        .split(/\r?\n/)
        .map((line) => {
          const t = line.trim();
          if (!t) return line;
          if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${abs(uri)}"`);
          return abs(t);
        })
        .join('\n');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' });
      return res.end(out);
    }

    const outHeaders = { 'Content-Type': contentType || 'application/octet-stream' };
    for (const h of ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      const v = up.headers.get(h);
      if (v) outHeaders[h] = v;
    }
    if (/^image\//i.test(contentType)) outHeaders['Cache-Control'] = 'max-age=604800';
    res.writeHead(up.status, outHeaders);

    if (!up.body) return res.end();
    const body = Readable.fromWeb(up.body);
    body.on('data', (chunk) => usage.add(sid, chunk.length));
    body.on('error', () => res.destroy());
    res.on('close', () => body.destroy());
    // Movies/episodes report their position (see stream:position); live channels never do.
    const range = (up.headers.get('content-range') || '').match(/bytes (\d+)-\d+\/(\d+)/);
    const total = range ? Number(range[2]) : Number(up.headers.get('content-length')) || 0;
    if (sid && total && isVod(sid)) {
      const gate = positionGate({ getPlayback, sid, start: range ? Number(range[1]) : 0, total });
      res.on('close', () => gate.destroy());
      body.pipe(gate).pipe(res);
    } else body.pipe(res);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('proxy error', e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  function listen(port) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve(server.address().port);
      });
    });
  }

  return {
    async start() {
      let port;
      try {
        port = await listen(PREFERRED_PORT);
      } catch {
        port = await listen(0); // preferred port busy: let the OS pick one
      }
      origin = `http://127.0.0.1:${port}`;
      return origin;
    },
    wrap,
    setHeaders: (sid, h) => (h && Object.keys(h).length ? sessionHeaders.set(sid, h) : sessionHeaders.delete(sid)),
    close: () => server.close(),
  };
}

module.exports = { createProxy };
