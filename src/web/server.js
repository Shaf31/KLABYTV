#!/usr/bin/env node
// KLABYTV web version: serves the app to a browser and relays its requests to IPTV servers.
//
// Browsers don't let a web page call an IPTV server directly (the servers don't send CORS
// headers), so the page asks this server instead:  /r?u=<address>&ua=<user agent>&ref=<referer>
// HLS playlists are rewritten so every address in them is absolute (the page then relays each
// one), and an https:// address on a port that only speaks http is retried over http.
//
//   node src/web/server.js            -> http://localhost:8080
//   node src/web/server.js --port 9090
//   node src/web/server.js --lan      -> also reachable from other devices on your network
if (typeof fetch !== 'function') {
  console.error('KLABYTV web needs Node.js 18 or newer (https://nodejs.org). This is Node ' + process.version + '.');
  process.exit(1);
}
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { fetchHttpFallback } = require('../main/net');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : process.env.PORT || 8080) || 8080;
const HOST = args.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
const DEFAULT_UA = 'VLC/3.0.20 LibVLC/3.0.20';

// Only these files are served.
const FILES = [
  /^\/src\/renderer\/[\w./-]+$/,
  /^\/src\/web\/core\.js$/,
  /^\/node_modules\/hls\.js\/dist\/hls\.min\.js$/,
  /^\/node_modules\/mpegts\.js\/dist\/mpegts\.js$/,
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' };

// The app's index.html is written for the desktop app: loosen its CSP for the relay and load
// the web core (right after i18n.js, before android-bridge.js).
function webIndex() {
  return fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
    .replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/,
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src blob:;" />`)
    .replace('<script src="i18n.js"></script>', '<script src="i18n.js"></script>\n  <script src="../web/core.js"></script>');
}

function serveFile(req, res, urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') {
    res.writeHead(302, { Location: '/src/renderer/index.html' });
    return res.end();
  }
  if (!FILES.some((re) => re.test(urlPath)) || urlPath.includes('..')) {
    res.writeHead(404);
    return res.end('not found');
  }
  const file = path.join(ROOT, urlPath);
  if (urlPath === '/src/renderer/index.html') {
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    return res.end(webIndex());
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const isPlaylist = (type, url) => /mpegurl/i.test(type) || /\.m3u8?(\?|$)/i.test(url);

async function relay(req, res, q) {
  const target = q.get('u');
  if (!target || !/^https?:\/\//i.test(target)) {
    res.writeHead(400);
    return res.end('bad address');
  }
  const headers = { 'User-Agent': q.get('ua') || DEFAULT_UA, Accept: '*/*', 'Accept-Encoding': 'identity' };
  if (q.get('ref')) headers.Referer = q.get('ref');
  if (req.headers.range) headers.Range = req.headers.range;
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  let up;
  try {
    up = await fetchHttpFallback(target, { headers, redirect: 'follow', signal: ac.signal });
  } catch (e) {
    if (res.headersSent || res.destroyed) return;
    const why = e.cause?.message || e.message;
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Relay-Error': encodeURIComponent(why).slice(0, 300) });
    return res.end(why);
  }
  const type = up.headers.get('content-type') || '';
  const out = { 'X-Final-URL': up.url };
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
    const v = up.headers.get(h);
    if (v) out[h] = v;
  }

  if (up.ok && isPlaylist(type, up.url)) {
    let text;
    try {
      text = await up.text();
    } catch {
      return res.destroy();
    }
    if (/#EXT-X-/.test(text)) {
      // HLS: make every address absolute (against where the playlist really came from)
      const abs = (u) => {
        try {
          return new URL(u, up.url).href;
        } catch {
          return u;
        }
      };
      text = text.split(/\r?\n/).map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${abs(u)}"`);
        return abs(t);
      }).join('\n');
    }
    delete out['content-length'];
    res.writeHead(up.status, out);
    return res.end(text);
  }

  res.writeHead(up.status, out);
  if (!up.body) return res.end();
  Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Final-URL, X-Relay-Error');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const u = new URL(req.url, 'http://localhost');
  // /p is what the app uses for posters and logos (same as the desktop proxy)
  if (u.pathname === '/r' || u.pathname === '/p') return relay(req, res, u.searchParams).catch(() => res.destroy());
  return serveFile(req, res, decodeURIComponent(u.pathname));
});

server.listen(PORT, HOST, () => {
  const where = HOST === '0.0.0.0' ? `http://<this computer's IP>:${PORT}` : `http://localhost:${PORT}`;
  console.log(`KLABYTV web is running: ${where}  (Ctrl+C to stop)`);
});
