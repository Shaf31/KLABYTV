// People often write https:// for a server whose port only speaks plain http (very common with
// IPTV panels, e.g. :8080 or :2095). The TLS handshake then fails with a protocol error, not a
// certificate one: retry the same address over http. Certificate problems are never retried.
const PLAIN_HTTP_ON_TLS = /ERR_SSL_(PACKET_LENGTH_TOO_LONG|WRONG_VERSION_NUMBER|HTTP_REQUEST)|wrong version number|packet length too long|http request/i;

function isPlainHttpOnTls(e) {
  const c = e && e.cause;
  return PLAIN_HTTP_ON_TLS.test(`${c && c.code} ${c && c.message} ${e && e.message}`);
}

const toHttp = (url) => String(url).replace(/^https:/i, 'http:');

// fetch() that falls back to http:// as above; the response has .downgraded = true when it did.
async function fetchHttpFallback(url, options) {
  try {
    return await fetch(url, options);
  } catch (e) {
    if (!/^https:/i.test(String(url)) || !isPlainHttpOnTls(e)) throw e;
    const res = await fetch(toHttp(url), options);
    res.downgraded = true;
    return res;
  }
}

module.exports = { fetchHttpFallback, isPlainHttpOnTls, toHttp };
