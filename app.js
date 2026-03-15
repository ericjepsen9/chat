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
// Hoisted regex constants — avoid recompilation on every call
const _RE_CT_ID = /CT\d{5,}/i;
const _RE_CTID_EXTRACT = /(?:^|chattrade:|ctid:)([A-Za-z0-9_-]{4,})$/i;
const _RE_REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

// safeRender is now defined in app_utils.js (loaded before all other scripts)

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
  secondaryStack: [],
  _ctxMenuVersion: 0
};
let isMuted = false, isCameraOff = false, isSpeaker = false;
const CATEGORY_SPLIT_RE = /[\/,、]/;
function _splitCategories(str) {
  if (!str) return [];
  const parts = str.split(CATEGORY_SPLIT_RE);
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i].trim();
    if (t) result.push(t);
  }
  return result;
}
const formatOrderId = (id) => String(id || '').slice(-6);
const orderPrefix = (role) => role === 'seller' ? 'seller' : 'buyer';
const orderStatusCls = (prefix, st) => { const s = String(st || '').toLowerCase(); return prefix + (s === 'completed' ? ' s-done' : (s === 'accepted' || s === 'processing' || s === 'in_progress') ? ' s-active' : ' s-pending'); };
const tradeStatusCls = (st) => 'trade-card-status' + (st === 'completed' ? ' done' : st === 'accepted' ? ' active' : '');

const isFriendUser = (userId) => !!(userId && state.friendsById.has(userId));

function findFriendEntry(userId) {
  return state.friendsById.get(userId);
}

function getPendingFriendRequest(userId) {
  // Use pre-built index for O(1) lookup when available
  if (state._pendingRequestsBySenderId) return state._pendingRequestsBySenderId.get(userId) || null;
  return state.friendRequests.find(r => r.status === 'pending' && (r.sender?.id === userId || r.fromUser?.id === userId)) || null;
}

let _profileActionEls = null;
function _getProfileActionEls() {
  if (!_profileActionEls) _profileActionEls = {
    addBtn: $("profileAddFriendBtn"), hint: $("profileStrangerHint"),
    remarkBtn: $("profileActionRemarkBtn"), moveBtn: $("profileActionMoveGroupBtn"),
    sendBtn: $("profileSendMessageBtn"), primaryActs: $("profilePrimaryActions"),
    reqActs: $("profileFriendRequestActions"),
    acceptBtn: $("profileAcceptRequestBtn"), rejectBtn: $("profileRejectRequestBtn")
  };
  return _profileActionEls;
}
function updateProfileDetailActions(){
  const p = state.currentProfileUser;
  if(!p) return;
  const isFriend = !!p.isFriend || isFriendUser(p.id);
  const isSelf = p.id === state.currentUser?.id;
  const pendingReq = !isFriend && !isSelf ? getPendingFriendRequest(p.id) : null;
  const { addBtn, hint, remarkBtn, moveBtn, sendBtn, primaryActs, reqActs, acceptBtn, rejectBtn } = _getProfileActionEls();
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

let _cachedCartSummary = null;
function invalidateCartSummary() { _cachedCartSummary = null; }
function getCartSummary() {
  if (_cachedCartSummary) return _cachedCartSummary;
  let count = 0, total = 0;
  const cartBySeller = state.profileCartBySeller || {};
  for (const sellerId in cartBySeller) {
    const arr = cartBySeller[sellerId];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const qty = Number(arr[i].quantity) || 0;
      count += qty;
      total += (Number(arr[i].unitPrice) || 0) * qty;
    }
  }
  _cachedCartSummary = { count, total };
  return _cachedCartSummary;
}
function getGroupedCartTotal(){ return getCartSummary().total; }
function getGroupedCartCount(){ return getCartSummary().count; }
const CART_STORAGE_KEY = 'chattrade_cart';
let _cartSaveTimer = null;
function saveCartToStorage() {
  invalidateCartSummary();
  if (_cartSaveTimer) return;
  _cartSaveTimer = setTimeout(() => {
    _cartSaveTimer = null;
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.profileCartBySeller || {})); } catch(_) {}
  }, 100);
}
function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (raw) state.profileCartBySeller = JSON.parse(raw) || {};
  } catch(_) { state.profileCartBySeller = {}; }
  invalidateCartSummary();
}

// formatMoney, parseMoney moved to app_utils.js

function getSecondaryBackTarget(defaultTarget = 'home'){
  if (state.secondaryPage) return state.secondaryPage;
  if (state.secondaryReturn) return state.secondaryReturn;
  return defaultTarget;
}


// Order management moved to app_orders.js





function updateSellerProductsFilterUI(){
  const listedTab = $("sellerProductsListedTab");
  const unlistedTab = $("sellerProductsUnlistedTab");
  if (listedTab) listedTab.classList.toggle('active', state.sellerProductViewTab !== 'unlisted');
  if (unlistedTab) unlistedTab.classList.toggle('active', state.sellerProductViewTab === 'unlisted');
  const _spSearch = $("sellerProductsSearchInput");
  const _spSort = $("sellerProductsSortSelect");
  const _spCatFilt = $("sellerProductsCategoryFilter");
  if (_spSearch) _spSearch.value = state.sellerProductSearch || '';
  if (_spSort) _spSort.value = state.sellerProductSort || 'newest';
  if (_spCatFilt) _spCatFilt.value = state.sellerProductCategoryFilter || '';
}

function populateSellerCategoryFilter(){
  const sel = $("sellerProductsCategoryFilter");
  if (!sel) return;
  // Collect categories from seller's own products + presets
  const cats = new Set();
  (state.sellerProducts || []).forEach(p => {
    if (p.category) {
      if (!p._parsedCats) p._parsedCats = _splitCategories(p.category);
      p._parsedCats.forEach(c => cats.add(c));
    }
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

// Memoization cache for filtered seller products — avoids re-filtering when state hasn't changed
let _filteredSPCache = null;
let _filteredSPKey = '';
function getFilteredSellerProducts(){
  const all = Array.isArray(state.sellerProducts) ? state.sellerProducts : [];
  const showUnlisted = state.sellerProductViewTab === 'unlisted';
  const keyword = String(state.sellerProductSearch || '').trim().toLowerCase();
  const catFilter = String(state.sellerProductCategoryFilter || '').trim();
  const sortBy = state.sellerProductSort || 'newest';
  const cacheKey = `${all.length}:${showUnlisted}:${keyword}:${catFilter}:${sortBy}`;
  if (cacheKey === _filteredSPKey && _filteredSPCache) return _filteredSPCache;
  _filteredSPKey = cacheKey;
  const visible = all.filter((item) => {
    const listed = item?.listed !== false;
    if (showUnlisted ? listed : !listed) return false;
    if (catFilter) {
      if (!item._parsedCatsSet) item._parsedCatsSet = new Set(_splitCategories(item.category));
      if (!item._parsedCatsSet.has(catFilter)) return false;
    }
    if (keyword) {
      if (!(item._searchText || (item._searchText = `${item.title || ''} ${item.category || ''} ${item.desc || ''}`.toLowerCase())).includes(keyword)) return false;
    }
    return true;
  });
  if (sortBy === 'price_asc' || sortBy === 'price_desc') {
    for (const p of visible) p._sortPrice = parseMoney(p.price);
    visible.sort((a, b) => sortBy === 'price_asc' ? a._sortPrice - b._sortPrice : b._sortPrice - a._sortPrice);
  } else if (sortBy === 'stock_desc') {
    visible.sort((a, b) => (Number(b.stock)||0) - (Number(a.stock)||0));
  } else {
    visible.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  _filteredSPCache = visible;
  return visible;
}

const renderSellerProductsManage = safeRender(function renderSellerProductsManage(){
  const list = $("sellerProductsList");
  if(!list) return;
  if (list.dataset.spClickBound !== '1') {
    list.dataset.spClickBound = '1';
    list.addEventListener('click', (e) => {
      const card = e.target.closest('.sp-card[data-product-id]');
      if (!card) return;
      const _findSP = (pid) => state._sellerProductsById ? state._sellerProductsById.get(pid) : (state.sellerProducts || []).find(p => String(p.id) === pid);
      const actionBtn = e.target.closest('.sp-action-btn');
      if (actionBtn) {
        const pid = card.dataset.productId;
        const act = actionBtn.dataset.action;
        const item = _findSP(pid);
        if (!item) return;
        if (act === 'edit') window.openPublishProductPage('sellerProductsPage', item);
        else if (act === 'stock') window.updateSellerProductStock(item.id, item.stock || 0);
        else if (act === 'toggle') withButtonLock(actionBtn, () => window.toggleSellerProductListed(item.id, item.listed === false));
        else if (act === 'delete') window.deleteMyProduct(item.id);
        return;
      }
      const item = _findSP(card.dataset.productId);
      if (item) openProductDetail(item, true);
    });
  }
  populateSellerCategoryFilter();
  updateSellerProductsFilterUI();
  const products = getFilteredSellerProducts();
  const _sigParts = new Array(products.length);
  for (let i = 0; i < products.length; i++) { const p = products[i]; _sigParts[i] = p.id + '|' + (p.listed?1:0) + '|' + (p.stock||0) + '|' + (p.price||''); }
  const sig = _sigParts.join(';') + '|' + state.sellerProductViewTab + '|' + state.sellerProductSearch + '|' + state.sellerProductSort + '|' + (state.sellerProductCategoryFilter||'');
  if (!sigChanged('sellerProducts', sig)) return;
  if(!products.length){ showEmptyState(list, '📦 ' + (state.sellerProductViewTab === 'unlisted' ? '暂无未上架商品' : '暂无已上架商品，可先发布'), 'order-empty-state'); return; }
  const frag = document.createDocumentFragment();
  products.forEach(item => {
    const card = createEl('div', 'sp-card');
    card.dataset.productId = String(item.id || '');
    // Card click handled via delegation on sellerProductsList

    const imgUrl = normalizeMediaUrl(item.image || item.imageUrl) || '';
    if (imgUrl) {
      const img = createEl('img', 'sp-card-img');
      lazyImg(img, imgUrl);
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

    const editBtn = createEl('button', 'sp-action-btn', '编辑'); editBtn.dataset.action = 'edit';
    const stockBtn = createEl('button', 'sp-action-btn', '改库存'); stockBtn.dataset.action = 'stock';
    const listedBtn = createEl('button', 'sp-action-btn' + (item.listed === false ? ' accent' : ''), item.listed === false ? '上架' : '下架'); listedBtn.dataset.action = 'toggle';
    const delBtn = createEl('button', 'sp-action-btn danger', '删除'); delBtn.dataset.action = 'delete';

    actions.append(editBtn, stockBtn, listedBtn, delBtn);
    body.appendChild(actions);
    card.appendChild(body);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
});


// Product/order detail moved to app_orders.js

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


// Cart, shopping & checkout moved to app_shopping.js


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

function bindProfileOrdersDelegation(list) {
  if (list.dataset.profOrderBound === '1') return;
  list.dataset.profOrderBound = '1';
  list.addEventListener('click', (e) => {
    if (e.target.closest('.profile-order-actions')) return;
    const card = e.target.closest('[data-order-id]');
    if (!card) return;
    const orderId = card.dataset.orderId;
    const order = state.ordersById?.get(orderId) || (state.profileOrders || []).find(o => o.id === orderId);
    if (order) openOrderDetail(order, card.dataset.orderRole || 'buyer');
  });
}
function renderProfileOrders(){
  const list = $("profileOrdersList");
  if(!list) return;
  bindProfileOrdersDelegation(list);
  const _poLen = state.profileOrders.length;
  const _poParts = new Array(_poLen);
  for (let i = 0; i < _poLen; i++) { const o = state.profileOrders[i]; _poParts[i] = o.id + '|' + o.status + '|' + (o.total||0); }
  const sig = _poParts.join(';');
  if (!sigChanged('profileOrders', sig)) return;
  if(!_poLen){
    showEmptyState(list, '暂无订单');
    return;
  }
  const frag = document.createDocumentFragment();
  state.profileOrders.forEach(order => {
    const names = order._itemSummary || (order._itemSummary = (order.items || []).map(i => `${i.title}(${i.spec || '默认'}) x${i.quantity || 1}`).join('，'));
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
    card.dataset.orderId = order.id;
    card.dataset.orderRole = (state.currentUser?.id && state.currentUser.id === order.buyerId) ? 'buyer' : 'seller';
    // Click handled via delegation on profileOrdersList
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
  const el = $("chatSubtitle");
  if(!el) return;
  const peerId = conversationPeerId(state.activeConversation);
  if(!peerId) { el.textContent = ''; return; }
  const convFriendState = state.activeConversation?.peerIsFriend === true
    || state.conversationsById?.get(state.activeConversation?.id)?.peerIsFriend === true;
  el.textContent = (convFriendState || isFriendUser(peerId)) ? '' : '对方还不是你的好友';
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

// Contact cards & trade pickers moved to app_contacts.js
// Message indexing, building & rendering moved to app_chat.js
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
  const fromOther = message && message.senderId && message.senderId !== state.currentUser?.id;
  if (state.activeConversation && state.activeConversation.id === conversationId) conv.unread = 0;
  else if (fromOther) conv.unread = (conv.unread || 0) + 1;
  sortConversationsInPlace();
}
function buildConversationSignature(visible, totalUnread) {
  const parts = [totalUnread, ':'];
  for (const conv of visible) {
    parts.push(conv.id, '|', conv.title || '', '|', conv.preview || '', '|', conv.unread || 0,
      '|', conv.muted ? 1 : 0, '|', conv.pinned ? 1 : 0,
      '|', conv.peerAvatarUrl || '', '|', conv.clearedAt || 0,
      '|', conv.lastMessageAt || 0, ';');
  }
  return parts.join('');
}
function buildFriendListSignature(customGroups, grouped) {
  const parts = [];
  for (const groupName of customGroups) {
    parts.push(groupName, ':');
    for (const item of (grouped.get(groupName) || [])) {
      parts.push(item.friend.id, '|', item.friend.displayName || '', '|', item.friend.remark || '', '|', item.friend.avatarUrl || '', ',');
    }
    parts.push(';');
  }
  return parts.join('');
}
function buildMallSignature(products) {
  const parts = [];
  for (const p of products) {
    parts.push(p.id, '|', p.title || '', '|', p.price, '|', p.image || '',
      '|', p.sellerId || '', '|', p.sellerName || '',
      '|', p.location || '', '|', p.distance ?? '', ';');
  }
  return parts.join('');
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
  // Mutate in-place instead of spread-copying the entire object
  conv.muted = isConversationMuted(conv);
  conv.pinned = isConversationPinned(conv);
  conv.clearedAt = getConversationClearedAt(conv);
  conv.peerLastReadAt = Number(conv.peerLastReadAt || 0);
  return conv;
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
  const list = $("chatList");
  if (!list) return;
  const rows = list.querySelectorAll('.revealed');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (exceptWrap && row === exceptWrap) continue;
    row.classList.remove('revealed');
  }
}

function bindConversationSwipeDismiss(){
  const list = $("chatList");
  if (!list || list.dataset.swipeDismissBound === '1') return;
  list.dataset.swipeDismissBound = '1';
  let _swipeScrollThrottled = false;
  list.addEventListener('scroll', () => {
    if (_swipeScrollThrottled) return;
    _swipeScrollThrottled = true;
    setTimeout(() => { _swipeScrollThrottled = false; }, 150);
    closeConversationSwipeRows();
  }, { passive: true });
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
        const hasPendingSeller = (state.sellerOrders || []).some(o => o && o.status !== 'completed');
        if (hasPendingSeller) window.openSecondaryPage('sellerOrdersPage', 'home');
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

function bindFriendListDelegation() {
  const list = $("friendList");
  if (!list || list.dataset.friendClickBound === '1') return;
  list.dataset.friendClickBound = '1';
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.chat-item[data-friend-id]');
    if (!btn || e.target.closest('.friend-req-actions')) return;
    const fid = btn.dataset.friendId;
    if (fid) window.openUserProfile(fid, btn.dataset.friendName || '');
  });
}

function bindRequestsListDelegation() {
  const list = $("requestsList");
  if (!list || list.dataset.reqClickBound === '1') return;
  list.dataset.reqClickBound = '1';
  list.addEventListener('click', (e) => {
    const acceptBtn = e.target.closest('.friend-req-accept-btn');
    if (acceptBtn) { e.stopPropagation(); const rid = acceptBtn.dataset.requestId; if (rid) window.acceptRequest(rid); return; }
    const rejectBtn = e.target.closest('.secondary-btn[data-reject-id]');
    if (rejectBtn) { e.stopPropagation(); const rid = rejectBtn.dataset.rejectId; if (rid) window.rejectRequest(rid); return; }
    const row = e.target.closest('.chat-item[data-sender-id]');
    if (row) { const sid = row.dataset.senderId; if (sid) window.openUserProfile(sid, row.dataset.senderName || ''); }
  });
}

function attachConversationSwipeDelete(wrap, onDelete, delBtn) {
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
      content.classList.add('swipe-dragging');
      content.style.transform = `translateX(${clamped}px)`;
    }
  };

  const finish = (x, y) => {
    if (!tracking) return;
    tracking = false;
    content.classList.remove('swipe-dragging');
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

  if (!delBtn) delBtn = wrap.querySelector('.chat-swipe-delete-btn');
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
  }, deleteBtn);

  if (pinBtn) {
    pinBtn.addEventListener('click', async (e) => {
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
  btn.dataset.friendName = item.friend.displayName || '';
  // Click handled via delegation on friendList container
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
  // Click handled via delegation on mall-grid container
  const safeImage = normalizeMediaUrl(product.image);
  if (safeImage) {
    const img = createEl('img', '');
    lazyImg(img, safeImage);
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
let _cachedAuthSteps = null;
window.authGotoStep = (stepId) => {
  if (!_cachedAuthSteps) _cachedAuthSteps = document.querySelectorAll('#authScreen .auth-step');
  for (let i = 0; i < _cachedAuthSteps.length; i++) { const s = _cachedAuthSteps[i]; if (!s.classList.contains('hidden')) s.classList.add('hidden'); }
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
let _cachedAllViewEls = null;
let _cachedTabViewEls = null;
function hideAllViews() {
  if (!_cachedAllViewEls) _cachedAllViewEls = ALL_VIEW_IDS.map(id => $(id)).filter(Boolean);
  for (let i = 0; i < _cachedAllViewEls.length; i++) _cachedAllViewEls[i].classList.add('hidden');
}
function hideTabViews() {
  if (!_cachedTabViewEls) _cachedTabViewEls = TAB_VIEW_IDS.map(id => $(id)).filter(Boolean);
  for (let i = 0; i < _cachedTabViewEls.length; i++) _cachedTabViewEls[i].classList.add('hidden');
}

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
  // Find and splice instead of .filter() + spread copy
  let removedMsg = null, removedIdx = -1;
  for (let i = 0; i < state.messages.length; i++) {
    if (state.messages[i].id === id) { removedIdx = i; removedMsg = state.messages[i]; state.messages.splice(i, 1); break; }
  }
  rebuildMessagesById();
  if (!removeMessageFromView(id)) renderMessages();
  applyLastOutgoingReadState();
  try {
    await api(`/api/conversations/${conversationId}/messages/${id}/delete`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
    syncAndRenderConvList();
    loadConversations();
  } catch(e) {
    if (removedMsg !== null) { state.messages.splice(removedIdx, 0, removedMsg); }
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
  let menuShownAt = 0;
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
      menuShownAt = Date.now();
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
    if (Date.now() - menuShownAt < 500) return;
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
    for (let i = 0; i < state.conversations.length; i++) {
      const c = state.conversations[i];
      const btn = createEl('button', 'chat-item');
      btn.type = 'button';
      btn.dataset.convId = c.id;
      appendUserInfo(btn, {avatarUrl: c.peerAvatarUrl, displayName: c.title}, c.title || '');
      list.appendChild(btn);
    }
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
  const menuVersion = ++state._ctxMenuVersion;
  const openTime = Date.now();
  const closeMenu = (e) => {
    if (state._ctxMenuVersion !== menuVersion) return;
    if (Date.now() - openTime < 400) return;
    if (e && e.target.closest('#contextMenu')) return;
    menu.classList.add('hidden'); menu.replaceChildren();
    document.removeEventListener('click', closeMenu, true); document.removeEventListener('touchstart', closeMenu, true);
    state._ctxMenuClose = null;
  };
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
      const mm = raw.match(_RE_CTID_EXTRACT);
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
            const mm = raw.match(_RE_CTID_EXTRACT);
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
  if (state.scanStream) { try { const trks = state.scanStream.getTracks(); for (let i = 0; i < trks.length; i++) trks[i].stop(); } catch(_) {} }
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
    await Promise.all([
      fetchMessages(),
      api(`/api/conversations/${id}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }), signal }).catch(() => {})
    ]);
    if (signal?.aborted) return;
    scheduleReceiptRefresh();
  } else {
    Promise.resolve().then(async () => {
      try {
        if (signal?.aborted || !state.activeConversation || state.activeConversation.id !== id) return;
        await Promise.all([
          fetchMessages(),
          api(`/api/conversations/${id}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }), signal }).catch(() => {})
        ]);
        if (signal?.aborted || state.activeConversation?.id !== id) return;
        scheduleReceiptRefresh();
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
      syncActiveConversationListMeta();
      renderConversationListFromState();
      scheduleReceiptRefresh();
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
    const boxArray = Array.from(boxes); // Pre-convert once instead of per-input event
    boxArray.forEach((box, i) => {
      box.addEventListener('input', () => {
        const v = box.value.replace(/\D/g, '');
        box.value = v.slice(0, 1);
        if (v && i < boxArray.length - 1) boxArray[i + 1].focus();
        const code = boxArray.map(b => b.value).join('');
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
  const _codeBoxCache = {};
  function clearCodeBoxes(containerId) {
    const container = $(containerId);
    if (!container) return;
    const boxes = _codeBoxCache[containerId] || (_codeBoxCache[containerId] = container.querySelectorAll('.auth-code-box'));
    boxes.forEach(b => { b.value = ''; });
    if (boxes[0]) boxes[0].focus();
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
    const sourceEl = type === 'terms'
      ? $("termsPage")?.querySelector('.legal-content')
      : $("privacyPolicyPage")?.querySelector('.legal-content');
    const content = $("authTermsContent");
    if (content) {
      content.textContent = '';
      if (sourceEl) { const clone = sourceEl.cloneNode(true); while (clone.firstChild) content.appendChild(clone.firstChild); }
    }
    // Find which auth step is currently visible to go back to
    const allSteps = document.querySelectorAll('#authScreen .auth-step');
    allSteps.forEach(s => { if (!s.classList.contains('hidden') && s.id !== 'authTermsView') window._authTermsBackTarget = s.id; });
    authGotoStep('authTermsView');
  }
  // Delegated auth event listeners — single listener instead of per-element
  const authScreen = $("authScreen");
  if (authScreen) authScreen.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('.auth-open-terms')) { e.preventDefault(); e.stopPropagation(); authOpenLegal('terms'); return; }
    if (t.closest('.auth-open-privacy')) { e.preventDefault(); e.stopPropagation(); authOpenLegal('privacy'); return; }
    const backBtn = t.closest('[data-auth-back]');
    if (backBtn) { authGotoStep(backBtn.dataset.authBack); return; }
    const gotoBtn = t.closest('[data-auth-goto]');
    if (gotoBtn) { authGotoStep(gotoBtn.dataset.authGoto); return; }
  });
  on("authTermsBackBtn", "click", () => authGotoStep(window._authTermsBackTarget));

  // ---- Welcome screen buttons ----
  on("authGoLogin", "click", () => authGotoStep('authLoginPhone'));
  on("authGoRegister", "click", () => authGotoStep('authRegPhone'));

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
      { const tagEls = wrap.querySelectorAll('.tag-item'); for (let ti = tagEls.length - 1; ti >= 0; ti--) tagEls[ti].remove(); }
      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const span = createEl('span', 'tag-item', tag);
        const btn = createEl('button', 'tag-item-remove', '\u00d7');
        btn.type = 'button';
        btn.addEventListener('click', ((idx) => (e) => { e.stopPropagation(); tags.splice(idx, 1); render(); renderPresetChips(); })(i));
        span.appendChild(btn);
        wrap.insertBefore(span, input);
      }
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
    categoryTags.setTags(presetProduct?.category ? _splitCategories(presetProduct.category) : []);
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
  window.openPublishProductPage = openPublishProductPage;

  on("publishProductEntryBtn", "click", () => { openPublishProductPage('mall'); });

  // Mall location refresh
  on("mallLocationRefreshBtn", "click", () => { refreshUserLocation(); });

  // Mall tab switching
  if ($("mallTabs")) $("mallTabs").addEventListener("click", (e) => {
    const tab = e.target.closest('.mall-tab');
    if (!tab || !tab.dataset.mallTab) return;
    { const actTabs = e.currentTarget.querySelectorAll('.mall-tab.active'); for (let ti = 0; ti < actTabs.length; ti++) actTabs[ti].classList.remove('active'); }
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
    on(`${role}OrdersSearchInput`, "input", debounce(() => { state[`${role}OrderSearch`] = $(`${role}OrdersSearchInput`)?.value?.trim() || ''; renderFn(); }, 200));
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

  // Seller action buttons on product detail page — use event delegation on
  // the container so clicks always reach the handler even if individual button
  // bindings are lost (e.g. after DOM re-renders or lazy element insertion).
  const _pdSellerActionsEl = $("productDetailSellerActions");
  if (_pdSellerActionsEl) {
    _pdSellerActionsEl.addEventListener("click", async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const item = state.selectedProductDetail;
      if (!item) return;
      const btnId = btn.id;
      if (btnId === 'productDetailEditBtn') {
        openPublishProductPage('productDetailPage', item);
      } else if (btnId === 'productDetailStockBtn') {
        window.updateSellerProductStock(item.id, item.stock || 0);
      } else if (btnId === 'productDetailListedBtn') {
        const nextListed = item.listed === false;
        await window.toggleSellerProductListed(item.id, nextListed);
        state.selectedProductDetail.listed = nextListed;
        const _listedBtn = $("productDetailListedBtn");
        if (_listedBtn) {
          _listedBtn.textContent = nextListed ? '下架' : '上架';
          _listedBtn.classList.toggle('accent', !nextListed);
        }
      } else if (btnId === 'productDetailDeleteBtn') {
        await window.deleteMyProduct(item.id);
        if ($("backBtn")) $("backBtn").click();
      }
    });
  }
  // Also keep direct bindings as fallback for accessibility
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
    state.selectedProductDetail.listed = nextListed;
    const _listedBtn = $("productDetailListedBtn");
    if (_listedBtn) {
      _listedBtn.textContent = nextListed ? '下架' : '上架';
      _listedBtn.classList.toggle('accent', !nextListed);
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
      const isFriend = isFriendUser(user.id);
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
    if ((state.specSheetQty || 1) + inCartQty + 1 > availableStock) {
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
  let _inputResizeRaf = 0;
  on("messageInput", "input", function() {
      // Defer height recalculation to next frame to avoid per-keystroke layout thrashing
      const el = this;
      if (!_inputResizeRaf) _inputResizeRaf = requestAnimationFrame(() => { _inputResizeRaf = 0; el.style.height = '0'; el.style.height = el.scrollHeight + 'px'; });
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
                  if (audioBlob.size > 10 * 1024 * 1024) return showModal('语音文件过大，请缩短录音');
                  const audioUrl = await uploadBinary(audioBlob, `voice_${Date.now()}.webm`, audioBlob.type || 'audio/webm');
                  await window.sendMessage({ type: 'audio', audioUrl });
              } catch (err) {
                  showModal('语音上传失败: ' + err.message);
              }
          };
          state.mediaRecorder.start();
      } catch(err) { setText("pttBtn", "按住 说话"); if (_pttStream) try { const trks = _pttStream.getTracks(); for (let i = 0; i < trks.length; i++) trks[i].stop(); } catch(_) {} showModal("无录音权限"); }
  });
  const stopPttRecording = () => {
      if($("pttBtn")) { $("pttBtn").textContent = "按住 说话"; $("pttBtn").style.background = "#fff"; }
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') { state.mediaRecorder.stop(); const trks = state.mediaRecorder.stream.getTracks(); for (let i = 0; i < trks.length; i++) trks[i].stop(); }
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
    const sellerId = item?.sellerId || state.currentProfileUser?.id || '';
    if(!item || !sellerId) return;
    window.openProductChat(sellerId, item.title || '商品', item.price || 0, normalizeMediaUrl(item.image || item.imageUrl) || '', item.id || item.productId || '');
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
  let _cooldownToast = null;
  let _cooldownToastTimer = null;
  function showCooldownToast(seconds) {
    if (!_cooldownToast) {
      _cooldownToast = createEl('div', 'search-cooldown-toast');
      document.body.appendChild(_cooldownToast);
    }
    _cooldownToast.textContent = `搜索太频繁，请 ${seconds} 秒后再试`;
    _cooldownToast.style.display = '';
    if (_cooldownToastTimer) clearTimeout(_cooldownToastTimer);
    _cooldownToastTimer = setTimeout(() => { _cooldownToast.style.display = 'none'; }, 1500);
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
      const kwRe = new RegExp(keyword.replace(_RE_REGEX_ESCAPE, '\\$&'), 'gi');
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
              const target = _lookupMsgElById(chatView, msgId);
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
  function clearSearchHighlights() {
    const cv = $("chatView");
    if (!cv) return;
    const marks = cv.querySelectorAll('.search-highlight');
    const parents = new Set();
    for (let i = marks.length - 1; i >= 0; i--) {
      const el = marks[i];
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parents.add(parent);
    }
    for (const p of parents) p.normalize();
    state._chatSearchResults = [];
    state._chatSearchIdx = -1;
  }
  on("chatSearchCloseBtn", "click", () => {
    hideEl("chatSearchBar");
    clearSearchHighlights();
  });
  let _chatSearchTimer = null;
  on("chatSearchInput", "input", () => {
    clearTimeout(_chatSearchTimer);
    _chatSearchTimer = setTimeout(() => {
      const searchInput = $("chatSearchInput");
      const keyword = (searchInput?.value || '').trim().toLowerCase();
      clearSearchHighlights();
      const countEl = $("chatSearchCount");
      if (!keyword) { if (countEl) countEl.textContent = ''; return; }
      // Search in loaded messages DOM
      const chatView = $("chatView");
      if (!chatView) return;
      const bubbles = chatView.querySelectorAll('.message-row:not(.system-msg) .bubble:not(.audio-bubble):not(.image-bubble)');
      const kwLen = keyword.length;
      const matches = [];
      for (let bi = 0; bi < bubbles.length; bi++) {
        const bubble = bubbles[bi];
        const text = (bubble.textContent || '').toLowerCase();
        if (!text.includes(keyword)) continue;
        // Highlight occurrences in this bubble
        const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        for (let ti = 0; ti < textNodes.length; ti++) {
          const node = textNodes[ti];
          const idx = node.textContent.toLowerCase().indexOf(keyword);
          if (idx === -1) continue;
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + kwLen);
          const mark = createEl('span', 'search-highlight');
          range.surroundContents(mark);
          matches.push(mark);
        }
      }
      state._chatSearchResults = matches;
      state._chatSearchIdx = matches.length > 0 ? 0 : -1;
      if (countEl) countEl.textContent = matches.length > 0 ? `1/${matches.length}` : '0';
      if (matches.length > 0) {
        matches[0].classList.add('search-active');
        matches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 250);
  });
  const chatSearchNav = (dir) => {
    const results = state._chatSearchResults || [];
    if (!results.length) return;
    const old = state._chatSearchIdx;
    if (old >= 0 && old < results.length) results[old].classList.remove('search-active');
    state._chatSearchIdx = (old + dir + results.length) % results.length;
    const cur = results[state._chatSearchIdx];
    cur.classList.add('search-active');
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
    if (parent) { const actEls = parent.querySelectorAll('.active'); for (let ti = 0; ti < actEls.length; ti++) actEls[ti].classList.remove('active'); }
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
    // Build product lookup for O(1) access by delegated click handlers
    const prodMap = new Map();
    for (const p of products) if (p.id) prodMap.set(String(p.id), p);
    state.mallProductsById = prodMap;
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
    if (grid.dataset.mallClickBound !== '1') {
      grid.dataset.mallClickBound = '1';
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('.product-card[data-product-id]');
        if (!card) return;
        const product = state.mallProductsById?.get(card.dataset.productId);
        if (product) openProductDetail(product, false);
      });
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
    let pendingCount = 0;
    const pendingIdx = new Map();
    for (let i = 0; i < state.friendRequests.length; i++) {
      const r = state.friendRequests[i];
      if (r.status === 'pending') {
        pendingCount++;
        const sid = r.sender?.id || r.fromUser?.id;
        if (sid) pendingIdx.set(sid, r);
      }
    }
    state._pendingRequestsBySenderId = pendingIdx;
    state._pendingFriendCount = pendingCount;
    const badgeText = pendingCount > 99 ? '99+' : (pendingCount ? String(pendingCount) : '');
    const tabBadge = $("friendsTabBadge");
    if (tabBadge) { tabBadge.classList.toggle("hidden", pendingCount === 0); tabBadge.textContent = badgeText; }
    const reqBadge = $("friendRequestBadge");
    if (reqBadge) { reqBadge.classList.toggle("hidden", pendingCount === 0); reqBadge.textContent = badgeText; }
    if($("requestsList")) {
      const container = $("requestsList");
      bindRequestsListDelegation();
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
        row.dataset.senderId = sender.id || '';
        row.dataset.senderName = senderName;
        const avatarWrap = createEl('div', 'avatar-click-wrap');
        setAvatarContainer(avatarWrap, sender, senderName);
        row.appendChild(avatarWrap);
        const info = createEl('div', 'friend-req-info');
        info.append(createEl('strong', '', senderName), createEl('div', 'preview', r.greeting || ''));
        row.appendChild(info);
        // Click handled via delegation on requestsList container
        if (r.status === 'pending') {
          const actions = createEl('div', 'friend-req-actions');
          const acceptBtn = createEl('button', 'primary-btn friend-req-accept-btn', '同意');
          acceptBtn.dataset.requestId = r.id;
          const rejectBtn = createEl('button', 'secondary-btn', '拒绝');
          rejectBtn.dataset.rejectId = r.id;
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
    if (keyword) filteredFriends = filteredFriends.filter(f => { const b = f.friend; if (!b) return false; return (b._lcName || (b._lcName = (b.displayName || '').toLowerCase())).includes(keyword) || (b._lcUser || (b._lcUser = (b.username || '').toLowerCase())).includes(keyword); });
    state.friends = data.friends;
    state.friendsById = new Map();
    for (const f of data.friends) if (f.friend?.id) state.friendsById.set(f.friend.id, f);
    const grouped = new Map();
    grouped.set(DEFAULT_GROUP, filteredFriends);
    for (let i = 0; i < filteredFriends.length; i++) {
      const f = filteredFriends[i];
      const groupName = f.group && f.group !== DEFAULT_GROUP ? f.group : '';
      if (!groupName) continue;
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName).push(f);
    }
    const customGroups = getCustomGroups();
    state.currentUser.customGroups = customGroups;
    const nextSignature = buildFriendListSignature(customGroups, grouped);
    const container = $("friendList");
    if (!container) return;
    bindFriendListDelegation();
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
    for (let gi = 0; gi < customGroups.length; gi++) {
      const groupName = customGroups[gi];
      const members = grouped.get(groupName) || [];
      for (let mi = 0; mi < members.length; mi++) { const item = members[mi]; const itemKey = `${groupName}::${item.friend.id}`; nextFriendItemSignatures[itemKey] = buildFriendItemSignature(item, groupName); }
    }
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


// RAF-deduplicated receipt refresh: coalesces multiple calls in the same frame
let _receiptRafId = 0;
function scheduleReceiptRefresh() {
  if (_receiptRafId) return;
  _receiptRafId = requestAnimationFrame(() => { _receiptRafId = 0; refreshMessageReadReceipts(); });
}
function applyLastOutgoingReadState(){
  scheduleReceiptRefresh();
}
function markConversationRead(convId) {
  if (!convId || !state.currentUser) return;
  api(`/api/conversations/${convId}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) }).catch(() => {});
}

function bindChatViewDelegation(chatView) {
  if (chatView.dataset.msgClickBound === '1') return;
  chatView.dataset.msgClickBound = '1';
  chatView.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    // Avatar click → open profile
    const avatarWrap = target.closest('.avatar-click-wrap[data-sender-id]');
    if (avatarWrap && target.closest('.avatar')) {
      e.stopPropagation();
      window.openUserProfile(avatarWrap.dataset.senderId, avatarWrap.dataset.senderName || '');
      return;
    }
    // Image click → open viewer
    const imgEl = target.closest('.chat-img-clickable');
    if (imgEl) {
      e.stopPropagation();
      window.openImageViewer(imgEl.src);
      return;
    }
    // Audio bubble click → play audio
    const audioBubble = target.closest('.audio-bubble[data-audio-url]');
    if (audioBubble) {
      e.stopPropagation();
      window.playAudio(audioBubble.dataset.audioUrl, audioBubble);
      return;
    }
  });
}
const renderMessages = safeRender(function renderMessages(preserveScroll = false) {
  const chatView = $("chatView"); if(!chatView) return;
  bindChatViewDelegation(chatView);
  // Cheap O(1) signature: count + first/last id+type+time — avoids O(n) string concat
  const _ml = state.messages.length;
  const _mf = _ml ? state.messages[0] : null;
  const _mlast = _ml > 1 ? state.messages[_ml - 1] : _mf;
  const sig = _ml + ':' + (_mf ? _mf.id + '|' + (_mf.type || '') + '|' + (_mf.createdAt || 0) : '') +
    ';' + (_mlast ? _mlast.id + '|' + (_mlast.type || '') + '|' + (_mlast.createdAt || 0) : '');
  if (!sigChanged('messages', sig) && !preserveScroll) return;
  _messagesSig = sig;
  const oldScrollHeight = chatView.scrollHeight;
  chatView.replaceChildren();
  _msgElCache.clear(); _msgElCacheByClient.clear();
  const fragment = document.createDocumentFragment();
  let lastTime = 0;
  for (let i = 0; i < state.messages.length; i++) {
    const msg = state.messages[i];
    fragment.appendChild(buildMessageChunk(msg, lastTime));
    lastTime = msg.createdAt || lastTime;
  }
  chatView.appendChild(fragment);
  if (preserveScroll) { chatView.scrollTop = chatView.scrollHeight - oldScrollHeight; } else { setTimeout(() => chatView.scrollTo({ top: chatView.scrollHeight, behavior: 'smooth' }), 10); }
  scheduleReceiptRefresh();
});

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
      const MAX_CLIENT_MESSAGES = 500;
      // Prepend older messages; avoid double allocation from concat+slice
      const newMsgs = data.messages;
      const total = newMsgs.length + state.messages.length;
      if (total > MAX_CLIENT_MESSAGES) {
        // Keep only the most recent MAX_CLIENT_MESSAGES
        const drop = total - MAX_CLIENT_MESSAGES;
        state.messages = drop >= newMsgs.length
          ? state.messages.slice(drop - newMsgs.length)
          : newMsgs.slice(drop).concat(state.messages);
      } else {
        state.messages.unshift(...newMsgs);
      }
      rebuildMessagesById();
      prependMessagesToView(data.messages, oldFirst);
    }
    state.oldestMessageTime = state.messages[0]?.createdAt || 0;
  } catch(e){
    console.warn('[messages] fetch failed', e);
  } finally { state.isLoadingMessages = false; }
}

// WebRTC/calling functions moved to app_calling.js
// SSE / real-time connection moved to app_realtime.js

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
// Debounced sort + render: coalesces rapid SSE-driven updates
let _sortRenderTimer = 0;
function scheduleSortAndRender() {
  sortConversationsInPlace();
  if (!_sortRenderTimer) _sortRenderTimer = requestAnimationFrame(() => { _sortRenderTimer = 0; renderConversationListFromState(); });
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
const renderSidebar = safeRender(function renderSidebar() {
  const panel = $('sidebarPanel');
  const list = $('sidebarList');
  if (!panel || !list) return;
  if (state.sidebarMode === 'hidden') return;
  ensureSidebarDelegation();

  const visible = [];
  for (const c of (state.conversations || [])) {
    if (c.synthetic || c.syntheticType) continue;
    const clearedAt = getConversationClearedAt(c);
    if (clearedAt && (c.lastMessageAt || 0) <= clearedAt && !(c.unread > 0)) continue;
    visible.push(c);
  }

  const sigParts = [];
  for (const c of visible) sigParts.push(c.id, ':', c.unread||0, ':', c.preview||'', ':', c.peerAvatarUrl||'', ':', c.title||'', ';');
  sigParts.push(state.activeConversation?.id || '', ':', state.sidebarMode);
  const sig = sigParts.join('');
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
});

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
let _tradeConvCache = null;
let _tradeConvBuyer = null;
let _tradeConvSeller = null;
let _tradeConvReadAt = 0;
function _buildTradeConv() {
  const b = state.buyerOrders || [];
  const s = state.sellerOrders || [];
  const tradeReadAt = state.tradeAlertReadAt || 0;
  if (b === _tradeConvBuyer && s === _tradeConvSeller && tradeReadAt === _tradeConvReadAt && _tradeConvCache !== undefined) return _tradeConvCache;
  _tradeConvBuyer = b; _tradeConvSeller = s; _tradeConvReadAt = tradeReadAt;
  let count = 0, unread = 0, maxAt = 0;
  const sources = [b, s];
  for (let si = 0; si < 2; si++) {
    const src = sources[si];
    for (let i = 0; i < src.length; i++) {
      const o = src[i];
      if (o && o.status !== 'completed') {
        count++;
        const at = Number(o.updatedAt || o.createdAt || 0);
        if (at > tradeReadAt) unread++;
        if (at > maxAt) maxAt = at;
      }
    }
  }
  _tradeConvCache = count ? {
    id: '__trade_alert__', title: '交易提醒',
    preview: `待处理 ${count} 单（拉黑不影响交易提醒）`,
    unread, muted: false, pinned: true, peerAvatarUrl: '',
    lastMessageAt: maxAt || Date.now(), synthetic: true, syntheticType: 'trade',
  } : null;
  return _tradeConvCache;
}

const renderConversationListFromState = safeRender(function renderConversationListFromState() {
  bindConversationSwipeDismiss();
  let filteredConvs = state.conversations || [];

  const tradeConv = _buildTradeConv();
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
  const visible = [];
  for (let i = 0; i < filteredConvs.length; i++) {
    const conv = filteredConvs[i];
    const clearedAt = getConversationClearedAt(conv);
    if (clearedAt && (conv.lastMessageAt || 0) <= clearedAt && !(conv.unread > 0)) continue;
    if (conv.unread && !isConversationMuted(conv)) totalUnread += conv.unread;
    visible.push(conv);
  }
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
});

const loadSystemMessages = singleFlight(async function _loadSystemMessagesImpl(){
  if(!state.currentUser) return;
  try{
    const data = await api('/api/system/messages');
    state.systemMessages = data.items || [];
  }catch(e){
    console.warn('[loadSystemMessages]', e);
    state.systemMessages = [];
  }
  scheduleRenderConversationList();
});

function renderSystemMessagesList(){
  const list = $("systemMessagesList");
  if(!list) return;
  if (list.dataset.sysMsgBound !== '1') {
    list.dataset.sysMsgBound = '1';
    list.addEventListener('click', (e) => {
      const card = e.target.closest('[data-sys-title]');
      if (card) openBroadcastDetail(card.dataset.sysTitle, card.dataset.sysText);
    });
  }
  const msgs = state.systemMessages || [];
  if(!msgs.length){
    showEmptyState(list, '📢 暂无系统消息', 'order-empty-state');
    return;
  }
  const frag = document.createDocumentFragment();
  msgs.forEach(msg => {
    const title = msg.title || '系统通知';
    const text = msg.summary || msg.text || '';
    const card = buildProfileCard(title, text, 'button');
    card.dataset.sysTitle = title;
    card.dataset.sysText = text;
    const time = createEl('div', 'order-card-time', msg.createdAt ? formatTime(msg.createdAt) : '');
    time.style.marginTop = '6px';
    card.appendChild(time);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
  state.systemMessagesReadAt = Date.now();
}

const loadConversations = singleFlight(async function _loadConversationsImpl() {
  try {
    const data = await api(`/api/conversations?userId=${encodeURIComponent(state.currentUser.id)}`);
    const convArr = data.conversations || [];
    // Normalize in-place — avoid .map() allocation since normalizeConversation mutates
    for (let ci = 0; ci < convArr.length; ci++) normalizeConversation(convArr[ci]);
    state.conversations = convArr;
    state.conversationsById = new Map();
    state.mutedConvIds = new Set();
    state.pinnedConvIds = new Set();
    const uid = state.currentUser?.id;
    for (const c of convArr) {
      state.conversationsById.set(c.id, c);
      if (c.muted) state.mutedConvIds.add(c.id);
      if (c.pinned) state.pinnedConvIds.add(c.id);
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
    scheduleSortAndRender();
    scheduleReceiptRefresh();
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
