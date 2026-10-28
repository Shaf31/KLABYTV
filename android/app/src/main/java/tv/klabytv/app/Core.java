package tv.klabytv.app;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.provider.Settings;

import tv.klabytv.core.AppCore;

/** One AppCore for the whole process (shared by the web UI and the native player). */
public final class Core {
    private static AppCore core;

    private Core() { }

    public static synchronized AppCore get(Context ctx) {
        if (core == null) {
            Context app = ctx.getApplicationContext();
            try {
                core = new AppCore(app.getFilesDir(), new KeystoreCrypto(), deviceName(app), formFactor(app));
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        return core;
    }

    /**
     * Phone app: always "phone" (mobile layout). TV app: "tv" on Android TV / Google TV / TV boxes,
     * "tablet" on touch screens (TV layout with touch).
     */
    public static String formFactor(Context ctx) {
        if ("phone".equals(tv.klabytv.BuildConfig.FLAVOR)) return "phone";
        UiModeManager ui = (UiModeManager) ctx.getSystemService(Context.UI_MODE_SERVICE);
        PackageManager pm = ctx.getPackageManager();
        if ((ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION)
            || pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
            || !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)) return "tv";
        return "tablet";
    }

    static String deviceName(Context ctx) {
        String name = null;
        try {
            name = Settings.Global.getString(ctx.getContentResolver(), "device_name");
        } catch (Exception ignored) { }
        if (name == null || name.trim().isEmpty()) {
            String model = Build.MODEL == null ? "" : Build.MODEL;
            String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
            name = model.toLowerCase().startsWith(maker.toLowerCase()) ? model : maker + " " + model;
        }
        return name.trim();
    }
}
