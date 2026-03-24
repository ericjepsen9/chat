package com.mychat.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import com.mychat.app.util.SoundManager;

import com.alibaba.sdk.android.push.CloudPushService;
import com.alibaba.sdk.android.push.CommonCallback;
import com.alibaba.sdk.android.push.noonesdk.PushServiceFactory;

public class ChatApplication extends Application {

    private static final String TAG = "ChatApp";

    public static final String CHANNEL_CALL = "channel_call";
    public static final String CHANNEL_MESSAGE = "channel_message";
    public static final String CHANNEL_TRANSACTION = "channel_transaction";
    public static final String CHANNEL_SYSTEM = "channel_system";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        SoundManager.getInstance().init(this);
        initEmasPush();
    }

    /**
     * Create notification channels required by Android 8.0+
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        AudioAttributes ringtoneAttr = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        AudioAttributes notifAttr = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        // --- Incoming call — highest importance, custom ringtone, strong vibration ---
        Uri callSoundUri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.sound_call_ringtone);
        NotificationChannel callChannel = new NotificationChannel(
                CHANNEL_CALL, "来电通知", NotificationManager.IMPORTANCE_HIGH);
        callChannel.setDescription("语音/视频来电提醒");
        callChannel.setSound(callSoundUri, ringtoneAttr);
        callChannel.enableVibration(true);
        // Strong repeating pattern: buzz-pause-buzz-pause-buzz-long pause
        callChannel.setVibrationPattern(new long[]{0, 800, 400, 800, 400, 800, 1200});
        callChannel.setBypassDnd(true);
        callChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(callChannel);

        // --- Chat messages — custom message tone, short vibration ---
        Uri msgSoundUri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.sound_message);
        NotificationChannel msgChannel = new NotificationChannel(
                CHANNEL_MESSAGE, "聊天消息", NotificationManager.IMPORTANCE_HIGH);
        msgChannel.setDescription("新消息通知");
        msgChannel.setSound(msgSoundUri, notifAttr);
        msgChannel.enableVibration(true);
        // Short double-tap vibration for messages
        msgChannel.setVibrationPattern(new long[]{0, 100, 80, 100});
        nm.createNotificationChannel(msgChannel);

        // --- Transaction messages — custom payment tone, distinct vibration ---
        Uri txSoundUri = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.sound_transaction);
        NotificationChannel txChannel = new NotificationChannel(
                CHANNEL_TRANSACTION, "交易消息", NotificationManager.IMPORTANCE_HIGH);
        txChannel.setDescription("转账、收款、支付等交易通知");
        txChannel.setSound(txSoundUri, notifAttr);
        txChannel.enableVibration(true);
        // Triple-tap vibration for transaction alerts
        txChannel.setVibrationPattern(new long[]{0, 150, 100, 150, 100, 300});
        nm.createNotificationChannel(txChannel);

        // --- System notifications (friend requests, etc.) ---
        NotificationChannel sysChannel = new NotificationChannel(
                CHANNEL_SYSTEM, "系统通知", NotificationManager.IMPORTANCE_DEFAULT);
        sysChannel.setDescription("好友请求等系统通知");
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
