/**
 * EMAS Push Service - Server-side push notification sender.
 *
 * Sends transparent push (透传消息) to Android clients via Alibaba Cloud EMAS.
 * Used when SSE real-time connection is not available (app in background/killed).
 *
 * Setup:
 * 1. Set EMAS_APP_KEY, EMAS_APP_SECRET, EMAS_REGION in environment variables
 * 2. Server calls pushToUser() when SSE delivery fails
 *
 * Push types:
 * - incoming_call: triggers native full-screen call UI
 * - new_message: shows notification bar message
 * - friend_request: shows system notification
 * - transaction_message: shows transaction notification with distinct sound
 * - order_update: shows order status notification
 */

const https = require('https');
const crypto = require('crypto');

const EMAS_APP_KEY = process.env.EMAS_APP_KEY || '';
const EMAS_APP_SECRET = process.env.EMAS_APP_SECRET || '';
const EMAS_REGION = process.env.EMAS_REGION || 'cn-hangzhou';
const EMAS_ENDPOINT = `cloudpush.aliyuncs.com`;

/**
 * Check if EMAS push is configured
 */
function isPushConfigured() {
  return !!(EMAS_APP_KEY && EMAS_APP_SECRET);
}

/**
 * Send transparent push message to a user by alias (userId).
 *
 * @param {string} userId - Target user ID (bound as EMAS alias)
 * @param {object} payload - Push payload, e.g. { type: 'incoming_call', callerId: '...', ... }
 * @returns {Promise<boolean>} - true if sent successfully
 */
async function pushToUser(userId, payload) {
  if (!isPushConfigured()) {
    // Push not configured — skip silently (dev environment)
    return false;
  }

  const body = JSON.stringify(payload);

  const params = {
    Action: 'Push',
    AppKey: EMAS_APP_KEY,
    Target: 'ALIAS',
    TargetValue: userId,
    PushType: 'MESSAGE',       // Transparent message (透传)
    DeviceType: 'ANDROID',
    Body: body,
    Title: payload.type || 'notification',
    Format: 'JSON',
    Version: '2016-08-01',
    AccessKeyId: EMAS_APP_KEY,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    RegionId: EMAS_REGION,
  };

  // Sign the request (Alibaba Cloud API signature v1)
  const sortedKeys = Object.keys(params).sort();
  const canonicalized = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  const stringToSign = `POST&${encodeURIComponent('/')}&${encodeURIComponent(canonicalized)}`;
  const signature = crypto.createHmac('sha1', EMAS_APP_SECRET + '&')
    .update(stringToSign).digest('base64');
  params.Signature = signature;

  // Build postData reusing sorted keys; only 'Signature' is new (sorts between 'S' entries)
  // Insert Signature into correct sorted position to avoid full re-sort
  let sigInserted = false;
  const postParts = new Array(sortedKeys.length + 1);
  let pi = 0;
  for (let i = 0; i < sortedKeys.length; i++) {
    const k = sortedKeys[i];
    if (!sigInserted && 'Signature' < k) {
      postParts[pi++] = `${encodeURIComponent('Signature')}=${encodeURIComponent(signature)}`;
      sigInserted = true;
    }
    postParts[pi++] = `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`;
  }
  if (!sigInserted) postParts[pi++] = `${encodeURIComponent('Signature')}=${encodeURIComponent(signature)}`;
  const postData = postParts.slice(0, pi).join('&');

  return new Promise((resolve) => {
    const req = https.request({
      hostname: EMAS_ENDPOINT,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          console.warn('[push] EMAS push failed:', res.statusCode, Buffer.concat(chunks).toString());
          resolve(false);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.on('error', (err) => {
      console.warn('[push] EMAS push error:', err.message);
      resolve(false);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Send incoming call push to a user.
 * Triggers native full-screen call UI on Android.
 */
async function pushIncomingCall(targetUserId, callerId, callerName, callMode, conversationId, callId) {
  return pushToUser(targetUserId, {
    type: 'incoming_call',
    callerId,
    callerName: callerName || '来电',
    callMode: callMode || 'voice',
    conversationId: conversationId || '',
    callId: callId || '',
  });
}

/**
 * Send new message push notification.
 */
async function pushNewMessage(targetUserId, senderName, content, conversationId) {
  return pushToUser(targetUserId, {
    type: 'new_message',
    senderName: senderName || '新消息',
    content: (content || '').substring(0, 100),
    conversationId: conversationId || '',
  });
}

/**
 * Send friend request push notification.
 */
async function pushFriendRequest(targetUserId, fromName) {
  return pushToUser(targetUserId, {
    type: 'friend_request',
    fromName: fromName || '有人',
  });
}

/**
 * Send transaction message push notification (transfer, payment, receipt).
 */
async function pushTransactionMessage(targetUserId, title, body, conversationId) {
  return pushToUser(targetUserId, {
    type: 'transaction_message',
    title: title || '交易通知',
    body: body || '你有一笔新的交易',
    conversationId: conversationId || '',
  });
}

/**
 * Send order update push notification.
 */
async function pushOrderUpdate(targetUserId, orderId, status) {
  return pushToUser(targetUserId, {
    type: 'order_update',
    orderId: orderId || '',
    status: status || '',
  });
}

/**
 * Check if user has active SSE connection (is online).
 * If not online, push should be sent.
 */
function isUserOnline(sseClientsByUser, userId) {
  const clients = sseClientsByUser.get(userId);
  return !!(clients && clients.size > 0);
}

module.exports = {
  isPushConfigured,
  pushToUser,
  pushIncomingCall,
  pushNewMessage,
  pushFriendRequest,
  pushTransactionMessage,
  pushOrderUpdate,
  isUserOnline,
};
