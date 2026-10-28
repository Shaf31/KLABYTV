package tv.klabytv.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * XMLTV guide of an M3U playlist: now / next per channel — port of src/main/xmltv.js. Read as a
 * stream; only programmes of the playlist's channels, from an hour ago to 36 hours ahead, are kept.
 */
public class XmltvGuide {
    private static final class Prog {
        long start, stop;
        String title, desc;
    }

    private static final Pattern TIME = Pattern.compile("^(\\d{4})(\\d\\d)(\\d\\d)(\\d\\d)(\\d\\d)(\\d\\d)?\\s*([+-]\\d{4})?");
    private final String url;
    private final UsageTracker usage;
    private final XtreamClient.UserAgent userAgent;
    private final Map<String, List<Prog>> programmes = new HashMap<>();
    private final Map<String, String> names = new HashMap<>();

    XmltvGuide(String url, UsageTracker usage, XtreamClient.UserAgent userAgent) {
        this.url = url;
        this.usage = usage;
        this.userAgent = userAgent;
    }

    static long time(String s) {
        Matcher m = TIME.matcher(s == null ? "" : s);
        if (!m.find()) return -1;
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        c.clear();
        c.set(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)) - 1, Integer.parseInt(m.group(3)), Integer.parseInt(m.group(4)), Integer.parseInt(m.group(5)),
            m.group(6) == null ? 0 : Integer.parseInt(m.group(6)));
        long t = c.getTimeInMillis();
        if (m.group(7) != null) {
            String z = m.group(7);
            long off = (Integer.parseInt(z.substring(1, 3)) * 60L + Integer.parseInt(z.substring(3))) * 60_000L;
            t -= z.charAt(0) == '-' ? -off : off;
        }
        return t;
    }

    static String unescape(String s) {
        s = s.replaceAll("(?s)<!\\[CDATA\\[(.*?)\\]\\]>", "$1");
        Matcher m = Pattern.compile("&(#x[\\da-fA-F]+|#\\d+|\\w+);").matcher(s);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String e = m.group(1);
            String r;
            if (e.startsWith("#x") || e.startsWith("#X")) r = new String(Character.toChars(Integer.parseInt(e.substring(2), 16)));
            else if (e.startsWith("#")) r = new String(Character.toChars(Integer.parseInt(e.substring(1))));
            else if (e.equals("amp")) r = "&";
            else if (e.equals("lt")) r = "<";
            else if (e.equals("gt")) r = ">";
            else if (e.equals("quot")) r = "\"";
            else if (e.equals("apos")) r = "'";
            else r = m.group(0);
            m.appendReplacement(sb, Matcher.quoteReplacement(r));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String norm(String s) {
        return s == null ? "" : s.toLowerCase().replaceAll("\\s+", " ").trim();
    }

    private static String find(String block, String re) {
        Matcher m = Pattern.compile(re).matcher(block);
        return m.find() ? m.group(1) : null;
    }

    /** Counts the downloaded bytes into the data usage. */
    private class Counted extends java.io.FilterInputStream {
        Counted(InputStream in) {
            super(in);
        }

        @Override
        public int read(byte[] b, int off, int len) throws java.io.IOException {
            int n = super.read(b, off, len);
            if (n > 0) usage.add("", n);
            return n;
        }
    }

    void load(List<JSONObject> channels) throws Exception {
        Set<String> wanted = new HashSet<>();
        Map<String, Boolean> byName = new HashMap<>();
        for (JSONObject c : channels) {
            if (!c.optString("epg_channel_id").isEmpty()) wanted.add(c.optString("epg_channel_id"));
            byName.put(norm(c.optString("name")), true);
        }
        HttpURLConnection conn = XtreamClient.Http.open(url, userAgent.get(), null, 120_000);
        if (conn.getResponseCode() >= 400) throw new Exception("HTTP " + conn.getResponseCode());
        InputStream in = new BufferedInputStream(new Counted(conn.getInputStream()));
        in.mark(2);
        boolean gz = in.read() == 0x1f && in.read() == 0x8b;
        in.reset();
        if (gz) in = new GZIPInputStream(in, 64 * 1024);
        long from = System.currentTimeMillis() - 3_600_000L;
        long to = System.currentTimeMillis() + 36 * 3_600_000L;
        Map<String, List<Prog>> found = new HashMap<>();
        try (Reader r = new InputStreamReader(in, StandardCharsets.UTF_8)) {
            StringBuilder buf = new StringBuilder();
            char[] chunk = new char[64 * 1024];
            int n;
            while ((n = r.read(chunk)) > 0) {
                buf.append(chunk, 0, n);
                int pos = 0;
                while (true) {
                    int pi = buf.indexOf("<programme", pos);
                    int ci = buf.indexOf("<channel", pos);
                    int start = pi < 0 ? ci : ci < 0 ? pi : Math.min(pi, ci);
                    if (start < 0) {
                        pos = Math.max(pos, buf.length() - 16);
                        break;
                    }
                    boolean prog = start == pi;
                    int end = buf.indexOf(prog ? "</programme>" : "</channel>", start);
                    if (end < 0) {
                        pos = start;
                        break;
                    }
                    String block = buf.substring(start, end);
                    pos = end + 1;
                    if (prog) {
                        String ch = find(block, "channel=\"([^\"]*)\"");
                        if (ch == null || !wanted.contains(ch)) continue;
                        long a = time(find(block, "start=\"([^\"]*)\""));
                        long b = time(find(block, "stop=\"([^\"]*)\""));
                        if (!(b > from && a < to)) continue;
                        Prog p = new Prog();
                        p.start = a;
                        p.stop = b;
                        String t = find(block, "(?s)<title[^>]*>(.*?)</title>");
                        String d = find(block, "(?s)<desc[^>]*>(.*?)</desc>");
                        p.title = t == null ? "" : unescape(t).trim();
                        p.desc = d == null ? "" : unescape(d).trim();
                        List<Prog> list = found.get(ch);
                        if (list == null) found.put(ch, list = new ArrayList<>());
                        list.add(p);
                    } else {
                        // channels without tvg-id are matched to the guide by name
                        String chId = find(block, "id=\"([^\"]*)\"");
                        Matcher dn = Pattern.compile("(?s)<display-name[^>]*>(.*?)</display-name>").matcher(block);
                        while (chId != null && dn.find()) {
                            String name = norm(unescape(dn.group(1)));
                            if (byName.containsKey(name)) {
                                synchronized (this) {
                                    names.put(name, unescape(chId));
                                }
                                wanted.add(unescape(chId));
                            }
                        }
                    }
                }
                buf.delete(0, pos);
                if (buf.length() > 4_000_000) buf.delete(0, buf.length() - 1_000_000); // broken file
            }
        } finally {
            conn.disconnect();
        }
        for (List<Prog> list : found.values()) list.sort((x, y) -> Long.compare(x.start, y.start));
        synchronized (this) {
            programmes.putAll(found);
        }
    }

    /** Xtream get_short_epg listings (titles base64 like Xtream servers send them). */
    synchronized JSONArray now(JSONObject channel, int limit) throws Exception {
        List<Prog> list = programmes.get(channel.optString("epg_channel_id"));
        if (list == null) {
            String id = names.get(norm(channel.optString("name")));
            list = id == null ? null : programmes.get(id);
        }
        JSONArray out = new JSONArray();
        if (list == null) return out;
        long t = System.currentTimeMillis();
        for (Prog p : list) {
            if (p.stop <= t) continue;
            if (out.length() >= limit) break;
            out.put(new JSONObject()
                .put("title", b64(p.title))
                .put("description", b64(p.desc))
                .put("start_timestamp", String.valueOf(p.start / 1000))
                .put("stop_timestamp", String.valueOf(p.stop / 1000)));
        }
        return out;
    }

    private static String b64(String s) {
        byte[] b = s.getBytes(StandardCharsets.UTF_8);
        // java.util.Base64 is API 26+; minSdk is 24
        final char[] A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < b.length; i += 3) {
            int v = (b[i] & 0xff) << 16 | (i + 1 < b.length ? (b[i + 1] & 0xff) << 8 : 0) | (i + 2 < b.length ? b[i + 2] & 0xff : 0);
            sb.append(A[v >> 18 & 63]).append(A[v >> 12 & 63]).append(i + 1 < b.length ? A[v >> 6 & 63] : '=').append(i + 2 < b.length ? A[v & 63] : '=');
        }
        return sb.toString();
    }
}
