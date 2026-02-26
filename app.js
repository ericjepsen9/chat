const ORDER_FLOW = ["待付款", "待发货", "运输中", "待收货", "已完成"];
const SESSION_KEY = "chattrade_api_session_user";

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

const state = {
  currentUser: null,
  conversations: [],
  activeConversation: null,
  messages: [],
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
  state.activeConversation = null;
  state.messages = [];
  backBtn.classList.add("hidden");
  chatTitle.textContent = "消息";
  chatSubtitle.textContent = state.currentUser.displayName;
  chatListView.classList.remove("hidden");
  chatView.classList.add("hidden");
  composerPanel.classList.add("hidden");
  actionPanel.classList.add("hidden");
  renderChatList();
}

async function loadConversations() {
  const data = await api(`/api/conversations?userId=${encodeURIComponent(state.currentUser.id)}`);
  state.conversations = data.conversations;
  renderChatList();
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
        ${conv.unread ? `<span class="badge">${conv.unread}</span>` : ""}
      `;
      node.addEventListener("click", () => openConversation(conv.id));
      chatList.appendChild(node);
    });
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
  chatView.classList.remove("hidden");
  composerPanel.classList.remove("hidden");
  actionPanel.classList.add("hidden");

  renderMessages();
  await loadConversations();
}

function senderName(msg) {
  if (msg.senderId === state.currentUser.id) return "我";
  if (state.activeConversation.type === "group") {
    return msg.senderId.slice(-4);
  }
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
    node.querySelector(".sender").textContent = senderName(msg);
    chatView.appendChild(node);
  });
  chatView.scrollTop = chatView.scrollHeight;
}

async function sendMessage(payload) {
  if (!state.activeConversation) return;
  await api(`/api/conversations/${state.activeConversation.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ senderId: state.currentUser.id, ...payload }),
  });
  await openConversation(state.activeConversation.id);
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
    if (key === "order") {
      const orderCard = makeOrderCard(0, state.activeConversation.id);
      return sendMessage({ type: "card", card: orderCard, senderId: state.activeConversation.members.find((id) => id !== state.currentUser.id) || state.currentUser.id });
    }
  }

  if (card.cardType === "订单卡片") {
    let step = Number(card.step ?? 0);
    if (key === "pay") step = 1;
    if (key === "ship") step = 2;
    if (key === "confirm") step = 3;
    if (key === "finish") step = 4;

    const statusMap = {
      cancel: "订单已取消。",
      remind: "已提醒卖家发货。",
      track: "物流：包裹已到达杭州中转站。",
      review: "已评价：五星好评。",
      after: "已进入售后流程。",
    };
    if (statusMap[key]) return sendMessage({ type: "system", text: statusMap[key] });

    const nextCard = makeOrderCard(step, state.activeConversation.id);
    return sendMessage({ type: "card", card: nextCard, senderId: state.activeConversation.members.find((id) => id !== state.currentUser.id) || state.currentUser.id });
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

async function quickAction(action) {
  if (!state.activeConversation) return;

  if (action === "emoji") return sendMessage({ type: "text", text: ["😀", "😄", "🥳", "👍"][Math.floor(Math.random() * 4)] });
  if (action === "image") return imageInput.click();
  if (action === "at") {
    if (state.activeConversation.type !== "group") return sendMessage({ type: "system", text: "@ 功能仅群聊可用。" });
    messageInput.value = "@成员 ";
    return messageInput.focus();
  }
  if (action === "product") {
    return sendMessage({
      type: "card",
      card: {
        cardType: "商品卡片",
        title: "Nike Zoom Fly 5",
        description: "成色 9.5 新｜同城自提｜支持担保支付",
        meta: "¥629 · 库存1 · 卖家信用4.9",
        actions: [
          { key: "view", label: "查看" },
          { key: "order", label: "下单", primary: true },
          { key: "bid", label: "出价" },
        ],
      },
    });
  }
  if (action === "order") {
    return sendMessage({ type: "card", senderId: state.activeConversation.members.find((id) => id !== state.currentUser.id) || state.currentUser.id, card: makeOrderCard(0, state.activeConversation.id) });
  }
  if (action === "wallet") {
    return sendMessage({
      type: "card",
      card: {
        cardType: "钱包卡片",
        title: "担保支付与转账",
        description: "支持聊天内收款/转账，命中风控会提示",
        meta: "可用余额 ¥12,540 · 实名已认证",
        actions: [
          { key: "transfer", label: "转账", primary: true },
          { key: "collect", label: "收款" },
        ],
      },
    });
  }
  if (action === "mall") {
    return sendMessage({
      type: "card",
      card: {
        cardType: "商城商品",
        title: "官方商城 · ANC蓝牙耳机",
        description: "支持加入购物车/立即购买",
        meta: "¥299 · 月销2.8k",
        actions: [
          { key: "cart", label: "加入购物车" },
          { key: "buy", label: "立即购买", primary: true },
        ],
      },
    });
  }
}

async function createConversationFlow() {
  const usersData = await api(`/api/users?currentUserId=${encodeURIComponent(state.currentUser.id)}`);
  const users = usersData.users;
  if (!users.length) return alert("暂无其他用户");

  const mode = prompt("输入1建单聊，2建群聊", "1");
  if (mode === "1") {
    const username = prompt(`输入用户名：${users.map((u) => u.username).join("/")}`);
    const target = users.find((u) => u.username === username);
    if (!target) return;
    await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ creatorId: state.currentUser.id, type: "direct", memberIds: [target.id] }),
    });
    await loadConversations();
    return;
  }

  if (mode === "2") {
    const groupName = prompt("群名称", "新群聊") || "新群聊";
    const names = prompt(`成员用户名(逗号分隔)：${users.map((u) => u.username).join(",")}`, "") || "";
    const ids = names
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => users.find((u) => u.username === name)?.id)
      .filter(Boolean);

    await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ creatorId: state.currentUser.id, type: "group", name: groupName, memberIds: ids }),
    });
    await loadConversations();
  }
}

async function moreMenu() {
  if (!state.activeConversation) {
    const mode = prompt("消息页菜单：1退出登录 2创建测试用户", "1");
    if (mode === "1") {
      localStorage.removeItem(SESSION_KEY);
      state.currentUser = null;
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
  if (conv.type === "group") {
    const mode = prompt("群菜单：1公告 2邀请成员 3退群 4静音", "1");
    if (mode === "1") {
      const announcement = prompt("新公告", conv.announcement || "") || "";
      try {
        await api(`/api/conversations/${conv.id}/group`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id, op: "announcement", announcement }) });
        await openConversation(conv.id);
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
      await openConversation(conv.id);
    }
    if (mode === "3") {
      await api(`/api/conversations/${conv.id}/group`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id, op: "leave" }) }).catch(() => alert("群主不能直接退群"));
      await loadConversations();
      showList();
    }
    if (mode === "4") {
      const data = await api(`/api/conversations/${conv.id}/mute`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) });
      alert(data.muted ? "已静音" : "已取消静音");
      await loadConversations();
    }
    return;
  }

  const data = await api(`/api/conversations/${conv.id}/mute`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) });
  alert(data.muted ? "已静音" : "已取消静音");
  await loadConversations();
}

function bindEvents() {
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
      await loadConversations();
      showList();
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
      await loadConversations();
      showList();
    } catch {
      alert("注册失败（用户名可能已存在 / 密码不足4位）");
    }
  });

  searchInput.addEventListener("input", renderChatList);
  backBtn.addEventListener("click", showList);
  newChatBtn.addEventListener("click", createConversationFlow);
  moreBtn.addEventListener("click", moreMenu);

  toggleActionsBtn.addEventListener("click", () => actionPanel.classList.toggle("hidden"));

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
}

async function bootstrap() {
  bindEvents();
  const sessionRaw = localStorage.getItem(SESSION_KEY);
  if (!sessionRaw) return showAuth();

  try {
    const user = JSON.parse(sessionRaw);
    state.currentUser = user;
    authScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    await loadConversations();
    showList();
  } catch {
    showAuth();
  }
}

bootstrap();
