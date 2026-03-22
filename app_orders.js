/* app_orders.js — Order management extracted from app.js */

function rebuildOrdersById() {
  const map = new Map();
  const sellerNames = new Map();
  for (const o of (state.buyerOrders || [])) { map.set(o.id, o); if (o.sellerId && o.sellerName) sellerNames.set(o.sellerId, o.sellerName); }
  for (const o of (state.sellerOrders || [])) { if (!map.has(o.id)) map.set(o.id, o); if (o.sellerId && o.sellerName && !sellerNames.has(o.sellerId)) sellerNames.set(o.sellerId, o.sellerName); }
  state.ordersById = map;
  state.sellerNameCache = sellerNames;
}
const loadBuyerOrders = singleFlight(async function _loadBuyerOrdersImpl(){
  if(!state.currentUser) return;
  try{
    const data = await api('/api/orders');
    state.buyerOrders = data.orders || [];
  }catch(e){
    console.warn('[loadBuyerOrders]', e);
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
  }catch(e){
    console.warn('[loadSellerOrders]', e);
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
  syncSelectedOrderDetail();
  renderConversationListFromState();
}

let tradeRefreshTimer = null;
function scheduleTradeReminderRefresh(delayMs = 300) {
  if (!state.currentUser) return;
  if (tradeRefreshTimer) clearTimeout(tradeRefreshTimer);
  tradeRefreshTimer = setTimeout(async () => {
    tradeRefreshTimer = null;
    await Promise.all([loadBuyerOrders(), loadSellerOrders()]);
    syncSelectedOrderDetail();
  }, Math.max(0, Number(delayMs) || 0));
}

// Keep selectedOrderDetail in sync with refreshed order data
function syncSelectedOrderDetail() {
  const sel = state.selectedOrderDetail;
  if (!sel?.id || !state.ordersById) return;
  const fresh = state.ordersById.get(sel.id);
  if (fresh && fresh !== sel) {
    state.selectedOrderDetail = fresh;
    renderOrderDetailPage();
  }
}

function _rebuildSellerProductsById() {
  const m = new Map();
  for (const p of state.sellerProducts) if (p.id) m.set(String(p.id), p);
  state._sellerProductsById = m;
}
function syncSellerProducts(){
  // Reference directly — syncSellerProducts is always re-called after mutations, no need for defensive copy
  state.sellerProducts = Array.isArray(state.currentUser?.products) ? state.currentUser.products : [];
  _rebuildSellerProductsById();
  renderSellerProductsManage();
}

async function refreshProductViews(){
  await Promise.all([loadMyProducts(), loadSellerProductsManage(), loadMall()]);
  if (state.currentProfileUser?.id && state.currentProfileUser.id === state.currentUser?.id) {
    await loadProfileStore(state.currentUser.id);
  }
}

// Cached page element refs for visibility checks (avoids repeated DOM queries)
let _spPageRef = null, _mpPageRef = null, _pdPageRef = null;
function _isPageVisible(ref) { return ref && !ref.classList.contains('hidden'); }
async function syncProductViewsIfVisible(){
  const tasks = [];
  if (!_spPageRef) _spPageRef = $("sellerProductsPage");
  if (!_mpPageRef) _mpPageRef = $("myProductsPage");
  if (!_pdPageRef) _pdPageRef = $("profileDetailPage");
  if (_isPageVisible(_spPageRef)) tasks.push(loadSellerProductsManage());
  if (_isPageVisible(_mpPageRef)) tasks.push(loadMyProducts());
  if (_isPageVisible(_pdPageRef) && state.currentProfileUser?.id === state.currentUser?.id) tasks.push(loadProfileStore(state.currentUser.id));
  if (tasks.length) await Promise.all(tasks);
}

const loadSellerProductsManage = singleFlight(async function _loadSellerProductsImpl(){
  if(!state.currentUser?.id) return;
  try {
    const data = await api(`/api/users/${state.currentUser.id}/store`);
    state.sellerProducts = Array.isArray(data.items) ? data.items : [];
    _rebuildSellerProductsById();
    state.currentUser.products = [...state.sellerProducts];
    writeSession(state.currentUser);
  } catch (e) {
    console.warn('[loadSellerProductsManage]', e);
    syncSellerProducts();
  }
  // Load category presets for filter
  try {
    const presets = await api('/api/product-presets');
    state._sellerCategoryPresets = presets.categoryPresets || [];
  } catch (e) { console.warn('[loadProductPresets]', e); }
  populateSellerCategoryFilter();
  renderSellerProductsManage();
});


// Cache item summary text per order to avoid re-building on every filter call
function getOrderItemSummary(order) {
  if (order._itemSummary !== undefined) return order._itemSummary;
  order._itemSummary = (order?.items || []).map(i => `${i.title} ${i.spec || ''}`).join(' ');
  return order._itemSummary;
}

function orderMatchesFilters(order, role = 'buyer'){
  const prefix = orderPrefix(role);
  const keyword = String(state[`${prefix}OrderSearch`] || '').trim().toLowerCase();
  const fromVal = state[`${prefix}OrderFrom`] || '';
  const toVal = state[`${prefix}OrderTo`] || '';
  const createdAt = Number(order?.createdAt || 0);
  if (keyword) {
    const counterpartyName = role === 'buyer' ? (order?.sellerName || '') : (order?.buyerName || '');
    const hay = `#${formatOrderId(order?.id, order?.orderNo)} ${getOrderItemSummary(order)} ${counterpartyName}`.toLowerCase();
    if (!hay.includes(keyword)) return false;
  }
  if (fromVal) {
    const fromTs = Date.parse(fromVal);
    if (Number.isFinite(fromTs) && createdAt < fromTs) return false;
  }
  if (toVal) {
    const toTs = Date.parse(toVal);
    if (Number.isFinite(toTs) && createdAt >= toTs + 86400000) return false;
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
  const chips = root.querySelectorAll('.order-filter-chip');
  for (let i = 0; i < chips.length; i++) {
    const btn = chips[i];
    const days = Number(btn.dataset.range || 0);
    let active = false;
    if (Number.isFinite(fromTs) && Number.isFinite(toTs) && days > 0) {
      const start = now - (days * MS_PER_DAY);
      active = Math.abs(fromTs - start) < 2 * 60 * 1000 && Math.abs(toTs - now) < 2 * 60 * 1000;
    }
    btn.classList.toggle('active', active);
  }
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
    await api(`/api/orders/${orderId}/delete`, { method:'POST', body: '{}' });
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

async function doShipOrder(orderId, trackingNo, shippingImages) {
  const data = await api(`/api/orders/${orderId}/ship`, { method:'POST', body: JSON.stringify({ trackingNo, shippingImages }) });
  await refreshAllOrderData();
  return data;
}

function buildOrderCard(order, role){
  const card = createEl('button', 'profile-order-card');
  card.type = 'button';
  card.dataset.orderId = order.id;
  card.dataset.orderRole = role;

  const statusCls = orderStatusCls('order-card-status', order.status);
  const header = createEl('div', 'order-card-header');
  header.append(createEl('span', 'order-card-id', `#${formatOrderId(order.id, order.orderNo)}`), createEl('span', statusCls, formatOrderStatusLabel(order.status)));

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
  if(role === 'seller' && order.status === 'accepted'){
    const shipBtn = createStopBtn('primary-btn', '发货', (e, btn) => {
      if(!order.id) return;
      openShipOrderDialog(order.id);
    });
    actions.appendChild(shipBtn);
  }
  if(role === 'buyer' && order.status === 'accepted'){
    actions.appendChild(createEl('span', 'order-card-hint', '商家备货中'));
  }
  if(order.status === 'shipped'){
    if(role === 'buyer'){
      const confirmBtn = createStopBtn('primary-btn', '确认收货', (e, btn) => {
        showConfirm('确认已收到商品？订单将标记为已完成。', () => {
          withButtonLock(btn, async () => { await doCompleteOrder(order.id); renderBuyerOrdersManage(); }, '处理中...');
        });
      });
      actions.appendChild(confirmBtn);
    }
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
  // Card-level click handled via delegation on order list container
  return card;
}

function bindOrderListDelegation(list) {
  if (list.dataset.orderClickBound === '1') return;
  list.dataset.orderClickBound = '1';
  list.addEventListener('click', (e) => {
    if (e.target.closest('.order-card-actions')) return;
    const card = e.target.closest('.profile-order-card[data-order-id]');
    if (!card) return;
    const order = state.ordersById?.get(card.dataset.orderId);
    if (order) openOrderDetail(order, card.dataset.orderRole || 'buyer');
  });
}
function renderOrdersManage(role, listId, ordersKey, emptyMsg) {
  const list = $(listId);
  if(!list) return;
  bindOrderListDelegation(list);
  syncOrderFilterInputs(role);
  const rows = (state[ordersKey] || []).filter((o) => orderMatchesFilters(o, role));
  const _sigParts = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) { const o = rows[i]; _sigParts[i] = o.id + '|' + o.status + '|' + (o.updatedAt||0); }
  const sig = _sigParts.join(';') + '|' + state[role + 'OrderSearch'] + '|' + state[role + 'OrderFrom'] + '|' + state[role + 'OrderTo'];
  if (!sigChanged(ordersKey, sig)) return;
  if(!rows.length){ showEmptyState(list, emptyMsg, 'order-empty-state'); return; }
  const frag = document.createDocumentFragment();
  for (let i = 0; i < rows.length; i++) frag.appendChild(buildOrderCard(rows[i], role));
  list.replaceChildren(frag);
}
const renderBuyerOrdersManage = safeRender(function renderBuyerOrdersManage() { renderOrdersManage('buyer', 'buyerOrdersManageList', 'buyerOrders', '🧾 暂无购买订单'); });
const renderSellerOrdersManage = safeRender(function renderSellerOrdersManage() { renderOrdersManage('seller', 'sellerOrdersList', 'sellerOrders', '📋 暂无卖家订单'); });

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
  const effectiveSellerId = String(item.sellerId || state.currentProfileUser?.id || '');
  const currentUserId = String(state.currentUser?.id || '');
  const isOwnProduct = !fromSeller && effectiveSellerId && currentUserId && effectiveSellerId === currentUserId;
  const showSellerControls = fromSeller || isOwnProduct;
  toggleEl("productDetailOpenSellerBtn", 'hidden', !fromSeller);
  toggleEl("productDetailBuyNowBtn", 'hidden', showSellerControls);
  toggleEl("productDetailAddCartBtn", 'hidden', showSellerControls);
  toggleEl("productDetailChatBtn", 'hidden', showSellerControls);
  // Hide the entire bottom bar when seller controls are shown to prevent
  // the sticky bar (with padding) from intercepting touch events on seller action buttons
  const _pdBottomBar = $("productDetailBottomBar");
  if (_pdBottomBar) {
    _pdBottomBar.classList.toggle('hidden', showSellerControls);
    // Also reset pointer-events and position to prevent any residual touch interception
    _pdBottomBar.style.pointerEvents = showSellerControls ? 'none' : '';
  }
  // Disable buy/cart buttons when out of stock
  const outOfStock = stock <= 0;
  const _pdBuyBtn = $("productDetailBuyNowBtn");
  const _pdCartBtn = $("productDetailAddCartBtn");
  if(_pdBuyBtn) _pdBuyBtn.disabled = outOfStock;
  if(_pdCartBtn) _pdCartBtn.disabled = outOfStock;
  // Show seller management buttons on detail page for own products
  const _pdSellerActions = $("productDetailSellerActions");
  if (_pdSellerActions) {
    _pdSellerActions.classList.toggle('hidden', !showSellerControls);
    // Ensure seller actions are interactive when visible
    _pdSellerActions.style.pointerEvents = showSellerControls ? 'auto' : '';
  }
  const _pdListedBtn = $("productDetailListedBtn");
  if(showSellerControls && _pdListedBtn) {
    const isUnlisted = item.listed === false;
    _pdListedBtn.textContent = isUnlisted ? '上架' : '下架';
    _pdListedBtn.classList.toggle('accent', isUnlisted);
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
  const sig = order ? (order.id+'|'+order.status+'|'+(order.total||0)+'|'+(order.originalTotal??'')+'|'+(order.updatedAt||0)+'|'+role+'|'+(order.trackingNo||'')) : '';
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
    odRow('订单编号', order.orderNo || formatOrderId(order.id, order.orderNo) || '-'),
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
  const totalQty = (order.items || []).reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
  itemsDiv.appendChild(createEl('div', 'od-section-title', `商品清单（共 ${totalQty} 件）`));
  (order.items || []).forEach(item => {
    const row = createEl('div', 'od-item-row');
    const imgUrl = normalizeMediaUrl(item.imageUrl || item.image || '');
    if (imgUrl) {
      const img = createEl('img', 'od-item-img');
      lazyImg(img, imgUrl);
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

  // Total — show original price with strikethrough if price was modified
  const totalDiv = createEl('div', 'od-section od-total-section');
  if(order.originalTotal != null && order.originalTotal !== order.total){
    const totalRow = createEl('div', 'od-row');
    totalRow.appendChild(createEl('span', 'od-label', '合计'));
    const priceWrap = createEl('span', 'od-value od-total');
    const origSpan = createEl('span', 'od-original-price', formatMoney(order.originalTotal));
    origSpan.style.textDecoration = 'line-through';
    origSpan.style.color = '#999';
    origSpan.style.marginRight = '8px';
    origSpan.style.fontSize = '0.9em';
    priceWrap.append(origSpan, document.createTextNode(formatMoney(order.total)));
    totalRow.appendChild(priceWrap);
    totalDiv.appendChild(totalRow);
  } else {
    totalDiv.appendChild(odRow('合计', formatMoney(order.total), 'od-value od-total'));
  }
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

  // Shipping info section (for shipped/completed orders with tracking data)
  if(order.trackingNo || (order.shippingImages && order.shippingImages.length)){
    const shipDiv = createEl('div', 'od-section');
    shipDiv.appendChild(createEl('div', 'od-section-title', '物流信息'));
    if(order.trackingNo) shipDiv.appendChild(odRow('快递单号', order.trackingNo));
    if(order.shippedAt) shipDiv.appendChild(odRow('发货时间', formatTime(order.shippedAt)));
    if(order.shippingImages && order.shippingImages.length){
      const imgLabel = createEl('div', 'od-row');
      imgLabel.appendChild(createEl('span', 'od-label', '包裹照片'));
      shipDiv.appendChild(imgLabel);
      const imgGrid = createEl('div', 'od-shipping-images');
      order.shippingImages.forEach(url => {
        const img = createEl('img', 'od-shipping-img');
        img.src = normalizeMediaUrl(url);
        img.alt = '包裹照片';
        img.addEventListener('click', () => openImageViewer(normalizeMediaUrl(url)));
        imgGrid.appendChild(img);
      });
      shipDiv.appendChild(imgGrid);
    }
    box.appendChild(shipDiv);
  }

  // Action buttons visibility
  toggleEl("orderDetailAcceptBtn", 'hidden', role !== 'seller' || order.status !== 'pending');
  toggleEl("orderDetailEditPriceBtn", 'hidden', role !== 'seller' || order.status !== 'pending');
  toggleEl("orderDetailPriceRequestBtn", 'hidden', true);
  toggleEl("orderDetailShipBtn", 'hidden', role !== 'seller' || order.status !== 'accepted');
  toggleEl("orderDetailCompleteBtn", 'hidden', !(order.status === 'shipped' && role === 'buyer'));
  if($("orderDetailCompleteBtn")) $("orderDetailCompleteBtn").textContent = '确认收货';
  toggleEl("orderDetailChatBtn", 'hidden', !counterId);
  // Style contact button differently when it's the only visible action
  const chatBtn = $("orderDetailChatBtn");
  if (chatBtn) {
    const hasOtherActions = (role === 'seller' && order.status === 'pending') || (role === 'seller' && order.status === 'accepted') || (order.status === 'shipped' && role === 'buyer');
    chatBtn.classList.toggle('od-chat-solo', !hasOtherActions);
  }
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
  showConfirm('确认已收到商品？订单将标记为已完成。', async () => {
    try{
      const data = await doCompleteOrder(order.id);
      state.selectedOrderDetail = data.order || order;
      renderOrderDetailPage();
      showToast('订单已完成');
    }catch(e){ showModal(e.message || '更新失败'); }
  });
}

function shipSelectedOrder(){
  const order = state.selectedOrderDetail;
  if(!order?.id) return;
  openShipOrderDialog(order.id);
}

// ---- Ship Order Dialog ----
let _shipDialogEl = null;
let _shipDialogState = { orderId: null, trackingNo: '', images: [], uploading: false };
let _scannerStream = null;

function _ensureShipDialog() {
  if (_shipDialogEl) return _shipDialogEl;
  const overlay = document.createElement('div');
  overlay.id = '_shipOrderDialog';
  overlay.className = 'ship-dialog-overlay hidden';
  overlay.innerHTML =
    '<div class="ship-dialog-mask"></div>' +
    '<div class="ship-dialog-box">' +
      '<div class="ship-dialog-title">发货</div>' +
      '<div class="ship-dialog-body">' +
        '<label class="ship-dialog-label">快递单号</label>' +
        '<div class="ship-dialog-tracking-row">' +
          '<input id="_shipTrackingInput" type="text" placeholder="输入或扫码" maxlength="50" class="ship-dialog-input" />' +
          '<button type="button" id="_shipScanBtn" class="ship-dialog-scan-btn" title="扫码">📷</button>' +
        '</div>' +
        '<div id="_shipScannerWrap" class="ship-scanner-wrap hidden">' +
          '<video id="_shipScannerVideo" autoplay playsinline></video>' +
          '<button type="button" id="_shipScannerClose" class="ship-scanner-close-btn">✕</button>' +
        '</div>' +
        '<label class="ship-dialog-label">包裹照片</label>' +
        '<div id="_shipImagesGrid" class="ship-images-grid">' +
          '<label class="ship-img-add">' +
            '<input type="file" accept="image/*" multiple capture="environment" style="display:none" id="_shipImageFileInput" />' +
            '<span>+</span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div class="ship-dialog-footer">' +
        '<button type="button" class="ship-dialog-cancel">取消</button>' +
        '<button type="button" id="_shipConfirmBtn" class="ship-dialog-confirm" disabled>确认发货</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  // Styles
  const s = document.createElement('style');
  s.textContent =
    '.ship-dialog-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;}' +
    '.ship-dialog-overlay.hidden{display:none;}' +
    '.ship-dialog-mask{position:absolute;inset:0;background:rgba(0,0,0,.45);}' +
    '.ship-dialog-box{position:relative;width:320px;max-width:90vw;max-height:85vh;overflow-y:auto;background:#fff;border-radius:14px;animation:modalIn .2s ease;}' +
    '.ship-dialog-title{padding:18px 20px 0;font-size:17px;font-weight:600;text-align:center;}' +
    '.ship-dialog-body{padding:12px 20px 8px;}' +
    '.ship-dialog-label{display:block;font-size:13px;color:#888;margin:10px 0 6px;}' +
    '.ship-dialog-tracking-row{display:flex;gap:8px;}' +
    '.ship-dialog-input{flex:1;height:40px;border:1px solid #ddd;border-radius:8px;padding:0 12px;font-size:15px;outline:none;box-sizing:border-box;}' +
    '.ship-dialog-input:focus{border-color:#07c160;}' +
    '.ship-dialog-scan-btn{width:40px;height:40px;border:1px solid #ddd;border-radius:8px;background:#fafafa;font-size:20px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;}' +
    '.ship-dialog-scan-btn:active{background:#f0f0f0;}' +
    '.ship-scanner-wrap{position:relative;margin:8px 0;border-radius:8px;overflow:hidden;background:#000;}' +
    '.ship-scanner-wrap.hidden{display:none;}' +
    '.ship-scanner-wrap video{width:100%;display:block;}' +
    '.ship-scanner-close-btn{position:absolute;top:6px;right:6px;width:28px;height:28px;border-radius:50%;border:none;background:rgba(0,0,0,.5);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;}' +
    '.ship-images-grid{display:flex;flex-wrap:wrap;gap:8px;}' +
    '.ship-img-add{width:72px;height:72px;border:1.5px dashed #ccc;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:28px;color:#bbb;flex-shrink:0;}' +
    '.ship-img-add:active{background:#f8f8f8;}' +
    '.ship-img-preview{position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;flex-shrink:0;}' +
    '.ship-img-preview img{width:100%;height:100%;object-fit:cover;}' +
    '.ship-img-remove{position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(0,0,0,.5);color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;}' +
    '.ship-dialog-footer{display:flex;border-top:0.5px solid #e5e7eb;}' +
    '.ship-dialog-footer button{flex:1;height:48px;border:none;background:transparent;font-size:16px;cursor:pointer;}' +
    '.ship-dialog-footer button:active{background:#f2f2f6;}' +
    '.ship-dialog-cancel{color:#999;border-right:0.5px solid #e5e7eb !important;}' +
    '.ship-dialog-confirm{color:#07c160;font-weight:600;}' +
    '.ship-dialog-confirm:disabled{color:#ccc;cursor:not-allowed;}' +
    '.od-shipping-images{display:flex;flex-wrap:wrap;gap:8px;padding:4px 0 4px 0;}' +
    '.od-shipping-img{width:72px;height:72px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid #eee;}' +
    '.order-card-hint{font-size:12px;color:#999;padding:4px 0;}';
  document.head.appendChild(s);

  // Event bindings
  overlay.querySelector('.ship-dialog-mask').addEventListener('click', closeShipDialog);
  overlay.querySelector('.ship-dialog-cancel').addEventListener('click', closeShipDialog);
  document.getElementById('_shipScanBtn').addEventListener('click', _startBarcodeScan);
  document.getElementById('_shipScannerClose').addEventListener('click', _stopBarcodeScan);
  document.getElementById('_shipImageFileInput').addEventListener('change', _handleShipImageSelect);
  document.getElementById('_shipConfirmBtn').addEventListener('click', _confirmShipOrder);
  document.getElementById('_shipTrackingInput').addEventListener('input', _syncShipConfirmBtn);

  _shipDialogEl = overlay;
  return overlay;
}

function openShipOrderDialog(orderId) {
  const overlay = _ensureShipDialog();
  _shipDialogState = { orderId, trackingNo: '', images: [], uploading: false };
  document.getElementById('_shipTrackingInput').value = '';
  _renderShipImages();
  _syncShipConfirmBtn();
  overlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('_shipTrackingInput').focus(), 100);
}

function closeShipDialog() {
  _stopBarcodeScan();
  if (_shipDialogEl) _shipDialogEl.classList.add('hidden');
  _shipDialogState = { orderId: null, trackingNo: '', images: [], uploading: false };
}

function _syncShipConfirmBtn() {
  const btn = document.getElementById('_shipConfirmBtn');
  if (!btn) return;
  const tracking = (document.getElementById('_shipTrackingInput')?.value || '').trim();
  btn.disabled = !tracking || !_shipDialogState.images.length || _shipDialogState.uploading;
}

function _renderShipImages() {
  const grid = document.getElementById('_shipImagesGrid');
  if (!grid) return;
  // Remove old previews but keep the add button
  grid.querySelectorAll('.ship-img-preview').forEach(el => el.remove());
  const addLabel = grid.querySelector('.ship-img-add');
  _shipDialogState.images.forEach((url, idx) => {
    const wrap = createEl('div', 'ship-img-preview');
    const img = createEl('img');
    img.src = normalizeMediaUrl(url);
    wrap.appendChild(img);
    const removeBtn = createEl('button', 'ship-img-remove', '✕');
    removeBtn.type = 'button';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _shipDialogState.images.splice(idx, 1);
      _renderShipImages();
      _syncShipConfirmBtn();
    });
    wrap.appendChild(removeBtn);
    grid.insertBefore(wrap, addLabel);
  });
  // Hide add button if max 5
  if (addLabel) addLabel.style.display = _shipDialogState.images.length >= 5 ? 'none' : '';
}

async function _handleShipImageSelect(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  e.target.value = '';
  _shipDialogState.uploading = true;
  _syncShipConfirmBtn();
  for (const file of files) {
    if (_shipDialogState.images.length >= 5) break;
    try {
      const blob = await resizeImageFile(file, 1200, 0.85);
      const url = await uploadBinary(blob, file.name, 'image/jpeg');
      _shipDialogState.images.push(url);
      _renderShipImages();
    } catch (err) {
      console.warn('[shipImageUpload]', err);
      showToast('图片上传失败');
    }
  }
  _shipDialogState.uploading = false;
  _syncShipConfirmBtn();
}

async function _confirmShipOrder() {
  const { orderId, images } = _shipDialogState;
  const trackingNo = (document.getElementById('_shipTrackingInput')?.value || '').trim();
  if (!orderId || !trackingNo || !images.length) return;
  const btn = document.getElementById('_shipConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = '发货中...'; }
  try {
    await doShipOrder(orderId, trackingNo, images);
    closeShipDialog();
    showToast('已发货');
  } catch (err) {
    showModal(err.message || '发货失败');
  } finally {
    if (btn) { btn.textContent = '确认发货'; _syncShipConfirmBtn(); }
  }
}

// ---- Barcode Scanner ----
let _scanAnimFrame = null;

async function _startBarcodeScan() {
  const wrap = document.getElementById('_shipScannerWrap');
  const video = document.getElementById('_shipScannerVideo');
  if (!wrap || !video) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    _scannerStream = stream;
    video.srcObject = stream;
    wrap.classList.remove('hidden');

    // Use BarcodeDetector if available, otherwise fall back to manual entry
    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'itf'] });
      const scan = async () => {
        if (!_scannerStream) return;
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            const val = barcodes[0].rawValue;
            if (val) {
              document.getElementById('_shipTrackingInput').value = val;
              _syncShipConfirmBtn();
              _stopBarcodeScan();
              showToast('扫码成功');
              return;
            }
          }
        } catch (_) {}
        _scanAnimFrame = requestAnimationFrame(scan);
      };
      _scanAnimFrame = requestAnimationFrame(scan);
    } else {
      showToast('浏览器不支持扫码，请手动输入');
      setTimeout(() => _stopBarcodeScan(), 2000);
    }
  } catch (err) {
    console.warn('[barcodeScan]', err);
    showToast('无法访问摄像头');
    _stopBarcodeScan();
  }
}

function _stopBarcodeScan() {
  if (_scanAnimFrame) { cancelAnimationFrame(_scanAnimFrame); _scanAnimFrame = null; }
  if (_scannerStream) {
    _scannerStream.getTracks().forEach(t => t.stop());
    _scannerStream = null;
  }
  const video = document.getElementById('_shipScannerVideo');
  if (video) video.srcObject = null;
  const wrap = document.getElementById('_shipScannerWrap');
  if (wrap) wrap.classList.add('hidden');
}
