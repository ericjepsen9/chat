// Session, API, UI utilities moved to app_utils.js

// ---- Constants: delays, limits, and reusable values ----
const DELAYS = { TYPING_TIMEOUT: 3000, ANIMATION: 1500, SCAN_DETECT: 350, SCAN_INIT: 400, RESEND_COUNTDOWN: 60, INCOMING_CALL_TIMEOUT: 30000, MESSAGE_RECALL_WINDOW: 120000, TIME_SEPARATOR_GAP: 180000, PERMISSION_WAIT: 1500 };
const LIMITS = { STORE_PREVIEW: 6, SWIPE_ACTION_WIDTH: 156, DRAG_THRESHOLD: 48 };
function disableTextSelection() { document.body.style.userSelect = 'none'; document.body.style.webkitUserSelect = 'none'; }
function enableTextSelection() { document.body.style.userSelect = ''; document.body.style.webkitUserSelect = ''; }
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ORDER_STATUS = { PENDING: 'pending', ACCEPTED: 'accepted', COMPLETED: 'completed', PROCESSING: 'processing', IN_PROGRESS: 'in_progress' };
const CONV_TYPE = { DIRECT: 'direct', TRADE: 'trade', SYSTEM: 'system' };
const DEFAULT_GROUP = '我的好友';

const state = {
  currentUser: null, sessionToken: null, conversations: [], conversationsById: new Map(), activeConversation: null, messages: [], messagesById: new Map(),
  friends: [], friendsById: new Map(), friendRequests: [], currentProfileUser: null, targetForGroupMove: null,
  profileStoreItems: [], profileCartBySeller: {}, selectedProfileProduct: null, selectedProfileSpec: '', profileOrders: [], currentCartSellerId: '',
  profileStoreExpanded: false, profileStoreCategoryFilter: '',
  systemMessages: [],
  adminDashboard: null,
  paymentCodeDraft: { wechat:'', alipay:'', cloudpay:'' },
  buyerOrders: [], sellerOrders: [], ordersById: new Map(), sellerProducts: [], selectedOrderDetail: null, selectedOrderRole: 'buyer', selectedProductDetail: null, publishEditingProductId: '', sellerProductViewTab: 'listed', sellerProductSearch: '', sellerProductSort: 'newest', buyerOrderSearch: '', buyerOrderFrom: '', buyerOrderTo: '', sellerOrderSearch: '', sellerOrderFrom: '', sellerOrderTo: '', broadcastDrafts: [], tradePickerResolver: null,
  hasMoreMessages: false, isLoadingMessages: false, oldestMessageTime: 0, 
  eventSource: null, peerLastReadAt: 0, rtc: { pc: null, mode: null, peerId: null, pendingOffer: null, incomingMeta: null, pendingAccept: false, earlyCandidates: [], remoteCandidateQueue: [], phase: 'idle', endingLocally: false, conversationId: null, callId: null, lastEndedCallId: null, incomingShownKey: null }, 
  typingTimer: null, mediaRecorder: null, audioChunks: [], chatListSignature: '', friendListSignature: '', mallListSignature: '', conversationItemSignatures: {}, friendGroupSignatures: {}, friendItemSignatures: {}, mallItemSignatures: {},
  mallTab: 'nearby', userLocation: null, userLocationName: '正在定位...',
  sidebarMode: 'expanded',
  secondaryStack: []
};
let isMuted = false, isCameraOff = false, isSpeaker = false;
const CATEGORY_SPLIT_RE = /[\/,、]/;
const formatOrderId = (id) => String(id || '').slice(-6);
const orderPrefix = (role) => role === 'seller' ? 'seller' : 'buyer';
const orderStatusCls = (prefix, st) => { const s = String(st || '').toLowerCase(); return prefix + (s === 'completed' ? ' s-done' : (s === 'accepted' || s === 'processing' || s === 'in_progress') ? ' s-active' : ' s-pending'); };
const tradeStatusCls = (st) => 'trade-card-status' + (st === 'completed' ? ' done' : st === 'accepted' ? ' active' : '');

const isFriendUser = (userId) => !!(userId && state.friendsById.has(userId));

function findFriendEntry(userId) {
  return state.friendsById.get(userId);
}

function getPendingFriendRequest(userId) {
  return state.friendRequests.find(r => r.status === 'pending' && (r.sender?.id === userId || r.fromUser?.id === userId));
}

function updateProfileDetailActions(){
  const p = state.currentProfileUser;
  if(!p) return;
  const isFriend = !!p.isFriend || isFriendUser(p.id);
  const isSelf = p.id === state.currentUser?.id;
  const pendingReq = !isFriend && !isSelf ? getPendingFriendRequest(p.id) : null;
  const addBtn = $("profileAddFriendBtn"), hint = $("profileStrangerHint"),
    remarkBtn = $("profileActionRemarkBtn"), moveBtn = $("profileActionMoveGroupBtn"),
    sendBtn = $("profileSendMessageBtn"), primaryActs = $("profilePrimaryActions"),
    reqActs = $("profileFriendRequestActions"),
    acceptBtn = $("profileAcceptRequestBtn"), rejectBtn = $("profileRejectRequestBtn");
  if(addBtn) addBtn.classList.toggle("hidden", isFriend || !!pendingReq);
  if(hint) hint.classList.toggle("hidden", isFriend || isSelf);
  if(remarkBtn) remarkBtn.style.display = isFriend ? '' : 'none';
  if(moveBtn) moveBtn.style.display = isFriend ? '' : 'none';
  if(sendBtn) sendBtn.classList.toggle("hidden", isSelf);
  if(primaryActs) primaryActs.classList.toggle('hidden', isFriend || isSelf || !!pendingReq);
  if(reqActs) {
    reqActs.classList.toggle('hidden', !pendingReq);
    if (pendingReq) {
      const reqId = pendingReq.id;
      if(acceptBtn) acceptBtn.onclick = () => window.acceptRequest(reqId);
      if(rejectBtn) rejectBtn.onclick = () => window.rejectRequest(reqId);
    } else {
      if(acceptBtn) acceptBtn.onclick = null;
      if(rejectBtn) rejectBtn.onclick = null;
    }
  }
}



function getCurrentSellerCart(sellerId = ''){
  const id = sellerId || state.currentCartSellerId || state.currentProfileUser?.id || '';
  if (!id) return [];
  if (!state.profileCartBySeller || typeof state.profileCartBySeller !== 'object') state.profileCartBySeller = {};
  if (!Array.isArray(state.profileCartBySeller[id])) state.profileCartBySeller[id] = [];
  return state.profileCartBySeller[id];
}

function getCartSummary() {
  let count = 0, total = 0;
  for (const arr of Object.values(state.profileCartBySeller || {})) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const qty = Number(item.quantity) || 0;
      count += qty;
      total += (Number(item.unitPrice) || 0) * qty;
    }
  }
  return { count, total };
}
function getGroupedCartTotal(){ return getCartSummary().total; }
function getGroupedCartCount(){ return getCartSummary().count; }
const CART_STORAGE_KEY = 'chattrade_cart';
function saveCartToStorage() {
  try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.profileCartBySeller || {})); } catch(_) {}
}
function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (raw) state.profileCartBySeller = JSON.parse(raw) || {};
  } catch(_) { state.profileCartBySeller = {}; }
}

// formatMoney, parseMoney moved to app_utils.js

function getSecondaryBackTarget(defaultTarget = 'home'){
  if (state.secondaryPage) return state.secondaryPage;
  if (state.secondaryReturn) return state.secondaryReturn;
  return defaultTarget;
}


function rebuildOrdersById() {
  const map = new Map();
  for (const o of (state.buyerOrders || [])) map.set(o.id, o);
  for (const o of (state.sellerOrders || [])) if (!map.has(o.id)) map.set(o.id, o);
  state.ordersById = map;
}
const loadBuyerOrders = singleFlight(async function _loadBuyerOrdersImpl(){
  if(!state.currentUser) return;
  try{
    const data = await api('/api/orders');
    state.buyerOrders = data.orders || [];
  }catch(_){
    state.buyerOrders = [];
  }
  rebuildOrdersById();
  renderBuyerOrdersManage();
  scheduleRenderConversationList();
});

const loadSellerOrders = singleFlight(async function _loadSellerOrdersImpl(){
  if(!state.currentUser) return;
  try{
    const data = await api(`/api/orders?sellerId=${encodeURIComponent(state.currentUser.id)}`);
    state.sellerOrders = data.orders || [];
  }catch(_){
    state.sellerOrders = [];
  }
  rebuildOrdersById();
  renderSellerOrdersManage();
  scheduleRenderConversationList();
});

// Unified order data refresh — call after ANY order state change
async function refreshAllOrderData() {
  await Promise.all([
    loadBuyerOrders(),
    loadSellerOrders(),
    loadProfileOrders(),
    state.activeConversation?.id ? reloadActiveConversationMessages() : Promise.resolve()
  ]);
  renderConversationListFromState();
}

let tradeRefreshTimer = null;
function scheduleTradeReminderRefresh(delayMs = 300) {
  if (!state.currentUser) return;
  if (tradeRefreshTimer) clearTimeout(tradeRefreshTimer);
  tradeRefreshTimer = setTimeout(() => {
    tradeRefreshTimer = null;
    loadBuyerOrders();
    loadSellerOrders();
  }, Math.max(0, Number(delayMs) || 0));
}

function syncSellerProducts(){
  state.sellerProducts = Array.isArray(state.currentUser?.products) ? [...state.currentUser.products] : [];
  renderSellerProductsManage();
}

async function refreshProductViews(){
  await Promise.all([loadMyProducts(), loadSellerProductsManage(), loadMall()]);
  if (state.currentProfileUser?.id && state.currentProfileUser.id === state.currentUser?.id) {
    await loadProfileStore(state.currentUser.id);
  }
}

async function syncProductViewsIfVisible(){
  const tasks = [];
  const sellerPageVisible = $("sellerProductsPage") && !$("sellerProductsPage").classList.contains('hidden');
  const myProductsPageVisible = $("myProductsPage") && !$("myProductsPage").classList.contains('hidden');
  const selfProfileVisible = $("profileDetailPage") && !$("profileDetailPage").classList.contains('hidden') && state.currentProfileUser?.id === state.currentUser?.id;
  if (sellerPageVisible) tasks.push(loadSellerProductsManage());
  if (myProductsPageVisible) tasks.push(loadMyProducts());
  if (selfProfileVisible) tasks.push(loadProfileStore(state.currentUser.id));
  if (tasks.length) await Promise.all(tasks);
}

const loadSellerProductsManage = singleFlight(async function _loadSellerProductsImpl(){
  if(!state.currentUser?.id) return;
  try {
    const data = await api(`/api/users/${state.currentUser.id}/store`);
    state.sellerProducts = Array.isArray(data.items) ? data.items : [];
    state.currentUser.products = [...state.sellerProducts];
    writeSession(state.currentUser);
  } catch (_) {
    syncSellerProducts();
  }
  // Load category presets for filter
  try {
    const presets = await api('/api/product-presets');
    state._sellerCategoryPresets = presets.categoryPresets || [];
  } catch (_) {}
  populateSellerCategoryFilter();
  renderSellerProductsManage();
});


function orderMatchesFilters(order, role = 'buyer'){
  const prefix = orderPrefix(role);
  const keyword = String(state[`${prefix}OrderSearch`] || '').trim().toLowerCase();
  const fromVal = state[`${prefix}OrderFrom`] || '';
  const toVal = state[`${prefix}OrderTo`] || '';
  const createdAt = Number(order?.createdAt || 0);
  if (keyword) {
    const counterpartyName = role === 'buyer' ? (order?.sellerName || '') : (order?.buyerName || '');
    const hay = `#${formatOrderId(order?.id)} ${(order?.items || []).map(i => `${i.title} ${i.spec || ''}`).join(' ')} ${counterpartyName}`.toLowerCase();
    if (!hay.includes(keyword)) return false;
  }
  if (fromVal) {
    const fromTs = Date.parse(fromVal);
    if (Number.isFinite(fromTs) && createdAt < fromTs) return false;
  }
  if (toVal) {
    const toTs = Date.parse(toVal);
    if (Number.isFinite(toTs) && createdAt > toTs + 86400000) return false;
  }
  return true;
}

function syncOrderFilterInputs(role = 'buyer'){
  const prefix = orderPrefix(role);
  const searchEl = $(`${prefix}OrdersSearchInput`);
  const fromEl = $(`${prefix}OrdersFromInput`);
  const toEl = $(`${prefix}OrdersToInput`);
  if (searchEl) searchEl.value = state[`${prefix}OrderSearch`] || '';
  if (fromEl) fromEl.value = state[`${prefix}OrderFrom`] || '';
  if (toEl) toEl.value = state[`${prefix}OrderTo`] || '';
  syncOrderDateBtnText(role);
  updateOrderPresetUI(role);
}

function updateOrderPresetUI(role = 'buyer'){
  const prefix = orderPrefix(role);
  const root = $(`${prefix}OrdersRangePresets`);
  if (!root) return;
  const fromVal = state[`${prefix}OrderFrom`] || '';
  const toVal = state[`${prefix}OrderTo`] || '';
  const fromTs = Date.parse(fromVal);
  const toTs = Date.parse(toVal);
  const now = Date.now();
  root.querySelectorAll('.order-filter-chip').forEach((btn) => {
    const days = Number(btn.dataset.range || 0);
    let active = false;
    if (Number.isFinite(fromTs) && Number.isFinite(toTs) && days > 0) {
      const start = now - (days * MS_PER_DAY);
      active = Math.abs(fromTs - start) < 2 * 60 * 1000 && Math.abs(toTs - now) < 2 * 60 * 1000;
    }
    btn.classList.toggle('active', active);
  });
}

function applyOrderQuickRange(role = 'buyer', days = 0){
  const prefix = orderPrefix(role);
  const now = new Date();
  const from = new Date(now.getTime() - Math.max(1, days) * MS_PER_DAY);
  const fmt = (d) => {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };
  state[`${prefix}OrderFrom`] = fmt(from);
  state[`${prefix}OrderTo`] = fmt(now);
  if (role === 'seller') renderSellerOrdersManage();
  else renderBuyerOrdersManage();
}

// WeChat-style Date Picker moved to app_datepicker.js

async function deleteOrderRecord(orderId){
  if(!orderId) return;
  try{
    await api(`/api/orders/${orderId}/delete`, { method:'POST', body: JSON.stringify({}) });
    await refreshAllOrderData();
    showToast('订单已删除');
  }catch(e){
    showModal(e.message || '删除失败（仅已完成订单可删除）');
  }
}

// orderStatusText removed — use formatOrderStatusLabel directly

// ---- Shared order action helpers (eliminates duplication across 4 contexts) ----
async function doUpdateOrderPrice(orderId, rawPrice) {
  await api(`/api/orders/${orderId}/price`, { method:'POST', body: JSON.stringify({ total: parseMoney(rawPrice) }) });
  await refreshAllOrderData();
}

async function doAcceptOrder(orderId) {
  const data = await api(`/api/orders/${orderId}/accept`, { method:'POST', body: '{}' });
  await refreshAllOrderData();
  return data;
}

async function doCompleteOrder(orderId) {
  const data = await api(`/api/orders/${orderId}/status`, { method:'POST', body: JSON.stringify({ status:'completed' }) });
  await refreshAllOrderData();
  return data;
}

function buildOrderCard(order, role){
  const card = createEl('button', 'profile-order-card');
  card.type = 'button';

  const statusCls = orderStatusCls('order-card-status', order.status);
  const header = createEl('div', 'order-card-header');
  header.append(createEl('span', 'order-card-id', `#${formatOrderId(order.id)}`), createEl('span', statusCls, formatOrderStatusLabel(order.status)));

  const body = createEl('div', 'order-card-body');
  body.appendChild(createEl('div', 'order-card-items', (order.items || []).map(i => `${i.title}(${i.spec || '默认'}) x${i.quantity || 1}`).join('，') || '订单内容'));

  const footer = createEl('div', 'order-card-footer');
  footer.append(createEl('span', 'order-card-price', formatMoney(order.total)), createEl('span', 'order-card-time', order.createdAt ? formatTime(order.createdAt) : ''));

  card.append(header, body, footer);

  const actions = createEl('div', 'order-card-actions');
  if(role === 'seller' && order.status === 'pending'){
    const editPriceBtn = createStopBtn('secondary-btn', '修改价格', (e, btn) => {
      if(!order.id) return;
      showPrompt('请输入新的总价', String(order.total || ''), (raw) => {
        withButtonLock(btn, async () => { await doUpdateOrderPrice(order.id, raw); renderSellerOrdersManage(); }, '修改中...');
      });
    });
    actions.appendChild(editPriceBtn);
    const acceptBtn = createStopBtn('primary-btn', '接单', (e, btn) => {
      if(!order.id) return;
      withButtonLock(btn, async () => { await doAcceptOrder(order.id); renderSellerOrdersManage(); }, '接单中...');
    });
    actions.appendChild(acceptBtn);
  }
  if(order.status === 'accepted'){
    const completeLabel = role === 'buyer' ? '确认收货' : '标记已完成';
    const completeBtn = createStopBtn('primary-btn', completeLabel, (e, btn) => {
      const msg = role === 'buyer' ? '确认已收到商品？订单将标记为已完成。' : '确认订单已完成？';
      showConfirm(msg, () => {
        withButtonLock(btn, async () => { await doCompleteOrder(order.id); if(role === 'buyer') renderBuyerOrdersManage(); else renderSellerOrdersManage(); }, '处理中...');
      });
    });
    actions.appendChild(completeBtn);
  }
  if(order.status === 'completed'){
    const delBtn = createStopBtn('order-card-del-btn', '删除', (e, btn) => {
      showConfirm('确认删除该订单？', () => {
        withButtonLock(btn, () => deleteOrderRecord(order.id), '删除中...');
      });
    });
    actions.appendChild(delBtn);
  }
  if(actions.childElementCount) card.appendChild(actions);

  card.addEventListener('click', () => openOrderDetail(order, role));
  return card;
}

function renderOrdersManage(role, listId, ordersKey, emptyMsg) {
  const list = $(listId);
  if(!list) return;
  syncOrderFilterInputs(role);
  const rows = (state[ordersKey] || []).filter((o) => orderMatchesFilters(o, role));
  const sig = rows.map(o => o.id + '|' + o.status + '|' + (o.updatedAt||0)).join(';') + '|' + state[role + 'OrderSearch'] + '|' + state[role + 'OrderFrom'] + '|' + state[role + 'OrderTo'];
  if (!sigChanged(ordersKey, sig)) return;
  if(!rows.length){ showEmptyState(list, emptyMsg, 'order-empty-state'); return; }
  const frag = document.createDocumentFragment();
  rows.forEach(order => frag.appendChild(buildOrderCard(order, role)));
  list.replaceChildren(frag);
}
function renderBuyerOrdersManage() { renderOrdersManage('buyer', 'buyerOrdersManageList', 'buyerOrders', '🧾 暂无购买订单'); }
function renderSellerOrdersManage() { renderOrdersManage('seller', 'sellerOrdersList', 'sellerOrders', '📋 暂无卖家订单'); }


function updateSellerProductsFilterUI(){
  const listedTab = $("sellerProductsListedTab");
  const unlistedTab = $("sellerProductsUnlistedTab");
  if (listedTab) listedTab.classList.toggle('active', state.sellerProductViewTab !== 'unlisted');
  if (unlistedTab) unlistedTab.classList.toggle('active', state.sellerProductViewTab === 'unlisted');
  if ($("sellerProductsSearchInput")) $("sellerProductsSearchInput").value = state.sellerProductSearch || '';
  if ($("sellerProductsSortSelect")) $("sellerProductsSortSelect").value = state.sellerProductSort || 'newest';
  if ($("sellerProductsCategoryFilter")) $("sellerProductsCategoryFilter").value = state.sellerProductCategoryFilter || '';
}

function populateSellerCategoryFilter(){
  const sel = $("sellerProductsCategoryFilter");
  if (!sel) return;
  // Collect categories from seller's own products + presets
  const cats = new Set();
  (state.sellerProducts || []).forEach(p => {
    if (p.category) p.category.split(CATEGORY_SPLIT_RE).forEach(c => { const t = c.trim(); if (t) cats.add(t); });
  });
  // Also merge from presets if loaded
  (state._sellerCategoryPresets || []).forEach(c => cats.add(c));
  const prev = sel.value;
  const defaultOpt = createEl('option', '', '全部分类');
  defaultOpt.value = '';
  const frag = document.createDocumentFragment();
  frag.appendChild(defaultOpt);
  [...cats].sort().forEach(cat => {
    const opt = createEl('option', '', cat);
    opt.value = cat;
    frag.appendChild(opt);
  });
  sel.replaceChildren(frag);
  sel.value = prev || '';
}

function getFilteredSellerProducts(){
  const all = Array.isArray(state.sellerProducts) ? state.sellerProducts : [];
  const showUnlisted = state.sellerProductViewTab === 'unlisted';
  const keyword = String(state.sellerProductSearch || '').trim().toLowerCase();
  const catFilter = String(state.sellerProductCategoryFilter || '').trim();
  const visible = all.filter((item) => {
    const listed = item?.listed !== false;
    if (showUnlisted ? listed : !listed) return false;
    if (catFilter) {
      const parts = (item.category || '').split(CATEGORY_SPLIT_RE);
      let catMatch = false;
      for (let j = 0; j < parts.length; j++) { if (parts[j].trim() === catFilter) { catMatch = true; break; } }
      if (!catMatch) return false;
    }
    if (keyword) {
      const hay = `${item.title || ''} ${item.category || ''} ${item.desc || ''}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });
  const sortBy = state.sellerProductSort || 'newest';
  if (sortBy === 'price_asc' || sortBy === 'price_desc') {
    for (const p of visible) p._sortPrice = parseMoney(p.price);
    visible.sort((a, b) => sortBy === 'price_asc' ? a._sortPrice - b._sortPrice : b._sortPrice - a._sortPrice);
  } else if (sortBy === 'stock_desc') {
    visible.sort((a, b) => (Number(b.stock)||0) - (Number(a.stock)||0));
  } else {
    visible.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  return visible;
}

function renderSellerProductsManage(){
  const list = $("sellerProductsList");
  if(!list) return;
  populateSellerCategoryFilter();
  updateSellerProductsFilterUI();
  const products = getFilteredSellerProducts();
  const sig = products.map(p => p.id + '|' + (p.listed?1:0) + '|' + (p.stock||0) + '|' + (p.price||'')).join(';') + '|' + state.sellerProductViewTab + '|' + state.sellerProductSearch + '|' + state.sellerProductSort + '|' + (state.sellerProductCategoryFilter||'');
  if (!sigChanged('sellerProducts', sig)) return;
  if(!products.length){ showEmptyState(list, '📦 ' + (state.sellerProductViewTab === 'unlisted' ? '暂无未上架商品' : '暂无已上架商品，可先发布'), 'order-empty-state'); return; }
  const frag = document.createDocumentFragment();
  products.forEach(item => {
    const card = createEl('div', 'sp-card');
    card.addEventListener('click', () => openProductDetail(item, true));

    const imgUrl = normalizeMediaUrl(item.image || item.imageUrl) || '';
    if (imgUrl) {
      const img = createEl('img', 'sp-card-img');
      img.src = imgUrl;
      img.alt = item.title || '商品';
      hideOnError(img);
      card.appendChild(img);
    }

    const body = createEl('div', 'sp-card-body');

    const topRow = createEl('div', 'sp-card-top');
    topRow.appendChild(createEl('div', 'sp-card-title', item.title || '未命名商品'));
    body.appendChild(topRow);

    body.appendChild(createEl('div', 'sp-card-desc', item.desc || '可在商品详情页继续编辑文案与规格'));

    const meta = createEl('div', 'sp-card-meta');
    const stockNum = Math.max(0, Math.floor(Number(item.stock || 0)));
    meta.append(createEl('span', 'sp-card-price', formatMoney(item.price)), createEl('span', 'sp-card-stock' + (stockNum === 0 ? ' low' : ''), `库存 ${stockNum}`));
    body.appendChild(meta);

    const actions = createEl('div', 'sp-card-actions');

    const editBtn = createStopBtn('sp-action-btn', '编辑', () => openPublishProductPage('sellerProductsPage', item));
    const stockBtn = createStopBtn('sp-action-btn', '改库存', () => window.updateSellerProductStock(item.id, item.stock || 0));
    const listedBtn = createStopBtn('sp-action-btn' + (item.listed === false ? ' accent' : ''), item.listed === false ? '上架' : '下架', (e, btn) => {
      withButtonLock(btn, () => window.toggleSellerProductListed(item.id, item.listed === false));
    });
    const delBtn = createStopBtn('sp-action-btn danger', '删除', () => window.deleteMyProduct(item.id));

    actions.append(editBtn, stockBtn, listedBtn, delBtn);
    body.appendChild(actions);
    card.appendChild(body);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}


function openProductDetail(item, fromSeller = false){
  if(!item) return;
  state.selectedProductDetail = { ...item, fromSeller: !!fromSeller };
  const _pdImg = $("productDetailImage");
  if(_pdImg) { _pdImg.style.display = ''; hideOnError(_pdImg); _pdImg.src = normalizeMediaUrl(item.image || item.imageUrl) || ''; }
  setText("productDetailTitle", item.title || '商品');
  setText("productDetailDesc", item.desc || '商品详情页为图片、文字、价格与规格');
  setText("productDetailPrice", formatMoney(item.price));
  const stock = Math.max(0, Math.floor(Number(item.stock || 0)));
  setText("productDetailStock", `库存 ${stock}`);
  const specsEl = $("productDetailSpecs");
  if(specsEl){
    const specs = Array.isArray(item.specs) && item.specs.length ? item.specs : ['默认规格'];
    const frag = document.createDocumentFragment();
    specs.forEach(spec => frag.appendChild(createEl('span', 'spec-option-chip', spec)));
    specsEl.replaceChildren(frag);
  }
  const isOwnProduct = !fromSeller && item.sellerId && item.sellerId === state.currentUser?.id;
  toggleEl("productDetailOpenSellerBtn", 'hidden', !fromSeller);
  toggleEl("productDetailBuyNowBtn", 'hidden', fromSeller || isOwnProduct);
  toggleEl("productDetailAddCartBtn", 'hidden', fromSeller || isOwnProduct);
  toggleEl("productDetailChatBtn", 'hidden', fromSeller || isOwnProduct);
  // Show seller management buttons on detail page
  toggleEl("productDetailSellerActions", 'hidden', !fromSeller);
  if(fromSeller && $("productDetailListedBtn")) {
    $("productDetailListedBtn").textContent = item.listed === false ? '上架' : '下架';
    $("productDetailListedBtn").className = 'sp-action-btn' + (item.listed === false ? ' accent' : '');
  }
  window.openSecondaryPage('productDetailPage', getSecondaryBackTarget(state.activeConversation ? 'chat' : 'home'));
}

function openOrderDetail(order, role = 'buyer'){
  if(!order) return;
  state.selectedOrderDetail = order;
  state.selectedOrderRole = role;
  renderOrderDetailPage();
  window.openSecondaryPage('orderDetailPage', getSecondaryBackTarget(state.activeConversation ? 'chat' : 'home'));
}

function renderOrderDetailPage(){
  const box = $("orderDetailCard");
  if(!box) return;
  const order = state.selectedOrderDetail;
  const role = state.selectedOrderRole || 'buyer';
  const sig = order ? (order.id+'|'+order.status+'|'+(order.total||0)+'|'+(order.updatedAt||0)+'|'+role) : '';
  if (!sigChanged('orderDetail', sig)) return;
  if(!order){
    box.textContent = '暂无订单详情';
    return;
  }
  setText("orderDetailStatus", formatOrderStatusLabel(order.status));
  box.replaceChildren();

  // Helper: build an od-row with label/value
  const odRow = (label, value, valueCls = 'od-value') => {
    const row = createEl('div', 'od-row');
    row.append(createEl('span', 'od-label', label), createEl('span', valueCls, value));
    return row;
  };

  // Order number & time
  const headerDiv = createEl('div', 'od-section');
  headerDiv.append(
    odRow('订单编号', String(order.id || '-')),
    odRow('下单时间', order.createdAt ? formatTime(order.createdAt) : '-'),
    odRow('订单状态', formatOrderStatusLabel(order.status), `od-value od-status-${order.status === ORDER_STATUS.COMPLETED ? 'done' : 'active'}`)
  );
  box.appendChild(headerDiv);

  // Counterparty info
  const counterLabel = role === 'buyer' ? '卖家' : '买家';
  const counterId = role === 'buyer' ? order.sellerId : order.buyerId;
  const counterName = role === 'buyer' ? (order.sellerName || '') : (order.buyerName || '');
  const partyDiv = createEl('div', 'od-section');
  const counterValueEl = createEl('span', 'od-value od-link', counterName || counterId || '-');
  if (counterId) {
    counterValueEl.classList.add('od-clickable');
    counterValueEl.addEventListener('click', () => window.openUserProfile(counterId, counterName));
  }
  const partyRow = createEl('div', 'od-row');
  partyRow.append(createEl('span', 'od-label', counterLabel), counterValueEl);
  partyDiv.appendChild(partyRow);
  box.appendChild(partyDiv);

  // Item list
  const itemsDiv = createEl('div', 'od-section');
  itemsDiv.appendChild(createEl('div', 'od-section-title', '商品清单'));
  (order.items || []).forEach(item => {
    const row = createEl('div', 'od-item-row');
    const imgUrl = normalizeMediaUrl(item.imageUrl || item.image || '');
    if (imgUrl) {
      const img = createEl('img', 'od-item-img');
      img.src = imgUrl;
      img.alt = '';
      row.appendChild(img);
    }
    const info = createEl('div', 'od-item-info');
    info.append(
      createEl('div', 'od-item-name', item.title || '商品'),
      createEl('div', 'od-item-spec', `${item.spec || '默认规格'} x${item.quantity || 1}`)
    );
    row.append(info, createEl('div', 'od-item-price', formatMoney((item.price || 0) * (item.quantity || 1))));
    itemsDiv.appendChild(row);
  });
  box.appendChild(itemsDiv);

  // Total
  const totalDiv = createEl('div', 'od-section od-total-section');
  totalDiv.appendChild(odRow('合计', formatMoney(order.total), 'od-value od-total'));
  if(order.pendingPrice != null && order.pendingPriceRequestedBy){
    const pendingVal = createEl('span', 'od-value od-pending-price', formatMoney(order.pendingPrice));
    const pendingRow = createEl('div', 'od-row');
    pendingRow.append(createEl('span', 'od-label', '改价申请中'), pendingVal);
    totalDiv.appendChild(pendingRow);
  }
  if(order.priceAdjustmentLocked){
    totalDiv.appendChild(createEl('div', 'od-row')).appendChild(createEl('span', 'od-label od-muted', '价格已锁定'));
  }
  box.appendChild(totalDiv);

  // Remark
  if(order.remark){
    const remarkDiv = createEl('div', 'od-section');
    remarkDiv.appendChild(odRow('备注', order.remark));
    box.appendChild(remarkDiv);
  }

  // Action buttons visibility
  const hasPending = order.pendingPrice != null && !!order.pendingPriceRequestedBy;
  toggleEl("orderDetailAcceptBtn", 'hidden', role !== 'seller' || order.status !== 'pending');
  toggleEl("orderDetailEditPriceBtn", 'hidden', role !== 'seller' || order.status !== 'pending');
  toggleEl("orderDetailPriceRequestBtn", 'hidden', true);
  toggleEl("orderDetailCompleteBtn", 'hidden', order.status !== 'accepted');
  toggleEl("orderDetailChatBtn", 'hidden', !counterId);
}

function updateSelectedOrderPrice(){
  const order = state.selectedOrderDetail;
  if(!order?.id) return;
  showPrompt('请输入新的总价', String(order.total || ''), async (raw) => {
    try{
      await doUpdateOrderPrice(order.id, raw);
      renderOrderDetailPage();
    }catch(e){ showModal(e.message || '修改失败'); }
  });
}

async function completeSelectedOrder(){
  const order = state.selectedOrderDetail;
  if(!order?.id) return;
  const isBuyerRole = state.selectedOrderRole === 'buyer';
  showConfirm(isBuyerRole ? '确认已收到商品？订单将标记为已完成。' : '确认订单已完成？', async () => {
    try{
      const data = await doCompleteOrder(order.id);
      state.selectedOrderDetail = data.order || order;
      renderOrderDetailPage();
      showToast('订单已完成');
    }catch(e){ showModal(e.message || '更新失败'); }
  });
}

function renderBroadcastDrafts(){
  const list = $("broadcastDraftList");
  if(!list) return;
  const sig = state.broadcastDrafts.map(d => (d.id||'')+'|'+(d.title||'')).join(';');
  if (!sigChanged('broadcastDrafts', sig)) return;
  if(!state.broadcastDrafts.length){
    showEmptyState(list, '暂无广播草稿');
    return;
  }
  const frag = document.createDocumentFragment();
  state.broadcastDrafts.forEach((item) => {
    const card = buildProfileCard(item.title || '未命名广播', item.summary || '-', 'button');
    card.addEventListener('click', () => {
      state.selectedBroadcastDraft = item;
      openBroadcastDetail(item.title, item.summary);
    });
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function saveBroadcastDraft(){
  const title = ($("broadcastTitleInput")?.value || '').trim();
  const summary = ($("broadcastSummaryInput")?.value || '').trim();
  const target = ($("broadcastTargetInput")?.value || '').trim();
  if(!title) return showModal('请输入广播标题');
  state.broadcastDrafts.unshift({ id: `b_${Date.now()}`, title, summary, target });
  if($("broadcastTitleInput")) $("broadcastTitleInput").value = '';
  if($("broadcastSummaryInput")) $("broadcastSummaryInput").value = '';
  if($("broadcastTargetInput")) $("broadcastTargetInput").value = '';
  renderBroadcastDrafts();
  showModal('广播草稿已保存');
  window.openSecondaryPage('broadcastManagePage', state.secondaryReturn || 'profile');
}

const loadProfileStore = singleFlight(async function _loadProfileStoreImpl(userId){
  if(!userId || !state.currentUser) return;
  state.profileStoreExpanded = false;
  state.profileStoreCategoryFilter = '';
  try{
    const data = await api(`/api/users/${userId}/store`);
    state.profileStoreItems = data.items || [];
  }catch(_){
    state.profileStoreItems = [];
  }
  renderProfileStore();
  await loadProfileOrders();
});


function sumCartTotals(items) {
  let count = 0, total = 0;
  for (let i = 0; i < items.length; i++) { const q = Number(items[i].quantity)||0; count += q; total += (Number(items[i].unitPrice)||0)*q; }
  return { count, total };
}

function getProfileStoreItemCartQuantity(item){
  if(!item) return 0;
  const cart = getCurrentSellerCart(item.sellerId || state.currentProfileUser?.id || '');
  if(!cart.length) return 0;
  const pid = String(item.id);
  let sum = 0;
  for (let i = 0; i < cart.length; i++) { if (String(cart[i].productId) === pid) sum += (Number(cart[i].quantity) || 0); }
  return sum;
}

function getItemAvailableStock(item){
  const stock = Number(item?.stock ?? 0);
  if (!Number.isFinite(stock)) return 0;
  return Math.max(0, Math.floor(stock));
}

function adjustProfileStoreItemQuantity(item, delta){
  if(!item || !delta) return;
  const cart = getCurrentSellerCart(item.sellerId || state.currentProfileUser?.id || '');
  const defaultSpec = (Array.isArray(item.specs) && item.specs.length ? item.specs[0] : '默认规格') || '默认规格';
  const key = `${item.id}__${defaultSpec}`;
  const found = cart.find(i => i.key === key);
  const inCartQty = getProfileStoreItemCartQuantity(item);
  const availableStock = getItemAvailableStock(item);
  if(delta > 0){
    if (inCartQty >= availableStock) {
      showToast('库存不足');
      return;
    }
    if(found){
      found.quantity = (Number(found.quantity) || 0) + 1;
    }else{
      cart.push({
        key,
        productId: item.id,
        title: item.title || '商品',
        desc: item.desc || '',
        image: item.image || item.imageUrl || '',
        spec: defaultSpec,
        unitPrice: parseMoney(item.price),
        quantity: 1,
        sellerId: item.sellerId || state.currentProfileUser?.id || ''
      });
    }
  }else if(found){
    found.quantity = Math.max(0, (Number(found.quantity) || 0) - 1);
    if(found.quantity <= 0){
      const idx = cart.indexOf(found);
      if(idx >= 0) cart.splice(idx, 1);
    }
  }
  updateProfileCartBar();
  renderProfileStore();
}

function renderProfileStore(){
  const list = $("profileStoreList");
  const title = $("profileStoreTitle");
  const moreBtn = $("profileStoreMoreBtn");
  if(!list) return;
  const sig = (state.profileStoreItems||[]).map(i => i.id+'|'+(i.listed?'1':'0')+'|'+i.stock+'|'+(i.createdAt||0)).join(';') + '|' + state.profileStoreCategoryFilter + '|' + (state.profileStoreExpanded?'1':'0');
  if (!sigChanged('profileStore', sig)) return;
  const sortedItems = (state.profileStoreItems || []).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  // Pre-parse categories once for reuse in tabs + filtering
  const parsedCats = new Map();
  for (const item of sortedItems) {
    if (item.category) parsedCats.set(item, item.category.split(CATEGORY_SPLIT_RE).map(s => s.trim()).filter(Boolean));
  }
  // Build category tabs
  const catTabsEl = $("profileStoreCategoryTabs");
  if (catTabsEl) {
    const cats = new Set();
    for (const arr of parsedCats.values()) arr.forEach(c => cats.add(c));
    catTabsEl.replaceChildren();
    if (cats.size > 0) {
      if (!catTabsEl.dataset.delegated) {
        catTabsEl.dataset.delegated = '1';
        catTabsEl.addEventListener('click', (e) => {
          const tab = e.target.closest('.profile-store-cat-tab');
          if (!tab) return;
          state.profileStoreCategoryFilter = tab.dataset.cat || '';
          renderProfileStore();
        });
      }
      const allTab = createEl('button', 'profile-store-cat-tab' + (!state.profileStoreCategoryFilter ? ' active' : ''), '全部');
      allTab.type = 'button';
      allTab.dataset.cat = '';
      catTabsEl.appendChild(allTab);
      cats.forEach(cat => {
        const tab = createEl('button', 'profile-store-cat-tab' + (state.profileStoreCategoryFilter === cat ? ' active' : ''), cat);
        tab.type = 'button';
        tab.dataset.cat = cat;
        catTabsEl.appendChild(tab);
      });
    }
  }
  // Filter by category
  const allItems = state.profileStoreCategoryFilter
    ? sortedItems.filter(item => { const arr = parsedCats.get(item); return arr && arr.includes(state.profileStoreCategoryFilter); })
    : sortedItems;
  if(title) title.textContent = `在售商品 ${allItems.length}`;
  if(!allItems.length){
    showEmptyState(list, '暂无在售商品');
    if(moreBtn) moreBtn.classList.add('hidden');
    updateProfileCartBar();
    return;
  }
  const previewLimit = 6;
  const items = state.profileStoreExpanded ? allItems : allItems.slice(0, previewLimit);
  if (moreBtn) {
    if (allItems.length > previewLimit) {
      moreBtn.classList.remove('hidden');
      moreBtn.textContent = state.profileStoreExpanded ? '收起' : '查看全部在售';
    } else {
      moreBtn.classList.add('hidden');
    }
  }
  const frag = document.createDocumentFragment();
  items.forEach(item => {
    const card = createEl('div', 'profile-store-item');
    card.addEventListener('click', () => openProductDetail(item, false));

    const img = createEl('img', '');
    img.src = normalizeMediaUrl(item.image || item.imageUrl) || '';
    img.alt = item.title || '商品';

    const info = createEl('div', 'profile-store-info');
    const categoryText = item.category ? `【${item.category}】` : '';
    info.append(
      createEl('div', 'profile-store-title', item.title || '未命名商品'),
      createEl('div', 'profile-store-desc', `${categoryText}${item.desc || '商品详情页包含图片、文字与价格'}`),
      createEl('div', 'profile-store-price', formatMoney(item.price)),
      createEl('div', 'profile-store-desc', `库存：${getItemAvailableStock(item)}`)
    );

    const side = createEl('div', 'profile-store-side');
    const hasMultiSpecs = Array.isArray(item.specs) && item.specs.length > 1;
    const qty = getProfileStoreItemCartQuantity(item);
    if(hasMultiSpecs){
      const btn = createEl('button', 'secondary-btn', qty > 0 ? `选规格 (${qty})` : '选规格');
      btn.type = 'button';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openProductSpecSheet(item);
      });
      side.appendChild(btn);
    }else{
      const stepper = createEl('div', 'profile-qty-stepper');
      const minus = createEl('button', 'qty-btn', '−');
      minus.type = 'button';
      minus.disabled = qty <= 0;
      minus.addEventListener('click', (e) => {
        e.stopPropagation();
        adjustProfileStoreItemQuantity(item, -1);
      });
      const qtyText = createEl('span', 'qty-num', String(qty));
      const plus = createEl('button', 'qty-btn primary', '+');
      plus.type = 'button';
      plus.addEventListener('click', (e) => {
        e.stopPropagation();
        adjustProfileStoreItemQuantity(item, 1);
      });
      stepper.append(minus, qtyText, plus);
      side.appendChild(stepper);
    }

    card.append(img, info, side);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
  updateProfileCartBar();
}

function openProductSpecSheet(item, mode = 'cart'){
  if(!item) return;
  state.selectedProfileProduct = item;
  state.specSheetQty = 1;
  state.specSheetMode = mode;
  const specs = Array.isArray(item.specs) && item.specs.length ? item.specs : ['默认规格'];
  state.selectedProfileSpec = specs[0];
  if($("specSheetImage")) $("specSheetImage").src = normalizeMediaUrl(item.image || item.imageUrl) || '';
  setText("specSheetTitle", item.title || '商品');
  setText("specSheetDesc", item.desc || '商品详情页包含图片、文字与价格');
  setText("specSheetPrice", formatMoney(item.price));
  const list = $("specOptionsList");
  if(list){
    const frag = document.createDocumentFragment();
    specs.forEach(spec => {
      const chip = createEl('button', 'spec-option-chip' + (spec === state.selectedProfileSpec ? ' active' : ''), spec);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        state.selectedProfileSpec = spec;
        list.querySelectorAll('.spec-option-chip').forEach(el => el.classList.toggle('active', el.textContent === spec));
      });
      frag.appendChild(chip);
    });
    list.replaceChildren(frag);
  }
  // Reset quantity UI
  setText("specSheetQtyNum", '1');
  if($("specSheetQtyMinus")) $("specSheetQtyMinus").disabled = true;
  // Toggle cart vs buy-now buttons
  toggleEl("confirmAddToCartBtn", 'hidden', mode === 'buyNow');
  toggleEl("confirmBuyNowBtn", 'hidden', mode !== 'buyNow');
  showEl("productSpecSheet");
}

function closeProductSpecSheet(){
  hideEl("productSpecSheet");
}

function addSelectedProductToCart(){
  const item = state.selectedProfileProduct;
  if(!item) return;
  const spec = state.selectedProfileSpec || '默认规格';
  const addQty = Math.max(1, state.specSheetQty || 1);
  const key = `${item.id}__${spec}`;
  const sellerId = item.sellerId || state.currentProfileUser?.id || '';
  if(sellerId === state.currentUser?.id){ showToast('不能购买自己的商品'); return; }
  const cart = getCurrentSellerCart(sellerId);
  const found = cart.find(i => i.key === key);
  const inCartQty = getProfileStoreItemCartQuantity(item);
  const availableStock = getItemAvailableStock(item);
  if (inCartQty + addQty > availableStock) {
    showToast('库存不足');
    return;
  }
  if(found){
    found.quantity = (Number(found.quantity) || 0) + addQty;
  }else{
    cart.push({
      key,
      productId: item.id,
      title: item.title || '商品',
      desc: item.desc || '',
      image: item.image || item.imageUrl || '',
      spec,
      unitPrice: parseMoney(item.price),
      quantity: addQty,
      sellerId
    });
  }
  closeProductSpecSheet();
  updateProfileCartBar();
  renderProfileStore();
  showToast(`已加入购物车 x${addQty}`);
}

function buyNowAndCheckout(){
  const item = state.selectedProfileProduct;
  if(!item) return;
  const spec = state.selectedProfileSpec || '默认规格';
  const addQty = Math.max(1, state.specSheetQty || 1);
  const sellerId = item.sellerId || state.currentProfileUser?.id || '';
  if(!sellerId) return showToast('无法确定卖家');
  if(sellerId === state.currentUser?.id) return showToast('不能购买自己的商品');
  const availableStock = getItemAvailableStock(item);
  if(addQty > availableStock){ showToast('库存不足'); return; }
  // Add to cart then navigate to checkout
  const key = `${item.id}__${spec}`;
  const cart = getCurrentSellerCart(sellerId);
  const found = cart.find(i => i.key === key);
  if(found){
    found.quantity = (Number(found.quantity) || 0) + addQty;
  }else{
    cart.push({
      key, productId: item.id, title: item.title || '商品', desc: item.desc || '',
      image: item.image || item.imageUrl || '', spec, unitPrice: parseMoney(item.price),
      quantity: addQty, sellerId
    });
  }
  closeProductSpecSheet();
  updateProfileCartBar();
  state.currentCartSellerId = sellerId;
  renderProfileCartPage();
  window.openSecondaryPage('profileCartPage', state.activeConversation ? 'chat' : 'home');
}

function getProfileCartTotal(){
  const cart = getCurrentSellerCart();
  return cart.reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0), 0);
}

function updateProfileCartBar(){
  saveCartToStorage();
  const bar = $("profileCartBar");
  const countEl = $("profileCartCount");
  const totalEl = $("profileCartTotal");
  const currentCart = getCurrentSellerCart();
  const { count, total: cartTotal } = sumCartTotals(currentCart);
  if(countEl) countEl.textContent = `${count} 件商品`;
  if(totalEl) totalEl.textContent = formatMoney(cartTotal);
  if(bar) bar.classList.toggle('hidden', count <= 0);
  updateMyCartBadge();
}
function updateMyCartBadge(){
  const badge = $("myCartBadge");
  if(!badge) return;
  const totalCount = getGroupedCartCount();
  if(totalCount > 0){ badge.textContent = totalCount > 99 ? '99+' : String(totalCount); badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); }
}

function renderProfileCartPage(){
  const list = $("profileCartList");
  if(!list) return;
  const sellerId = state.currentCartSellerId || state.currentProfileUser?.id || '';
  const currentCart = getCurrentSellerCart(sellerId);

  // Seller info header
  const sellerInfo = $("profileCartSellerInfo");
  if(sellerInfo){
    const profile = sellerId === state.currentProfileUser?.id ? state.currentProfileUser : null;
    let _sName = '';
    if (!profile && state.ordersById) { for (const o of state.ordersById.values()) { if (o.sellerId === sellerId && o.sellerName) { _sName = o.sellerName; break; } } }
    const sellerName = profile?.displayName || profile?.nickname || _sName || `商家 ${sellerId.slice(-6)}`;
    sellerInfo.textContent = sellerName;
    sellerInfo.classList.toggle('hidden', !sellerId);
  }

  if(!currentCart.length){
    showEmptyState(list, '购物车为空');
    setText("profileCartSummaryText", '0 件商品');
    setText("profileCartPageTotal", formatMoney(0));
    return;
  }

  const updateTotals = () => {
    const count = currentCart.reduce((s, i) => s + (Number(i.quantity)||0), 0);
    setText("profileCartSummaryText", `${count} 件商品`);
    setText("profileCartPageTotal", formatMoney(getProfileCartTotal()));
  };

  const frag = document.createDocumentFragment();
  currentCart.forEach((item) => {
    const card = createEl('div', 'order-cart-item checkout-item');

    // Product image + info row
    const row = createEl('div', 'checkout-item-row');
    const imgUrl = normalizeMediaUrl(item.image || '');
    if(imgUrl){
      const img = createEl('img', 'checkout-item-img');
      img.src = imgUrl;
      img.alt = item.title || '';
      row.appendChild(img);
    }
    const info = createEl('div', 'checkout-item-info');
    info.append(createEl('div', 'order-cart-title', item.title || '商品'), createEl('div', 'order-cart-sub', item.spec || '默认规格'));
    row.appendChild(info);
    card.appendChild(row);

    // Price + quantity + remove row
    const line = createEl('div', 'checkout-item-bottom');
    const priceWrap = createEl('div', 'checkout-price-wrap');
    const priceLabel = createEl('span', 'checkout-price checkout-price-editable', formatMoney(Number(item.unitPrice || 0)));
    priceLabel.title = '点击修改价格';
    const editPrice = () => {
      showPrompt('请输入新的单价', String(item.unitPrice || 0), (raw) => {
        const newPrice = Math.max(0, Number(String(raw).replace(/[^\d.]/g, '')) || 0);
        item.unitPrice = newPrice;
        priceLabel.textContent = formatMoney(newPrice);
        updateTotals();
        saveCartToStorage();
      });
    };
    priceLabel.addEventListener('click', editPrice);
    const priceEditBtn = createEl('button', 'checkout-price-edit-btn', '改价');
    priceEditBtn.type = 'button';
    priceEditBtn.addEventListener('click', editPrice);
    priceWrap.append(priceLabel, priceEditBtn);

    // Quantity controls
    const qtyWrap = createEl('div', 'checkout-qty-wrap');
    const minusBtn = createEl('button', 'checkout-qty-btn', '\u2212');
    minusBtn.type = 'button';
    const qtySpan = createEl('span', 'checkout-qty-val', String(item.quantity || 1));
    const plusBtn = createEl('button', 'checkout-qty-btn', '+');
    plusBtn.type = 'button';

    minusBtn.addEventListener('click', () => {
      const q = Math.max(0, (Number(item.quantity)||1) - 1);
      if(q === 0){
        const i = currentCart.indexOf(item);
        if(i >= 0) currentCart.splice(i, 1);
        renderProfileCartPage();
        updateProfileCartBar();
        return;
      }
      item.quantity = q;
      qtySpan.textContent = String(q);
      updateProfileCartBar();
      updateTotals();
    });
    plusBtn.addEventListener('click', () => {
      item.quantity = (Number(item.quantity)||1) + 1;
      qtySpan.textContent = String(item.quantity);
      updateProfileCartBar();
      updateTotals();
    });
    qtyWrap.append(minusBtn, qtySpan, plusBtn);

    const removeBtn = createEl('button', 'checkout-remove-btn', '删除');
    removeBtn.type = 'button';
    removeBtn.addEventListener('click', () => {
      const i = currentCart.indexOf(item);
      if(i >= 0) currentCart.splice(i, 1);
      renderProfileCartPage();
      updateProfileCartBar();
    });

    line.append(priceWrap, qtyWrap, removeBtn);
    card.appendChild(line);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
  updateTotals();
}


function renderCartHubPage(){
  const list = $("cartHubList");
  if(!list) return;
  const groups = Object.entries(state.profileCartBySeller || {}).filter(([,arr]) => Array.isArray(arr) && arr.length);
  const sig = groups.map(([sid, arr]) => sid + ':' + arr.map(i => i.productId + ',' + (i.quantity||0)).join('|')).join(';');
  if (!sigChanged('cartHub', sig)) return;
  if(!groups.length){
    showEmptyState(list, '暂无待结算商品');
    return;
  }
  // Build sellerName cache from orders for O(1) lookup
  const _sellerNameCache = new Map();
  for (const o of (state.sellerOrders || [])) if (o.sellerId && o.sellerName) _sellerNameCache.set(o.sellerId, o.sellerName);
  for (const o of (state.buyerOrders || [])) if (o.sellerId && o.sellerName && !_sellerNameCache.has(o.sellerId)) _sellerNameCache.set(o.sellerId, o.sellerName);
  const frag = document.createDocumentFragment();
  groups.forEach(([sellerId, arr]) => {
    const profile = sellerId === state.currentProfileUser?.id ? state.currentProfileUser : null;
    const knownSeller = _sellerNameCache.get(sellerId);
    const title = profile?.displayName || profile?.nickname || knownSeller || `商家 ${sellerId.slice(-6)}`;
    const { count, total } = sumCartTotals(arr);
    const card = createEl('div', 'cart-hub-card');
    const head = createEl('div', 'cart-hub-title', title);
    const sub = createEl('div', 'cart-hub-sub', `${count} 件商品 · ${formatMoney(total)}`);
    const line = createEl('div', 'cart-hub-line');
    const goBtn = createEl('button', 'primary-btn', '去结算');
    goBtn.type = 'button';
    goBtn.addEventListener('click', () => {
      state.currentCartSellerId = sellerId;
      renderProfileCartPage();
      window.openSecondaryPage('profileCartPage', 'cartHubPage');
    });
    line.appendChild(createEl('span', ''));
    line.appendChild(goBtn);
    card.append(head, sub, line);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

async function submitProfileOrder(){
  const sellerId = state.currentCartSellerId || state.currentProfileUser?.id || '';
  const currentCart = getCurrentSellerCart(sellerId);
  if(!sellerId || !currentCart.length) return showModal('请先选择商品');
  showLoading('提交订单中...');
  try{
    const remark = ($("orderRemarkInput")?.value || '').trim();
    const payload = {
      sellerId,
      remark: remark || undefined,
      items: currentCart.map(item => ({
        productId: item.productId,
        title: item.title,
        spec: item.spec,
        quantity: item.quantity,
        price: Number(item.unitPrice || 0)
      }))
    };
    await api('/api/orders', { method:'POST', body: JSON.stringify(payload) });
    if($("orderRemarkInput")) $("orderRemarkInput").value = '';
    state.profileCartBySeller[sellerId] = [];
    updateProfileCartBar();
    renderProfileCartPage();
    await Promise.all([
      loadBuyerOrders(),
      state.currentProfileUser?.id ? loadProfileOrders() : Promise.resolve(),
    ]);
    if(state.activeConversation?.id) await reloadActiveConversationMessages();
    hideLoading();
    showToast('订单已提交');
    const backTo = state.secondaryReturn || (state.activeConversation ? 'chat' : 'home');
    window.openSecondaryPage('buyerOrdersManagePage', backTo);
  }catch(e){
    hideLoading();
    showModal(e.message || '提交订单失败');
  }
}

const loadProfileOrders = singleFlight(async function _loadProfileOrdersImpl(){
  const profileUserId = state.currentProfileUser?.id;
  if(!profileUserId || !state.currentUser) return;
  try{
    const data = await api(`/api/orders?sellerId=${profileUserId}`);
    state.profileOrders = data.orders || [];
  }catch(_){
    state.profileOrders = [];
  }
  renderProfileOrders();
});



async function loadAdminDashboard(){
  try{
    const data = await api('/api/admin/dashboard');
    state.adminDashboard = data;
  }catch(_){
    state.adminDashboard = {
      stats: { users: 0, products: 0, orders: 0, broadcasts: 0, blacklistLinks: 0 },
      recentOrders: [], topSellers: [], userList: [], productList: [], reportList: []
    };
  }
  renderAdminCenter();
  renderAdminOrders();
  renderAdminUsers();
  renderAdminProducts();
  renderAdminReports();
}

function renderAdminCenter(){
  const grid = $("adminDashboardGrid");
  if(!grid) return;
  const stats = state.adminDashboard?.stats || {};
  const sig = (stats.users||0)+','+(stats.products||0)+','+(stats.orders||0)+','+(stats.broadcasts||0)+','+(stats.blacklistLinks||0)+','+(stats.pendingOrders||0);
  if (!sigChanged('adminCenter', sig)) return;
  const items = [
    ['用户总数', stats.users || 0],
    ['商品总数', stats.products || 0],
    ['订单总数', stats.orders || 0],
    ['广播总数', stats.broadcasts || 0],
    ['黑名单关系', stats.blacklistLinks || 0],
    ['待完成订单', stats.pendingOrders || 0],
  ];
  const frag = document.createDocumentFragment();
  items.forEach(([label, value]) => {
    const card = createEl('div', 'admin-stat-card');
    card.append(createEl('div', 'admin-stat-label', label), createEl('div', 'admin-stat-value', String(value)));
    frag.appendChild(card);
  });
  grid.replaceChildren(frag);
}

function renderAdminList(listId, sigKey, dataKey, sigFn, emptyMsg, buildCardFn) {
  const list = $(listId);
  if(!list) return;
  const rows = state.adminDashboard?.[dataKey] || [];
  const sig = rows.map(sigFn).join(';');
  if (!sigChanged(sigKey, sig)) return;
  if(!rows.length){ showEmptyState(list, emptyMsg); return; }
  const frag = document.createDocumentFragment();
  rows.forEach(item => frag.appendChild(buildCardFn(item)));
  list.replaceChildren(frag);
}

function addAdminTag(card, text, warn) {
  const line = createEl('div', 'admin-list-line');
  line.appendChild(createEl('span', 'admin-tag' + (warn ? ' warn' : ''), text));
  card.appendChild(line);
  return card;
}

function renderAdminOrders() {
  renderAdminList('adminOrdersList', 'adminOrders', 'recentOrders', o => o.id+'|'+o.status, '暂无平台订单', (order) => {
    const card = buildProfileCard(`订单 #${formatOrderId(order.id)} · ${formatMoney(order.total || 0)}`, `${order.buyerName || '买家'} → ${order.sellerName || '卖家'} · ${order.summary || '订单内容'}`);
    return addAdminTag(card, order.status === 'completed' ? '已完成' : '处理中', order.status !== 'completed');
  });
}
function renderAdminUsers() {
  renderAdminList('adminUsersList', 'adminUsers', 'userList', u => u.id+'|'+(u.productCount||0)+'|'+(u.blacklistCount||0), '暂无用户数据', (user) => {
    const card = buildProfileCard(user.displayName || user.username || '用户', `商品 ${user.productCount || 0} · 卖家订单 ${user.sellerOrderCount || 0}`);
    return addAdminTag(card, (user.blacklistCount || 0) ? `黑名单 ${user.blacklistCount}` : '正常', !!(user.blacklistCount || 0));
  });
}
function renderAdminProducts() {
  renderAdminList('adminProductsList', 'adminProducts', 'productList', p => p.id+'|'+p.price, '暂无商品数据',
    item => buildProfileCard(item.title || '商品', `${item.sellerName || '卖家'} · ${formatMoney(item.price || 0)}`)
  );
}
function renderAdminReports() {
  renderAdminList('adminReportsList', 'adminReports', 'reportList', r => r.title, '暂无举报与风控提醒',
    row => buildProfileCard(row.title || '风险提醒', row.summary || '')
  );
}

function openBroadcastDetail(title, summary){
  setText("broadcastDetailTitle", title || '广播详情');
  setText("broadcastDetailSummary", summary || '');
  window.openSecondaryPage('broadcastDetailPage', state.secondaryReturn || 'home');
}

function renderProfileOrders(){
  const list = $("profileOrdersList");
  if(!list) return;
  const sig = state.profileOrders.map(o => o.id + '|' + o.status + '|' + (o.total||0)).join(';');
  if (!sigChanged('profileOrders', sig)) return;
  if(!state.profileOrders.length){
    showEmptyState(list, '暂无订单');
    return;
  }
  const frag = document.createDocumentFragment();
  state.profileOrders.forEach(order => {
    const names = (order.items || []).map(i => `${i.title}(${i.spec || '默认'}) x${i.quantity || 1}`).join('，');
    const card = buildProfileCard(`订单 #${formatOrderId(order.id) || '-'} · ${formatMoney(order.total)}`, names || '订单内容');
    const status = createEl('div', 'profile-order-status' + (order.status === 'completed' ? ' done' : ''));
    status.textContent = formatOrderStatusLabel(order.status);

    const actions = createEl('div', 'profile-order-actions');
    const canManage = state.currentUser?.id && state.currentUser.id === order.sellerId;

    if (canManage) {
      if(order.status === 'pending'){
        actions.appendChild(createStopBtn('secondary-btn', '修改价格', () => {
          if(!order.id) return;
          showPrompt('请输入新的总价', String(order.total || ''), async (raw) => {
            try{ await doUpdateOrderPrice(order.id, raw); }catch(e){ showModal(e.message || '修改失败'); }
          });
        }));
        actions.appendChild(createStopBtn('primary-btn', '接单', (e, btn) => {
          if(!order.id) return;
          withButtonLock(btn, () => doAcceptOrder(order.id), '接单中...');
        }));
      }
      if(order.status === 'accepted'){
        actions.appendChild(createStopBtn('primary-btn', '标记已完成', (e, btn) => {
          if(!order.id) return;
          withButtonLock(btn, () => doCompleteOrder(order.id), '处理中...');
        }));
      }
    }

    // Buyer can confirm receipt on accepted orders
    const isBuyerUser = state.currentUser?.id && state.currentUser.id === order.buyerId;
    if(isBuyerUser && order.status === 'accepted'){
      actions.appendChild(createStopBtn('primary-btn', '确认收货', () => {
        if(!order.id) return;
        showConfirm('确认已收到商品？订单将标记为已完成。', async () => {
          try{ await doCompleteOrder(order.id); }catch(e){ showModal(e.message || '确认失败'); }
        });
      }));
    }

    card.appendChild(status);
    if (actions.childElementCount) card.appendChild(actions);
    const detailRole = (state.currentUser?.id && state.currentUser.id === order.buyerId) ? 'buyer' : 'seller';
    card.addEventListener('click', () => openOrderDetail(order, detailRole));
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function showProfileActionSheet(){ showEl("profileActionSheet"); }
function hideProfileActionSheet(){ hideEl("profileActionSheet"); }

async function sendFriendRequestToCurrentProfile(){
  const p = state.currentProfileUser;
  if(!p || !state.currentUser) return;
  if(p.isFriend || isFriendUser(p.id)) return showModal('对方已经是你的好友');
  const keyword = String(p.username || p.appNumberId || '').trim();
  if(!keyword) return showModal('暂时无法添加该用户');
  try{
    await api('/api/friends/request', { method:'POST', body: JSON.stringify({ userId: state.currentUser.id, friendUsername: keyword, greeting: `你好，我是${state.currentUser.displayName}` }) });
    showModal('好友请求已发送');
  }catch(e){
    showModal(e.message || '发送失败');
  }
}

function applyChatRelationshipState(){
  if(!$("chatSubtitle")) return;
  const peerId = conversationPeerId(state.activeConversation);
  if(!peerId) { $("chatSubtitle").textContent = ''; return; }
  const convFriendState = state.activeConversation?.peerIsFriend === true
    || state.conversationsById?.get(state.activeConversation?.id)?.peerIsFriend === true;
  $("chatSubtitle").textContent = (convFriendState || isFriendUser(peerId)) ? '' : '对方还不是你的好友';
}


function ensureDirectConversationForTrade() {
  if (!state.activeConversation || state.activeConversation.type !== 'direct') {
    showModal('该功能仅支持单聊场景');
    return null;
  }
  const peerId = conversationPeerId(state.activeConversation);
  if (!peerId) {
    showModal('未找到会话对象');
    return null;
  }
  return peerId;
}

function showTradePicker(title, items, renderLine, emptyText) {
  const sheet = $("tradePickerSheet");
  const list = $("tradePickerList");
  const titleEl = $("tradePickerTitle");
  if (!sheet || !list || !titleEl) return Promise.resolve(null);
  titleEl.textContent = title;
  list.replaceChildren();
  if (!Array.isArray(items) || !items.length) {
    showEmptyState(list, emptyText || '暂无可选项');
  } else {
    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const btn = createEl('button', 'profile-order-card');
      btn.type = 'button';
      btn.appendChild(createEl('div', 'profile-order-title', `${idx + 1}. ${renderLine(item)}`));
      btn.addEventListener('click', () => close(item));
      frag.appendChild(btn);
    });
    list.appendChild(frag);
  }
  sheet.classList.remove('hidden');
  const closeBtn = $("tradePickerCloseBtn");
  let resolve;
  const p = new Promise((r) => { resolve = r; });
  function close(val = null) {
    sheet.classList.add('hidden');
    state.tradePickerResolver = null;
    resolve(val);
  }
  state.tradePickerResolver = close;
  closeBtn.onclick = () => close(null);
  return p;
}

async function sendContactCardInChat(){
  const peerId = ensureDirectConversationForTrade();
  if(!peerId) return;
  await loadFriends(true);
  state._ccpSelectedFriend = null;
  if ($("ccpSearchInput")) $("ccpSearchInput").value = '';
  hideEl("ccpConfirmBar");
  renderContactCardPicker();
  window.openSecondaryPage('contactCardPickerPage', 'chat');
  if ($("chatTitle")) $("chatTitle").textContent = '选择名片';
}

async function sendProductCardInChat(){
  const peerId = ensureDirectConversationForTrade();
  if(!peerId) return;
  await renderProductCardPicker();
  window.openSecondaryPage('productCardPickerPage', 'chat');
}

function getOrdersBetweenUsers(peerId){
  const uid = state.currentUser?.id;
  const results = [];
  for (const o of state.ordersById.values()) {
    if ((o.buyerId === uid && o.sellerId === peerId) || (o.sellerId === uid && o.buyerId === peerId)) {
      results.push(o);
    }
  }
  return results;
}

async function sendOrderCardInChat(){
  const peerId = ensureDirectConversationForTrade();
  if(!peerId) return;
  state.orderPickerTab = 'bought';
  await renderOrderCardPicker('bought');
  window.openSecondaryPage('orderCardPickerPage', 'chat');
}

function extractContactCardUserId(card = {}){
  if (!card || typeof card !== 'object') return '';
  const directId = String(card.userId || card.uid || card.id || card.targetUserId || '').trim();
  if (directId && directId !== 'null' && directId !== 'undefined') return directId;

  const appIdRaw = String(card.appNumberId || card.appId || '').trim();
  const desc = String(card.description || '').trim();
  const meta = String(card.meta || '').trim();
  const fromText = [appIdRaw, desc, meta].join(' ');
  const appMatch = fromText.match(/CT\d{5,}/i);
  const appId = appMatch ? appMatch[0].toUpperCase() : '';

  const friends = (state.friends || []).map((item) => item.friend).filter(Boolean);
  if (appId) {
    const friend = friends.find((f) => String(f.appNumberId || '').toUpperCase() === appId);
    if (friend?.id) return friend.id;
  }

  const title = String(card.title || '').trim();
  if (title) {
    const friend = friends.find((f) => {
      const names = [f.remark, f.displayName, f.username].map((v) => String(v || '').trim()).filter(Boolean);
      return names.includes(title);
    });
    if (friend?.id) return friend.id;
  }
  return '';
}

function isContactCardPayload(card = {}){
  const rawType = String(card.cardType || card.type || card.kind || '').trim().toLowerCase();
  return rawType === '名片' || rawType === 'contact' || rawType === 'contact_card';
}

function renderContactCardPicker(keyword){
  const list = $("contactCardPickerList");
  if(!list) return;
  const search = (keyword ?? ($("ccpSearchInput")?.value || '')).trim().toLowerCase();
  const allFriends = state.friends || [];

  // Group friends
  const grouped = new Map();
  const customGroups = getCustomGroups();
  customGroups.forEach(g => grouped.set(g, []));
  allFriends.forEach(item => {
    const f = item.friend;
    if (!f) return;
    if (search && !(f.displayName || '').toLowerCase().includes(search) && !(f.remark || '').toLowerCase().includes(search) && !(f.username || '').toLowerCase().includes(search)) return;
    const groupName = item.group || DEFAULT_GROUP;
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName).push(f);
  });

  // Count total visible
  let totalVisible = 0;
  grouped.forEach(members => { totalVisible += members.length; });
  if (totalVisible === 0) {
    showEmptyState(list, search ? '未找到匹配的好友' : '通讯录暂无好友可发送', 'ccp-empty');
    return;
  }

  const frag = document.createDocumentFragment();
  grouped.forEach((members, groupName) => {
    if (!members.length) return;
    const section = createEl('div');
    section.dataset.groupName = groupName;

    const header = createEl('div', 'qq-group-header expanded', groupName + ' ');
    header.dataset.role = 'friend-group-header';
    const count = createEl('span', 'friend-group-count', String(members.length));
    header.appendChild(count);
    header.addEventListener('click', () => window.toggleQQGroup(header));

    const content = createEl('div', 'qq-group-content expanded');
    content.dataset.role = 'friend-group-content';

    members.forEach(f => {
      const row = createEl('button', 'ccp-friend-row');
      row.type = 'button';
      row.dataset.friendId = f.id;
      row.appendChild(createAvatarNode(f, f.displayName || f.username || '友'));
      const info = createEl('div', 'ccp-friend-info');
      info.append(createEl('div', 'ccp-friend-name', f.remark || f.displayName || f.username || '好友'), createEl('div', 'ccp-friend-id', 'ID: ' + (f.appNumberId || f.username || '-')));
      row.appendChild(info);
      const check = createEl('div', 'ccp-check');
      row.appendChild(check);

      row.addEventListener('click', () => {
        // Deselect previous
        list.querySelectorAll('.ccp-friend-row.selected').forEach(el => {
          el.classList.remove('selected');
          const c = el.querySelector('.ccp-check');
          if (c) c.textContent = '';
        });
        // Select this one
        row.classList.add('selected');
        check.textContent = '✓';
        state._ccpSelectedFriend = f;
        // Update confirm bar
        showEl("ccpConfirmBar");
        if ($("ccpSelectedName")) $("ccpSelectedName").textContent = f.remark || f.displayName || f.username || '好友';
        const avatarWrap = $("ccpSelectedAvatar");
        if (avatarWrap) { avatarWrap.replaceChildren(); avatarWrap.appendChild(createAvatarNode(f, f.displayName || f.username || '友')); }
      });

      content.appendChild(row);
    });

    section.append(header, content);
    frag.appendChild(section);
  });

  list.replaceChildren(frag);
}

async function renderProductCardPicker(){
  const list = $("productCardPickerList");
  if(!list) return;
  const products = Array.isArray(state.currentUser?.products) ? state.currentUser.products.filter(Boolean) : [];
  if(!products.length){
    showEmptyState(list, '暂无可发送商品，请先发布');
    return;
  }
  const frag = document.createDocumentFragment();
  products.forEach((p) => {
    const card = createEl('button', 'picker-product-card');
    card.type = 'button';
    const imgUrl = normalizeMediaUrl(p.image || p.imageUrl) || '';
    const img = createEl('img', 'picker-product-img');
    img.src = imgUrl;
    img.alt = '';
    const info = createEl('div', 'picker-product-info');
    info.append(createEl('div', 'picker-product-name', p.title || '商品'), createEl('div', 'picker-product-price', formatMoney(p.price)));
    card.append(img, info);
    card.addEventListener('click', async () => {
      await window.sendMessage({ type:'card', card:{ cardType:'闲置商品', title: p.title || '商品', description: `售价：${formatMoney(p.price)}`, meta: String(p.price || 0), imageUrl: p.image || p.imageUrl || '', sellerId: p.sellerId || state.currentUser?.id || '', productId: p.id || '' } });
      if($("backBtn")) $("backBtn").click();
    });
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

async function renderOrderCardPicker(filterTab){
  const list = $("orderCardPickerList");
  if(!list) return;
  const peerId = ensureDirectConversationForTrade();
  if(!peerId) return;
  await Promise.all([loadBuyerOrders(), loadSellerOrders()]);
  const allOrders = getOrdersBetweenUsers(peerId);
  const tab = filterTab || state.orderPickerTab || 'bought';
  state.orderPickerTab = tab;
  // Update tab active states
  const tabBar = $("orderPickerTabs");
  if(tabBar){
    tabBar.querySelectorAll('.picker-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
  }
  const orders = allOrders.filter(o => {
    if(tab === 'bought') return o.buyerId === state.currentUser?.id;
    return o.sellerId === state.currentUser?.id;
  });
  if(!orders.length){
    showEmptyState(list, tab === 'bought' ? '暂无从对方购买的订单' : '暂无卖给对方的订单');
    return;
  }
  const frag = document.createDocumentFragment();
  orders.forEach((o) => {
    const isBuyer = o.buyerId === state.currentUser?.id;
    const role = isBuyer ? 'buyer' : 'seller';
    const roleLabel = isBuyer ? '买家' : '卖家';
    const itemsSummary = (o.items||[]).map(i=>`${i.title}(${i.spec||'默认'})x${i.quantity||1}`).join('，') || '订单内容';
    const card = createEl('button', 'picker-order-card');
    card.type = 'button';
    const top = createEl('div', 'picker-order-top');
    top.append(createEl('span', 'picker-order-id', `#${formatOrderId(o.id)}`), createEl('span', `picker-order-role ${role}`, roleLabel));
    const bottom = createEl('div', 'picker-order-bottom');
    bottom.append(createEl('span', 'picker-order-total', formatMoney(o.total)), createEl('span', 'picker-order-status', formatOrderStatusLabel(o.status)));
    card.append(top, createEl('div', 'picker-order-items', itemsSummary), bottom);
    card.addEventListener('click', async () => {
      await window.sendMessage({ type:'order_card', order:{ id:o.id, buyerId:o.buyerId, sellerId:o.sellerId, title:`订单 #${formatOrderId(o.id)}`, summary:itemsSummary, total:o.total, status:o.status, imageUrl:(o.items||[]).find(i=>i && i.imageUrl)?.imageUrl || '', pendingPrice:o.pendingPrice||null, pendingPriceRequestedBy:o.pendingPriceRequestedBy||null, priceAdjustmentLocked:!!o.priceAdjustmentLocked, role } });
      if($("backBtn")) $("backBtn").click();
    });
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

async function sendPaymentCodeInChat(){
  const peerId = ensureDirectConversationForTrade();
  if(!peerId) return;
  const codes = state.currentUser?.paymentCodes || {};
  const options = [
    ['wechat', '微信收款码', codes.wechat],
    ['alipay', '支付宝收款码', codes.alipay],
    ['cloudpay', '云闪付收款码', codes.cloudpay],
  ].filter(([, , url]) => !!url);
  const picked = await showTradePicker(options.length ? '选择要发送的收款码' : '收款码列表', options, (o) => o[1], '你还没有配置收款码，请先到卖家中心设置');
  if(!picked) return;
  await window.sendMessage({ type:'card', card:{ cardType:'收款码', title:picked[1], description:'请核对金额后付款', meta:'仅用于当前订单沟通', imageUrl:picked[2] } });
}

const conversationPeerId = c => {
  if (!c || !c.members || !state.currentUser) return null;
  if (c._peerId !== undefined) return c._peerId;
  const uid = state.currentUser.id;
  c._peerId = c.members.length >= 2 ? ((c.members[0] === uid ? c.members[1] : c.members[0]) || null) : null;
  return c._peerId;
};

function normalizeCustomGroups(groups) {
  const ordered = [];
  const seen = new Set();
  const source = Array.isArray(groups) ? groups : [];
  source.forEach((name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  });
  if (!seen.has(DEFAULT_GROUP)) ordered.unshift(DEFAULT_GROUP);
  else {
    const idx = ordered.indexOf(DEFAULT_GROUP);
    if (idx > 0) { ordered.splice(idx, 1); ordered.unshift(DEFAULT_GROUP); }
  }
  return ordered.slice(0, 20);
}
function getCustomGroups() {
  return normalizeCustomGroups(state.currentUser?.customGroups || [DEFAULT_GROUP]);
}

function normalizeGroupNameInput(value) {
  return String(value || '').trim().slice(0, 20);
}

function syncSessionGroups(groups) {
  const normalized = normalizeCustomGroups(groups);
  state.currentUser.customGroups = normalized;
  writeSession(state.currentUser);
  return normalized;
}

// Media/time utilities moved to app_utils.js

function rebuildMessagesById() {
  state.messagesById = new Map();
  for (let i = 0; i < state.messages.length; i++) state.messagesById.set(state.messages[i].id, i);
  _messagesSig = '';
}
function findMessageIndex(msg) {
  if (!msg) return -1;
  const byId = state.messagesById.get(msg.id);
  if (byId !== undefined && byId < state.messages.length && state.messages[byId]?.id === msg.id) return byId;
  // Fallback: linear scan (handles index drift after splice)
  for (let i = 0; i < state.messages.length; i++) {
    if (state.messages[i].id === msg.id) { state.messagesById.set(msg.id, i); return i; }
  }
  if (msg.clientMessageId) {
    for (let i = 0; i < state.messages.length; i++) {
      const m = state.messages[i];
      if (m.clientMessageId && m.clientMessageId === msg.clientMessageId && m.senderId === msg.senderId) return i;
    }
  }
  return -1;
}
function upsertMessage(msg) {
  const idx = findMessageIndex(msg);
  if (idx >= 0) {
    state.messages[idx] = { ...state.messages[idx], ...msg };
    state.messagesById.set(msg.id, idx);
    return { action: 'replace', index: idx };
  }
  const ts = msg.createdAt || 0;
  let lo = 0, hi = state.messages.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if ((state.messages[mid].createdAt || 0) <= ts) lo = mid + 1; else hi = mid; }
  state.messages.splice(lo, 0, msg);
  // Incremental index update: shift entries after insertion point
  for (let i = lo + 1; i < state.messages.length; i++) state.messagesById.set(state.messages[i].id, i);
  state.messagesById.set(msg.id, lo);
  _messagesSig = '';
  // Only return 'append' if inserted at the end; otherwise 'insert' triggers full re-render
  return { action: lo === state.messages.length - 1 ? 'append' : 'insert', index: lo };
}
function buildMessageChunk(msg, prevCreatedAt = 0) {
  const fragment = document.createDocumentFragment();
  if ((msg.createdAt || 0) - prevCreatedAt > DELAYS.TIME_SEPARATOR_GAP) {
    const t = createEl('div', 'time-stamp');
    t.appendChild(createEl('span', null, formatTime(msg.createdAt)));
    fragment.appendChild(t);
  }

  const node = createEl('article', `message-row ${msg.senderId === state.currentUser?.id ? 'me' : ''}`);
  node.dataset.id = msg.id;
  if (msg.clientMessageId) node.dataset.clientMessageId = msg.clientMessageId;
  let userObj = state.currentUser; let finalName = '我';
  if (msg.senderId !== state.currentUser?.id) {
    const friend = findFriendEntry(msg.senderId);
    userObj = friend ? friend.friend : { displayName: '用户' };
    finalName = userObj.remark || userObj.displayName;
  }
  const isTemp = String(msg.id).startsWith('temp_');

  if (msg.type === 'system') {
    let txt = msg.text;
    if (txt === '你撤回了一条消息' && msg.senderId !== state.currentUser.id) txt = '对方撤回了一条消息';
    node.className = 'message-row system-msg';
    node.appendChild(createEl('div', 'bubble', txt || ''));
  } else {
    const avatarWrap = createEl('div', 'avatar-click-wrap');
    avatarWrap.appendChild(createAvatarNode(userObj, finalName));
    avatarWrap.addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.avatar')) return;
      e.stopPropagation();
      window.openUserProfile(msg.senderId, finalName);
    });
    node.appendChild(avatarWrap);

    const wrap = createEl('div', 'content-wrap');
    if (isTemp) wrap.style.opacity = '0.6';

    if (msg.type === 'audio') {
      const bubble = createEl('div', 'bubble audio-bubble');
      bubble.append(createEl('span', null, '🔊'), createEl('span', null, '语音'));
      bubble.addEventListener('click', (e) => { e.stopPropagation(); window.playAudio(msg.audioUrl, bubble); });
      wrap.appendChild(bubble);
    } else if (msg.type === 'image') {
      const bubble = createEl('div', 'bubble image-bubble');
      const safeImage = normalizeMediaUrl(msg.imageUrl);
      if (safeImage) {
        const img = createEl('img', 'chat-img-clickable');
        img.src = safeImage;
        img.style.cursor = 'zoom-in';
        img.style.pointerEvents = 'auto';
        img.addEventListener('click', (e) => { e.stopPropagation(); window.openImageViewer(safeImage); });
        bubble.appendChild(img);
      } else {
        bubble.textContent = '图片已失效';
      }
      wrap.appendChild(bubble);
    } else if (msg.type === 'card' && msg.card) {
      const c = msg.card;
      const card = createEl('div', 'trade-card');
      const isContactCard = isContactCardPayload(c);
      if (isContactCard) card.classList.add('contact-card-message');
      const safeImage = normalizeMediaUrl(c.imageUrl || '');
      if (isContactCard) {
        const head = createEl('div', 'contact-card-message-head');
        if (safeImage) {
          const avatar = createEl('img', 'contact-card-message-avatar');
          avatar.src = safeImage;
          head.appendChild(avatar);
        } else {
          head.appendChild(createEl('div', 'contact-card-message-avatar-fallback', firstChar(c.title || '友')));
        }
        const headMeta = createEl('div');
        headMeta.append(createEl('div', 'trade-card-title', c.title || '好友名片'), createEl('div', 'contact-card-label', c.meta || '个人名片'));
        head.appendChild(headMeta);
        card.appendChild(head);
      } else if (safeImage) {
        const img = createEl('img', 'trade-card-img');
        img.src = safeImage;
        card.appendChild(img);
      }
      if (!isContactCard) card.appendChild(createEl('div', 'trade-card-title', c.title || '闲置'));
      card.appendChild(createEl('div', 'trade-card-sub', c.description || ''));
      if (!isContactCard) card.appendChild(createEl('div', 'trade-card-price', c.meta || ''));
      const contactTargetUserId = isContactCard ? extractContactCardUserId(c) : '';
      if (isContactCard && contactTargetUserId) {
        card.classList.add('clickable-card');
        card.addEventListener('click', (e) => {
          e.stopPropagation();
          window.openUserProfile(contactTargetUserId, c.title || '用户');
        });
      } else if (!isContactCard) {
        card.classList.add('clickable-card');
        card.addEventListener('click', async (e) => {
          e.stopPropagation();
          const members = state.activeConversation?.members || [];
          const cardSellerId = c.sellerId || '';
          // Try to fetch real product from seller's store (or try both members for old cards)
          if (c.productId) {
            const candidateIds = cardSellerId ? [cardSellerId] : [msg.senderId, ...members.filter(m => m !== msg.senderId)].filter(Boolean);
            for (const candidateId of candidateIds) {
              try {
                const storeData = await api(`/api/users/${candidateId}/store`);
                const realProduct = (storeData.items || []).find(p => String(p.id) === String(c.productId));
                if (realProduct) {
                  openProductDetail({ ...realProduct, sellerId: candidateId }, false);
                  return;
                }
              } catch(_) {}
            }
          }
          // Fallback to card data
          const fallbackSellerId = cardSellerId || (msg.senderId !== state.currentUser?.id ? msg.senderId : members.find(m => m !== state.currentUser?.id) || '');
          const productItem = { title: c.title || '商品', desc: c.description || '', price: parseMoney(c.meta || '0'), image: c.imageUrl || '', specs: [], stock: 0, sellerId: fallbackSellerId };
          openProductDetail(productItem, false);
        });
      }
      wrap.appendChild(card);
    } else if (msg.type === 'order_card' && msg.order) {
      wrap.appendChild(buildOrderCardMessage(msg));
    } else if (msg.type === 'broadcast_card' && msg.broadcast) {
      wrap.appendChild(buildBroadcastCardMessage(msg));
    } else {
      const bubble = createEl('div', 'bubble');
      const parts = String(msg.text || '').split('\n');
      for (let pi = 0; pi < parts.length; pi++) {
        if (pi > 0) bubble.appendChild(createEl('br', ''));
        bubble.appendChild(document.createTextNode(parts[pi]));
      }
      wrap.appendChild(bubble);
    }

    node.appendChild(wrap);
  }

  if (msg.type !== 'system' && !isTemp) {
    bindMessageContextMenu(node, msg);
  }

  fragment.appendChild(node);
  return fragment;
}

function formatOrderStatusLabel(status){
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return '已完成';
  if (s === 'accepted' || s === 'processing' || s === 'in_progress') return '已接单';
  if (s === 'pending' || s === 'created' || s === 'new') return '未接单';
  return '未接单';
}

function buildOrderCardMessage(msg){
  const order = msg.order || {};
  const wrap = createEl('div', 'trade-card clickable-card');
  wrap.dataset.orderId = order.id || '';

  const safeOrderImage = normalizeMediaUrl(order.imageUrl || (order.items || []).find((item) => item && item.imageUrl)?.imageUrl || '');
  if (safeOrderImage) {
    const cover = createEl('img', 'trade-card-cover');
    cover.src = safeOrderImage;
    cover.alt = order.title || '订单商品';
    cover.addEventListener('click', (e) => {
      e.stopPropagation();
      window.openImageViewer(safeOrderImage);
    });
    wrap.appendChild(cover);
  }

  appendTradeCardHeader(wrap, order.title || `订单 #${formatOrderId(order.id) || '-'}`, order.summary || '订单通知');
  const statusCls = tradeStatusCls(order.status);
  wrap.append(createEl('div', 'trade-card-price', formatMoney(order.total || 0)), createEl('div', statusCls, formatOrderStatusLabel(order.status)));

  const openDetail = (e) => {
    if (e) e.stopPropagation();
    openChatOrderDetail(order);
  };
  wrap.addEventListener('click', openDetail);

  const actions = createEl('div', 'trade-card-actions');
  const detailBtn = createEl('button', 'secondary-btn', '查看详情');
  detailBtn.type = 'button';
  detailBtn.addEventListener('click', openDetail);
  actions.appendChild(detailBtn);

  const currentUserId = state.currentUser?.id || '';
  const isBuyer = currentUserId && currentUserId === order.buyerId;
  const isSeller = currentUserId && currentUserId === order.sellerId;
  const isParticipant = isBuyer || isSeller;
  const pendingRequester = order.pendingPriceRequestedBy || '';
  const hasPendingPrice = order.pendingPrice != null && !!pendingRequester;
  const isPriceLocked = !!order.priceAdjustmentLocked;

  // Seller can accept pending orders
  if(isSeller && order.status === 'pending'){
    actions.appendChild(createStopBtn('secondary-btn', '修改价格', (e, btn) => {
      if(!order.id) return;
      showPrompt('请输入新的总价', String(order.total || ''), (raw) => {
        withButtonLock(btn, () => doUpdateOrderPrice(order.id, raw), '修改中...');
      });
    }));
    actions.appendChild(createStopBtn('primary-btn', '接单', (e, btn) => {
      if(!order.id) return;
      withButtonLock(btn, () => doAcceptOrder(order.id), '接单中...');
    }));
  }

  // Buyer waiting for seller to accept
  if(isBuyer && order.status === 'pending'){
    actions.appendChild(createEl('span', 'trade-card-sub', '等待商家接单'));
  }

  // Confirm receipt / mark complete for accepted orders
  if(isParticipant && order.status === 'accepted'){
    actions.appendChild(createStopBtn('primary-btn', isBuyer ? '确认收货' : '标记已完成', (e, btn) => {
      if(!order.id) return;
      withButtonLock(btn, () => doCompleteOrder(order.id), '处理中...');
    }));
  }
  wrap.appendChild(actions);
  return wrap;
}

function appendTradeCardHeader(container, titleText, subText) {
  container.append(createEl('div', 'trade-card-title', titleText), createEl('div', 'trade-card-sub', subText));
}

function buildBroadcastCardMessage(msg){
  const card = createEl('div', 'trade-card');
  appendTradeCardHeader(card, (msg.broadcast && msg.broadcast.title) || '图文通知', (msg.broadcast && msg.broadcast.summary) || '点击查看详情');
  if(msg.broadcast && msg.broadcast.cover){
    const img = createEl('img', 'trade-card-cover');
    img.src = normalizeMediaUrl(msg.broadcast.cover) || '';
    img.alt = 'broadcast';
    card.appendChild(img);
  }
  const actions = createEl('div', 'trade-card-actions');
  actions.appendChild(createStopBtn('primary-btn', '查看详情', () => {
    openBroadcastDetail(
      (msg.broadcast && msg.broadcast.title) || '图文通知',
      (msg.broadcast && msg.broadcast.summary) || ''
    );
  }));
  card.appendChild(actions);
  return card;
}

async function openChatOrderDetail(order){
  if(!order || !order.id) return;
  // Try to find full order from local state for richer details
  let fullOrder = state.ordersById?.get(order.id);
  if(!fullOrder){
    // Reload orders and try again
    try{ await Promise.all([loadBuyerOrders(), loadSellerOrders()]); }catch(_){}
    fullOrder = state.ordersById?.get(order.id) || order;
  }
  const currentUserId = state.currentUser?.id || '';
  const role = currentUserId === fullOrder.buyerId ? 'buyer' : (currentUserId === fullOrder.sellerId ? 'seller' : 'buyer');
  openOrderDetail(fullOrder, role);
}

async function reloadActiveConversationMessages(){
  try{
    if(!state.activeConversation?.id) return;
    const convId = state.activeConversation.id;
    const data = await api(`/api/conversations/${convId}/messages`);
    if (state.activeConversation?.id !== convId) return; // conversation changed during fetch
    state.messages = data.messages || [];
    rebuildMessagesById();
    state.peerLastReadAt = Number((data && data.peerLastReadAt) || state.peerLastReadAt || 0);
    renderMessages();
    applyLastOutgoingReadState();
    loadConversations().catch(() => {});
  }catch(e){ console.warn('reloadActiveConversationMessages failed:', e); }
}

function appendMessageToView(msg) {
  const chatView = $('chatView');
  if (!chatView) return;
  const wasNearBottom = (chatView.scrollHeight - chatView.scrollTop - chatView.clientHeight) < 100;
  const prev = state.messages.length > 1 ? state.messages[state.messages.length - 2] : null;
  chatView.appendChild(buildMessageChunk(msg, prev?.createdAt || 0));
  if (wasNearBottom) chatView.scrollTop = chatView.scrollHeight;
  refreshMessageReadReceipts();
  applyLastOutgoingReadState();
}
function prependMessagesToView(messages, oldFirstMessage = null) {
  const chatView = $('chatView');
  if (!chatView || !messages || !messages.length) return;
  const oldHeight = chatView.scrollHeight;
  const fragment = document.createDocumentFragment();
  let lastTime = 0;
  messages.forEach((msg) => {
    fragment.appendChild(buildMessageChunk(msg, lastTime));
    lastTime = msg.createdAt || lastTime;
  });
  chatView.prepend(fragment);
  if (oldFirstMessage && lastTime && ((oldFirstMessage.createdAt || 0) - lastTime) <= DELAYS.TIME_SEPARATOR_GAP) {
    const firstArticle = chatView.querySelector('article.message-row');
    const maybeStamp = firstArticle?.previousElementSibling;
    if (maybeStamp && maybeStamp.classList && maybeStamp.classList.contains('time-stamp')) maybeStamp.remove();
  }
  chatView.scrollTop = chatView.scrollHeight - oldHeight;
  refreshMessageReadReceipts();
  applyLastOutgoingReadState();
}
function replaceMessageInView(msg) {
  const chatView = $('chatView');
  if (!chatView || !msg) return false;
  const existing = chatView.querySelector(`article.message-row[data-id="${CSS.escape(String(msg.id || ''))}"]`)
    || (msg.clientMessageId ? chatView.querySelector(`article.message-row[data-client-message-id="${CSS.escape(String(msg.clientMessageId))}"]`) : null);
  if (!existing) return false;
  const index = findMessageIndex(msg);
  const prev = index > 0 ? state.messages[index - 1] : null;
  existing.replaceWith(buildMessageChunk(msg, prev?.createdAt || 0));
  refreshMessageReadReceipts();
  applyLastOutgoingReadState();
  return true;
}
function removeMessageFromView(messageId) {
  const chatView = $('chatView');
  if (!chatView || !messageId) return false;
  const existing = chatView.querySelector(`article.message-row[data-id="${CSS.escape(String(messageId))}"]`);
  if (!existing) return false;
  const prev = existing.previousElementSibling;
  const next = existing.nextElementSibling;
  const hadPrevStamp = !!(prev && prev.classList && prev.classList.contains('time-stamp'));
  const nextIsMessage = !!(next && next.classList && next.classList.contains('message-row'));
  const nextIsTimestamp = !!(next && next.classList && next.classList.contains('time-stamp'));
  if (hadPrevStamp) {
    if (!nextIsMessage || nextIsTimestamp) prev.remove();
  }
  existing.remove();
  if (hadPrevStamp && nextIsMessage && !nextIsTimestamp) {
    const nextId = next.dataset.id || '';
    const nextIdx = state.messagesById.get(nextId);
    const nextMsg = nextIdx !== undefined ? state.messages[nextIdx] : null;
    if (nextMsg) {
      const stamp = createEl('div', 'time-stamp');
      stamp.appendChild(createEl('span', null, formatTime(nextMsg.createdAt)));
      next.before(stamp);
    }
  }
  refreshMessageReadReceipts();
  return true;
}
function applyRecalledMessageLocally(messageId, senderId) {
  const msgIdx = state.messagesById.get(messageId);
  const msg = msgIdx !== undefined ? state.messages[msgIdx] : undefined;
  if (!msg) return false;
  msg.type = 'system';
  msg.text = senderId === state.currentUser.id ? '你撤回了一条消息' : '对方撤回了一条消息';
  delete msg.imageUrl; delete msg.audioUrl; delete msg.card;
  return replaceMessageInView(msg) || false;
}
function summarizeMessagePreview(msg) {
  if (!msg) return '';
  if (msg.type === 'system') return String(msg.text || '');
  if (msg.type === 'image') return '[图片]';
  if (msg.type === 'audio') return '[语音]';
  if (msg.type === 'card') {
    if (isContactCardPayload(msg.card || {})) return '[名片]';
    const ct = String((msg.card || {}).cardType || '').trim();
    if (ct === '收款码') return '[收款码]';
    return '[商品]';
  }
  if (msg.type === 'order_card') return '[订单]';
  if (msg.type === 'broadcast_card') return '[图文通知]';
  return String(msg.text || '');
}

let _lastReceiptKey = '';
let _lastReceiptEl = null;
function refreshMessageReadReceipts() {
  const chatView = $('chatView');
  if (!chatView) return;
  if (!state.activeConversation || state.activeConversation.type !== 'direct') {
    if (_lastReceiptEl) { _lastReceiptEl.remove(); _lastReceiptEl = null; _lastReceiptKey = ''; }
    return;
  }
  const peerLastReadAt = Number(state.activeConversation.peerLastReadAt || 0);
  const lastMsg = state.messages.length ? state.messages[state.messages.length - 1] : null;
  const receiptKey = state.activeConversation.id + ':' + peerLastReadAt + ':' + (lastMsg?.id || '');
  if (receiptKey === _lastReceiptKey) return;
  _lastReceiptKey = receiptKey;
  if (_lastReceiptEl) { _lastReceiptEl.remove(); _lastReceiptEl = null; }
  let target = null;
  const uid = state.currentUser.id;
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const msg = state.messages[i];
    if (!msg) continue;
    if (msg.senderId !== uid) continue;
    if (msg.type === 'system') continue;
    if (String(msg.id || '').startsWith('temp_')) continue;
    target = msg;
    break;
  }
  if (!target) return;
  const row = chatView.querySelector(`article.message-row[data-id="${CSS.escape(String(target.id || ''))}"]`) || (target.clientMessageId ? chatView.querySelector(`article.message-row[data-client-message-id="${CSS.escape(String(target.clientMessageId))}"]`) : null);
  if (!row) return;
  const wrap = row.querySelector('.content-wrap');
  if (!wrap) return;
  const isRead = peerLastReadAt >= Number(target.createdAt || 0);
  const receipt = createEl('div', `message-read-receipt ${isRead ? 'is-read' : 'is-unread'}`);
  receipt.append(createEl('span', 'receipt-dot'), createEl('span', 'receipt-text', isRead ? '已读' : '未读'));
  wrap.appendChild(receipt);
  _lastReceiptEl = receipt;
}

function syncActiveConversationListMeta() {
  if (!state.activeConversation) return;
  const conv = state.conversationsById?.get(state.activeConversation.id);
  if (!conv) return;
  const lastMsg = state.messages.length ? state.messages[state.messages.length - 1] : null;
  const preview = summarizeMessagePreview(lastMsg);
  const lastMessageAt = lastMsg?.createdAt || (conv.clearedAt || 0) || 0;
  conv.preview = preview;
  conv.lastMessageAt = lastMessageAt;
  conv.unread = 0;
  state.activeConversation.preview = preview;
  state.activeConversation.lastMessageAt = lastMessageAt;
  state.activeConversation.unread = 0;
  sortConversationsInPlace();
}

function applyIncomingConversationMeta(conversationId, message) {
  const conv = state.conversationsById?.get(conversationId);
  if (!conv) return;
  conv.preview = summarizeMessagePreview(message);
  conv.lastMessageAt = message?.createdAt || Date.now();
  const fromOther = message && message.senderId && message.senderId !== state.currentUser.id;
  if (state.activeConversation && state.activeConversation.id === conversationId) conv.unread = 0;
  else if (fromOther) conv.unread = (conv.unread || 0) + 1;
  sortConversationsInPlace();
}
function buildConversationSignature(visible, totalUnread) {
  let s = totalUnread + ':';
  for (const conv of visible) {
    s += conv.id + '|' + (conv.title || '') + '|' + (conv.preview || '') + '|' + (conv.unread || 0)
      + '|' + (conv.muted ? 1 : 0) + '|' + (conv.pinned ? 1 : 0)
      + '|' + (conv.peerAvatarUrl || '') + '|' + (conv.clearedAt || 0)
      + '|' + (conv.lastMessageAt || 0) + ';';
  }
  return s;
}
function buildFriendListSignature(customGroups, grouped) {
  let s = '';
  for (const groupName of customGroups) {
    s += groupName + ':';
    for (const item of (grouped.get(groupName) || [])) {
      s += item.friend.id + '|' + (item.friend.displayName || '') + '|' + (item.friend.remark || '') + '|' + (item.friend.avatarUrl || '') + ',';
    }
    s += ';';
  }
  return s;
}
function buildMallSignature(products) {
  let s = '';
  for (const p of products) {
    s += p.id + '|' + (p.title || '') + '|' + p.price + '|' + (p.image || '')
      + '|' + (p.sellerId || '') + '|' + (p.sellerName || '')
      + '|' + (p.location || '') + '|' + (p.distance ?? '') + ';';
  }
  return s;
}
function isConversationMuted(conv) {
  if (!conv) return false;
  if (state.mutedConvIds && conv.id) return state.mutedConvIds.has(conv.id);
  if (typeof conv.muted === 'boolean') return conv.muted;
  return Array.isArray(conv.mutedBy) && conv.mutedBy.includes(state.currentUser?.id);
}
function isConversationPinned(conv) {
  if (!conv) return false;
  if (state.pinnedConvIds && conv.id) return state.pinnedConvIds.has(conv.id);
  if (typeof conv.pinned === 'boolean') return conv.pinned;
  return Array.isArray(conv.pinnedBy) && conv.pinnedBy.includes(state.currentUser?.id);
}
function getConversationClearedAt(conv) {
  if (!conv) return 0;
  if (typeof conv.clearedAt === 'number') return conv.clearedAt;
  return conv.clearedAt?.[state.currentUser?.id] || 0;
}
function normalizeConversation(conv) {
  if (!conv) return conv;
  return {
    ...conv,
    muted: isConversationMuted(conv),
    pinned: isConversationPinned(conv),
    clearedAt: getConversationClearedAt(conv),
    peerLastReadAt: Number(conv.peerLastReadAt || 0)
  };
}
function buildConversationItemSignature(conv) {
  return (conv.title || '') + '|' + (conv.preview || '') + '|' + (conv.unread || 0)
    + '|' + (conv.muted ? 1 : 0) + '|' + (conv.pinned ? 1 : 0)
    + '|' + (conv.peerAvatarUrl || '') + '|' + (conv.clearedAt || 0)
    + '|' + (conv.lastMessageAt || 0)
    + '|' + (state.activeConversation && state.activeConversation.id === conv.id ? 1 : 0);
}
function createEmptyChatListNode() {
  const empty = createEl('div', 'chat-list-empty');
  empty.append(createEl('div', null, '暂无消息'), createEl('div', 'chat-list-empty-tip', '点击右上角 ⊕ 添加好友'));
  return empty;
}

function closeConversationSwipeRows(exceptWrap = null) {
  document.querySelectorAll('.chat-swipe-row.revealed').forEach((row) => {
    if (exceptWrap && row === exceptWrap) return;
    row.classList.remove('revealed');
  });
}

function bindConversationSwipeDismiss(){
  const list = $("chatList");
  if (!list || list.dataset.swipeDismissBound === '1') return;
  list.dataset.swipeDismissBound = '1';
  list.addEventListener('scroll', () => closeConversationSwipeRows(), { passive: true });
  list.addEventListener('click', (e) => {
    if (!e.target.closest('.chat-swipe-row')) closeConversationSwipeRows();
    // Delegated conversation item click
    const chatItem = e.target.closest('.chat-item');
    if (!chatItem) return;
    // Skip if click was on a swipe action button
    if (e.target.closest('.chat-swipe-actions')) return;
    // Skip if click was on avatar (handled separately for profile popup)
    if (e.target.closest('.avatar')) return;
    const convId = chatItem.dataset.conversationId;
    if (!convId) return;
    if (convId === '__trade_alert__') {
      state.tradeAlertReadAt = Date.now();
      renderConversationListFromState();
      Promise.all([loadBuyerOrders(), loadSellerOrders()]).then(() => {
        const pendingSeller = (state.sellerOrders || []).filter(o => o && o.status !== 'completed');
        if (pendingSeller.length) window.openSecondaryPage('sellerOrdersPage', 'home');
        else window.openSecondaryPage('buyerOrdersManagePage', 'home');
      });
    } else if (convId === '__system_message__') {
      window.openSecondaryPage('systemMessagesPage', 'home');
    } else {
      window.openConversation(convId);
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#chatList .chat-swipe-row')) closeConversationSwipeRows();
  }, true);
}

function attachConversationSwipeDelete(wrap, onDelete) {
  let startX = 0;
  let startY = 0;
  let dragDx = 0;
  let suppressClick = false;
  let tracking = false;
  let axis = '';
  const threshold = LIMITS.DRAG_THRESHOLD;
  const content = wrap.querySelector('.chat-swipe-content');
  if (!content) return;

  const begin = (x, y) => {
    startX = x;
    startY = y;
    dragDx = 0;
    suppressClick = false;
    tracking = true;
    axis = '';
    closeConversationSwipeRows(wrap);
  };

  const actionWidth = LIMITS.SWIPE_ACTION_WIDTH;

  const move = (x, y, canPreventDefault = false, ev = null) => {
    if (!tracking) return;
    const dx = x - startX;
    const dy = y - startY;
    if (!axis) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axis === 'x') {
      dragDx = dx;
      suppressClick = true;
      if (canPreventDefault && ev && ev.cancelable) ev.preventDefault();
      const wasRevealed = wrap.classList.contains('revealed');
      const base = wasRevealed ? -actionWidth : 0;
      const raw = base + dx;
      const clamped = Math.max(-actionWidth, Math.min(0, raw));
      content.style.transition = 'none';
      content.style.transform = `translateX(${clamped}px)`;
    }
  };

  const finish = (x, y) => {
    if (!tracking) return;
    tracking = false;
    content.style.transition = '';
    content.style.transform = '';
    const dx = dragDx || (x - startX);
    const dy = y - startY;
    if (axis !== 'x') {
      setTimeout(() => { suppressClick = false; }, 180);
      return;
    }
    const wasRevealed = wrap.classList.contains('revealed');
    if (wasRevealed) {
      if (dx >= threshold) wrap.classList.remove('revealed');
    } else {
      if (dx <= -threshold) wrap.classList.add('revealed');
    }
    setTimeout(() => { suppressClick = false; }, 180);
  };

  content.addEventListener('touchstart', (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    begin(t.clientX, t.clientY);
  }, { passive: true });

  content.addEventListener('touchmove', (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    move(t.clientX, t.clientY, true, e);
  }, { passive: false });

  content.addEventListener('touchend', (e) => {
    const t = e.changedTouches?.[0];
    if (!t) return;
    finish(t.clientX, t.clientY);
  }, { passive: true });

  content.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    begin(e.clientX, e.clientY);
  });

  content.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    if (e.pointerType === 'mouse' && (e.buttons & 1) !== 1) return;
    move(e.clientX, e.clientY, false, null);
  });

  content.addEventListener('pointerup', (e) => {
    finish(e.clientX, e.clientY);
  });

  content.addEventListener('pointercancel', () => {
    tracking = false;
    axis = '';
    dragDx = 0;
  });

  content.addEventListener('click', (e) => {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  const delBtn = wrap.querySelector('.chat-swipe-delete-btn');
  if (delBtn) {
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      wrap.classList.remove('revealed');
      await onDelete();
    });
  }
}
function buildConversationRow(conv) {
  const isPinned = isConversationPinned(conv);
  const isMuted = isConversationMuted(conv);
  const peerId = conversationPeerId(conv);
  const cls = 'chat-item' + (isPinned ? ' is-pinned' : '') + (isMuted ? ' is-muted' : '') + (state.activeConversation && state.activeConversation.id === conv.id ? ' is-active' : '');
  const btn = createEl('button', cls);
  btn.type = 'button';
  btn.dataset.conversationId = conv.id;

  const avatarWrap = createEl('div', 'chat-item-avatar');
  if (conv.syntheticType === 'trade') avatarWrap.textContent = '💱';
  else if (conv.syntheticType === 'system') avatarWrap.textContent = '📢';
  else setAvatarContainer(avatarWrap, {avatarUrl: conv.peerAvatarUrl, displayName: conv.title}, conv.title);
  avatarWrap.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('.avatar')) return;
    event.stopPropagation();
    if (conv.syntheticType) return;
    if (peerId) window.openUserProfile(peerId, conv.title);
  });
  btn.appendChild(avatarWrap);

  const info = createEl('div', 'chat-item-main');

  const titleRow = createEl('div', 'chat-item-title-row');
  titleRow.append(createEl('strong', 'chat-item-title', conv.title || ''), createEl('span', 'chat-item-time', formatConversationTime(conv.lastMessageAt)));

  const metaRow = createEl('div', 'chat-item-meta');
  metaRow.appendChild(createEl('div', 'preview', conv.preview || ''));
  if (isMuted) metaRow.appendChild(createEl('span', 'chat-item-status', '🔕'));

  info.append(titleRow, metaRow);
  btn.appendChild(info);

  if (conv.unread) {
    const unread = createEl('span', isMuted ? 'unread-dot' : 'unread-btn', isMuted ? '' : (conv.unread > 99 ? '99+' : String(conv.unread)));
    unread.dataset.role = 'unread';
    btn.appendChild(unread);
  }

  if (conv.syntheticType === 'trade' || conv.syntheticType === 'system') {
    return btn;
  }

  const wrap = createEl('div', 'chat-swipe-row');
  wrap.dataset.conversationId = conv.id;
  const content = createEl('div', 'chat-swipe-content');
  content.appendChild(btn);
  const actionsWrap = createEl('div', 'chat-swipe-actions');
  const pinBtn = createEl('button', 'chat-swipe-pin-btn', isPinned ? '取消置顶' : '置顶');
  pinBtn.type = 'button';
  const deleteBtn = createEl('button', 'chat-swipe-delete-btn', '删除');
  deleteBtn.type = 'button';
  actionsWrap.append(pinBtn, deleteBtn);
  wrap.append(content, actionsWrap);

  attachConversationSwipeDelete(wrap, async () => {
    try {
      await api(`/api/conversations/${conv.id}/clear`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
      const now = Date.now();
      const target = state.conversationsById?.get(conv.id);
      if (target) {
        target.clearedAt = now;
        target.preview = '';
        target.unread = 0;
        target.lastMessageAt = now;
      }
      if (state.activeConversation?.id === conv.id) {
        state.activeConversation.clearedAt = now;
      }
      renderConversationListFromState();
      loadConversations();
    } catch (err) {
      showModal(err?.message || '删除失败');
    }
  });

  const swipePinBtn = wrap.querySelector('.chat-swipe-pin-btn');
  if (swipePinBtn) {
    swipePinBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      wrap.classList.remove('revealed');
      try {
        const res = await api(`/api/conversations/${conv.id}/pin`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
        const target = state.conversationsById?.get(conv.id);
        const nextPinned = Boolean(res?.pinned);
        if (target) target.pinned = nextPinned;
        if (state.activeConversation?.id === conv.id) state.activeConversation.pinned = nextPinned;
        if (state.pinnedConvIds) { nextPinned ? state.pinnedConvIds.add(conv.id) : state.pinnedConvIds.delete(conv.id); }
        showModal(nextPinned ? '已置顶会话' : '已取消置顶');
        sortConversationsInPlace();
        renderConversationListFromState();
      } catch (err) {
        showModal(err?.message || '操作失败');
      }
    });
  }

  return wrap;
}
function patchConversationRow(row, conv) {
  const replacement = buildConversationRow(conv);
  row.replaceWith(replacement);
  return replacement;
}
function buildFriendItemSignature(item, groupName = '') {
  return groupName + '::' + item.friend.id + '|' + (item.friend.displayName || '')
    + '|' + (item.friend.username || '') + '|' + (item.friend.remark || '')
    + '|' + (item.friend.avatarUrl || '');
}
function buildFriendGroupSignature(groupName, members) {
  let s = groupName + ':' + members.length + ':';
  for (const item of members) {
    s += buildFriendItemSignature(item, groupName) + ',';
  }
  return s;
}
function buildFriendRow(item, groupName = '') {
  const btn = createEl('button', 'chat-item');
  btn.type = 'button';
  btn.dataset.friendId = item.friend.id;
  btn.dataset.friendKey = `${groupName}::${item.friend.id}`;
  btn.addEventListener('click', () => window.openUserProfile(item.friend.id, item.friend.displayName));
  appendUserInfo(btn, item.friend, item.friend.remark || item.friend.displayName || '');
  return btn;
}
function patchFriendRow(row, item, groupName = '') {
  const replacement = buildFriendRow(item, groupName);
  row.replaceWith(replacement);
  return replacement;
}
function createFriendGroupSection(groupName, members) {
  const wrap = createEl('div', '');
  wrap.dataset.groupName = groupName;
  const header = createEl('div', 'qq-group-header');
  header.dataset.role = 'friend-group-header';
  header.addEventListener('click', () => window.toggleQQGroup(header));
  const content = createEl('div', 'qq-group-content');
  content.dataset.role = 'friend-group-content';
  wrap.appendChild(header);
  wrap.appendChild(content);
  return patchFriendGroupSection(wrap, groupName, members);
}
function patchFriendGroupSection(section, groupName, members) {
  section.dataset.groupName = groupName;
  let header = section.querySelector('[data-role="friend-group-header"]');
  if (!header) {
    header = createEl('div', 'qq-group-header');
    header.dataset.role = 'friend-group-header';
    header.addEventListener('click', () => window.toggleQQGroup(header));
    section.prepend(header);
  }
  header.replaceChildren();
  header.append(document.createTextNode(groupName + ' '));
  const count = createEl('span', 'friend-group-count', String(members.length));
  header.appendChild(count);
  let content = section.querySelector('[data-role="friend-group-content"]');
  if (!content) {
    content = createEl('div', 'qq-group-content');
    content.dataset.role = 'friend-group-content';
    section.appendChild(content);
  }
  const nextItemSignatures = reconcileList(content, members, {
    selector: 'button.chat-item[data-friend-key]',
    dataKey: 'friendKey',
    keyFn: (item) => `${groupName}::${item.friend.id}`,
    sigFn: (item) => buildFriendItemSignature(item, groupName),
    buildFn: (item) => buildFriendRow(item, groupName),
    patchFn: (node, item) => patchFriendRow(node, item, groupName),
    sigStore: state.friendItemSignatures,
  });
  Object.assign(state.friendItemSignatures, nextItemSignatures);
  return section;
}
function buildMallItemSignature(product) {
  return product.id + '|' + (product.title || '') + '|' + (product.desc || '')
    + '|' + product.price + '|' + product.stock + '|' + (product.image || '')
    + '|' + (product.sellerId || '') + '|' + (product.sellerName || '')
    + '|' + (product.sellerAvatarUrl || product.sellerAvatar || '')
    + '|' + (product.location || '') + '|' + (product.distance ?? '');
}
function buildMallCard(product) {
  const card = createEl('div', 'product-card');
  card.dataset.productId = product.id;
  return patchMallCard(card, product);
}
function patchMallCard(card, product) {
  const replacement = card.cloneNode(false);
  replacement.className = 'product-card';
  replacement.dataset.productId = product.id;
  replacement.addEventListener('click', () => openProductDetail(product, false));
  const safeImage = normalizeMediaUrl(product.image);
  if (safeImage) {
    const img = createEl('img', '');
    img.src = safeImage;
    img.alt = product.title || '商品图';
    replacement.appendChild(img);
  } else {
    const placeholder = createEl('div', '', '无图片');
    placeholder.className = 'empty-placeholder';
    replacement.appendChild(placeholder);
  }
  const info = createEl('div', 'product-info');
  info.appendChild(createEl('div', 'product-title', product.title || ''));
  if (product.desc) info.appendChild(createEl('div', 'product-desc', product.desc));
  info.appendChild(createEl('div', 'product-price', `¥${product.price}`));
  const seller = createEl('div', 'product-seller');
  seller.append(createAvatarNode({avatarUrl: product.sellerAvatarUrl || product.sellerAvatar, displayName: product.sellerName}, product.sellerName), createEl('span', '', product.sellerName || ''));
  info.appendChild(seller);
  if (product.location || product.distance != null) {
    const distText = product.distance != null ? (product.distance < 1 ? `${Math.round(product.distance * 1000)}m` : `${product.distance.toFixed(1)}km`) : '';
    info.appendChild(createEl('div', 'product-location', (product.location || '附近') + (distText ? ` · ${distText}` : '')));
  }
  replacement.appendChild(info);
  if (card.parentNode) card.replaceWith(replacement);
  return replacement;
}

// ==========================================
// ★ 1. 全局方法池（100%防止找不到函数） ★
// ==========================================

// ---- WeChat-style auth step navigation ----
window._authState = { loginPhone: '', regPhone: '', regCode: '' };
window.authGotoStep = (stepId) => {
  const allSteps = document.querySelectorAll('#authScreen .auth-step');
  allSteps.forEach(s => { if (!s.classList.contains('hidden')) s.classList.add('hidden'); });
  const target = $(stepId);
  if (target) target.classList.remove('hidden');
};
// Keep old names as no-ops for compatibility
window.switchAuth = () => {};
window.switchLoginMode = () => {};

const SECONDARY_PAGE_IDS = [
  'profileDetailPage','messageSettingsPage','friendRequestsView','addFriendPage','scanPage','privacyPage',
  'qrCodePage','editProfilePage','publishProductPage','myProductsPage','settingsPage','groupManagePage',
  'profileCartPage','profileOrdersPage','cartHubPage','buyerOrdersManagePage','sellerCenterPage','sellerPaymentPage',
  'sellerOrdersPage','sellerProductsPage','productDetailPage','orderDetailPage','broadcastManagePage','broadcastEditorPage',
  'contactCardPickerPage','productCardPickerPage','orderCardPickerPage',
  'productEditorPage','chatOrderDetailPage','broadcastDetailPage','forgotPasswordPage','changePasswordPage','changePhonePage',
  'msgSearchPage','mallSearchPage','systemMessagesPage','termsPage','privacyPolicyPage','aboutPage'
];
const TAB_VIEW_IDS = ["chatListView","friendListView","mallView","profileView"];
const ALL_VIEW_IDS = [...TAB_VIEW_IDS,"chatView","composerPanel","homeTabbar", ...SECONDARY_PAGE_IDS];
function hideAllViews() { ALL_VIEW_IDS.forEach(id => { if($(id)) $(id).classList.add('hidden'); }); }
function hideTabViews() { TAB_VIEW_IDS.forEach(id => { if($(id)) $(id).classList.add('hidden'); }); }

window.openSecondaryPage = (page, backTo = 'home', options = {}) => {
  // Push current secondary page onto stack for proper back navigation
  // Use options.replace = true to replace current page instead of pushing (e.g. after completing an action)
  if (!options.replace && state.secondaryPage && state.secondaryPage !== page) {
    state.secondaryStack.push({ page: state.secondaryPage, backTo: state.secondaryReturn });
  }
  if (options.replace && state.secondaryStack.length > 0) {
    // When replacing, inherit backTo from the stack entry that the current page would go back to
    const prevEntry = state.secondaryStack[state.secondaryStack.length - 1];
    if (!backTo || backTo === 'home') backTo = prevEntry.backTo;
  }
  state.secondaryPage = page; state.secondaryReturn = backTo;
  hideAllViews();
  hideEl("chatSearchBar");
  showEl(page);
  showEl("backBtn");
  hideEl("homeMoreBtn");
  hideEl("chatSettingsBtn");
  hideEl("sidebarToggleBtn");
  toggleEl("sidebarPanel", "sidebar-tab-hidden", true);

  if (page === 'friendRequestsView') {
    setText("chatTitle", '新的朋友');
    refreshFriendRequestState({ forceList: true });
  }
  else if (page === 'profileDetailPage') { setText("chatTitle", '详细资料'); showEl("chatSettingsBtn"); }
  else if (page === 'messageSettingsPage') {
    setText("chatTitle", '聊天信息');
    setText("pinConversationBtn", (state.activeConversation && state.activeConversation.pinned) ? '取消置顶' : '置顶聊天');
    setText("muteSettingBtn", (state.activeConversation && state.activeConversation.muted) ? '取消免打扰' : '消息免打扰');
  }
  else if (page === 'addFriendPage') { setText("chatTitle", '添加朋友'); }
  else if (page === 'scanPage') {
    setText("chatTitle", '扫一扫');
    hideEl("scanManualPanel");
    if($("scanIdInput")) $("scanIdInput").value = '';
    setText("scanHintText", '将二维码放入框内，即可自动扫描');
    requestAnimationFrame(() => { startScanCamera(); });
  }
  else if (page === 'privacyPage') { setText("chatTitle", '黑名单管理'); }
  else if (page === 'qrCodePage') { setText("chatTitle", '二维码名片'); }
  else if (page === 'editProfilePage') { setText("chatTitle", '个人信息'); }
  else if (page === 'forgotPasswordPage') { setText("chatTitle", '找回密码'); }
  else if (page === 'changePasswordPage') { setText("chatTitle", '修改密码'); }
  else if (page === 'changePhonePage') { setText("chatTitle", '修改手机号'); }
  else if (page === 'publishProductPage') { setText("chatTitle", '发布闲置'); }
  else if (page === 'myProductsPage') { setText("chatTitle", '我的闲置'); }
  else if (page === 'settingsPage') { setText("chatTitle", '设置'); }
  else if (page === 'groupManagePage') { setText("chatTitle", '分组管理'); renderGroupManageList(); }
  else if (page === 'buyerOrdersManagePage') { setText("chatTitle", '我购买的订单'); renderBuyerOrdersManage(); }
  else if (page === 'sellerCenterPage') { setText("chatTitle", '卖家中心'); }
  else if (page === 'sellerPaymentPage') { setText("chatTitle", '收款码管理'); }
  else if (page === 'sellerOrdersPage') { setText("chatTitle", '订单管理'); renderSellerOrdersManage(); }
  else if (page === 'sellerProductsPage') { setText("chatTitle", '商品管理'); }
  else if (page === 'productDetailPage') { setText("chatTitle", '商品详情'); }
  else if (page === 'orderDetailPage') { setText("chatTitle", '订单详情'); }
  else if (page === 'contactCardPickerPage') { setText("chatTitle", '发送名片'); }
  else if (page === 'productCardPickerPage') { setText("chatTitle", '我的商品'); }
  else if (page === 'orderCardPickerPage') { setText("chatTitle", '相关订单'); state.orderPickerTab = 'bought'; }
  else if (page === 'broadcastManagePage') { setText("chatTitle", '广播管理'); renderBroadcastDrafts(); }
  else if (page === 'broadcastEditorPage') { setText("chatTitle", '广播编辑'); }
  else if (page === 'cartHubPage') { setText("chatTitle", '购物车'); renderCartHubPage(); }
  else if (page === 'profileCartPage') { setText("chatTitle", '结算'); renderProfileCartPage(); }
  else if (page === 'profileOrdersPage') { setText("chatTitle", '我的订单'); renderProfileOrders(); }
  else if (page === 'chatOrderDetailPage') { setText("chatTitle", '订单详情'); }
  else if (page === 'msgSearchPage') { setText("chatTitle", '搜索'); setTimeout(() => { if($("msgSearchPageInput")) $("msgSearchPageInput").focus(); }, 100); }
  else if (page === 'mallSearchPage') { setText("chatTitle", '搜索'); setTimeout(() => { if($("mallSearchPageInput")) $("mallSearchPageInput").focus(); }, 100); }
  else if (page === 'systemMessagesPage') { setText("chatTitle", '系统消息'); renderSystemMessagesList(); }

};

window.removeFromBlacklist = async (targetId) => { try { await api('/api/blacklist', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, targetId, action: 'remove' }) }); $("privacySettingsBtn").click(); } catch(e){ showModal(e.message || '操作失败'); } }
window.toggleQQGroup = (el) => { el.classList.toggle('expanded'); const content = el.nextElementSibling; if(content) content.classList.toggle('expanded'); };
window.openImageViewer = (url) => { const safe = normalizeMediaUrl(url); if(!safe) return showModal('无效图片地址'); if($("viewerImage")) $("viewerImage").src = safe; showEl("imageViewer"); };
window.closeImageViewer = () => { hideEl("imageViewer"); if($("viewerImage")) $("viewerImage").removeAttribute('src'); };

window.playAudio = (url, el) => {
  const safe = normalizeMediaUrl(url);
  if(!safe) { if(el) el.classList.remove('playing'); return showModal('无效语音地址'); }
  const isSameBubble = window.currentAudioEl === el && window.currentAudio;
  if (isSameBubble && !window.currentAudio.paused) {
      window.currentAudio.pause();
      el.classList.remove('playing');
      return;
  }
  if(window.currentAudio) {
      window.currentAudio.pause();
      if(window.currentAudioEl) window.currentAudioEl.classList.remove('playing');
  }
  try {
      window.currentAudio = new Audio(safe);
      window.currentAudioEl = el;
      el.classList.add('playing');
      window.currentAudio.onended = () => { if (el) el.classList.remove('playing'); };
      window.currentAudio.onerror = () => { showModal('设备不支持此录音格式'); if (el) el.classList.remove('playing'); };
      window.currentAudio.play().catch(() => { showModal('播放被拦截，请重试'); if (el) el.classList.remove('playing'); });
  } catch(e) {
      if (el) el.classList.remove('playing');
      showModal('播放器初始化失败。');
  }
};

window.copyText = (enc) => { if (navigator.clipboard) { navigator.clipboard.writeText(decodeURIComponent(enc)).then(() => showToast('已复制')).catch(() => showToast('复制失败')); } else { showToast('浏览器不支持复制'); } };
window.deleteLocalMsg = async (id) => {
  if (!state.activeConversation?.id) return;
  const conversationId = state.activeConversation.id;
  const prevMessages = [...state.messages];
  state.messages = state.messages.filter(m => m.id !== id);
  rebuildMessagesById();
  if (!removeMessageFromView(id)) renderMessages();
  applyLastOutgoingReadState();
  try {
    await api(`/api/conversations/${conversationId}/messages/${id}/delete`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
    syncAndRenderConvList();
    loadConversations();
  } catch(e) {
    state.messages = prevMessages;
    rebuildMessagesById();
    renderMessages();
    applyLastOutgoingReadState();
    showModal(e.message || '删除失败');
  }
};
window.recallMsg = async (id) => {
  if (!state.activeConversation?.id) return;
  try {
    await api(`/api/conversations/${state.activeConversation.id}/messages/${id}/recall`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
    if (!applyRecalledMessageLocally(id, state.currentUser.id)) renderMessages();
    applyLastOutgoingReadState();
    syncAndRenderConvList();
    loadConversations();
  } catch(e) { showModal(e.message || '撤回失败'); }
};

let msgToForward = null;
const LONG_PRESS_DELAY_MS = 320;
const LONG_PRESS_MOVE_TOLERANCE_PX = 12;

function getTouchAnchor(event) {
  const touch = event && event.touches && event.touches[0];
  if (touch) return { clientX: touch.clientX, clientY: touch.clientY };
  return { clientX: event?.clientX || window.innerWidth / 2, clientY: event?.clientY || window.innerHeight / 2 };
}

function bindMessageContextMenu(node, msg) {
  let pressTimer = null;
  let pressArmed = false;
  let suppressClickUntil = 0;
  let startPoint = null;
  const clearPress = () => {
    pressArmed = false;
    startPoint = null;
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  };
  const armPress = (anchor) => {
    pressArmed = true;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (!pressArmed) return;
      pressArmed = false;
      suppressClickUntil = Date.now() + 450;
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
      window.showContextMenu(anchor, msg);
    }, LONG_PRESS_DELAY_MS);
  };
  node.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length > 1) return;
    clearPress();
    const anchor = getTouchAnchor(e);
    startPoint = { x: anchor.clientX, y: anchor.clientY };
    armPress(anchor);
  }, { passive: true });
  node.addEventListener('touchmove', (e) => {
    if (!pressArmed || !startPoint) return;
    const anchor = getTouchAnchor(e);
    const dx = Math.abs(anchor.clientX - startPoint.x);
    const dy = Math.abs(anchor.clientY - startPoint.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE_PX || dy > LONG_PRESS_MOVE_TOLERANCE_PX) clearPress();
  }, { passive: true });
  node.addEventListener('touchend', clearPress, { passive: true });
  node.addEventListener('touchcancel', clearPress, { passive: true });
  node.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }, true);
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearPress();
    suppressClickUntil = Date.now() + 250;
    window.showContextMenu(e, msg);
  });
}
window.forwardMsg = (msgId) => {
  const _fwdIdx = state.messagesById.get(msgId); msgToForward = _fwdIdx !== undefined ? state.messages[_fwdIdx] : undefined; if(!msgToForward) return;
  hideEl("contextMenu");
  const list = $("forwardList");
  if(list) {
    list.replaceChildren();
    state.conversations.forEach(c => {
      const btn = createEl('button', 'chat-item');
      btn.type = 'button';
      btn.dataset.convId = c.id;
      appendUserInfo(btn, {avatarUrl: c.peerAvatarUrl, displayName: c.title}, c.title || '');
      list.appendChild(btn);
    });
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.chat-item');
      if (item?.dataset.convId) window.confirmForward(item.dataset.convId);
    });
  }
  showEl("forwardModal");
};
window.confirmForward = async (convId) => {
  hideEl("forwardModal"); if(!msgToForward) return;
  try { await api(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ senderId: state.currentUser.id, type: msgToForward.type, text: msgToForward.text, imageUrl: msgToForward.imageUrl, audioUrl: msgToForward.audioUrl, card: msgToForward.card, order: msgToForward.order, broadcast: msgToForward.broadcast }) }); showModal('已转发'); } catch(e) { showModal('转发失败: ' + e.message); }
};

window.showContextMenu = function(event, msg) {
  const menu = $("contextMenu"); if(!menu) return;
  menu.replaceChildren();
  if (msg.type === 'text') appendActionButton(menu, '复制', () => window.copyText(encodeURIComponent(msg.text || '')));
  appendActionButton(menu, '转发', () => window.forwardMsg(msg.id));
  appendActionButton(menu, '删除', () => window.deleteLocalMsg(msg.id));
  if (msg.senderId === state.currentUser.id && (Date.now() - msg.createdAt < DELAYS.MESSAGE_RECALL_WINDOW)) {
     appendActionButton(menu, '撤回', () => window.recallMsg(msg.id));
  }
  menu.style.visibility = 'hidden';
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const anchor = getTouchAnchor(event);
  let x = anchor.clientX; let y = anchor.clientY;
  if (x + rect.width > window.innerWidth - 10) x = window.innerWidth - rect.width - 10; if (x < 10) x = 10;
  if (y < rect.height + 20) { y = y + 20; } else { y = y - rect.height - 15; }
  menu.style.left = `${x}px`; menu.style.top = `${y}px`;
  menu.style.visibility = '';
  if (state._ctxMenuClose) { document.removeEventListener('click', state._ctxMenuClose, true); document.removeEventListener('touchstart', state._ctxMenuClose, true); }
  const closeMenu = (e) => { if(e && e.target.closest('#contextMenu')) return; menu.classList.add('hidden'); menu.replaceChildren(); document.removeEventListener('click', closeMenu, true); document.removeEventListener('touchstart', closeMenu, true); state._ctxMenuClose = null; };
  state._ctxMenuClose = closeMenu;
  setTimeout(() => { document.addEventListener('click', closeMenu, true); document.addEventListener('touchstart', closeMenu, true); }, 0);
};

window.openProductChat = async (sellerId, title, price, image, productId) => {
  if(sellerId === state.currentUser.id) return showModal("这是你自己发布的商品哦！");
  try {
    const data = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ creatorId: state.currentUser.id, memberIds: [sellerId] }) });
    await window.openConversation(data.conversation.id);
    $("messageInput").value = `你好，我想买你的【${title}】`; $("messageInput").dispatchEvent(new Event("input"));
    window.sendMessage({ type: 'card', card: { cardType: '闲置商品', title, description: `售价：¥${price}`, meta: String(price), imageUrl: image, sellerId, productId: productId || '' } }).catch(() => {});
  } catch(e) { showModal("发起交易沟通失败"); }
};

window.acceptRequest = (requestId) => {
  withButtonLock($("profileAcceptRequestBtn"), async () => {
    await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, requestId }) }); showModal('已添加对方为好友！'); await Promise.all([loadFriends(), loadFriendRequests(), loadConversations()]); updateProfileDetailActions(); if($("backBtn")) $("backBtn").click();
  }, '处理中...');
};

window.rejectRequest = (requestId) => {
  showConfirm('确定拒绝该好友请求吗？', () => {
    withButtonLock($("profileRejectRequestBtn"), async () => {
      await api('/api/friends/reject', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, requestId }) });
      await loadFriendRequests();
      updateProfileDetailActions();
    }, '处理中...');
  });
};

window.deleteMyProduct = (productId) => {
  showConfirm("确定要下架并删除该商品吗？", async () => {
    showLoading('删除中...');
    try {
      await api('/api/products/delete', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, productId }) });
      await refreshProductViews();
    } catch(e) { showModal("删除失败：" + e.message); } finally { hideLoading(); }
  });
};

window.updateSellerProductStock = (productId, currentStock = 0) => {
  showPrompt('请输入新的库存数量', String(Math.max(0, Math.floor(Number(currentStock || 0)))), async (raw) => {
    const stock = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(stock)) return showModal('请输入有效库存');
    try {
      await api('/api/products/update', { method:'POST', body: JSON.stringify({ userId: state.currentUser.id, productId, stock }) });
      await refreshProductViews();
      showToast('库存已更新');
    } catch (e) {
      showModal(e.message || '库存更新失败');
    }
  });
};

window.toggleSellerProductListed = async (productId, nextListed) => {
  showLoading(nextListed ? '上架中...' : '下架中...');
  try {
    await api('/api/products/update', { method:'POST', body: JSON.stringify({ userId: state.currentUser.id, productId, listed: !!nextListed }) });
    await refreshProductViews();
    showToast(nextListed ? '商品已上架' : '商品已下架');
  } catch (e) {
    showModal(e.message || '商品状态更新失败');
  } finally { hideLoading(); }
};

window.deleteGroup = (groupName) => {
  if(groupName === DEFAULT_GROUP) return showModal('”我的好友”是全部好友列表，不能删除。');
  showConfirm(`确定删除分组 [${groupName}] 吗？\n该分组下的好友将被移入”我的好友”。`, async () => {
    try {
      const data = await api('/api/groups/delete', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, groupName }) });
      syncSessionGroups(data.groups || getCustomGroups().filter(g => g !== groupName));
      await loadFriends();
      renderGroupManageList();
      showModal('分组已删除');
    } catch(e) { showModal(e.message || '删除失败'); }
  });
};

window.renameGroup = (groupName) => {
  if (groupName === DEFAULT_GROUP) return showModal('”我的好友”是全部好友列表，不能重命名。');
  showPrompt('请输入新的分组名称', groupName, async (nextNameRaw) => {
    const nextName = normalizeGroupNameInput(nextNameRaw);
    if (!nextName) return showModal('分组名称不能为空');
    const groups = getCustomGroups();
    if (groups.includes(nextName) && nextName !== groupName) return showModal('分组名称已存在');
    try {
      const data = await api('/api/groups/rename', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, groupName, newName: nextName }) });
      syncSessionGroups(data.groups || groups.map((g) => g === groupName ? nextName : g));
      await loadFriends();
      renderGroupManageList();
    } catch (e) { showModal(e.message || '重命名失败'); }
  });
};

window.moveGroupOrder = async (groupName, offset) => {
  if (groupName === DEFAULT_GROUP) return;
  try {
    const data = await api('/api/groups/reorder', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, groupName, offset }) });
    syncSessionGroups(data.groups || getCustomGroups());
    renderGroupManageList();
    await loadFriends();
  } catch (e) { showModal(e.message || '排序失败'); }
};

window.openGroupSelect = (targetUserId) => {
    state.targetForGroupMove = targetUserId;
    const list = $("groupSelectList");
    const cg = getCustomGroups();
    if (list) {
      list.replaceChildren();
      cg.forEach((g) => {
        const btn = createEl('button', 'primary-btn', g);
        btn.style.cssText = 'background:#f2f2f6; color:#000; width:100%; border-radius:8px; padding:12px; margin-bottom:10px;';
        list.appendChild(btn);
      });
      list.onclick = (e) => {
        const btn = e.target.closest('.primary-btn');
        if (btn?.textContent) window.confirmMoveGroup(btn.textContent);
      };
    }
    showEl("groupSelectSheet");
};

window.confirmMoveGroup = async (groupName) => {
    hideEl("groupSelectSheet");
    try {
        await api('/api/friends/group', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendId: state.targetForGroupMove, group: groupName }) });
        showModal("已成功移至分组：" + groupName);
        loadFriends();
        if($("backBtn") && $("profileDetailPage") && !$("profileDetailPage").classList.contains("hidden")) $("backBtn").click();
    } catch(e) { showModal(e.message); }
};


async function decodeScanFromImageFile(file){
  if (!file) return false;
  if (!('BarcodeDetector' in window)) return false;
  try {
    const detector = state.scanDetector = state.scanDetector || new BarcodeDetector({ formats: ['qr_code'] });
    const bitmap = await createImageBitmap(file);
    const codes = await detector.detect(bitmap);
    bitmap.close && bitmap.close();
    if (codes && codes.length) {
      const raw = String(codes[0].rawValue || '').trim();
      const mm = raw.match(/(?:^|chattrade:|ctid:)([A-Za-z0-9_-]{4,})$/i);
      const value = (mm ? mm[1] : raw).trim();
      if (value && $('scanIdInput')) {
        $('scanIdInput').value = value;
        showEl('scanManualPanel');
        setTimeout(() => { $('scanSubmitBtn')?.click(); }, 100);
        return true;
      }
    }
  } catch (_) {}
  return false;
}
async function startScanCamera(){
  const video = $('scanVideo');
  if (!video) return;
  stopScanCamera();
  if ($('scanHintText')) $('scanHintText').textContent = '正在启动相机...';
  const openCaptureFallback = () => {
    if ($('scanHintText')) $('scanHintText').textContent = '相机不可用，请使用相册或手动输入';
    const input = $('scanCaptureInput');
    if (input) {
      input.setAttribute('capture', 'environment');
      input.value = '';
      input.click();
    }
  };
  try{
    // On Android native app, ensure camera permission is granted before getUserMedia
    if (window.__NATIVE_ANDROID__ && window.NativeBridge && !window.NativeBridge.hasCameraPermission()) {
      window.NativeBridge.requestCameraPermission();
      // Wait briefly for user to respond to permission dialog
      await new Promise(r => setTimeout(r, DELAYS.PERMISSION_WAIT));
      if (!window.NativeBridge.hasCameraPermission()) {
        if ($('scanHintText')) $('scanHintText').textContent = '需要相机权限才能扫码，请在设置中开启';
        showEl('scanFallbackBox');
        return;
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no_camera_api');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    state.scanStream = stream;
    video.srcObject = stream;
    video.classList.remove('hidden');
    hideEl('scanFallbackBox');
    if ($('scanHintText')) $('scanHintText').textContent = '将二维码放入框内，即可自动扫描';

    let detector = null;
    if ('BarcodeDetector' in window) {
      try { detector = state.scanDetector = state.scanDetector || new BarcodeDetector({ formats: ['qr_code'] }); } catch(_) {}
    }
    if (!detector) {
      if ($('scanHintText')) $('scanHintText').textContent = '实时扫描不可用，请使用相册识别';
      return;
    }
    const detectLoop = async () => {
      if (!state.scanStream || !video) return;
      if (video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          if (codes && codes.length) {
            const raw = String(codes[0].rawValue || '').trim();
            const mm = raw.match(/(?:^|chattrade:|ctid:)([A-Za-z0-9_-]{4,})$/i);
            const value = (mm ? mm[1] : raw).trim();
            if (value && $('scanIdInput')) {
              $('scanIdInput').value = value;
              showEl('scanManualPanel');
              if ($('scanHintText')) $('scanHintText').textContent = '已识别到二维码';
              stopScanCamera(true);
              setTimeout(() => { $('scanSubmitBtn')?.click(); }, 100);
              return;
            }
          }
        } catch(_) {}
      }
      if (state.scanStream) state.scanLoopTimer = setTimeout(detectLoop, 350);
    };
    state.scanLoopTimer = setTimeout(detectLoop, 400);
  } catch (_) {
    stopScanCamera();
    openCaptureFallback();
  }
}
function stopScanCamera(keepVideoHidden = false){
  if (state.scanLoopTimer) { clearTimeout(state.scanLoopTimer); state.scanLoopTimer = null; }
  if (state.scanStream) { try { state.scanStream.getTracks().forEach(t => t.stop()); } catch(_) {} }
  state.scanStream = null;
  const video = $('scanVideo');
  if (video) {
    video.srcObject = null;
    if (!keepVideoHidden) video.classList.add('hidden');
  }
  showEl('scanFallbackBox');
}

let _openConvAc = null;
window.openConversation = async (id, options = {}) => {
  if (_openConvAc) { _openConvAc.abort(); _openConvAc = null; }
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  _openConvAc = ac;
  const { skipFetch = false } = options;
  const conv = state.conversationsById?.get(id);
  state.activeConversation = { id, type: 'direct', members: conv?.members || [], title: conv?.title || '', peerAvatarUrl: conv?.peerAvatarUrl || '', peerIsFriend: conv?.peerIsFriend === true, muted: conv?.muted || false, pinned: conv?.pinned || false, clearedAt: conv?.clearedAt || 0, peerLastReadAt: Number(conv?.peerLastReadAt || 0) }; 
  state.peerLastReadAt = state.activeConversation.peerLastReadAt; 
  if (conv) {
    conv.unread = 0;
    renderConversationListFromState();
  }
  // Clear secondary page navigation state when entering a conversation
  state.secondaryPage = null; state.secondaryReturn = null; state.secondaryStack = [];
  SECONDARY_PAGE_IDS.forEach(id => hideEl(id));
  setText("chatTitle", conv?.title || '会话');
  hideEl("chatListView");
  hideEl("friendListView");
  hideEl("mallView");
  hideEl("profileView");
  showEl("chatView");
  showEl("composerPanel");
  hideEl("homeTabbar");
  showEl("backBtn");
  hideEl("homeMoreBtn");
  showEl("chatSettingsBtn");
  // show sidebar in chat conversation view
  showEl("sidebarToggleBtn");
  toggleEl("sidebarPanel", "sidebar-tab-hidden", false);
  applySidebarMode();
  applyChatRelationshipState();
  const signal = ac ? ac.signal : null;
  if (!skipFetch) {
    await fetchMessages();
    if (signal?.aborted) return;
    await api(`/api/conversations/${id}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }), signal });
    if (signal?.aborted) return;
    refreshMessageReadReceipts();
  } else {
    Promise.resolve().then(async () => {
      try {
        if (signal?.aborted || !state.activeConversation || state.activeConversation.id !== id) return;
        await fetchMessages();
        if (signal?.aborted || state.activeConversation?.id !== id) return;
        await api(`/api/conversations/${id}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }), signal });
        if (signal?.aborted) return;
        refreshMessageReadReceipts();
      } catch(_) {}
    });
  }
  refreshConversations();
  const _cv = $("chatView");
  if (_cv) setTimeout(() => { _cv.scrollTop = _cv.scrollHeight; }, 100);
};

window.openPrivateChat = async (targetUserId) => {
  try {
    const data = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ creatorId: state.currentUser.id, memberIds: [targetUserId] }) });
    await window.openConversation(data.conversation.id);
  } catch(e) { showModal("发起沟通失败"); }
};

window.openUserProfile = async (userId, fallbackName) => {
  if (!userId || userId === 'null') return;
  try {
    const data = await api(`/api/users/${userId}/profile?viewerId=${encodeURIComponent(state.currentUser.id)}`);
    if (data.profile) {
      data.profile.isFriend = !!data.profile.isFriend;
      state.currentProfileUser = data.profile;
      state.currentCartSellerId = data.profile.id || '';
      setAvatarContainer($("profileAvatar"), data.profile, fallbackName);

      const finalName = data.profile.remarkName || data.profile.nickname || fallbackName || '未知用户';
      setText("profileRemarkName", finalName);
      setText("profileNickName", data.profile.nickname || '-'); 
      setText("profileAppId", `ID：${data.profile.appNumberId}`);
      setText("profileSignature", data.profile.signature || '这个人很神秘，还没有填写签名');
      updateProfileDetailActions();
      await loadProfileStore(data.profile.id);
      window.openSecondaryPage('profileDetailPage', getSecondaryBackTarget(state.activeConversation ? 'chat' : 'home'));
    }
  } catch (e) {
    console.warn('openUserProfile failed', e);
    showModal('打开个人主页失败，请稍后重试');
  }
};

window.insertEmoji = (emoji) => { const input = $("messageInput"); if(!input) return; input.value += emoji; input.dispatchEvent(new Event("input")); input.focus(); };

window.sendMessage = async (payload) => {
  if (!state.activeConversation) return;
  const _now = Date.now();
  const sentConversationId = state.activeConversation.id;
  const clientMessageId = `c_${_now}_${Math.random().toString(36).slice(2, 8)}`;
  const tempMsg = { id: 'temp_'+_now, senderId: state.currentUser.id, createdAt: _now, clientMessageId, ...payload };
  state.messages.push(tempMsg);
  state.messagesById.set(tempMsg.id, state.messages.length - 1);
  appendMessageToView(tempMsg);
  const cv = $("chatView"); if (cv) setTimeout(() => { cv.scrollTop = cv.scrollHeight; }, 10);
  syncAndRenderConvList();
  try {
    const res = await api(`/api/conversations/${sentConversationId}/messages`, { method: "POST", body: JSON.stringify({ senderId: state.currentUser.id, clientMessageId, ...payload }) });
    const stillSameConv = state.activeConversation?.id === sentConversationId;
    if (res?.message && stillSameConv) {
      const result = upsertMessage(res.message);
      if (result.action === 'replace') {
        if (!replaceMessageInView(res.message)) renderMessages();
      } else {
        appendMessageToView(res.message);
      }
      applyLastOutgoingReadState();
      syncActiveConversationListMeta();
      renderConversationListFromState();
      refreshMessageReadReceipts();
    }
    loadConversations();
    loadSystemMessages();
  } catch (err) {
    if (state.activeConversation?.id === sentConversationId) {
      state.messages = state.messages.filter(m => m.id !== tempMsg.id);
      rebuildMessagesById();
      if (!removeMessageFromView(tempMsg.id)) renderMessages();
      applyLastOutgoingReadState();
      syncActiveConversationListMeta();
      renderConversationListFromState();
    }
    if (err.message && err.message.includes('拒收')) {
      showModal(err.message);
    } else {
      showModal("发送失败: " + err.message);
    }
  }
};

window.handleSendText = async () => {
    const input = $("messageInput"); if(!input) return; const text = input.value.trim(); if (!text) return;
    input.value = ""; input.style.height = 'auto'; 
    showEl("toggleActionsBtn"); hideEl("sendMsgBtn");
    hideEl("emojiPanel"); hideEl("actionPanel");
    await window.sendMessage({ type: "text", text });
};


function setPublishProductHint(message = '', type = 'muted'){
  const el = $("productPublishHint");
  if(!el) return;
  el.textContent = message;
  el.classList.remove('success','error');
  if(type === 'success') el.classList.add('success');
  if(type === 'error') el.classList.add('error');
}

// ==========================================
// ★ 2. DOM 交互事件同步挂载 (不再依赖 load 事件)
// ==========================================
let _eventsBound = false;
function bindAllEvents() {
  if (_eventsBound) return;
  _eventsBound = true;

  bindAuthEvents();
  bindProductEvents();
  bindProfileEvents();
  bindSocialEvents();
  bindShoppingEvents();
  bindBroadcastEvents();
  bindChatEvents();
  bindSearchAndEmojiEvents();
}


// Auth & password events
function bindAuthEvents() {
  // ---- Auth: code box input handling ----
  function setupCodeBoxes(containerId, onComplete) {
    const container = $(containerId);
    if (!container) return;
    const boxes = container.querySelectorAll('.auth-code-box');
    boxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        const v = box.value.replace(/\D/g, '');
        box.value = v.slice(0, 1);
        if (v && i < boxes.length - 1) boxes[i + 1].focus();
        const code = Array.from(boxes).map(b => b.value).join('');
        if (code.length === 4) onComplete(code);
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) { boxes[i - 1].focus(); boxes[i - 1].value = ''; }
      });
      box.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
        pasted.split('').forEach((ch, j) => { if (boxes[j]) boxes[j].value = ch; });
        if (pasted.length === 4) onComplete(pasted);
        else if (boxes[pasted.length]) boxes[pasted.length].focus();
      });
    });
  }
  function clearCodeBoxes(containerId) {
    const container = $(containerId);
    if (!container) return;
    container.querySelectorAll('.auth-code-box').forEach(b => { b.value = ''; });
    const first = container.querySelector('.auth-code-box');
    if (first) first.focus();
  }
  const _resendTimers = {};
  function startResendCountdown(btnId, seconds, sendFn) {
    const btn = $(btnId);
    if (!btn) return;
    // Clear any existing timer to prevent leak
    if (_resendTimers[btnId]) { clearInterval(_resendTimers[btnId]); delete _resendTimers[btnId]; }
    let remaining = seconds;
    btn.disabled = true;
    btn.textContent = `重新发送 (${remaining}s)`;
    const timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) { clearInterval(timer); delete _resendTimers[btnId]; btn.disabled = false; btn.textContent = '重新发送'; return; }
      btn.textContent = `重新发送 (${remaining}s)`;
    }, 1000);
    _resendTimers[btnId] = timer;
    btn.onclick = () => { if (!btn.disabled) sendFn(); };
  }

  // ---- Auth: phone input validation for enabling Next button ----
  function bindPhoneValidation(inputId, btnId, checkboxId) {
    const input = $(inputId);
    const btn = $(btnId);
    const checkbox = $(checkboxId);
    if (!input || !btn) return;
    const validate = () => {
      const phone = normalizePhoneInput(input.value.trim());
      const agreed = checkbox ? checkbox.checked : true;
      btn.disabled = !(phone && agreed);
    };
    input.addEventListener('input', validate);
    if (checkbox) checkbox.addEventListener('change', validate);
    validate();
  }

  // ---- Auth: terms/privacy viewer ----
  window._authTermsBackTarget = 'authWelcome';
  function authOpenLegal(type) {
    const termsHtml = $("termsPage")?.querySelector('.legal-content')?.innerHTML || '';
    const privacyHtml = $("privacyPolicyPage")?.querySelector('.legal-content')?.innerHTML || '';
    const content = $("authTermsContent");
    if (content) content.innerHTML = type === 'terms' ? termsHtml : privacyHtml;
    // Find which auth step is currently visible to go back to
    const allSteps = document.querySelectorAll('#authScreen .auth-step');
    allSteps.forEach(s => { if (!s.classList.contains('hidden') && s.id !== 'authTermsView') window._authTermsBackTarget = s.id; });
    authGotoStep('authTermsView');
  }
  document.querySelectorAll('.auth-open-terms').forEach(a => {
    a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); authOpenLegal('terms'); });
  });
  document.querySelectorAll('.auth-open-privacy').forEach(a => {
    a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); authOpenLegal('privacy'); });
  });
  on("authTermsBackBtn", "click", () => authGotoStep(window._authTermsBackTarget));

  // ---- Welcome screen buttons ----
  on("authGoLogin", "click", () => authGotoStep('authLoginPhone'));
  on("authGoRegister", "click", () => authGotoStep('authRegPhone'));

  // ---- Auth back buttons & goto buttons ----
  document.querySelectorAll('[data-auth-back]').forEach(btn => {
    btn.addEventListener('click', () => authGotoStep(btn.dataset.authBack));
  });
  document.querySelectorAll('[data-auth-goto]').forEach(btn => {
    btn.addEventListener('click', () => authGotoStep(btn.dataset.authGoto));
  });

  // ---- Shared: phone → send code → go to code step ----
  async function sendCodeAndNext({ phoneInputId, btnId, scene, stateKey, displayId, codeBoxesId, stepId, resendBtnId, enterInputId }) {
    const phone = normalizePhoneInput($(phoneInputId)?.value.trim());
    if (!phone) return;
    window._authState[stateKey] = phone;
    const btn = $(btnId);
    btn.disabled = true;
    btn.textContent = '发送中...';
    try {
      await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone, scene }) });
    } catch (e) {
      btn.disabled = false; btn.textContent = '下一步';
      showModal(e.message || '发送验证码失败，请稍后再试');
      return;
    }
    btn.disabled = false; btn.textContent = '下一步';
    if ($(displayId)) $(displayId).textContent = phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    clearCodeBoxes(codeBoxesId);
    authGotoStep(stepId);
    const resendFn = async () => {
      try { await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone, scene }) }); } catch (_) {}
      startResendCountdown(resendBtnId, 60, resendFn);
    };
    startResendCountdown(resendBtnId, 60, resendFn);
  }

  // ---- Login: Phone input → Next ----
  bindPhoneValidation('loginPhone', 'loginPhoneNextBtn', 'loginAgreeCheck');
  on("loginPhoneNextBtn", "click", () => sendCodeAndNext({
    phoneInputId: 'loginPhone', btnId: 'loginPhoneNextBtn', scene: 'login',
    stateKey: 'loginPhone', displayId: 'loginCodePhoneDisplay',
    codeBoxesId: 'loginCodeBoxes', stepId: 'authLoginCode', resendBtnId: 'resendLoginCodeBtn',
  }));
  on("loginPhone", "keydown", (e) => { if (e.key === 'Enter' && !$("loginPhoneNextBtn")?.disabled) $("loginPhoneNextBtn").click(); });

  // ---- Login: SMS code auto-submit ----
  setupCodeBoxes('loginCodeBoxes', async (code) => {
    const phone = window._authState.loginPhone;
    if (!phone) return;
    try {
      const res = await api('/api/login/phone-code', { method: 'POST', body: JSON.stringify({ phone, code }) });
      writeSession(res.user, res.token, res.csrfToken);
      location.reload();
    } catch (e) {
      showModal(e.message || '验证码错误');
      clearCodeBoxes('loginCodeBoxes');
    }
  });

  // ---- Login: Password mode ----
  on("doLoginBtn", "click", async () => {
    const phone = normalizePhoneInput($("loginPwdPhone")?.value.trim());
    const p = $("loginPassword")?.value;
    if (!phone || !p) return showModal("请输入手机号和密码");
    const btn = $("doLoginBtn");
    btn.disabled = true;
    btn.textContent = "登录中...";
    try {
      const res = await api("/api/login", { method: "POST", body: JSON.stringify({ phone, password: p }) });
      writeSession(res.user, res.token, res.csrfToken);
      location.reload();
    } catch (err) {
      showModal("登录失败：" + (err.message || "请检查手机号和密码"));
    } finally {
      btn.disabled = false;
      btn.textContent = "登录";
    }
  });
  [['loginPwdPhone','loginPassword','focus'],['loginPassword','doLoginBtn','click']].forEach(
    ([src,tgt,act]) => on(src, "keydown", (e) => { if(e.key==='Enter') $(tgt)?.[act](); })
  );

  // ---- Register: Phone → Next ----
  bindPhoneValidation('registerPhone', 'regPhoneNextBtn', 'regAgreeCheck');
  on("regPhoneNextBtn", "click", () => sendCodeAndNext({
    phoneInputId: 'registerPhone', btnId: 'regPhoneNextBtn', scene: 'register',
    stateKey: 'regPhone', displayId: 'regCodePhoneDisplay',
    codeBoxesId: 'regCodeBoxes', stepId: 'authRegCode', resendBtnId: 'resendRegCodeBtn',
  }));
  on("registerPhone", "keydown", (e) => { if (e.key === 'Enter' && !$("regPhoneNextBtn")?.disabled) $("regPhoneNextBtn").click(); });

  // ---- Register: SMS code → Profile ----
  setupCodeBoxes('regCodeBoxes', (code) => {
    window._authState.regCode = code;
    authGotoStep('authRegProfile');
    setTimeout(() => $("registerDisplayName")?.focus(), 100);
  });

  // ---- Register: Complete registration ----
  on("doRegisterBtn", "click", async () => {
    const n = $("registerDisplayName")?.value.trim();
    const p = $("registerPassword")?.value;
    const phone = window._authState.regPhone;
    if (!n || !p) return showModal("请填写完整信息");
    if (p.length < 8) return showModal('密码至少8位');
    const btn = $("doRegisterBtn");
    btn.disabled = true;
    btn.textContent = "注册中...";
    try {
      const res = await api("/api/register", { method: "POST", body: JSON.stringify({ displayName: n, password: p, phone, code: window._authState.regCode }) });
      writeSession(res.user, res.token, res.csrfToken);
      location.reload();
    } catch (err) {
      showModal("注册失败：" + (err.message || "账号可能已存在"));
    } finally {
      btn.disabled = false;
      btn.textContent = "完成注册";
    }
  });
  [['registerDisplayName','registerPassword','focus'],['registerPassword','doRegisterBtn','click']].forEach(
    ([src,tgt,act]) => on(src, "keydown", (e) => { if(e.key==='Enter') $(tgt)?.[act](); })
  );

  // ---- Forgot password ----
  on("forgotPasswordBtn", "click", () => authGotoStep('authForgotPwd'));
  on("forgotPasswordBtn2", "click", () => authGotoStep('authForgotPwd'));

  // ---- Shared: send reset code ----
  async function handleSendResetCode(phoneInputId, sendBtnId) {
    const phone = normalizePhoneInput($(phoneInputId)?.value.trim());
    if (!phone) return showModal('请输入11位手机号');
    const sendBtn = $(sendBtnId);
    sendBtn.disabled = true;
    sendBtn.textContent = '发送中...';
    try {
      await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone, scene: 'reset' }) });
      showModal('验证码已发送（测试环境请输入 1234）');
    } catch (e) {
      const waitSec = Number(e?.data?.retryAfterSec || 0);
      if (waitSec > 0) showModal(`操作频繁，请${waitSec}秒后重试`);
      else showModal(e.message || '发送验证码失败');
    } finally { sendBtn.disabled = false; sendBtn.textContent = '获取验证码'; }
  }

  // ---- Shared: submit reset password ----
  async function handleResetPassword(phoneInputId, codeInputId, pwdInputId, submitBtnId, onSuccess) {
    const phone = normalizePhoneInput($(phoneInputId)?.value.trim());
    const code = $(codeInputId)?.value.trim();
    const newPassword = $(pwdInputId)?.value || '';
    if (!phone || !code || !newPassword) return showModal('请填写完整信息');
    if (!/^\d{4}$/.test(code)) return showModal('请输入4位验证码');
    if (newPassword.length < 8) return showModal('新密码至少8位');
    const submitBtn = $(submitBtnId);
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';
    try {
      await api('/api/password/forgot', { method: 'POST', body: JSON.stringify({ phone, code, newPassword }) });
      showModal('密码重置成功，请重新登录');
      onSuccess();
    } catch (e) { showModal(e.message || '重置密码失败');
    } finally { submitBtn.disabled = false; submitBtn.textContent = '重置密码'; }
  }

  on("authForgotSendBtn", "click", () => handleSendResetCode('authForgotPhone', 'authForgotSendBtn'));
  on("authForgotSubmitBtn", "click", () => handleResetPassword(
    'authForgotPhone', 'authForgotCode', 'authForgotNewPwd', 'authForgotSubmitBtn',
    () => authGotoStep('authLoginPassword')
  ));

  // ---- Settings: forgot password page (in appScreen for logged-in users) ----
  on("sendForgotCodeBtn", "click", () => handleSendResetCode('forgotPhoneInput', 'sendForgotCodeBtn'));
  on("submitForgotPasswordBtn", "click", () => handleResetPassword(
    'forgotPhoneInput', 'forgotCodeInput', 'forgotNewPasswordInput', 'submitForgotPasswordBtn',
    () => { localStorage.removeItem(SESSION_KEY); location.reload(); }
  ));
  [['changePasswordBtn','changePasswordPage','settingsPage'],['changePhoneBtn','changePhonePage','settingsPage'],
   ['openTermsPageBtn','termsPage','settingsPage'],['openPrivacyPageBtn','privacyPolicyPage','settingsPage'],
   ['openAboutPageBtn','aboutPage','settingsPage'],['aboutTermsBtn','termsPage','aboutPage'],
   ['aboutPrivacyBtn','privacyPolicyPage','aboutPage']].forEach(
    ([id,page,back]) => on(id, "click", () => window.openSecondaryPage(page, back))
  );
  on("sendChangePhoneCodeBtn", "click", () => {
    const phone = normalizePhoneInput($("changePhoneInput")?.value.trim());
    if(!phone) return showModal('请输入11位手机号');
    withButtonLock($("sendChangePhoneCodeBtn"), async () => {
      const res = await api('/api/auth/send-code', { method:'POST', body: JSON.stringify({ phone, scene:'reset' }) });
      showModal(res.mockCode ? `验证码（测试）: ${res.mockCode}` : '验证码已发送');
    }, '发送中...');
  });
  on("submitChangePhoneBtn", "click", () => {
    const phone = normalizePhoneInput($("changePhoneInput")?.value.trim());
    const code = $("changePhoneCodeInput")?.value.trim();
    if(!phone || !code) return showModal('请填写手机号和验证码');
    withButtonLock($("submitChangePhoneBtn"), async () => {
      const data = await api('/api/users/change-phone', { method:'POST', body: JSON.stringify({ phone, code }) });
      state.currentUser = data.user || state.currentUser;
      writeSession(state.currentUser);
      setText("editPhoneDisplay", state.currentUser.phone || '未绑定');
      showModal('手机号修改成功');
      if($("backBtn")) $("backBtn").click();
    }, '提交中...');
  });
  on("submitChangePasswordBtn", "click", () => {
    const oldPassword = $("oldPasswordInput")?.value || '';
    const newPassword = $("newPasswordInput")?.value || '';
    if(!oldPassword.trim() || !newPassword.trim()) return showModal('请填写旧密码和新密码');
    if(oldPassword === newPassword) return showModal('新密码不能与旧密码相同');
    if((newPassword || '').length < 8) return showModal('新密码至少8位');
    withButtonLock($("submitChangePasswordBtn"), async () => {
      await api('/api/password/change', { method:'POST', body: JSON.stringify({ oldPassword, newPassword }) });
      showModal('密码修改成功，请重新登录');
      localStorage.removeItem(SESSION_KEY);
      location.reload();
    }, '提交中...');
  });

  [['forgotPhoneInput','sendForgotCodeBtn'],['forgotCodeInput','submitForgotPasswordBtn'],
   ['forgotNewPasswordInput','submitForgotPasswordBtn'],['oldPasswordInput','submitChangePasswordBtn'],
   ['newPasswordInput','submitChangePasswordBtn']].forEach(
    ([src,tgt]) => on(src, "keydown", (e) => { if(e.key==='Enter') $(tgt)?.click(); })
  );

  on("messageInput", "focus", () => { setTimeout(() => { window.scrollTo(0, document.body.scrollHeight); const cv = $("chatView"); if (cv) cv.scrollTop = cv.scrollHeight; }, 300); });

  // Load older messages when scrolling near top (throttled)
  const _chatViewEl = $("chatView");
  if (_chatViewEl) {
    let _scrollThrottled = false;
    _chatViewEl.addEventListener("scroll", () => {
      if (_scrollThrottled) return;
      _scrollThrottled = true;
      setTimeout(() => { _scrollThrottled = false; }, 200);
      if (_chatViewEl.scrollTop > 80 || !state.hasMoreMessages || state.isLoadingMessages) return;
      fetchMessages(state.oldestMessageTime);
    }, { passive: true });
  }
  on("closeGroupSelectSheetBtn", "click", () => { hideEl("groupSelectSheet"); });
  on("mallSearchPageBtn", "click", () => { if (checkSearchCooldown('mallSearch')) doMallSearchPage(); });
  on("mallSearchPageInput", "keydown", (e) => { if (e.key === 'Enter') { e.preventDefault(); if (checkSearchCooldown('mallSearch')) doMallSearchPage(); } });
}

// Product publishing & management
function bindProductEvents() {
  // ---- Tag input (still used for adding new items inline) ----
  function initTagInput(wrapperId, inputId, onAdd) {
    const wrap = $(wrapperId); const input = $(inputId);
    if (!wrap || !input) return { getTags: () => [], setTags: () => {} };
    let tags = [];
    function render() {
      wrap.querySelectorAll('.tag-item').forEach(el => el.remove());
      tags.forEach((tag, i) => {
        const span = createEl('span', 'tag-item', tag);
        const btn = createEl('button', 'tag-item-remove', '\u00d7');
        btn.type = 'button';
        btn.addEventListener('click', (e) => { e.stopPropagation(); tags.splice(i, 1); render(); renderPresetChips(); });
        span.appendChild(btn);
        wrap.insertBefore(span, input);
      });
    }
    function addTag(text) {
      const t = text.trim();
      if (!t || tags.includes(t) || tags.length >= 12) return;
      tags.push(t);
      render();
      if (onAdd) onAdd(t);
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input.value); input.value = ''; }
      if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); render(); renderPresetChips(); }
    });
    input.addEventListener('blur', () => { if (input.value.trim()) { addTag(input.value); input.value = ''; } });
    wrap.addEventListener('click', () => input.focus());
    return {
      getTags: () => [...tags],
      setTags: (arr) => { tags = Array.isArray(arr) ? arr.filter(Boolean).slice(0, 12) : []; render(); },
      addTag,
      removeTag: (t) => { const i = tags.indexOf(t); if (i >= 0) { tags.splice(i, 1); render(); } }
    };
  }

  // ---- Preset chips: selectable category/spec presets ----
  let _categoryPresets = [];
  let _specPresets = [];

  async function loadProductPresets() {
    try {
      const res = await api('/api/product-presets');
      _categoryPresets = res.categoryPresets || [];
      _specPresets = res.specPresets || [];
    } catch (_) {}
  }

  async function saveProductPresets() {
    try {
      const res = await api('/api/product-presets/update', {
        method: 'POST',
        body: JSON.stringify({ categoryPresets: _categoryPresets, specPresets: _specPresets })
      });
      _categoryPresets = res.categoryPresets || _categoryPresets;
      _specPresets = res.specPresets || _specPresets;
    } catch (_) {}
  }

  function renderPresetChips() {
    const catWrap = $('categoryPresetChips');
    const specWrap = $('specPresetChips');
    if (catWrap) {
      const selectedCats = new Set(categoryTags.getTags());
      const catFrag = document.createDocumentFragment();
      _categoryPresets.forEach(cat => {
        const chip = createEl('button', 'preset-chip' + (selectedCats.has(cat) ? ' selected' : ''), cat);
        chip.type = 'button';
        chip.addEventListener('click', () => {
          if (selectedCats.has(cat)) categoryTags.removeTag(cat);
          else categoryTags.addTag(cat);
          renderPresetChips();
        });
        catFrag.appendChild(chip);
      });
      catWrap.replaceChildren(catFrag);
    }
    if (specWrap) {
      const selectedSpecs = new Set(specsTags.getTags());
      const specFrag = document.createDocumentFragment();
      _specPresets.forEach(spec => {
        const chip = createEl('button', 'preset-chip' + (selectedSpecs.has(spec) ? ' selected' : ''), spec);
        chip.type = 'button';
        chip.addEventListener('click', () => {
          if (selectedSpecs.has(spec)) specsTags.removeTag(spec);
          else specsTags.addTag(spec);
          renderPresetChips();
        });
        specFrag.appendChild(chip);
      });
      specWrap.replaceChildren(specFrag);
    }
  }

  // Add new tag via input also adds to presets
  const categoryTags = initTagInput('productCategoryTags', 'productCategoryInput', (t) => {
    if (!_categoryPresets.includes(t)) { _categoryPresets.push(t); saveProductPresets(); }
    renderPresetChips();
  });
  const specsTags = initTagInput('productSpecsTags', 'productSpecsInput', (t) => {
    if (!_specPresets.includes(t)) { _specPresets.push(t); saveProductPresets(); }
    renderPresetChips();
  });

  // ---- Preset Management Panel ----
  let _presetManageType = 'category'; // 'category' or 'spec'

  function openPresetManagePanel(type) {
    _presetManageType = type;
    if ($('presetManageTitle')) $('presetManageTitle').textContent = type === 'category' ? '管理分类' : '管理规格';
    if ($('presetManageInput')) { $('presetManageInput').value = ''; $('presetManageInput').placeholder = type === 'category' ? '输入新分类' : '输入新规格'; }
    renderPresetManageList();
    showEl('presetManagePanel');
  }

  // ---- Drag-to-reorder state ----
  let _dragState = null; // { startIdx, currentIdx, ghostEl, startY, rowHeight }

  function _getPresetArr() {
    return _presetManageType === 'category' ? _categoryPresets : _specPresets;
  }

  function _startDrag(e, idx, row) {
    const list = $('presetManageList');
    if (!list) return;
    const touch = e.touches ? e.touches[0] : e;
    const rect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    // Create ghost element
    const ghost = row.cloneNode(true);
    ghost.className = 'preset-manage-item preset-drag-ghost';
    ghost.style.width = rect.width + 'px';
    ghost.style.top = (rect.top - listRect.top + list.scrollTop) + 'px';
    list.style.position = 'relative';
    list.appendChild(ghost);
    row.classList.add('preset-drag-placeholder');
    _dragState = {
      startIdx: idx,
      currentIdx: idx,
      ghostEl: ghost,
      placeholderEl: row,
      startY: touch.clientY,
      ghostStartTop: rect.top - listRect.top + list.scrollTop,
      rowHeight: rect.height,
      listEl: list,
      listTop: listRect.top,
    };
    disableTextSelection();
  }

  function _moveDrag(e) {
    if (!_dragState) return;
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const dy = touch.clientY - _dragState.startY;
    _dragState.ghostEl.style.top = (_dragState.ghostStartTop + dy) + 'px';
    // Determine new index based on position
    const items = _getPresetArr();
    const centerY = touch.clientY - _dragState.listTop + _dragState.listEl.scrollTop;
    let newIdx = Math.round(centerY / _dragState.rowHeight);
    newIdx = Math.max(0, Math.min(items.length - 1, newIdx));
    if (newIdx !== _dragState.currentIdx) {
      // Move placeholder in DOM
      const rows = Array.from(_dragState.listEl.querySelectorAll('.preset-manage-item:not(.preset-drag-ghost)'));
      if (rows[newIdx]) {
        if (newIdx > _dragState.currentIdx) {
          rows[newIdx].after(_dragState.placeholderEl);
        } else {
          rows[newIdx].before(_dragState.placeholderEl);
        }
      }
      _dragState.currentIdx = newIdx;
    }
  }

  function _endDrag() {
    if (!_dragState) return;
    const { startIdx, currentIdx, ghostEl } = _dragState;
    ghostEl.remove();
    enableTextSelection();
    if (startIdx !== currentIdx) {
      const arr = _getPresetArr();
      const [moved] = arr.splice(startIdx, 1);
      arr.splice(currentIdx, 0, moved);
      saveProductPresets();
      renderPresetChips();
    }
    _dragState = null;
    renderPresetManageList();
  }

  function renderPresetManageList() {
    const list = $('presetManageList');
    if (!list) return;
    const items = _presetManageType === 'category' ? _categoryPresets : _specPresets;
    if (items.length === 0) {
      showEmptyState(list, '暂无项目，请在下方添加');
      return;
    }
    const _pmFrag = document.createDocumentFragment();
    items.forEach((item, i) => {
      const row = createEl('div', 'preset-manage-item');
      row.setAttribute('data-idx', i);
      const handle = createEl('span', 'preset-drag-handle', '☰');
      const textSpan = createEl('span', 'preset-manage-item-text', item);
      const editBtn = createEl('button', 'preset-manage-item-edit', '编辑');
      editBtn.type = 'button';
      const delBtn = createEl('button', 'preset-manage-item-del', '删除');
      delBtn.type = 'button';
      row.append(handle, textSpan, editBtn, delBtn);
      handle.addEventListener('mousedown', (e) => { e.preventDefault(); _startDrag(e, i, row); });
      handle.addEventListener('touchstart', (e) => { _startDrag(e, i, row); }, { passive: false });
      editBtn.addEventListener('click', () => {
        const textEl = textSpan;
        const inp = createEl('input', 'preset-manage-input');
        inp.value = item;
        inp.classList.add('preset-edit-input');
        textEl.replaceWith(inp);
        inp.focus();
        inp.select();
        const save = () => {
          const newName = inp.value.trim();
          if (!newName || newName === item) { renderPresetManageList(); return; }
          const arr = _presetManageType === 'category' ? _categoryPresets : _specPresets;
          if (arr.includes(newName)) { showModal('名称已存在'); renderPresetManageList(); return; }
          arr[i] = newName;
          saveProductPresets();
          renderPresetManageList();
          renderPresetChips();
        };
        inp.addEventListener('blur', save);
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } });
      });
      delBtn.addEventListener('click', () => {
        const arr = _presetManageType === 'category' ? _categoryPresets : _specPresets;
        arr.splice(i, 1);
        saveProductPresets();
        renderPresetManageList();
        renderPresetChips();
      });
      _pmFrag.appendChild(row);
    });
    list.replaceChildren(_pmFrag);
  }

  // Global drag event listeners
  document.addEventListener('mousemove', _moveDrag);
  document.addEventListener('mouseup', _endDrag);
  document.addEventListener('touchmove', _moveDrag, { passive: false });
  document.addEventListener('touchend', _endDrag);

  on('manageCategoryBtn', 'click', () => openPresetManagePanel('category'));
  on('manageSpecBtn', 'click', () => openPresetManagePanel('spec'));
  on('presetManageCloseBtn', 'click', () => hideEl('presetManagePanel'));
  if ($('presetManagePanel')) {
    $('presetManagePanel').querySelector('.preset-manage-mask')?.addEventListener('click', () => hideEl('presetManagePanel'));
  }
  on('presetManageAddBtn', 'click', () => {
    const input = $('presetManageInput');
    const val = input?.value.trim();
    if (!val) return;
    const arr = _presetManageType === 'category' ? _categoryPresets : _specPresets;
    if (arr.includes(val)) return showModal('该项已存在');
    arr.push(val);
    input.value = '';
    saveProductPresets();
    renderPresetManageList();
    renderPresetChips();
  });
  if ($('presetManageInput')) {
    $('presetManageInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('presetManageAddBtn')?.click(); }
    });
  }

  async function openPublishProductPage(backTo = 'home', presetProduct = null) {
    state.publishEditingProductId = presetProduct?.id || '';
    window.openSecondaryPage('publishProductPage', backTo);
    await loadProductPresets();
    if($("productTitleInput")) $("productTitleInput").value = presetProduct?.title || "";
    categoryTags.setTags(presetProduct?.category ? presetProduct.category.split(CATEGORY_SPLIT_RE).map(s => s.trim()).filter(Boolean) : []);
    if($("productDescInput")) {
      const baseDesc = String(presetProduct?.desc || '');
      $("productDescInput").value = baseDesc.replace(/\n?\[预计出餐\]\s*\d+分钟/g, "").trim();
    }
    if($("productPriceInput")) $("productPriceInput").value = presetProduct?.price || "";
    if($("productStockInput")) $("productStockInput").value = presetProduct?.stock || "";
    specsTags.setTags(Array.isArray(presetProduct?.specs) ? presetProduct.specs : []);
    renderPresetChips();
    if($("productImagePreview")) {
      if (presetProduct?.image || presetProduct?.imageUrl) setImagePreview($("productImagePreview"), presetProduct.image || presetProduct.imageUrl);
      else $("productImagePreview").textContent = "+";
    }
    if($("productImageInput")) $("productImageInput").value = "";
    state.tempProductImage = presetProduct?.image || presetProduct?.imageUrl || null;
    if($("submitProductBtn")){
      $("submitProductBtn").disabled = false;
      $("submitProductBtn").textContent = state.publishEditingProductId ? "保存" : "发布";
    }
    if ($("chatTitle")) $("chatTitle").textContent = state.publishEditingProductId ? '编辑商品' : '发布商品';
    setPublishProductHint(state.publishEditingProductId ? "修改后将同步到商品管理、发现和个人主页" : "可发布多个商品，买家可在你的主页直接多选下单", "muted");
  }

  on("publishProductEntryBtn", "click", () => { openPublishProductPage('mall'); });

  // Mall location refresh
  on("mallLocationRefreshBtn", "click", () => { refreshUserLocation(); });

  // Mall tab switching
  if ($("mallTabs")) $("mallTabs").addEventListener("click", (e) => {
    const tab = e.target.closest('.mall-tab');
    if (!tab || !tab.dataset.mallTab) return;
    e.currentTarget.querySelectorAll('.mall-tab.active').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.mallTab = tab.dataset.mallTab;
    state.mallListSignature = '';
    loadMall();
  });
  on("sellerProductsPublishBtn", "click", () => { openPublishProductPage('sellerProductsPage'); });
  on("productImagePreview", "click", () => { if($("productImageInput")) $("productImageInput").click(); });
  
  on("productImageInput", "change", async () => {
      const file = $("productImageInput").files?.[0]; if (!file) return;
      $("productImageInput").value = "";
      if($("submitProductBtn")) $("submitProductBtn").disabled = true;
      try {
          $("productImagePreview").textContent = "上传中...";
          setPublishProductHint('图片上传中，请稍候…');
          const blob = await resizeImageFile(file, 800, 0.7);
          state.tempProductImage = await uploadBinary(blob, file.name || 'product.jpg', 'image/jpeg');
          setImagePreview($("productImagePreview"), state.tempProductImage);
          setPublishProductHint('图片上传完成，可发布商品');
      } catch (err) {
          state.tempProductImage = null;
          $("productImagePreview").textContent = "+";
          setPublishProductHint('图片上传失败，请重试', 'error');
          showModal('商品图片上传失败: ' + err.message);
      } finally {
          if($("submitProductBtn")) $("submitProductBtn").disabled = false;
      }
  });

  on("submitProductBtn", "click", async () => {
      const title = $("productTitleInput").value.trim();
      const categoryArr = categoryTags.getTags();
      const category = categoryArr.join('/');
      const desc = $("productDescInput").value.trim();
      const stockVal = $("productStockInput")?.value || '';
      const stock = Math.floor(Number(stockVal));
      const specs = specsTags.getTags();
      const price = $("productPriceInput").value.trim();
      const parsedPrice = parseMoney(price);
      if(title.length < 2){ setPublishProductHint('商品名称至少 2 个字', 'error'); return; }
      if(categoryArr.length < 1){ setPublishProductHint('请添加至少一个分类标签', 'error'); return; }
      if(parsedPrice <= 0){ setPublishProductHint('请输入有效售价', 'error'); return; }
      if(!Number.isFinite(stock) || stock <= 0){ setPublishProductHint('请输入有效库存（至少1）', 'error'); return; }
      if(!state.tempProductImage){ setPublishProductHint('请先上传商品图片', 'error'); return; }
      if($("submitProductBtn")){ $("submitProductBtn").disabled = true; $("submitProductBtn").textContent = state.publishEditingProductId ? "更新中..." : "发布中..."; }
      setPublishProductHint(state.publishEditingProductId ? '正在更新商品…' : '正在发布商品…');
      try {
          const payload = { userId: state.currentUser.id, title, category, desc, stock, specs, price: parsedPrice, image: state.tempProductImage };
          if (state.publishEditingProductId) {
            const updateResult = await api('/api/products/update', { method: 'POST', body: JSON.stringify({ ...payload, productId: state.publishEditingProductId }) });
            if (updateResult.autoDelisted) {
              setPublishProductHint('价格或图片变更，商品已自动下架，请确认后手动上架', 'warning');
              showModal("商品已更新！因价格或图片变更，商品已自动下架，请在商品管理中重新上架。");
            } else {
              setPublishProductHint('商品已更新，展示页已同步', 'success');
              showModal("商品已更新！");
            }
          } else {
            await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
            setPublishProductHint('发布成功，商品已展示在个人主页', 'success');
            showModal("发布成功！");
          }
          await refreshProductViews();
          state.publishEditingProductId = '';
          if (state.secondaryReturn === 'sellerProductsPage') {
            window.openSecondaryPage('sellerProductsPage', 'sellerCenterPage', { replace: true });
          } else if($("backBtn")) {
            $("backBtn").click();
          }
      } catch(e) {
          setPublishProductHint(e.message || '操作失败，请稍后再试', 'error');
          showModal(e.message);
      } finally {
          if($("submitProductBtn")){
            $("submitProductBtn").disabled = false;
            $("submitProductBtn").textContent = state.publishEditingProductId ? "保存" : "发布";
          }
      }
  });

  on("productTitleInput", "input", () => setPublishProductHint(''));
  on("productPriceInput", "input", () => setPublishProductHint(''));
  on("productStockInput", "input", () => {
    const el = $("productStockInput"); if (!el) return;
    el.value = el.value.replace(/[^0-9]/g, '');
  });
}

// Profile, avatar, tabs, payments
function bindProfileEvents() {
  on("editAvatarPreview", "click", () => { if($("editAvatarInput")) $("editAvatarInput").click(); });
  on("editAvatarInput", "change", async () => {
      const file = $("editAvatarInput").files?.[0]; if (!file) return;
      $("editAvatarInput").value = "";
      try {
          $("editAvatarPreview").textContent = "上传中...";
          const blob = await resizeImageFile(file, 150, 0.7);
          state.tempAvatarUrl = await uploadBinary(blob, file.name || 'avatar.jpg', 'image/jpeg');
          setImagePreview($("editAvatarPreview"), state.tempAvatarUrl, firstChar(state.currentUser?.displayName));
      } catch (err) {
          state.tempAvatarUrl = state.currentUser?.avatarUrl || null;
          setImagePreview($("editAvatarPreview"), state.tempAvatarUrl, firstChar(state.currentUser?.displayName));
          showModal('头像上传失败: ' + err.message);
      }
  });
  
  on("myProfileCard", "click", () => { 
      if(!state.currentUser) return; window.openSecondaryPage('editProfilePage');
      $("editNameInput").value = state.currentUser.displayName || ''; $("editSignatureInput").value = state.currentUser.signature || '';
      setText("editAppIdDisplay", state.currentUser.appNumberId || '-');
      setText("editPhoneDisplay", state.currentUser.phone || '未绑定');
      state.tempAvatarUrl = state.currentUser.avatarUrl || null;
      if (state.tempAvatarUrl) setImagePreview($("editAvatarPreview"), state.tempAvatarUrl, firstChar(state.currentUser?.displayName));
      else $("editAvatarPreview").textContent = firstChar(state.currentUser.displayName);
  });

  on("saveProfileBtn", "click", () => {
      const name = $("editNameInput").value.trim(); const sign = $("editSignatureInput").value.trim();
      if(!name) return showModal("名字不能为空");
      withButtonLock($("saveProfileBtn"), async () => {
          const data = await api('/api/users/update', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, displayName: name, signature: sign, avatarUrl: state.tempAvatarUrl }) });
          state.currentUser = data.user || state.currentUser; writeSession(state.currentUser); showModal("资料修改成功！");
          setText("profileDisplayName", state.currentUser.displayName);
          if($("myProfileAvatar")) {
              if(state.currentUser.avatarUrl) setImagePreview($("myProfileAvatar"), state.currentUser.avatarUrl, firstChar(state.currentUser.displayName));
              else $("myProfileAvatar").textContent = firstChar(state.currentUser.displayName);
          }
          if($("backBtn")) $("backBtn").click();
      }, '保存中...');
  });

  on("messagesTab", "click", () => setMainTab('messages'));
  on("friendsTab", "click", () => setMainTab('friends'));
  on("mallTab", "click", () => setMainTab('mall'));
  on("profileTab", "click", () => setMainTab('profile'));

  on("sidebarToggleBtn", "click", cycleSidebarMode);
  try {
    const saved = localStorage.getItem('chatSidebarMode');
    if (saved === 'expanded' || saved === 'collapsed' || saved === 'hidden') state.sidebarMode = saved;
  } catch(_) {}
  applySidebarMode();

  on("backBtn", "click", () => {
    try { stopScanCamera(); } catch(_) {}
      const backTo = state.secondaryReturn;
      state.secondaryPage = null; state.secondaryReturn = null;
      SECONDARY_PAGE_IDS.forEach(id => hideEl(id));
      // Pop from navigation stack to restore previous secondary page with its original backTo
      if (state.secondaryStack.length > 0) {
          const prev = state.secondaryStack.pop();
          state.secondaryPage = prev.page; state.secondaryReturn = prev.backTo;
          hideAllViews();
          showEl(prev.page);
          showEl("backBtn");
          hideEl("homeMoreBtn");
          hideEl("chatSettingsBtn");
          hideEl("sidebarToggleBtn");
          toggleEl("sidebarPanel", "sidebar-tab-hidden", true);
          return;
      }
      if (backTo === 'chat' && state.activeConversation) {
          showEl("backBtn");
          showEl("chatView");
          showEl("composerPanel");
          setText("chatTitle", state.conversationsById?.get(state.activeConversation.id)?.title || '会话');
          showEl("chatSettingsBtn");
          // restore sidebar when returning to conversation
          showEl("sidebarToggleBtn");
          toggleEl("sidebarPanel", "sidebar-tab-hidden", false);
          return;
      }
      state.activeConversation = null;
      state.chatListSignature = '';
      state.conversationItemSignatures = {};
      renderConversationListFromState();
      hideEl("chatView"); hideEl("composerPanel"); hideEl("chatSearchBar");
      showEl("homeTabbar"); hideEl("backBtn"); hideEl("chatSettingsBtn");
      const activeTab = document.querySelector('.tab-item.active');
      if(activeTab) {
          if(activeTab.id === 'messagesTab') setMainTab('messages'); else if(activeTab.id === 'friendsTab') setMainTab('friends'); else if(activeTab.id === 'mallTab') setMainTab('mall'); else if(activeTab.id === 'profileTab') setMainTab('profile');
      } else { setMainTab('messages'); }
  });

  on("logoutBtn", "click", () => { showConfirm("确定要退出登录吗？", async () => { nativeOnLogout(state.currentUser?.id); try { await api('/api/logout', { method: 'POST' }); } catch (e) { console.warn('logout api failed, fallback to local logout', e); } localStorage.removeItem(SESSION_KEY); localStorage.removeItem(CART_STORAGE_KEY); state.profileCartBySeller = {}; location.reload(); }); });
  on("clearCacheBtn", "click", () => { showConfirm("确定清理本地缓存吗？", () => { localStorage.clear(); location.reload(); }); });
  on("openSettingsBtn", "click", () => { window.openSecondaryPage('settingsPage', 'profile'); });
  on("globalNotifyBtn", "click", () => { showModal("新消息通知目前跟随系统默认设置开启"); });
  on("myQrCodeBtn", "click", () => { window.openSecondaryPage("qrCodePage", "profile"); if($("myQrCodeImg")) $("myQrCodeImg").src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(state.currentUser.appNumberId)}`; setText("myQrCodeIdTxt", `ID: ${state.currentUser.appNumberId}`); });
  on("myProductsBtn", "click", () => { window.openSecondaryPage('myProductsPage', 'profile'); loadMyProducts(); });
  on("myBuyerOrdersBtn", "click", async () => { await loadBuyerOrders(); window.openSecondaryPage('buyerOrdersManagePage', 'profile'); });
  on("sellerCenterBtn", "click", async () => {
    await Promise.all([loadSellerOrders(), loadBuyerOrders()]);
    await loadSellerProductsManage();
    const hero = document.querySelector('#sellerCenterPage .seller-center-hero span');
    if (hero) hero.textContent = `卖家订单 ${state.sellerOrders.length} / 买家订单 ${state.buyerOrders.length} / 商品 ${state.sellerProducts.length}`;
    window.openSecondaryPage('sellerCenterPage', 'profile');
  });
  on("sellerOrderManageBtn", "click", async () => { await loadSellerOrders(); window.openSecondaryPage('sellerOrdersPage', 'sellerCenterPage'); });
  [['buyer', renderBuyerOrdersManage], ['seller', renderSellerOrdersManage]].forEach(([role, renderFn]) => {
    const cap = role.charAt(0).toUpperCase() + role.slice(1);
    on(`${role}OrdersSearchInput`, "input", () => { state[`${role}OrderSearch`] = $(`${role}OrdersSearchInput`)?.value?.trim() || ''; renderFn(); });
    on(`${role}OrdersFromBtn`, "click", () => { openDatePicker(role, 'from', state[`${role}OrderFrom`]); });
    on(`${role}OrdersToBtn`, "click", () => { openDatePicker(role, 'to', state[`${role}OrderTo`]); });
    on(`${role}OrdersClearFilterBtn`, "click", () => { state[`${role}OrderSearch`]=''; state[`${role}OrderFrom`]=''; state[`${role}OrderTo`]=''; renderFn(); });
    on(`${role}FilterToggleBtn`, "click", () => { const d = $(`${role}FilterDrawer`); if(d) d.classList.toggle('open'); $(`${role}FilterToggleBtn`)?.classList.toggle('active'); });
    on(`${role}OrdersRangePresets`, "click", (e) => {
      const btn = e.target.closest('.order-filter-chip');
      if (!btn) return;
      const days = Number(btn.dataset.range || 0);
      if (!days) return;
      applyOrderQuickRange(role, days);
    });
  });
  // Date picker confirm/cancel
  on("datePickerConfirmBtn", "click", () => closeDatePicker(true));
  on("datePickerCancelBtn", "click", () => closeDatePicker(false));
  on("datePickerOverlay", "click", (e) => { if (e.target === $("datePickerOverlay")) closeDatePicker(false); });
  on("sellerProductManageBtn", "click", async () => { await loadSellerProductsManage(); window.openSecondaryPage('sellerProductsPage', 'sellerCenterPage'); });
  on("sellerProductsListedTab", "click", () => { state.sellerProductViewTab = 'listed'; renderSellerProductsManage(); });
  on("sellerProductsUnlistedTab", "click", () => { state.sellerProductViewTab = 'unlisted'; renderSellerProductsManage(); });
  on("sellerProductsSearchInput", "input", () => {
    state.sellerProductSearch = $("sellerProductsSearchInput")?.value?.trim() || '';
    renderSellerProductsManage();
  });
  on("sellerProductsCategoryFilter", "change", () => {
    state.sellerProductCategoryFilter = $("sellerProductsCategoryFilter")?.value || '';
    renderSellerProductsManage();
  });
  on("sellerProductsSortSelect", "change", () => {
    state.sellerProductSort = $("sellerProductsSortSelect")?.value || 'newest';
    renderSellerProductsManage();
  });
  on("productDetailOpenSellerBtn", "click", async () => {
    await loadSellerProductsManage();
    window.openSecondaryPage('sellerProductsPage', 'sellerCenterPage');
  });

  // Seller action buttons on product detail page
  on("productDetailEditBtn", "click", () => {
    const item = state.selectedProductDetail;
    if (!item) return;
    openPublishProductPage('productDetailPage', item);
  });
  on("productDetailStockBtn", "click", () => {
    const item = state.selectedProductDetail;
    if (!item) return;
    window.updateSellerProductStock(item.id, item.stock || 0);
  });
  on("productDetailListedBtn", "click", async () => {
    const item = state.selectedProductDetail;
    if (!item) return;
    const nextListed = item.listed === false;
    await window.toggleSellerProductListed(item.id, nextListed);
    // Update the in-memory detail so the button reflects the new state
    state.selectedProductDetail.listed = nextListed;
    if ($("productDetailListedBtn")) {
      $("productDetailListedBtn").textContent = nextListed ? '下架' : '上架';
      $("productDetailListedBtn").className = 'sp-action-btn' + (!nextListed ? ' accent' : '');
    }
  });
  on("productDetailDeleteBtn", "click", async () => {
    const item = state.selectedProductDetail;
    if (!item) return;
    await window.deleteMyProduct(item.id);
    if ($("backBtn")) $("backBtn").click();
  });

  function renderSellerPaymentDraft(){
    const draft = state.paymentCodeDraft || { wechat:'', alipay:'', cloudpay:'' };
    setImagePreview($("sellerWxPayPreview"), draft.wechat, '+');
    setImagePreview($("sellerAliPayPreview"), draft.alipay, '+');
    setImagePreview($("sellerCloudPayPreview"), draft.cloudpay, '+');
  }

  async function uploadSellerPaymentCode(kind, file){
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (!allowedTypes.includes(file.type)) return showModal('请上传图片文件（JPG/PNG/GIF/WebP）');
    if (file.size > 5 * 1024 * 1024) return showModal('图片大小不能超过5MB');
    try {
      const blob = await resizeImageFile(file, 1000, 0.8);
      const url = await uploadBinary(blob, file.name || `${kind}_qrcode.jpg`, 'image/jpeg');
      state.paymentCodeDraft = { ...(state.paymentCodeDraft || {}), [kind]: url };
      renderSellerPaymentDraft();
      showToast('收款码上传成功');
    } catch (e) {
      showModal(e.message || '收款码上传失败');
    }
  }

  on("sellerPaymentManageBtn", "click", () => {
    const codes = state.currentUser?.paymentCodes || {};
    state.paymentCodeDraft = {
      wechat: codes.wechat || '',
      alipay: codes.alipay || '',
      cloudpay: codes.cloudpay || '',
    };
    renderSellerPaymentDraft();
    window.openSecondaryPage('sellerPaymentPage', 'sellerCenterPage');
  });
  [['WxPay','wechat'],['AliPay','alipay'],['CloudPay','cloudpay']].forEach(([prefix, key]) => {
    const uploadBtnId = `seller${prefix}UploadBtn`, fileInputId = `seller${prefix}FileInput`;
    on(uploadBtnId, "click", () => { $(fileInputId)?.click(); });
    on(fileInputId, "change", async () => {
      const file = $(fileInputId)?.files?.[0];
      if($(fileInputId)) $(fileInputId).value = '';
      await uploadSellerPaymentCode(key, file);
    });
  });
  on("saveSellerPaymentBtn", "click", () => {
    const paymentCodes = {
      wechat: state.paymentCodeDraft?.wechat || '',
      alipay: state.paymentCodeDraft?.alipay || '',
      cloudpay: state.paymentCodeDraft?.cloudpay || '',
    };
    if (!paymentCodes.wechat && !paymentCodes.alipay && !paymentCodes.cloudpay) return showModal('请至少上传一个收款码');
    withButtonLock($("saveSellerPaymentBtn"), async () => {
      const data = await api('/api/users/update', { method:'POST', body: JSON.stringify({ userId: state.currentUser.id, paymentCodes }) });
      state.currentUser = data.user || state.currentUser;
      writeSession(state.currentUser);
      showModal('收款码已保存');
      window.openSecondaryPage('sellerCenterPage', state.secondaryReturn || 'profile');
    }, '保存中...');
  });
}

// Privacy, blacklist, friends, chat settings
function bindSocialEvents() {
  on("privacySettingsBtn", "click", async () => {
      window.openSecondaryPage('privacyPage', 'settingsPage');
      try {
          const data = await api(`/api/blacklist?userId=${encodeURIComponent(state.currentUser.id)}`);
          const list = $("blacklistContainer"); if(!list) return;
          const blacklist = data.users || data.blacklist || [];
          if(blacklist.length === 0) { showEmptyState(list, '黑名单为空'); }
          else {
            list.replaceChildren();
            blacklist.forEach((u) => {
              const row = createEl('div', 'chat-item');
              appendUserInfo(row, u, u.displayName || '');
              const btn = createEl('button', 'primary-btn');
              btn.style.background = '#ff3b30';
              btn.textContent = '移出';
              btn.addEventListener('click', () => window.removeFromBlacklist(u.id));
              row.appendChild(btn);
              list.appendChild(row);
            });
          }
      } catch(e){
        console.warn('load blacklist failed', e);
        showModal(e?.message || '加载黑名单失败');
      }
  });
  
  on("chatSettingsBtn", "click", () => {
      if(!$("profileDetailPage")?.classList.contains("hidden")) { showProfileActionSheet(); return; }
      if(!state.activeConversation) { showModal('当前没有打开会话'); return; }
      window.openSecondaryPage("messageSettingsPage", "chat");
      const profileCard = $("chatSettingsPeerProfile");
      const peerId = conversationPeerId(state.activeConversation);
      if(!profileCard) return;
      profileCard.replaceChildren();
      profileCard.onclick = null;
      profileCard.style.opacity = '0.5';
      if(!peerId) {
        const hint = createEl('div', '', '当前会话暂无可查看的用户资料');
        hint.style.cssText = 'padding:12px 0; color:var(--text-muted); font-size:14px;';
        profileCard.appendChild(hint);
        return;
      }
      const friend = findFriendEntry(peerId);
      const userObj = friend ? friend.friend : { displayName: state.activeConversation?.title || state.conversationsById?.get(state.activeConversation?.id)?.title || '未知用户', avatarUrl: state.activeConversation?.peerAvatarUrl || null };
      const finalName = userObj.remark || userObj.displayName || '未知用户';
      profileCard.style.opacity = '';
      const info = appendUserInfo(profileCard, userObj, finalName);
      info.querySelector('strong').style.fontSize = '18px';
      profileCard.onclick = () => window.openUserProfile(peerId, finalName);
  });

  const toggleAction = async (action) => {
    if(!state.activeConversation) return null;
    try {
      const res = await api(`/api/conversations/${state.activeConversation.id}/${action}`, { method:'POST', body: JSON.stringify({userId: state.currentUser.id}) });
      const conv = state.conversationsById?.get(state.activeConversation?.id);
      if (action === 'mute') {
        const nextMuted = Boolean(res?.muted);
        if (state.activeConversation) state.activeConversation.muted = nextMuted;
        if (conv) conv.muted = nextMuted;
        const cid = state.activeConversation?.id;
        if (cid && state.mutedConvIds) { nextMuted ? state.mutedConvIds.add(cid) : state.mutedConvIds.delete(cid); }
      } else if (action === 'pin') {
        const nextPinned = Boolean(res?.pinned);
        if (state.activeConversation) state.activeConversation.pinned = nextPinned;
        if (conv) conv.pinned = nextPinned;
        const cid = state.activeConversation?.id;
        if (cid && state.pinnedConvIds) { nextPinned ? state.pinnedConvIds.add(cid) : state.pinnedConvIds.delete(cid); }
      } else if (action === 'clear') {
        const now = Number(res?.clearedAt) || Date.now();
        if (state.activeConversation) {
          state.activeConversation.clearedAt = now;
          state.activeConversation.preview = '';
          state.activeConversation.lastMessageAt = now;
        }
        if (conv) {
          conv.clearedAt = now;
          conv.preview = '';
          conv.unread = 0;
          conv.lastMessageAt = now;
        }
      }
      return res || { ok: true };
    } catch(e) {
      showModal(e.message || '操作失败');
      return null;
    }
  };
  on("muteSettingBtn", "click", async () => {
    const res = await toggleAction('mute');
    if (!res) return;
    showModal(res.muted ? '已开启免打扰' : '已关闭免打扰');
    setText("muteSettingBtn", res.muted ? '取消免打扰' : '消息免打扰');
    refreshConversations();
  });
  on("pinConversationBtn", "click", async () => {
    const res = await toggleAction('pin');
    if (!res) return;
    showModal(res.pinned ? '已置顶会话' : '已取消置顶');
    setText("pinConversationBtn", res.pinned ? '取消置顶' : '置顶聊天');
    refreshConversations();
  });
  on("clearChatBtn", "click", () => {
    showConfirm("确认清空聊天记录？", async () => {
      const res = await toggleAction('clear');
      if (!res) return;
      showModal('聊天记录已清空');
      state.messages = [];
      state.messagesById = new Map();
      _messagesSig = '';
      state.messageBefore = null;
      renderMessages();
      applyLastOutgoingReadState();
      state.chatListSignature = '';
      renderConversationListFromState();
      loadConversations();
    });
  });

  async function doAddBlacklist(targetId) {
    showLoading('处理中...');
    try {
      await api('/api/blacklist', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, targetId, action: 'add' }) });
      showModal('已加入黑名单');
      loadFriends().catch(() => {});
      loadConversations().catch(() => {});
    } catch(e) { showModal(e?.message || '加入黑名单失败');
    } finally { hideLoading(); }
  }
  on("blacklistBtn", "click", () => {
      const peerId = conversationPeerId(state.activeConversation);
      if(!peerId) return showModal('未找到会话对象');
      showConfirm("确定把他加入黑名单吗？加入后将拒收他的消息。", async () => {
        await doAddBlacklist(peerId);
        if($("backBtn")) $("backBtn").click();
      });
  });
  on("deleteFriendBtn", "click", () => {
      showConfirm("确定删除好友并清空聊天记录?", async () => {
        const peerId = conversationPeerId(state.activeConversation);
        if(!peerId) return showModal('未找到会话对象');
        showLoading('删除中...');
        try {
          await api('/api/friends/delete', { method:'POST', body: JSON.stringify({userId: state.currentUser.id, friendId: peerId}) });
          state.friends = (state.friends || []).filter((item) => item.friend?.id !== peerId);
          if (state.friendsById) state.friendsById.delete(peerId);
          showModal('好友已删除');
          await Promise.all([loadFriends(), loadConversations()]);
          $("backBtn")?.click();
        } catch(e) { showModal(e.message || '删除失败'); } finally { hideLoading(); }
      });
  });

  on("homeMoreBtn", "click", () => { showEl("plusMenuSheet"); });
  on("closePlusMenuBtn", "click", () => { hideEl("plusMenuSheet"); });
  on("menuAddFriend", "click", () => { hideEl("plusMenuSheet"); window.openSecondaryPage('addFriendPage'); setText("myProfileIdDisplay", state.currentUser.appNumberId || state.currentUser.username); });
  on("menuScan", "click", () => { hideEl("plusMenuSheet"); window.openSecondaryPage('scanPage'); });

  // Search for user first, then show preview card
  on("doSearchFriendBtn", "click", async () => {
    const keyword = $("addFriendSearchInput")?.value.trim();
    if (!keyword) return showModal("请输入手机号、ID号或用户名");
    const btn = $("doSearchFriendBtn");
    const resultEl = $("addFriendResult");
    const emptyEl = $("addFriendEmpty");
    if (btn) { btn.disabled = true; btn.textContent = '搜索中...'; }
    if (resultEl) resultEl.classList.add('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    try {
      const res = await api(`/api/users/search?keyword=${encodeURIComponent(keyword)}`);
      const user = res.user;
      if (!user || !resultEl) return;
      // Check if already friends
      const isFriend = (state.friends || []).some(f => f.friendId === user.id || f.userId === user.id);
      const card = createEl('div', 'add-friend-card');
      const cardTop = createEl('div', 'add-friend-card-top');
      const avatarDiv = createEl('div', 'add-friend-avatar');
      if (user.avatarUrl) {
        const avatarImg = createEl('img');
        avatarImg.src = user.avatarUrl;
        avatarImg.alt = '';
        avatarDiv.appendChild(avatarImg);
      } else {
        avatarDiv.style.background = '#07c160';
        avatarDiv.textContent = firstChar(user.displayName);
      }
      const infoDiv = createEl('div', 'add-friend-info');
      infoDiv.append(
        createEl('div', 'add-friend-name', user.displayName),
        createEl('div', 'add-friend-meta', `ID: ${user.appNumberId || ''}${user.role === 'seller' ? ' · 商家' : ''}`)
      );
      cardTop.append(avatarDiv, infoDiv);
      card.appendChild(cardTop);
      if (user.signature) card.appendChild(createEl('div', 'add-friend-sig', user.signature));
      const actionsDiv = createEl('div', 'add-friend-actions');
      const addBtn = createEl('button', `add-friend-add-btn${isFriend ? ' already' : ''}`, isFriend ? '已是好友' : '添加好友');
      addBtn.type = 'button';
      addBtn.id = 'addFriendSendBtn';
      addBtn.dataset.uid = user.id;
      addBtn.dataset.uname = user.username;
      if (isFriend) addBtn.disabled = true;
      actionsDiv.appendChild(addBtn);
      card.appendChild(actionsDiv);
      resultEl.replaceChildren(card);
      resultEl.classList.remove('hidden');
    } catch(e) {
      if (emptyEl) {
        const emptyText = $("addFriendEmptyText");
        if (emptyText) emptyText.textContent = e.message || '未找到该用户';
        emptyEl.classList.remove('hidden');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '搜索'; }
    }
  });
  on("addFriendSearchInput", "keydown", (e) => { if (e.key === 'Enter') $("doSearchFriendBtn")?.click(); });
  // Send friend request from preview card
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('#addFriendSendBtn');
    if (!addBtn || addBtn.disabled) return;
    const uname = addBtn.dataset.uname;
    showPrompt('打个招呼吧', `你好，我是${state.currentUser.displayName}`, async (greeting) => {
      addBtn.disabled = true;
      addBtn.textContent = '发送中...';
      try {
        await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendUsername: uname, greeting }) });
        showModal('好友请求已发送');
        addBtn.textContent = '已发送';
        addBtn.classList.add('already');
        refreshFriendRequestState();
      } catch(e) {
        addBtn.disabled = false;
        addBtn.textContent = '添加好友';
        showModal(e.message || '发送失败');
      }
    });
  });
  const submitScanRequest = async () => {
      const keyword = ($("scanIdInput")?.value || '').trim(); if (!keyword) return showModal('请输入对方 ChatTrade ID');
      try {
        const res = await api(`/api/users/search?keyword=${encodeURIComponent(keyword)}`);
        const user = res.user;
        if (!user || !user.id) return showModal('未找到该用户');
        if($("scanIdInput")) $("scanIdInput").value = '';
        if($("backBtn")) $("backBtn").click();
        await window.openUserProfile(user.id, user.displayName);
      } catch(e) { showModal(e.message || '未找到该用户'); }
  };
  on("toggleManualScanBtn", "click", () => {
    toggleEl("scanManualPanel", 'hidden');
    if(!$("scanManualPanel")?.classList.contains('hidden') && $("scanIdInput")) $("scanIdInput").focus();
  });
  on("startCameraScanBtn", "click", startScanCamera);
  on("scanFromAlbumBtn", "click", () => {
    const input = $('scanCaptureInput');
    if (input) { input.removeAttribute('capture'); input.value = ''; input.click(); }
  });
  on("scanMyQrBtn", "click", () => {
    window.openSecondaryPage("qrCodePage", "scanPage");
    if($("myQrCodeImg")) $("myQrCodeImg").src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${state.currentUser.appNumberId}`;
    setText("myQrCodeIdTxt", `ID: ${state.currentUser.appNumberId}`);
  });
  on("scanCaptureInput", "change", async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    const ok = await decodeScanFromImageFile(file);
    if (!ok) {
      showEl("scanManualPanel");
      if($("scanIdInput")) $("scanIdInput").focus();
      showModal('未能识别二维码，请手动输入 ChatTrade ID');
    }
  });
  on("scanSubmitBtn", "click", submitScanRequest);
  on("scanIdInput", "keydown", (e) => { if (e.key === 'Enter') submitScanRequest(); });

}

// Cart, spec sheets, product editor
function bindShoppingEvents() {
  on("profileAddFriendBtn", "click", () => sendFriendRequestToCurrentProfile());
  on("profileSendMessageBtn", "click", async () => {
    const p = state.currentProfileUser;
    if(!p || !p.id || !state.currentUser) return;
    try {
      await window.openPrivateChat(p.id);
    } catch(e) {
      showModal(e.message || '打开会话失败');
    }
  });
    on("myCartEntryBtn", "click", () => {
    renderCartHubPage();
    window.openSecondaryPage('cartHubPage', 'home');
  });
  on("openProfileCartBtn", "click", () => {
    renderProfileCartPage();
    window.openSecondaryPage('profileCartPage', state.secondaryReturn || (state.activeConversation ? 'chat' : 'home'));
  });
  on("submitProfileOrderBtn", "click", submitProfileOrder);
  on("orderDetailAcceptBtn", "click", async () => {
    const order = state.selectedOrderDetail;
    if(!order?.id) return;
    try{
      const data = await doAcceptOrder(order.id);
      state.selectedOrderDetail = data.order || order;
      renderOrderDetailPage();
      showToast('已接单');
    }catch(e){ showModal(e.message || '接单失败'); }
  });
  on("orderDetailEditPriceBtn", "click", updateSelectedOrderPrice);
  on("orderDetailPriceRequestBtn", "click", () => {
    const order = state.selectedOrderDetail;
    if(!order?.id) return;
    showPrompt('申请改价金额', String(order.total || ''), async (raw) => {
      try{
        const data = await api(`/api/orders/${order.id}/price-request`, { method:'POST', body: JSON.stringify({ total: parseMoney(raw) }) });
        state.selectedOrderDetail = data.order || order;
        await refreshAllOrderData();
        renderOrderDetailPage();
      }catch(e){ showModal(e.message || '申请失败'); }
    });
  });
  on("orderDetailCompleteBtn", "click", completeSelectedOrder);
  on("orderDetailChatBtn", "click", async () => {
    const order = state.selectedOrderDetail;
    if(!order) return;
    const role = state.selectedOrderRole || 'buyer';
    const peerId = role === 'buyer' ? order.sellerId : order.buyerId;
    if(!peerId) return;
    try { await window.openPrivateChat(peerId); } catch(e) { showModal(e.message || '打开会话失败'); }
  });
  on("closeSpecSheetBtn", "click", closeProductSpecSheet);
  on("confirmAddToCartBtn", "click", addSelectedProductToCart);
  on("confirmBuyNowBtn", "click", buyNowAndCheckout);
  // Backdrop click to close spec sheet
  if ($("productSpecSheet")) {
    $("productSpecSheet").addEventListener("click", (e) => {
      if (e.target === $("productSpecSheet")) closeProductSpecSheet();
    });
  }
  // Quantity stepper in spec sheet
  on("specSheetQtyMinus", "click", () => {
    const item = state.selectedProfileProduct;
    if (!item) return;
    state.specSheetQty = Math.max(1, (state.specSheetQty || 1) - 1);
    if ($("specSheetQtyNum")) $("specSheetQtyNum").textContent = String(state.specSheetQty);
    if ($("specSheetQtyMinus")) $("specSheetQtyMinus").disabled = state.specSheetQty <= 1;
  });
  on("specSheetQtyPlus", "click", () => {
    const item = state.selectedProfileProduct;
    if (!item) return;
    const availableStock = getItemAvailableStock(item);
    const inCartQty = getProfileStoreItemCartQuantity(item);
    if ((state.specSheetQty || 1) + inCartQty >= availableStock) {
      showToast('库存不足');
      return;
    }
    state.specSheetQty = (state.specSheetQty || 1) + 1;
    if ($("specSheetQtyNum")) $("specSheetQtyNum").textContent = String(state.specSheetQty);
    if ($("specSheetQtyMinus")) $("specSheetQtyMinus").disabled = false;
  });
  on("saveProductEditorBtn", "click", () => {
    showModal('商品草稿已保存');
    if($("productEditorTitle")) $("productEditorTitle").value = '';
    if($("productEditorPrice")) $("productEditorPrice").value = '';
    if($("productEditorDesc")) $("productEditorDesc").value = '';
  });
}

// Broadcast & profile actions
function bindBroadcastEvents() {
  on("createBroadcastBtn", "click", () => {
    if($("broadcastTitleInput")) $("broadcastTitleInput").value = '';
    if($("broadcastSummaryInput")) $("broadcastSummaryInput").value = '';
    if($("broadcastTargetInput")) $("broadcastTargetInput").value = '';
    window.openSecondaryPage('broadcastEditorPage', 'broadcastManagePage');
  });
  on("saveBroadcastDraftBtn", "click", saveBroadcastDraft);
  on("sendBroadcastNowBtn", "click", () => {
    const draft = state.selectedBroadcastDraft;
    if(!draft) return showModal('请先选择一条广播');
    const title = draft.title || '广播通知';
    const summary = draft.summary || '';
    withButtonLock($("sendBroadcastNowBtn"), async () => {
      await window.sendMessage({ type: 'broadcast_card', broadcast: { title, summary, cover: '' } });
      showToast('广播已发送');
      if($("backBtn")) $("backBtn").click();
    }, '发送中...');
  });

  on("profileMoreBtn", "click", () => showProfileActionSheet());
  on("profileStoreMoreBtn", "click", () => { state.profileStoreExpanded = !state.profileStoreExpanded; renderProfileStore(); });
  on("closeProfileActionSheetBtn", "click", hideProfileActionSheet);
  on("profileActionSheet", "click", (e) => { if(e.target === $("profileActionSheet")) hideProfileActionSheet(); });
  on("profileActionRemarkBtn", "click", () => {
      const p = state.currentProfileUser; if(!p) return;
      hideProfileActionSheet();
      showPrompt("请输入好友备注名", p.remarkName || "", async (newRemark) => {
        try {
          await api('/api/friends/remark', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendId: p.id, remark: newRemark }) });
          showModal("备注设置成功");
          loadFriends();
          loadConversations();
          if($("backBtn")) $("backBtn").click();
        } catch(e) { showModal(e.message); }
      });
  });
  on("profileActionMoveGroupBtn", "click", () => { hideProfileActionSheet(); if(state.currentProfileUser) window.openGroupSelect(state.currentProfileUser.id); });
  on("profileActionBlacklistBtn", "click", async () => {
      const p = state.currentProfileUser; if(!p) return;
      hideProfileActionSheet();
      await doAddBlacklist(p.id);
  });
  on("profileActionReportBtn", "click", () => { hideProfileActionSheet(); showModal('已收到举报，我们会尽快处理'); });
  on("btnSettingsMoveGroup", "click", () => { const peerId = conversationPeerId(state.activeConversation); if(peerId) window.openGroupSelect(peerId); });

  on("openGroupManageBtn", "click", () => window.openSecondaryPage('groupManagePage'));
  on("openFriendRequestsBtn", "click", () => window.openSecondaryPage('friendRequestsView'));
  on("doAddGroupBtn", "click", async () => {
      const n = normalizeGroupNameInput($("newGroupInput").value);
      if(!n) return showModal('分组名称不能为空');
      let cg = getCustomGroups();
      if(cg.includes(n)) return showModal('分组已存在');
      try {
        const data = await api('/api/groups/create', {method:'POST', body: JSON.stringify({userId: state.currentUser.id, name: n})});
        syncSessionGroups(data.groups || [...cg, n]);
        renderGroupManageList();
        $("newGroupInput").value = '';
        await loadFriends();
        showModal('添加分组成功');
      } catch(e) { showModal(e.message || '添加失败'); }
  });

}

// Messaging, recording, call UI
function bindChatEvents() {
  document.addEventListener("keydown", (e) => { if(e.key === "Escape" && $("imageViewer") && !$("imageViewer").classList.contains("hidden")) window.closeImageViewer(); });
  on("closeForwardModalBtn", "click", () => { hideEl("forwardModal"); });
  
  on("chatView", "click", (e) => {
      if(e.target.tagName !== 'IMG') {
          hideEl("actionPanel"); 
          hideEl("emojiPanel"); 
      }
  });

  on("sendMsgBtn", "click", window.handleSendText);
  on("messageInput", "keydown", (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.handleSendText(); } });
  on("emojiBtn", "click", () => { hideEl("actionPanel"); toggleEl("emojiPanel", "hidden"); });
  on("toggleActionsBtn", "click", () => { hideEl("emojiPanel"); toggleEl("actionPanel", "hidden"); });

  let typingDebounceTimer = null;
  on("messageInput", "input", function() {
      this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';
      const hasText = this.value.trim().length > 0;
      toggleEl("toggleActionsBtn", "hidden", hasText); toggleEl("sendMsgBtn", "hidden", !hasText);
      if(state.activeConversation?.type === 'direct' && !typingDebounceTimer) { const _peerId = conversationPeerId(state.activeConversation); if (_peerId) { api(`/api/conversations/${state.activeConversation.id}/signal`, { method:'POST', body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: _peerId, signal: {type:'typing'} }) }); } typingDebounceTimer = setTimeout(() => { typingDebounceTimer = null; }, 3000); }
  });

  on("voiceToggleBtn", "click", () => {
      if(!$("pttBtn") || !$("messageInput")) return; const isVoice = $("pttBtn").classList.contains("hidden");
      hideEl("actionPanel"); hideEl("emojiPanel"); 
      $("pttBtn").classList.toggle("hidden", !isVoice); $("messageInput").classList.toggle("hidden", isVoice);
      setText("voiceToggleBtn", isVoice ? "⌨️" : "🎙️");
      if(!isVoice) {
          const hasText = $("messageInput").value.trim().length > 0;
          toggleEl("toggleActionsBtn", "hidden", hasText); toggleEl("sendMsgBtn", "hidden", !hasText);
      } else {
          showEl("toggleActionsBtn"); hideEl("sendMsgBtn");
      }
  });

  let recordStartTime = 0;
  on("pttBtn", "touchstart", async (e) => {
      e.preventDefault(); if($("pttBtn")) { $("pttBtn").textContent = "松开 结束"; $("pttBtn").style.background = "#c5c5c6"; }
      let _pttStream = null;
      try {
          // On Android native app, ensure mic permission before recording
          if (window.__NATIVE_ANDROID__ && window.NativeBridge && !window.NativeBridge.hasMicrophonePermission()) {
            window.NativeBridge.requestMicrophonePermission();
            await new Promise(r => setTimeout(r, DELAYS.PERMISSION_WAIT));
            if (!window.NativeBridge.hasMicrophonePermission()) throw new Error('需要麦克风权限才能录音，请在设置中开启');
          }
          _pttStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          let mimeType = ''; if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm'; else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
          state.mediaRecorder = new MediaRecorder(_pttStream, mimeType ? { mimeType } : {}); state.audioChunks = []; recordStartTime = Date.now();
          state.mediaRecorder.ondataavailable = ev => state.audioChunks.push(ev.data);
          state.mediaRecorder.onstop = async () => {
              if (Date.now() - recordStartTime < 1000) return showModal("录音太短");
              try {
                  const audioBlob = new Blob(state.audioChunks, { type: mimeType || 'audio/webm' });
                  const audioUrl = await uploadBinary(audioBlob, `voice_${Date.now()}.webm`, audioBlob.type || 'audio/webm');
                  await window.sendMessage({ type: 'audio', audioUrl });
              } catch (err) {
                  showModal('语音上传失败: ' + err.message);
              }
          };
          state.mediaRecorder.start();
      } catch(err) { setText("pttBtn", "按住 说话"); if (_pttStream) try { _pttStream.getTracks().forEach(t => t.stop()); } catch(_) {} showModal("无录音权限"); }
  });
  const stopPttRecording = () => {
      if($("pttBtn")) { $("pttBtn").textContent = "按住 说话"; $("pttBtn").style.background = "#fff"; }
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') { state.mediaRecorder.stop(); state.mediaRecorder.stream.getTracks().forEach(t => t.stop()); }
  };
  on("pttBtn", "touchend", (e) => { e.preventDefault(); stopPttRecording(); });
  on("pttBtn", "touchcancel", (e) => { e.preventDefault(); stopPttRecording(); });

  on("btnTakePhoto", "click", () => { if($("cameraInput")) $("cameraInput").click(); hideEl("actionPanel"); });
  on("btnSendImage", "click", () => { if($("imageInput")) $("imageInput").click(); hideEl("actionPanel"); });
  on("btnCallVoice", "click", () => { window.startCall('voice'); hideEl("actionPanel"); });
  on("btnCallVideo", "click", () => { window.startCall('video'); hideEl("actionPanel"); });
  on("btnSendContactCard", "click", async () => { await sendContactCardInChat(); hideEl("actionPanel"); });

  // Contact card picker: search and confirm
  on("ccpSearchInput", "input", () => { renderContactCardPicker(); });
  on("ccpConfirmBtn", "click", async () => {
    const f = state._ccpSelectedFriend;
    if (!f) return;
    await window.sendMessage({
      type: 'card',
      card: {
        cardType: '名片',
        userId: f.id,
        appNumberId: f.appNumberId || '',
        title: f.remark || f.displayName || f.username || '好友名片',
        description: 'ChatTrade ID: ' + (f.appNumberId || f.username || '-'),
        meta: '个人名片',
        imageUrl: f.avatarUrl || '',
      },
    });
    state._ccpSelectedFriend = null;
    if ($("backBtn")) $("backBtn").click();
  });

  on("btnSendProductCard", "click", async () => { await sendProductCardInChat(); hideEl("actionPanel"); });
  on("btnSendOrderCard", "click", async () => { await sendOrderCardInChat(); hideEl("actionPanel"); });
  on("btnSendPaymentCode", "click", async () => { await sendPaymentCodeInChat(); hideEl("actionPanel"); });
  // Order picker tab switching
  if($("orderPickerTabs")){
    $("orderPickerTabs").addEventListener('click', (e) => {
      const tab = e.target.closest('.picker-tab');
      if(!tab) return;
      renderOrderCardPicker(tab.dataset.tab);
    });
  }
  // Product detail - send message to seller
  on("productDetailChatBtn", "click", () => {
    const item = state.selectedProductDetail;
    if(!item || !item.sellerId) return;
    window.openProductChat(item.sellerId, item.title || '商品', item.price || 0, normalizeMediaUrl(item.image || item.imageUrl) || '', item.id || item.productId || '');
  });
  // Product detail - add to cart via spec sheet
  on("productDetailAddCartBtn", "click", () => {
    const item = state.selectedProductDetail;
    if(!item) return;
    openProductSpecSheet(item, 'cart');
  });
  // Product detail - buy now: add to cart and go directly to checkout
  on("productDetailBuyNowBtn", "click", () => {
    const item = state.selectedProductDetail;
    if(!item) return;
    openProductSpecSheet(item, 'buyNow');
  });

  const handleImageUpload = async (e) => { 
      const input = e.target; const file = input.files?.[0]; if (!file) return; input.value = "";
      try {
          const blob = await resizeImageFile(file, 1080, 0.7);
          const imageUrl = await uploadBinary(blob, file.name || `image_${Date.now()}.jpg`, 'image/jpeg');
          await window.sendMessage({ type: "image", imageUrl });
      } catch (err) {
          showModal('图片上传失败: ' + err.message);
      }
  };
  on("imageInput", "change", handleImageUpload);
  on("cameraInput", "change", handleImageUpload);

  on("toggleSpeakerBtn", "click", () => { showModal('【原生限制说明】\n网页端无法用代码强制切换听筒，请直接按手机侧边的音量键调节声音。'); });
  on("toggleMuteBtn", "click", () => {
    if (!state.rtc.localStream) return;
    isMuted = !isMuted;
    state.rtc.localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    if($("toggleMuteBtn")) { $("toggleMuteBtn").classList.toggle('active', !isMuted); $("toggleMuteBtn").style.color = isMuted ? '#ff3b30' : '#fff'; }
    setText("muteText", isMuted ? "已静音" : "静音");
  });
  on("toggleCameraBtn", "click", () => {
    if (!state.rtc.localStream) return;
    isCameraOff = !isCameraOff;
    state.rtc.localStream.getVideoTracks().forEach(t => t.enabled = !isCameraOff);
    if($("toggleCameraBtn")) { $("toggleCameraBtn").classList.toggle('active', !isCameraOff); $("toggleCameraBtn").style.color = isCameraOff ? '#ff3b30' : '#fff'; }
    setText("cameraText", isCameraOff ? "已关镜头" : "镜头");
  });
  
  on("acceptCallBtn", "click", async () => {
      if (state.rtc._accepting) return;
      state.rtc._accepting = true;
      try {
          clearTimeout(outgoingTimeoutTimer); clearTimeout(incomingTimeoutTimer); const conversationId = state.rtc.pendingOffer?.conversationId || state.rtc.incomingMeta?.conversationId || state.activeConversation?.id; 
          if (!conversationId) return; state.rtc.conversationId = conversationId; 
          if(!state.activeConversation || state.activeConversation.id !== conversationId) { window.openConversation(conversationId, { skipFetch: true }); }
          syncCallConversationState(conversationId, state.rtc.pendingOffer?.senderId || state.rtc.incomingMeta?.senderId || state.rtc.peerId || null, state.rtc.incomingMeta?.senderName || '');
          showEl("callPanel");
          setText("callTitle", `连接中...`); 
          setText("chatSubtitle", '建立连接中…');
          if (!state.rtc.pendingOffer) { state.rtc.pendingAccept = true; return; } 
          const { senderId, mode, signal } = state.rtc.pendingOffer; state.rtc.pendingAccept = false; state.rtc.peerId = senderId; setRtcPhase('connecting'); 
          await createPeerConnection(mode); await state.rtc.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)); 
          scheduleConnectTimeout(); 
          for (const cand of (state.rtc.earlyCandidates || [])) { try { await state.rtc.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(e) { console.warn('[webrtc] addIceCandidate failed:', e); } } 
          state.rtc.earlyCandidates = []; 
          await flushQueuedRemoteCandidates();
          const answer = await state.rtc.pc.createAnswer(); await state.rtc.pc.setLocalDescription(answer);
          
          const activeCallId = state.rtc.callId || state.rtc.pendingOffer?.callId || state.rtc.incomingMeta?.callId || null;
          state.rtc.callId = activeCallId;
          enqueueSignal(conversationId, { senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: senderId, mode, callId: activeCallId, signal: { type: 'answer', sdp: answer } }); 
          api(`/api/conversations/${conversationId}/call`, { method: 'POST', body: JSON.stringify({ senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: senderId, event: 'accept', mode, callId: activeCallId }) }).catch(() => {}); 
          
          const peerMeta = resolveCallPeerMeta(senderId, senderId);
          let peerName = peerMeta.name;
          
          markCallConnecting(senderId, mode, '已接听，建立连接中...'); 
          setText("callName", peerName);
          state.rtc.pendingOffer = null; 
      } catch (err) { finalizeCall({ alertText: err && err.message ? err.message : '接听失败', event: 'reject', reason: 'error' }); } finally { state.rtc._accepting = false; }
  });
  
  on("rejectCallBtn", "click", () => { finalizeCall({ event: 'reject', reason: 'manual' }); });
  on("hangupBtn", "click", () => {
    if (state.rtc.phase === 'connected') finalizeCall({ event: 'end', reason: 'hangup' });
    else if (state.rtc.phase === 'outgoing' || state.rtc.phase === 'connecting') finalizeCall({ event: 'cancel', reason: 'caller_cancel' });
    else finalizeCall({ event: 'end', reason: 'hangup' });
  });

  // --- Call minimize / restore ---
  let _callFloatingTimer = null;
  function minimizeCall() {
    if (!hasActiveCallSession()) return;
    hideEl("callPanel");
    showEl("callFloatingBubble");
    if ($("callFloatingBubble")) {
      updateFloatingDuration();
      clearInterval(_callFloatingTimer);
      _callFloatingTimer = setInterval(updateFloatingDuration, 1000);
    }
  }
  function restoreCall() {
    hideEl("callFloatingBubble");
    clearInterval(_callFloatingTimer);
    if (hasActiveCallSession()) showEl("callPanel");
  }
  function updateFloatingDuration() {
    if (!callStartTime) return;
    const diff = Math.floor((Date.now() - callStartTime) / 1000);
    const m = String(Math.floor(diff / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    if ($("callFloatingDuration")) $("callFloatingDuration").textContent = `${m}:${s}`;
  }
  on("callMinimizeBtn", "click", minimizeCall);
  if ($("callFloatingBubble")) {
    $("callFloatingBubble").addEventListener("click", restoreCall);
    // Drag support for floating bubble
    let _bubbleDragging = false, _bubbleStartX = 0, _bubbleStartY = 0, _bubbleOrigX = 0, _bubbleOrigY = 0;
    const bubble = $("callFloatingBubble");
    bubble.addEventListener("touchstart", (e) => {
      _bubbleDragging = false;
      const t = e.touches[0];
      _bubbleStartX = t.clientX; _bubbleStartY = t.clientY;
      const rect = bubble.getBoundingClientRect();
      _bubbleOrigX = rect.left; _bubbleOrigY = rect.top;
    }, { passive: true });
    bubble.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      const dx = t.clientX - _bubbleStartX, dy = t.clientY - _bubbleStartY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) _bubbleDragging = true;
      if (_bubbleDragging) {
        e.preventDefault();
        bubble.style.left = (_bubbleOrigX + dx) + 'px';
        bubble.style.top = (_bubbleOrigY + dy) + 'px';
        bubble.style.right = 'auto';
      }
    }, { passive: false });
    bubble.addEventListener("touchend", (e) => {
      if (_bubbleDragging) {
        // Snap to nearest edge
        const rect = bubble.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const screenW = window.innerWidth;
        if (midX < screenW / 2) { bubble.style.left = '8px'; bubble.style.right = 'auto'; }
        else { bubble.style.left = 'auto'; bubble.style.right = '8px'; }
        // Clamp vertical
        const maxY = window.innerHeight - rect.height - 8;
        const clampedY = Math.max(8, Math.min(maxY, rect.top));
        bubble.style.top = clampedY + 'px';
      } else {
        restoreCall();
      }
      _bubbleDragging = false;
    });
  }
  // Hide floating bubble when call ends (use lazy reference since window.stopCall is defined later)
  window._stopCallWithBubble = () => {
    clearInterval(_callFloatingTimer);
    hideEl("callFloatingBubble");
  };

}

// Search & emoji
function bindSearchAndEmojiEvents() {
  // ── Search cooldown utility ──
  const _searchCooldowns = {};
  const SEARCH_COOLDOWN_MS = 3000; // 3 second cooldown between searches
  function showCooldownToast(seconds) {
    let toast = document.querySelector('.search-cooldown-toast');
    if (toast) toast.remove();
    toast = createEl('div', 'search-cooldown-toast', `搜索太频繁，请 ${seconds} 秒后再试`);
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1500);
  }
  function checkSearchCooldown(key) {
    const now = Date.now();
    const last = _searchCooldowns[key] || 0;
    const remaining = SEARCH_COOLDOWN_MS - (now - last);
    if (remaining > 0) {
      showCooldownToast(Math.ceil(remaining / 1000));
      return false;
    }
    _searchCooldowns[key] = now;
    return true;
  }

  // ── Click search input to open search page ──
  on("searchInput", "click", () => { window.openSecondaryPage('msgSearchPage', 'home'); });
  on("mallSearchInput", "click", () => { window.openSecondaryPage('mallSearchPage', 'home'); });

  // ── Message search (on search page) ──
  async function doMsgSearch() {
    const keyword = ($("msgSearchPageInput")?.value || '').trim();
    if (!keyword) return;
    if (!checkSearchCooldown('msgSearch')) return;
    loadConversations().catch(() => {});
    try {
      const res = await api(`/api/messages/search?keyword=${encodeURIComponent(keyword)}&limit=20`);
      const el = $("msgSearchPageResults");
      if (!el) return;
      if (!res.results || !res.results.length) {
        showEmptyState(el, '未找到相关聊天记录');
        return;
      }
      const kwRe = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const highlightInto = (parent, text) => {
        const truncated = text.length > 80 ? text.slice(0, 80) + '...' : text;
        let lastIdx = 0;
        truncated.replace(kwRe, (match, offset) => {
          if (offset > lastIdx) parent.appendChild(document.createTextNode(truncated.slice(lastIdx, offset)));
          const mark = createEl('mark', 'search-highlight', match);
          parent.appendChild(mark);
          lastIdx = offset + match.length;
          return match;
        });
        if (lastIdx < truncated.length) parent.appendChild(document.createTextNode(truncated.slice(lastIdx)));
      };
      const frag = document.createDocumentFragment();
      frag.appendChild(createEl('div', 'msg-search-header', '聊天记录'));
      res.results.forEach(r => {
        const btn = createEl('button', 'chat-item msg-search-item');
        btn.dataset.convId = r.conversationId;
        btn.dataset.msgId = r.messageId;
        const info = createEl('div', 'msg-search-info');
        info.appendChild(createEl('div', 'msg-search-name', r.peerName));
        const preview = createEl('div', 'msg-search-preview');
        highlightInto(preview, r.text);
        info.appendChild(preview);
        btn.append(info, createEl('div', 'msg-search-time', formatTime(r.createdAt)));
        frag.appendChild(btn);
      });
      if (res.total > 20) frag.appendChild(createEl('div', 'msg-search-count', `共找到 ${res.total} 条结果`));
      el.replaceChildren(frag);
      if (!el._msgSearchDelegate) {
        el._msgSearchDelegate = true;
        el.addEventListener('click', async (e) => {
          const btn = e.target.closest('.msg-search-item');
          if (!btn) return;
          const convId = btn.dataset.convId;
          const msgId = btn.dataset.msgId;
          if (!convId) return;
          if ($("msgSearchPageInput")) $("msgSearchPageInput").value = '';
          if ($("msgSearchPageResults")) $("msgSearchPageResults").replaceChildren();
          state.secondaryPage = null;
          await window.openConversation(convId);
          if (msgId) {
            setTimeout(() => {
              const chatView = $("chatView");
              if (!chatView) return;
              const target = chatView.querySelector(`article.message-row[data-id="${CSS.escape(String(msgId))}"]`);
              if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.style.transition = 'background 0.3s';
                target.style.background = '#fff3cd';
                setTimeout(() => { target.style.background = ''; }, 2000);
              }
            }, 300);
          }
        });
      }
    } catch (_) {}
  }
  on("msgSearchPageBtn", "click", doMsgSearch);
  on("msgSearchPageInput", "keydown", (e) => { if (e.key === 'Enter') { e.preventDefault(); doMsgSearch(); } });
  let _friendSearchTimer = null;
  on("friendSearchInput", "input", () => { clearTimeout(_friendSearchTimer); _friendSearchTimer = setTimeout(() => loadFriends().catch(() => {}), 300); });

  // ── In-chat message search ──
  on("chatSearchMsgBtn", "click", () => {
    if ($("backBtn")) $("backBtn").click(); // go back from settings page
    showEl("chatSearchBar");
    if ($("chatSearchInput")) { $("chatSearchInput").value = ''; $("chatSearchInput").focus(); }
    if ($("chatSearchCount")) $("chatSearchCount").textContent = '';
    state._chatSearchResults = [];
    state._chatSearchIdx = -1;
  });
  on("chatSearchCloseBtn", "click", () => {
    hideEl("chatSearchBar");
    // Remove highlights
    document.querySelectorAll('#chatView .search-highlight').forEach(el => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });
    state._chatSearchResults = [];
    state._chatSearchIdx = -1;
  });
  let _chatSearchTimer = null;
  on("chatSearchInput", "input", () => {
    clearTimeout(_chatSearchTimer);
    _chatSearchTimer = setTimeout(() => {
      const keyword = ($("chatSearchInput")?.value || '').trim().toLowerCase();
      // Remove old highlights
      document.querySelectorAll('#chatView .search-highlight').forEach(el => {
        const parent = el.parentNode;
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      });
      state._chatSearchResults = [];
      state._chatSearchIdx = -1;
      if (!keyword) { if ($("chatSearchCount")) $("chatSearchCount").textContent = ''; return; }
      // Search in loaded messages DOM
      const chatView = $("chatView");
      if (!chatView) return;
      const bubbles = chatView.querySelectorAll('.message-row:not(.system-msg) .bubble:not(.audio-bubble):not(.image-bubble)');
      const matches = [];
      bubbles.forEach(bubble => {
        const text = (bubble.textContent || '').toLowerCase();
        if (text.includes(keyword)) {
          // Highlight occurrences in this bubble
          const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
          const textNodes = [];
          while (walker.nextNode()) textNodes.push(walker.currentNode);
          textNodes.forEach(node => {
            const idx = node.textContent.toLowerCase().indexOf(keyword);
            if (idx === -1) return;
            const range = document.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + keyword.length);
            const mark = createEl('span', 'search-highlight');
            mark.style.cssText = 'background:#b4efc8;padding:0 1px;border-radius:2px;';
            range.surroundContents(mark);
            matches.push(mark);
          });
        }
      });
      state._chatSearchResults = matches;
      state._chatSearchIdx = matches.length > 0 ? 0 : -1;
      if ($("chatSearchCount")) $("chatSearchCount").textContent = matches.length > 0 ? `1/${matches.length}` : '0';
      if (matches.length > 0) {
        matches[0].style.background = '#f5c518';
        matches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 250);
  });
  const chatSearchNav = (dir) => {
    const results = state._chatSearchResults || [];
    if (!results.length) return;
    const old = state._chatSearchIdx;
    if (old >= 0 && old < results.length) results[old].style.background = '#b4efc8';
    state._chatSearchIdx = (old + dir + results.length) % results.length;
    const cur = results[state._chatSearchIdx];
    cur.style.background = '#f5c518';
    cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if ($("chatSearchCount")) $("chatSearchCount").textContent = `${state._chatSearchIdx + 1}/${results.length}`;
  };
  on("chatSearchUpBtn", "click", () => chatSearchNav(-1));
  on("chatSearchDownBtn", "click", () => chatSearchNav(1));

  const emojiList = ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","☺️","😚"];
  if($("emojiPanel")) {
    const panel = $("emojiPanel");
    panel.replaceChildren();
    emojiList.forEach((e) => panel.appendChild(createEl('span', '', e)));
    panel.addEventListener('click', (e) => {
      const span = e.target.closest('span');
      if (span && span.textContent) window.insertEmoji(span.textContent);
    });
  }
}



// ==========================================
// ★ 3. 核心拉取与渲染 ★
// ==========================================
// Tab-switch freshness: skip reload if data was fetched within this window
const TAB_CACHE_TTL = 15000;
const _tabLoadTimes = {};
function tabLoad(key, loadFn) {
  const now = Date.now();
  if (_tabLoadTimes[key] && now - _tabLoadTimes[key] < TAB_CACHE_TTL) return;
  _tabLoadTimes[key] = now;
  loadFn().catch(() => {});
}

function setMainTab(tab) {
  // Clear secondary navigation state when switching to a main tab
  state.secondaryPage = null; state.secondaryReturn = null; state.secondaryStack = [];
  const tabEl = $(tab+'Tab');
  if (tabEl) {
    const parent = tabEl.parentElement;
    if (parent) parent.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
    tabEl.classList.add('active');
  }
  hideTabViews();

  if (tab === 'messages') { showEl("chatListView"); setText("chatTitle", "微信"); tabLoad('conversations', loadConversations); tabLoad('systemMessages', loadSystemMessages); scheduleTradeReminderRefresh(0); }
  else if (tab === 'friends') { showEl("friendListView"); setText("chatTitle", "通讯录"); tabLoad('friends', loadFriends); tabLoad('friendRequests', loadFriendRequests); }
  else if (tab === 'mall') { showEl("mallView"); setText("chatTitle", "发现"); if (!state.userLocation) refreshUserLocation(); tabLoad('mall', loadMall); }
  else if (tab === 'profile') { showEl("profileView"); setText("chatTitle", "我"); updateMyCartBadge(); }
  toggleEl("homeMoreBtn", "hidden", tab !== 'messages');
  // sidebar avatar bar only visible inside chat conversation, hide on all tab views
  toggleEl("sidebarPanel", "sidebar-tab-hidden", true);
  hideEl("sidebarToggleBtn");
}

function renderGroupManageList() {
    const list = $("groupManageList"); if(!list) return;
    const cg = getCustomGroups();
    state.currentUser.customGroups = cg;
    list.replaceChildren();
    cg.forEach((g, index) => {
      const row = createEl('div', 'chat-item group-manage-row');
      const left = createEl('div', 'group-manage-left');
      left.appendChild(createEl('span', 'group-manage-name', g));
      if (g === DEFAULT_GROUP) left.appendChild(createEl('span', 'group-manage-tag', '全部好友'));
      row.appendChild(left);
      const actions = createEl('div', 'group-manage-actions');
      const mkBtn = (text, colorCls, handler) => {
        const btn = createEl('button', `group-manage-btn ${colorCls}`, text);
        btn.addEventListener('click', handler);
        return btn;
      };
      if (g !== DEFAULT_GROUP) actions.appendChild(mkBtn('重命名', 'blue', () => window.renameGroup(g)));
      actions.appendChild(mkBtn('上移', 'gray', () => window.moveGroupOrder(g, -1)));
      actions.appendChild(mkBtn('下移', 'gray', () => window.moveGroupOrder(g, 1)));
      if (g !== DEFAULT_GROUP) actions.appendChild(mkBtn('删除', 'red', () => window.deleteGroup(g)));
      row.appendChild(actions);
      list.appendChild(row);
    });
}

const loadMyProducts = singleFlight(async function _loadMyProductsImpl() {
  try {
    const data = await api(`/api/users/${state.currentUser.id}/profile?viewerId=${encodeURIComponent(state.currentUser.id)}`);
    const list = $("myProductsList"); if(!list) return;
    const products = data.profile.products || [];
    if(products.length === 0) { showEmptyState(list, '你还没有发布任何闲置商品'); return; }
    list.replaceChildren();
    products.forEach((p) => {
      const row = createEl('div', 'chat-item my-product-row');
      const safeImage = normalizeMediaUrl(p.image);
      if (safeImage) {
        const img = createEl('img', 'my-product-img');
        img.src = safeImage;
        row.appendChild(img);
      }
      const info = createEl('div', 'my-product-info');
      info.append(createEl('strong', 'my-product-title', p.title || ''), createEl('div', 'my-product-price', `¥${p.price}`));
      row.appendChild(info);
      const btn = createEl('button', 'my-product-delist-btn', '下架');
      btn.addEventListener('click', () => window.deleteMyProduct(p.id));
      row.appendChild(btn);
      list.appendChild(row);
    });
  } catch(e){
    console.warn('load my products failed', e);
    const list = $("myProductsList");
    if (list) {
      showEmptyState(list, e?.message || '加载我的商品失败');
    }
  }
});

function refreshUserLocation() {
  if (!navigator.geolocation) {
    state.userLocationName = '定位不可用';
    if ($('mallLocationText')) $('mallLocationText').textContent = state.userLocationName;
    return;
  }
  state.userLocationName = '正在定位...';
  if ($('mallLocationText')) $('mallLocationText').textContent = state.userLocationName;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.userLocationName = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      if ($('mallLocationText')) $('mallLocationText').textContent = '当前位置 · ' + state.userLocationName;
      if (state.mallTab === 'nearby') { state.mallListSignature = ''; loadMall(); }
    },
    () => {
      state.userLocationName = '定位失败，点击重试';
      if ($('mallLocationText')) $('mallLocationText').textContent = state.userLocationName;
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
  );
}

const loadMall = singleFlight(async function _loadMallImpl() {
  try {
    let qs = 'userId=' + state.currentUser.id;
    if (state.userLocation) qs += '&lat=' + state.userLocation.lat + '&lng=' + state.userLocation.lng;
    if (state.mallTab === 'price') qs += '&sort=price';
    else if (state.mallTab === 'latest') qs += '&sort=latest';
    else qs += '&sort=nearby';
    const data = await api('/api/mall?' + qs);
    const products = data.items || data.products || [];
    const list = $("mallList"); if (!list) return;
    const nextSignature = buildMallSignature(products);
    let grid = list.querySelector('.mall-grid');
    if (products.length === 0) {
      state.mallListSignature = nextSignature;
      state.mallItemSignatures = {};
      showEmptyState(list, state.mallTab === 'nearby' ? '附近暂无闲置商品，快去发布吧' : '暂无商品，快去发布吧');
      return;
    }
    if (nextSignature === state.mallListSignature && grid) return;
    if (!grid || list.children.length !== 1 || list.firstElementChild !== grid) {
      grid = createEl('div', 'mall-grid');
      list.replaceChildren(grid);
    }
    state.mallItemSignatures = reconcileList(grid, products, {
      selector: '.product-card[data-product-id]',
      dataKey: 'productId',
      keyFn: (p) => String(p.id),
      sigFn: buildMallItemSignature,
      buildFn: buildMallCard,
      patchFn: patchMallCard,
      sigStore: state.mallItemSignatures,
    });
    state.mallListSignature = nextSignature;
  } catch(e) { const _ml = $("mallList"); if (_ml) showEmptyState(_ml, '加载失败'); }
});

async function doMallSearchPage() {
  const keyword = ($('mallSearchPageInput')?.value || '').trim();
  const el = $("mallSearchPageResults");
  if (!el) return;
  if (!keyword) { el.replaceChildren(); return; }
  try {
    let qs = 'userId=' + state.currentUser.id + '&q=' + encodeURIComponent(keyword);
    if (state.userLocation) qs += '&lat=' + state.userLocation.lat + '&lng=' + state.userLocation.lng;
    qs += '&sort=nearby';
    const data = await api('/api/mall?' + qs);
    const products = data.items || data.products || [];
    if (!products.length) {
      showEmptyState(el, '未找到相关商品');
      return;
    }
    const grid = createEl('div', 'mall-grid');
    products.forEach(p => grid.appendChild(buildMallCard(p)));
    el.replaceChildren(grid);
  } catch (_) {
    showEmptyState(el, '搜索失败');
  }
}

const loadFriendRequests = singleFlight(async function _loadFriendRequestsImpl() {
  try {
    const data = await api(`/api/friends/requests?userId=${encodeURIComponent(state.currentUser.id)}`);
    state.friendRequests = data.requests || [];
    const pendingCount = state.friendRequests.filter(r => r.status === 'pending').length;
    if($("friendsTabBadge")) {
      $("friendsTabBadge").classList.toggle("hidden", pendingCount === 0);
      $("friendsTabBadge").textContent = pendingCount > 99 ? '99+' : (pendingCount ? String(pendingCount) : '');
    }
    if($("friendRequestBadge")) {
      $("friendRequestBadge").classList.toggle("hidden", pendingCount === 0);
      $("friendRequestBadge").textContent = pendingCount > 99 ? '99+' : (pendingCount ? String(pendingCount) : '');
    }
    if($("requestsList")) {
      const container = $("requestsList");
      container.replaceChildren();
      if (!state.friendRequests.length) {
        showEmptyState(container, '暂无新的朋友');
        return;
      }
      state.friendRequests.forEach((r) => {
        const sender = r.sender || r.fromUser || {};
        const senderName = sender.displayName || sender.username || sender.id || '未知用户';
        const row = createEl('div', 'chat-item');
        row.style.cursor = 'pointer';
        const avatarWrap = createEl('div', 'avatar-click-wrap');
        setAvatarContainer(avatarWrap, sender, senderName);
        row.appendChild(avatarWrap);
        const info = createEl('div', 'friend-req-info');
        info.append(createEl('strong', '', senderName), createEl('div', 'preview', r.greeting || ''));
        row.appendChild(info);
        row.addEventListener('click', () => { if(sender.id) window.openUserProfile(sender.id, senderName); });
        if (r.status === 'pending') {
          const actions = createEl('div', 'friend-req-actions');
          const acceptBtn = createEl('button', 'primary-btn', '同意');
          acceptBtn.classList.add('friend-req-accept-btn');
          acceptBtn.addEventListener('click', (e) => { e.stopPropagation(); window.acceptRequest(r.id); });
          const rejectBtn = createEl('button', 'secondary-btn', '拒绝');
          rejectBtn.addEventListener('click', (e) => { e.stopPropagation(); window.rejectRequest(r.id); });
          actions.append(rejectBtn, acceptBtn);
          row.appendChild(actions);
        } else {
          const done = createEl('span', 'friend-req-done', r.status === 'rejected' ? '已拒绝' : '已处理');
          row.appendChild(done);
        }
        container.appendChild(row);
      });
    }
  } catch(e) {
    console.warn('load friend requests failed', e);
    if($("requestsList")) {
      showEmptyState($("requestsList"), '加载失败，请重试');
    }
  }
});

function refreshFriendRequestState() {
  if (!state.currentUser || !state.currentUser.id) return Promise.resolve();
  return loadFriendRequests();
}

const loadFriends = singleFlight(async function _loadFriendsImpl() {
  try {
    const keyword = $("friendSearchInput") ? $("friendSearchInput").value.trim().toLowerCase() : "";
    const data = await api(`/api/friends?userId=${encodeURIComponent(state.currentUser.id)}`);
    let filteredFriends = data.friends;
    if (keyword) filteredFriends = filteredFriends.filter(f => f.friend && ((f.friend.displayName || '').toLowerCase().includes(keyword) || (f.friend.username || '').toLowerCase().includes(keyword)));
    state.friends = data.friends;
    state.friendsById = new Map();
    for (const f of data.friends) if (f.friend?.id) state.friendsById.set(f.friend.id, f);
    const grouped = new Map();
    grouped.set(DEFAULT_GROUP, filteredFriends.slice());
    filteredFriends.forEach((f) => {
      const groupName = f.group && f.group !== DEFAULT_GROUP ? f.group : '';
      if (!groupName) return;
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName).push(f);
    });
    const customGroups = getCustomGroups();
    state.currentUser.customGroups = customGroups;
    const nextSignature = buildFriendListSignature(customGroups, grouped);
    const container = $("friendList");
    if (!container) return;
    if (nextSignature === state.friendListSignature && container.childElementCount) return;
    const groupItems = customGroups.map(name => ({ name, members: grouped.get(name) || [] }));
    state.friendGroupSignatures = reconcileList(container, groupItems, {
      selector: ':scope > div[data-group-name]',
      dataKey: 'groupName',
      keyFn: (g) => g.name,
      sigFn: (g) => buildFriendGroupSignature(g.name, g.members),
      buildFn: (g) => createFriendGroupSection(g.name, g.members),
      patchFn: (node, g) => patchFriendGroupSection(node, g.name, g.members),
      sigStore: state.friendGroupSignatures,
    });
    state.friendListSignature = nextSignature;
    const nextFriendItemSignatures = {};
    customGroups.forEach((groupName) => {
      const members = grouped.get(groupName) || [];
      members.forEach((item) => { const itemKey = `${groupName}::${item.friend.id}`; nextFriendItemSignatures[itemKey] = buildFriendItemSignature(item, groupName); });
    });
    state.friendItemSignatures = nextFriendItemSignatures;
    if (state.activeConversation?.id) applyChatRelationshipState();
  } catch(e) {
    console.warn('load friends failed', e);
    const container = $("friendList");
    if (container) {
      showEmptyState(container, e?.message || '加载联系人失败', 'chat-list-empty');
    }
  }
});


function applyLastOutgoingReadState(){
  refreshMessageReadReceipts();
}
function markConversationRead(convId) {
  if (!convId || !state.currentUser) return;
  api(`/api/conversations/${convId}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) }).catch(() => {});
}

function renderMessages(preserveScroll = false) {
  const chatView = $("chatView"); if(!chatView) return;
  // Build lightweight signature: id|type|recalled for each message
  let sig = state.messages.length + ':';
  for (let i = 0; i < state.messages.length; i++) {
    const m = state.messages[i];
    sig += m.id + '|' + (m.type || '') + '|' + (m.createdAt || 0) + ';';
  }
  if (!sigChanged('messages', sig) && !preserveScroll) return;
  _messagesSig = sig;
  const oldScrollHeight = chatView.scrollHeight;
  chatView.replaceChildren();
  const fragment = document.createDocumentFragment();
  let lastTime = 0;
  for (let i = 0; i < state.messages.length; i++) {
    const msg = state.messages[i];
    fragment.appendChild(buildMessageChunk(msg, lastTime));
    lastTime = msg.createdAt || lastTime;
  }
  chatView.appendChild(fragment);
  if (preserveScroll) { chatView.scrollTop = chatView.scrollHeight - oldScrollHeight; } else { setTimeout(() => chatView.scrollTo({ top: chatView.scrollHeight, behavior: 'smooth' }), 10); }
  refreshMessageReadReceipts();
}

async function fetchMessages(before = 0) {
  if (state.isLoadingMessages || !state.activeConversation) return;
  state.isLoadingMessages = true;
  const convId = state.activeConversation.id;
  try {
    const data = await api(`/api/conversations/${encodeURIComponent(convId)}/messages?userId=${encodeURIComponent(state.currentUser.id)}&limit=20&before=${encodeURIComponent(before)}`);
    if (state.activeConversation?.id !== convId) return; // conversation changed during fetch
    state.hasMoreMessages = data.hasMore;
    if (before === 0) {
      state.messages = data.messages;
      rebuildMessagesById();
      if (state.activeConversation) state.activeConversation.peerLastReadAt = Number(data.peerLastReadAt || state.activeConversation.peerLastReadAt || 0);
      state.peerLastReadAt = Number(data.peerLastReadAt || state.peerLastReadAt || 0);
      renderMessages();
      applyLastOutgoingReadState();
    } else if (data.messages.length > 0) {
      const oldFirst = state.messages[0] || null;
      state.messages = data.messages.concat(state.messages);
      rebuildMessagesById();
      prependMessagesToView(data.messages, oldFirst);
    }
    state.oldestMessageTime = state.messages[0]?.createdAt || 0;
  } catch(e){
    console.warn('[messages] fetch failed', e);
  } finally { state.isLoadingMessages = false; }
}

// WebRTC/calling functions moved to app_calling.js
async function connectRealtime() {
  if (state.eventSource) {
    if (state._sseHandlers) { for (const [evt, fn] of state._sseHandlers) state.eventSource.removeEventListener(evt, fn); }
    state.eventSource.close();
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
  state._sseHandlers = [];
  const _on = (evt, fn) => { state._sseHandlers.push([evt, fn]); state.eventSource.addEventListener(evt, fn); };
  _on('message_created', async (e) => { try {
    const data = safeParseEventData(e);
    if (!data) return;
    if(state.activeConversation && state.activeConversation.id === data.conversationId && data.message) {
      const result = upsertMessage(data.message);
      if (result.action === 'append') appendMessageToView(data.message);
      else if (result.action === 'replace') { if (!replaceMessageInView(data.message)) renderMessages(); }
      else renderMessages(); // 'insert' in middle — full re-render needed
  applyLastOutgoingReadState();
      state.oldestMessageTime = state.messages[0]?.createdAt || 0;
      syncAndRenderConvList(true);
      markConversationRead(state.activeConversation.id);
    } else if(state.activeConversation && state.activeConversation.id === data.conversationId) {
      await fetchMessages();
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
  _on('conversation_updated', () => { loadConversations().catch(() => {}); scheduleTradeReminderRefresh(180); });
  _on('friends_updated', async () => { await loadFriends(); if (state.activeConversation) applyChatRelationshipState(); });
  _on('friend_request_updated', loadFriendRequests);
  _on('mall_updated', async () => { await loadMall(); await syncProductViewsIfVisible(); });
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
      showToast('实时连接断开，请刷新页面');
      return;
    }
    const delay = Math.min(1500 * Math.pow(2, state._sseRetryCount - 1), 30000);
    setTimeout(() => { if (state.currentUser) connectRealtime().catch(() => {}); }, delay);
  };
}

window.addEventListener('pagehide', () => {
  if (typeof stopScanCamera === 'function') stopScanCamera();
  if (!hasActiveCallSession()) return;
  const event = state.rtc.phase === 'connected' ? 'end' : (isRingingPhase() ? 'cancel' : 'end');
  const reason = state.rtc.phase === 'connected' ? 'pagehide' : 'pagehide';
  finalizeCall({ event, reason });
});


function updateMessagesTabBadge(totalUnread) {
  const badge = $("messagesTabBadge");
  if (!badge) return;
  const count = Number(totalUnread) || 0;
  badge.classList.toggle("hidden", count === 0);
  if (!count) badge.textContent = '';
  else badge.textContent = count > 99 ? '99+' : String(count);
}
function sortConversationsInPlace() {
  if (!Array.isArray(state.conversations)) return;
  state.conversations.sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (bp !== ap) return bp - ap;
    return (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0);
  });
}
/* ===== Sidebar Avatar Bar ===== */
let _sidebarSignature = '';
let _sidebarDelegated = false;
function ensureSidebarDelegation() {
  if (_sidebarDelegated) return;
  const list = $('sidebarList');
  if (!list) return;
  _sidebarDelegated = true;
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.sidebar-item');
    if (!item) return;
    const convId = item.dataset.convId;
    if (convId) window.openConversation(convId);
  });
}
function renderSidebar() {
  const panel = $('sidebarPanel');
  const list = $('sidebarList');
  if (!panel || !list) return;
  if (state.sidebarMode === 'hidden') return;
  ensureSidebarDelegation();

  const convs = (state.conversations || []).filter(c => !c.synthetic && !c.syntheticType);
  const visible = convs.filter(c => {
    const clearedAt = getConversationClearedAt(c);
    return !(clearedAt && (c.lastMessageAt || 0) <= clearedAt && !(c.unread > 0));
  });

  let sig = '';
  for (const c of visible) sig += c.id + ':' + (c.unread||0) + ':' + (c.preview||'') + ':' + (c.peerAvatarUrl||'') + ':' + (c.title||'') + ';';
  sig += (state.activeConversation?.id || '') + ':' + state.sidebarMode;
  if (sig === _sidebarSignature) return;
  _sidebarSignature = sig;

  const frag = document.createDocumentFragment();
  const expanded = state.sidebarMode === 'expanded';
  const activeId = state.activeConversation?.id;
  for (const conv of visible) {
    const item = createEl('div', 'sidebar-item' + (activeId === conv.id ? ' is-active' : ''));
    item.dataset.convId = conv.id;

    const avatarWrap = createEl('div', 'sidebar-item-avatar');
    const safeAvatar = normalizeMediaUrl(conv.peerAvatarUrl);
    if (safeAvatar) {
      const img = createEl('img');
      img.src = safeAvatar;
      img.alt = '';
      img.onerror = function() { this.remove(); avatarWrap.textContent = firstChar(conv.title); };
      avatarWrap.appendChild(img);
    } else {
      avatarWrap.textContent = firstChar(conv.title);
    }

    if (conv.unread > 0) {
      const muted = isConversationMuted(conv);
      avatarWrap.appendChild(createEl('span', muted ? 'sidebar-badge-dot' : 'sidebar-badge', muted ? null : (conv.unread > 99 ? '99+' : String(conv.unread))));
    }
    item.appendChild(avatarWrap);

    if (expanded) {
      item.append(createEl('div', 'sidebar-item-name', conv.title || ''), createEl('div', 'sidebar-item-preview', conv.preview || ''));
    }

    frag.appendChild(item);
  }
  list.replaceChildren(frag);
}

function applySidebarMode() {
  const panel = $('sidebarPanel');
  const shell = $('appScreen');
  const btn = $('sidebarToggleBtn');
  if (!panel || !shell) return;
  panel.classList.remove('sidebar-expanded', 'sidebar-collapsed', 'sidebar-hidden-mode');
  shell.classList.remove('sidebar-hidden');
  if (state.sidebarMode === 'expanded') {
    panel.classList.add('sidebar-expanded');
    if (btn) btn.title = '切换为仅头像';
  } else if (state.sidebarMode === 'collapsed') {
    panel.classList.add('sidebar-collapsed');
    if (btn) btn.title = '关闭侧栏';
  } else {
    panel.classList.add('sidebar-hidden-mode');
    shell.classList.add('sidebar-hidden');
    if (btn) btn.title = '展开侧栏';
  }
  _sidebarSignature = '';
  renderSidebar();
}

function cycleSidebarMode() {
  if (state.sidebarMode === 'expanded') state.sidebarMode = 'collapsed';
  else if (state.sidebarMode === 'collapsed') state.sidebarMode = 'hidden';
  else state.sidebarMode = 'expanded';
  try { localStorage.setItem('chatSidebarMode', state.sidebarMode); } catch(_) {}
  applySidebarMode();
}

function refreshConversations() {
  sortConversationsInPlace();
  renderConversationListFromState();
  loadConversations();
}

function syncAndRenderConvList(scheduled) {
  syncActiveConversationListMeta();
  if (scheduled) scheduleRenderConversationList();
  else renderConversationListFromState();
}

let _renderConvListTimer = null;
function scheduleRenderConversationList() {
  if (_renderConvListTimer) return;
  _renderConvListTimer = requestAnimationFrame(() => { _renderConvListTimer = null; renderConversationListFromState(); });
}
function renderConversationListFromState() {
  bindConversationSwipeDismiss();
  let filteredConvs = state.conversations || [];

  const tradeReadAt = state.tradeAlertReadAt || 0;
  let tradeUnread = 0;
  const tradeOrders = [];
  const _orderSources = [state.buyerOrders, state.sellerOrders];
  for (let s = 0; s < 2; s++) {
    const src = _orderSources[s] || [];
    for (let i = 0; i < src.length; i++) {
      const o = src[i];
      if (o && o.status !== 'completed') { tradeOrders.push(o); if (Number(o.updatedAt || o.createdAt || 0) > tradeReadAt) tradeUnread++; }
    }
  }
  const tradeConv = tradeOrders.length ? {
    id: '__trade_alert__',
    title: '交易提醒',
    preview: `待处理 ${tradeOrders.length} 单（拉黑不影响交易提醒）`,
    unread: tradeUnread,
    muted: false,
    pinned: true,
    peerAvatarUrl: '',
    lastMessageAt: tradeOrders.reduce((max, o) => Math.max(max, Number(o.updatedAt || o.createdAt || 0)), Date.now()),
    synthetic: true,
    syntheticType: 'trade',
  } : null;
  const latestSystem = (state.systemMessages || [])[0];
  const systemHasNew = latestSystem && Number(latestSystem.createdAt || 0) > (state.systemMessagesReadAt || 0);
  const systemConv = latestSystem ? {
    id: '__system_message__',
    title: '系统消息',
    preview: latestSystem.title || '新通知',
    unread: systemHasNew ? 1 : 0,
    muted: false,
    pinned: true,
    peerAvatarUrl: '',
    lastMessageAt: Number(latestSystem.createdAt || Date.now()),
    synthetic: true,
    syntheticType: 'system',
  } : null;

  let totalUnread = 0;
  const visible = filteredConvs.filter((conv) => {
    const clearedAt = getConversationClearedAt(conv);
    if (clearedAt && (conv.lastMessageAt || 0) <= clearedAt && !(conv.unread > 0)) return false;
    if (conv.unread && !isConversationMuted(conv)) totalUnread += conv.unread;
    return true;
  });
  if (tradeConv) visible.unshift(tradeConv);
  if (systemConv) visible.unshift(systemConv);

  const nextSignature = buildConversationSignature(visible, totalUnread);
  const container = $("chatList");
  if (nextSignature === state.chatListSignature) {
    updateMessagesTabBadge(totalUnread);
    return;
  }
  state.chatListSignature = nextSignature;

  if(container) {
    if (visible.length === 0) {
      state.conversationItemSignatures = {};
      container.replaceChildren(createEmptyChatListNode());
    } else {
      state.conversationItemSignatures = reconcileList(container, visible, {
        selector: '[data-conversation-id]',
        dataKey: 'conversationId',
        keyFn: (conv) => String(conv.id),
        sigFn: buildConversationItemSignature,
        buildFn: buildConversationRow,
        patchFn: patchConversationRow,
        sigStore: state.conversationItemSignatures,
      });
    }
  }
  updateMessagesTabBadge(totalUnread);
  renderSidebar();
}

const loadSystemMessages = singleFlight(async function _loadSystemMessagesImpl(){
  if(!state.currentUser) return;
  try{
    const data = await api('/api/system/messages');
    state.systemMessages = data.items || [];
  }catch(_){
    state.systemMessages = [];
  }
  scheduleRenderConversationList();
});

function renderSystemMessagesList(){
  const list = $("systemMessagesList");
  if(!list) return;
  const msgs = state.systemMessages || [];
  if(!msgs.length){
    showEmptyState(list, '📢 暂无系统消息', 'order-empty-state');
    return;
  }
  const frag = document.createDocumentFragment();
  msgs.forEach(msg => {
    const card = buildProfileCard(msg.title || '系统通知', msg.summary || msg.text || '', 'button');
    const time = createEl('div', 'order-card-time', msg.createdAt ? formatTime(msg.createdAt) : '');
    time.style.marginTop = '6px';
    card.appendChild(time);
    card.addEventListener('click', () => openBroadcastDetail(msg.title || '系统消息', msg.summary || msg.text || ''));
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
  state.systemMessagesReadAt = Date.now();
}

const loadConversations = singleFlight(async function _loadConversationsImpl() {
  try {
    const data = await api(`/api/conversations?userId=${encodeURIComponent(state.currentUser.id)}`);
    state.conversations = (data.conversations || []).map(normalizeConversation);
    state.conversationsById = new Map();
    state.mutedConvIds = new Set();
    state.pinnedConvIds = new Set();
    const uid = state.currentUser?.id;
    for (const c of state.conversations) {
      state.conversationsById.set(c.id, c);
      if (c.muted === true || (Array.isArray(c.mutedBy) && uid && c.mutedBy.includes(uid))) state.mutedConvIds.add(c.id);
      if (c.pinned === true || (Array.isArray(c.pinnedBy) && uid && c.pinnedBy.includes(uid))) state.pinnedConvIds.add(c.id);
    }
    if (state.activeConversation) {
      const next = state.conversationsById.get(state.activeConversation.id);
      if (next) Object.assign(state.activeConversation, {
        title: next.title || state.activeConversation.title,
        peerAvatarUrl: next.peerAvatarUrl || state.activeConversation.peerAvatarUrl,
        peerIsFriend: next.peerIsFriend === true,
        muted: !!next.muted,
        pinned: !!next.pinned,
        clearedAt: next.clearedAt || 0,
        peerLastReadAt: Number(next.peerLastReadAt || 0),
        unread: next.unread || 0,
        lastMessageAt: next.lastMessageAt || 0,
        preview: next.preview || ''
      });
      applyChatRelationshipState();
    }
    sortConversationsInPlace();
    renderConversationListFromState();
    refreshMessageReadReceipts();
  } catch(e) { console.error(e); }
});

// ==========================================
// ★ 4. 引擎强力发车 ★
// ==========================================
async function bootstrap() {
  bindAllEvents(); // 无论如何先把所有事件绑定好

  try {
    const session = readSession();
    const user = session.user;
    state.sessionToken = session.token || null;
    state.csrfToken = session.csrfToken || null;
    if (!user || !user.id || !state.sessionToken) { showEl("authScreen"); return; }

    // Show app screen immediately with cached user data to avoid blank white page
    state.currentUser = user;
    nativeOnLogin(user.id);
    loadCartFromStorage();
    updateMyCartBadge();
    hideEl("authScreen");
    showEl("appScreen");

    try {
      const _ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const _to = _ac ? setTimeout(() => _ac.abort(), 8000) : null;
      const refreshed = await api(`/api/users/${user.id}/profile?viewerId=${user.id}`, _ac ? { signal: _ac.signal } : {});
      if (_to) clearTimeout(_to);
      if(refreshed.profile) {
        user.displayName = refreshed.profile.nickname; user.avatarUrl = refreshed.profile.avatarUrl; user.signature = refreshed.profile.signature; user.appNumberId = refreshed.profile.appNumberId; user.customGroups = normalizeCustomGroups(refreshed.profile.customGroups); user.paymentCodes = refreshed.profile.paymentCodes || user.paymentCodes || { wechat:'', alipay:'', cloudpay:'' }; user.phone = refreshed.profile.phone || user.phone || '';
        writeSession(user);
        state.currentUser = user;
      }
    } catch(e) {
      // If session is truly expired (401), redirect to login
      if (!e.isNetworkError && e.name !== 'AbortError') {
        console.warn("账号已失效，需重新登录");
        localStorage.removeItem(SESSION_KEY);
        state.currentUser = null;
        hideEl("appScreen");
        showEl("authScreen");
        return;
      }
      // Network error or timeout: stay on app screen with cached data
      console.warn("网络异常，使用缓存数据", e);
    }
    
    setText("profileDisplayName", state.currentUser.displayName); 
    setText("profileUsername", `ID: ${state.currentUser.appNumberId}`); 
    setAvatarContainer($("myProfileAvatar"), state.currentUser, state.currentUser.displayName);
    
    connectRealtime().catch(() => {});

    ['messages', 'friends', 'mall', 'profile'].forEach(t => { if($(t+'Tab')) $(t+'Tab').classList.remove('active'); });
    if($('messagesTab')) $('messagesTab').classList.add('active');
    hideTabViews();
    showEl("chatListView");
    setText("chatTitle", "微信"); 
    
    loadConversations().catch(() => {});
    loadSystemMessages().catch(() => {});
    loadFriendRequests().catch(() => {});
    scheduleTradeReminderRefresh(0);
  } catch (err) {
    console.error("启动崩溃:", err);
    // 万一发生严重白屏错误，强行恢复登录页防止假死
    if($("authScreen") && $("authScreen").classList.contains("hidden") && $("appScreen") && $("appScreen").classList.contains("hidden")) {
        localStorage.removeItem(SESSION_KEY);
        $("authScreen").classList.remove("hidden");
        showModal("页面重载异常，请重新登录");
    }
  }
}

// 暴力启动，绝不等待任何事件
bootstrap();
