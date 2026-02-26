const DB_KEY = "chattrade_db_v3";
const SESSION_KEY = "chattrade_session_v3";
const ORDER_FLOW = ["待付款", "待发货", "运输中", "待收货", "已完成"];

const $ = (id) => document.getElementById(id);
const authScreen = $("authScreen");
const appScreen = $("appScreen");
const loginTab = $("loginTab");
const registerTab = $("registerTab");
const loginForm = $("loginForm");
const registerForm = $("registerForm");
const chatListView = $("chatListView");
const chatView = $("chatView");
const composerPanel = $("composerPanel");
const chatList = $("chatList");
const chatTitle = $("chatTitle");
const chatSubtitle = $("chatSubtitle");
const backBtn = $("backBtn");
const moreBtn = $("moreBtn");
const newChatBtn = $("newChatBtn");
const searchInput = $("searchInput");
const composer = $("composer");
const messageInput = $("messageInput");
const imageInput = $("imageInput");
const actionPanel = $("actionPanel");
const toggleActionsBtn = $("toggleActionsBtn");

const textTemplate = $("textMessageTemplate");
const imageTemplate = $("imageMessageTemplate");
const cardTemplate = $("cardMessageTemplate");

const state = { db: null, currentUserId: null, activeConversationId: null };
const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function seedDb() {
  const alice = uid("u");
  const bob = uid("u");
  return {
    users: [
      { id: alice, username: "alice", password: "1234", displayName: "Alice", contacts: [bob] },
      { id: bob, username: "bob", password: "1234", displayName: "Bob", contacts: [alice] },
    ],
    conversations: [
      {
        id: uid("c"),
        type: "direct",
        members: [alice, bob],
        name: "",
        ownerId: null,
        announcement: "",
        mutedBy: [],
        lastOrderStep: -1,
        unread: {},
        messages: [
          { id: uid("m"), senderId: bob, type: "text", text: "你好，可以直接在聊天下单吗？", createdAt: Date.now() - 60000 },
          { id: uid("m"), senderId: alice, type: "text", text: "可以，点 + 里的商品卡就行。", createdAt: Date.now() - 50000 },
        ],
      },
    ],
  };
}

function loadDb() {
  const raw = localStorage.getItem(DB_KEY);
  if (raw) return JSON.parse(raw);
  const db = seedDb();
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  return db;
}
const saveDb = () => localStorage.setItem(DB_KEY, JSON.stringify(state.db));

function setSession(userId) {
  state.currentUserId = userId;
  if (userId) localStorage.setItem(SESSION_KEY, userId);
  else localStorage.removeItem(SESSION_KEY);
}

const currentUser = () => state.db.users.find((u) => u.id === state.currentUserId);
const nameOf = (id) => state.db.users.find((u) => u.id === id)?.displayName || "未知用户";
const convById = (id) => state.db.conversations.find((c) => c.id === id);

function myConversations() {
  return state.db.conversations
    .filter((c) => c.members.includes(state.currentUserId))
    .sort((a, b) => (b.messages.at(-1)?.createdAt || 0) - (a.messages.at(-1)?.createdAt || 0));
}

function convTitle(conv) {
  if (conv.type === "group") return conv.name;
  return nameOf(conv.members.find((id) => id !== state.currentUserId));
}

function convPreview(conv) {
  const last = conv.messages.at(-1);
  if (!last) return "暂无消息";
  if (last.type === "image") return "[图片]";
  if (last.type === "card") return `[${last.card.cardType}]`;
  return last.text || "系统消息";
}

const unreadCount = (conv) => conv.unread[state.currentUserId] || 0;
function pushMsg(conv, msg) {
  conv.messages.push(msg);
  conv.members.forEach((id) => {
    if (id !== msg.senderId) conv.unread[id] = (conv.unread[id] || 0) + 1;
  });
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
  renderAuth(true);
}

function showList() {
  state.activeConversationId = null;
  backBtn.classList.add("hidden");
  chatTitle.textContent = "消息";
  chatSubtitle.textContent = currentUser()?.displayName || "ChatTrade";
  chatListView.classList.remove("hidden");
  chatView.classList.add("hidden");
  composerPanel.classList.add("hidden");
  renderChatList();
}

function showChat(convId) {
  const conv = convById(convId);
  if (!conv) return;
  state.activeConversationId = convId;
  conv.unread[state.currentUserId] = 0;
  saveDb();

  backBtn.classList.remove("hidden");
  chatTitle.textContent = convTitle(conv);
  chatSubtitle.textContent = conv.type === "group" ? `${conv.members.length}人群聊` : "单聊";
  chatListView.classList.add("hidden");
  chatView.classList.remove("hidden");
  composerPanel.classList.remove("hidden");
  actionPanel.classList.add("hidden");
  renderMessages(conv);
  renderChatList();
}

function renderChatList() {
  const kw = searchInput.value.trim().toLowerCase();
  chatList.innerHTML = "";
  myConversations()
    .filter((c) => !kw || convTitle(c).toLowerCase().includes(kw) || convPreview(c).toLowerCase().includes(kw))
    .forEach((conv) => {
      const node = document.createElement("button");
      const unread = unreadCount(conv);
      node.className = "chat-item";
      node.innerHTML = `
        <div class="avatar"></div>
        <div><strong>${convTitle(conv)}</strong><div class="preview">${convPreview(conv)}</div></div>
        ${unread ? `<span class="badge">${unread}</span>` : ""}
      `;
      node.addEventListener("click", () => showChat(conv.id));
      chatList.appendChild(node);
    });
}

function renderMessages(conv) {
  chatView.innerHTML = "";
  conv.messages.forEach((msg) => {
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
      msg.card.actions.forEach((a) => {
        const b = document.createElement("button");
        b.textContent = a.label;
        if (a.primary) b.className = "primary";
        b.addEventListener("click", () => onCardAction(conv, msg.card, a.key));
        actions.appendChild(b);
      });
    } else {
      node = textTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".bubble").textContent = msg.text;
      if (msg.type === "system") node.querySelector(".bubble").style.background = "#fef3c7";
    }
    const me = msg.senderId === state.currentUserId;
    node.classList.toggle("me", me);
    node.querySelector(".sender").textContent = me ? "我" : conv.type === "group" ? nameOf(msg.senderId) : "对方";
    chatView.appendChild(node);
  });
  chatView.scrollTop = chatView.scrollHeight;
}

function send(type, payload) {
  const conv = convById(state.activeConversationId);
  if (!conv) return;
  pushMsg(conv, { id: uid("m"), senderId: state.currentUserId, type, ...payload, createdAt: Date.now() });
  saveDb();
  renderMessages(conv);
  renderChatList();
}

function sendSystem(conv, text) {
  pushMsg(conv, { id: uid("m"), senderId: state.currentUserId, type: "system", text, createdAt: Date.now() });
  saveDb();
  renderMessages(conv);
  renderChatList();
}

function orderActions(step) {
  if (step === 0) return [{ key: "pay", label: "付款", primary: true }, { key: "cancel", label: "取消" }];
  if (step === 1) return [{ key: "ship", label: "填写物流", primary: true }, { key: "remind", label: "提醒发货" }];
  if (step === 2) return [{ key: "track", label: "查看物流" }, { key: "confirm", label: "确认收货", primary: true }];
  if (step === 3) return [{ key: "finish", label: "确认收货", primary: true }];
  return [{ key: "review", label: "评价", primary: true }, { key: "after", label: "申请售后" }];
}

function defaultOrderCard(conv) {
  const step = Math.max(0, conv.lastOrderStep);
  return {
    cardType: "订单卡片",
    title: `订单号 #${conv.id.slice(-8)}`,
    description: `状态：${ORDER_FLOW[step]}`,
    meta: "金额 ¥629 · 担保支付 · 物流可追踪",
    actions: orderActions(step),
  };
}

function sendCard(card, fromMe = true) {
  const conv = convById(state.activeConversationId);
  if (!conv) return;
  const senderId = fromMe ? state.currentUserId : conv.members.find((i) => i !== state.currentUserId) || state.currentUserId;
  pushMsg(conv, { id: uid("m"), senderId, type: "card", card, createdAt: Date.now() });
  saveDb();
  renderMessages(conv);
  renderChatList();
}

function onCardAction(conv, card, key) {
  if (card.cardType === "商品卡片") {
    if (key === "view") return sendSystem(conv, "已打开商品详情。");
    if (key === "bid") return sendSystem(conv, "已发起议价：¥580");
    if (key === "order") {
      conv.lastOrderStep = 0;
      return sendCard(defaultOrderCard(conv), false);
    }
  }
  if (card.cardType === "订单卡片") {
    if (key === "pay") conv.lastOrderStep = 1;
    if (key === "ship") conv.lastOrderStep = 2;
    if (key === "confirm") conv.lastOrderStep = 3;
    if (key === "finish") conv.lastOrderStep = 4;
    const msgMap = { cancel: "订单已取消。", remind: "已提醒卖家发货。", track: "物流：已到达杭州中转站。", review: "已评价：五星。", after: "已进入售后。" };
    if (msgMap[key]) return sendSystem(conv, msgMap[key]);
    return sendCard(defaultOrderCard(conv), false);
  }
  if (card.cardType === "钱包卡片") {
    if (key === "transfer") return sendSystem(conv, "转账成功：¥88");
    if (key === "collect") return sendSystem(conv, "已发起收款请求：¥100");
  }
  if (card.cardType === "商城商品") {
    if (key === "cart") return sendSystem(conv, "已加入购物车。");
    if (key === "buy") return sendSystem(conv, "正在跳转支付页。");
  }
}

function onQuickAction(action) {
  const conv = convById(state.activeConversationId);
  if (!conv) return;
  if (action === "emoji") return send("text", { text: ["😀", "😄", "🥳", "👍"][Math.floor(Math.random() * 4)] });
  if (action === "image") return imageInput.click();
  if (action === "at") {
    if (conv.type !== "group") return sendSystem(conv, "@ 功能仅群聊可用。");
    const target = conv.members.find((id) => id !== state.currentUserId);
    messageInput.value = `@${nameOf(target)} `;
    return messageInput.focus();
  }
  if (action === "product") {
    return sendCard({
      cardType: "商品卡片",
      title: "Nike Zoom Fly 5",
      description: "成色 9.5 新｜同城自提｜支持担保支付",
      meta: "¥629 · 库存1 · 卖家信用4.9",
      actions: [{ key: "view", label: "查看" }, { key: "order", label: "下单", primary: true }, { key: "bid", label: "出价" }],
    });
  }
  if (action === "order") {
    if (conv.lastOrderStep < 0) conv.lastOrderStep = 0;
    return sendCard(defaultOrderCard(conv), false);
  }
  if (action === "wallet") {
    return sendCard({
      cardType: "钱包卡片",
      title: "担保支付与转账",
      description: "支持聊天内收款/转账，命中风控会提示",
      meta: "可用余额 ¥12,540 · 实名已认证",
      actions: [{ key: "transfer", label: "转账", primary: true }, { key: "collect", label: "收款" }],
    });
  }
  if (action === "mall") {
    return sendCard({
      cardType: "商城商品",
      title: "官方商城 · ANC蓝牙耳机",
      description: "支持加入购物车/立即购买",
      meta: "¥299 · 月销2.8k",
      actions: [{ key: "cart", label: "加入购物车" }, { key: "buy", label: "立即购买", primary: true }],
    }, false);
  }
}

function createConversationFlow() {
  const others = state.db.users.filter((u) => u.id !== state.currentUserId);
  if (!others.length) return alert("没有可选用户");
  const mode = prompt("输入1建单聊，2建群聊", "1");
  if (mode === "1") {
    const name = prompt(`输入用户名：${others.map((u) => u.username).join("/")}`);
    const target = state.db.users.find((u) => u.username === name);
    if (!target) return;
    const existed = state.db.conversations.find((c) => c.type === "direct" && c.members.includes(state.currentUserId) && c.members.includes(target.id));
    if (existed) return showChat(existed.id);
    const conv = { id: uid("c"), type: "direct", members: [state.currentUserId, target.id], name: "", ownerId: null, announcement: "", mutedBy: [], lastOrderStep: -1, unread: {}, messages: [] };
    state.db.conversations.push(conv);
    saveDb();
    showChat(conv.id);
    return;
  }
  if (mode === "2") {
    const groupName = prompt("群名称", "新群聊") || "新群聊";
    const names = prompt(`成员用户名(逗号分隔)：${others.map((u) => u.username).join(",")}`, "") || "";
    const ids = names.split(",").map((n) => n.trim()).filter(Boolean).map((n) => state.db.users.find((u) => u.username === n)?.id).filter(Boolean);
    const conv = { id: uid("c"), type: "group", members: [...new Set([state.currentUserId, ...ids])], name: groupName, ownerId: state.currentUserId, announcement: "", mutedBy: [], lastOrderStep: -1, unread: {}, messages: [{ id: uid("m"), senderId: state.currentUserId, type: "system", text: `已创建群聊 ${groupName}`, createdAt: Date.now() }] };
    state.db.conversations.push(conv);
    saveDb();
    showChat(conv.id);
  }
}

function chatMoreMenu() {
  if (!state.activeConversationId) {
    const c = prompt("消息页菜单：1 退出登录 2 创建测试用户", "1");
    if (c === "1") {
      setSession(null);
      showAuth();
    }
    if (c === "2") {
      const d = prompt("昵称");
      const u = prompt("用户名");
      const p = prompt("密码(>=4)");
      if (!d || !u || !p || p.length < 4) return;
      if (state.db.users.some((x) => x.username === u)) return alert("用户名已存在");
      state.db.users.push({ id: uid("u"), displayName: d, username: u, password: p, contacts: [] });
      saveDb();
      alert("创建成功");
    }
    return;
  }

  const conv = convById(state.activeConversationId);
  if (conv.type === "group") {
    const c = prompt("群菜单：1 公告 2 邀请成员 3 退群 4 静音", "1");
    if (c === "1") {
      if (conv.ownerId !== state.currentUserId) return alert("仅群主可改公告");
      conv.announcement = prompt("新公告", conv.announcement || "") || "";
      pushMsg(conv, { id: uid("m"), senderId: state.currentUserId, type: "system", text: `群公告：${conv.announcement || "（空）"}`, createdAt: Date.now() });
      saveDb();
      renderMessages(conv);
      renderChatList();
    }
    if (c === "2") {
      const can = state.db.users.filter((u) => !conv.members.includes(u.id));
      const n = prompt(`邀请用户名：${can.map((u) => u.username).join("/")}`);
      const t = can.find((u) => u.username === n);
      if (!t) return;
      conv.members.push(t.id);
      pushMsg(conv, { id: uid("m"), senderId: state.currentUserId, type: "system", text: `${nameOf(state.currentUserId)} 邀请 ${t.displayName} 加入群聊`, createdAt: Date.now() });
      saveDb();
      renderMessages(conv);
      renderChatList();
    }
    if (c === "3") {
      if (conv.ownerId === state.currentUserId && conv.members.length > 1) return alert("群主无法直接退群");
      conv.members = conv.members.filter((id) => id !== state.currentUserId);
      saveDb();
      showList();
    }
    if (c === "4") {
      const idx = conv.mutedBy.indexOf(state.currentUserId);
      if (idx >= 0) conv.mutedBy.splice(idx, 1);
      else conv.mutedBy.push(state.currentUserId);
      saveDb();
      alert(idx >= 0 ? "已取消静音" : "已静音");
    }
    return;
  }

  const idx = conv.mutedBy.indexOf(state.currentUserId);
  if (idx >= 0) conv.mutedBy.splice(idx, 1);
  else conv.mutedBy.push(state.currentUserId);
  saveDb();
  alert(idx >= 0 ? "已取消静音" : "已静音");
}

function bindEvents() {
  loginTab.addEventListener("click", () => renderAuth(true));
  registerTab.addEventListener("click", () => renderAuth(false));

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const u = $("loginUsername").value.trim();
    const p = $("loginPassword").value;
    const user = state.db.users.find((x) => x.username === u && x.password === p);
    if (!user) return alert("用户名或密码错误");
    setSession(user.id);
    authScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    showList();
  });

  registerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const d = $("registerDisplayName").value.trim();
    const u = $("registerUsername").value.trim();
    const p = $("registerPassword").value;
    if (!d || !u || p.length < 4) return alert("请完整输入，密码至少4位");
    if (state.db.users.some((x) => x.username === u)) return alert("用户名已存在");
    const user = { id: uid("u"), displayName: d, username: u, password: p, contacts: [] };
    state.db.users.push(user);
    saveDb();
    setSession(user.id);
    authScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    showList();
  });

  searchInput.addEventListener("input", renderChatList);
  newChatBtn.addEventListener("click", createConversationFlow);
  backBtn.addEventListener("click", showList);
  moreBtn.addEventListener("click", chatMoreMenu);

  toggleActionsBtn.addEventListener("click", () => actionPanel.classList.toggle("hidden"));

  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;
    send("text", { text });
    messageInput.value = "";
  });

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => onQuickAction(btn.getAttribute("data-action")));
  });

  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => send("image", { imageUrl: fr.result });
    fr.readAsDataURL(file);
    imageInput.value = "";
  });
}

function bootstrap() {
  state.db = loadDb();
  bindEvents();
  const sid = localStorage.getItem(SESSION_KEY);
  if (sid && state.db.users.some((u) => u.id === sid)) {
    setSession(sid);
    authScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    showList();
  } else {
    showAuth();
  }
}

bootstrap();
