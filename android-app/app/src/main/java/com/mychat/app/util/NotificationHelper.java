package com.mychat.app.util;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;

import com.mychat.app.ChatApplication;
import com.mychat.app.MainActivity;
import com.mychat.app.R;

/**
 * Helper for showing chat message and system notifications.
 */
public class NotificationHelper {

    private static int notificationIdCounter = 3000;

    /**
     * Show a chat message notification.
     * Tapping opens the conversation in the main activity.
     */
    public static void showMessageNotification(Context context, String senderName,
                                                String content, String conversationId) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("action", "open_conversation");
        intent.putExtra("conversationId", conversationId);

        PendingIntent pending = PendingIntent.getActivity(context, notificationIdCounter,
                intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, ChatApplication.CHANNEL_MESSAGE)
                .setSmallIcon(R.drawable.ic_message)
                .setContentTitle(senderName)
                .setContentText(content)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setSound(Settings.System.DEFAULT_NOTIFICATION_URI)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationIdCounter++, builder.build());
            // Wrap counter to avoid overflow
            if (notificationIdCounter > 9999) notificationIdCounter = 3000;
        }
    }

    /**
     * Show a system notification (friend requests, order updates, etc.)
     */
    public static void showSystemNotification(Context context, String title, String body) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pending = PendingIntent.getActivity(context, notificationIdCounter,
                intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, ChatApplication.CHANNEL_SYSTEM)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pending);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationIdCounter++, builder.build());
            if (notificationIdCounter > 9999) notificationIdCounter = 3000;
        }
    }

    /**
     * Clear all notifications (e.g., when user opens app)
     */
    public static void clearAll(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancelAll();
    }
}
