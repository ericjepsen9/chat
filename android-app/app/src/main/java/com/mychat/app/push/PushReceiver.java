package com.mychat.app.push;

import android.content.Context;
import android.util.Log;

import com.alibaba.sdk.android.push.MessageReceiver;
import com.alibaba.sdk.android.push.notification.CPushMessage;
import com.mychat.app.call.CallNotificationHelper;
import com.mychat.app.util.NotificationHelper;

import org.json.JSONObject;

import java.util.Map;

/**
 * EMAS Push transparent message receiver.
 * Handles incoming messages when app is in background/killed.
 *
 * Server should send transparent push (透传消息) with JSON payload:
 * {
 *   "type": "incoming_call",
 *   "callerId": "user123",
 *   "callerName": "张三",
 *   "callMode": "voice",
 *   "conversationId": "conv456",
 *   "callId": "call789"
 * }
 *
 * Or for chat messages:
 * {
 *   "type": "new_message",
 *   "senderName": "李四",
 *   "content": "你好",
 *   "conversationId": "conv456"
 * }
 */
public class PushReceiver extends MessageReceiver {

    private static final String TAG = "PushReceiver";

    /**
     * Receive transparent push message (透传消息)
     * This is the core handler for background push
     */
    @Override
    protected void onMessage(Context context, CPushMessage message) {
        String content = message.getContent();
        Log.i(TAG, "Transparent message received: " + content);

        try {
            JSONObject json = new JSONObject(content);
            String type = json.optString("type", "");

            switch (type) {
                case "incoming_call":
                    handleIncomingCall(context, json);
                    break;
                case "new_message":
                    handleNewMessage(context, json);
                    break;
                case "friend_request":
                    handleFriendRequest(context, json);
                    break;
                case "order_update":
                    handleOrderUpdate(context, json);
                    break;
                default:
                    Log.w(TAG, "Unknown push type: " + type);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to parse push message", e);
        }
    }

    /**
     * Handle incoming call push → show full-screen call UI
     */
    private void handleIncomingCall(Context context, JSONObject json) {
        String callerId = json.optString("callerId", "");
        String callerName = json.optString("callerName", "未知来电");
        String callMode = json.optString("callMode", "voice");
        String conversationId = json.optString("conversationId", "");
        String callId = json.optString("callId", "");

        // This triggers the WeChat-like full-screen incoming call UI
        CallNotificationHelper.showIncomingCallNotification(
                context, callerId, callerName, callMode, conversationId, callId);
    }

    /**
     * Handle new message push → show notification
     */
    private void handleNewMessage(Context context, JSONObject json) {
        String senderName = json.optString("senderName", "新消息");
        String content = json.optString("content", "");
        String conversationId = json.optString("conversationId", "");

        // Truncate long messages
        if (content.length() > 50) {
            content = content.substring(0, 50) + "...";
        }

        NotificationHelper.showMessageNotification(context, senderName, content, conversationId);
    }

    /**
     * Handle friend request push
     */
    private void handleFriendRequest(Context context, JSONObject json) {
        String fromName = json.optString("fromName", "有人");
        NotificationHelper.showSystemNotification(context,
                "新的好友请求", fromName + " 请求添加你为好友");
    }

    /**
     * Handle order update push
     */
    private void handleOrderUpdate(Context context, JSONObject json) {
        String orderId = json.optString("orderId", "");
        String status = json.optString("status", "");
        String title = "订单更新";
        String body = "订单 #" + (orderId.length() > 6 ? orderId.substring(orderId.length() - 6) : orderId) +
                " 状态已更新";

        if ("completed".equals(status)) body = "订单已完成";
        else if ("price_changed".equals(status)) body = "订单价格已调整";

        NotificationHelper.showSystemNotification(context, title, body);
    }

    @Override
    protected void onNotification(Context context, String title, String summary, Map<String, String> extraMap) {
        Log.i(TAG, "Notification: " + title + " - " + summary);
    }

    @Override
    protected void onNotificationOpened(Context context, String title, String summary, String extraMap) {
        Log.i(TAG, "Notification opened: " + title);
    }

    @Override
    protected void onNotificationRemoved(Context context, String messageId) {
        Log.i(TAG, "Notification removed: " + messageId);
    }

    @Override
    protected void onNotificationClickedWithNoAction(Context context, String title, String summary, String extraMap) {
        Log.i(TAG, "Notification clicked (no action): " + title);
    }
}
