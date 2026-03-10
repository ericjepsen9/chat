package com.mychat.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import com.mychat.app.bridge.NativeBridge;
import com.mychat.app.call.CallService;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MainActivity";
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final int WEBRTC_PERMISSION_REQUEST_CODE = 1002;

    /** Replace with your server URL */
    private static final String WEB_URL = "https://chat.yimeiai.sbs";

    private WebView webView;
    private NativeBridge nativeBridge;
    private ValueCallback<Uri[]> fileUploadCallback;
    private PermissionRequest pendingWebRtcRequest;
    private String[] pendingWebRtcResources;
    private boolean webViewReady = false;
    private Intent pendingActionIntent = null;

    /** Receives hangup broadcast from CallService notification action */
    private final BroadcastReceiver hangupReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (webView != null) {
                webView.evaluateJavascript(
                        "if(document.getElementById('hangupBtn')) document.getElementById('hangupBtn').click();",
                        null);
            }
        }
    };

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (fileUploadCallback == null) return;
                Uri[] uris = null;
                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    // Handle multi-file selection
                    if (result.getData().getClipData() != null) {
                        int count = result.getData().getClipData().getItemCount();
                        uris = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            uris[i] = result.getData().getClipData().getItemAt(i).getUri();
                        }
                    } else {
                        // Single file selection
                        String dataString = result.getData().getDataString();
                        if (dataString != null) {
                            uris = new Uri[]{Uri.parse(dataString)};
                        }
                    }
                }
                fileUploadCallback.onReceiveValue(uris);
                fileUploadCallback = null;
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Edge-to-edge display
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true);

        // Keep screen on during active use
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.webView);

        setupWebView();
        requestPermissions();
        setupBackNavigation();

        webView.loadUrl(WEB_URL);

        // Handle call action if launched from IncomingCallActivity
        handleCallActionIntent(getIntent());

        // Listen for hangup from notification bar
        LocalBroadcastManager.getInstance(this).registerReceiver(
                hangupReceiver,
                new IntentFilter(CallService.ACTION_HANGUP_FROM_NOTIFICATION));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();

        // JavaScript
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // Media
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);

        // Cache
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Viewport
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        // Mixed content (allow HTTP in WebView if needed)
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Geolocation
        settings.setGeolocationEnabled(true);

        // JS bridge — allows H5 to call native methods via window.NativeBridge
        nativeBridge = new NativeBridge(this, webView);
        webView.addJavascriptInterface(nativeBridge, "NativeBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // External links open in browser
                if (!url.startsWith(WEB_URL)) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, request.getUrl());
                    startActivity(intent);
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inject native bridge availability flag
                view.evaluateJavascript(
                        "window.__NATIVE_ANDROID__ = true; " +
                        "if (window.__onNativeBridgeReady) window.__onNativeBridgeReady();",
                        null);
                // Process any pending action intent that arrived before page was ready
                webViewReady = true;
                if (pendingActionIntent != null) {
                    handleCallActionIntent(pendingActionIntent);
                    pendingActionIntent = null;
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // Handle file upload (<input type="file">)
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = callback;
                Intent intent = params.createIntent();
                fileChooserLauncher.launch(intent);
                return true;
            }

            // Handle WebRTC camera/mic permission requests from JS
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    String[] resources = request.getResources();
                    List<String> granted = new ArrayList<>();
                    List<String> nativePermsNeeded = new ArrayList<>();

                    for (String res : resources) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                            if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
                                granted.add(res);
                            } else {
                                nativePermsNeeded.add(Manifest.permission.RECORD_AUDIO);
                            }
                        }
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                            if (hasPermission(Manifest.permission.CAMERA)) {
                                granted.add(res);
                            } else {
                                nativePermsNeeded.add(Manifest.permission.CAMERA);
                            }
                        }
                    }

                    if (!nativePermsNeeded.isEmpty()) {
                        // Store pending request, request native permissions, then grant/deny in callback
                        pendingWebRtcRequest = request;
                        pendingWebRtcResources = resources;
                        ActivityCompat.requestPermissions(MainActivity.this,
                                nativePermsNeeded.toArray(new String[0]),
                                WEBRTC_PERMISSION_REQUEST_CODE);
                    } else if (!granted.isEmpty()) {
                        request.grant(granted.toArray(new String[0]));
                    } else {
                        request.deny();
                    }
                });
            }

            // Handle geolocation permission
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                                                           GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            // Forward console.log to Android Logcat
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                Log.d("WebConsole", cm.message() + " [" + cm.sourceId() + ":" + cm.lineNumber() + "]");
                return true;
            }
        });
    }

    /**
     * Request runtime permissions needed for core features
     */
    private void requestPermissions() {
        List<String> needed = new ArrayList<>();
        String[] perms = {
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.ACCESS_FINE_LOCATION,
        };
        // Android 13+ needs POST_NOTIFICATIONS
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        for (String p : perms) {
            if (!hasPermission(p)) needed.add(p);
        }
        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(this,
                    needed.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }

    /**
     * Request SYSTEM_ALERT_WINDOW for incoming call overlay.
     * Called on demand when a call starts, not at app launch.
     */
    public void requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        }
    }

    private boolean hasPermission(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == WEBRTC_PERMISSION_REQUEST_CODE && pendingWebRtcRequest != null) {
            // Re-evaluate which WebRTC resources can now be granted
            List<String> granted = new ArrayList<>();
            if (pendingWebRtcResources != null) {
                for (String res : pendingWebRtcResources) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) &&
                            hasPermission(Manifest.permission.RECORD_AUDIO)) {
                        granted.add(res);
                    }
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) &&
                            hasPermission(Manifest.permission.CAMERA)) {
                        granted.add(res);
                    }
                }
            }
            if (!granted.isEmpty()) {
                pendingWebRtcRequest.grant(granted.toArray(new String[0]));
            } else {
                pendingWebRtcRequest.deny();
            }
            pendingWebRtcRequest = null;
            pendingWebRtcResources = null;
        }
    }

    /**
     * Handle system back gesture and hardware back button.
     * For SPA: try JS back navigation first, only exit app if on home screen.
     */
    private void setupBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView == null) {
                    finish();
                    return;
                }
                // Ask JS if there's a page to go back to (back button visible = in sub-page)
                webView.evaluateJavascript(
                        "(function() {" +
                        "  var btn = document.getElementById('backBtn');" +
                        "  if (btn && !btn.classList.contains('hidden')) { btn.click(); return 'back'; }" +
                        "  var modal = document.getElementById('_appModal');" +
                        "  if (modal && !modal.classList.contains('hidden')) { modal.querySelector('.app-modal-cancel')?.click(); return 'modal'; }" +
                        "  return 'home';" +
                        "})()",
                        result -> {
                            String r = result != null ? result.replace("\"", "") : "home";
                            if ("home".equals(r)) {
                                // On home screen — move to background instead of killing
                                moveTaskToBack(true);
                            }
                        });
            }
        });
    }

    public WebView getWebView() {
        return webView;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCallActionIntent(intent);
    }

    /**
     * Process action intents from IncomingCallActivity, notifications, etc.
     * Since this activity is singleTask, these arrive via onNewIntent when
     * the activity already exists.
     */
    private void handleCallActionIntent(Intent intent) {
        if (intent == null || webView == null) return;
        String action = intent.getStringExtra("action");
        if (action == null) return;

        // Defer until WebView page is loaded to avoid lost JS calls
        if (!webViewReady) {
            pendingActionIntent = intent;
            return;
        }

        // Clear the action so it doesn't re-fire on config change
        intent.removeExtra("action");

        if ("open_conversation".equals(action)) {
            String conversationId = intent.getStringExtra("conversationId");
            if (conversationId != null && !conversationId.isEmpty()) {
                webView.evaluateJavascript(
                        "if(window.openConversation) window.openConversation('" +
                        conversationId.replace("'", "\\'") + "');",
                        null);
            }
            return;
        }

        // Call actions: accept_call, reject_call
        String callerId = intent.getStringExtra("callerId");
        String conversationId = intent.getStringExtra("conversationId");
        String callId = intent.getStringExtra("callId");

        if (nativeBridge != null) {
            nativeBridge.notifyCallAction(action, callerId, conversationId, callId);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onDestroy() {
        LocalBroadcastManager.getInstance(this).unregisterReceiver(hangupReceiver);
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
