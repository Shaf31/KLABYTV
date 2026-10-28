package tv.klabytv.app;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import tv.klabytv.core.AppCore;

/**
 * window.AndroidBridge for the web UI (see src/renderer/android-bridge.js). Calls run off the UI
 * thread; the answer goes back with window.__bridge.resolve(id, { ok, data | error }).
 */
public class Bridge {
    private final MainActivity activity;
    private final WebView web;
    private final AppCore core;
    private final ExecutorService exec = Executors.newCachedThreadPool();

    Bridge(MainActivity activity, WebView web, AppCore core) {
        this.activity = activity;
        this.web = web;
        this.core = core;
    }

    @JavascriptInterface
    public void call(String id, String channel, String argsJson) {
        exec.submit(() -> {
            String result;
            try {
                Object data = handle(channel, new JSONArray(argsJson));
                result = "{\"ok\":true,\"data\":" + toJson(data) + "}";
            } catch (Throwable e) {
                String msg = e.getMessage() == null ? e.toString() : e.getMessage();
                result = "{\"ok\":false,\"error\":" + JSONObject.quote(msg) + "}";
            }
            String js = "window.__bridge&&window.__bridge.resolve(" + JSONObject.quote(id) + "," + result + ")";
            web.post(() -> web.evaluateJavascript(js, null));
        });
    }

    private Object handle(String channel, JSONArray args) throws Exception {
        switch (channel) {
            case "native:play": {
                // Native Media3 player for what the web player can't decode (MKV, AC3/DTS, HEVC ...)
                JSONObject o = args.getJSONObject(0);
                JSONObject opened = core.openStream(o);
                activity.runOnUiThread(() -> activity.openNativePlayer(o, opened));
                return opened;
            }
            case "app:reload": // language changed: load the page again from the native side
                activity.runOnUiThread(activity::reloadPage);
                return null;
            case "ui:player":
                activity.runOnUiThread(() -> activity.setPlayerMode(args.optBoolean(0)));
                return null;
            default:
                return core.handle(channel, args);
        }
    }

    private static String toJson(Object o) {
        if (o == null) return "null";
        if (o instanceof AppCore.Raw) return ((AppCore.Raw) o).json;
        if (o instanceof JSONObject || o instanceof JSONArray) return o.toString();
        if (o instanceof String) return JSONObject.quote((String) o);
        return String.valueOf(o);
    }

    /** Event to the page: window.__bridge.emit(name, data). */
    void emit(String event, String jsonData) {
        String js = "window.__bridge&&window.__bridge.emit(" + JSONObject.quote(event) + "," + (jsonData == null ? "null" : jsonData) + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }
}
