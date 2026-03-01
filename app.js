const ORDER_FLOW = ["待付款", "待发货", "运输中", "待收货", "已完成"];
const SESSION_KEY = "chattrade_api_session_user";

const $ = (id) => document.getElementById(id);
const authScreen = $("authScreen");
const appScreen = $("appScreen");
const loginTab = $("loginTab");
const registerTab = $("registerTab");
const loginForm = $("loginForm");
const registerForm = $("registerForm");

const messagesTab = $("messagesTab");
const friendsTab = $("friendsTab");
const publishTab = $("publishTab");
const mallTab = $("mallTab");
const profileTab = $("profileTab");
const chatListView = $("chatListView");
const friendListView = $("friendListView");
const mallView = $("mallView");
const profileView = $("profileView");
const chatView = $("chatView");
const composerPanel = $("composerPanel");
const homeTabbar = $("homeTabbar");

const chatList = $("chatList");
const friendList = $("friendList");
const chatTitle = $("chatTitle");
const chatSubtitle = $("chatSubtitle");
const backBtn = $("backBtn");
const moreBtn = $("moreBtn");
const newChatBtn = $("newChatBtn");
const addFriendBtn = $("addFriendBtn");
const searchInput = $("searchInput");
const friendSearchInput = $("friendSearchInput");
const mallSearchInput = $("mallSearchInput");
const quickShareMallBtn = $("quickShareMallBtn");
const mallCardBtn = $("mallCardBtn");
const profileDisplayName = $("profileDisplayName");
const profileUsername = $("profileUsername");
const globalNotifyBtn = $("globalNotifyBtn");
const clearCacheBtn = $("clearCacheBtn");
const logoutBtn = $("logoutBtn");
const publishSheet = $("publishSheet");
const publishProductBtn = $("publishProductBtn");
const closePublishSheetBtn = $("closePublishSheetBtn");
const plusMenuSheet = $("plusMenuSheet");
const scanAddFriendBtn = $("scanAddFriendBtn");
const createGroupBtn = $("createGroupBtn");
const quickAddFriendBtn = $("quickAddFriendBtn");
const closePlusMenuBtn = $("closePlusMenuBtn");
const profileAvatar = $("profileAvatar");
const profileRemarkName = $("profileRemarkName");
const profileNickName = $("profileNickName");
const profileSignature = $("profileSignature");
const profilePhone = $("profilePhone");
const profileAppId = $("profileAppId");
const profileProducts = $("profileProducts");
const profileDetailPage = $("profileDetailPage");
const messageSettingsPage = $("messageSettingsPage");
const searchHistoryBtn = $("searchHistoryBtn");
const muteSettingBtn = $("muteSettingBtn");
const pinConversationBtn = $("pinConversationBtn");
const blacklistBtn = $("blacklistBtn");
const deleteFriendBtn = $("deleteFriendBtn");
const clearChatBtn = $("clearChatBtn");
const composer = $("composer");
const messageInput = $("messageInput");
const imageInput = $("imageInput");
const actionPanel = $("actionPanel");
const toggleActionsBtn = $("toggleActionsBtn");

const callPanel = $("callPanel");
const callTitle = $("callTitle");
const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");
const acceptCallBtn = $("acceptCallBtn");
const rejectCallBtn = $("rejectCallBtn");
const hangupBtn = $("hangupBtn");

const textTemplate = $("textMessageTemplate");
const imageTemplate = $("imageMessageTemplate");
const cardTemplate = $("cardMessageTemplate");

const state = {
  currentUser: null,
  conversations: [],
  activeConversation: null,
  messages: [],
  friends: [],
  eventSource: null,
  refreshing: false,
  currentView: "messages",
  profileCache: new Map(),
  settings: {
    globalNotify: true,
  },
  secondaryPage: null,
  secondaryReturn: "home",
  rtc: {
    pc: null,
    localStream: null,
    remoteStream: null,
    mode: null,
    conversationId: null,
    peerId: null,
    pendingOffer: null,
    incomingMeta: null,
    pendingAccept: false,
  },
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "request_failed");
  return data;
}



function firstChar(text = '') {
  return String(text).trim().charAt(0) || '?';
}

function conversationPeerId(conv) {
  if (!conv || conv.type !== 'direct') return null;
  return (conv.members || []).find((id) => id !== state.currentUser.id) || null;
}

function fillAvatar(el, name, onClick) {
  if (!el) return;
  el.textContent = firstChar(name);
  if (onClick) {
    el.classList.add('clickable-avatar');
    el.onclick = onClick;
  } else {
    el.classList.remove('clickable-avatar');
    el.onclick = null;
  }
}

async function openUserProfile(userId, fallbackName = '用户') {
  if (!userId) return;
  const cacheKey = `${state.currentUser.id}:${userId}`;
  let profile = state.profileCache.get(cacheKey);
  if (!profile) {
    const data = await api(`/api/users/${encodeURIComponent(userId)}/profile?viewerId=${encodeURIComponent(state.currentUser.id)}`);
    profile = data.profile;
    state.profileCache.set(cacheKey, profile);
  }
  profileAvatar.textContent = profile.avatarText || firstChar(profile.remarkName || fallbackName);
  profileRemarkName.textContent = profile.remarkName || fallbackName;
  profileNickName.textContent = `昵称：${profile.nickname || '-'} `;
  profileSignature.textContent = `个性签名：${profile.signature || '未填写'}`;
  profilePhone.textContent = `手机号：${profile.phone || '未公开'}`;
  profileAppId.textContent = `号码ID：${profile.appNumberId || '-'}`;
  profileProducts.innerHTML = '';
  const products = profile.products || [];
  if (!products.length) {
    const empty = document.createElement('div');
    empty.className = 'preview';
    empty.textContent = '暂无发布商品';
    profileProducts.appendChild(empty);
  } else {
    products.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'chat-item';
      card.innerHTML = `<div class="avatar">${firstChar(item.title)}</div><div><strong>${item.title}</strong><div class="preview">￥${item.price || 0} · ${item.desc || ''}</div></div>`;
      profileProducts.appendChild(card);
    });
  }
  openSecondaryPage('profile', state.activeConversation ? 'chat' : 'home');
}

function openSecondaryPage(page, backTo = 'home') {
  state.secondaryPage = page;
  state.secondaryReturn = backTo;
  chatListView.classList.add('hidden');
  friendListView.classList.add('hidden');
  mallView.classList.add('hidden');
  profileView.classList.add('hidden');
  chatView.classList.add('hidden');
  composerPanel.classList.add('hidden');
  actionPanel.classList.add('hidden');
  homeTabbar.classList.add('hidden');
  profileDetailPage.classList.toggle('hidden', page !== 'profile');
  messageSettingsPage.classList.toggle('hidden', page !== 'settings');
  backBtn.classList.remove('hidden');
  if (page === 'profile') {
    chatTitle.textContent = '个人主页';
    chatSubtitle.textContent = '用户信息';
  }
  if (page === 'settings') {
    chatTitle.textContent = '消息设置';
    chatSubtitle.textContent = '会话管理';
  }
}

function closeSecondaryPage() {
  if (!state.secondaryPage) return false;
  const backTo = state.secondaryReturn;
  state.secondaryPage = null;
  profileDetailPage.classList.add('hidden');
  messageSettingsPage.classList.add('hidden');
  if (backTo === 'chat' && state.activeConversation) {
    backBtn.classList.remove('hidden');
    chatView.classList.remove('hidden');
    composerPanel.classList.remove('hidden');
    homeTabbar.classList.add('hidden');
    chatTitle.textContent = state.conversations.find((c) => c.id === state.activeConversation.id)?.title || '会话';
    chatSubtitle.textContent = state.activeConversation.type === 'group' ? `${state.activeConversation.members.length}人群聊` : '单聊';
    return true;
  }
  showHome();
  return true;
}

function setMainTab(tab) {
  if (tab === "publish") {
    publishSheet.classList.remove("hidden");
    return;
  }
  publishSheet.classList.add("hidden");
  state.currentView = tab;

  messagesTab.classList.toggle("active", tab === "messages");
  friendsTab.classList.toggle("active", tab === "friends");
  mallTab.classList.toggle("active", tab === "mall");
  profileTab.classList.toggle("active", tab === "profile");

  chatListView.classList.toggle("hidden", tab !== "messages");
  friendListView.classList.toggle("hidden", tab !== "friends");
  mallView.classList.toggle("hidden", tab !== "mall");
  profileView.classList.toggle("hidden", tab !== "profile");

  if (tab === "messages") {
    chatTitle.textContent = "消息";
    chatSubtitle.textContent = state.currentUser.displayName;
  } else if (tab === "friends") {
    chatTitle.textContent = "好友";
    chatSubtitle.textContent = "QQ式分组";
  } else if (tab === "mall") {
    chatTitle.textContent = "商城";
    chatSubtitle.textContent = "精选好物";
  } else {
    chatTitle.textContent = "我的";
    chatSubtitle.textContent = "账号与设置";
  }
}

function renderAuth(isLogin = true) {
  loginTab.classList.toggle("active", isLogin);
  registerTab.classList.toggle("active", !isLogin);
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
}

function showAuth() {
  appScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  plusMenuSheet.classList.add('hidden');
  profileDetailPage.classList.add('hidden');
  messageSettingsPage.classList.add('hidden');
  renderAuth(true);
}

function showHome() {
  state.activeConversation = null;
  state.messages = [];
  backBtn.classList.add("hidden");
  chatView.classList.add("hidden");
  composerPanel.classList.add("hidden");
  actionPanel.classList.add("hidden");
  profileDetailPage.classList.add('hidden');
  messageSettingsPage.classList.add('hidden');
  state.secondaryPage = null;
  homeTabbar.classList.remove("hidden");
  profileDisplayName.textContent = state.currentUser?.displayName || "未登录";
  profileUsername.textContent = `@${state.currentUser?.username || "guest"}`;
  setMainTab(state.currentView);
  renderChatList();
  renderFriendList();
}

async function loadConversations() {
  const data = await api(`/api/conversations?userId=${encodeURIComponent(state.currentUser.id)}`);
  state.conversations = data.conversations;
  renderChatList();
}

async function loadFriends() {
  const data = await api(`/api/friends?userId=${encodeURIComponent(state.currentUser.id)}`);
  state.friends = data.friends;
  renderFriendList();
}

function renderChatList() {
  const keyword = searchInput.value.trim().toLowerCase();
  chatList.innerHTML = "";
  state.conversations
    .filter((conv) => !keyword || conv.title.toLowerCase().includes(keyword) || conv.preview.toLowerCase().includes(keyword))
    .forEach((conv) => {
      const node = document.createElement("button");
      node.className = "chat-item";
      node.innerHTML = `
        <div class="avatar"></div>
        <div>
          <strong>${conv.title}</strong>
          <div class="preview">${conv.preview}</div>
        </div>
        ${conv.unread ? `<button class="unread-btn" type="button">${conv.unread}条未读</button>` : ""}
      `;
      const avatar = node.querySelector(".avatar");
      const peerId = conversationPeerId(conv);
      fillAvatar(avatar, conv.title, peerId ? (event) => {
        event.stopPropagation();
        openUserProfile(peerId, conv.title);
      } : null);
      node.addEventListener("click", () => openConversation(conv.id));
      chatList.appendChild(node);
    });
}

function renderFriendList() {
  const keyword = friendSearchInput.value.trim().toLowerCase();
  const grouped = new Map();
  state.friends
    .filter((f) => !keyword || f.friend.displayName.toLowerCase().includes(keyword) || f.friend.username.toLowerCase().includes(keyword))
    .forEach((f) => {
      if (!grouped.has(f.group)) grouped.set(f.group, []);
      grouped.get(f.group).push(f);
    });

  friendList.innerHTML = "";
  [...grouped.keys()].sort().forEach((groupName) => {
    const title = document.createElement("div");
    title.className = "group-title";
    title.textContent = `${groupName} (${grouped.get(groupName).length})`;
    friendList.appendChild(title);

    grouped.get(groupName).forEach((friend) => {
      const item = document.createElement("button");
      item.className = "friend-item";
      item.innerHTML = `
        <div class="avatar"></div>
        <div>
          <strong>${friend.friend.displayName}</strong>
          <div class="preview">@${friend.friend.username}</div>
        </div>
        <span>聊天</span>
      `;
      const avatar = item.querySelector(".avatar");
      fillAvatar(avatar, friend.friend.displayName, (e) => { e.stopPropagation(); openUserProfile(friend.friend.id, friend.friend.displayName); });
      item.addEventListener("click", () => createDirectFromFriend(friend.friend.id));
      item.addEventListener("contextmenu", async (event) => {
        event.preventDefault();
        const newGroup = prompt("移动到分组", friend.group);
        if (!newGroup) return;
        await api('/api/friends/group', {
          method: 'POST',
          body: JSON.stringify({ userId: state.currentUser.id, friendId: friend.friend.id, group: newGroup }),
        });
        await loadFriends();
      });
      friendList.appendChild(item);
    });
  });
}

async function createDirectFromFriend(friendId) {
  await api('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ creatorId: state.currentUser.id, type: 'direct', memberIds: [friendId] }),
  });
  await loadConversations();
  const conv = state.conversations.find((c) => c.type === 'direct' && c.members.includes(friendId));
  if (conv) openConversation(conv.id);
}

async function openConversation(conversationId) {
  const data = await api(`/api/conversations/${conversationId}/messages?userId=${encodeURIComponent(state.currentUser.id)}`);
  await api(`/api/conversations/${conversationId}/read`, {
    method: "POST",
    body: JSON.stringify({ userId: state.currentUser.id }),
  });
  state.activeConversation = data.conversation;
  state.messages = data.messages;

  backBtn.classList.remove("hidden");
  chatTitle.textContent = state.conversations.find((c) => c.id === conversationId)?.title || "会话";
  chatSubtitle.textContent = state.activeConversation.type === "group" ? `${state.activeConversation.members.length}人群聊` : "单聊";
  chatListView.classList.add("hidden");
  friendListView.classList.add("hidden");
  chatView.classList.remove("hidden");
  composerPanel.classList.remove("hidden");
  actionPanel.classList.add("hidden");
  profileDetailPage.classList.add('hidden');
  messageSettingsPage.classList.add('hidden');
  state.secondaryPage = null;
  homeTabbar.classList.add("hidden");

  renderMessages();
  await loadConversations();
}

function senderName(msg) {
  if (msg.senderId === state.currentUser.id) return "我";
  if (state.activeConversation.type === "group") return msg.senderId.slice(-4);
  return "对方";
}

function renderMessages() {
  chatView.innerHTML = "";
  state.messages.forEach((msg) => {
    let node;
    if (msg.type === "image") {
      node = imageTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector("img").src = msg.imageUrl;
    } else if (msg.type === "card") {
      node = cardTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".chip").textContent = msg.card.cardType;
      node.querySelector(".title").textContent = msg.card.title;
      node.querySelector(".description").textContent = msg.card.description;
      node.querySelector(".meta").textContent = msg.card.meta;
      const actions = node.querySelector(".actions");
      msg.card.actions.forEach((action) => {
        const btn = document.createElement("button");
        btn.textContent = action.label;
        if (action.primary) btn.className = "primary";
        btn.addEventListener("click", () => handleCardAction(msg.card, action.key));
        actions.appendChild(btn);
      });
    } else {
      node = textTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".bubble").textContent = msg.text || "";
      if (msg.type === "system") node.querySelector(".bubble").style.background = "#fef3c7";
    }
    node.classList.toggle("me", msg.senderId === state.currentUser.id);
    const sender = senderName(msg);
    node.querySelector(".sender").textContent = sender;
    const avatar = node.querySelector(".avatar");
    if (msg.senderId === state.currentUser.id) fillAvatar(avatar, "我");
    else fillAvatar(avatar, sender, () => openUserProfile(msg.senderId, sender));
    chatView.appendChild(node);
  });
  chatView.scrollTop = chatView.scrollHeight;
}

async function sendMessage(payload) {
  if (!state.activeConversation) return;
  const clientMessageId = `cm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const data = await api(`/api/conversations/${state.activeConversation.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ senderId: state.currentUser.id, clientMessageId, ...payload }),
  });
  // 发送后立即更新当前会话，避免依赖 SSE 才看到自己消息
  if (data?.message && state.activeConversation?.id === data.message.conversationId) {
    const exists = state.messages.some((m) => m.id === data.message.id);
    if (!exists) {
      state.messages.push(data.message);
      renderMessages();
    }
  }
}


async function ensureConversationForShare() {
  if (state.activeConversation) return true;
  if (!state.conversations.length) {
    alert('暂无会话，请先创建会话');
    return false;
  }
  const list = state.conversations.map((c, i) => `${i + 1}. ${c.title}`).join('\n');
  const picked = Number(prompt(`选择要分享到的会话：\n${list}`, '1'));
  if (!picked || !state.conversations[picked - 1]) return false;
  await openConversation(state.conversations[picked - 1].id);
  return true;
}

function orderActions(step) {
  if (step === 0) return [{ key: "pay", label: "付款", primary: true }, { key: "cancel", label: "取消" }];
  if (step === 1) return [{ key: "ship", label: "填写物流", primary: true }, { key: "remind", label: "提醒发货" }];
  if (step === 2) return [{ key: "track", label: "查看物流" }, { key: "confirm", label: "确认收货", primary: true }];
  if (step === 3) return [{ key: "finish", label: "确认收货", primary: true }];
  return [{ key: "review", label: "评价", primary: true }, { key: "after", label: "申请售后" }];
}

function makeOrderCard(step, conversationId) {
  return {
    cardType: "订单卡片",
    title: `订单号 #${conversationId.slice(-8)}`,
    description: `状态：${ORDER_FLOW[step]}`,
    meta: "金额 ¥629 · 担保支付 · 物流可追踪",
    actions: orderActions(step),
    step,
  };
}

async function handleCardAction(card, key) {
  if (!state.activeConversation) return;
  if (card.cardType === "商品卡片") {
    if (key === "view") return sendMessage({ type: "system", text: "已打开商品详情。" });
    if (key === "bid") return sendMessage({ type: "system", text: "已发起议价：¥580" });
    if (key === "order") return sendMessage({ type: "card", card: makeOrderCard(0, state.activeConversation.id) });
  }
  if (card.cardType === "订单卡片") {
    let step = Number(card.step ?? 0);
    if (key === "pay") step = 1;
    if (key === "ship") step = 2;
    if (key === "confirm") step = 3;
    if (key === "finish") step = 4;
    const statusMap = { cancel: "订单已取消。", remind: "已提醒卖家发货。", track: "物流：包裹已到达杭州中转站。", review: "已评价：五星好评。", after: "已进入售后流程。" };
    if (statusMap[key]) return sendMessage({ type: "system", text: statusMap[key] });
    return sendMessage({ type: "card", card: makeOrderCard(step, state.activeConversation.id) });
  }
  if (card.cardType === "钱包卡片") {
    if (key === "transfer") return sendMessage({ type: "system", text: "转账成功：¥88" });
    if (key === "collect") return sendMessage({ type: "system", text: "已发起收款请求：¥100" });
  }
  if (card.cardType === "商城商品") {
    if (key === "cart") return sendMessage({ type: "system", text: "已加入购物车。" });
    if (key === "buy") return sendMessage({ type: "system", text: "正在跳转支付页。" });
  }
}

function getPeerId() {
  if (!state.activeConversation || state.activeConversation.type !== 'direct') return null;
  return state.activeConversation.members.find((id) => id !== state.currentUser.id) || null;
}

async function createPeerConnection(mode) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  state.rtc.pc = pc;
  state.rtc.mode = mode;
  state.rtc.remoteStream = new MediaStream();
  remoteVideo.srcObject = state.rtc.remoteStream;

  pc.onicecandidate = async (event) => {
    if (!event.candidate || !state.rtc.peerId) return;
    const conversationId = state.rtc.conversationId || state.activeConversation?.id;
    if (!conversationId) return;
    await api(`/api/conversations/${conversationId}/signal`, {
      method: 'POST',
      body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: state.rtc.peerId, mode, signal: { type: 'candidate', candidate: event.candidate } }),
    });
  };

  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((t) => state.rtc.remoteStream.addTrack(t));
  };

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' });
  state.rtc.localStream = stream;
  localVideo.srcObject = stream;
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
}

function stopCall() {
  if (state.rtc.pc) state.rtc.pc.close();
  if (state.rtc.localStream) state.rtc.localStream.getTracks().forEach((t) => t.stop());
  if (state.rtc.remoteStream) state.rtc.remoteStream.getTracks().forEach((t) => t.stop());
  state.rtc = { pc: null, localStream: null, remoteStream: null, mode: null, conversationId: null, peerId: null, pendingOffer: null, incomingMeta: null, pendingAccept: false };
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  callPanel.classList.add('hidden');
  acceptCallBtn.classList.add('hidden');
  rejectCallBtn.classList.add('hidden');
  hangupBtn.classList.add('hidden');
}

function setCallActionLayout(layout) {
  // incoming: 接听 + 拒绝； outgoing/connected: 挂断
  acceptCallBtn.classList.toggle('hidden', layout !== 'incoming');
  rejectCallBtn.classList.toggle('hidden', layout !== 'incoming');
  hangupBtn.classList.toggle('hidden', layout === 'incoming');
}

async function ensureConversationOpen(conversationId) {
  if (state.activeConversation?.id === conversationId) return;
  const exists = state.conversations.some((c) => c.id === conversationId);
  if (!exists) await loadConversations();
  await openConversation(conversationId);
}

async function startCall(mode) {
  const peerId = getPeerId();
  if (!peerId) return alert('仅支持单聊语音/视频通话');
  try {
    state.rtc.conversationId = state.activeConversation.id;
    state.rtc.peerId = peerId;
    await createPeerConnection(mode);
    const offer = await state.rtc.pc.createOffer();
    await state.rtc.pc.setLocalDescription(offer);
    callTitle.textContent = `${mode === 'video' ? '视频' : '语音'}通话中（呼叫中）`;
    callPanel.classList.remove('hidden');
    setCallActionLayout('outgoing');
    await api(`/api/conversations/${state.rtc.conversationId}/call`, {
      method: 'POST',
      body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: peerId, event: 'start', mode }),
    });
    await api(`/api/conversations/${state.rtc.conversationId}/signal`, {
      method: 'POST',
      body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: peerId, mode, signal: { type: 'offer', sdp: offer } }),
    });
  } catch (e) {
    stopCall();
    alert('无法开启通话，请检查摄像头/麦克风权限');
  }
}

async function acceptCall() {
  const conversationId = state.rtc.pendingOffer?.conversationId || state.rtc.incomingMeta?.conversationId || state.activeConversation?.id;
  if (!conversationId) return;
  state.rtc.conversationId = conversationId;
  if (!state.rtc.pendingOffer) {
    state.rtc.pendingAccept = true;
    const mode = state.rtc.incomingMeta?.mode || 'voice';
    callTitle.textContent = `${mode === 'video' ? '视频' : '语音'}通话连接中...`;
    ensureConversationOpen(conversationId).catch(() => {});
    return;
  }
  const { senderId, mode, signal } = state.rtc.pendingOffer;
  state.rtc.pendingAccept = false;
  state.rtc.peerId = senderId;
  await createPeerConnection(mode);
  await state.rtc.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
  const answer = await state.rtc.pc.createAnswer();
  await state.rtc.pc.setLocalDescription(answer);
  await api(`/api/conversations/${conversationId}/signal`, {
    method: 'POST',
    body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: senderId, mode, signal: { type: 'answer', sdp: answer } }),
  });
  await api(`/api/conversations/${conversationId}/call`, {
    method: 'POST',
    body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: senderId, event: 'accept', mode }),
  });
  callTitle.textContent = `${mode === 'video' ? '视频' : '语音'}通话中`;
  setCallActionLayout('connected');
  state.rtc.pendingOffer = null;
}

async function rejectCall() {
  const conversationId = state.rtc.pendingOffer?.conversationId || state.rtc.incomingMeta?.conversationId || state.activeConversation?.id;
  if (state.rtc.pendingOffer && conversationId) {
    await api(`/api/conversations/${conversationId}/call`, {
      method: 'POST',
      body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: state.rtc.pendingOffer.senderId, event: 'reject', mode: state.rtc.pendingOffer.mode }),
    }).catch(() => {});
  }
  stopCall();
}

async function hangupCall() {
  const conversationId = state.rtc.conversationId || state.activeConversation?.id;
  if (state.rtc.peerId && conversationId) {
    await api(`/api/conversations/${conversationId}/call`, {
      method: 'POST',
      body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: state.rtc.peerId, event: 'end', mode: state.rtc.mode || 'voice' }),
    }).catch(() => {});
  }
  stopCall();
}

async function handleSignalEvent(payload) {
  if (!state.currentUser || payload.targetUserId !== state.currentUser.id) return;

  const signal = payload.signal;
  if (!signal) return;

  if (signal.type === 'offer') {
    state.rtc.conversationId = payload.conversationId;
    state.rtc.incomingMeta = { senderId: payload.senderId, mode: payload.mode, conversationId: payload.conversationId };
    state.rtc.pendingOffer = payload;
    callPanel.classList.remove('hidden');
    setCallActionLayout('incoming');
    callTitle.textContent = `${payload.mode === 'video' ? '视频' : '语音'}来电`;
    ensureConversationOpen(payload.conversationId).catch(() => {});
    if (state.rtc.pendingAccept) {
      await acceptCall();
    }
    return;
  }

  if (signal.type === 'answer' && state.rtc.pc) {
    await state.rtc.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    callTitle.textContent = `${state.rtc.mode === 'video' ? '视频' : '语音'}通话中`;
    return;
  }

  if (signal.type === 'candidate' && state.rtc.pc) {
    try {
      await state.rtc.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } catch (e) {
      // ignore race candidate issues
    }
  }
}

function notifyIncomingCall(payload) {
  if (!state.settings.globalNotify) return;
  if (typeof Notification === "undefined") return;
  const show = () => new Notification(`${payload.mode === "video" ? "视频" : "语音"}来电`, { body: "请返回聊天页处理来电" });
  if (Notification.permission === "granted") return show();
  if (Notification.permission === "default") Notification.requestPermission().then((p) => { if (p === "granted") show(); });
}

function handleCallEvent(payload) {
  if (!state.currentUser || payload.targetUserId !== state.currentUser.id) return;
  if (payload.event === 'start') {
    state.rtc.conversationId = payload.conversationId;
    state.rtc.incomingMeta = { senderId: payload.senderId, mode: payload.mode, conversationId: payload.conversationId };
    callPanel.classList.remove('hidden');
    setCallActionLayout('incoming');
    callTitle.textContent = `${payload.mode === 'video' ? '视频' : '语音'}来电`;
    notifyIncomingCall(payload);
    ensureConversationOpen(payload.conversationId).catch(() => {});
  }
  if (payload.event === 'reject' || payload.event === 'end') {
    stopCall();
    alert(payload.event === 'reject' ? '对方已拒绝通话' : '通话已结束');
  }
}

async function quickAction(action) {
  if (!state.activeConversation) return;
  if (action === "emoji") return sendMessage({ type: "text", text: ["😀", "😄", "🥳", "👍"][Math.floor(Math.random() * 4)] });
  if (action === "image") return imageInput.click();
  if (action === "at") {
    if (state.activeConversation.type !== "group") return sendMessage({ type: "system", text: "@ 功能仅群聊可用。" });
    messageInput.value = "@成员 ";
    return messageInput.focus();
  }
  if (action === "voice") return startCall('voice');
  if (action === "video") return startCall('video');
  if (action === "product") {
    return sendMessage({ type: "card", card: { cardType: "商品卡片", title: "Nike Zoom Fly 5", description: "成色 9.5 新｜同城自提｜支持担保支付", meta: "¥629 · 库存1 · 卖家信用4.9", actions: [{ key: "view", label: "查看" }, { key: "order", label: "下单", primary: true }, { key: "bid", label: "出价" }] } });
  }
  if (action === "order") return sendMessage({ type: "card", card: makeOrderCard(0, state.activeConversation.id) });
  if (action === "wallet") {
    return sendMessage({ type: "card", card: { cardType: "钱包卡片", title: "担保支付与转账", description: "支持聊天内收款/转账，命中风控会提示", meta: "可用余额 ¥12,540 · 实名已认证", actions: [{ key: "transfer", label: "转账", primary: true }, { key: "collect", label: "收款" }] } });
  }
  if (action === "mall") {
    return sendMessage({ type: "card", card: { cardType: "商城商品", title: "官方商城 · ANC蓝牙耳机", description: "支持加入购物车/立即购买", meta: "¥299 · 月销2.8k", actions: [{ key: "cart", label: "加入购物车" }, { key: "buy", label: "立即购买", primary: true }] } });
  }
}

async function createConversationFlow(prefer = "ask") {
  const usersData = await api(`/api/users?currentUserId=${encodeURIComponent(state.currentUser.id)}`);
  const users = usersData.users;
  if (!users.length) return alert("暂无其他用户");

  const mode = prefer === 'group' ? '2' : (prefer === 'direct' ? '1' : prompt("输入1建单聊，2建群聊", "1"));
  if (mode === "1") {
    const username = prompt(`输入用户名：${users.map((u) => u.username).join("/")}`);
    const target = users.find((u) => u.username === username);
    if (!target) return;
    await api('/api/conversations', { method: 'POST', body: JSON.stringify({ creatorId: state.currentUser.id, type: 'direct', memberIds: [target.id] }) });
    await loadConversations();
    await loadFriends();
    return;
  }

  if (mode === "2") {
    const groupName = prompt("群名称", "新群聊") || "新群聊";
    const names = prompt(`成员用户名(逗号分隔)：${users.map((u) => u.username).join(",")}`, "") || "";
    const ids = names.split(",").map((n) => n.trim()).filter(Boolean).map((name) => users.find((u) => u.username === name)?.id).filter(Boolean);
    await api('/api/conversations', { method: 'POST', body: JSON.stringify({ creatorId: state.currentUser.id, type: 'group', name: groupName, memberIds: ids }) });
    await loadConversations();
  }
}

async function addFriendFlow() {
  const username = prompt('输入要添加的用户名');
  if (!username) return;
  const group = prompt('分组名称', '我的好友') || '我的好友';
  try {
    await api('/api/friends', {
      method: 'POST',
      body: JSON.stringify({ userId: state.currentUser.id, friendUsername: username, group }),
    });
    await loadFriends();
    alert('添加好友成功');
  } catch {
    alert('添加失败（用户名不存在或输入非法）');
  }
}



async function scanAddFriendFlow() {
  const appNumberId = prompt('请输入对方号码ID（扫一扫结果）');
  if (!appNumberId) return;
  const usersData = await api(`/api/users?currentUserId=${encodeURIComponent(state.currentUser.id)}&q=${encodeURIComponent(appNumberId)}`);
  const target = (usersData.users || [])[0];
  if (!target) return alert('未找到该用户');
  await api('/api/friends', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendUsername: target.username, group: '扫一扫' }) });
  await loadFriends();
  alert(`已添加好友：${target.displayName}`);
}

async function moreMenu() {
  if (!state.activeConversation) {
    const mode = prompt("主页菜单：1退出登录 2创建测试用户", "1");
    if (mode === "1") {
      localStorage.removeItem(SESSION_KEY);
      state.currentUser = null;
      disconnectRealtime();
      stopCall();
      return showAuth();
    }
    if (mode === "2") {
      const displayName = prompt("昵称");
      const username = prompt("用户名");
      const password = prompt("密码(>=4)");
      if (!displayName || !username || !password) return;
      try {
        await api("/api/register", { method: "POST", body: JSON.stringify({ displayName, username, password }) });
        alert("创建成功");
      } catch {
        alert("创建失败，用户名可能已存在");
      }
    }
    return;
  }

  const conv = state.activeConversation;
  if (conv.type === 'direct') {
    openSecondaryPage('settings', 'chat');
    return;
  }
  if (conv.type === "group") {
    const mode = prompt("群菜单：1公告 2邀请成员 3退群 4静音", "1");
    if (mode === "1") {
      const announcement = prompt("新公告", conv.announcement || "") || "";
      try {
        await api(`/api/conversations/${conv.id}/group`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id, op: "announcement", announcement }) });
      } catch {
        alert("仅群主可修改公告");
      }
    }
    if (mode === "2") {
      const usersData = await api(`/api/users?currentUserId=${encodeURIComponent(state.currentUser.id)}`);
      const canInvite = usersData.users.filter((u) => !conv.members.includes(u.id));
      const username = prompt(`邀请用户名：${canInvite.map((u) => u.username).join("/")}`);
      const target = canInvite.find((u) => u.username === username);
      if (!target) return;
      await api(`/api/conversations/${conv.id}/group`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id, op: "invite", targetUserId: target.id }) });
    }
    if (mode === "3") {
      await api(`/api/conversations/${conv.id}/group`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id, op: "leave" }) }).catch(() => alert("群主不能直接退群"));
      await loadConversations();
      showHome();
    }
    if (mode === "4") {
      const data = await api(`/api/conversations/${conv.id}/mute`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) });
      alert(data.muted ? "已静音" : "已取消静音");
    }
    return;
  }

  const data = await api(`/api/conversations/${conv.id}/mute`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) });
  alert(data.muted ? "已静音" : "已取消静音");
}

function getDirectPeerId(conv = state.activeConversation) {
  if (!conv || conv.type !== 'direct') return null;
  return conv.members.find((id) => id !== state.currentUser.id) || null;
}

async function openMessageSettingsAction(action) {
  const conv = state.activeConversation;
  if (!conv) return;
  if (action === 'search') {
    const q = prompt('输入关键词搜索聊天记录');
    if (!q) return;
    const hit = state.messages.filter((m) => (m.text || m.card?.title || '').includes(q));
    alert(hit.length ? `找到 ${hit.length} 条匹配记录` : '未找到匹配记录');
    return;
  }
  if (action === 'mute') {
    const data = await api(`/api/conversations/${conv.id}/mute`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
    alert(data.muted ? '已静音此会话' : '已取消静音');
    return;
  }
  if (action === 'pin') {
    const data = await api(`/api/conversations/${conv.id}/pin`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
    alert(data.pinned ? '已置顶该会话' : '已取消置顶');
    await loadConversations();
    return;
  }
  if (action === 'blacklist') {
    const friendId = getDirectPeerId(conv);
    if (!friendId) return;
    const data = await api('/api/friends/blacklist', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendId, blocked: true }) });
    alert(data.blocked ? '已加入黑名单' : '黑名单状态未变化');
    return;
  }
  if (action === 'deleteFriend') {
    const friendId = getDirectPeerId(conv);
    if (!friendId) return;
    if (!confirm('确认删除该好友？')) return;
    await api('/api/friends/delete', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendId }) });
    await loadFriends();
    alert('已删除好友');
    return;
  }
  if (action === 'clear') {
    if (!confirm('确认清除该会话所有聊天记录？')) return;
    await api(`/api/conversations/${conv.id}/clear`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
    const data = await api(`/api/conversations/${conv.id}/messages?userId=${encodeURIComponent(state.currentUser.id)}`);
    state.messages = data.messages;
    renderMessages();
    await loadConversations();
  }
}

function connectRealtime() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource(`/api/events?userId=${encodeURIComponent(state.currentUser.id)}`);

  const onUpdate = async () => {
    if (!state.currentUser || state.refreshing) return;
    state.refreshing = true;
    try {
      await Promise.all([loadConversations(), loadFriends()]);
      if (state.activeConversation) {
        const data = await api(`/api/conversations/${state.activeConversation.id}/messages?userId=${encodeURIComponent(state.currentUser.id)}`);
        state.activeConversation = data.conversation;
        state.messages = data.messages;
        renderMessages();
      }
    } finally {
      state.refreshing = false;
    }
  };

  state.eventSource.addEventListener('message_created', onUpdate);
  state.eventSource.addEventListener('conversation_updated', onUpdate);
  state.eventSource.addEventListener('users_updated', onUpdate);
  state.eventSource.addEventListener('friends_updated', onUpdate);
  state.eventSource.addEventListener('webrtc_signal', (event) => handleSignalEvent(JSON.parse(event.data)));
  state.eventSource.addEventListener('call_event', (event) => handleCallEvent(JSON.parse(event.data)));
}

function disconnectRealtime() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function bindEvents() {
  messagesTab.addEventListener('click', () => setMainTab('messages'));
  friendsTab.addEventListener('click', () => setMainTab('friends'));
  mallTab.addEventListener('click', () => setMainTab('mall'));
  profileTab.addEventListener('click', () => setMainTab('profile'));
  publishTab.addEventListener('click', () => setMainTab('publish'));

  loginTab.addEventListener("click", () => renderAuth(true));
  registerTab.addEventListener("click", () => renderAuth(false));

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = $("loginUsername").value.trim();
    const password = $("loginPassword").value;
    try {
      const data = await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
      state.currentUser = data.user;
      localStorage.setItem(SESSION_KEY, JSON.stringify(data.user));
      authScreen.classList.add("hidden");
      appScreen.classList.remove("hidden");
      await Promise.all([loadConversations(), loadFriends()]);
      connectRealtime();
      setMainTab('messages');
      showHome();
    } catch {
      alert("用户名或密码错误");
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const displayName = $("registerDisplayName").value.trim();
    const username = $("registerUsername").value.trim();
    const password = $("registerPassword").value;
    try {
      const data = await api("/api/register", { method: "POST", body: JSON.stringify({ displayName, username, password }) });
      state.currentUser = data.user;
      localStorage.setItem(SESSION_KEY, JSON.stringify(data.user));
      authScreen.classList.add("hidden");
      appScreen.classList.remove("hidden");
      await Promise.all([loadConversations(), loadFriends()]);
      connectRealtime();
      setMainTab('messages');
      showHome();
    } catch {
      alert("注册失败（用户名可能已存在 / 密码不足4位）");
    }
  });

  searchInput.addEventListener("input", renderChatList);
  friendSearchInput.addEventListener("input", renderFriendList);
  mallSearchInput.addEventListener("input", () => {
    const keyword = mallSearchInput.value.trim().toLowerCase();
    const hidden = keyword && !"商城热卖 蓝牙耳机".toLowerCase().includes(keyword);
    mallCardBtn.classList.toggle("hidden", hidden);
  });
  backBtn.addEventListener("click", () => {
    if (closeSecondaryPage()) return;
    showHome();
  });
  newChatBtn.addEventListener("click", () => plusMenuSheet.classList.remove("hidden"));
  addFriendBtn.addEventListener('click', addFriendFlow);
  closePlusMenuBtn.addEventListener('click', () => plusMenuSheet.classList.add('hidden'));
  scanAddFriendBtn.addEventListener('click', async () => { plusMenuSheet.classList.add('hidden'); await scanAddFriendFlow(); });
  createGroupBtn.addEventListener('click', async () => { plusMenuSheet.classList.add('hidden'); await createConversationFlow('group'); });
  quickAddFriendBtn.addEventListener('click', async () => { plusMenuSheet.classList.add('hidden'); await addFriendFlow(); });
  searchHistoryBtn.addEventListener('click', () => openMessageSettingsAction('search'));
  muteSettingBtn.addEventListener('click', () => openMessageSettingsAction('mute'));
  pinConversationBtn.addEventListener('click', () => openMessageSettingsAction('pin'));
  blacklistBtn.addEventListener('click', () => openMessageSettingsAction('blacklist'));
  deleteFriendBtn.addEventListener('click', () => openMessageSettingsAction('deleteFriend'));
  clearChatBtn.addEventListener('click', () => openMessageSettingsAction('clear'));
  globalNotifyBtn.addEventListener('click', () => {
    state.settings.globalNotify = !state.settings.globalNotify;
    globalNotifyBtn.textContent = `全局消息提醒：${state.settings.globalNotify ? '开启' : '关闭'}`;
  });
  clearCacheBtn.addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
    alert('本地会话缓存已清理，重新登录后继续使用。');
  });
  moreBtn.addEventListener("click", moreMenu);
  toggleActionsBtn.addEventListener("click", () => actionPanel.classList.toggle("hidden"));
  closePublishSheetBtn.addEventListener('click', () => publishSheet.classList.add('hidden'));
  quickShareMallBtn.addEventListener('click', async () => {
    if (!(await ensureConversationForShare())) return;
    await sendMessage({
      type: 'card',
      card: {
        cardType: '商城商品',
        title: '蓝牙耳机 Pro',
        description: '主动降噪，24小时续航，限时折扣。',
        meta: '商城推荐 · ￥299',
        actions: [{ key: 'cart', label: '加入购物车' }, { key: 'buy', label: '立即购买', primary: true }],
      },
    });
    publishSheet.classList.add('hidden');
  });
  mallCardBtn.addEventListener('click', () => quickShareMallBtn.click());
  publishProductBtn.addEventListener('click', async () => {
    if (!(await ensureConversationForShare())) return;
    await sendMessage({
      type: 'card',
      card: {
        cardType: '商品卡片',
        title: '我发布了：闲置机械键盘',
        description: '99新，支持蓝牙/有线，顺丰包邮。',
        meta: '个人发布 · ￥260',
        actions: [{ key: 'view', label: '查看' }, { key: 'order', label: '下单', primary: true }],
      },
    });
    publishSheet.classList.add('hidden');
  });
  logoutBtn.addEventListener('click', () => {
    disconnectRealtime();
    localStorage.removeItem(SESSION_KEY);
    state.currentUser = null;
    showAuth();
  });

  composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;
    await sendMessage({ type: "text", text });
    messageInput.value = "";
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => quickAction(button.getAttribute("data-action")));
  });

  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      await sendMessage({ type: "image", imageUrl: reader.result });
    };
    reader.readAsDataURL(file);
    imageInput.value = "";
  });

  acceptCallBtn.addEventListener('click', acceptCall);
  rejectCallBtn.addEventListener('click', rejectCall);
  hangupBtn.addEventListener('click', hangupCall);
}

async function bootstrap() {
  bindEvents();
  const sessionRaw = localStorage.getItem(SESSION_KEY);
  if (!sessionRaw) return showAuth();

  try {
    state.currentUser = JSON.parse(sessionRaw);
    authScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    await Promise.all([loadConversations(), loadFriends()]);
    connectRealtime();
    setMainTab('messages');
    showHome();
  } catch {
    showAuth();
  }
}

bootstrap();
