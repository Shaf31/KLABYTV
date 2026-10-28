package tv.klabytv.core;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

/** Xtream Codes API client (player_api.php) — port of src/main/xtream.js. */
public class XtreamClient implements Provider {
    public interface UserAgent {
        String get();
    }

    public final String server;
    public final String username;
    final String password;
    private final UsageTracker usage;
    private final UserAgent userAgent;

    public XtreamClient(String server, String username, String password, UsageTracker usage, UserAgent userAgent) throws Exception {
        this.server = normalizeServer(server);
        this.username = username;
        this.password = password;
        this.usage = usage;
        this.userAgent = userAgent;
    }

    public static String normalizeServer(String input) throws Exception {
        String s = input == null ? "" : input.trim();
        if (s.isEmpty()) throw new Exception("عنوان السيرفر مطلوب");
        if (!s.matches("(?i)^https?://.*")) s = "http://" + s;
        URI u = new URI(s);
        if (u.getHost() == null) throw new Exception("عنوان السيرفر غير صحيح");
        // People often paste a full link (player_api.php / get.php ...): keep only scheme://host:port
        return u.getScheme().toLowerCase() + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
    }

    static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return s;
        }
    }

    /** Raw JSON text of the API response. */
    @Override
    public String call(String action, JSONObject params) throws Exception {
        StringBuilder url = new StringBuilder(server).append("/player_api.php?username=").append(enc(username)).append("&password=").append(enc(password));
        if (action != null && !action.isEmpty()) url.append("&action=").append(enc(action));
        if (params != null) {
            for (Iterator<String> it = params.keys(); it.hasNext(); ) {
                String k = it.next();
                Object v = params.opt(k);
                if (v == null || v == JSONObject.NULL || String.valueOf(v).isEmpty()) continue;
                url.append('&').append(enc(k)).append('=').append(enc(String.valueOf(v)));
            }
        }
        HttpURLConnection c;
        try {
            c = Http.open(url.toString(), userAgent.get(), null, 45_000);
        } catch (IOException e) {
            String why = e instanceof java.net.SocketTimeoutException ? "انتهت مهلة الاتصال" : e.getMessage();
            throw new Exception("تعذر الاتصال بالسيرفر: " + why);
        }
        int code = c.getResponseCode();
        byte[] body;
        try (InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream()) {
            body = in == null ? new byte[0] : readAll(in);
        } finally {
            c.disconnect();
        }
        usage.add("", body.length);
        if (code == 401 || code == 403) throw new Exception("اسم المستخدم أو كلمة المرور غير صحيحة");
        if (code >= 400) throw new Exception("السيرفر رد بخطأ HTTP " + code);
        String text = new String(body, StandardCharsets.UTF_8).trim();
        if (text.isEmpty()) return action == null || action.isEmpty() ? "null" : "[]";
        char first = text.charAt(0);
        if (first != '{' && first != '[') throw new Exception("رد السيرفر غير مفهوم (تأكد إنه سيرفر Xtream)");
        return text;
    }

    @Override
    public JSONObject login() throws Exception {
        String text = call("", null);
        JSONObject data;
        try {
            data = new JSONObject(text);
        } catch (Exception e) {
            throw new Exception("اسم المستخدم أو كلمة المرور غير صحيحة");
        }
        JSONObject info = data.optJSONObject("user_info");
        if (info == null || info.optInt("auth", 0) != 1) throw new Exception("اسم المستخدم أو كلمة المرور غير صحيحة");
        String status = info.optString("status", "");
        if (!status.isEmpty() && !"Active".equals(status)) throw new Exception("الاشتراك غير فعال (" + status + ")");
        return data;
    }

    /** kind: live | movie | series */
    @Override
    public String streamUrl(String kind, String id, String ext) {
        String base = server + "/" + kind + "/" + enc(username) + "/" + enc(password) + "/" + id;
        if ("live".equals(kind)) return base + "." + ("m3u8".equals(ext) ? "m3u8" : "ts");
        return ext != null && !ext.isEmpty() ? base + "." + ext : base;
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    /** HTTP helper that follows redirects across http/https (HttpURLConnection only follows same-scheme ones). */
    public static class Http {
        public static HttpURLConnection open(String url, String userAgent, String range, int timeoutMs) throws IOException {
            return open(url, userAgent, range, timeoutMs, null);
        }

        /** extra: more request headers (they win over the default User-Agent) */
        public static HttpURLConnection open(String url, String userAgent, String range, int timeoutMs, java.util.Map<String, String> extra) throws IOException {
            String current = url;
            for (int i = 0; i < 6; i++) {
                HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(20_000);
                c.setReadTimeout(timeoutMs);
                c.setRequestProperty("User-Agent", userAgent);
                c.setRequestProperty("Accept", "*/*");
                c.setRequestProperty("Accept-Encoding", "identity");
                if (range != null) c.setRequestProperty("Range", range);
                if (extra != null) for (java.util.Map.Entry<String, String> h : extra.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
                int code = c.getResponseCode();
                if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                    current = new URL(new URL(current), c.getHeaderField("Location")).toString();
                    c.disconnect();
                    continue;
                }
                return c;
            }
            throw new IOException("too many redirects");
        }
    }
}
