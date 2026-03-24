package com.mychat.app.call;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.mychat.app.ChatApplication;
import com.mychat.app.R;

/**
 * Helper to show incoming call notification with full-screen intent.
 * On Android 10+, this triggers a full-screen activity even from background.
 */
public class CallNotificationHelper {

    private static final int INCOMING_CALL_NOTIFICATION_ID = 2000;

    /**
     * Show an incoming call notification with full-screen intent.
     * This is the key mechanism for WeChat-like incoming call display.
     */
    public static void showIncomingCallNotification(Context context, String callerId,
                                                     String callerName, String callMode,
                                                     String conversationId, String callId) {
        // Full-screen intent → launches IncomingCallActivity
        Intent fullScreenIntent = new Intent(context, IncomingCallActivity.class);
        fullScreenIntent.putExtra("callerId", callerId);
        fullScreenIntent.putExtra("callerName", callerName);
        fullScreenIntent.putExtra("callMode", callMode);
        fullScreenIntent.putExtra("conversationId", conversationId);
        fullScreenIntent.putExtra("callId", callId);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);

        PendingIntent fullScreenPending = PendingIntent.getActivity(context,
                INCOMING_CALL_NOTIFICATION_ID,
                fullScreenIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Accept action
        Intent acceptIntent = new Intent(context, IncomingCallActivity.class);
        acceptIntent.putExtra("callerId", callerId);
        acceptIntent.putExtra("callerName", callerName);
        acceptIntent.putExtra("callMode", callMode);
        acceptIntent.putExtra("conversationId", conversationId);
        acceptIntent.putExtra("callId", callId);
        acceptIntent.putExtra("autoAccept", true);

        // Reject action
        Intent rejectIntent = new Intent(context, IncomingCallActivity.class);
        rejectIntent.putExtra("autoReject", true);
        rejectIntent.putExtra("callerId", callerId);
        rejectIntent.putExtra("conversationId", conversationId);
        rejectIntent.putExtra("callId", callId);

        String modeText = "video".equals(callMode) ? "视频来电" : "语音来电";

        Notification notification = new NotificationCompat.Builder(context, ChatApplication.CHANNEL_CALL)
                .setSmallIcon(R.drawable.ic_call)
                .setContentTitle(callerName != null ? callerName : "来电")
                .setContentText(modeText)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setFullScreenIntent(fullScreenPending, true)
                .setAutoCancel(true)
                .setOngoing(true)
                .setVibrate(new long[]{0, 800, 400, 800, 400, 800, 1200})
                .build();

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(INCOMING_CALL_NOTIFICATION_ID, notification);
        }
    }

    /**
     * Dismiss the incoming call notification
     */
    public static void dismissIncomingCallNotification(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(INCOMING_CALL_NOTIFICATION_ID);
        }
    }
}
