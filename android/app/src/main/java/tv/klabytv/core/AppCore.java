package tv.klabytv.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Everything the desktop app's main process does (src/main.js), for Android: accounts, favorites,
 * settings, playback sessions + data usage, and the local proxy. The web UI calls handle() through
 * the JS bridge with the same channel names as the desktop preload.
 */
public class AppCore implements ProxyServer.Host {
    public interface Crypto {
        String encrypt(String plain) throws Exception;

        /** throws if the value can't be decrypted */
        String decrypt(String stored) throws Exception;
    }

    /** Marks a String that already is JSON text (passed to JS as is). */
    public static final class Raw {
        public final String json;

        public Raw(String json) {
            this.json = json;
        }
    }

    private final Crypto crypto;
    private final String formFactor;
    private final JsonStore settings;
    private final JsonStore accounts;
    private final JsonStore favorites;
    private final UsageTracker usage;
    private final ProxyServer proxy;
    private final Map<String, double[]> playback = new HashMap<>();
    private final Map<String, Map<String, String>> sessionHeaders = new HashMap<>();
    private final File playlists;
    private volatile Provider client;
    private String currentAccountId;

    public AppCore(File dir, Crypto crypto, String deviceName, String formFactor) throws Exception {
        this.crypto = crypto;
        this.formFactor = formFactor;
        this.playlists = new File(dir, "playlists");
        JSONObject defaults = new JSONObject()
            .put("userAgent", "VLC/3.0.20 LibVLC/3.0.20")
            .put("liveFormat", "ts")
            .put("showPlayerStats", true)
            .put("stillWatching", true)
            .put("stillWatchingHours", 2)
            .put("pauseWhenMinimized", true)
            .put("seekStep", 10)
            .put("bufferSeconds", 60)
            .put("deviceName", deviceName)
            .put("uiMode", "auto") // auto | mobile | tv
            .put("lastAccountId", JSONObject.NULL);
        settings = new JsonStore(new File(dir, "settings.json"), defaults);
        if (settings.data.optString("deviceName", "").isEmpty()) settings.data.put("deviceName", deviceName);
        if (settings.data.optString("proxyToken", "").isEmpty()) {
            // stays the same between launches so cached posters keep working
            byte[] b = new byte[16];
            new SecureRandom().nextBytes(b);
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format("%02x", x));
            settings.data.put("proxyToken", sb.toString());
            settings.save();
        }
        accounts = new JsonStore(new File(dir, "accounts.json"), new JSONObject().put("list", new JSONArray()));
        favorites = new JsonStore(new File(dir, "favorites.json"), new JSONObject());
        usage = new UsageTracker(new File(dir, "usage.json"));

        String token = settings.data.getString("proxyToken");
        ProxyServer p;
        try {
            p = new ProxyServer(this, token, ProxyServer.PREFERRED_PORT);
            p.startServer();
        } catch (Exception busy) {
            p = new ProxyServer(this, token, 0); // preferred port taken: let the OS pick one
            p.startServer();
        }
        proxy = p;
    }

    // ---- ProxyServer.Host ----
    public UsageTracker usage() {
        return usage;
    }

    public String userAgent() {
        return settings.data.optString("userAgent", "VLC/3.0.20 LibVLC/3.0.20");
    }

    public Provider client() {
        return client;
    }

    public synchronized Map<String, String> headers(String sid) {
        return sessionHeaders.get(sid);
    }

    public String saveUpload(File tmp) throws Exception {
        File dir = new File(playlists, "uploads");
        dir.mkdirs();
        String id = UUID.randomUUID().toString();
        copy(new FileInputStream(tmp), new File(dir, id + ".m3u"));
        return id;
    }

    private static void copy(InputStream in, File to) throws Exception {
        try (InputStream i = in; OutputStream o = new FileOutputStream(to)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = i.read(buf)) > 0) o.write(buf, 0, n);
        }
    }

    // ---- M3U playlists: a link is downloaded again on every sign-in (a copy is kept for when
    // that fails); a file from the device is kept as that copy ----
    private File playlistFile(String id) {
        return new File(playlists, id + ".m3u");
    }

    private String downloadPlaylist(String url) throws Exception {
        if (!url.matches("(?i)^https?://.*")) url = "http://" + url;
        HttpURLConnection c;
        try {
            c = XtreamClient.Http.open(url, userAgent(), null, 90_000);
        } catch (java.io.IOException e) {
            throw new Exception("تعذر تحميل القائمة: " + (e instanceof java.net.SocketTimeoutException ? "انتهت مهلة الاتصال" : e.getMessage()));
        }
        try {
            int code = c.getResponseCode();
            if (code >= 400) throw new Exception("تعذر تحميل القائمة: HTTP " + code);
            byte[] body = XtreamClient.readAll(c.getInputStream());
            usage.add("", body.length);
            return new String(body, StandardCharsets.UTF_8);
        } finally {
            c.disconnect();
        }
    }

    private void savePlaylist(String id, String text) throws Exception {
        playlists.mkdirs();
        try (OutputStream o = new FileOutputStream(playlistFile(id))) {
            o.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String readText(File f) throws Exception {
        try (InputStream in = new FileInputStream(f)) {
            return new String(XtreamClient.readAll(in), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new Exception("تعذر قراءة الملف: " + e.getMessage());
        }
    }

    private M3UClient m3uClient(JSONObject a) throws Exception {
        String id = a.getString("id");
        String text = null;
        if (!a.optString("url").isEmpty()) {
            try {
                text = downloadPlaylist(crypto.decrypt(a.getString("url")));
                savePlaylist(id, text);
            } catch (Exception e) {
                if (!playlistFile(id).exists()) throw e;
            }
        }
        if (text == null) text = readText(playlistFile(id));
        return new M3UClient(text, usage, this::userAgent);
    }

    private JSONObject addM3U(JSONObject a) throws Exception {
        String url = a.optString("url", "").trim();
        String upload = a.optString("upload", "");
        String text;
        if (!upload.isEmpty()) {
            File f = new File(new File(playlists, "uploads"), upload.replaceAll("[^\\w-]", "") + ".m3u");
            text = readText(f);
            f.delete();
        } else if (!url.isEmpty()) {
            text = downloadPlaylist(url);
        } else {
            throw new Exception("اختار ملف M3U أو اكتب رابط القائمة");
        }
        M3UClient c = new M3UClient(text, usage, this::userAgent);
        JSONObject info = c.login();
        String label = a.optString("fileName", "M3U");
        if (!url.isEmpty()) {
            try {
                label = new java.net.URL(url.matches("(?i)^https?://.*") ? url : "http://" + url).getHost();
            } catch (Exception ignored) { }
        }
        String name = a.optString("name", "").trim();
        if (name.isEmpty()) name = label.replaceAll("(?i)\\.m3u8?$", "");
        String id = UUID.randomUUID().toString();
        savePlaylist(id, text);
        JSONObject account = new JSONObject()
            .put("id", id)
            .put("type", "m3u")
            .put("name", name)
            .put("server", label)
            .put("username", "")
            .put("url", url.isEmpty() ? "" : crypto.encrypt(url));
        accounts.data.getJSONArray("list").put(account);
        accounts.save();
        return connected(account, c, info);
    }

    public synchronized double[] playback(String sid) {
        return playback.get(sid);
    }

    public JSONObject settings() {
        return settings.data;
    }

    public void shutdown() {
        usage.closeAll();
        proxy.stop();
    }

    private Provider requireClient() throws Exception {
        if (client == null) throw new Exception("لا يوجد حساب متصل");
        return client;
    }

    private JSONObject findAccount(String id) throws Exception {
        JSONArray list = accounts.data.getJSONArray("list");
        for (int i = 0; i < list.length(); i++) if (id.equals(list.getJSONObject(i).optString("id"))) return list.getJSONObject(i);
        throw new Exception("الحساب غير موجود");
    }

    private static JSONObject publicAccount(JSONObject a) throws Exception {
        return new JSONObject().put("id", a.get("id")).put("type", a.optString("type", "xtream")).put("name", a.get("name")).put("server", a.get("server")).put("username", a.optString("username", ""));
    }

    private JSONArray publicAccounts() throws Exception {
        JSONArray list = accounts.data.getJSONArray("list");
        JSONArray out = new JSONArray();
        for (int i = 0; i < list.length(); i++) out.put(publicAccount(list.getJSONObject(i)));
        return out;
    }

    private JSONObject connected(JSONObject account, Provider c, JSONObject info) throws Exception {
        client = c;
        currentAccountId = account.getString("id");
        settings.data.put("lastAccountId", currentAccountId);
        settings.save();
        return new JSONObject().put("account", publicAccount(account)).put("info", info);
    }

    private JSONObject favs() throws Exception {
        JSONObject f = currentAccountId == null ? null : favorites.data.optJSONObject(currentAccountId);
        if (f == null) {
            f = new JSONObject().put("live", new JSONArray()).put("movie", new JSONArray()).put("series", new JSONArray());
            if (currentAccountId != null) favorites.data.put(currentAccountId, f);
        }
        return f;
    }

    /** Starts a viewing session and returns { sid, url } (url goes through the proxy). */
    public synchronized JSONObject openStream(JSONObject o) throws Exception {
        Provider c = requireClient();
        String sid = o.optString("sid", "");
        if (sid.isEmpty() || usage.get(sid) == null) {
            sid = usage.startSession(o.optString("title"), o.optString("kind", "live"), o.optString("id")).getString("id");
        }
        String upstream = c.streamUrl(o.optString("kind", "live"), o.optString("id"), o.optString("ext", ""));
        Map<String, String> extra = c.headersFor(o.optString("kind", "live"), o.optString("id"));
        if (!extra.isEmpty()) sessionHeaders.put(sid, extra);
        return new JSONObject().put("sid", sid).put("url", proxy.wrap(upstream, sid));
    }

    public synchronized JSONObject closeStream(String sid) {
        playback.remove(sid);
        sessionHeaders.remove(sid);
        return usage.endSession(sid);
    }

    public synchronized void reportPosition(String sid, double pos, double dur) {
        if (usage.get(sid) == null || !(dur > 0)) return;
        playback.put(sid, new double[] { Math.max(0, pos), dur, settings.data.optDouble("bufferSeconds", 60) });
    }

    public Object handle(String channel, JSONArray args) throws Exception {
        switch (channel) {
            case "app:init":
                return new JSONObject()
                    .put("settings", settings.data)
                    .put("accounts", publicAccounts())
                    .put("proxyOrigin", proxy.origin())
                    .put("proxyToken", proxy.token)
                    .put("platform", "android")
                    .put("formFactor", formFactor);

            case "accounts:add": {
                JSONObject a = args.getJSONObject(0);
                if ("m3u".equals(a.optString("type"))) return addM3U(a);
                String user = a.optString("username", "").trim();
                String pass = a.optString("password", "");
                if (user.isEmpty() || pass.isEmpty()) throw new Exception("اسم المستخدم وكلمة المرور مطلوبين");
                XtreamClient c = new XtreamClient(a.optString("server"), user, pass, usage, this::userAgent);
                JSONObject info = c.login();
                String name = a.optString("name", "").trim();
                if (name.isEmpty()) name = user + "@" + new java.net.URL(c.server).getHost();
                JSONObject account = new JSONObject()
                    .put("id", UUID.randomUUID().toString())
                    .put("name", name)
                    .put("server", c.server)
                    .put("username", user)
                    .put("password", crypto.encrypt(pass));
                JSONArray old = accounts.data.getJSONArray("list");
                JSONArray list = new JSONArray();
                for (int i = 0; i < old.length(); i++) {
                    JSONObject x = old.getJSONObject(i);
                    if (!(x.optString("server").equals(c.server) && x.optString("username").equals(user))) list.put(x);
                }
                list.put(account);
                accounts.data.put("list", list);
                accounts.save();
                return connected(account, c, info);
            }

            case "accounts:connect": {
                JSONObject a = findAccount(args.getString(0));
                if ("m3u".equals(a.optString("type"))) {
                    M3UClient m = m3uClient(a);
                    return connected(a, m, m.login());
                }
                String pass;
                try {
                    pass = crypto.decrypt(a.getString("password"));
                } catch (Exception e) {
                    throw new Exception("NEED_PASSWORD");
                }
                XtreamClient c = new XtreamClient(a.getString("server"), a.getString("username"), pass, usage, this::userAgent);
                return connected(a, c, c.login());
            }

            case "accounts:password": {
                JSONObject a = findAccount(args.getString(0));
                XtreamClient c = new XtreamClient(a.getString("server"), a.getString("username"), args.getString(1), usage, this::userAgent);
                JSONObject info = c.login();
                a.put("password", crypto.encrypt(args.getString(1)));
                accounts.save();
                return connected(a, c, info);
            }

            case "accounts:remove": {
                String id = args.getString(0);
                JSONArray old = accounts.data.getJSONArray("list");
                JSONArray list = new JSONArray();
                for (int i = 0; i < old.length(); i++) if (!id.equals(old.getJSONObject(i).optString("id"))) list.put(old.get(i));
                accounts.data.put("list", list);
                accounts.save();
                playlistFile(id).delete();
                favorites.data.remove(id);
                favorites.save();
                if (id.equals(settings.data.optString("lastAccountId"))) {
                    settings.data.put("lastAccountId", JSONObject.NULL);
                    settings.save();
                }
                return publicAccounts();
            }

            case "accounts:logout":
                client = null;
                currentAccountId = null;
                settings.data.put("lastAccountId", JSONObject.NULL);
                settings.save();
                return null;

            case "favorites:get":
                return favs();

            case "favorites:toggle": {
                JSONObject f = favs();
                String kind = args.getString(0);
                String id = String.valueOf(args.get(1));
                JSONArray old = f.optJSONArray(kind) == null ? new JSONArray() : f.getJSONArray(kind);
                JSONArray list = new JSONArray();
                boolean had = false;
                for (int i = 0; i < old.length(); i++) {
                    if (id.equals(old.getString(i))) had = true;
                    else list.put(old.getString(i));
                }
                if (!had) {
                    JSONArray withNew = new JSONArray().put(id);
                    for (int i = 0; i < list.length(); i++) withNew.put(list.get(i));
                    list = withNew;
                }
                f.put(kind, list);
                favorites.save();
                return f;
            }

            case "stream:open": {
                JSONObject o = args.getJSONObject(0);
                if (o.optBoolean("compat")) throw new Exception("NO_COMPAT"); // Android uses its native player instead
                return openStream(o);
            }

            case "stream:stats":
                return usage.get(args.getString(0));

            case "stream:position": {
                JSONObject o = args.getJSONObject(1);
                reportPosition(args.getString(0), o.optDouble("pos", 0), o.optDouble("dur", 0));
                return null;
            }

            case "stream:close":
                return closeStream(args.getString(0));

            case "usage:summary":
                return new Raw(usage.summaryJson());

            case "usage:clear":
                usage.clear();
                return null;

            case "settings:set": {
                JSONObject patch = args.getJSONObject(0);
                for (String k : new String[] { "userAgent", "liveFormat", "deviceName", "uiMode" }) {
                    if (patch.has(k)) settings.data.put(k, patch.optString(k, "").trim());
                }
                for (String k : new String[] { "showPlayerStats", "stillWatching", "pauseWhenMinimized" }) {
                    if (patch.has(k)) settings.data.put(k, patch.optBoolean(k));
                }
                if (patch.has("stillWatchingHours")) settings.data.put("stillWatchingHours", clamp(patch.optDouble("stillWatchingHours", 2), 0.5, 6));
                if (patch.has("seekStep")) settings.data.put("seekStep", (int) clamp(patch.optDouble("seekStep", 10), 3, 600));
                if (patch.has("bufferSeconds")) settings.data.put("bufferSeconds", (int) clamp(patch.optDouble("bufferSeconds", 60), 15, 1800));
                if (!"m3u8".equals(settings.data.optString("liveFormat"))) settings.data.put("liveFormat", "ts");
                String ui = settings.data.optString("uiMode");
                if (!ui.equals("mobile") && !ui.equals("tv")) settings.data.put("uiMode", "auto");
                settings.save();
                return settings.data;
            }

            default:
                throw new Exception("unknown channel " + channel);
        }
    }

    private static double clamp(double v, double lo, double hi) {
        return Math.min(hi, Math.max(lo, v));
    }
}
