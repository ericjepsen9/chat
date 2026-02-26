const DB_KEY = "chattrade_mobile_db_v2";
const SESSION_KEY = "chattrade_mobile_session";
const ORDER_FLOW = ["待付款", "待发货", "运输中", "待收货", "已完成"];

const authScreen = document.getElementById("authScreen");
const appScreen = document.getElementById("appScreen");
const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const chatListView = document.getElementById("chatListView");
const chatView = document.getElementById("chatView");
const composerPanel = document.getElementById("composerPanel");
const chatList = document.getElementById("chatList");
const chatTitle = document.getElementById("chatTitle");
const chatSubtitle = document.getElementById("chatSubtitle");
const backBtn = document.getElementById("backBtn");
const openChatListBtn = document.getElementById("openChatListBtn");
const moreBtn = document.getElementById("moreBtn");
const newChatBtn = document.getElementById("newChatBtn");
const searchInput = document.getElementById("searchInput");
const composer = document.getElementById("composer");
const messageInput = document.getElementById("messageInput");
const imageInput = document.getElementById("imageInput");
const profileBtn = document.getElementById("profileBtn");

const textTemplate = document.getElementById("textMessageTemplate");
const imageTemplate = document.getElementById("imageMessageTemplate");
const cardTemplate = document.getElementById("cardMessageTemplate");

const state = {
  db: null,
  currentUserId: null,
  activeConversationId: null,
};

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function seedDb() {
  const aliceId = uid("u");
  const bobId = uid("u");
  const groupId = uid("c");
  const directId = uid("c");

  return {
    users: [
      { id: aliceId, username: "alice", password: "1234", displayName: "Alice", contacts: [bobId] },
      { id: bobId, username: "bob", password: "1234", displayName: "Bob", contacts: [aliceId] },
    ],
    conversations: [
      {
        id: directId,
        type: "direct",
        name: "",
        ownerId: null,
        members: [aliceId, bobId],
        announcement: "",
        mutedBy: [],
        lastOrderStep: -1,
        messages: [
          { id: uid("m"), senderId: bobId, type: "text", text: "你好，鞋子还在吗？", createdAt: Date.now() - 300000 },
          { id: uid("m"), senderId: aliceId, type: "text", text: "在的，支持聊天内下单。", createdAt: Date.now() - 280000 },
        ],
        unread: {},
      },
      {
        id: groupId,
        type: "group",
        name: "跑鞋交易群",
        ownerId: aliceId,
        members: [aliceId, bobId],
        announcement: "群内禁止刷屏，交易请走担保。",
        mutedBy: [],
        lastOrderStep: -1,
        messages: [
          { id: uid("m"), senderId: aliceId, type: "system", text: "群公告：群内禁止刷屏，交易请走担保。", createdAt: Date.now() - 250000 },
        ],
        unread: {},
      },
    ],
  };
}

function loadDb() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) {
    const seeded = seedDb();
    localStorage.setItem(DB_KEY, JSON.stringify(seeded));
    return seeded;
  }
  return JSON.parse(raw);
}

function saveDb() {
  localStorage.setItem(DB_KEY, JSON.stringify(state.db));
}

function setSession(userId) {
  state.currentUserId = userId;
  if (userId) {
    localStorage.setItem(SESSION_KEY, userId);
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

function getCurrentUser() {
  return state.db.users.find((u) => u.id === state.currentUserId);
}

function findConversation(id) {
  return state.db.conversations.find((c) => c.id === id);
}

function nameOfUser(userId) {
  return state.db.users.find((u) => u.id === userId)?.displayName || "未知用户";
}

function getMyConversations() {
  return state.db.conversations
    .filter((c) => c.members.includes(state.currentUserId))
    .sort((a, b) => {
      const ta = a.messages.at(-1)?.createdAt || 0;
      const tb = b.messages.at(-1)?.createdAt || 0;
      return tb - ta;
    });
}

function conversationTitle(conv) {
  if (conv.type === "group") return conv.name;
  const peerId = conv.members.find((id) => id !== state.currentUserId);
  return nameOfUser(peerId);
}

function conversationSubtitle(conv) {
  const last = conv.messages.at(-1);
  if (!last) return "暂无消息";
  if (last.type === "text") return last.text;
  if (last.type === "image") return "[图片]";
  if (last.type === "card") return `[${last.card.cardType}]`;
  return last.text || "系统消息";
}

function unreadCount(conv) {
  return conv.unread[state.currentUserId] || 0;
}

function resetUnread(conv) {
  conv.unread[state.currentUserId] = 0;
}

function bumpUnread(conv, senderId) {
  conv.members.forEach((memberId) => {
    if (memberId !== senderId) {
      conv.unread[memberId] = (conv.unread[memberId] || 0) + 1;
    }
  });
}

function appendMessage(conv, msg) {
  conv.messages.push(msg);
  bumpUnread(conv, msg.senderId);
}

function renderAuth(showLogin = true) {
  loginTab.classList.toggle("active", showLogin);
  registerTab.classList.toggle("active", !showLogin);
  loginForm.classList.toggle("hidden", !showLogin);
  registerForm.classList.toggle("hidden", showLogin);
}

function switchToApp() {
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  renderChatList();
  showChatListView();
}

function switchToAuth() {
  appScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  renderAuth(true);
}

function showChatListView() {
  state.activeConversationId = null;
  chatListView.classList.remove("hidden");
  chatView.classList.add("hidden");
  composerPanel.classList.add("hidden");
  backBtn.classList.add("hidden");
  openChatListBtn.classList.remove("hidden");
  chatTitle.textContent = "会话列表";
  chatSubtitle.textContent = "选择聊天或创建新会话";
}

function showChatDetail(convId) {
  state.activeConversationId = convId;
  const conv = findConversation(convId);
  if (!conv) return;

  resetUnread(conv);
  saveDb();

  chatListView.classList.add("hidden");
  chatView.classList.remove("hidden");
  composerPanel.classList.remove("hidden");
  backBtn.classList.remove("hidden");
  openChatListBtn.classList.add("hidden");

  chatTitle.textContent = conversationTitle(conv);
  chatSubtitle.textContent = conv.type === "group" ? `${conv.members.length} 人群聊` : "单聊";

  renderMessages(conv);
  renderChatList();
}

function renderChatList() {
  const keyword = searchInput.value.trim().toLowerCase();
  const convs = getMyConversations().filter((conv) => {
    if (!keyword) return true;
    return (
      conversationTitle(conv).toLowerCase().includes(keyword) ||
      conversationSubtitle(conv).toLowerCase().includes(keyword)
    );
  });

  chatList.innerHTML = "";
  convs.forEach((conv) => {
    const node = document.createElement("button");
    node.className = "chat-item";
    const unread = unreadCount(conv);
    node.innerHTML = `
      <div class="avatar"></div>
      <div>
        <strong>${conversationTitle(conv)}</strong>
        <div class="preview">${conversationSubtitle(conv)}</div>
      </div>
      ${unread ? `<span class="badge">${unread}</span>` : ""}
    `;
    node.addEventListener("click", () => showChatDetail(conv.id));
    chatList.appendChild(node);
  });
}

function messageSenderName(conv, senderId) {
  if (senderId === state.currentUserId) return "我";
  return conv.type === "group" ? nameOfUser(senderId) : "对方";
}

function attachCardActions(actionsNode, conv, message) {
  const { card } = message;
  card.actions.forEach((action) => {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.className = action.primary ? "primary" : "";
    button.addEventListener("click", () => handleCardAction(conv, card, action.key));
    actionsNode.appendChild(button);
  });
}

function renderMessages(conv) {
  chatView.innerHTML = "";
  conv.messages.forEach((msg) => {
    const fromMe = msg.senderId === state.currentUserId;
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
      attachCardActions(node.querySelector(".actions"), conv, msg);
    } else {
      node = textTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".bubble").textContent = msg.text;
      if (msg.type === "system") {
        node.querySelector(".bubble").style.background = "#fef3c7";
      }
    }

    node.classList.toggle("me", fromMe);
    node.querySelector(".sender").textContent = messageSenderName(conv, msg.senderId);
    chatView.appendChild(node);
  });

  chatView.scrollTop = chatView.scrollHeight;
}

function makeCard(cardType, title, description, meta, actions) {
  return { cardType, title, description, meta, actions };
}

function sendTextMessage(text) {
  const conv = findConversation(state.activeConversationId);
  if (!conv || !text.trim()) return;
  appendMessage(conv, { id: uid("m"), senderId: state.currentUserId, type: "text", text: text.trim(), createdAt: Date.now() });
  saveDb();
  renderMessages(conv);
  renderChatList();
  maybeAutoReply(conv);
}

function sendImageMessage(dataUrl) {
  const conv = findConversation(state.activeConversationId);
  if (!conv) return;
  appendMessage(conv, { id: uid("m"), senderId: state.currentUserId, type: "image", imageUrl: dataUrl, createdAt: Date.now() });
  saveDb();
  renderMessages(conv);
  renderChatList();
}

function sendSystemMessage(conv, text) {
  appendMessage(conv, { id: uid("m"), senderId: state.currentUserId, type: "system", text, createdAt: Date.now() });
  saveDb();
  renderMessages(conv);
  renderChatList();
}

function sendCardMessage(conv, card, fromMe = true) {
  appendMessage(conv, {
    id: uid("m"),
    senderId: fromMe ? state.currentUserId : conv.members.find((m) => m !== state.currentUserId) || state.currentUserId,
    type: "card",
    card,
    createdAt: Date.now(),
  });
  saveDb();
  renderMessages(conv);
  renderChatList();
}

function defaultOrderCard(conv) {
  const step = Math.max(0, conv.lastOrderStep);
  const status = ORDER_FLOW[step];
  return makeCard(
    "订单卡片",
    `订单号 #${conv.id.slice(-8)}`,
    `状态：${status}`,
    "金额 ¥629 · 担保支付 · 物流可追踪",
    orderActions(step)
  );
}

function orderActions(step) {
  if (step === 0) return [{ key: "pay", label: "付款", primary: true }, { key: "cancel", label: "取消" }];
  if (step === 1) return [{ key: "ship", label: "填写物流", primary: true }, { key: "remind", label: "提醒发货" }];
  if (step === 2) return [{ key: "track", label: "查看物流" }, { key: "confirm", label: "确认收货", primary: true }];
  if (step === 3) return [{ key: "finish", label: "确认收货", primary: true }];
  return [{ key: "review", label: "评价", primary: true }, { key: "after", label: "申请售后" }];
}

function handleCardAction(conv, card, key) {
  if (card.cardType === "商品卡片") {
    if (key === "view") return sendSystemMessage(conv, "已打开商品详情。");
    if (key === "bid") return sendSystemMessage(conv, "已发起议价：¥580");
    if (key === "order") {
      conv.lastOrderStep = 0;
      return sendCardMessage(conv, defaultOrderCard(conv), false);
    }
  }

  if (card.cardType === "订单卡片") {
    if (key === "pay") conv.lastOrderStep = 1;
    if (key === "ship") conv.lastOrderStep = 2;
    if (key === "confirm") conv.lastOrderStep = 3;
    if (key === "finish") conv.lastOrderStep = 4;
    if (["cancel", "remind", "track", "review", "after"].includes(key)) {
      const map = {
        cancel: "订单已取消。",
        remind: "已提醒卖家发货。",
        track: "物流：包裹已到达杭州中转站。",
        review: "已评价：五星好评。",
        after: "已进入售后流程。",
      };
      return sendSystemMessage(conv, map[key]);
    }
    return sendCardMessage(conv, defaultOrderCard(conv), false);
  }

  if (card.cardType === "钱包卡片") {
    if (key === "transfer") return sendSystemMessage(conv, "转账成功：¥88");
    if (key === "collect") return sendSystemMessage(conv, "已发起收款请求：¥100");
  }

  if (card.cardType === "商城商品") {
    if (key === "cart") return sendSystemMessage(conv, "已加入购物车。");
    if (key === "buy") return sendSystemMessage(conv, "正在跳转支付页面。");
    if (key === "share") return sendSystemMessage(conv, "已分享商品到当前聊天。");
  }
}

function quickAction(action) {
  const conv = findConversation(state.activeConversationId);
  if (!conv) return;

  if (action === "emoji") {
    const emoji = ["😀", "😄", "🥳", "👍", "💰", "🚚"][Math.floor(Math.random() * 6)];
    sendTextMessage(emoji);
    return;
  }

  if (action === "at") {
    if (conv.type !== "group") return sendSystemMessage(conv, "@功能仅群聊可用。");
    const targetId = conv.members.find((id) => id !== state.currentUserId);
    messageInput.value = `@${nameOfUser(targetId)} `;
    messageInput.focus();
    return;
  }

  if (action === "image") {
    imageInput.click();
    return;
  }

  if (action === "product") {
    return sendCardMessage(
      conv,
      makeCard(
        "商品卡片",
        "Nike Zoom Fly 5 二手跑鞋",
        "成色 9.5 新｜同城自提｜支持担保支付",
        "¥629 · 库存 1 · 卖家信用 4.9",
        [
          { key: "view", label: "查看" },
          { key: "order", label: "下单", primary: true },
          { key: "bid", label: "出价" },
        ]
      ),
      true
    );
  }

  if (action === "order") {
    if (conv.lastOrderStep < 0) conv.lastOrderStep = 0;
    return sendCardMessage(conv, defaultOrderCard(conv), false);
  }

  if (action === "wallet") {
    return sendCardMessage(
      conv,
      makeCard(
        "钱包卡片",
        "担保支付与转账",
        "支持聊天内收款/转账，风控命中会提示风险",
        "可用余额 ¥12,540 · 实名已认证",
        [
          { key: "transfer", label: "转账", primary: true },
          { key: "collect", label: "收款" },
        ]
      ),
      true
    );
  }
}

function createDirectConversation(withUserId) {
  const existing = state.db.conversations.find(
    (c) => c.type === "direct" && c.members.includes(state.currentUserId) && c.members.includes(withUserId)
  );
  if (existing) return existing;

  const conv = {
    id: uid("c"),
    type: "direct",
    name: "",
    ownerId: null,
    members: [state.currentUserId, withUserId],
    announcement: "",
    mutedBy: [],
    lastOrderStep: -1,
    messages: [],
    unread: {},
  };
  state.db.conversations.push(conv);
  saveDb();
  return conv;
}

function createGroupConversation(name, memberIds) {
  const uniqueMembers = [...new Set([state.currentUserId, ...memberIds])];
  const conv = {
    id: uid("c"),
    type: "group",
    name: name || `新群聊${Math.floor(Math.random() * 100)}`,
    ownerId: state.currentUserId,
    members: uniqueMembers,
    announcement: "",
    mutedBy: [],
    lastOrderStep: -1,
    messages: [
      { id: uid("m"), senderId: state.currentUserId, type: "system", text: `已创建群聊 ${name}`, createdAt: Date.now() },
    ],
    unread: {},
  };
  state.db.conversations.push(conv);
  saveDb();
  return conv;
}

function newChatFlow() {
  const current = getCurrentUser();
  const users = state.db.users.filter((u) => u.id !== state.currentUserId);
  if (users.length === 0) return alert("暂无其他用户，请先创建用户。");

  const mode = prompt("输入 1 创建单聊，输入 2 创建群聊", "1");
  if (mode === "1") {
    const picked = prompt(`输入用户名创建单聊：${users.map((u) => u.username).join(" / ")}`);
    const target = state.db.users.find((u) => u.username === picked);
    if (!target) return alert("用户不存在");

    if (!current.contacts.includes(target.id)) current.contacts.push(target.id);
    const peer = state.db.users.find((u) => u.id === target.id);
    if (!peer.contacts.includes(current.id)) peer.contacts.push(current.id);

    saveDb();
    const conv = createDirectConversation(target.id);
    renderChatList();
    showChatDetail(conv.id);
  }

  if (mode === "2") {
    const groupName = prompt("群名称", "新交易群");
    const names = prompt(`输入群成员用户名（逗号分隔）：${users.map((u) => u.username).join(",")}`) || "";
    const memberIds = names
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => state.db.users.find((u) => u.username === name)?.id)
      .filter(Boolean);

    const conv = createGroupConversation(groupName, memberIds);
    renderChatList();
    showChatDetail(conv.id);
  }
}

function groupMenu(conv) {
  const menu = prompt("群聊操作：1公告 2邀请成员 3退群 4静音/取消静音", "1");
  if (menu === "1") {
    if (conv.ownerId !== state.currentUserId) return alert("仅群主可修改公告");
    const announcement = prompt("请输入新群公告", conv.announcement || "") || "";
    conv.announcement = announcement;
    appendMessage(conv, {
      id: uid("m"),
      senderId: state.currentUserId,
      type: "system",
      text: `群公告：${announcement || "（空）"}`,
      createdAt: Date.now(),
    });
    saveDb();
    renderMessages(conv);
    renderChatList();
  }

  if (menu === "2") {
    const canInvite = state.db.users.filter((u) => !conv.members.includes(u.id));
    const username = prompt(`输入要邀请的用户名：${canInvite.map((u) => u.username).join(" / ")}`);
    const target = canInvite.find((u) => u.username === username);
    if (!target) return;
    conv.members.push(target.id);
    appendMessage(conv, {
      id: uid("m"),
      senderId: state.currentUserId,
      type: "system",
      text: `${nameOfUser(state.currentUserId)} 邀请 ${target.displayName} 加入群聊。`,
      createdAt: Date.now(),
    });
    saveDb();
    renderMessages(conv);
    renderChatList();
  }

  if (menu === "3") {
    if (conv.ownerId === state.currentUserId && conv.members.length > 1) {
      alert("群主请先转让群主后再退群（演示简化不支持转让）。");
      return;
    }
    conv.members = conv.members.filter((id) => id !== state.currentUserId);
    saveDb();
    showChatListView();
    renderChatList();
  }

  if (menu === "4") {
    const index = conv.mutedBy.indexOf(state.currentUserId);
    if (index >= 0) conv.mutedBy.splice(index, 1);
    else conv.mutedBy.push(state.currentUserId);
    saveDb();
    alert(index >= 0 ? "已取消静音" : "已静音会话");
  }
}

function profileMenu() {
  const current = getCurrentUser();
  const choice = prompt(`用户：${current.displayName}\n1 我的信息 2 创建测试用户 3 退出登录`, "1");
  if (choice === "1") {
    alert(`昵称：${current.displayName}\n用户名：${current.username}\n联系人：${current.contacts.length}`);
  }

  if (choice === "2") {
    const displayName = prompt("新用户昵称");
    const username = prompt("新用户用户名");
    const password = prompt("新用户密码（>=4）");
    if (!displayName || !username || !password || password.length < 4) return alert("输入不合法");
    if (state.db.users.some((u) => u.username === username)) return alert("用户名已存在");
    state.db.users.push({ id: uid("u"), displayName, username, password, contacts: [] });
    saveDb();
    alert("创建成功");
  }

  if (choice === "3") {
    setSession(null);
    switchToAuth();
  }
}

function maybeAutoReply(conv) {
  if (conv.type !== "direct") return;
  const peerId = conv.members.find((id) => id !== state.currentUserId);
  if (!peerId) return;
  const replies = ["收到，我们按流程走担保交易。", "可以，稍后我会发订单卡。", "没问题，支持同城面交。"];
  const text = replies[Math.floor(Math.random() * replies.length)];
  setTimeout(() => {
    appendMessage(conv, { id: uid("m"), senderId: peerId, type: "text", text, createdAt: Date.now() });
    saveDb();
    if (state.activeConversationId === conv.id) {
      resetUnread(conv);
      renderMessages(conv);
    }
    renderChatList();
  }, 500);
}

function bindEvents() {
  loginTab.addEventListener("click", () => renderAuth(true));
  registerTab.addEventListener("click", () => renderAuth(false));

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    const user = state.db.users.find((u) => u.username === username && u.password === password);
    if (!user) return alert("用户名或密码错误");
    setSession(user.id);
    switchToApp();
  });

  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const displayName = document.getElementById("registerDisplayName").value.trim();
    const username = document.getElementById("registerUsername").value.trim();
    const password = document.getElementById("registerPassword").value;

    if (!displayName || !username || password.length < 4) return alert("请完整填写，密码至少 4 位");
    if (state.db.users.some((u) => u.username === username)) return alert("用户名已存在");

    const user = { id: uid("u"), displayName, username, password, contacts: [] };
    state.db.users.push(user);
    saveDb();
    setSession(user.id);
    switchToApp();
  });

  searchInput.addEventListener("input", renderChatList);
  newChatBtn.addEventListener("click", newChatFlow);
  backBtn.addEventListener("click", showChatListView);
  openChatListBtn.addEventListener("click", showChatListView);

  moreBtn.addEventListener("click", () => {
    const conv = findConversation(state.activeConversationId);
    if (!conv) return alert("请先打开会话");
    if (conv.type === "group") return groupMenu(conv);
    const muteIndex = conv.mutedBy.indexOf(state.currentUserId);
    if (muteIndex >= 0) conv.mutedBy.splice(muteIndex, 1);
    else conv.mutedBy.push(state.currentUserId);
    saveDb();
    alert(muteIndex >= 0 ? "已取消静音" : "已静音会话");
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    sendTextMessage(messageInput.value);
    messageInput.value = "";
  });

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => quickAction(btn.getAttribute("data-action")));
  });

  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => sendImageMessage(reader.result);
    reader.readAsDataURL(file);
    imageInput.value = "";
  });

  profileBtn.addEventListener("click", profileMenu);
}

function bootstrap() {
  state.db = loadDb();
  bindEvents();
  const sessionId = localStorage.getItem(SESSION_KEY);
  if (sessionId && state.db.users.some((u) => u.id === sessionId)) {
    setSession(sessionId);
    switchToApp();
  } else {
    switchToAuth();
  }
}

bootstrap();
