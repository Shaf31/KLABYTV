// Video player view: live channels (MPEG-TS via mpegts.js, HLS via hls.js), movies and episodes.

async function playerView(root, p) {
  const isLive = p.kind === 'live';
  const resumeKey = `resume:${S.account.id}:${p.kind}:${p.id}`;
  let format = isLive ? p.ext || S.settings.liveFormat : p.ext;
  let sid = null;
  let url = '';
  let engine = null;
  let closed = false;
  let retries = 0;
  let switchedFormat = false;
  let lastBytes = 0;
  let lastTick = performance.now();
  let speed = 0;
  let stalledFor = 0;
  let lastTime = -1;
  let hideTimer = null;
  let showStats = S.settings.showPlayerStats !== false;
  // Compatibility mode: ffmpeg converts the stream to H.264/AAC for formats Chromium can't play.
  // In that mode VOD seeking restarts the conversion at `offset` seconds.
  // Containers Chromium can't play are converted from the start; streams that needed it once are remembered.
  const compatKey = `compat:${S.account.id}:${p.kind}:${p.id}`;
  let compat = store.get(compatKey, false) || (!isLive && /^(mkv|avi|wmv|flv|mpg|mpeg|vob|divx|xvid|3gp|m2ts|mts|rmvb)$/i.test(format || ''));
  let compatInfo = null;
  let offset = 0;
  let seekTarget = null;
  let resumeAt = isLive ? 0 : store.get(resumeKey, 0);
  const pos = () => (seekTarget != null ? seekTarget : (compat ? offset : 0) + (video.currentTime || 0));
  const dur = () => (compat ? (compatInfo && compatInfo.duration) || NaN : video.duration);

  const video = h('video', { autoplay: true, playsinline: true });
  video.volume = store.get('player:volume', 1);
  video.muted = store.get('player:muted', false);

  // Seek step from settings (← →, the skip buttons, double-click on the sides).
  const seekStep = S.settings.seekStep || 10;
  const stepNum = seekStep >= 60 && seekStep % 60 === 0 ? `${seekStep / 60}m` : seekStep;
  const stepLabel = seekStep >= 60 && seekStep % 60 === 0 ? (seekStep === 60 ? t('دقيقة') : t('{0} دقايق', [seekStep / 60])) : t('{0} ثانية', [seekStep]);
  const bufferSec = S.settings.bufferSeconds || 60;
  // Android: no ffmpeg, so "compatibility mode" opens the native (Media3) player instead.
  const android = S.platform === 'android';
  const tvUi = document.body.classList.contains('ui-tv');
  const touchUi = document.body.classList.contains('ui-touch');
  // OSD buttons are .focusable so a TV remote can reach them (the player keeps the arrows otherwise).
  const btn = (name, title, fn, cls = '') => h(`button.osd-btn.focusable${cls}`, { title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(name));
  const el = {
    title: h('div.p-title', p.seriesTitle || p.title),
    sub: h('div.p-sub', p.label || ''),
    epg: h('div.p-epg'),
    status: h('div.p-status', h('div.spinner'), h('span')),
    flash: h('div.p-flash'),
    center: h('div.p-center'),
    badge: h('div.p-badge'),
    time: h('span.p-time'),
    seek: h('input.p-seek', { type: 'range', min: 0, max: 1000, value: 0, step: 1 }),
    vol: h('input.p-vol', { type: 'range', min: 0, max: 100, value: Math.round(video.volume * 100) }),
    play: btn('pause', t('تشغيل/إيقاف (Space)'), () => togglePlay(), '.big'),
    mute: btn(video.muted ? 'mute' : 'volume', t('كتم (M)'), () => toggleMute()),
    stats: btn('stats', t('إظهار/إخفاء عداد الاستهلاك (I)'), () => toggleStats()),
    full: btn('fullscreen', t('ملء الشاشة (F)'), () => toggleFullscreen(), '.p-full'),
    errorPanel: h('div.p-error'),
    quality: btn('quality', t('الجودة (Q)'), () => toggleQualityMenu()),
    qmenu: h('div.p-menu', { hidden: true }),
    idle: h('div.p-idle', { hidden: true }),
    seekHint: h('div.p-seek-hint'),
  };
  el.quality.hidden = true;
  el.stats.classList.add('toggle');
  const setIcon = (b, name) => b.replaceChildren(icon(name));
  el.vol.style.setProperty('--p', `${el.vol.value}%`);
  el.status.hidden = true;

  const hasPlaylist = S.playlist.length > 1 && p.idx != null;
  const hasNext = hasPlaylist && p.idx < S.playlist.length - 1;

  const top = h('div.osd.osd-top',
    h('button.osd-btn.back.focusable', { title: t('رجوع (Esc)'), onclick: (e) => { e.stopPropagation(); Router.back(); } }, icon('back')),
    isLive ? h('div.p-live-head',
      p.logo ? h('img.p-logo', { src: img(p.logo), alt: '', onerror: (e) => e.target.remove() }) : null,
      h('div', h('div.p-live-name', h('span.live-badge', t('مباشر')), p.title), el.epg),
    ) : null,
  );
  const bottom = h('div.osd.osd-bottom',
    !isLive ? h('div.p-seekrow', el.seek, el.time) : null,
    h('div.p-controls',
      h('div.p-group',
        el.play,
        !isLive ? h('button.osd-btn.focusable', { title: t('رجوع {0} (←)', [stepLabel]), onclick: (e) => { e.stopPropagation(); seekBy(-seekStep); } }, icon('replay10', '', stepNum)) : null,
        !isLive ? h('button.osd-btn.focusable', { title: t('تقديم {0} (→)', [stepLabel]), onclick: (e) => { e.stopPropagation(); seekBy(seekStep); } }, icon('forward10', '', stepNum)) : null,
        isLive && hasPlaylist ? btn('prev', t('القناة السابقة (↑)'), () => step(-1)) : null,
        isLive && hasPlaylist ? btn('next', t('القناة التالية (↓)'), () => step(1)) : null,
        h('div.p-volume', el.mute, el.vol),
        isLive ? el.time : null,
      ),
      h('div.p-titles', isLive ? null : [el.title, el.sub]),
      h('div.p-group.end',
        !isLive && hasNext ? h('button.osd-btn.next-ep.focusable', { title: t('الحلقة التالية'), onclick: (e) => { e.stopPropagation(); step(1); } }, icon('next'), h('span', t('الحلقة التالية'))) : null,
        isLive && !(S.account && S.account.type === 'm3u') ? h('button.osd-btn.text.focusable', { title: t('تبديل صيغة البث'), onclick: (e) => { e.stopPropagation(); switchFormat(); } }, 'TS/HLS') : null,
        el.quality,
        btn('tune', t('وضع التوافق: تشغيل أي صيغة (C)'), () => toggleCompat()),
        el.stats,
        el.full,
      ),
    ),
  );

  const wrap = h('div.player', video, el.center, top, bottom, el.badge, el.status, el.flash, el.seekHint, el.qmenu, el.errorPanel, el.idle);
  root.append(wrap);
  document.addEventListener('fullscreenchange', onFsChange);
  function onFsChange() {
    setIcon(el.full, document.fullscreenElement ? 'fullscreenExit' : 'fullscreen');
  }

  // ---------- engine ----------
  let hlsInst = null; // hls.js instance while playing HLS (for its quality levels)
  function destroyEngine() {
    hlsInst = null;
    if (!engine) return;
    try { engine.destroy(); } catch (e) { console.warn(e); }
    engine = null;
  }

  function attach() {
    destroyEngine();
    hideError();
    setStatus(compat ? t('جاري التحويل (وضع التوافق)…') : t('جاري التحميل…'));
    if (compat) {
      const src = offset > 0 ? `${url}&ss=${offset.toFixed(2)}` : url;
      const pl = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: src }, { enableWorker: true, lazyLoad: false, autoCleanupSourceBuffer: true });
      pl.on(mpegts.Events.ERROR, (type, detail, info) => fail(`${type}: ${detail}`, info && info.code));
      pl.attachMediaElement(video);
      pl.load();
      engine = mpegtsEngine(pl);
    } else if (format === 'm3u8' && window.Hls && Hls.isSupported()) {
      // Movies/episodes keep exactly bufferSec ahead (settings); live keeps hls.js' default 30s.
      const bufferCfg = isLive ? { maxBufferLength: 30 } : { maxBufferLength: bufferSec, maxMaxBufferLength: bufferSec, backBufferLength: 30 };
      const hls = new Hls({ enableWorker: true, ...bufferCfg, fragLoadingMaxRetry: 6, manifestLoadingMaxRetry: 3 });
      let mediaRecoveries = 0;
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 2) hls.recoverMediaError();
        else fail(d.details || 'HLS error', d.response && d.response.code);
      });
      hls.on(Hls.Events.BUFFER_CODECS, (_e, d) => {
        for (const t of [d.audio, d.video]) {
          if (t && t.codec && !MediaSource.isTypeSupported(`${t.container};codecs="${t.codec}"`)) return toCompat();
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => updateQuality());
      hlsInst = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      engine = { destroy: () => hls.destroy() };
    } else if (format === 'ts' && window.mpegts && mpegts.isSupported()) {
      const pl = mpegts.createPlayer(
        { type: 'mpegts', isLive, url },
        {
          enableWorker: true,
          autoCleanupSourceBuffer: true,
          enableStashBuffer: true,
          stashInitialSize: 384 * 1024,
          // movies/episodes in .ts: stop loading bufferSec ahead, resume when it runs low
          lazyLoad: !isLive,
          lazyLoadMaxDuration: bufferSec,
          lazyLoadRecoverDuration: Math.max(10, bufferSec - 15),
        },
      );
      pl.on(mpegts.Events.ERROR, (type, detail, info) => fail(`${type}: ${detail}`, info && info.code));
      pl.on(mpegts.Events.MEDIA_INFO, (mi) => {
        // e.g. AC-3/E-AC-3 audio: MSE in Chromium can't decode it -> convert instead of playing silent.
        if (mi.hasAudio && mi.audioCodec && !MediaSource.isTypeSupported(`audio/mp4;codecs="${mi.audioCodec}"`)) return toCompat();
        if (mi.hasVideo && mi.videoCodec && !MediaSource.isTypeSupported(`video/mp4;codecs="${mi.videoCodec}"`)) return toCompat();
      });
      pl.attachMediaElement(video);
      pl.load();
      engine = mpegtsEngine(pl);
    } else {
      video.src = url;
      engine = {
        destroy: () => {
          video.removeAttribute('src');
          video.load();
        },
      };
    }
    video.play().catch(() => {});
  }

  function mpegtsEngine(pl) {
    return {
      destroy: () => {
        pl.pause();
        pl.unload();
        pl.detachMediaElement();
        pl.destroy();
      },
    };
  }

  async function open() {
    if (compat && android) return goNative();
    // Compat mode reads live channels as plain MPEG-TS unless the subscription only allows HLS.
    const ext = compat && isLive && S.liveFormatFallback !== 'm3u8' ? 'ts' : format;
    if (compat) setStatus(t('جاري تجهيز وضع التوافق…'));
    const r = await window.api.openStream({ kind: p.kind, id: p.id, ext, title: p.title, sid, compat });
    if (closed) return;
    sid = r.sid;
    url = r.url;
    if (compat) {
      compatInfo = r;
      if (resumeAt > 30 && r.duration && resumeAt < r.duration - 60) {
        offset = resumeAt;
        toast(t('استكمال من {0}', [fmtDuration(resumeAt * 1000)]));
      }
      resumeAt = 0;
    }
    attach();
  }

  // Android: hand the stream to the native player and leave this screen; the native player reports
  // back where it stopped (see onNativePlayerClosed in app.js).
  let wentNative = false;
  async function goNative() {
    if (wentNative || closed) return;
    wentNative = true;
    store.set(compatKey, true);
    destroyEngine();
    setStatus(t('جاري فتح المشغل الأصلي…'));
    const at = isLive ? 0 : video.currentTime > 1 ? video.currentTime : resumeAt > 30 ? resumeAt : 0;
    try {
      await window.api.playNative({ kind: p.kind, id: p.id, ext: format, lang: LANG, title: p.seriesTitle ? `${p.seriesTitle} · ${p.label || ''}` : p.title, pos: at });
      S.nativeItem = { ...p };
      Router.back();
    } catch (e) {
      wentNative = false;
      showError(e.message);
    }
  }

  // Switch to compatibility mode, keeping the current position for movies/episodes.
  function toCompat() {
    if (android) return goNative();
    if (compat || closed) return;
    compat = true;
    store.set(compatKey, true);
    retries = 0;
    if (!isLive && video.currentTime > 1) resumeAt = video.currentTime;
    destroyEngine();
    open().catch((e) => showError(e.message));
  }

  function toggleCompat() {
    if (!compat) return toCompat();
    if (!isLive) resumeAt = pos();
    compat = false;
    store.del(compatKey);
    compatInfo = null;
    offset = 0;
    retries = 0;
    toast(t('رجوع للمشغل العادي'));
    open().catch((e) => showError(e.message));
  }

  const isCodecError = (reason) =>
    /MediaMSEError|MediaFormatUnsupported|MediaCodecUnsupported|MEDIA_ERR_SRC_NOT_SUPPORTED|MEDIA_ERR_DECODE|codec|bufferAppendError|fragParsingError/i.test(String(reason));

  function fail(reason, httpCode) {
    if (closed) return;
    console.warn('playback error', reason, httpCode);
    if (!compat && !(httpCode >= 400) && (isCodecError(reason) || !isLive)) {
      toCompat();
      return;
    }
    if (retries < 3 && isLive) {
      retries++;
      setStatus(t('انقطع البث، إعادة الاتصال ({0}/3)…', [retries]));
      setTimeout(() => !closed && attach(), 1500);
      return;
    }
    if (isLive && !switchedFormat && !compat) {
      switchedFormat = true;
      retries = 0;
      format = format === 'ts' ? 'm3u8' : 'ts';
      setStatus(t('تجربة صيغة {0}…', [format.toUpperCase()]));
      open().catch((e) => showError(e.message));
      return;
    }
    destroyEngine();
    let msg = t('تعذر تشغيل البث.');
    if (httpCode === 401 || httpCode === 403) msg = t('السيرفر رفض التشغيل (تأكد من الاشتراك أو عدد الأجهزة المسموح).');
    else if (httpCode === 404) msg = t('المحتوى غير موجود على السيرفر.');
    else if (httpCode >= 450) msg = t('السيرفر رفض الاتصال (HTTP {0}) — غالبًا وصلت للحد الأقصى من الأجهزة.', [httpCode]);
    else if (compat) msg = t('تعذر تشغيل البث حتى في وضع التوافق.');
    showError(msg, reason);
  }

  video.addEventListener('error', () => {
    if (!engine || compat || format === 'ts' || format === 'm3u8') return; // engines report their own errors
    const code = video.error && video.error.code;
    fail(code === 4 ? 'MEDIA_ERR_SRC_NOT_SUPPORTED' : `media error ${code}`);
  });
  video.addEventListener('playing', () => {
    retries = 0;
    setStatus('');
    setIcon(el.play, 'pause');
    // Some files play picture-only or sound-only (unsupported codec) without any error: detect and convert.
    if (!compat) {
      setTimeout(() => {
        if (closed || compat || video.paused) return;
        const a = video.webkitAudioDecodedByteCount;
        const v = video.webkitVideoDecodedByteCount;
        if ((a === 0 && v > 0) || (v === 0 && a > 0)) toCompat();
      }, 4000);
    }
  });
  // Converted movie paused for 30s: stop the conversion (and the download); resume from the same spot on play.
  let pauseTimer = null;
  let parked = false;
  video.addEventListener('pause', () => {
    setIcon(el.play, 'play');
    if (compat && !isLive) {
      pauseTimer = setTimeout(() => {
        if (!video.paused || closed) return;
        offset = pos();
        parked = true;
        destroyEngine();
      }, 30_000);
    }
  });
  video.addEventListener('play', () => clearTimeout(pauseTimer));
  video.addEventListener('waiting', () => setStatus(t('جاري التخزين المؤقت…')));
  video.addEventListener('canplay', () => setStatus(''));
  video.addEventListener('loadedmetadata', () => {
    if (isLive || compat) return;
    if (resumeAt > 30 && isFinite(video.duration) && resumeAt < video.duration - 60) {
      video.currentTime = resumeAt;
      toast(t('استكمال من {0}', [fmtDuration(resumeAt * 1000)]));
    }
    resumeAt = 0;
  });
  video.addEventListener('ended', () => {
    if (!isLive) store.del(resumeKey);
    if (!isLive && hasPlaylist && p.idx < S.playlist.length - 1) step(1);
  });
  function renderTime() {
    if (isLive) return;
    const d = dur();
    el.time.textContent = `${fmtDuration(pos() * 1000)} / ${isFinite(d) ? fmtDuration(d * 1000) : '--:--'}`;
    if (isFinite(d) && d > 0 && !el.seek.matches(':active')) {
      el.seek.value = Math.round((pos() / d) * 1000);
      el.seek.style.setProperty('--p', `${(el.seek.value / 10).toFixed(1)}%`);
    }
  }
  video.addEventListener('timeupdate', renderTime);
  el.seek.addEventListener('change', () => seekTo((el.seek.value / 1000) * dur()));
  el.seek.addEventListener('input', () => el.seek.style.setProperty('--p', `${(el.seek.value / 10).toFixed(1)}%`));
  el.vol.addEventListener('input', () => setVolume(el.vol.value / 100));

  // ---------- controls ----------
  function togglePlay() {
    if (parked) {
      parked = false;
      attach();
    } else if (video.paused) video.play().catch(() => {});
    else video.pause();
    // Netflix-style icon pulse in the middle
    fill(el.center, icon(video.paused ? 'pause' : 'play'));
    el.center.classList.remove('pulse');
    void el.center.offsetWidth;
    el.center.classList.add('pulse');
    showOsd();
  }
  // In compat mode a seek restarts the conversion; key repeats are batched for 400ms.
  const restartAt = debounce(() => {
    if (closed || seekTarget == null) return;
    offset = seekTarget;
    seekTarget = null;
    attach();
  }, 400);
  function seekTo(t) {
    const d = dur();
    if (isLive || !isFinite(d) || d <= 0) return;
    t = Math.max(0, Math.min(d - 1, t));
    if (compat) {
      seekTarget = t;
      restartAt();
    } else video.currentTime = t;
    reportPosition();
    renderTime();
    showOsd();
  }

  // Tell the proxy where we are, so it keeps the download bufferSec ahead (fixed buffer).
  function reportPosition() {
    const d = dur();
    if (isLive || !sid || !isFinite(d) || d <= 0) return;
    window.api.streamPosition(sid, { pos: pos(), dur: d }).catch(() => {});
  }
  function seekBy(sec) {
    seekTo(pos() + sec);
  }
  function setVolume(v) {
    video.volume = Math.max(0, Math.min(1, v));
    if (video.volume > 0 && video.muted) toggleMute();
    el.vol.value = Math.round(video.volume * 100);
    el.vol.style.setProperty('--p', `${el.vol.value}%`);
    store.set('player:volume', video.volume);
    flash(t('الصوت {0}%', [Math.round(video.volume * 100)]));
  }
  function toggleMute() {
    video.muted = !video.muted;
    setIcon(el.mute, video.muted ? 'mute' : 'volume');
    store.set('player:muted', video.muted);
  }
  function toggleFullscreen() {
    if (android) return; // the Android player screen is already full screen
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.requestFullscreen().catch(() => {});
  }
  function toggleStats() {
    showStats = !showStats;
    renderBadge();
    flash(showStats ? t('عداد الاستهلاك ظاهر') : t('عداد الاستهلاك مخفي — الاستهلاك بيتحسب برضه'));
    window.api.saveSettings({ showPlayerStats: showStats }).then((st) => (S.settings = st));
  }
  function switchFormat() {
    format = format === 'ts' ? 'm3u8' : 'ts';
    retries = 0;
    switchedFormat = true;
    toast(t('صيغة البث: {0}', [format.toUpperCase()]));
    open().catch((e) => showError(e.message));
  }
  function step(dir) {
    const i = p.idx + dir;
    if (i < 0 || i >= S.playlist.length) return;
    // Back from the player should land on the channel/episode that was playing last.
    const prev = Router.stack[Router.stack.length - 2];
    const old = `:${p.id}`;
    if (prev && prev.focusKey && prev.focusKey.endsWith(old)) prev.focusKey = prev.focusKey.slice(0, -old.length) + `:${S.playlist[i].id}`;
    Router.go('player', { ...S.playlist[i], idx: i }, { replace: true });
  }
  // Loading/buffering message with a spinner in the middle.
  function setStatus(text) {
    el.status.lastChild.textContent = text;
    el.status.hidden = !text;
  }
  // Short message (volume, toggles) that fades out.
  let flashTimer = null;
  function flash(text) {
    el.flash.textContent = text;
    el.flash.classList.add('show');
    clearTimeout(flashTimer);
    clearTimeout(clickTimer);
    flashTimer = setTimeout(() => el.flash.classList.remove('show'), 1400);
  }
  function hideError() {
    el.errorPanel.replaceChildren();
    el.errorPanel.hidden = true;
  }
  function showError(msg, detail) {
    setStatus('');
    el.errorPanel.hidden = false;
    fill(el.errorPanel, 
      h('div.error-text', tErr(msg)),
      detail ? h('div.muted.small', String(detail)) : null,
      h('div.row',
        h('button.btn.focusable', { onclick: () => { retries = 0; open().catch((e) => showError(e.message)); }, 'data-autofocus': true }, t('إعادة المحاولة')),
        isLive ? h('button.btn.focusable', { onclick: switchFormat }, t('جرّب {0}', [format === 'ts' ? 'HLS' : 'TS'])) : null,
        !compat ? h('button.btn.focusable', { onclick: toCompat }, t('وضع التوافق')) : null,
        h('button.btn.focusable', { onclick: () => Router.back() }, t('رجوع')),
      ),
    );
    el.errorPanel.querySelector('button').focus();
  }

  function showOsd() {
    wrap.classList.add('show-osd');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      // stays up while paused or while a remote has focus on one of its buttons
      if (video.paused || osdFocused()) return showOsd();
      wrap.classList.remove('show-osd');
    }, 3500);
  }
  function hideOsd() {
    clearTimeout(hideTimer);
    wrap.classList.remove('show-osd');
  }
  const osdFocused = () => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.osd'));

  function renderBadge() {
    el.badge.hidden = !showStats;
    el.stats.classList.toggle('on', showStats);
  }

  // ---------- data usage + stall watchdog (every second) ----------
  const statsTimer = setInterval(async () => {
    if (!sid) return;
    const s = await window.api.streamStats(sid).catch(() => null);
    if (!s || closed) return;
    const idleLimit = (S.settings.stillWatchingHours || 2) * 3_600_000;
    if (S.settings.stillWatching !== false && el.idle.hidden && !video.paused && Date.now() - lastInput > idleLimit) askStillWatching();
    const now = performance.now();
    const inst = ((s.bytes - lastBytes) * 1000) / (now - lastTick);
    speed = speed ? speed * 0.6 + inst * 0.4 : inst;
    lastBytes = s.bytes;
    lastTick = now;
    const watched = s.now - s.start;
    fill(el.badge, 
      h('span', `⬇ ${fmtMbps(speed)}`),
      h('span', t('الاستهلاك: {0}', [fmtBytes(s.bytes)])),
      h('span', t('المدة: {0}', [fmtDuration(watched)])),
      watched > 60_000 ? h('span', t('≈ {0}/ساعة', [fmtBytes((s.bytes / watched) * 3_600_000)])) : null,
      compatInfo ? h('span.compat', t('وضع التوافق{0}{1}', [compatInfo.transcodeVideo ? t(' · تحويل الصورة') : '', compatInfo.transcodeAudio ? t(' · تحويل الصوت') : ''])) : null,
    );
    if (isLive) {
      el.time.textContent = t('مباشر · {0}', [fmtDuration(watched)]);
      // Live stream frozen for 15s while it should be playing -> reconnect.
      if (!video.paused && el.errorPanel.hidden) {
        stalledFor = video.currentTime === lastTime ? stalledFor + 1 : 0;
        lastTime = video.currentTime;
        if (stalledFor >= 15) {
          stalledFor = 0;
          fail('stalled');
        }
      }
    } else if (!video.paused && video.currentTime > 0 && seekTarget == null) {
      store.set(resumeKey, Math.floor(pos()));
      if (++historyTick % 5 === 0) saveHistory();
    }
    if (!isLive && seekTarget == null) {
      reportPosition();
    }
  }, 1000);

  // "Continue watching" on Home
  let historyTick = 0;
  function saveHistory() {
    const { idx, ...item } = p;
    History.upsert({ ...item, pos: Math.floor(pos()), dur: isFinite(dur()) ? Math.floor(dur()) : 0 });
  }

  // ---------- EPG for live ----------
  let epgTimer = null;
  async function loadEpg() {
    try {
      const r = await window.api.xtream('get_short_epg', { stream_id: p.id, limit: 2 });
      const list = asArray(r && r.epg_listings);
      const at = (x) => new Date(Number(x.start_timestamp) * 1000).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
      el.epg.replaceChildren(
        ...list.slice(0, 2).map((x, i) => h('div', h('b', i === 0 ? t('الآن: ') : t('التالي: ')), `${at(x)} ${b64(x.title)}`)),
      );
    } catch { /* no EPG on this server */ }
  }
  if (isLive) {
    loadEpg();
    epgTimer = setInterval(loadEpg, 5 * 60_000);
  }

  // ---------- qualities ----------
  // HLS streams can carry several qualities; providers also list the same channel/movie several
  // times (FHD / HD / SD). Both show up in the quality menu (Q), with data per hour when known.
  let variants = [];
  let pastSessions = [];
  if (p.kind !== 'series') {
    Promise.all([loadAll([p.kind]), window.api.usage().catch(() => ({ sessions: [] }))]).then(([all, u]) => {
      if (closed) return;
      pastSessions = u.sessions || [];
      const list = all[p.kind];
      const self = list.find((x) => x.id === String(p.id));
      variants = self ? variantsOf(self, list) : [];
      updateQuality();
    }).catch(() => {});
  }

  function qualityOptions() {
    const sections = [];
    if (hlsInst && hlsInst.levels && hlsInst.levels.length > 1) {
      const hls = hlsInst;
      const cur = hls.autoLevelEnabled ? -1 : hls.currentLevel;
      const levels = hls.levels.map((l, i) => ({ l, i })).sort((a, b) => (b.l.height || 0) - (a.l.height || 0) || b.l.bitrate - a.l.bitrate);
      sections.push([t('جودة البث'), [
        { label: t('تلقائي'), active: cur === -1, pick: () => (hls.currentLevel = -1) },
        ...levels.map(({ l, i }) => ({
          label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps`,
          est: l.bitrate ? (l.bitrate / 8) * 3600 : 0,
          active: cur === i,
          pick: () => (hls.currentLevel = i),
        })),
      ]]);
    }
    if (variants.length > 1) {
      sections.push([isLive ? t('نسخ القناة على السيرفر') : t('نسخ الفيلم على السيرفر'), variants.map((v) => ({
        label: qualityOf(v.name).label,
        title: v.name,
        est: perHourFromHistory(pastSessions, v.id),
        active: v.id === String(p.id),
        pick: () => switchVariant(v),
      }))]);
    }
    return sections;
  }

  function updateQuality() {
    el.quality.hidden = !qualityOptions().length;
  }

  function toggleQualityMenu(force) {
    const show = force != null ? force : el.qmenu.hidden;
    if (!show) {
      el.qmenu.hidden = true;
      return;
    }
    const sections = qualityOptions();
    if (!sections.length) return flash(t('البث ده متاح بجودة واحدة بس'));
    fill(el.qmenu, sections.map(([title, opts]) => [
      h('div.p-menu-title', title),
      opts.map((o) => h(`button.p-menu-item.focusable${o.active ? '.active' : ''}`, {
        title: o.title || null,
        onclick: (e) => {
          e.stopPropagation();
          el.qmenu.hidden = true;
          if (o.active) return;
          o.pick();
          flash(t('الجودة: {0}', [o.label]));
        },
      }, icon('check'), h('span', o.label), o.est ? h('span.est', t('≈ {0}/ساعة', [fmtBytes(o.est)])) : null)),
    ]));
    el.qmenu.hidden = false;
    (el.qmenu.querySelector('.active') || el.qmenu.querySelector('button')).focus();
  }

  // Another copy of the same channel/movie on the server: replace this one (keeps the movie position).
  function switchVariant(v) {
    const item = isLive
      ? { kind: 'live', id: v.id, ext: p.ext, title: v.name, logo: v.logo || p.logo }
      : { kind: 'movie', id: v.id, ext: v.ext || 'mp4', title: v.name, poster: p.poster };
    if (!isLive && pos() > 5) store.set(`resume:${S.account.id}:movie:${v.id}`, Math.floor(pos()));
    if (p.idx != null && S.playlist[p.idx]) S.playlist[p.idx] = item;
    else S.playlist = [item];
    Router.go('player', { ...item, idx: p.idx ?? 0 }, { replace: true });
  }

  // ---------- data saver: "still watching?" + stop while minimized ----------
  let lastInput = Date.now();
  const markInput = () => (lastInput = Date.now());
  const INPUT_EVENTS = ['keydown', 'mousemove', 'mousedown', 'wheel'];
  for (const ev of INPUT_EVENTS) window.addEventListener(ev, markInput, true);

  function askStillWatching() {
    if (isLive) destroyEngine(); // stop the download, not just the picture
    else video.pause();
    setStatus('');
    const hrs = S.settings.stillWatchingHours || 2;
    fill(el.idle,
      h('h2', t('لسه بتتفرج؟')),
      h('p', hrs >= 1
        ? t('وقفنا «{0}» علشان نوفّر الإنترنت — مفيش أي حركة من {1} ساعة.', [p.seriesTitle || p.title, hrs])
        : t('وقفنا «{0}» علشان نوفّر الإنترنت — مفيش أي حركة من فترة.', [p.seriesTitle || p.title])),
      h('div.row',
        h('button.btn.btn-play.focusable', { onclick: resumeFromIdle }, icon('play'), t('كمّل المشاهدة')),
        h('button.btn.btn-ghost.focusable', { onclick: () => Router.back() }, t('رجوع')),
      ),
    );
    el.idle.hidden = false;
    el.idle.querySelector('button').focus();
  }

  function resumeFromIdle() {
    el.idle.hidden = true;
    lastInput = Date.now();
    if (isLive || parked) {
      parked = false;
      attach();
    } else video.play().catch(() => {});
    if (document.activeElement) document.activeElement.blur();
  }

  let minimizedStop = null; // what was stopped while the window was minimized: 'live' | 'vod'
  S.windowListener = (state) => {
    if (S.settings.pauseWhenMinimized === false || closed) return;
    if (state === 'hidden' && !minimizedStop && el.idle.hidden && el.errorPanel.hidden) {
      if (isLive && engine) {
        destroyEngine();
        minimizedStop = 'live';
      } else if (!isLive && !video.paused) {
        video.pause();
        minimizedStop = 'vod';
      }
    } else if (state === 'shown' && minimizedStop) {
      const what = minimizedStop;
      minimizedStop = null;
      lastInput = Date.now();
      if (what === 'live' || parked) {
        parked = false;
        attach();
      } else video.play().catch(() => {});
      flash(t('كمّلنا التشغيل — كان واقف وانت مصغّر البرنامج علشان نوفّر الإنترنت'));
    }
  };

  // ---------- input ----------
  wrap.addEventListener('click', (e) => {
    if (!el.qmenu.hidden && !el.qmenu.contains(e.target) && !el.quality.contains(e.target)) el.qmenu.hidden = true;
  }, true);
  // real mouse only: a tap also fires a compatibility mousemove, which would fight the tap toggle
  wrap.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && showOsd());
  // Click = play/pause. Double-click: left third = back, right third = forward (keep clicking that
  // side to keep jumping, like YouTube), middle = full screen. A single click waits 280ms to be sure.
  let clickTimer = null;
  let lastClick = 0;
  let sideMode = null;
  let sideUntil = 0;
  let hintTotal = 0;
  const sideOf = (e) => {
    const r = video.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    return isLive ? 'mid' : x < 0.33 ? 'back' : x > 0.67 ? 'fwd' : 'mid';
  };
  function sideSeek(side) {
    seekBy(side === 'back' ? -seekStep : seekStep);
    hintTotal = sideMode === side ? hintTotal + seekStep : seekStep;
    sideMode = side;
    sideUntil = Date.now() + 700;
    fill(el.seekHint, icon(side === 'back' ? 'replay10' : 'forward10', '', stepNum), h('span', `${side === 'back' ? '-' : '+'}${fmtDuration(hintTotal * 1000)}`));
    el.seekHint.className = `p-seek-hint ${side} show`;
    clearTimeout(el.seekHint.timer);
    el.seekHint.timer = setTimeout(() => el.seekHint.classList.remove('show'), 700);
  }
  // Taps on the empty parts of the control bars count as taps on the video: on a phone the bars
  // cover most of the screen while they're shown.
  const TAP_GAP = touchUi ? 350 : 280;
  const onVideoArea = (target) => target === video || (!target.closest('button, input, select, a, .p-menu, .p-idle, .p-error') && !!target.closest('.osd, .p-seek-hint'));
  // Touch: taps are read from the touch itself, not from the click the WebView makes of it (that
  // click can come late or not at all for the second tap of a double tap).
  let touchDown = null;
  let lastTouchTap = 0;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && e.isPrimary) touchDown = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target };
  });
  wrap.addEventListener('pointerup', (e) => {
    const d = touchDown;
    touchDown = null;
    if (!d || e.pointerType !== 'touch' || !onVideoArea(d.target)) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 30 || Date.now() - d.t > 500) return; // a swipe or a long press
    lastTouchTap = Date.now();
    onTap(e);
  });
  wrap.addEventListener('pointercancel', () => (touchDown = null));
  wrap.addEventListener('click', (e) => {
    if (Date.now() - lastTouchTap < 800) return; // this click is the WebView's copy of a tap already handled
    if (!onVideoArea(e.target)) return;
    onTap(e);
  });
  function onTap(e) {
    const now = Date.now();
    const side = sideOf(e);
    if (sideMode && side === sideMode && now < sideUntil) return sideSeek(side); // still tapping that side
    if (now - lastClick < TAP_GAP) {
      clearTimeout(clickTimer);
      lastClick = 0;
      if (side === 'mid') return touchUi ? togglePlay() : toggleFullscreen();
      return sideSeek(side);
    }
    lastClick = now;
    sideMode = null;
    clearTimeout(clickTimer);
    // touch: a tap shows/hides the controls (play/pause is the big button), like Netflix on phones
    clickTimer = setTimeout(touchUi ? () => (wrap.classList.contains('show-osd') ? hideOsd() : showOsd()) : togglePlay, TAP_GAP);
  }
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    setVolume(video.volume + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });

  Router.keyHook = (e) => {
    if (!el.qmenu.hidden) {
      // Quality menu open: arrows/Enter move through it, Esc or Q closes it.
      if (e.key === 'Escape' || e.key === 'q' || e.key === 'Q') {
        el.qmenu.hidden = true;
        return true;
      }
      return false;
    }
    if (!el.idle.hidden) return false;
    if (!el.errorPanel.hidden) {
      // Error panel open: let normal navigation drive its buttons.
      return false;
    }
    if (e.target.matches && e.target.matches('input[type=range]') && /Arrow/.test(e.key)) return false;
    const k = e.key;
    showOsd();
    // Remote focus on a control: arrows move between controls, OK presses it, Back hides them.
    if (osdFocused()) {
      if (k === 'Escape') {
        document.activeElement.blur();
        hideOsd();
        return true;
      }
      if (/^Arrow/.test(k) || k === 'Enter' || k === ' ') return false;
    }
    if (tvUi && (k === 'Enter' || (!isLive && (k === 'ArrowUp' || k === 'ArrowDown')))) {
      el.play.focus();
      return true;
    }
    if (k === ' ' || k === 'k' || k === 'MediaPlayPause' || (k === 'Enter' && e.target === document.body)) return togglePlay(), true;
    if (k === 'Escape' && document.fullscreenElement) return document.exitFullscreen(), true;
    if (k === 'ArrowRight' && !e.altKey) return isLive ? false : (seekBy(seekStep), true);
    if (k === 'ArrowLeft' && !e.altKey) return isLive ? false : (seekBy(-seekStep), true);
    if (k === 'ArrowUp') return isLive ? (step(-1), true) : (setVolume(video.volume + 0.1), true);
    if (k === 'ArrowDown') return isLive ? (step(1), true) : (setVolume(video.volume - 0.1), true);
    if (['PageUp', 'ChannelUp', 'MediaTrackPrevious'].includes(k)) return step(-1), true;
    if (['PageDown', 'ChannelDown', 'MediaTrackNext'].includes(k)) return step(1), true;
    if (k === '+' || k === '=' || k === 'AudioVolumeUp') return setVolume(video.volume + 0.1), true;
    if (k === '-' || k === 'AudioVolumeDown') return setVolume(video.volume - 0.1), true;
    if (k === 'm' || k === 'M' || k === 'AudioVolumeMute') return toggleMute(), true;
    if (k === 'f' || k === 'F' || k === 'F11') return toggleFullscreen(), true;
    if (k === 'i' || k === 'I') return toggleStats(), true;
    if (k === 'c' || k === 'C') return toggleCompat(), true;
    if (k === 'q' || k === 'Q') return toggleQualityMenu(true), true;
    return false;
  };

  // big play/pause in the middle of the controls on touch screens
  if (touchUi) {
    const big = h('button.osd-btn.p-bigplay', { onclick: (e) => { e.stopPropagation(); togglePlay(); } }, icon('pause'));
    video.addEventListener('play', () => setIcon(big, 'pause'));
    video.addEventListener('pause', () => setIcon(big, 'play'));
    wrap.append(big);
  }
  if (android) window.api.setPlayerMode(true).catch(() => {});

  renderBadge();
  showOsd();
  try {
    await open();
    if (isLive) History.upsert({ kind: 'live', id: p.id, title: p.title, logo: p.logo });
  } catch (e) {
    showError(e.message);
  }
  if (el.errorPanel.hidden && document.activeElement) document.activeElement.blur();

  return () => {
    closed = true;
    if (android) window.api.setPlayerMode(false).catch(() => {});
    S.windowListener = null;
    for (const ev of INPUT_EVENTS) window.removeEventListener(ev, markInput, true);
    clearInterval(statsTimer);
    clearInterval(epgTimer);
    clearTimeout(hideTimer);
    clearTimeout(pauseTimer);
    clearTimeout(flashTimer);
    clearTimeout(clickTimer);
    document.removeEventListener('fullscreenchange', onFsChange);
    if (!isLive && pos() > 0) {
      if (isFinite(dur()) && pos() > dur() - 60) {
        store.del(resumeKey);
        History.remove(p);
      } else {
        store.set(resumeKey, Math.floor(pos()));
        if (pos() > 30) saveHistory();
      }
    }
    destroyEngine();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (sid) {
      window.api.closeStream(sid).then((s) => {
        if (s && s.bytes > 0 && s.end - s.start > 10_000) {
          toast(t('«{0}»: شاهدت {1} واستهلكت {2}', [s.title, fmtDuration(s.end - s.start), fmtBytes(s.bytes)]), 6000);
        }
        refreshTopUsage();
      });
    }
  };
}
