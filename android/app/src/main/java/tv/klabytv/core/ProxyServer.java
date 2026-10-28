package tv.klabytv.core;

import org.json.JSONObject;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import fi.iki.elonen.NanoHTTPD;

/**
 * Local HTTP server between the player and the IPTV server (port of src/main/proxy.js):
 *   /p?u=<url>&s=<session>  streams, playlists, posters — counts every byte, adds CORS, rewrites HLS
 *                           playlists, and holds movies to (position + buffer seconds)
 *   /x?action=..&q=<json>    Xtream API calls for the connected account (big lists stay off the JS bridge)
 *   PUT /upload              an M3U file picked in the page (too big for the JS bridge)
 * Other apps on the phone can reach 127.0.0.1 too, so every request must carry the session token.
 */
public class ProxyServer extends NanoHTTPD {
    public interface Host {
        UsageTracker usage();
        String userAgent();
        Provider client();
        /** extra request headers for a session (M3U user agent / referrer), or null */
        Map<String, String> headers(String sid);
        /** stores an uploaded playlist file, returns its id */
        String saveUpload(java.io.File tmp) throws Exception;
        /** { pos, dur, buffer } for a movie/episode session, or null */
        double[] playback(String sid);
    }

    public static final int PREFERRED_PORT = 17845;
    private static final long FREE_BYTES = 6L * 1024 * 1024;
    private static final long INDEX_BYTES = 32L * 1024 * 1024;
    private static final long NO_POSITION_MS = 6000;

    private final Host host;
    public final String token;
    private String origin = "";

    /** port 0 = let the OS pick one */
    public ProxyServer(Host host, String token, int port) {
        super("127.0.0.1", port);
        this.host = host;
        this.token = token;
    }

    public String startServer() throws IOException {
        start(NanoHTTPD.SOCKET_READ_TIMEOUT, true);
        origin = "http://127.0.0.1:" + getListeningPort();
        return origin;
    }

    public String origin() {
        return origin;
    }

    static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    /** The path keeps the target's file extension (/p/x.ts?...) like the desktop proxy. */
    public String wrap(String target, String sid) {
        String ext = "";
        try {
            Matcher m = Pattern.compile("\\.(\\w{1,5})$").matcher(new URL(target).getPath());
            if (m.find()) ext = "/x." + m.group(1);
        } catch (Exception ignored) { }
        return origin + "/p" + ext + "?t=" + token + "&s=" + enc(sid == null ? "" : sid) + "&u=" + enc(target);
    }

    private static Response.IStatus status(int code) {
        for (Response.Status s : Response.Status.values()) if (s.getRequestStatus() == code) return s;
        return new Response.IStatus() {
            public String getDescription() {
                return code + " Status";
            }

            public int getRequestStatus() {
                return code;
            }
        };
    }

    private static Response cors(Response r) {
        r.addHeader("Access-Control-Allow-Origin", "*");
        r.addHeader("Access-Control-Allow-Headers", "*");
        r.addHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
        r.addHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
        return r;
    }

    private static Response text(int code, String msg) {
        return cors(newFixedLengthResponse(status(code), "text/plain; charset=utf-8", msg));
    }

    @Override
    public Response serve(IHTTPSession session) {
        if (session.getMethod() == Method.OPTIONS) return cors(newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", ""));
        Map<String, String> q = session.getParms();
        if (!token.equals(q.get("t"))) return text(403, "forbidden");
        String uri = session.getUri();
        try {
            if (uri.equals("/x")) return api(q);
            if (uri.equals("/upload") && session.getMethod() == Method.PUT) return upload(session);
            if (uri.equals("/p") || uri.startsWith("/p/")) return proxy(session, q);
        } catch (Exception e) {
            return text(502, String.valueOf(e.getMessage()));
        }
        return text(404, "not found");
    }

    private Response api(Map<String, String> q) throws Exception {
        Provider c = host.client();
        if (c == null) return text(409, "لا يوجد حساب متصل");
        String json = c.call(q.get("action"), q.get("q") == null ? null : new JSONObject(q.get("q")));
        return cors(newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", json));
    }

    private Response upload(IHTTPSession session) throws Exception {
        Map<String, String> files = new java.util.HashMap<>();
        session.parseBody(files); // PUT body -> temp file ("content"), deleted after this response
        String tmp = files.get("content");
        if (tmp == null) return text(400, "empty");
        String id = host.saveUpload(new java.io.File(tmp));
        return cors(newFixedLengthResponse(Response.Status.OK, "application/json", new JSONObject().put("id", id).toString()));
    }

    private Response proxy(IHTTPSession session, Map<String, String> q) throws Exception {
        String target = q.get("u");
        String sid = q.get("s") == null ? "" : q.get("s");
        if (target == null || !target.matches("(?i)^https?://.*")) return text(404, "bad url");
        String range = session.getHeaders().get("range");
        HttpURLConnection up = XtreamClient.Http.open(target, host.userAgent(), range, 30_000, host.headers(sid));
        int code = up.getResponseCode();
        String type = up.getContentType() == null ? "" : up.getContentType();
        String finalUrl = up.getURL().toString();
        InputStream body = code >= 400 ? up.getErrorStream() : up.getInputStream();
        if (body == null) {
            up.disconnect();
            return text(code, "");
        }

        boolean playlist = type.toLowerCase().contains("mpegurl") || new URL(finalUrl).getPath().toLowerCase().matches(".*\\.m3u8?$");
        if (code < 400 && playlist) {
            byte[] raw = XtreamClient.readAll(body);
            up.disconnect();
            host.usage().add(sid, raw.length);
            return cors(newFixedLengthResponse(Response.Status.OK, "application/vnd.apple.mpegurl", rewrite(new String(raw, StandardCharsets.UTF_8), finalUrl, sid)));
        }

        long length = up.getContentLengthLong();
        String contentRange = up.getHeaderField("Content-Range");
        long start = 0;
        long total = length;
        Matcher m = contentRange == null ? null : Pattern.compile("bytes (\\d+)-\\d+/(\\d+)").matcher(contentRange);
        if (m != null && m.find()) {
            start = Long.parseLong(m.group(1));
            total = Long.parseLong(m.group(2));
        }
        String kind = host.usage().kindOf(sid);
        boolean gated = kind != null && !"live".equals(kind) && total > 0;
        InputStream counted = new StreamOut(body, up, sid, gated, start, total);
        Response r = length >= 0
            ? newFixedLengthResponse(status(code), type.isEmpty() ? "application/octet-stream" : type, counted, length)
            : newChunkedResponse(status(code), type.isEmpty() ? "application/octet-stream" : type, counted);
        if (contentRange != null) r.addHeader("Content-Range", contentRange);
        String ranges = up.getHeaderField("Accept-Ranges");
        if (ranges != null) r.addHeader("Accept-Ranges", ranges);
        if (type.startsWith("image/")) r.addHeader("Cache-Control", "max-age=604800");
        // One connection per stream: when the stream is cut (session closed, upstream error) the
        // socket closes too, instead of leaving the player waiting on a keep-alive connection.
        if (!type.startsWith("image/")) r.closeConnection(true);
        return cors(r);
    }

    /** HLS playlist: every URI also goes through the proxy. */
    private String rewrite(String text, String base, String sid) {
        StringBuilder out = new StringBuilder();
        Pattern uriAttr = Pattern.compile("URI=\"([^\"]+)\"");
        for (String line : text.split("\\r?\\n", -1)) {
            String t = line.trim();
            if (t.isEmpty()) {
                out.append(line);
            } else if (t.startsWith("#")) {
                Matcher m = uriAttr.matcher(line);
                StringBuffer sb = new StringBuffer();
                while (m.find()) m.appendReplacement(sb, Matcher.quoteReplacement("URI=\"" + abs(m.group(1), base, sid) + "\""));
                m.appendTail(sb);
                out.append(sb);
            } else {
                out.append(abs(t, base, sid));
            }
            out.append('\n');
        }
        return out.toString();
    }

    private String abs(String uri, String base, String sid) {
        try {
            return wrap(new URL(new URL(base), uri).toString(), sid);
        } catch (Exception e) {
            return uri;
        }
    }

    /**
     * Upstream body: counts bytes for the data usage, and for movies/episodes only lets the file
     * through up to (position + buffer seconds) — the same fixed buffer as the desktop app.
     */
    private class StreamOut extends FilterInputStream {
        private final HttpURLConnection conn;
        private final String sid;
        private final boolean gated;
        private final long start;
        private final long total;
        private final long t0 = System.currentTimeMillis();
        private long sent = 0;
        private long free = -1;

        StreamOut(InputStream in, HttpURLConnection conn, String sid, boolean gated, long start, long total) {
            super(in);
            this.conn = conn;
            this.sid = sid;
            this.gated = gated;
            this.start = start;
            this.total = total;
        }

        /** How many more bytes may go out now (blocks while the buffer is full). */
        private long allowance() throws IOException {
            while (true) {
                if (host.usage().kindOf(sid) == null) throw new IOException("session closed");
                double[] pb = host.playback(sid);
                double bps = pb != null && pb[1] > 0 && pb[2] > 0 ? total / pb[1] : 0;
                if (bps == 0) {
                    // the request can start before the player's first position report
                    if (sent < FREE_BYTES) return FREE_BYTES - sent;
                    if (System.currentTimeMillis() - t0 > NO_POSITION_MS) return Long.MAX_VALUE;
                } else {
                    double windowEnd = (pb[0] + pb[2]) * bps;
                    if (free < 0) {
                        if (start <= windowEnd + FREE_BYTES) free = FREE_BYTES;
                        else if (System.currentTimeMillis() - t0 > 1500) free = INDEX_BYTES; // index read at the end of the file
                    }
                    if (free >= 0) {
                        long allowed = (long) Math.max(start + free, windowEnd);
                        if (allowed > start + sent) return allowed - (start + sent);
                    }
                }
                try {
                    Thread.sleep(400);
                } catch (InterruptedException e) {
                    throw new IOException("interrupted");
                }
            }
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (gated) len = (int) Math.min(len, allowance());
            int n = super.read(b, off, len);
            if (n > 0) {
                sent += n;
                host.usage().add(sid, n);
            }
            return n;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);
            return n <= 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public void close() throws IOException {
            try {
                super.close();
            } finally {
                conn.disconnect();
            }
        }
    }
}
