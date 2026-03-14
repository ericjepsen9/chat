const RECALL_TIMEOUT_MS = 120000; // 2 minutes

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
  if (!msg._deletedBySet) msg._deletedBySet = new Set(msg.deletedBy);
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
    conv.lastRead[authUser.id] = Date.now();
    if (typeof invalidateConvMeta === 'function') invalidateConvMeta(conversationId);
    schedulePersist('conversation_read', { conversationId, userId: authUser.id });
    broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
    return { ok: true, status: 200, payload: { ok: true } };
  }

  if (action === 'mute') {
    const uid = authUser.id;
    const muted = !conv._mutedBySet.has(uid);
    if (muted) {
      conv.mutedBy.push(uid);
      conv._mutedBySet.add(uid);
    } else {
      conv._mutedBySet.delete(uid);
      // Rebuild array from Set to avoid indexOf scan
      conv.mutedBy = [...conv._mutedBySet];
    }
    schedulePersist('conversation_mute', { conversationId, userId: uid });
    broadcastToUser(uid, 'conversation_updated', { conversationId });
    return { ok: true, status: 200, payload: { ok: true, muted } };
  }

  if (action === 'pin') {
    const uid = authUser.id;
    const pinned = !conv._pinnedBySet.has(uid);
    if (pinned) {
      conv.pinnedBy.push(uid);
      conv._pinnedBySet.add(uid);
    } else {
      conv._pinnedBySet.delete(uid);
      // Rebuild array from Set to avoid indexOf scan
      conv.pinnedBy = [...conv._pinnedBySet];
    }
    schedulePersist('conversation_pin', { conversationId, userId: uid });
    broadcastToUser(uid, 'conversation_updated', { conversationId });
    return { ok: true, status: 200, payload: { ok: true, pinned } };
  }

  if (action === 'clear') {
    const clearNow = Date.now();
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
    const isMember = conv._memberSet.has(targetUserId);
    if (!isMember) return { ok: false, status: 403, error: 'forbidden' };
    if (body.signal?.type === 'typing') {
      broadcastToUser(targetUserId, 'typing_indicator', { conversationId, senderId: authUser.id });
      return { ok: true, status: 200, payload: { ok: true } };
    }
    if (!body.callId) return { ok: false, status: 400, error: 'call_id_required' };
    broadcastToUser(targetUserId, 'webrtc_signal', {
      conversationId,
      senderId: authUser.id,
      senderName: body.senderName || authUser.displayName,
      targetUserId,
      signal: body.signal,
      mode: body.mode,
      rejectReason: body.rejectReason,
      callId: body.callId,
    });
    return { ok: true, status: 200, payload: { ok: true } };
  }

  if (action === 'call') {
    const targetUserId = body.targetUserId;
    if (!targetUserId) return { ok: false, status: 400, error: 'target_user_required' };
    if (!body.callId) return { ok: false, status: 400, error: 'call_id_required' };
    if (!conv._memberSet.has(targetUserId)) return { ok: false, status: 403, error: 'forbidden' };
    const text = buildCallHistoryText(body);
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
    schedulePersist('call_event', { conversationId, event: body.event, userId: authUser.id, callId: body.callId });
    const durationSec = Math.max(0, Number(body.durationSec) || 0);
    broadcastToUser(targetUserId, 'call_event', {
      conversationId,
      senderId: authUser.id,
      senderName: body.senderName || authUser.displayName,
      targetUserId,
      event: body.event,
      mode: body.mode,
      reason: body.reason,
      callId: body.callId,
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
