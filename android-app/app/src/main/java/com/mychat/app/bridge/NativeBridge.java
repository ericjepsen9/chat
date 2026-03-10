package com.mychat.app.bridge;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.mychat.app.ChatApplication;
import com.mychat.app.MainActivity;
import com.mychat.app.call.CallNotificationHelper;
import com.mychat.app.call.CallService;

/**
 * JavaScript bridge between H5 and Android native layer.
 *
 * In H5, call via: window.NativeBridge.methodName(args)
 *
 * Available methods:
 * - bindPushAlias(userId)     — bind EMAS push to user
 * - unbindPushAlias(userId)   — unbind push on logout
 * - startCallService(name, mode) — start foreground service during call
 * - stopCallService()         — stop foreground service
 * - dismissCallNotification() — dismiss incoming call notification
 * - vibrate(ms)               — trigger device vibration
 * - copyToClipboard(text)     — copy text to clipboard
 * - getDeviceInfo()           — get device info JSON
 * - openSystemSettings()      — open app settings page
 * - hasOverlayPermission()    — check overlay permission
 * - getPushDeviceId()         — get EMAS device ID
 */
public class NativeBridge {

    private static final String TAG = "NativeBridge";
    private final MainActivity activity;
    private final WebView webView;

    public NativeBridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    // ========== Push ==========

    @JavascriptInterface
    public void bindPushAlias(String userId) {
        Log.i(TAG, "bindPushAlias: " + userId);
        ChatApplication.bindPushAlias(userId);
    }

    @JavascriptInterface
    public void unbindPushAlias(String userId) {
        Log.i(TAG, "unbindPushAlias: " + userId);
        ChatApplication.unbindPushAlias(userId);
    }

    @JavascriptInterface
    public String getPushDeviceId() {
        try {
            return com.alibaba.sdk.android.push.noonesdk.PushServiceFactory
                    .getCloudPushService().getDeviceId();
        } catch (Exception e) {
            return "";
        }
    }

    // ========== Call ==========

    @JavascriptInterface
    public void startCallService(String peerName, String mode) {
        Log.i(TAG, "startCallService: " + peerName + ", mode=" + mode);
        // Ensure overlay permission for incoming call screen (request on demand, not at startup)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(activity)) {
            activity.requestOverlayPermission();
        }
        CallService.start(activity, peerName, mode);
    }

    @JavascriptInterface
    public void stopCallService() {
        Log.i(TAG, "stopCallService");
        CallService.stop(activity);
        CallNotificationHelper.dismissIncomingCallNotification(activity);
    }

    @JavascriptInterface
    public void dismissCallNotification() {
        CallNotificationHelper.dismissIncomingCallNotification(activity);
    }

    // ========== Device ==========

    @JavascriptInterface
    public void vibrate(int milliseconds) {
        Vibrator v;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            v = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (v == null || !v.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            v.vibrate(milliseconds);
        }
    }

    @JavascriptInterface
    public void copyToClipboard(String text) {
        ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) {
            cm.setPrimaryClip(ClipData.newPlainText("ChatTrade", text));
        }
    }

    @JavascriptInterface
    public String getDeviceInfo() {
        return "{" +
                "\"platform\":\"android\"," +
                "\"sdkVersion\":" + Build.VERSION.SDK_INT + "," +
                "\"manufacturer\":\"" + Build.MANUFACTURER + "\"," +
                "\"model\":\"" + Build.MODEL + "\"," +
                "\"appVersion\":\"1.0.0\"" +
                "}";
    }

    @JavascriptInterface
    public boolean hasOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return Settings.canDrawOverlays(activity);
        }
        return true;
    }

    @JavascriptInterface
    public void openSystemSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + activity.getPackageName()));
        activity.startActivity(intent);
    }

    @JavascriptInterface
    public void openOverlaySettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(intent);
        }
    }

    // ========== Permissions ==========

    @JavascriptInterface
    public boolean hasCameraPermission() {
        return ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public boolean hasMicrophonePermission() {
        return ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void requestCameraPermission() {
        activity.runOnUiThread(() ->
            ActivityCompat.requestPermissions(activity,
                    new String[]{Manifest.permission.CAMERA}, 2001));
    }

    @JavascriptInterface
    public void requestMicrophonePermission() {
        activity.runOnUiThread(() ->
            ActivityCompat.requestPermissions(activity,
                    new String[]{Manifest.permission.RECORD_AUDIO}, 2002));
    }

    @JavascriptInterface
    public void requestCameraAndMicrophonePermission() {
        activity.runOnUiThread(() ->
            ActivityCompat.requestPermissions(activity,
                    new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, 2003));
    }

    // ========== Callback to JS ==========

    /**
     * Execute JavaScript in WebView from native side.
     * Used for native → H5 communication.
     */
    public void callJS(String script) {
        activity.runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    /**
     * Notify H5 about incoming call action from native call screen
     */
    public void notifyCallAction(String action, String callerId, String conversationId, String callId) {
        String js = String.format(
                "if(window.__onNativeCallAction) window.__onNativeCallAction('%s','%s','%s','%s');",
                escapeJS(action), escapeJS(callerId), escapeJS(conversationId), escapeJS(callId));
        callJS(js);
    }

    private static String escapeJS(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n");
    }
}
