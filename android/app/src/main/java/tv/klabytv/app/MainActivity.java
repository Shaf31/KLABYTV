package tv.klabytv.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.webkit.ValueCallback;
import android.widget.Toast;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import tv.klabytv.core.AppCore;

/** The app: the same web UI as the desktop version, in a WebView, with the native core behind it. */
public class MainActivity extends Activity {
    private static final int REQ_PLAYER = 1;
    private static final int REQ_FILE = 2;
    private static final String START_URL = "https://appassets.androidplatform.net/assets/www/src/renderer/index.html";

    private WebView web;
    private Bridge bridge;
    private AppCore core;
    private boolean isTv;
    private ValueCallback<Uri[]> fileCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        core = Core.get(this);
        isTv = "tv".equals(Core.formFactor(this));
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // localStorage: resume points, continue watching
        s.setMediaPlaybackRequiresUserGesture(false);
        // the page is https://appassets..., streams come from the local proxy on http://127.0.0.1
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setSupportZoom(false);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // the app's own page may load again (language change); never navigate anywhere else
                return !"appassets.androidplatform.net".equals(request.getUrl().getHost());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // <input type=file> (M3U playlist from the device)
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(pick, null), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "ar".equals(java.util.Locale.getDefault().getLanguage()) ? "مفيش مدير ملفات على الجهاز" : "No file manager on this device", Toast.LENGTH_LONG).show();
                    return false;
                }
                return true;
            }
        });

        bridge = new Bridge(this, web, core);
        web.addJavascriptInterface(bridge, "AndroidBridge");
        web.loadUrl(START_URL);
    }

    void reloadPage() {
        web.loadUrl(START_URL);
    }

    /** Android back / TV remote back: the page goes back; at the first screen the app goes to the background. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.__androidBack ? window.__androidBack() : false", (handled) -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        bridge.emit("window-state", "\"hidden\""); // data saver: the player stops while the app is away
    }

    @Override
    protected void onResume() {
        super.onResume();
        bridge.emit("window-state", "\"shown\"");
    }

    @Override
    protected void onStop() {
        super.onStop();
        core.usage().flush();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** Web player open: landscape on phones, full screen, screen stays on. */
    void setPlayerMode(boolean on) {
        if (!isTv) setRequestedOrientation(on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setImmersive(this, on);
    }

    @SuppressWarnings("deprecation")
    static void setImmersive(Activity a, boolean on) {
        View decor = a.getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = decor.getWindowInsetsController();
            if (c == null) return;
            if (on) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else c.show(WindowInsets.Type.systemBars());
        } else {
            decor.setSystemUiVisibility(on
                ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                : 0);
        }
    }

    @SuppressWarnings("deprecation")
    void openNativePlayer(JSONObject item, JSONObject opened) {
        Intent i = new Intent(this, PlayerActivity.class);
        i.putExtra("url", opened.optString("url"));
        i.putExtra("sid", opened.optString("sid"));
        i.putExtra("title", item.optString("title"));
        i.putExtra("kind", item.optString("kind"));
        i.putExtra("id", item.optString("id"));
        i.putExtra("ext", item.optString("ext"));
        i.putExtra("pos", item.optDouble("pos", 0));
        i.putExtra("lang", item.optString("lang", "ar"));
        startActivityForResult(i, REQ_PLAYER);
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        if (requestCode != REQ_PLAYER || data == null) return;
        try {
            JSONObject o = new JSONObject()
                .put("kind", data.getStringExtra("kind"))
                .put("id", data.getStringExtra("id"))
                .put("pos", data.getDoubleExtra("pos", 0))
                .put("dur", data.getDoubleExtra("dur", 0))
                .put("session", data.getStringExtra("session") == null ? JSONObject.NULL : new JSONObject(data.getStringExtra("session")));
            bridge.emit("native-player-closed", o.toString());
        } catch (Exception ignored) { }
    }
}
