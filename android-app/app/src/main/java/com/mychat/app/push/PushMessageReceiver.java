package com.mychat.app.push;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.mychat.app.MainActivity;

/**
 * Handles notification click events from EMAS push.
 * Opens the main activity when user taps a notification.
 */
public class PushMessageReceiver extends BroadcastReceiver {

    private static final String TAG = "PushMsgReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Log.i(TAG, "Push action received: " + action);

        // Open main activity
        Intent mainIntent = new Intent(context, MainActivity.class);
        mainIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(mainIntent);
    }
}
