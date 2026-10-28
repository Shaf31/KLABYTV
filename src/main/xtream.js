// Xtream Codes API client (player_api.php).
const LIVE_FORMATS = ['ts', 'm3u8'];

function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('عنوان السيرفر مطلوب');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  const u = new URL(s);
  // People often paste a full link (player_api.php / get.php ...): keep only scheme://host:port
  return `${u.protocol}//${u.host}`;
}

class XtreamClient {
  constructor({ server, username, password }, { usage, getUserAgent }) {
    this.server = normalizeServer(server);
    this.username = username;
    this.password = password;
    this.usage = usage;
    this.getUserAgent = getUserAgent;
  }

  async call(action, params = {}) {
    const url = new URL(this.server + '/player_api.php');
    url.searchParams.set('username', this.username);
    url.searchParams.set('password', this.password);
    if (action) url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);

    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': this.getUserAgent(), Accept: 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      const why = e.name === 'TimeoutError' ? 'انتهت مهلة الاتصال' : e.cause?.message || e.message;
      throw new Error(`تعذر الاتصال بالسيرفر: ${why}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    this.usage.add('', buf.length);
    if (res.status === 401 || res.status === 403) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
    if (!res.ok) throw new Error(`السيرفر رد بخطأ HTTP ${res.status}`);
    const text = buf.toString('utf8').trim();
    if (!text) return action ? [] : null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('رد السيرفر غير مفهوم (تأكد إنه سيرفر Xtream)');
    }
  }

  async login() {
    const data = await this.call('');
    const info = data && data.user_info;
    if (!info || Number(info.auth) !== 1) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
    if (info.status && info.status !== 'Active') throw new Error(`الاشتراك غير فعال (${info.status})`);
    return data;
  }

  // kind: live | movie | series
  streamUrl(kind, id, ext) {
    const base = `${this.server}/${kind}/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${id}`;
    if (kind === 'live') return `${base}.${LIVE_FORMATS.includes(ext) ? ext : 'ts'}`;
    return ext ? `${base}.${ext}` : base;
  }
}

module.exports = { XtreamClient, normalizeServer };
