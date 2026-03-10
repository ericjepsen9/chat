package com.mychat.app.push;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.alibaba.sdk.android.push.CloudPushService;
import com.alibaba.sdk.android.push.noonesdk.PushServiceFactory;

/**
 * Re-register push service after device reboot.
 * Ensures push notifications continue to work after restart.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.i("BootReceiver", "Device booted, re-registering push");
            CloudPushService pushService = PushServiceFactory.getCloudPushService();
            if (pushService != null) {
                pushService.turnOnPushChannel(null);
            }
        }
    }
}
