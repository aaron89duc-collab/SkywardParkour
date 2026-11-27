package com.skywardparkour.game;

import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/** Skyward Parkour: full screen (no status / navigation bar, swipe from the edge shows them for a moment),
 *  landscape (manifest), and the screen stays on while the game is open.
 *  Smoothness: the screen runs at 60 Hz (a 90/120 Hz screen the game cannot fill shows frames unevenly, and
 *  heats the phone until it slows down), sustained-performance mode where the phone has it (steady clocks
 *  instead of bursts then throttling), and the WebView's renderer keeps a high priority. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
        smoothFrames();
    }

    private void smoothFrames() {
        try {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            Display d = getWindowManager().getDefaultDisplay();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                // the 60 Hz mode with the current resolution, when the screen offers one
                Display.Mode cur = d.getMode();
                for (Display.Mode m : d.getSupportedModes()) {
                    if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight()
                            && Math.abs(m.getRefreshRate() - 60f) < 1.5f) { lp.preferredDisplayModeId = m.getModeId(); break; }
                }
            }
            lp.preferredRefreshRate = 60f;
            getWindow().setAttributes(lp);
        } catch (Exception ignored) { }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                if (pm != null && pm.isSustainedPerformanceModeSupported()) getWindow().setSustainedPerformanceMode(true);
            }
        } catch (Exception ignored) { }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WebView wv = getBridge().getWebView();
                if (wv != null) wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
            }
        } catch (Exception ignored) { }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
