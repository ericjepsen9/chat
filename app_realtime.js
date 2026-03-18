/* app_realtime.js — SSE / real-time connection extracted from app.js */

let _connectRealtimeInFlight = false;
let _convUpdateTimer = null;
let _fetchMessagesInFlight = false;
let _renderMessagesTimer = null;
function debouncedRenderMessages() {
  if (_renderMessagesTimer) clearTimeout(_renderMessagesTimer);
  _renderMessagesTimer = setTimeout(() => { _renderMessagesTimer = null; renderMessages(); }, 50);
}
async function connectRealtime() {
  if (_connectRealtimeInFlight) return;
  _connectRealtimeInFlight = true;
  try {
  if (state.eventSource) {
    if (state._sseHandlers) { for (const [evt, fn] of state._sseHandlers) state.eventSource.removeEventListener(evt, fn); }
    state._sseHandlers = [];
    state.eventSource.close();
    state.eventSource = null;
  }
  let sseToken = '';
  try {
    const tokenRes = await api('/api/events/token', { method: 'POST' });
    sseToken = String(tokenRes.sseToken || '');
  } catch (_) {
    sseToken = '';
  }
  if (!sseToken) {
    state.eventSource = null;
    setTimeout(() => { if (state.currentUser) connectRealtime().catch(() => {}); }, 1500);
    return;
  }
  state.eventSource = new EventSource(`/api/events?sse=${encodeURIComponent(sseToken)}`);
  if (_convUpdateTimer) { clearTimeout(_convUpdateTimer); _convUpdateTimer = null; }
  state._sseHandlers = [];
  const _on = (evt, fn) => { state._sseHandlers.push([evt, fn]); state.eventSource.addEventListener(evt, fn); };
  _on('message_created', async (e) => { try {
    const data = safeParseEventData(e);
    if (!data) return;
    if(state.activeConversation && state.activeConversation.id === data.conversationId && data.message) {
      const result = upsertMessage(data.message);
      if (result.action === 'append') appendMessageToView(data.message);
      else if (result.action === 'replace') { if (!replaceMessageInView(data.message)) debouncedRenderMessages(); }
      else debouncedRenderMessages(); // 'insert' in middle — debounced full re-render
  applyLastOutgoingReadState();
      state.oldestMessageTime = state.messages[0]?.createdAt || 0;
      syncAndRenderConvList(true);
      markConversationRead(state.activeConversation.id);
    } else if(state.activeConversation && state.activeConversation.id === data.conversationId) {
      if (!_fetchMessagesInFlight) {
        _fetchMessagesInFlight = true;
        try { await fetchMessages(); } finally { _fetchMessagesInFlight = false; }
      }
      markConversationRead(state.activeConversation.id);
      syncAndRenderConvList(true);
    } else if (data.message) {
      applyIncomingConversationMeta(data.conversationId, data.message);
      scheduleRenderConversationList();
      if (data.message.type === 'order_card') scheduleTradeReminderRefresh(120);
    } else {
      loadConversations();
    }
  } catch (err) { console.warn('[sse] message_created handler error', err); } });
  _on('message_recalled', (e) => { try {
    const data = safeParseEventData(e);
    if (!data) return;
    if(state.activeConversation && state.activeConversation.id === data.conversationId) {
      if (!applyRecalledMessageLocally(data.messageId, data.message?.senderId)) { fetchMessages(); }
      syncAndRenderConvList(true);
    } else if (data.message) {
      applyIncomingConversationMeta(data.conversationId, data.message);
      scheduleRenderConversationList();
    } else {
      loadConversations();
    }
  } catch (err) { console.warn('[sse] message_recalled handler error', err); } });
  _on('conversation_updated', () => {
    // Debounce rapid conversation_updated events to avoid hammering the API
    if (_convUpdateTimer) clearTimeout(_convUpdateTimer);
    _convUpdateTimer = setTimeout(() => { _convUpdateTimer = null; loadConversations().catch(() => {}); }, 150);
    scheduleTradeReminderRefresh(180);
  });
  _on('friends_updated', async () => { await loadFriends(); if (state.activeConversation) applyChatRelationshipState(); });
  _on('friend_request_updated', loadFriendRequests);
  _on('mall_updated', async () => { await loadMall(); await syncProductViewsIfVisible(); });
  _on('product_changed', (e) => {
    const data = safeParseEventData(e);
    if (!data) return;
    syncCartWithProductChanges(data);
  });
  _on('system_message', (e) => { const data = safeParseEventData(e); if(!data || !data.message) return; const sysArr = state.systemMessages || []; const dupIdx = sysArr.findIndex(m => m.id === data.message.id); if (dupIdx !== -1) sysArr.splice(dupIdx, 1); sysArr.unshift(data.message); if (sysArr.length > 30) sysArr.length = 30; state.systemMessages = sysArr; scheduleRenderConversationList(); });
  _on('order_updated', () => { scheduleTradeReminderRefresh(120); });
  _on('typing_indicator', (e) => {
    const data = safeParseEventData(e);
    if (!data) return;
    if(state.activeConversation && state.activeConversation.id === data.conversationId) {
      setText("chatSubtitle", "对方正在输入...");
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => { applyChatRelationshipState(); }, DELAYS.TYPING_TIMEOUT);
    }
  });

  _on('webrtc_signal', async (e) => { try {
    const payload = safeParseEventData(e);
    if (!payload) return;
    const signal = payload.signal; if (!signal) return;
    if (!payload.mode) payload.mode = 'voice';
    if (signal.type === 'offer') {
      if (isIgnoredCallPayload(payload)) return;
      if (hasActiveCallSession() && !isSameIncomingCall(payload)) {
        api(`/api/conversations/${payload.conversationId}/call`, {
          method: 'POST',
          body: JSON.stringify({ senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: payload.senderId, event: 'reject', mode: payload.mode, reason: 'busy', callId: payload.callId || null })
        }).catch(() => {});
        return;
      }
      state.rtc.earlyCandidates = state.rtc.earlyCandidates || [];
      state.rtc.callId = payload.callId || state.rtc.callId || null;
      state.rtc.conversationId = payload.conversationId;
      state.rtc.incomingMeta = {
        senderId: payload.senderId,
        senderName: payload.senderName || state.rtc.incomingMeta?.senderName || null,
        mode: payload.mode,
        conversationId: payload.conversationId,
        callId: payload.callId || state.rtc.callId || null
      };
      state.rtc.pendingOffer = payload;
      setRtcPhase('incoming');

      let peerName = payload.senderName || payload.senderId;
      const f = findFriendEntry(payload.senderId);
      if(f) peerName = f.friend.remark || f.friend.displayName;

      if (shouldPresentIncomingUI(payload)) {
        updateCallUIInfo(payload.senderId, payload.mode, "邀请你进行通话...");
        setText("callName", peerName);
        showEl("callPanel");
        setCallActionLayout('incoming');
      }
      clearTimeout(outgoingTimeoutTimer);
      clearTimeout(incomingTimeoutTimer);
      incomingTimeoutTimer = setTimeout(() => { if (state.rtc.phase === 'incoming' && isCurrentCallPayload(payload)) { finalizeCall({ alertText: '来电已超时', event: 'reject', reason: 'timeout' }); } }, DELAYS.INCOMING_CALL_TIMEOUT);
      if (state.activeConversation?.id !== payload.conversationId) window.openConversation(payload.conversationId, { skipFetch: true });
      syncCallConversationState(payload.conversationId, payload.senderId, payload.senderName || payload.senderId);
      setText("chatSubtitle", payload.mode === 'video' ? '收到视频来电' : '收到语音来电');
      if (state.rtc.pendingAccept && $("acceptCallBtn")) $("acceptCallBtn").click();
    } else if (signal.type === 'answer' && state.rtc.pc) {
      if (!isCurrentCallPayload(payload)) return;
      clearTimeout(outgoingTimeoutTimer); state.rtc.callId = payload.callId || state.rtc.callId || null; setRtcPhase('connecting'); await state.rtc.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      scheduleConnectTimeout();
      await flushQueuedRemoteCandidates();

      let peerName = payload.senderName || state.rtc.peerId;
      const f = findFriendEntry(state.rtc.peerId);
      if(f) peerName = f.friend.remark || f.friend.displayName;

      markCallConnecting(state.rtc.peerId, state.rtc.mode, '对方已接听，建立连接中...');
      setText("callName", peerName);
    } else if (signal.type === 'candidate') {
      if (!isCurrentCallPayload(payload)) return;
      if (state.rtc.pc && state.rtc.pc.remoteDescription) {
        try { await state.rtc.pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (err) { console.warn('[webrtc] addIceCandidate failed:', err); }
      } else {
        state.rtc.remoteCandidateQueue = state.rtc.remoteCandidateQueue || [];
        state.rtc.remoteCandidateQueue.push(signal.candidate);
        if ((state.rtc.pendingOffer || state.rtc.pc) && state.rtc.incomingMeta?.senderId === payload.senderId) {
          state.rtc.earlyCandidates = state.rtc.earlyCandidates || [];
          state.rtc.earlyCandidates.push(signal.candidate);
        }
      }
    }
  } catch (err) { console.warn('[sse] webrtc_signal handler error', err); } });

  _on('call_event', (e) => { try {
    const payload = safeParseEventData(e);
    if (!payload) return;
    if (payload.event === 'start') {
      if (isIgnoredCallPayload(payload)) return;
      if (hasActiveCallSession() && !isSameIncomingCall(payload)) { autoBusyIncomingCall(payload); return; }
      state.rtc.callId = payload.callId || state.rtc.callId || null;
      state.rtc.peerId = payload.senderId || state.rtc.peerId || null;
      state.rtc.conversationId = payload.conversationId;
      state.rtc.incomingMeta = {
        senderId: payload.senderId,
        senderName: payload.senderName || state.rtc.incomingMeta?.senderName || null,
        mode: payload.mode,
        conversationId: payload.conversationId,
        callId: payload.callId || state.rtc.callId || null
      };
      setRtcPhase('incoming');
      if (shouldPresentIncomingUI(payload)) {
        updateCallUIInfo(payload.senderId, payload.mode, "收到来电");
        showEl("callPanel");
        setCallActionLayout('incoming');
      }
      clearTimeout(incomingTimeoutTimer);
      incomingTimeoutTimer = setTimeout(() => { if (state.rtc.phase === 'incoming' && isCurrentCallPayload(payload)) { finalizeCall({ alertText: '来电已超时', event: 'reject', reason: 'timeout' }); } }, DELAYS.INCOMING_CALL_TIMEOUT);
      if (state.activeConversation?.id !== payload.conversationId) window.openConversation(payload.conversationId, { skipFetch: true });
      syncCallConversationState(payload.conversationId, payload.senderId, payload.senderName || payload.senderId);
      setText("chatSubtitle", payload.mode === 'video' ? '收到视频来电' : '收到语音来电');
      return;
    }
    if (payload.event === 'accept') {
      if (!isCurrentCallPayload(payload)) return;
      clearTimeout(outgoingTimeoutTimer);
      clearTimeout(incomingTimeoutTimer);
      state.rtc.callId = payload.callId || state.rtc.callId || null;
      syncCallConversationState(payload.conversationId || state.rtc.conversationId, state.rtc.peerId || payload.senderId, payload.senderName || '');
      markCallConnecting(state.rtc.peerId || payload.senderId, payload.mode || state.rtc.mode, '对方已接听，建立连接中...');
      setText("chatSubtitle", '建立连接中…');
      scheduleConnectTimeout();
      return;
    }
    if (payload.event === 'cancel' || payload.event === 'reject' || payload.event === 'end') {
      if (!isCurrentCallPayload(payload)) return;
      if (payload.event === 'cancel') finalizeCall({ alertText: state.rtc.phase === 'incoming' ? '对方已取消通话' : '通话已取消' });
      else if (payload.reason === 'busy') finalizeCall({ alertText: "对方忙线中" });
      else if (payload.reason === 'timeout') finalizeCall({ alertText: state.rtc.phase === 'incoming' ? '来电已超时' : '对方无应答' });
      else if (payload.reason === 'disconnect') finalizeCall({ alertText: '通话已中断' });
      else if (payload.reason === 'connect_timeout') finalizeCall({ alertText: '连接超时，通话已结束' });
      else if (payload.event === 'reject') finalizeCall({ alertText: '对方已拒绝通话' });
      else finalizeCall({ alertText: '通话已结束' });
      if (state.activeConversation && state.activeConversation.id === (payload.conversationId || state.activeConversation.id)) {
        applyChatRelationshipState();
      }
    }
  } catch (err) { console.warn('[sse] call_event handler error', err); } });
  state._sseRetryCount = (state._sseRetryCount || 0);
  state.eventSource.onopen = () => {
    state._sseRetryCount = 0;
    updateSseStatus('connected');
    // Backfill messages after reconnect to avoid missing data during disconnect
    if (state.currentUser) {
      loadConversations().catch(() => {});
      if (state.activeConversation) fetchMessages().catch(() => {});
      loadFriendRequests().catch(() => {});
    }
  };
  state.eventSource.onerror = () => {
    if (state.eventSource) {
      // Clean up all listeners before closing to prevent memory leak
      if (state._sseHandlers) { for (const [evt, fn] of state._sseHandlers) state.eventSource.removeEventListener(evt, fn); }
      state._sseHandlers = [];
      state.eventSource.close();
      state.eventSource = null;
    }
    state._sseRetryCount = (state._sseRetryCount || 0) + 1;
    if (state._sseRetryCount > 10) {
      console.warn('[sse] max retries reached, stopping reconnect');
      updateSseStatus('disconnected');
      return;
    }
    updateSseStatus('reconnecting');
    // Skip reconnect if offline — will reconnect when online event fires
    if (!navigator.onLine) return;
    const delay = Math.min(1500 * Math.pow(2, state._sseRetryCount - 1), 30000);
    setTimeout(() => { if (state.currentUser) connectRealtime().catch(() => {}); }, delay);
  };
  } finally { _connectRealtimeInFlight = false; }
}

// Reconnect SSE when page becomes visible again
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.currentUser && navigator.onLine) {
    state._sseRetryCount = 0;
    if (!state.eventSource) {
      connectRealtime().catch(() => {});
    }
  }
});
