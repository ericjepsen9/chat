package com.mychat.app.call;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import com.mychat.app.ChatApplication;
import com.mychat.app.MainActivity;
import com.mychat.app.R;

/**
 * Foreground service that keeps the app alive during an active call.
 * Shows a persistent notification with call status.
 */
public class CallService extends Service {

    private static final int NOTIFICATION_ID = 2001;
    private static final String ACTION_START = "com.mychat.app.call.START";
    private static final String ACTION_STOP = "com.mychat.app.call.STOP";
    public static final String ACTION_HANGUP_FROM_NOTIFICATION = "com.mychat.app.call.HANGUP_FROM_NOTIFICATION";

    public static void start(Context context, String peerName, String mode) {
        Intent intent = new Intent(context, CallService.class);
        intent.setAction(ACTION_START);
        intent.putExtra("peerName", peerName);
        intent.putExtra("mode", mode);
        context.startForegroundService(intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, CallService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            // Notify WebView to actually end the call
            LocalBroadcastManager.getInstance(this)
                    .sendBroadcast(new Intent(ACTION_HANGUP_FROM_NOTIFICATION));
            return START_NOT_STICKY;
        }

        String peerName = intent.getStringExtra("peerName");
        String mode = intent.getStringExtra("mode");
        if (peerName == null) peerName = "通话中";

        String title = "video".equals(mode) ? "视频通话中" : "语音通话中";

        // Tap notification → return to app
        Intent mainIntent = new Intent(this, MainActivity.class);
        mainIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0,
                mainIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Hang up action
        Intent stopIntent = new Intent(this, CallService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 1,
                stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, ChatApplication.CHANNEL_CALL)
                .setSmallIcon(R.drawable.ic_call)
                .setContentTitle(title)
                .setContentText("与 " + peerName + " 通话中")
                .setContentIntent(pendingIntent)
                .addAction(R.drawable.ic_call_end, "挂断", stopPending)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                                | ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.e("CallService", "Failed to start foreground service", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
