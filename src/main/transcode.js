// "Compatibility mode": when Chromium can't play a stream (MKV, AC3/E-AC3/DTS audio, HEVC 10-bit,
// MPEG-2 ...), ffmpeg converts it on the fly to MPEG-TS with H.264 + AAC, which the built-in player
// (mpegts.js) always handles. Video is copied untouched when it's already H.264, so CPU use stays low.
// ffmpeg reads the stream through the local proxy, so data usage is still counted exactly.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ffmpegPath(app) {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    app.isPackaged && path.join(process.resourcesPath, 'ffmpeg', name),
    process.platform === 'darwin' && path.join(__dirname, '..', '..', 'vendor', 'ffmpeg', `mac-${process.arch}`, name),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || name; // fall back to ffmpeg on PATH (dev on Linux/Windows)
}

function parseProbe(text) {
  const d = text.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const br = text.match(/Duration: [^\n]*bitrate: (\d+) kb\/s/);
  const v = text.match(/Stream #\d+:\d+[^\n]*?: Video: (\w+)([^\n]*)/);
  const a = text.match(/Stream #\d+:\d+[^\n]*?: Audio: (\w+)/);
  const size = v && v[2].match(/, (\d{2,5})x(\d{2,5})/);
  return {
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    bitrate: br ? Number(br[1]) * 1000 : 0, // bits per second
    video: v ? { codec: v[1], height: size ? Number(size[2]) : 0, tenBit: /p10|p12/.test(v[2]) } : null,
    audio: a ? { codec: a[1] } : null,
  };
}

class Transcoder {
  constructor({ app, getUserAgent }) {
    this.bin = ffmpegPath(app);
    this.getUserAgent = getUserAgent;
    this.jobs = new Map();
    this.encoder = null;
  }

  // Hardware H.264 encoder on macOS (VideoToolbox), libx264 elsewhere.
  async videoEncoder() {
    if (this.encoder) return this.encoder;
    const list = await new Promise((resolve) =>
      execFile(this.bin, ['-hide_banner', '-encoders'], { timeout: 10_000 }, (_e, out) => resolve(out || '')),
    );
    this.encoder = list.includes('h264_videotoolbox') ? 'h264_videotoolbox' : 'libx264';
    return this.encoder;
  }

  probe(url) {
    return new Promise((resolve, reject) => {
      let err = '';
      const p = spawn(this.bin, ['-hide_banner', '-nostdin', '-probesize', '5M', '-analyzeduration', '5M', '-i', url]);
      const timer = setTimeout(() => p.kill('SIGKILL'), 20_000);
      p.stderr.on('data', (c) => (err += c));
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`تعذر تشغيل ffmpeg: ${e.message}`));
      });
      p.on('close', () => {
        clearTimeout(timer);
        const info = parseProbe(err);
        if (!info.video && !info.audio) {
          const why = (err.match(/Server returned [^\n]+|HTTP error [^\n]+|Connection refused|Invalid data[^\n]*/) || [])[0];
          return reject(new Error(why ? `السيرفر: ${why}` : 'تعذر قراءة البث'));
        }
        resolve(info);
      });
    });
  }

  async createJob({ input, sid, live }) {
    const info = await this.probe(input);
    const enc = await this.videoEncoder();
    const v = info.video;
    const copyVideo = v && v.codec === 'h264' && !v.tenBit;
    const copyAudio = info.audio && info.audio.codec === 'aac';
    const id = crypto.randomUUID();
    this.jobs.set(id, { id, input, sid, live, info, copyVideo, copyAudio, enc });
    return { id, info, transcodeVideo: !!v && !copyVideo, transcodeAudio: !!info.audio && !copyAudio };
  }

  args(job, ss) {
    const a = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    if (ss > 0) a.push('-ss', String(ss));
    a.push('-reconnect', '1', '-reconnect_delay_max', '4');
    if (job.live) a.push('-reconnect_streamed', '1');
    a.push('-fflags', '+genpts+discardcorrupt', '-i', job.input, '-map', '0:v:0?', '-map', '0:a:0?');

    const v = job.info.video;
    if (!v) a.push('-vn');
    else if (job.copyVideo) a.push('-c:v', 'copy');
    else {
      const h = v.height || 1080;
      const filters = ['format=yuv420p'];
      if (h > 1080) filters.unshift('scale=-2:1080');
      const rate = h > 720 ? '6M' : h > 480 ? '4M' : '2M';
      a.push('-vf', filters.join(','));
      if (job.enc === 'h264_videotoolbox') a.push('-c:v', 'h264_videotoolbox', '-b:v', rate, '-realtime', '1', '-allow_sw', '1');
      else a.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '21', '-maxrate', rate, '-bufsize', rate);
      a.push('-g', '50');
    }

    if (!job.info.audio) a.push('-an');
    else if (job.copyAudio) a.push('-c:a', 'copy');
    else a.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');

    a.push('-sn', '-dn', '-f', 'mpegts', '-muxdelay', '0', 'pipe:1');
    return a;
  }

  // Served by the local proxy at /t?j=<job>&ss=<seconds>
  serve(req, res, jobId, ss) {
    const job = this.jobs.get(jobId);
    if (!job) {
      res.writeHead(404);
      return res.end();
    }
    const p = spawn(this.bin, this.args(job, ss), { stdio: ['ignore', 'pipe', 'pipe'] });
    let errText = '';
    let started = false;
    p.stderr.on('data', (c) => (errText = (errText + c).slice(-2000)));
    p.stdout.once('data', () => {
      started = true;
    });
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache' });
    p.stdout.pipe(res);
    p.on('error', () => res.destroy());
    p.on('close', (code) => {
      if (code && !started) console.error('ffmpeg failed:', errText);
      res.end();
    });
    res.on('close', () => p.kill('SIGKILL'));
  }

  dropSession(sid) {
    for (const [id, j] of this.jobs) if (j.sid === sid) this.jobs.delete(id);
  }
}

module.exports = { Transcoder, parseProbe };
