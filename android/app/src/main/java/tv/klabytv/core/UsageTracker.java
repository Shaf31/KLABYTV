package tv.klabytv.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Every byte the player downloads, per viewing session and per day (port of src/main/usage.js). */
public class UsageTracker {
    private static final int MAX_SESSIONS = 2000;
    private final JsonStore store;
    private final Map<String, JSONObject> active = new HashMap<>();
    private boolean dirty = false;
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor((r) -> {
        Thread t = new Thread(r, "usage-flush");
        t.setDaemon(true);
        return t;
    });

    public UsageTracker(File file) {
        JSONObject defaults = new JSONObject();
        try {
            defaults.put("days", new JSONObject());
            defaults.put("sessions", new JSONArray());
        } catch (Exception ignored) { }
        store = new JsonStore(file, defaults);
        timer.scheduleWithFixedDelay(this::flush, 10, 10, TimeUnit.SECONDS);
    }

    static String dayKey(long ts) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(ts));
    }

    public synchronized JSONObject startSession(String title, String kind, String streamId) {
        try {
            JSONObject s = new JSONObject();
            long now = System.currentTimeMillis();
            s.put("id", UUID.randomUUID().toString());
            s.put("title", title == null ? "" : title);
            s.put("kind", kind == null ? "live" : kind);
            s.put("streamId", streamId == null ? JSONObject.NULL : streamId);
            s.put("start", now);
            s.put("end", now);
            s.put("bytes", 0L);
            active.put(s.getString("id"), s);
            JSONArray old = store.data.getJSONArray("sessions");
            JSONArray list = new JSONArray();
            list.put(s);
            for (int i = 0; i < old.length() && list.length() < MAX_SESSIONS; i++) list.put(old.get(i));
            store.data.put("sessions", list);
            dirty = true;
            return s;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    /** bytes for a session (sid) or, without a live session, for "other" (API calls, posters). */
    public synchronized void add(String sid, long n) {
        if (n <= 0) return;
        try {
            long now = System.currentTimeMillis();
            JSONObject days = store.data.getJSONObject("days");
            String key = dayKey(now);
            JSONObject day = days.optJSONObject(key);
            if (day == null) {
                day = new JSONObject().put("video", 0L).put("other", 0L);
                days.put(key, day);
            }
            JSONObject s = sid == null || sid.isEmpty() ? null : active.get(sid);
            if (s != null) {
                s.put("bytes", s.getLong("bytes") + n);
                s.put("end", now);
                day.put("video", day.getLong("video") + n);
            } else {
                day.put("other", day.getLong("other") + n);
            }
            dirty = true;
        } catch (Exception ignored) { }
    }

    public synchronized JSONObject get(String sid) {
        JSONObject s = sid == null ? null : active.get(sid);
        if (s == null) return null;
        try {
            return new JSONObject(s.toString()).put("now", System.currentTimeMillis());
        } catch (Exception e) {
            return null;
        }
    }

    public synchronized String kindOf(String sid) {
        JSONObject s = sid == null ? null : active.get(sid);
        return s == null ? null : s.optString("kind", null);
    }

    public synchronized JSONObject endSession(String sid) {
        JSONObject s = sid == null ? null : active.remove(sid);
        if (s == null) return null;
        try {
            s.put("end", System.currentTimeMillis());
            if (s.getLong("bytes") == 0) {
                // nothing played (bad link, instant back): don't clutter the history
                JSONArray old = store.data.getJSONArray("sessions");
                JSONArray list = new JSONArray();
                for (int i = 0; i < old.length(); i++) {
                    JSONObject x = old.getJSONObject(i);
                    if (!sid.equals(x.optString("id"))) list.put(x);
                }
                store.data.put("sessions", list);
            }
            dirty = true;
            JSONObject copy = new JSONObject(s.toString());
            flush();
            return copy;
        } catch (Exception e) {
            return null;
        }
    }

    /** JSON text: { days, sessions, activeIds }. */
    public synchronized String summaryJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("days", store.data.getJSONObject("days"));
            o.put("sessions", store.data.getJSONArray("sessions"));
            o.put("activeIds", new JSONArray(active.keySet()));
            return o.toString();
        } catch (Exception e) {
            return "{\"days\":{},\"sessions\":[],\"activeIds\":[]}";
        }
    }

    public synchronized void clear() {
        try {
            JSONArray keep = new JSONArray();
            for (JSONObject s : active.values()) keep.put(s);
            store.data.put("days", new JSONObject());
            store.data.put("sessions", keep);
        } catch (Exception ignored) { }
        dirty = true;
        flush();
    }

    public synchronized void flush() {
        if (!dirty) return;
        dirty = false;
        store.save();
    }

    public synchronized void closeAll() {
        for (String sid : active.keySet().toArray(new String[0])) endSession(sid);
        flush();
    }
}
