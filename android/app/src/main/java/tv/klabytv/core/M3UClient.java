package tv.klabytv.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * M3U playlist (a link or a file from the device) answering like an Xtream server — port of
 * src/main/m3u.js. Channels / movies / series are told apart from the links and the names.
 */
public class M3UClient implements Provider {
    static final class Entry {
        String name = "", url = "", logo = "", group = "", tvgId = "", tvgName = "", ua, referrer;
    }

    private static final Pattern ATTR = Pattern.compile("([\\w-]+)=\"([^\"]*)\"");
    private static final Pattern VOD_EXT = Pattern.compile("(?i)^(mp4|mkv|avi|mov|wmv|flv|m4v|webm|mpg|mpeg|divx|xvid|3gp|vob|rmvb|m2ts|mts|ogv)$");
    private static final Pattern EPISODE = Pattern.compile("(?i)^(.*?)[\\s._\\-|:(\\[]*S(\\d{1,2})[\\s._-]*E(\\d{1,4})\\b");

    private final List<JSONObject> live = new ArrayList<>(), movie = new ArrayList<>(), series = new ArrayList<>();
    private final Map<String, JSONObject> liveCats = new LinkedHashMap<>(), movieCats = new LinkedHashMap<>(), seriesCats = new LinkedHashMap<>();
    private final Map<String, Entry> byId = new HashMap<>();
    private final Map<String, JSONObject> showInfo = new HashMap<>();
    private final Map<String, TreeMap<Integer, List<JSONObject>>> showEpisodes = new HashMap<>();
    private final String epgUrl;
    private final XmltvGuide guide;

    public M3UClient(String text, UsageTracker usage, XtreamClient.UserAgent userAgent) throws Exception {
        List<Entry> entries = new ArrayList<>();
        epgUrl = parse(text, entries);
        if (entries.isEmpty()) throw new Exception("الملف ده مش قائمة M3U أو مفيهوش قنوات");
        build(entries);
        if (!epgUrl.isEmpty()) {
            guide = new XmltvGuide(epgUrl, usage, userAgent);
            Thread t = new Thread(() -> {
                try {
                    guide.load(live);
                } catch (Exception e) {
                    System.err.println("EPG: " + e.getMessage());
                }
            }, "epg");
            t.setDaemon(true);
            t.start();
        } else guide = null;
    }

    static String id(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 6; i++) sb.append(String.format("%02x", d[i]));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    private static Map<String, String> attrs(String s) {
        Map<String, String> out = new HashMap<>();
        Matcher m = ATTR.matcher(s);
        while (m.find()) out.put(m.group(1).toLowerCase(), m.group(2).trim());
        return out;
    }

    private static String get(Map<String, String> m, String k) {
        String v = m.get(k);
        return v == null ? "" : v;
    }

    static String extOf(String url) {
        try {
            Matcher m = Pattern.compile("\\.(\\w{1,5})$").matcher(new URL(url).getPath());
            return m.find() ? m.group(1) : "";
        } catch (Exception e) {
            return "";
        }
    }

    private static String decode(String s) {
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    /** Fills entries, returns the XMLTV guide link of the playlist ("" when none). */
    static String parse(String text, List<Entry> entries) {
        String epg = "";
        Entry cur = null;
        String group = "";
        String ua = null, ref = null;
        if (text.startsWith("\uFEFF")) text = text.substring(1);
        for (String raw : text.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty()) continue;
            if (line.startsWith("#EXTM3U")) {
                Map<String, String> a = attrs(line);
                String u = get(a, "url-tvg");
                if (u.isEmpty()) u = get(a, "x-tvg-url");
                if (u.isEmpty()) u = get(a, "tvg-url");
                epg = u.split(",")[0].trim();
            } else if (line.startsWith("#EXTINF")) {
                int comma = line.indexOf(',', line.lastIndexOf('"') + 1);
                Map<String, String> a = attrs(comma > 0 ? line.substring(0, comma) : line);
                cur = new Entry();
                cur.name = comma > 0 ? line.substring(comma + 1).trim() : "";
                if (cur.name.isEmpty()) cur.name = get(a, "tvg-name");
                cur.logo = get(a, "tvg-logo");
                cur.group = get(a, "group-title");
                cur.tvgId = get(a, "tvg-id");
                cur.tvgName = get(a, "tvg-name");
            } else if (line.startsWith("#EXTGRP:")) {
                group = line.substring(8).trim();
            } else if (line.startsWith("#EXTVLCOPT:")) {
                String opt = line.substring(11);
                int eq = opt.indexOf('=');
                if (eq > 0) {
                    String k = opt.substring(0, eq).trim().toLowerCase();
                    String v = opt.substring(eq + 1).trim();
                    if (k.equals("http-user-agent")) ua = v;
                    if (k.equals("http-referrer") || k.equals("http-referer")) ref = v;
                }
            } else if (!line.startsWith("#")) {
                if (line.matches("(?i)^(https?|rtmp|rtsp|udp)://.*")) {
                    Entry e = cur == null ? new Entry() : cur;
                    String[] parts = line.split("\\|", 2);
                    e.url = parts[0].trim();
                    e.ua = ua;
                    e.referrer = ref;
                    if (parts.length > 1) {
                        for (String p : parts[1].split("&")) {
                            String[] kv = p.split("=", 2);
                            String v = kv.length > 1 ? decode(kv[1]) : "";
                            if (kv[0].equalsIgnoreCase("user-agent")) e.ua = v;
                            if (kv[0].equalsIgnoreCase("referer") || kv[0].equalsIgnoreCase("referrer")) e.referrer = v;
                        }
                    }
                    if (e.group.isEmpty()) e.group = group;
                    if (e.name.isEmpty()) {
                        String[] seg = e.url.split("\\?")[0].split("/");
                        e.name = decode(seg[seg.length - 1].replaceAll("\\.\\w{1,5}$", ""));
                    }
                    entries.add(e);
                }
                cur = null;
                ua = null;
                ref = null;
            }
        }
        return epg;
    }

    private static String cat(Map<String, JSONObject> cats, String kind, String name) throws Exception {
        String n = name.isEmpty() ? "Other" : name;
        String key = id(kind + ":" + n);
        if (!cats.containsKey(key)) cats.put(key, new JSONObject().put("category_id", key).put("category_name", n).put("parent_id", 0));
        return key;
    }

    private void build(List<Entry> entries) throws Exception {
        int num = 0;
        int n = entries.size();
        for (int i = 0; i < n; i++) {
            Entry e = entries.get(i);
            String lower = e.url.toLowerCase();
            String ext = extOf(e.url);
            boolean vod = VOD_EXT.matcher(ext).matches() || Pattern.compile("/(movies?|vod|series)/").matcher(lower).find();
            String sid = id(e.url);
            if (!vod) {
                byId.put("live:" + sid, e);
                live.add(new JSONObject().put("num", ++num).put("stream_id", sid).put("name", e.name).put("stream_icon", e.logo)
                    .put("category_id", cat(liveCats, "live", e.group)).put("epg_channel_id", e.tvgId).put("ext", ext.toLowerCase().matches("m3u8?") ? "m3u8" : "ts"));
                continue;
            }
            Matcher m = EPISODE.matcher(e.name);
            boolean ep = m.find();
            if (!ep && !lower.contains("/series/")) {
                byId.put("movie:" + sid, e);
                movie.add(new JSONObject().put("stream_id", sid).put("name", e.name).put("stream_icon", e.logo).put("category_id", cat(movieCats, "movie", e.group))
                    .put("container_extension", ext).put("added", String.valueOf(n - i)).put("rating", ""));
                continue;
            }
            String show = ep ? m.group(1).replaceAll("[\\s._\\-|:(\\[]+$", "").trim() : "";
            if (show.isEmpty()) show = e.group.isEmpty() ? e.name : e.group;
            int season = ep ? Integer.parseInt(m.group(2)) : 1;
            int number = ep ? Integer.parseInt(m.group(3)) : 0;
            String title = ep ? e.name.substring(m.end()).replaceAll("^[\\s._\\-|:)\\]]+", "").trim() : e.name;
            String showId = id("series:" + show.toLowerCase());
            if (!showInfo.containsKey(showId)) {
                String c = cat(seriesCats, "series", e.group);
                showInfo.put(showId, new JSONObject().put("name", show).put("cover", e.logo).put("plot", "").put("genre", "").put("category_id", c));
                showEpisodes.put(showId, new TreeMap<>());
                series.add(new JSONObject().put("series_id", showId).put("name", show).put("cover", e.logo).put("category_id", c)
                    .put("last_modified", String.valueOf(n - i)).put("rating", ""));
            }
            List<JSONObject> list = showEpisodes.get(showId).get(season);
            if (list == null) showEpisodes.get(showId).put(season, list = new ArrayList<>());
            byId.put("series:" + sid, e);
            list.add(new JSONObject().put("id", sid).put("episode_num", number > 0 ? number : list.size() + 1).put("title", title)
                .put("container_extension", ext).put("season", season).put("info", new JSONObject().put("movie_image", e.logo)));
        }
        for (TreeMap<Integer, List<JSONObject>> seasons : showEpisodes.values()) {
            for (List<JSONObject> list : seasons.values()) list.sort((a, b) -> Integer.compare(a.optInt("episode_num"), b.optInt("episode_num")));
        }
    }

    private static String list(List<JSONObject> items, JSONObject params) {
        String cat = params == null ? "" : params.optString("category_id", "");
        JSONArray out = new JSONArray();
        for (JSONObject x : items) if (cat.isEmpty() || cat.equals(x.optString("category_id"))) out.put(x);
        return out.toString();
    }

    private static String values(Map<String, JSONObject> m) {
        return new JSONArray(m.values()).toString();
    }

    @Override
    public String call(String action, JSONObject params) throws Exception {
        if (params == null) params = new JSONObject();
        switch (action == null ? "" : action) {
            case "get_live_categories": return values(liveCats);
            case "get_vod_categories": return values(movieCats);
            case "get_series_categories": return values(seriesCats);
            case "get_live_streams": return list(live, params);
            case "get_vod_streams": return list(movie, params);
            case "get_series": return list(series, params);
            case "get_series_info": {
                String sid = params.optString("series_id");
                JSONObject info = showInfo.get(sid);
                if (info == null) return "{\"info\":{},\"episodes\":{},\"seasons\":[]}";
                JSONObject eps = new JSONObject();
                JSONArray seasons = new JSONArray();
                for (Map.Entry<Integer, List<JSONObject>> s : showEpisodes.get(sid).entrySet()) {
                    eps.put(String.valueOf(s.getKey()), new JSONArray(s.getValue()));
                    seasons.put(new JSONObject().put("season_number", s.getKey()).put("name", ""));
                }
                return new JSONObject().put("info", info).put("episodes", eps).put("seasons", seasons).toString();
            }
            case "get_vod_info": {
                String vid = params.optString("vod_id");
                for (JSONObject m : movie) {
                    if (!vid.equals(m.optString("stream_id"))) continue;
                    return new JSONObject()
                        .put("info", new JSONObject().put("name", m.optString("name")).put("movie_image", m.optString("stream_icon")))
                        .put("movie_data", new JSONObject().put("stream_id", vid).put("name", m.optString("name")).put("container_extension", m.optString("container_extension")))
                        .toString();
                }
                return "{\"info\":{}}";
            }
            case "get_short_epg": {
                String chId = params.optString("stream_id");
                JSONArray listings = new JSONArray();
                if (guide != null) {
                    for (JSONObject c : live) if (chId.equals(c.optString("stream_id"))) listings = guide.now(c, params.optInt("limit", 2));
                }
                return new JSONObject().put("epg_listings", listings).toString();
            }
            default:
                return "[]";
        }
    }

    @Override
    public JSONObject login() throws Exception {
        return new JSONObject()
            .put("type", "m3u")
            .put("user_info", new JSONObject().put("auth", 1).put("status", "Active").put("exp_date", JSONObject.NULL).put("max_connections", JSONObject.NULL).put("active_cons", JSONObject.NULL))
            .put("m3u", new JSONObject().put("live", live.size()).put("movie", movie.size()).put("series", series.size()).put("epg", !epgUrl.isEmpty()));
    }

    private Entry entry(String kind, String id) throws Exception {
        Entry e = byId.get(kind + ":" + id);
        if (e == null) throw new Exception("المحتوى غير موجود على السيرفر.");
        return e;
    }

    @Override
    public String streamUrl(String kind, String id, String ext) throws Exception {
        return entry(kind, id).url;
    }

    @Override
    public Map<String, String> headersFor(String kind, String id) throws Exception {
        Entry e = entry(kind, id);
        Map<String, String> h = new HashMap<>();
        if (e.ua != null && !e.ua.isEmpty()) h.put("User-Agent", e.ua);
        if (e.referrer != null && !e.referrer.isEmpty()) h.put("Referer", e.referrer);
        return h;
    }
}
