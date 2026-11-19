// Samsung TV (Tizen) parts of the app, on top of the web core (core.js). Loaded only in the TV app.
//
// A TV app may not read IPTV servers that don't allow web pages (CORS), and it can't run a relay of
// its own. The TV's native parts aren't bound by that, so they stand in for the desktop app's
// internal relay:
//   - AVPlay, Samsung's player, plays every stream (TS, HLS, MP4, MKV, AC3, HEVC ...) in full screen;
//   - the Download API fetches lists, playlists and the TV guide when a direct request is refused.
// This file also maps the remote control's keys.
(function () {
  if (typeof window.tizen === 'undefined' || !window.api || !window.api.web) return;
  const web = window.api.web;

  // ---------------------------------------------------------------- older TV browsers
  if (!Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function (...nodes) {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.append(...nodes);
    };
  }
  if (!Promise.allSettled) {
    Promise.allSettled = (list) => Promise.all([...list].map((p) => Promise.resolve(p).then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }))));
  }
  if (!Object.fromEntries) Object.fromEntries = (entries) => [...entries].reduce((o, [k, v]) => ((o[k] = v), o), {});
  if (!Array.prototype.flat) {
    Object.defineProperty(Array.prototype, 'flat', { configurable: true, writable: true, value(depth = 1) {
      return this.reduce((out, x) => out.concat(Array.isArray(x) && depth > 0 ? x.flat(depth - 1) : [x]), []);
    } });
  }
  if (!String.prototype.matchAll) {
    Object.defineProperty(String.prototype, 'matchAll', { configurable: true, writable: true, value(re) {
      const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      const out = [];
      let m;
      while ((m = r.exec(this))) {
        out.push(m);
        if (!m[0]) r.lastIndex++;
      }
      return out[Symbol.iterator]();
    } });
  }

  // ---------------------------------------------------------------- native downloads
  // Downloads `url` with the TV's download manager into the app's private temp folder, reads it
  // and deletes it. onBytes(n) is called as data arrives (for the data usage).
  let seq = 0;
  function readAndDelete(name) {
    const path = `wgt-private-tmp/${name}`;
    return new Promise((resolve, reject) => {
      try {
        if (tizen.filesystem.openFile) {
          const fh = tizen.filesystem.openFile(path, 'r');
          const data = fh.readData();
          fh.close();
          try {
            tizen.filesystem.deleteFile(path);
          } catch { /* left in the temp folder */ }
          return resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        }
        // Tizen before 5.0
        tizen.filesystem.resolve('wgt-private-tmp', (dir) => {
          const file = dir.resolve(name);
          file.openStream('r', (stream) => {
            const bytes = stream.readBytes(file.fileSize);
            stream.close();
            dir.deleteFile(file.fullPath, () => {}, () => {});
            resolve(new Uint8Array(bytes).buffer);
          }, reject);
        }, reject, 'rw');
      } catch (e) {
        reject(e);
      }
    });
  }

  web.nativeGet = (url, { headers = {}, timeout = 90_000, onBytes } = {}) =>
    new Promise((resolve, reject) => {
      const name = `k${Date.now()}_${++seq}.tmp`;
      let received = 0;
      let id = null;
      const timer = setTimeout(() => {
        try {
          tizen.download.cancel(id);
        } catch { /* already over */ }
        const e = new Error('Timeout');
        e.name = 'AbortError';
        reject(e);
      }, timeout);
      const done = (fn) => (...a) => {
        clearTimeout(timer);
        fn(...a);
      };
      try {
        const h = {};
        if (headers.ua) h['User-Agent'] = headers.ua;
        if (headers.referer) h.Referer = headers.referer;
        const req = new tizen.DownloadRequest(url, 'wgt-private-tmp', name, 'ALL', h);
        id = tizen.download.start(req, {
          onprogress(_id, got) {
            if (got > received && onBytes) onBytes(got - received);
            received = Math.max(received, got);
          },
          oncompleted: done(() => readAndDelete(name).then((buf) => {
            if (buf.byteLength > received && onBytes) onBytes(buf.byteLength - received);
            resolve({ status: 200, ok: true, buf });
          }, reject)),
          onfailed: done((_id, err) => reject(new Error((err && err.message) || 'Download failed'))),
          oncanceled: done(() => reject(new Error('Download canceled'))),
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });

  // ---------------------------------------------------------------- AVPlay as the video element
  // The player (player.js) drives a <video>; on the TV it gets an <object> backed by AVPlay that
  // answers the same calls and events. The picture is drawn under the page, so the page is made
  // see-through while a video is open (html.avplay-on).
  web.nativeOnly = true;
  web.createVideo = () => {
    const av = webapis.avplay;
    const el = document.createElement('object');
    el.setAttribute('type', 'application/avplayer');
    el.className = 'avplay';
    let src = '';
    let paused = true;
    let time = 0;
    let duration = NaN;
    let ready = false;
    let error = null;
    let volume = 1;
    let muted = false;
    let ticker = null;
    let lastTick = 0;
    let triedHttp = false;
    const fire = (type) => el.dispatchEvent(new Event(type));
    const state = () => {
      try {
        return av.getState();
      } catch {
        return 'NONE';
      }
    };

    // Data usage: AVPlay doesn't report bytes, so it's estimated from the stream's bit rate.
    function bitrate() {
      let bps = 0;
      try {
        for (const s of av.getCurrentStreamInfo() || []) {
          const info = JSON.parse(s.extra_info || '{}');
          const r = Number(info.Bit_rate || info.bit_rate || info.bitrate || 0);
          if ((s.type === 'VIDEO' || s.type === 'AUDIO') && r > 0) bps += r;
        }
      } catch { /* not available yet */ }
      if (!bps) {
        try {
          bps = Number(av.getStreamingProperty('CURRENT_BANDWIDTH')) || 0;
        } catch { /* not adaptive */ }
      }
      return bps;
    }
    function startTicker() {
      clearInterval(ticker);
      lastTick = Date.now();
      ticker = setInterval(() => {
        const now = Date.now();
        if (state() === 'PLAYING') web.count(src, (bitrate() / 8) * ((now - lastTick) / 1000));
        lastTick = now;
      }, 1000);
    }

    function close() {
      clearInterval(ticker);
      ready = false;
      try {
        av.stop();
      } catch { /* not playing */ }
      try {
        av.close();
      } catch { /* not open */ }
      document.documentElement.classList.remove('avplay-on');
    }

    // What went wrong, with where it was playing from (shown under the error in the player).
    function failed(what) {
      // https:// on a port that only speaks http: once, the same address over http
      if (!triedHttp && /^https:/i.test(src)) {
        triedHttp = true;
        open(src.replace(/^https:/i, 'http:'));
        return;
      }
      let where = '';
      try {
        const u = new URL(src);
        where = ` · ${u.protocol.replace(':', '')}://${u.host}`;
      } catch { /* no address */ }
      error = { code: 4, message: `${what}${where}` };
      fire('error');
    }

    function open(url) {
      close();
      error = null;
      ready = false;
      time = 0;
      duration = NaN;
      try {
        av.open(url);
        av.setDisplayRect(0, 0, 1920, 1080);
        try {
          av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
        } catch { /* older firmware */ }
        const ua = web.userAgentFor(url);
        if (ua) {
          try {
            av.setStreamingProperty('USER_AGENT', ua);
          } catch { /* not supported */ }
        }
        av.setListener({
          onbufferingstart: () => fire('waiting'),
          onbufferingcomplete: () => fire('playing'),
          oncurrentplaytime: (ms) => {
            time = ms / 1000;
            fire('timeupdate');
          },
          onstreamcompleted: () => {
            paused = true;
            fire('ended');
          },
          onerror: (type) => failed(String(type)),
          onevent: () => {},
        });
        document.documentElement.classList.add('avplay-on');
        av.prepareAsync(() => {
          ready = true;
          const d = av.getDuration();
          duration = d > 0 ? d / 1000 : Infinity; // live: no duration
          fire('loadedmetadata');
          fire('canplay');
          if (!paused) {
            av.play();
            fire('playing');
          }
          startTicker();
        }, (e) => failed(String((e && (e.name || e.message)) || e)));
      } catch (e) {
        setTimeout(() => failed(`${e.name || 'Error'}: ${e.message}`));
      }
    }

    Object.defineProperties(el, {
      src: { get: () => src, set: (v) => ((src = String(v || '')), (triedHttp = false), src ? open(src) : close()) },
      currentTime: {
        get: () => time,
        set: (v) => {
          if (!ready || !isFinite(duration)) return;
          time = Math.max(0, Math.min(v, duration - 1));
          try {
            av.seekTo(Math.floor(time * 1000), () => fire('seeked'), () => {});
          } catch { /* not seekable */ }
        },
      },
      duration: { get: () => duration },
      paused: { get: () => paused },
      error: { get: () => error },
      buffered: { get: () => ({ length: 0, start: () => 0, end: () => 0 }) },
      // The remote has its own volume keys; mute follows the app's mute button.
      volume: { get: () => volume, set: (v) => (volume = v) },
      muted: {
        get: () => muted,
        set: (v) => {
          muted = !!v;
          try {
            tizen.tvaudiocontrol.setMute(muted);
          } catch { /* no audio control */ }
        },
      },
    });
    el.play = () => {
      paused = false;
      if (ready && state() !== 'PLAYING') {
        try {
          av.play();
        } catch { /* not ready */ }
      }
      fire('play');
      return Promise.resolve();
    };
    el.pause = () => {
      paused = true;
      try {
        av.pause();
      } catch { /* not playing */ }
      fire('pause');
    };
    el.load = () => {};
    const removeAttribute = el.removeAttribute.bind(el);
    el.removeAttribute = (name) => (name === 'src' ? ((src = ''), close()) : removeAttribute(name));
    // the TV switched apps: AVPlay must let go of the screen, and get it back after
    document.addEventListener('visibilitychange', () => {
      if (!src) return;
      try {
        if (document.hidden) av.suspend();
        else av.restore();
      } catch { /* not open */ }
    });
    return el;
  };

  // ---------------------------------------------------------------- remote control
  const KEYS = {
    MediaPlayPause: ' ',
    MediaPlay: ' ',
    MediaPause: ' ',
    MediaStop: 'Escape',
    MediaFastForward: 'ArrowRight',
    MediaRewind: 'ArrowLeft',
    ChannelUp: 'ArrowDown', // next channel (↓ in the player)
    ChannelDown: 'ArrowUp', // previous channel
    ColorF0Red: 'f', // add to / remove from My List
    ColorF2Yellow: 'q', // quality
    ColorF3Blue: 'i', // data counter
  };
  try {
    tizen.tvinputdevice.registerKeyBatch(Object.keys(KEYS));
  } catch {
    for (const k of Object.keys(KEYS)) {
      try {
        tizen.tvinputdevice.registerKey(k);
      } catch { /* key not on this remote */ }
    }
  }
  const codes = {};
  const nameOf = {};
  for (const k of Object.keys(KEYS)) {
    try {
      const code = tizen.tvinputdevice.getKey(k).code;
      codes[code] = KEYS[k];
      nameOf[code] = k;
    } catch { /* key not on this remote */ }
  }
  const press = (key) => {
    window.__escapeConsumed = false;
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    return !!window.__escapeConsumed;
  };
  document.addEventListener('keydown', (e) => {
    if (e.keyCode === 10009) {
      // Back: back inside the app; on the first screen it closes the app
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!press('Escape')) tizen.application.getCurrentApplication().exit();
      return;
    }
    const key = codes[e.keyCode];
    if (!key) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // play/pause and channel keys only act in the player
    if (/^(MediaPlay|MediaPause|MediaPlayPause|ChannelUp|ChannelDown)$/.test(nameOf[e.keyCode]) && !document.querySelector('.player')) return;
    press(key);
  }, true);
})();
