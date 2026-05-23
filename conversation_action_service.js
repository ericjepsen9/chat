const RECALL_TIMEOUT_MS = 120000; // 2 minutes

const VALID_SIGNAL_TYPES = new Set(['offer', 'answer', 'candidate']);
const VALID_CALL_MODES = new Set(['voice', 'video']);
const VALID_CALL_EVENTS = new Set(['start', 'accept', 'reject', 'end', 'cancel']);
const RE_CALL_ID = /^[a-zA-Z0-9_-]{6,80}$/;
const MAX_SDP_LENGTH = 10240;
const MAX_CANDIDATE_LENGTH = 2048;
const MAX_SENDER_NAME = 50;
const MAX_DURATION_SEC = 86400;
const VALID_CALL_REASONS = new Set(['busy', 'timeout', 'disconnect', 'pagehide', 'manual', 'hangup', 'user_reject', 'caller_cancel', 'connect_timeout', 'watchdog', 'signal_failed', 'sdp_error', 'error', '']);

function sanitizeSenderName(name, fallback) {
  if (!name || typeof name !== 'string') return String(fallback || '').slice(0, MAX_SENDER_NAME);
  return name.replace(/[<>"'&]/g, '').slice(0, MAX_SENDER_NAME);
}

function validateSignalPayload(signal) {
  if (!signal || typeof signal !== 'object') return 'invalid_signal';
  if (!VALID_SIGNAL_TYPES.has(signal.type)) return 'invalid_signal_type';
  if (signal.type === 'offer' || signal.type === 'answer') {
    if (!signal.sdp || typeof signal.sdp !== 'object') return 'invalid_sdp';
    if (typeof signal.sdp.sdp === 'string' && signal.sdp.sdp.length > MAX_SDP_LENGTH) return 'sdp_too_large';
  }
  if (signal.type === 'candidate') {
    if (signal.candidate && JSON.stringify(signal.candidate).length > MAX_CANDIDATE_LENGTH) return 'candidate_too_large';
  }
  return null;
}

const _callSignalCounts = new Map();
const _callEventCounts = new Map();
const SIGNAL_RATE_WINDOW = 5000;
const SIGNAL_RATE_MAX = 30;
const CALL_RATE_WINDOW = 10000;
const CALL_RATE_MAX = 5;

function checkRateLimit(map, key, windowMs, max) {
  const now = Date.now();
  let entry = map.get(key);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    map.set(key, entry);
  }
  entry.count++;
  return entry.count > max;
}

const activeCalls = new Map();
const VALID_TRANSITIONS = {
  ringing: new Set(['accept', 'reject', 'cancel', 'end']),
  connected: new Set(['end']),
};

function cleanupStaleCalls() {
  const cutoff = Date.now() - 4 * 3600 * 1000;
  for (const [callId, call] of activeCalls) {
    if (call.startedAt < cutoff) activeCalls.delete(callId);
  }
  const now = Date.now();
  for (const [key, entry] of _callSignalCounts) {
    if (now - entry.start > SIGNAL_RATE_WINDOW * 2) _callSignalCounts.delete(key);
  }
  for (const [key, entry] of _callEventCounts) {
    if (now - entry.start > CALL_RATE_WINDOW * 2) _callEventCounts.delete(key);
  }
}
setInterval(cleanupStaleCalls, 600000);

function formatCallDuration(totalSec) {
  const sec = Math.max(0, Number(totalSec) || 0);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${mm}:${ss}`;
}

function buildCallHistoryText(body = {}) {
  const modeLabel = body.mode === 'video' ? '视频通话' : '语音通话';
  const durationSec = Math.max(0, Number(body.durationSec) || 0);
  if (body.event === 'start' || body.event === 'accept') return '';
  if (body.event === 'cancel') return `已取消${modeLabel}`;
  if (body.reason === 'busy') return `${modeLabel}（对方忙线）`;
  if (body.reason === 'timeout') return body.event === 'reject' ? `未接${modeLabel}` : `${modeLabel}（对方无应答）`;
  if (body.reason === 'disconnect') {
    return durationSec > 0 ? `${modeLabel} ${formatCallDuration(durationSec)}` : `${modeLabel}（已中断）`;
  }
  if (body.reason === 'pagehide') {
    return durationSec > 0 ? `${modeLabel} ${formatCallDuration(durationSec)}` : `已取消${modeLabel}`;
  }
  if (body.event === 'reject') return `已拒绝${modeLabel}`;
  if (body.event === 'end') {
    return durationSec > 0 ? `${modeLabel} ${formatCallDuration(durationSec)}` : `${modeLabel}（已结束）`;
  }
  return `${modeLabel}（通话状态更新）`;
}

function findConversationMessage(messagesByConv, conversationId, messageId, messagesById) {
  // O(1) lookup via messagesById index, fallback to linear scan
  if (messagesById) {
    const msg = messagesById.get(messageId);
    return msg && msg.conversationId === conversationId ? msg : undefined;
  }
  return (messagesByConv.get(conversationId) || []).find((msg) => msg.id === messageId);
}

function deleteConversationMessage({ conversationId, messageId, authUser, index, schedulePersist, broadcastToUser, persistEvent }) {
  const msg = findConversationMessage(index.messagesByConv, conversationId, messageId, index.messagesById);
  if (!msg) return { ok: false, status: 404, error: 'not_found' };
  if (!Array.isArray(msg.deletedBy)) msg.deletedBy = [];
  if (!(msg._deletedBySet instanceof Set)) msg._deletedBySet = new Set(msg.deletedBy);
  if (!msg._deletedBySet.has(authUser.id)) {
    msg.deletedBy.push(authUser.id);
    msg._deletedBySet.add(authUser.id);
  }
  schedulePersist(persistEvent, { conversationId, messageId: msg.id, userId: authUser.id });
  broadcastToUser(authUser.id, 'conversation_updated', { conversationId });
  return { ok: true, status: 200, payload: { ok: true } };
}

function recallConversationMessage({ conversationId, messageId, authUser, index, schedulePersist, broadcastToConversation, persistEvent }) {
  const msg = findConversationMessage(index.messagesByConv, conversationId, messageId, index.messagesById);
  if (!msg) return { ok: false, status: 404, error: 'not_found' };
  if (msg.senderId !== authUser.id || Date.now() - msg.createdAt > RECALL_TIMEOUT_MS) {
    return { ok: false, status: 403, error: '超时或无权限' };
  }
  msg.type = 'system';
  msg.text = '你撤回了一条消息';
  msg.imageUrl = null;
  msg.audioUrl = null;
  msg.card = null;
  msg.order = null;
  msg.broadcast = null;
  schedulePersist(persistEvent, { conversationId, messageId: msg.id });
  broadcastToConversation(conversationId, 'message_recalled', { conversationId, messageId: msg.id, message: msg });
  broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
  return { ok: true, status: 200, payload: { ok: true } };
}

function applyConversationAction({ action, conversationId, body, authUser, conv, db, index, uid, addToMapArray, invalidateConvMeta, schedulePersist, broadcastToUser, broadcastToConversation }) {
  if (action === 'delete') {
    return deleteConversationMessage({
      conversationId,
      messageId: body.msgId,
      authUser,
      index,
      schedulePersist,
      broadcastToUser,
      persistEvent: 'message_delete_legacy',
    });
  }

  if (action === 'recall') {
    return recallConversationMessage({
      conversationId,
      messageId: body.msgId,
      authUser,
      index,
      schedulePersist,
      broadcastToConversation,
      persistEvent: 'message_recall_legacy',
    });
  }

  if (action === 'read') {
    if (!conv.lastRead) conv.lastRead = {};
    conv.lastRead[authUser.id] = Date.now();
    if (typeof invalidateConvMeta === 'function') invalidateConvMeta(conversationId);
    schedulePersist('conversation_read', { conversationId, userId: authUser.id });
    broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
    return { ok: true, status: 200, payload: { ok: true } };
  }

  if (action === 'mute') {
    const auid = authUser.id;
    const muted = !conv._mutedBySet.has(auid);
    if (muted) {
      conv.mutedBy.push(auid);
      conv._mutedBySet.add(auid);
    } else {
      conv._mutedBySet.delete(auid);
      // Rebuild array from Set to avoid indexOf scan
      conv.mutedBy = [...conv._mutedBySet];
    }
    schedulePersist('conversation_mute', { conversationId, userId: auid });
    broadcastToUser(auid, 'conversation_updated', { conversationId });
    return { ok: true, status: 200, payload: { ok: true, muted } };
  }

  if (action === 'pin') {
    const auid = authUser.id;
    const pinned = !conv._pinnedBySet.has(auid);
    if (pinned) {
      conv.pinnedBy.push(auid);
      conv._pinnedBySet.add(auid);
    } else {
      conv._pinnedBySet.delete(auid);
      // Rebuild array from Set to avoid indexOf scan
      conv.pinnedBy = [...conv._pinnedBySet];
    }
    schedulePersist('conversation_pin', { conversationId, userId: auid });
    broadcastToUser(auid, 'conversation_updated', { conversationId });
    return { ok: true, status: 200, payload: { ok: true, pinned } };
  }

  if (action === 'clear') {
    const clearNow = Date.now();
    if (!conv.clearedAt) conv.clearedAt = {};
    if (!conv.lastRead) conv.lastRead = {};
    conv.clearedAt[authUser.id] = clearNow;
    conv.lastRead[authUser.id] = clearNow;
    if (typeof invalidateConvMeta === 'function') invalidateConvMeta(conversationId);
    schedulePersist('conversation_clear', { conversationId, userId: authUser.id });
    broadcastToUser(authUser.id, 'conversation_updated', { conversationId });
    return { ok: true, status: 200, payload: { ok: true, clearedAt: conv.clearedAt[authUser.id] } };
  }

  if (action === 'signal') {
    const targetUserId = body.targetUserId;
    if (!targetUserId) return { ok: false, status: 400, error: 'target_user_required' };
    if (targetUserId === authUser.id) return { ok: false, status: 400, error: 'cannot_signal_self' };
    if (!conv._memberSet.has(targetUserId)) return { ok: false, status: 403, error: 'forbidden' };
    if (body.signal?.type === 'typing') {
      broadcastToUser(targetUserId, 'typing_indicator', { conversationId, senderId: authUser.id });
      return { ok: true, status: 200, payload: { ok: true } };
    }
    if (!body.callId || !RE_CALL_ID.test(body.callId)) return { ok: false, status: 400, error: 'invalid_call_id' };
    const signalErr = validateSignalPayload(body.signal);
    if (signalErr) return { ok: false, status: 400, error: signalErr };
    if (!VALID_CALL_MODES.has(body.mode)) return { ok: false, status: 400, error: 'invalid_mode' };
    if (checkRateLimit(_callSignalCounts, authUser.id, SIGNAL_RATE_WINDOW, SIGNAL_RATE_MAX)) {
      return { ok: false, status: 429, error: 'rate_limited' };
    }
    broadcastToUser(targetUserId, 'webrtc_signal', {
      conversationId,
      senderId: authUser.id,
      senderName: sanitizeSenderName(body.senderName, authUser.displayName),
      targetUserId,
      signal: body.signal,
      mode: body.mode,
      callId: body.callId,
    });
    return { ok: true, status: 200, payload: { ok: true } };
  }

  if (action === 'call') {
    const targetUserId = body.targetUserId;
    if (!targetUserId) return { ok: false, status: 400, error: 'target_user_required' };
    if (targetUserId === authUser.id) return { ok: false, status: 400, error: 'cannot_call_self' };
    if (!body.callId || !RE_CALL_ID.test(body.callId)) return { ok: false, status: 400, error: 'invalid_call_id' };
    if (!conv._memberSet.has(targetUserId)) return { ok: false, status: 403, error: 'forbidden' };
    if (!VALID_CALL_EVENTS.has(body.event)) return { ok: false, status: 400, error: 'invalid_event' };
    if (body.mode && !VALID_CALL_MODES.has(body.mode)) return { ok: false, status: 400, error: 'invalid_mode' };
    if (checkRateLimit(_callEventCounts, authUser.id, CALL_RATE_WINDOW, CALL_RATE_MAX)) {
      return { ok: false, status: 429, error: 'rate_limited' };
    }

    const callId = body.callId;
    let durationSec = 0;
    const existing = activeCalls.get(callId);

    if (body.event === 'start') {
      if (existing) return { ok: false, status: 409, error: 'call_already_exists' };
      activeCalls.set(callId, { initiator: authUser.id, recipient: targetUserId, state: 'ringing', startedAt: Date.now(), connectedAt: 0 });
    } else if (existing) {
      const isParticipant = authUser.id === existing.initiator || authUser.id === existing.recipient;
      if (!isParticipant) return { ok: false, status: 403, error: 'not_call_participant' };
      const allowed = VALID_TRANSITIONS[existing.state];
      if (allowed && !allowed.has(body.event)) {
        return { ok: false, status: 409, error: 'invalid_state_transition' };
      }
      if (body.event === 'accept') {
        if (authUser.id !== existing.recipient) return { ok: false, status: 403, error: 'only_recipient_can_accept' };
        existing.state = 'connected';
        existing.connectedAt = Date.now();
      } else if (body.event === 'end' || body.event === 'reject' || body.event === 'cancel') {
        if (existing.connectedAt > 0) {
          durationSec = Math.min(Math.floor((Date.now() - existing.connectedAt) / 1000), MAX_DURATION_SEC);
        }
        activeCalls.delete(callId);
      }
    }

    const safeName = sanitizeSenderName(body.senderName, authUser.displayName);
    const safeReason = VALID_CALL_REASONS.has(body.reason) ? body.reason : '';
    const callBody = { ...body, durationSec, senderName: safeName, reason: safeReason };
    const text = buildCallHistoryText(callBody);
    if (text) {
      const msg = {
        id: uid('m'),
        conversationId,
        senderId: authUser.id,
        type: 'system',
        text,
        deletedBy: [],
        createdAt: Date.now(),
      };
      db.messages.push(msg);
      addToMapArray(index.messagesByConv, conversationId, msg);
      index.messagesById.set(msg.id, msg);
      conv.lastMessageAt = msg.createdAt;
      if (typeof invalidateConvMeta === 'function') invalidateConvMeta(conversationId);
      broadcastToConversation(conversationId, 'message_created', { conversationId, message: msg });
      broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
    }
    schedulePersist('call_event', { conversationId, event: body.event, userId: authUser.id, callId });
    broadcastToUser(targetUserId, 'call_event', {
      conversationId,
      senderId: authUser.id,
      senderName: safeName,
      targetUserId,
      event: body.event,
      mode: body.mode || 'voice',
      reason: safeReason,
      callId,
      durationSec,
    });
    return { ok: true, status: 200, payload: { ok: true } };
  }

  return { ok: false, status: 400, error: 'unsupported_action' };
}

module.exports = {
  deleteConversationMessage,
  recallConversationMessage,
  applyConversationAction,
};
