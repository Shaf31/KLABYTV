package tv.klabytv.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import org.json.JSONObject;

import tv.klabytv.core.AppCore;

/**
 * Native player (Media3/ExoPlayer) for streams the web player can't decode — the Android
 * counterpart of the desktop "compatibility mode". It plays through the same local proxy, so data
 * usage, the fixed buffer and the seek step from the settings all still apply.
 */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class PlayerActivity extends Activity {
    private ExoPlayer player;
    private PlayerView view;
    private TextView message;
    private TextView seekHint;
    private long hintTotal;
    private int hintSide;
    private long sideUntil;
    private AppCore core;
    private String sid;
    private boolean live;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable reporter = new Runnable() {
        @Override
        public void run() {
            // keeps the proxy's fixed buffer in step with the position, like the web player does
            if (player != null && !live) core.reportPosition(sid, player.getCurrentPosition() / 1000.0, Math.max(0, player.getDuration()) / 1000.0);
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        core = Core.get(this);
        Intent in = getIntent();
        sid = in.getStringExtra("sid");
        live = "live".equals(in.getStringExtra("kind"));
        String ext = in.getStringExtra("ext") == null ? "" : in.getStringExtra("ext");
        JSONObject settings = core.settings();
        long stepMs = settings.optLong("seekStep", 10) * 1000;
        int bufferMs = (int) (settings.optLong("bufferSeconds", 60) * 1000);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        MainActivity.setImmersive(this, true);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        view = new PlayerView(this);
        view.setControllerShowTimeoutMs(3500);
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        root.addView(view, new FrameLayout.LayoutParams(-1, -1));

        TextView title = new TextView(this);
        title.setText(in.getStringExtra("title"));
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        title.setPadding(dp(24), dp(18), dp(24), dp(18));
        title.setShadowLayer(8, 0, 2, Color.BLACK);
        root.addView(title, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) (v) -> title.setVisibility(v));

        message = new TextView(this);
        message.setTextColor(Color.WHITE);
        message.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        message.setGravity(Gravity.CENTER);
        message.setPadding(dp(32), dp(32), dp(32), dp(32));
        root.addView(message, new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER));
        seekHint = new TextView(this);
        seekHint.setTextColor(Color.WHITE);
        seekHint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        seekHint.setShadowLayer(8, 0, 2, Color.BLACK);
        seekHint.setVisibility(android.view.View.GONE);
        root.addView(seekHint, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER_VERTICAL));
        setContentView(root);

        // Movies keep bufferSeconds ahead (settings); live keeps the player's defaults.
        DefaultLoadControl.Builder load = new DefaultLoadControl.Builder();
        if (!live) load.setBufferDurationsMs(Math.min(15_000, bufferMs), bufferMs, 2_500, 5_000);
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this).setEnableDecoderFallback(true);
        player = new ExoPlayer.Builder(this, renderers)
            .setLoadControl(load.build())
            .setSeekBackIncrementMs(stepMs)
            .setSeekForwardIncrementMs(stepMs)
            .build();
        view.setPlayer(player);
        if (!live) setupDoubleTap(stepMs);

        MediaItem.Builder item = new MediaItem.Builder().setUri(in.getStringExtra("url"));
        if ("m3u8".equalsIgnoreCase(ext)) item.setMimeType(MimeTypes.APPLICATION_M3U8);
        else if ("ts".equalsIgnoreCase(ext)) item.setMimeType(MimeTypes.VIDEO_MP2T);
        long startMs = (long) (in.getDoubleExtra("pos", 0) * 1000);
        player.setMediaItem(item.build(), live ? C.TIME_UNSET : startMs);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                message.setText(("en".equals(getIntent().getStringExtra("lang")) ? "Couldn't play the stream\n" : "تعذر تشغيل البث\n") + error.getErrorCodeName());
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) message.setText("");
                if (state == Player.STATE_ENDED && !live) finish();
            }
        });
        player.prepare();
        player.setPlayWhenReady(true);
        handler.post(reporter);
    }

    /** Double tap: right third = forward, left third = back (keep tapping to keep jumping), like the web player. */
    @SuppressWarnings("ClickableViewAccessibility")
    private void setupDoubleTap(long stepMs) {
        GestureDetector g = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            private int side(MotionEvent e) {
                float x = e.getX() / view.getWidth();
                return x < 0.33f ? -1 : x > 0.67f ? 1 : 0;
            }

            @Override
            public boolean onDown(MotionEvent e) {
                return true;
            }

            @Override
            public boolean onSingleTapUp(MotionEvent e) {
                // still tapping the same side right after a jump: keep jumping
                int s = side(e);
                if (s != 0 && s == hintSide && System.currentTimeMillis() < sideUntil) {
                    seek(s, stepMs);
                    return true;
                }
                return false;
            }

            @Override
            public boolean onSingleTapConfirmed(MotionEvent e) {
                if (System.currentTimeMillis() < sideUntil) return true;
                if (view.isControllerFullyVisible()) view.hideController();
                else view.showController();
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent e) {
                int s = side(e);
                if (s == 0) {
                    if (player != null) {
                        if (player.isPlaying()) player.pause();
                        else player.play();
                    }
                } else if (!(s == hintSide && System.currentTimeMillis() < sideUntil)) {
                    seek(s, stepMs);
                }
                return true;
            }
        });
        view.setOnTouchListener((v, e) -> g.onTouchEvent(e));
    }

    private void seek(int side, long stepMs) {
        if (player == null) return;
        long dur = player.getDuration();
        long to = Math.max(0, player.getCurrentPosition() + side * stepMs);
        if (dur > 0) to = Math.min(dur - 1000, to);
        player.seekTo(to);
        hintTotal = side == hintSide && System.currentTimeMillis() < sideUntil ? hintTotal + stepMs : stepMs;
        hintSide = side;
        sideUntil = System.currentTimeMillis() + 700;
        seekHint.setText((side > 0 ? "+" : "-") + (hintTotal / 1000) + "s");
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) seekHint.getLayoutParams();
        lp.gravity = Gravity.CENTER_VERTICAL | (side > 0 ? Gravity.RIGHT : Gravity.LEFT);
        lp.leftMargin = lp.rightMargin = dp(48);
        seekHint.setLayoutParams(lp);
        seekHint.setVisibility(android.view.View.VISIBLE);
        handler.removeCallbacks(hideHint);
        handler.postDelayed(hideHint, 800);
    }

    private final Runnable hideHint = () -> seekHint.setVisibility(android.view.View.GONE);

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    @Override
    protected void onStop() {
        super.onStop();
        // data saver: nothing keeps downloading in the background
        if (player != null && core.settings().optBoolean("pauseWhenMinimized", true)) player.pause();
    }

    @Override
    public void finish() {
        Intent out = new Intent();
        out.putExtra("kind", getIntent().getStringExtra("kind"));
        out.putExtra("id", getIntent().getStringExtra("id"));
        if (player != null) {
            out.putExtra("pos", player.getCurrentPosition() / 1000.0);
            out.putExtra("dur", Math.max(0, player.getDuration()) / 1000.0);
        }
        handler.removeCallbacks(reporter);
        if (player != null) {
            player.release();
            player = null;
        }
        JSONObject s = core.closeStream(sid);
        if (s != null) out.putExtra("session", s.toString());
        setResult(RESULT_OK, out);
        super.finish();
    }
}
