package com.mychat.app.call;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;

import com.mychat.app.MainActivity;
import com.mychat.app.R;

/**
 * Full-screen incoming call activity.
 * Displays on top of lock screen and all other apps.
 * Triggered by push notification when app is in background.
 */
public class IncomingCallActivity extends AppCompatActivity {

    private String callerId;
    private String callerName;
    private String callMode; // "voice" or "video"
    private String conversationId;
    private String callId;

    private Vibrator vibrator;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Show on lock screen and turn screen on
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) {
                km.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.activity_incoming_call);

        // Parse intent data
        Intent intent = getIntent();
        callerId = intent.getStringExtra("callerId");
        callerName = intent.getStringExtra("callerName");
        callMode = intent.getStringExtra("callMode");
        conversationId = intent.getStringExtra("conversationId");
        callId = intent.getStringExtra("callId");

        // Set UI
        TextView nameView = findViewById(R.id.callerName);
        TextView modeView = findViewById(R.id.callModeText);
        nameView.setText(callerName != null ? callerName : "未知来电");
        modeView.setText("video".equals(callMode) ? "视频来电" : "语音来电");

        // Caller initial letter avatar
        TextView avatarText = findViewById(R.id.callerAvatarText);
        if (callerName != null && !callerName.isEmpty()) {
            avatarText.setText(String.valueOf(callerName.charAt(0)));
        }

        // Accept button → open main app and accept call
        ImageButton acceptBtn = findViewById(R.id.acceptCallBtn);
        acceptBtn.setOnClickListener(v -> acceptCall());

        // Reject button → dismiss and notify server
        ImageButton rejectBtn = findViewById(R.id.rejectCallBtn);
        rejectBtn.setOnClickListener(v -> rejectCall());

        // Prevent dismissing with back button — must accept or reject
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Intentionally empty — block back gesture on incoming call screen
            }
        });

        // Start vibration
        startVibration();
    }

    private void acceptCall() {
        stopVibration();

        // Launch MainActivity with call accept action
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("action", "accept_call");
        intent.putExtra("callerId", callerId);
        intent.putExtra("callerName", callerName);
        intent.putExtra("callMode", callMode);
        intent.putExtra("conversationId", conversationId);
        intent.putExtra("callId", callId);
        startActivity(intent);

        finish();
    }

    private void rejectCall() {
        stopVibration();

        // Launch MainActivity with reject action
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("action", "reject_call");
        intent.putExtra("callerId", callerId);
        intent.putExtra("conversationId", conversationId);
        intent.putExtra("callId", callId);
        startActivity(intent);

        finish();
    }

    private void startVibration() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator != null && vibrator.hasVibrator()) {
            long[] pattern = {0, 500, 300, 500, 300, 500, 1000}; // ring pattern
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
        }
    }

    private void stopVibration() {
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
    }

    @Override
    protected void onDestroy() {
        stopVibration();
        super.onDestroy();
    }

}
