/* app_calling.js — WebRTC calling & native bridge extracted from app.js */

let callTimer = null; let callStartTime = 0; let outgoingTimeoutTimer = null; let incomingTimeoutTimer = null; let connectTimeoutTimer = null; let lastCallAttemptAt = 0;
// Cached call-panel DOM elements (populated lazily, cleared on stopCall)
let _callEls = null;
function _getCallEls() {
  if (_callEls) return _callEls;
  _callEls = {
    callDuration: $("callDuration"), callTitle: $("callTitle"), callName: $("callName"),
    callAvatar: $("callAvatar"), callPanel: $("callPanel"), callInfo: $("callInfo"),
    videoContainer: $("videoContainer"), callControls: $("callControls"),
    acceptCallBtn: $("acceptCallBtn"), rejectCallBtn: $("rejectCallBtn"),
    hangupBtn: $("hangupBtn"), toggleCameraBtn: $("toggleCameraBtn"),
    toggleMuteBtn: $("toggleMuteBtn"), muteText: $("muteText"),
    cameraText: $("cameraText"), localVideo: $("localVideo"),
    remoteVideo: $("remoteVideo"), chatSubtitle: $("chatSubtitle"),
  };
  return _callEls;
}
function _clearCallEls() { _callEls = null; _cachedDurationEl = null; }
document.addEventListener('visibilitychange', () => {
  if (document.hidden && callTimer && !hasActiveCallSession()) {
    clearInterval(callTimer); callTimer = null;
  }
  if (!document.hidden && !callTimer && hasActiveCallSession() && state.rtc.phase === 'connected' && callStartTime) {
    updateCallDuration();
    callTimer = setInterval(updateCallDuration, 1000);
  }
});
let _cachedDurationEl = null;
function updateCallDuration() { if(!callStartTime) return; const diff = Math.floor((Date.now() - callStartTime) / 1000); const m = String(Math.floor(diff / 60)).padStart(2, '0'); const s = String(diff % 60).padStart(2, '0'); if(!_cachedDurationEl) _cachedDurationEl = _getCallEls().callDuration; if(_cachedDurationEl) _cachedDurationEl.textContent = `${m}:${s}`; }
function scheduleConnectTimeout(){
  clearTimeout(connectTimeoutTimer);
  connectTimeoutTimer = setTimeout(() => {
    if(state.rtc.phase === 'connecting'){
      finalizeCall({ alertText: '连接超时', event: 'cancel', reason: 'connect_timeout' });
    }
  }, 30000);
}
function clearAllCallTimers(){
  clearTimeout(outgoingTimeoutTimer); outgoingTimeoutTimer = null;
  clearTimeout(incomingTimeoutTimer); incomingTimeoutTimer = null;
  clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null;
  _cachedDurationEl = null;
}
function describeMediaAccessError(err, mode) {
  const name = err && err.name ? err.name : '';
  const isAndroid = !!(window.__NATIVE_ANDROID__ && window.NativeBridge);
  const settingsHint = isAndroid ? '请前往系统设置 → 应用 → ChatTrade → 权限 中开启。' : '请在浏览器设置中允许访问。';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return (mode === 'video' ? '摄像头或麦克风权限被拒绝，' : '麦克风权限被拒绝，') + settingsHint;
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return mode === 'video' ? '未检测到可用的摄像头或麦克风设备。' : '未检测到可用的麦克风设备。';
  if (name === 'NotReadableError' || name === 'TrackStartError') return mode === 'video' ? '摄像头或麦克风当前被其他程序占用。' : '麦克风当前被其他程序占用。';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return '当前设备不支持所需的通话能力。';
  return (mode === 'video' ? '无法开启摄像头/麦克风权限，' : '无法开启麦克风权限，') + settingsHint;
}
function isIgnoredCallPayload(payload) {
  if (!payload) return true;
  return Boolean(payload.callId && state.rtc.lastEndedCallId && payload.callId === state.rtc.lastEndedCallId);
}
function isCurrentCallPayload(payload) {
  if (!payload || isIgnoredCallPayload(payload)) return false;
  // Both have callId → compare; either has callId but not the other → mismatch
  if (state.rtc.callId || payload.callId) return state.rtc.callId === payload.callId;
  return true;
}
function buildIncomingCallKey(payload) {
  if (!payload) return '';
  if (payload.callId) return `call:${payload.callId}`;
  return `fallback:${payload.conversationId || ''}:${payload.senderId || ''}:${payload.mode || ''}`;
}

function autoBusyIncomingCall(ev){
  try{
    showToast('正在通话中，已自动拒绝新来电');
    // send busy to remote
    const cid = ev.conversationId || state.rtc.conversationId;
    const pid = ev.senderId;
    const mode = ev.mode || 'voice';
    if (cid && pid) {
      api(`/api/conversations/${cid}/call`, { method: 'POST', body: JSON.stringify({ senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: pid, event: 'reject', mode, reason: 'busy', callId: ev.callId || null }) }).catch(() => {});
    }
    insertCallRecordMessage(ev, { reason: 'busy' });
  }catch(_){}
}
function shouldPresentIncomingUI(payload) {
  const key = buildIncomingCallKey(payload);
  if (!key) return true;
  if (state.rtc.incomingShownKey === key) return false;
  state.rtc.incomingShownKey = key;
  return true;
}
async function enqueueSignal(conversationId, payload) {
  try {
    await api(`/api/conversations/${conversationId}/signal`, { method: 'POST', body: JSON.stringify(payload) });
  } catch (err) {
    console.warn('[call] signal delivery failed:', err?.message || err);
    if (state.rtc.phase && state.rtc.phase !== 'idle') {
      showToast('通话信号发送失败，通话可能中断');
    }
  }
}

// Cached friends lookup map — rebuilt lazily when friends change
let _friendsById = null; let _friendsByIdSig = null;
function _getFriendsById() {
  const sig = state.friends || null;
  if (_friendsById && _friendsByIdSig === sig) return _friendsById;
  _friendsById = new Map();
  if (state.friends) {
    for (const f of state.friends) {
      if (!f.friend) continue;
      if (f.friend.id) _friendsById.set(f.friend.id, f);
      if (f.friend.username) _friendsById.set(f.friend.username, f);
      if (f.friend.friendId) _friendsById.set(f.friend.friendId, f);
    }
  }
  _friendsByIdSig = sig;
  return _friendsById;
}
function resolveCallPeerMeta(peerId, fallbackName = '') {
  let name = fallbackName || peerId || '';
  let avatarUrl = null;
  const friend = _getFriendsById().get(peerId);
  if (friend) {
    name = friend.friend.remark || friend.friend.displayName || friend.friend.username || name;
    avatarUrl = friend.friend.avatarUrl || null;
    return { name, avatarUrl };
  }
  if (state.activeConversation && conversationPeerId(state.activeConversation) === peerId) {
    name = state.activeConversation.title || name;
    avatarUrl = state.activeConversation.peerAvatarUrl || avatarUrl;
  }
  if (state.currentProfileUser && (state.currentProfileUser.id === peerId || state.currentProfileUser.username === peerId)) {
    name = state.currentProfileUser.remarkName || state.currentProfileUser.displayName || state.currentProfileUser.username || name;
    avatarUrl = state.currentProfileUser.avatarUrl || avatarUrl;
  }
  if (state.rtc.pendingOffer && state.rtc.pendingOffer.senderId === peerId && state.rtc.pendingOffer.senderName) {
    name = state.rtc.pendingOffer.senderName;
  }
  if (state.rtc.incomingMeta && state.rtc.incomingMeta.senderId === peerId && state.rtc.incomingMeta.senderName) {
    name = state.rtc.incomingMeta.senderName;
  }
  return { name, avatarUrl };
}
async function flushQueuedRemoteCandidates() {
  if (!state.rtc.pc || !state.rtc.pc.remoteDescription) return;
  const queued = Array.isArray(state.rtc.remoteCandidateQueue) ? state.rtc.remoteCandidateQueue.splice(0) : [];
  for (const cand of queued) {
    try { await state.rtc.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) { console.warn('[webrtc] addIceCandidate failed:', e); }
  }
}
function updateCallUIInfo(peerId, mode, statusText) {
  const els = _getCallEls();
  if(els.callTitle) els.callTitle.textContent = statusText;
  const meta = resolveCallPeerMeta(peerId, peerId);
  if(els.callName) els.callName.textContent = meta.name || peerId || '';
  setAvatarContainer(els.callAvatar, {avatarUrl: meta.avatarUrl, displayName: meta.name}, meta.name || peerId || '');
  if(els.toggleCameraBtn) els.toggleCameraBtn.classList.toggle('hidden', mode !== 'video');
}
window.setCallActionLayout = (layout) => {
  const els = _getCallEls();
  if(els.acceptCallBtn) els.acceptCallBtn.classList.toggle('hidden', layout !== 'incoming');
  if(els.rejectCallBtn) els.rejectCallBtn.classList.toggle('hidden', layout !== 'incoming');
  if(els.hangupBtn) els.hangupBtn.classList.toggle('hidden', layout === 'incoming');
  if(els.callControls) els.callControls.classList.toggle('hidden', layout !== 'connected');

  if (layout === 'connected') {
      const isVideo = state.rtc.mode === 'video';
      if(els.callInfo) els.callInfo.classList.toggle('hidden', isVideo);
      if(els.videoContainer) els.videoContainer.classList.toggle('hidden', !isVideo);
      callStartTime = Date.now();
      if(els.callDuration) els.callDuration.classList.remove('hidden');
      if(callTimer) clearInterval(callTimer);
      callTimer = setInterval(updateCallDuration, 1000);
  } else {
      if(els.callInfo) els.callInfo.classList.remove('hidden');
      if(els.videoContainer) els.videoContainer.classList.add('hidden');
      if(els.callDuration) els.callDuration.classList.add('hidden');
  }
};

function hasActiveCallSession() {
  return Boolean(state.rtc.pc || state.rtc.pendingOffer || state.rtc.incomingMeta || state.rtc.phase === 'outgoing' || state.rtc.phase === 'incoming' || state.rtc.phase === 'connecting' || state.rtc.phase === 'connected');
}
function isSameIncomingCall(payload) {
  if (!payload || isIgnoredCallPayload(payload)) return false;
  const incoming = state.rtc.incomingMeta || state.rtc.pendingOffer;
  if (!incoming) return false;
  if (incoming.callId && payload.callId) return incoming.callId === payload.callId;
  if (incoming.conversationId !== payload.conversationId) return false;
  if (incoming.senderId !== payload.senderId) return false;
  return true;
}
function markCallConnecting(peerId, mode, statusText = '建立连接中...') {
  setRtcPhase('connecting');
  updateCallUIInfo(peerId, mode, statusText);
  const els = _getCallEls();
  if (els.callPanel) els.callPanel.classList.remove('hidden');
  setCallActionLayout('outgoing');
}
function setRtcPhase(phase) {
  const prev = state.rtc.phase;
  state.rtc.phase = phase;
  // Native bridge: start foreground service when call connects, stop when idle
  if (phase === 'connected' && prev !== 'connected') {
    const peerName = state.rtc.incomingMeta?.senderName || state.rtc.peerId || '通话';
    nativeOnCallConnected(peerName, state.rtc.mode);
  }
  if (phase === 'idle' && prev !== 'idle') {
    nativeOnCallEnded();
  }
}
function isRingingPhase() {
  return state.rtc.phase === 'outgoing' || state.rtc.phase === 'incoming' || state.rtc.phase === 'connecting';
}
function getCallDurationSeconds() {
  if (!callStartTime) return 0;
  return Math.max(0, Math.round((Date.now() - callStartTime) / 1000));
}
function syncCallConversationState(conversationId, peerId, fallbackName = '') {
  try {
    // Use state._convById Map for O(1) lookup when available, else linear scan
    let conv = state._convById ? (state._convById.get(conversationId) || null) : null;
    if (!conv) { const convs = state.conversations || []; for (let i = 0; i < convs.length; i++) { if (convs[i].id === conversationId) { conv = convs[i]; break; } } }
    const meta = resolveCallPeerMeta(peerId, conv?.title || fallbackName || peerId);
    if (state.activeConversation && state.activeConversation.id === conversationId) {
      state.activeConversation.title = conv?.title || meta.name || state.activeConversation.title || '';
      state.activeConversation.peerAvatarUrl = conv?.peerAvatarUrl || meta.avatarUrl || state.activeConversation.peerAvatarUrl || '';
      const chatTitleEl = $("chatTitle");
      if (chatTitleEl) chatTitleEl.textContent = state.activeConversation.title || '会话';
    }
  } catch(_) {}
}
function refreshAfterCallStateChange(conversationId) {
  try {
    sortConversationsInPlace();
    scheduleRenderConversationList();
    loadConversations().catch(() => {});
    if (conversationId && state.activeConversation && state.activeConversation.id === conversationId) {
      Promise.resolve().then(async () => {
        try { await fetchMessages(); refreshMessageReadReceipts(); } catch(_) {}
      });
    }
  } catch(_) {}
}
async function notifyRemoteCallEvent(event, reason) {
  const cid = state.rtc.conversationId;
  const pid = state.rtc.peerId || state.rtc.incomingMeta?.senderId || state.rtc.pendingOffer?.senderId;
  const mode = state.rtc.mode || state.rtc.pendingOffer?.mode || state.rtc.incomingMeta?.mode || 'voice';
  if (!cid || !pid) return;
  try {
    await api(`/api/conversations/${cid}/call`, { method: 'POST', body: JSON.stringify({ senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: pid, event, mode, reason, callId: state.rtc.callId || state.rtc.pendingOffer?.callId || state.rtc.incomingMeta?.callId || null, durationSec: getCallDurationSeconds() }) });
  } catch (_) {}
}

function insertCallRecordMessage(ev, meta = {}){
  try{
    const mode = (ev.mode || meta.mode || 'audio') === 'video' ? '视频通话' : '语音通话';
    const reason = meta.reason || ev.reason || '';
    let text = '';
    if(reason === 'busy') text = `${mode}（对方忙线）`;
    else if(reason === 'timeout') text = `未接${mode}`;
    else if(reason === 'cancel') text = `已取消${mode}`;
    else if(reason === 'reject') text = `对方已拒绝${mode}`;
    else if(reason === 'end' && typeof meta.durationSec === 'number') {
      const m = String(Math.floor(meta.durationSec/60)).padStart(2,'0');
      const s = String(Math.floor(meta.durationSec%60)).padStart(2,'0');
      text = `${mode} ${m}:${s}`;
    } else if(reason === 'end') text = `${mode} 已结束`;
    if(!text) return;

    const cid = ev.conversationId || state.activeConversation?.id;
    if(!cid) return;

    // only append into current conversation UI
    if(state.activeConversation?.id !== cid) return;

    const msg = { id: 'call_'+Date.now(), senderId: 'system', type:'system', text, createdAt: Date.now() };
    if (!state.messages) state.messages = [];
    state.messages.push(msg);
    appendMessageToView(msg);
    applyLastOutgoingReadState();
  }catch(_){}
}

function finalizeCall(options = {}) {
  const { alertText = '', event = '', reason = '' } = options;
  if (!hasActiveCallSession()) {
    if (alertText) showModal(alertText);
    return;
  }
  const callConversationId = state.rtc.conversationId || state.activeConversation?.id || null;
  const callMode = state.rtc.mode || state.rtc.pendingOffer?.mode || state.rtc.incomingMeta?.mode || 'voice';
  const callPeerId = state.rtc.peerId || state.rtc.incomingMeta?.senderId || state.rtc.pendingOffer?.senderId || null;
  const durationSec = getCallDurationSeconds();
  const shouldNotify = event && !state.rtc.endingLocally && callPeerId;
  if (shouldNotify) {
    state.rtc.endingLocally = true;
    notifyRemoteCallEvent(event, reason).finally(() => { state.rtc.endingLocally = false; });
  }
  window.stopCall();
  // Insert call record after stopCall so conversation state is available
  if (event && callConversationId) {
    insertCallRecordMessage({ conversationId: callConversationId, mode: callMode, senderId: callPeerId }, { reason: reason || event, durationSec });
  }
  if (alertText) showModal(alertText);
}
window.stopCall = () => {
  if (typeof window._stopCallWithBubble === 'function') window._stopCallWithBubble();
  // Dismiss native call notification before resetting RTC state
  if (state.rtc.phase !== 'idle') nativeOnCallEnded();
  const endedCallId = state.rtc.callId || state.rtc.pendingOffer?.callId || state.rtc.incomingMeta?.callId || state.rtc.lastEndedCallId || null;
  if (state.rtc.pc) {
    try { state.rtc.pc.onicecandidate = null; state.rtc.pc.ontrack = null; state.rtc.pc.onconnectionstatechange = null; state.rtc.pc.oniceconnectionstatechange = null; } catch(_) {}
    state.rtc.pc.close();
  }
  if (state.rtc.localStream) { const trks = state.rtc.localStream.getTracks(); for (let i = 0; i < trks.length; i++) trks[i].stop(); }
  if (state.rtc.remoteStream) { const trks = state.rtc.remoteStream.getTracks(); for (let i = 0; i < trks.length; i++) trks[i].stop(); }
  const convId = state.activeConversation?.id || state.rtc?.conversationId || null;
  state.rtc = { pc: null, mode: null, peerId: null, pendingOffer: null, incomingMeta: null, pendingAccept: false, earlyCandidates: [], phase: 'idle', endingLocally: false, conversationId: null, callId: null, lastEndedCallId: endedCallId, incomingShownKey: null, localStream: null, remoteStream: null, remoteCandidateQueue: [], _accepting: false, _starting: false };
  const els = _getCallEls();
  if(els.localVideo) els.localVideo.srcObject = null; if(els.remoteVideo) els.remoteVideo.srcObject = null; if(els.callPanel) els.callPanel.classList.add('hidden');
  isMuted = false; isCameraOff = false; isSpeaker = true;
  if(els.toggleMuteBtn) { els.toggleMuteBtn.classList.add('active'); els.toggleMuteBtn.style.color = '#fff'; } if(els.muteText) els.muteText.textContent = "静音";
  if(els.toggleCameraBtn) { els.toggleCameraBtn.classList.add('active'); els.toggleCameraBtn.style.color = '#fff'; } if(els.cameraText) els.cameraText.textContent = "镜头";
  clearInterval(callTimer); callTimer = null; callStartTime = 0; clearAllCallTimers();
  if(els.callDuration) { els.callDuration.classList.add('hidden'); els.callDuration.textContent = "00:00"; }
  _clearCallEls(); // Invalidate cache for next call session
  refreshAfterCallStateChange(convId);
};

async function createPeerConnection(mode) {
  // Acquire media FIRST - if this fails, we don't create a PC with orphaned listeners
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' });
  } catch (err) {
    throw new Error(describeMediaAccessError(err, mode));
  }
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  state.rtc.pc = pc; state.rtc.mode = mode; state.rtc.remoteStream = new MediaStream(); state.rtc.remoteCandidateQueue = []; state.rtc.localStream = stream;
  const _pcEls = _getCallEls();
  if(_pcEls.remoteVideo) _pcEls.remoteVideo.srcObject = state.rtc.remoteStream;
  if(_pcEls.localVideo) _pcEls.localVideo.srcObject = stream;
  { const trks = stream.getTracks(); for (let i = 0; i < trks.length; i++) pc.addTrack(trks[i], stream); }
  pc.onicecandidate = async (e) => {
    if (e.candidate && state.rtc.peerId && state.rtc.conversationId) {
      enqueueSignal(state.rtc.conversationId, { senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: state.rtc.peerId, mode, callId: state.rtc.callId, signal: { type: 'candidate', candidate: e.candidate } });
    }
  };
  pc.ontrack = (e) => {
    { const trks = e.streams[0].getTracks(); for (let i = 0; i < trks.length; i++) state.rtc.remoteStream.addTrack(trks[i]); }
    if (state.rtc.phase !== 'connected') {
      clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null;
      setRtcPhase('connected');
      updateCallUIInfo(state.rtc.peerId, state.rtc.mode, '通话中');
      const _els = _getCallEls();
      if(_els.chatSubtitle) _els.chatSubtitle.textContent = state.rtc.mode === 'video' ? '视频通话中' : '语音通话中';
      setCallActionLayout('connected');
    }
  };
  const markConnected = () => {
    clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null;
    setRtcPhase('connected');
    updateCallUIInfo(state.rtc.peerId, state.rtc.mode, '通话中');
    setCallActionLayout('connected');
  };
  let _iceDisconnectTimer = null;
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') { clearTimeout(_iceDisconnectTimer); _iceDisconnectTimer = null; markConnected(); return; }
    if (st === 'failed') { clearTimeout(_iceDisconnectTimer); finalizeCall({ alertText: '通话已中断', event: 'end', reason: 'disconnect' }); }
    else if (st === 'disconnected') {
      clearTimeout(_iceDisconnectTimer);
      _iceDisconnectTimer = setTimeout(() => { if (pc.connectionState === 'disconnected') finalizeCall({ alertText: '通话已中断', event: 'end', reason: 'disconnect' }); }, 5000);
    }
  };
  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'connected' || st === 'completed') { clearTimeout(_iceDisconnectTimer); _iceDisconnectTimer = null; markConnected(); return; }
    if (st === 'failed') { clearTimeout(_iceDisconnectTimer); finalizeCall({ alertText: '通话已中断', event: 'end', reason: 'disconnect' }); }
    else if (st === 'disconnected') {
      clearTimeout(_iceDisconnectTimer);
      _iceDisconnectTimer = setTimeout(() => { if (pc.iceConnectionState === 'disconnected') finalizeCall({ alertText: '通话已中断', event: 'end', reason: 'disconnect' }); }, 5000);
    }
  };
}

window.startCall = async (mode) => {
  if (state.rtc._starting) return;
  if (hasActiveCallSession()) return showModal('当前已有通话进行中');
  const now = Date.now();
  if (now - lastCallAttemptAt < 1200) return showModal('操作过快，请稍后再试');
  lastCallAttemptAt = now;
  const peerId = conversationPeerId(state.activeConversation); if (!peerId) return showModal('仅支持单聊进行通话');
  // On Android native app, ensure mic (and camera for video) permissions before starting call
  if (window.__NATIVE_ANDROID__ && window.NativeBridge) {
    const needMic = !window.NativeBridge.hasMicrophonePermission();
    const needCam = mode === 'video' && !window.NativeBridge.hasCameraPermission();
    if (needMic || needCam) {
      if (needMic && needCam) window.NativeBridge.requestCameraAndMicrophonePermission();
      else if (needMic) window.NativeBridge.requestMicrophonePermission();
      else window.NativeBridge.requestCameraPermission();
      await new Promise(r => setTimeout(r, 1500));
      if (!window.NativeBridge.hasMicrophonePermission()) return showModal('需要麦克风权限才能通话，请在设置中开启');
      if (mode === 'video' && !window.NativeBridge.hasCameraPermission()) return showModal('需要摄像头权限才能视频通话，请在设置中开启');
    }
  }
  state.rtc._starting = true;
  try {
    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    state.rtc.conversationId = state.activeConversation.id; state.rtc.peerId = peerId; state.rtc.callId = callId; setRtcPhase('outgoing'); await createPeerConnection(mode); const offer = await state.rtc.pc.createOffer(); await state.rtc.pc.setLocalDescription(offer);
    const peerMeta = resolveCallPeerMeta(peerId, state.activeConversation?.title || peerId);
    syncCallConversationState(state.rtc.conversationId, peerId, peerMeta.name || peerId);
    updateCallUIInfo(peerId, mode, "等待对方接听...");
    const _startEls = _getCallEls();
    if(_startEls.callName) _startEls.callName.textContent = peerMeta.name; if(_startEls.callPanel) _startEls.callPanel.classList.remove('hidden'); setCallActionLayout('outgoing');
    if(_startEls.chatSubtitle) _startEls.chatSubtitle.textContent = mode === 'video' ? '视频通话邀请中…' : '语音通话邀请中…';
    api(`/api/conversations/${state.rtc.conversationId}/call`, { method: 'POST', body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: peerId, event: 'start', mode, callId, senderName: state.currentUser.displayName }) }).catch(() => {});
    enqueueSignal(state.rtc.conversationId, { senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: peerId, mode, callId, signal: { type: 'offer', sdp: offer } });
    outgoingTimeoutTimer = setTimeout(() => { finalizeCall({ alertText: "对方无应答", event: 'cancel', reason: 'timeout' }); }, 30000);
  } catch (e) { window.stopCall(); showModal(e && e.message ? e.message : describeMediaAccessError(e, mode)); } finally { state.rtc._starting = false; }
}

function safeParseEventData(event) {
  try {
    return JSON.parse(event.data);
  } catch (error) {
    console.warn('[sse] invalid event payload', error);
    return null;
  }
}

const isNativeAndroid = () => !!(window.__NATIVE_ANDROID__ && window.NativeBridge);

/**
 * Bind EMAS push alias after login so push is routed to this user.
 */
function nativeOnLogin(userId) {
  if (!isNativeAndroid()) return;
  try { window.NativeBridge.bindPushAlias(userId); } catch (_) {}
}

/**
 * Unbind push alias on logout.
 */
function nativeOnLogout(userId) {
  if (!isNativeAndroid()) return;
  try { window.NativeBridge.unbindPushAlias(userId); } catch (_) {}
  try { window.NativeBridge.stopCallService(); } catch (_) {}
}

/**
 * Start native foreground service when call connects.
 * Shows persistent notification so Android doesn't kill the app.
 */
function nativeOnCallConnected(peerName, mode) {
  if (!isNativeAndroid()) return;
  try { window.NativeBridge.startCallService(peerName || '通话中', mode || 'voice'); } catch (_) {}
}

/**
 * Stop native foreground service when call ends.
 */
function nativeOnCallEnded() {
  if (!isNativeAndroid()) return;
  try { window.NativeBridge.stopCallService(); } catch (_) {}
  try { window.NativeBridge.dismissCallNotification(); } catch (_) {}
}

/**
 * Handle incoming call action from native IncomingCallActivity.
 * Native side calls this after user taps Accept/Reject on the native call screen.
 */
window.__onNativeCallAction = (action, callerId, callerName, conversationId, callId, callMode) => {
  if (action === 'accept_call') {
    if (!conversationId) return;
    // Set up call state BEFORE opening conversation to avoid race with SSE offer.
    // If the SSE webrtc_signal arrives while openConversation is in progress,
    // pendingAccept must already be true so the auto-click at line 6989 fires.
    state.rtc.pendingAccept = true;
    state.rtc.callId = callId || state.rtc.callId || null;
    state.rtc.conversationId = conversationId;
    if (callerId) {
      state.rtc.incomingMeta = state.rtc.incomingMeta || {
        senderId: callerId,
        senderName: callerName || callerId,
        mode: callMode || 'voice',
        conversationId: conversationId,
        callId: callId || null
      };
    }
    // Use skipFetch: true to open the conversation UI immediately without
    // blocking on network; messages will load lazily in the background.
    window.openConversation(conversationId, { skipFetch: true }).then(() => {
      // If the pendingOffer already arrived via SSE, auto-click accept now
      if (state.rtc.pendingOffer && state.rtc.pendingAccept) {
        const _els = _getCallEls(); if (_els.acceptCallBtn) _els.acceptCallBtn.click();
      }
    }).catch(() => {});
  } else if (action === 'reject_call') {
    // Send reject signal to server
    if (conversationId && callerId) {
      api(`/api/conversations/${conversationId}/call`, {
        method: 'POST',
        body: JSON.stringify({
          senderId: state.currentUser?.id,
          targetUserId: callerId,
          event: 'reject',
          reason: 'user_reject',
          callId: callId || null
        })
      }).catch(() => {});
    }
  }
};

/**
 * Bridge ready callback — native side calls this after WebView loads.
 */
window.__onNativeBridgeReady = () => {
  // If already logged in, bind push
  if (state.currentUser?.id) {
    nativeOnLogin(state.currentUser.id);
  }
};
