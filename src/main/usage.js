// Tracks every byte the player downloads, per viewing session and per day.
const crypto = require('crypto');
const { JsonStore } = require('./store');

const MAX_SESSIONS = 2000;

function dayKey(ts = Date.now()) {
  return new Date(ts).toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

class UsageTracker {
  constructor(file) {
    this.store = new JsonStore(file, { days: {}, sessions: [] });
    this.active = new Map();
    this.dirty = false;
    this.timer = setInterval(() => this.flush(), 10_000);
  }

  startSession({ title, kind, streamId }) {
    const s = {
      id: crypto.randomUUID(),
      title: String(title || ''),
      kind: kind || 'live',
      streamId: streamId ?? null,
      start: Date.now(),
      end: Date.now(),
      bytes: 0,
    };
    this.active.set(s.id, s);
    this.store.data.sessions.unshift(s);
    if (this.store.data.sessions.length > MAX_SESSIONS) this.store.data.sessions.length = MAX_SESSIONS;
    this.dirty = true;
    return s;
  }

  // bytes downloaded for a session (sid) or, without a live session, for "other" (API calls, posters).
  add(sid, n) {
    if (!n) return;
    const key = dayKey();
    const day = (this.store.data.days[key] ||= { video: 0, other: 0 });
    const s = sid && this.active.get(sid);
    if (s) {
      s.bytes += n;
      s.end = Date.now();
      day.video += n;
    } else {
      day.other += n;
    }
    this.dirty = true;
  }

  get(sid) {
    const s = this.active.get(sid);
    return s ? { ...s, now: Date.now() } : null;
  }

  endSession(sid) {
    const s = this.active.get(sid);
    if (!s) return null;
    this.active.delete(sid);
    s.end = Date.now();
    if (s.bytes === 0) {
      // Nothing played (bad link, instant back): don't clutter the history.
      this.store.data.sessions = this.store.data.sessions.filter((x) => x.id !== sid);
    }
    this.dirty = true;
    this.flush();
    return { ...s };
  }

  summary() {
    return {
      days: this.store.data.days,
      sessions: this.store.data.sessions,
      activeIds: [...this.active.keys()],
    };
  }

  clear() {
    this.store.data = { days: {}, sessions: [...this.active.values()] };
    this.dirty = true;
    this.flush();
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try { this.store.save(); } catch (e) { console.error('usage save failed', e); }
  }

  close() {
    clearInterval(this.timer);
    for (const sid of [...this.active.keys()]) this.endSession(sid);
    this.flush();
  }
}

module.exports = { UsageTracker, dayKey };
