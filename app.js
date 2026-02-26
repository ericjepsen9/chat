const chatMeta = {
  title: "ChatTrade 交易助手",
  subtitle: "微信式聊天交易（移动端）",
};

const orderFlow = ["待付款", "待发货", "运输中", "待收货", "已完成"];

const state = {
  orderStep: -1,
  orderNo: "CTM2026001",
};

const chatTitle = document.getElementById("chatTitle");
const chatSubtitle = document.getElementById("chatSubtitle");
const messages = document.getElementById("messages");
const composer = document.getElementById("composer");
const input = document.getElementById("messageInput");
const shareMallCardBtn = document.getElementById("shareMallCard");

const textTemplate = document.getElementById("textMessageTemplate");
const cardTemplate = document.getElementById("cardMessageTemplate");

function appendText(content, fromMe = true) {
  const node = textTemplate.content.firstElementChild.cloneNode(true);
  node.classList.toggle("me", fromMe);
  node.querySelector(".bubble").textContent = content;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
}

function appendSystemText(content) {
  appendText(`系统：${content}`, false);
}

function appendCard({ type, title, description, meta, actions = [], fromMe = false }) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.classList.toggle("me", fromMe);

  node.querySelector(".chip").textContent = type;
  node.querySelector(".title").textContent = title;
  node.querySelector(".description").textContent = description;
  node.querySelector(".meta").textContent = meta;

  const actionsNode = node.querySelector(".actions");
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.className = action.primary ? "primary" : "";
    button.addEventListener("click", action.onClick);
    actionsNode.appendChild(button);
  });

  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
}

function sendProductCard() {
  appendCard({
    type: "商品卡片",
    title: "Nike Zoom Fly 5 二手跑鞋",
    description: "成色 9.5 新｜同城自提｜支持担保支付",
    meta: "¥629 · 库存 1 · 卖家信用 4.9",
    fromMe: true,
    actions: [
      { label: "查看", onClick: () => appendSystemText("已打开商品详情。") },
      {
        label: "下单",
        primary: true,
        onClick: () => {
          state.orderStep = Math.max(0, state.orderStep);
          syncOrderCard();
        },
      },
      { label: "出价", onClick: () => appendSystemText("买家发起议价：¥580。") },
    ],
  });
}

function sendWalletCard() {
  appendCard({
    type: "钱包卡片",
    title: "担保支付 / 转账",
    description: "支持聊天内收款与转账，风控命中将给出风险提示。",
    meta: "可用余额 ¥12,540 · 实名已认证",
    fromMe: true,
    actions: [
      { label: "转账", primary: true, onClick: () => appendSystemText("转账成功：¥88。") },
      { label: "收款", onClick: () => appendSystemText("已发送收款请求：¥100。") },
    ],
  });
}

function buildOrderActions(status) {
  if (status === "待付款") {
    return [
      {
        label: "付款",
        primary: true,
        onClick: () => {
          state.orderStep = 1;
          syncOrderCard();
        },
      },
      { label: "取消", onClick: () => appendSystemText("订单已取消。") },
    ];
  }

  if (status === "待发货") {
    return [
      { label: "提醒发货", onClick: () => appendSystemText("已提醒卖家发货。") },
      {
        label: "填写物流",
        primary: true,
        onClick: () => {
          state.orderStep = 2;
          syncOrderCard();
        },
      },
    ];
  }

  if (status === "运输中") {
    return [
      { label: "查看物流", onClick: () => appendSystemText("物流：包裹已到达杭州中转站。") },
      {
        label: "确认收货",
        primary: true,
        onClick: () => {
          state.orderStep = 3;
          syncOrderCard();
        },
      },
    ];
  }

  if (status === "待收货") {
    return [
      {
        label: "确认收货",
        primary: true,
        onClick: () => {
          state.orderStep = 4;
          syncOrderCard();
        },
      },
    ];
  }

  return [
    { label: "申请售后", onClick: () => appendSystemText("已进入售后处理入口。") },
    { label: "评价", primary: true, onClick: () => appendSystemText("感谢评价：五星好评！") },
  ];
}

function syncOrderCard() {
  if (state.orderStep < 0) {
    appendSystemText("请先发送商品卡片并点击下单。");
    return;
  }

  const status = orderFlow[state.orderStep];
  appendCard({
    type: "订单卡片",
    title: `订单号 ${state.orderNo}`,
    description: `当前状态：${status}（聊天内同步状态）`,
    meta: "金额 ¥629 · 担保支付 · 物流可追踪",
    actions: buildOrderActions(status),
  });
}

function sendMallCard() {
  appendCard({
    type: "商城商品",
    title: "官方商城 · ANC 蓝牙耳机",
    description: "支持加入购物车/立即购买，也可以分享至聊天下单。",
    meta: "¥299 · 月销 2.8k",
    actions: [
      { label: "加入购物车", onClick: () => appendSystemText("已加入购物车。") },
      { label: "立即购买", primary: true, onClick: () => appendSystemText("正在跳转支付页。") },
    ],
  });
}

function bindEvents() {
  shareMallCardBtn.addEventListener("click", sendMallCard);

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;

    appendText(value, true);
    input.value = "";

    setTimeout(() => {
      appendText("收到，后续交易进度将通过业务卡片同步。", false);
    }, 220);
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      if (action === "product") sendProductCard();
      if (action === "order") syncOrderCard();
      if (action === "wallet") sendWalletCard();
    });
  });
}

function bootstrap() {
  chatTitle.textContent = chatMeta.title;
  chatSubtitle.textContent = chatMeta.subtitle;

  appendSystemText("欢迎使用 ChatTrade 手机版原型。先发送商品卡片开始交易流程。");
  appendText("你好，我想看下这双跑鞋成色和发货时间。", false);
  appendText("可以，支持聊天内下单和担保支付。", true);

  bindEvents();
}

bootstrap();
