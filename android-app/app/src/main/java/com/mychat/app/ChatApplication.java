package com.mychat.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.alibaba.sdk.android.push.CloudPushService;
import com.alibaba.sdk.android.push.CommonCallback;
import com.alibaba.sdk.android.push.noonesdk.PushServiceFactory;

public class ChatApplication extends Application {

    private static final String TAG = "ChatApp";

    public static final String CHANNEL_CALL = "channel_call";
    public static final String CHANNEL_MESSAGE = "channel_message";
    public static final String CHANNEL_SYSTEM = "channel_system";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        initEmasPush();
    }

    /**
     * Create notification channels required by Android 8.0+
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        AudioAttributes audioAttr = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        // Incoming call — highest importance, shows full-screen intent
        NotificationChannel callChannel = new NotificationChannel(
                CHANNEL_CALL, "来电通知", NotificationManager.IMPORTANCE_HIGH);
        callChannel.setDescription("来电提醒和通话状态");
        callChannel.setSound(Settings.System.DEFAULT_RINGTONE_URI, audioAttr);
        callChannel.enableVibration(true);
        callChannel.setVibrationPattern(new long[]{0, 500, 300, 500});
        callChannel.setBypassDnd(true);
        callChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(callChannel);

        // Chat messages
        NotificationChannel msgChannel = new NotificationChannel(
                CHANNEL_MESSAGE, "聊天消息", NotificationManager.IMPORTANCE_HIGH);
        msgChannel.setDescription("新消息通知");
        msgChannel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI,
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        msgChannel.enableVibration(true);
        nm.createNotificationChannel(msgChannel);

        // System notifications (orders, friend requests, etc.)
        NotificationChannel sysChannel = new NotificationChannel(
                CHANNEL_SYSTEM, "系统通知", NotificationManager.IMPORTANCE_DEFAULT);
        sysChannel.setDescription("订单、好友请求等系统通知");
        nm.createNotificationChannel(sysChannel);
    }

    /**
     * Initialize Alibaba Cloud EMAS Push SDK
     */
    private void initEmasPush() {
        PushServiceFactory.init(this);
        CloudPushService pushService = PushServiceFactory.getCloudPushService();
        pushService.register(this, new CommonCallback() {
            @Override
            public void onSuccess(String response) {
                String deviceId = pushService.getDeviceId();
                Log.i(TAG, "EMAS push registered, deviceId=" + deviceId);
            }

            @Override
            public void onFailed(String errorCode, String errorMessage) {
                Log.e(TAG, "EMAS push register failed: " + errorCode + " - " + errorMessage);
            }
        });
    }

    /**
     * Bind push alias to current user ID (call after login)
     */
    public static void bindPushAlias(String userId) {
        if (userId == null || userId.isEmpty()) return;
        CloudPushService pushService = PushServiceFactory.getCloudPushService();
        pushService.addAlias(userId, new CommonCallback() {
            @Override
            public void onSuccess(String s) {
                Log.i(TAG, "Push alias bound: " + userId);
            }
            @Override
            public void onFailed(String code, String msg) {
                Log.e(TAG, "Push alias bind failed: " + code + " - " + msg);
            }
        });
    }

    /**
     * Unbind push alias (call on logout)
     */
    public static void unbindPushAlias(String userId) {
        if (userId == null || userId.isEmpty()) return;
        CloudPushService pushService = PushServiceFactory.getCloudPushService();
        pushService.removeAlias(userId, new CommonCallback() {
            @Override
            public void onSuccess(String s) {
                Log.i(TAG, "Push alias unbound");
            }
            @Override
            public void onFailed(String code, String msg) {
                Log.w(TAG, "Push alias unbind failed: " + code);
            }
        });
    }
}
