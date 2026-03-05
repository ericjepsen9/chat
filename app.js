const SESSION_KEY = "chattrade_api_session_user";

const $ = id => document.getElementById(id);
function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { user: null, token: null };
    const parsed = JSON.parse(raw);
    if (parsed && parsed.user && parsed.token) return parsed;
    if (parsed && parsed.id) return { user: parsed, token: null };
  } catch (_) {}
  return { user: null, token: null };
}
function writeSession(user, token) {
  const nextToken = token ?? state.sessionToken ?? null;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user, token: nextToken }));
  state.sessionToken = nextToken;
}

const on = (id, ev, fn) => { 
    const el = $(id); 
    if(el) { el.addEventListener(ev, fn); } 
};

async function api(p, o={}) { 
    const session = readSession();
    const headers = { ...(o.headers || {}) };
    if (!(o.body instanceof FormData) && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const token = state.sessionToken || session.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(p, { ...o, headers }); 
    const contentType = r.headers.get("content-type") || "";
    const d = contentType.includes("application/json") ? await r.json() : {};
    if(!r.ok) throw new Error(d.error || `http_${r.status}`); 
    return d; 
}
function escapeHTML(s) { return typeof s!=='string'?'':s.replace(/[&<>'"]/g,t=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[t])); }
const firstChar = t => String(t||'').trim().charAt(0)||'?';

const state = { 
  currentUser: null, sessionToken: null, conversations: [], activeConversation: null, messages: [], 
  friends: [], friendRequests: [], currentProfileUser: null, targetForGroupMove: null,
  profileStoreItems: [], profileCartBySeller: {}, selectedProfileProduct: null, selectedProfileSpec: '', profileOrders: [], currentCartSellerId: '',
  adminDashboard: null,
  buyerOrders: [], sellerOrders: [], sellerProducts: [], selectedOrderDetail: null, selectedOrderRole: 'buyer', selectedProductDetail: null, broadcastDrafts: [],
  hasMoreMessages: false, isLoadingMessages: false, oldestMessageTime: 0, 
  eventSource: null, peerLastReadAt: 0, rtc: { pc: null, mode: null, peerId: null, pendingOffer: null, incomingMeta: null, pendingAccept: false, earlyCandidates: [], remoteCandidateQueue: [], phase: 'idle', endingLocally: false, conversationId: null, callId: null, lastEndedCallId: null, incomingShownKey: null }, 
  typingTimer: null, mediaRecorder: null, audioChunks: [], chatListSignature: '', friendListSignature: '', mallListSignature: '', conversationItemSignatures: {}, friendGroupSignatures: {}, friendItemSignatures: {}, mallItemSignatures: {} 
};
let isMuted = false, isCameraOff = false, isSpeaker = false;

const isFriendUser = (userId) => !!(userId && (state.friends || []).some(f => (f.friend?.id || f.friendId) === userId));

function updateProfileDetailActions(){
  const p = state.currentProfileUser;
  if(!p) return;
  const isFriend = !!p.isFriend || isFriendUser(p.id);
  if($("profileAddFriendBtn")) $("profileAddFriendBtn").classList.toggle("hidden", isFriend);
  if($("profileStrangerHint")) $("profileStrangerHint").classList.toggle("hidden", isFriend);
  if($("setRemarkBtn")) $("setRemarkBtn").style.display = isFriend ? '' : 'none';
  if($("setFriendGroupBtn")) $("setFriendGroupBtn").style.display = isFriend ? '' : 'none';
}



function getCurrentSellerCart(sellerId = ''){
  const id = sellerId || state.currentCartSellerId || state.currentProfileUser?.id || '';
  if (!id) return [];
  if (!state.profileCartBySeller || typeof state.profileCartBySeller !== 'object') state.profileCartBySeller = {};
  if (!Array.isArray(state.profileCartBySeller[id])) state.profileCartBySeller[id] = [];
  return state.profileCartBySeller[id];
}

function getGroupedCartTotal(){
  return Object.values(state.profileCartBySeller || {}).reduce((sum, arr) => {
    return sum + (Array.isArray(arr) ? arr.reduce((s, item) => s + (Number(item.unitPrice)||0)*(Number(item.quantity)||0), 0) : 0);
  }, 0);
}

function getGroupedCartCount(){
  return Object.values(state.profileCartBySeller || {}).reduce((sum, arr) => {
    return sum + (Array.isArray(arr) ? arr.reduce((s, item) => s + (Number(item.quantity)||0), 0) : 0);
  }, 0);
}

function formatMoney(v){
  const n = Number(String(v).replace(/[^\d.]/g, '')) || 0;
  return `¥${n.toFixed(2)}`;
}

function parseMoney(v){
  return Number(String(v).replace(/[^\d.]/g, '')) || 0;
}


async function loadBuyerOrders(){
  if(!state.currentUser) return;
  try{
    const data = await api('/api/orders');
    state.buyerOrders = data.orders || [];
  }catch(_){
    state.buyerOrders = [];
  }
  renderBuyerOrdersManage();
}

async function loadSellerOrders(){
  if(!state.currentUser) return;
  try{
    const data = await api(`/api/orders?sellerId=${state.currentUser.id}`);
    state.sellerOrders = data.orders || [];
  }catch(_){
    state.sellerOrders = [];
  }
  renderSellerOrdersManage();
}

function syncSellerProducts(){
  state.sellerProducts = Array.isArray(state.currentUser?.products) ? [...state.currentUser.products] : [];
  renderSellerProductsManage();
}

function orderStatusText(status){
  if(status === 'completed') return '已完成';
  if(status === 'price_pending') return '待确认改价';
  if(status === 'active') return '已生效';
  return '已下单';
}

function renderBuyerOrdersManage(){
  const list = $("buyerOrdersManageList");
  if(!list) return;
  if(!state.buyerOrders.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无购买订单';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  state.buyerOrders.forEach(order => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'profile-order-card';
    const title = document.createElement('div');
    title.className = 'profile-order-title';
    title.textContent = `订单 #${String(order.id || '').slice(-6)} · ${formatMoney(order.total)}`;
    const sub = document.createElement('div');
    sub.className = 'profile-order-sub';
    sub.textContent = (order.items || []).map(i => `${i.title}(${i.spec || '默认'}) x${i.quantity || 1}`).join('，') || '订单内容';
    const status = document.createElement('div');
    status.className = 'profile-order-status' + (order.status === 'completed' ? ' done' : '');
    status.textContent = orderStatusText(order.status);
    card.append(title, sub, status);
    card.addEventListener('click', () => openOrderDetail(order, 'buyer'));
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function renderSellerOrdersManage(){
  const list = $("sellerOrdersList");
  if(!list) return;
  if(!state.sellerOrders.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无卖家订单';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  state.sellerOrders.forEach(order => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'profile-order-card';
    const title = document.createElement('div');
    title.className = 'profile-order-title';
    title.textContent = `订单 #${String(order.id || '').slice(-6)} · ${formatMoney(order.total)}`;
    const sub = document.createElement('div');
    sub.className = 'profile-order-sub';
    sub.textContent = (order.items || []).map(i => `${i.title}(${i.spec || '默认'}) x${i.quantity || 1}`).join('，') || '订单内容';
    const status = document.createElement('div');
    status.className = 'profile-order-status' + (order.status === 'completed' ? ' done' : '');
    status.textContent = orderStatusText(order.status);
    card.append(title, sub, status);
    card.addEventListener('click', () => openOrderDetail(order, 'seller'));
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function renderSellerProductsManage(){
  const list = $("sellerProductsList");
  if(!list) return;
  if(!state.sellerProducts.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无商品，可先使用“发布闲置”';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  state.sellerProducts.forEach(item => {
    const card = document.createElement('div');
    card.className = 'profile-store-item';
    card.addEventListener('click', () => openProductDetailPage(item));
    const img = document.createElement('img');
    img.src = normalizeMediaUrl(item.image || item.imageUrl) || '';
    img.alt = item.title || '商品';
    img.addEventListener('click', () => openProductDetail(item, false));

    const info = document.createElement('div');
    info.className = 'profile-store-info';
    const title = document.createElement('div');
    title.className = 'profile-store-title';
    title.textContent = item.title || '未命名商品';
    const desc = document.createElement('div');
    desc.className = 'profile-store-desc';
    desc.textContent = item.desc || '可在商品详情页继续编辑文案与规格';
    const price = document.createElement('div');
    price.className = 'profile-store-price';
    price.textContent = formatMoney(item.price);
    info.append(title, desc, price);
    info.addEventListener('click', () => openProductDetail(item, false));
    info.addEventListener('click', () => openProductDetail(item, true));

    const side = document.createElement('div');
    side.className = 'profile-store-side';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary-btn';
    btn.textContent = '详情';
    btn.addEventListener('click', () => openProductDetail(item, true));
    side.appendChild(btn);

    card.append(img, info, side);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function openProductDetail(item, fromSeller = false){
  if(!item) return;
  state.selectedProductDetail = { ...item, fromSeller: !!fromSeller };
  if($("productDetailImage")) $("productDetailImage").src = normalizeMediaUrl(item.image || item.imageUrl) || '';
  if($("productDetailTitle")) $("productDetailTitle").textContent = item.title || '商品';
  if($("productDetailDesc")) $("productDetailDesc").textContent = item.desc || '商品详情页为图片、文字、价格与规格';
  if($("productDetailPrice")) $("productDetailPrice").textContent = formatMoney(item.price);
  const specsEl = $("productDetailSpecs");
  if(specsEl){
    const specs = Array.isArray(item.specs) && item.specs.length ? item.specs : ['默认规格', '标准版', '高配版'];
    const frag = document.createDocumentFragment();
    specs.forEach(spec => {
      const chip = document.createElement('span');
      chip.className = 'spec-option-chip';
      chip.textContent = spec;
      frag.appendChild(chip);
    });
    specsEl.replaceChildren(frag);
  }
  if($("productDetailOpenSellerBtn")) $("productDetailOpenSellerBtn").classList.toggle('hidden', !fromSeller);
  window.openSecondaryPage('productDetailPage', state.secondaryReturn || (state.activeConversation ? 'chat' : 'home'));
}

function openOrderDetail(order, role = 'buyer'){
  if(!order) return;
  state.selectedOrderDetail = order;
  state.selectedOrderRole = role;
  renderOrderDetailPage();
  window.openSecondaryPage('orderDetailPage', state.secondaryReturn || (state.activeConversation ? 'chat' : 'home'));
}

function renderOrderDetailPage(){
  const box = $("orderDetailCard");
  if(!box) return;
  const order = state.selectedOrderDetail;
  if(!order){
    box.textContent = '暂无订单详情';
    return;
  }
  if($("orderDetailStatus")) $("orderDetailStatus").textContent = orderStatusText(order.status);
  box.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'profile-order-title';
  title.textContent = `订单 #${String(order.id || '').slice(-6)} · ${formatMoney(order.total)}`;
  const sub = document.createElement('div');
  sub.className = 'profile-order-sub';
  sub.textContent = (order.items || []).map(i => `${i.title} · ${i.spec || '默认'} · x${i.quantity || 1} · ${formatMoney(i.price || 0)}`).join('，');
  const status = document.createElement('div');
  status.className = 'profile-order-status' + (order.status === 'completed' ? ' done' : '');
  status.textContent = orderStatusText(order.status);
  box.append(title, sub, status);
  if($("orderDetailEditPriceBtn")) $("orderDetailEditPriceBtn").classList.toggle('hidden', state.selectedOrderRole !== 'seller');
  if($("orderDetailCompleteBtn")) $("orderDetailCompleteBtn").classList.toggle('hidden', state.selectedOrderRole !== 'seller' || order.status === 'completed');
}

async function updateSelectedOrderPrice(){
  const order = state.selectedOrderDetail;
  if(!order) return;
  const raw = prompt('请输入新的总价', String(order.total || ''));
  if(raw === null) return;
  try{
    const data = await api(`/api/orders/${order.id}/price`, { method:'POST', body: JSON.stringify({ total: parseMoney(raw) }) });
    state.selectedOrderDetail = data.order || order;
    await loadSellerOrders();
    await loadProfileOrders();
        if(state.activeConversation?.id) await reloadActiveConversationMessages();
    renderOrderDetailPage();
  }catch(e){ alert(e.message || '修改失败'); }
}

async function completeSelectedOrder(){
  const order = state.selectedOrderDetail;
  if(!order) return;
  try{
    const data = await api(`/api/orders/${order.id}/status`, { method:'POST', body: JSON.stringify({ status:'completed' }) });
    state.selectedOrderDetail = data.order || order;
    await loadSellerOrders();
    await loadProfileOrders();
    await loadBuyerOrders();
    renderOrderDetailPage();
  }catch(e){ alert(e.message || '更新失败'); }
}

function renderBroadcastDrafts(){
  const list = $("broadcastDraftList");
  if(!list) return;
  if(!state.broadcastDrafts.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无广播草稿';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  state.broadcastDrafts.forEach((item) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'profile-order-card';
    const title = document.createElement('div');
    title.className = 'profile-order-title';
    title.textContent = item.title || '未命名广播';
    const sub = document.createElement('div');
    sub.className = 'profile-order-sub';
    sub.textContent = item.summary || '-';
    card.append(title, sub);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function saveBroadcastDraft(){
  const title = ($("broadcastTitleInput")?.value || '').trim();
  const summary = ($("broadcastSummaryInput")?.value || '').trim();
  const target = ($("broadcastTargetInput")?.value || '').trim();
  if(!title) return alert('请输入广播标题');
  state.broadcastDrafts.unshift({ id: `b_${Date.now()}`, title, summary, target });
  if($("broadcastTitleInput")) $("broadcastTitleInput").value = '';
  if($("broadcastSummaryInput")) $("broadcastSummaryInput").value = '';
  if($("broadcastTargetInput")) $("broadcastTargetInput").value = '';
  renderBroadcastDrafts();
  alert('广播草稿已保存');
  window.openSecondaryPage('broadcastManagePage', state.secondaryReturn || 'profile');
}

async function loadProfileStore(userId){
  if(!userId || !state.currentUser) return;
  try{
    const data = await api(`/api/users/${userId}/store`);
    state.profileStoreItems = data.items || [];
  }catch(_){
    state.profileStoreItems = [];
  }
  renderProfileStore();
  await loadProfileOrders();
}


function openProductDetailPage(item){
  if(!item) return;
  if($("broadcastDetailTitle")) $("broadcastDetailTitle").textContent = item.title || '商品详情';
  if($("broadcastDetailSummary")) $("broadcastDetailSummary").textContent = `${item.desc || '商品详情'} · ${formatMoney(item.price)}`;
  window.openSecondaryPage('productDetailPage', state.secondaryReturn || (state.activeConversation ? 'chat' : 'home'));
}

function renderProfileStore(){
  const list = $("profileStoreList");
  if(!list) return;
  if(!state.profileStoreItems.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无在售商品';
    list.replaceChildren(empty);
    updateProfileCartBar();
    return;
  }
  const frag = document.createDocumentFragment();
  state.profileStoreItems.forEach(item => {
    const card = document.createElement('div');
    card.className = 'profile-store-item';
    card.addEventListener('click', () => openProductDetailPage(item));

    const img = document.createElement('img');
    img.src = normalizeMediaUrl(item.image || item.imageUrl) || '';
    img.alt = item.title || '商品';
    img.addEventListener('click', () => openProductDetail(item, false));

    const info = document.createElement('div');
    info.className = 'profile-store-info';
    const title = document.createElement('div');
    title.className = 'profile-store-title';
    title.textContent = item.title || '未命名商品';
    const desc = document.createElement('div');
    desc.className = 'profile-store-desc';
    desc.textContent = item.desc || '商品详情页包含图片、文字与价格';
    const price = document.createElement('div');
    price.className = 'profile-store-price';
    price.textContent = formatMoney(item.price);
    info.append(title, desc, price);

    const side = document.createElement('div');
    side.className = 'profile-store-side';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary-btn';
    btn.textContent = (item.specs && item.specs.length) ? '选规格' : '加入';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProductSpecSheet(item);
    });
    side.appendChild(btn);

    card.append(img, info, side);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
  updateProfileCartBar();
}

function openProductSpecSheet(item){
  if(!item) return;
  state.selectedProfileProduct = item;
  const specs = Array.isArray(item.specs) && item.specs.length ? item.specs : ['默认规格','标准版','高配版'];
  state.selectedProfileSpec = specs[0];
  if($("specSheetImage")) $("specSheetImage").src = normalizeMediaUrl(item.image || item.imageUrl) || '';
  if($("specSheetTitle")) $("specSheetTitle").textContent = item.title || '商品';
  if($("specSheetDesc")) $("specSheetDesc").textContent = item.desc || '商品详情页包含图片、文字与价格';
  if($("specSheetPrice")) $("specSheetPrice").textContent = formatMoney(item.price);
  const list = $("specOptionsList");
  if(list){
    const frag = document.createDocumentFragment();
    specs.forEach(spec => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'spec-option-chip' + (spec === state.selectedProfileSpec ? ' active' : '');
      chip.textContent = spec;
      chip.addEventListener('click', () => {
        state.selectedProfileSpec = spec;
        list.querySelectorAll('.spec-option-chip').forEach(el => el.classList.toggle('active', el.textContent === spec));
      });
      frag.appendChild(chip);
    });
    list.replaceChildren(frag);
  }
  $("productSpecSheet")?.classList.remove('hidden');
}

function closeProductSpecSheet(){
  $("productSpecSheet")?.classList.add('hidden');
}

function addSelectedProductToCart(){
  const item = state.selectedProfileProduct;
  if(!item) return;
  const spec = state.selectedProfileSpec || '默认规格';
  const key = `${item.id}__${spec}`;
  const cart = getCurrentSellerCart(item.sellerId || state.currentProfileUser?.id || '');
  const found = cart.find(i => i.key === key);
  if(found){
    found.qty += 1;
  }else{
    cart.push({
      key,
      productId: item.id,
      title: item.title || '商品',
      desc: item.desc || '',
      image: item.image || item.imageUrl || '',
      spec,
      unitPrice: parseMoney(item.price),
      quantity: 1,
      sellerId: item.sellerId || state.currentProfileUser?.id || ''
    });
  }
  closeProductSpecSheet();
  updateProfileCartBar();
  showToast('已加入购物车');
}

function getProfileCartTotal(){
  const cart = getCurrentSellerCart();
  return cart.reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0), 0);
}

function updateProfileCartBar(){
  const bar = $("profileCartBar");
  const countEl = $("profileCartCount");
  const totalEl = $("profileCartTotal");
  const currentCart = getCurrentSellerCart();
  const count = currentCart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  if(countEl) countEl.textContent = `${count} 件商品`;
  if(totalEl) totalEl.textContent = formatMoney(currentCart.reduce((sum, item) => sum + (Number(item.unitPrice)||0)*(Number(item.quantity)||0), 0));
  if(bar) bar.classList.toggle('hidden', count <= 0);
}

function renderProfileCartPage(){
  const list = $("profileCartList");
  if(!list) return;
  const currentCart = getCurrentSellerCart();
  if(!currentCart.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '购物车为空';
    list.replaceChildren(empty);
    if($("profileCartSummaryText")) $("profileCartSummaryText").textContent = '0 件商品';
    if($("profileCartPageTotal")) $("profileCartPageTotal").textContent = formatMoney(0);
    return;
  }
  const frag = document.createDocumentFragment();
  let count = 0;
  currentCart.forEach((item, idx) => {
    count += Number(item.quantity) || 0;
    const card = document.createElement('div');
    card.className = 'order-cart-item';
    const title = document.createElement('div');
    title.className = 'order-cart-title';
    title.textContent = `${item.title} · ${item.spec}`;
    const sub = document.createElement('div');
    sub.className = 'order-cart-sub';
    sub.textContent = `数量 ${item.quantity} · 可直接修改价格`;
    const line = document.createElement('div');
    line.className = 'order-cart-line';
    const priceInput = document.createElement('input');
    priceInput.className = 'order-price-input';
    priceInput.value = Number(item.unitPrice || 0).toFixed(2);
    priceInput.addEventListener('change', () => {
      item.unitPrice = parseMoney(priceInput.value);
      updateProfileCartBar();
      if($("profileCartPageTotal")) $("profileCartPageTotal").textContent = formatMoney(getProfileCartTotal());
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'secondary-btn';
    removeBtn.textContent = '移除';
    removeBtn.addEventListener('click', () => {
      currentCart.splice(idx, 1);
      renderProfileCartPage();
      updateProfileCartBar();
    });
    line.append(priceInput, removeBtn);
    card.append(title, sub, line);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
  if($("profileCartSummaryText")) $("profileCartSummaryText").textContent = `${count} 件商品`;
  if($("profileCartPageTotal")) $("profileCartPageTotal").textContent = formatMoney(getProfileCartTotal());
}


function renderCartHubPage(){
  const list = $("cartHubList");
  if(!list) return;
  const groups = Object.entries(state.profileCartBySeller || {}).filter(([,arr]) => Array.isArray(arr) && arr.length);
  if(!groups.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无待结算商品';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  groups.forEach(([sellerId, arr]) => {
    const profile = sellerId === state.currentProfileUser?.id ? state.currentProfileUser : null;
    const title = profile?.displayName || profile?.nickname || `商家 ${sellerId.slice(-6)}`;
    const count = arr.reduce((s, item) => s + (Number(item.quantity)||0), 0);
    const total = arr.reduce((s, item) => s + (Number(item.unitPrice)||0)*(Number(item.quantity)||0), 0);
    const card = document.createElement('div');
    card.className = 'cart-hub-card';
    const head = document.createElement('div');
    head.className = 'cart-hub-title';
    head.textContent = title;
    const sub = document.createElement('div');
    sub.className = 'cart-hub-sub';
    sub.textContent = `${count} 件商品 · ${formatMoney(total)}`;
    const line = document.createElement('div');
    line.className = 'cart-hub-line';
    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'primary-btn';
    goBtn.textContent = '去结算';
    goBtn.addEventListener('click', () => {
      state.currentCartSellerId = sellerId;
      renderProfileCartPage();
      window.openSecondaryPage('profileCartPage', state.secondaryReturn || 'home');
    });
    line.appendChild(document.createElement('span'));
    line.appendChild(goBtn);
    card.append(head, sub, line);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

async function submitProfileOrder(){
  const currentCart = getCurrentSellerCart();
  if(!state.currentProfileUser?.id || !currentCart.length) return alert('请先选择商品');
  try{
    const payload = {
      sellerId: state.currentProfileUser.id,
      items: currentCart.map(item => ({
        productId: item.productId,
        title: item.title,
        spec: item.spec,
        quantity: item.quantity,
        price: Number(item.unitPrice || 0)
      }))
    };
    await api('/api/orders', { method:'POST', body: JSON.stringify(payload) });
    state.profileCartBySeller[state.currentProfileUser.id] = [];
    updateProfileCartBar();
    renderProfileCartPage();
    await loadProfileOrders();
    if(state.activeConversation?.id) await reloadActiveConversationMessages();
    alert('订单已提交');
    window.openSecondaryPage('profileOrdersPage', state.secondaryReturn || (state.activeConversation ? 'chat' : 'home'));
  }catch(e){
    alert(e.message || '提交订单失败');
  }
}

async function loadProfileOrders(){
  if(!state.currentProfileUser?.id || !state.currentUser) return;
  try{
    const data = await api(`/api/orders?sellerId=${state.currentProfileUser.id}`);
    state.profileOrders = data.orders || [];
  }catch(_){
    state.profileOrders = [];
  }
  renderProfileOrders();
}



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
    const card = document.createElement('div');
    card.className = 'admin-stat-card';
    const l = document.createElement('div');
    l.className = 'admin-stat-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'admin-stat-value';
    v.textContent = String(value);
    card.append(l, v);
    frag.appendChild(card);
  });
  grid.replaceChildren(frag);
}

function renderAdminOrders(){
  const list = $("adminOrdersList");
  if(!list) return;
  const rows = state.adminDashboard?.recentOrders || [];
  if(!rows.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无平台订单';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach((order) => {
    const card = document.createElement('div');
    card.className = 'profile-order-card';
    const title = document.createElement('div');
    title.className = 'profile-order-title';
    title.textContent = `订单 #${String(order.id || '').slice(-6)} · ${formatMoney(order.total || 0)}`;
    const sub = document.createElement('div');
    sub.className = 'profile-order-sub';
    sub.textContent = `${order.buyerName || '买家'} → ${order.sellerName || '卖家'} · ${order.summary || '订单内容'}`;
    const line = document.createElement('div');
    line.className = 'admin-list-line';
    const tag = document.createElement('span');
    tag.className = 'admin-tag' + (order.status === 'completed' ? '' : ' warn');
    tag.textContent = order.status === 'completed' ? '已完成' : '处理中';
    line.appendChild(tag);
    card.append(title, sub, line);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function renderAdminUsers(){
  const list = $("adminUsersList");
  if(!list) return;
  const rows = state.adminDashboard?.userList || [];
  if(!rows.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无用户数据';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach((user) => {
    const card = document.createElement('div');
    card.className = 'profile-order-card';
    const title = document.createElement('div');
    title.className = 'profile-order-title';
    title.textContent = user.displayName || user.username || '用户';
    const sub = document.createElement('div');
    sub.className = 'profile-order-sub';
    sub.textContent = `商品 ${user.productCount || 0} · 卖家订单 ${user.sellerOrderCount || 0}`;
    const line = document.createElement('div');
    line.className = 'admin-list-line';
    const tag = document.createElement('span');
    tag.className = 'admin-tag' + ((user.blacklistCount || 0) ? ' warn' : '');
    tag.textContent = (user.blacklistCount || 0) ? `黑名单 ${user.blacklistCount}` : '正常';
    line.appendChild(tag);
    card.append(title, sub, line);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function renderAdminProducts(){
  const list = $("adminProductsList");
  if(!list) return;
  const rows = state.adminDashboard?.productList || [];
  if(!rows.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无商品数据';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'profile-order-card';
    const title = document.createElement('div');
    title.className = 'profile-order-title';
    title.textContent = item.title || '商品';
    const sub = document.createElement('div');
    sub.className = 'profile-order-sub';
    sub.textContent = `${item.sellerName || '卖家'} · ${formatMoney(item.price || 0)}`;
    card.append(title, sub);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function renderAdminReports(){
  const list = $("adminReportsList");
  if(!list) return;
  const rows = state.adminDashboard?.reportList || [];
  if(!rows.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无举报与风控提醒';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach((row) => {
    const card = document.createElement('div');
    card.className = 'profile-order-card';
    const title = document.createElement('div');
    title.className = 'profile-order-title';
    title.textContent = row.title || '风险提醒';
    const sub = document.createElement('div');
    sub.className = 'profile-order-sub';
    sub.textContent = row.summary || '';
    card.append(title, sub);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function renderSellerCenterPage(){
  if($("chatTitle")) $("chatTitle").textContent = '卖家中心';
}

function renderBuyerOrdersPage(){
  loadProfileOrders();
}

function openBroadcastDetail(title, summary){
  if($("broadcastDetailTitle")) $("broadcastDetailTitle").textContent = title || '广播详情';
  if($("broadcastDetailSummary")) $("broadcastDetailSummary").textContent = summary || '';
  window.openSecondaryPage('broadcastDetailPage', state.secondaryReturn || 'home');
}

function renderProfileOrders(){
  const list = $("profileOrdersList");
  if(!list) return;
  if(!state.profileOrders.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无订单';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  state.profileOrders.forEach(order => {
    const card = document.createElement('div');
    card.className = 'profile-order-card';
    const title = document.createElement('div');
    title.className = 'profile-order-title';
    title.textContent = `订单 #${String(order.id || '').slice(-6) || '-'} · ${formatMoney(order.total)}`;
    const sub = document.createElement('div');
    sub.className = 'profile-order-sub';
    const names = (order.items || []).map(i => `${i.title}(${i.spec || '默认'}) x${i.quantity || 1}`).join('，');
    sub.textContent = names || '订单内容';
    const status = document.createElement('div');
    status.className = 'profile-order-status' + (order.status === 'completed' ? ' done' : '');
    status.textContent = order.status === 'completed' ? '已完成' : '已下单';

    const actions = document.createElement('div');
    actions.className = 'profile-order-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary-btn';
    editBtn.textContent = '修改价格';
    editBtn.addEventListener('click', async () => {
      const raw = prompt('请输入新的总价', String(order.total || ''));
      if(raw === null) return;
      try{
        await api(`/api/orders/${order.id}/price`, { method:'POST', body: JSON.stringify({ total: parseMoney(raw) }) });
        await loadProfileOrders();
      }catch(e){ alert(e.message || '修改失败'); }
    });
    actions.appendChild(editBtn);

    if(order.status !== 'completed'){
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'primary-btn';
      doneBtn.textContent = '标记已完成';
      doneBtn.addEventListener('click', async (e) => { e.stopPropagation();
        try{
          await api(`/api/orders/${order.id}/status`, { method:'POST', body: JSON.stringify({ status:'completed' }) });
          await loadProfileOrders();
          if(state.activeConversation?.id) await reloadActiveConversationMessages();
        }catch(e){ alert(e.message || '更新失败'); }
      });
      actions.appendChild(doneBtn);
    }

    card.append(title, sub, status, actions);
    card.addEventListener('click', () => openOrderDetail(order, 'seller'));
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

function showProfileActionSheet(){ if($("profileActionSheet")) $("profileActionSheet").classList.remove("hidden"); }
function hideProfileActionSheet(){ if($("profileActionSheet")) $("profileActionSheet").classList.add("hidden"); }

async function sendFriendRequestToCurrentProfile(){
  const p = state.currentProfileUser;
  if(!p || !state.currentUser) return;
  if(p.isFriend || isFriendUser(p.id)) return alert('对方已经是你的好友');
  const keyword = String(p.username || p.appNumberId || '').trim();
  if(!keyword) return alert('暂时无法添加该用户');
  try{
    await api('/api/friends/request', { method:'POST', body: JSON.stringify({ userId: state.currentUser.id, friendUsername: keyword, greeting: `你好，我是${state.currentUser.displayName}` }) });
    alert('好友请求已发送');
  }catch(e){
    alert(e.message || '发送失败');
  }
}

function applyChatRelationshipState(){
  if(!$("chatSubtitle")) return;
  const peerId = conversationPeerId(state.activeConversation);
  if(!peerId) { $("chatSubtitle").textContent = ''; return; }
  $("chatSubtitle").textContent = isFriendUser(peerId) ? '单聊' : '对方还不是你的好友';
}

const conversationPeerId = c => (!c||!c.members||!state.currentUser) ? null : (c.members.find(id=>id!==state.currentUser.id)||null);

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
  if (!seen.has('我的好友')) ordered.unshift('我的好友');
  else {
    const idx = ordered.indexOf('我的好友');
    if (idx > 0) { ordered.splice(idx, 1); ordered.unshift('我的好友'); }
  }
  return ordered.slice(0, 20);
}
function getCustomGroups() {
  return normalizeCustomGroups(state.currentUser?.customGroups || ['我的好友']);
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

function normalizeMediaUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('data:audio/')) return trimmed;
  if (trimmed.startsWith('blob:')) return trimmed;
  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed;
  return '';
}
function setImagePreview(el, url, fallbackText = '+') {
  if (!el) return;
  const safe = normalizeMediaUrl(url);
  el.innerHTML = '';
  if (!safe) { el.textContent = fallbackText; return; }
  const img = document.createElement('img');
  img.src = safe;
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.borderRadius = 'inherit';
  img.alt = 'preview';
  el.appendChild(img);
}
function appendActionButton(container, label, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', handler);
  container.appendChild(btn);
  return btn;
}
function renderAvatarHtml(userObj, fallbackName) {
  if (!userObj) return `<div class="avatar">${firstChar(fallbackName)}</div>`;
  const safeAvatar = normalizeMediaUrl(userObj.avatarUrl);
  if (safeAvatar) return `<div class="avatar"><img src="${safeAvatar}" alt="avatar" /></div>`;
  return `<div class="avatar">${firstChar(userObj.displayName || userObj.username || fallbackName)}</div>`;
}
function createAvatarNode(userObj, fallbackName) {
  const wrap = document.createElement('div');
  wrap.className = 'avatar';
  const safeAvatar = userObj ? normalizeMediaUrl(userObj.avatarUrl) : '';
  if (safeAvatar) {
    const img = document.createElement('img');
    img.src = safeAvatar;
    img.alt = 'avatar';
    wrap.appendChild(img);
    return wrap;
  }
  wrap.textContent = firstChar(userObj?.displayName || userObj?.username || fallbackName);
  return wrap;
}
function setAvatarContainer(el, userObj, fallbackName) {
  if (!el) return;
  el.replaceChildren(createAvatarNode(userObj, fallbackName));
}


function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.7) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('image_encode_failed'));
    }, type, quality);
  });
}
async function resizeImageFile(file, max = 1080, quality = 0.7) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const instance = new Image();
    instance.onload = () => resolve(instance);
    instance.onerror = () => reject(new Error('image_load_failed'));
    instance.src = dataUrl;
  });
  let w = img.width;
  let h = img.height;
  if (w > max || h > max) {
    if (w > h) {
      h = Math.round(h * max / w);
      w = max;
    } else {
      w = Math.round(w * max / h);
      h = max;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvasToBlob(canvas, 'image/jpeg', quality);
}
async function uploadBinary(blob, fileName, contentType) {
  const res = await api('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': contentType || blob.type || 'application/octet-stream',
      'X-File-Name': fileName || 'upload.bin'
    },
    body: blob
  });
  return res.url;
}

function formatTime(timestamp) {
  const d = new Date(timestamp), n = new Date();
  const t = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  if (d.toDateString() === n.toDateString()) return t;
  if (new Date(n.setDate(n.getDate()-1)).toDateString() === d.toDateString()) return `昨天 ${t}`;
  return `${d.getMonth()+1}月${d.getDate()}日 ${t}`;
}

function formatConversationTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  const hhmm = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday - startMsg) / 86400000);
  if (diffDays <= 0) return hhmm;
  if (diffDays == 1) return '昨天';
  if (diffDays < 7) return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth()+1}/${d.getDate()}`;
  return `${String(d.getFullYear()).slice(-2)}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function findMessageIndex(msg) {
  if (!msg) return -1;
  const byId = state.messages.findIndex((m) => m.id === msg.id);
  if (byId >= 0) return byId;
  if (msg.clientMessageId) {
    return state.messages.findIndex((m) => m.clientMessageId && m.clientMessageId === msg.clientMessageId && m.senderId === msg.senderId);
  }
  return -1;
}
function upsertMessage(msg) {
  const idx = findMessageIndex(msg);
  if (idx >= 0) {
    state.messages[idx] = { ...state.messages[idx], ...msg };
    return { action: 'replace', index: idx };
  }
  state.messages.push(msg);
  state.messages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return { action: 'append', index: state.messages.length - 1 };
}
function buildMessageChunk(msg, prevCreatedAt = 0) {
  const fragment = document.createDocumentFragment();
  if ((msg.createdAt || 0) - prevCreatedAt > 180000) {
    const t = document.createElement('div');
    t.className = 'time-stamp';
    const span = document.createElement('span');
    span.textContent = formatTime(msg.createdAt);
    t.appendChild(span);
    fragment.appendChild(t);
  }

  const node = document.createElement('article');
  node.className = `message-row ${msg.senderId === state.currentUser.id ? 'me' : ''}`;
  node.dataset.id = msg.id;
  if (msg.clientMessageId) node.dataset.clientMessageId = msg.clientMessageId;
  let userObj = state.currentUser; let finalName = '我';
  if (msg.senderId !== state.currentUser.id) {
    const friend = state.friends.find(f => f.friend.id === msg.senderId);
    userObj = friend ? friend.friend : { displayName: '用户' };
    finalName = userObj.remark || userObj.displayName;
  }
  const isTemp = String(msg.id).startsWith('temp_');

  if (msg.type === 'system') {
    let txt = msg.text;
    if (txt === '你撤回了一条消息' && msg.senderId !== state.currentUser.id) txt = '对方撤回了一条消息';
    node.className = 'message-row system-msg';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = txt || '';
    node.appendChild(bubble);
  } else {
    const avatarWrap = document.createElement('div');
    avatarWrap.appendChild(createAvatarNode(userObj, finalName));
    avatarWrap.addEventListener('click', (e) => { e.stopPropagation(); window.openUserProfile(msg.senderId, finalName); });
    node.appendChild(avatarWrap);

    const wrap = document.createElement('div');
    wrap.className = 'content-wrap';
    if (isTemp) wrap.style.opacity = '0.6';

    if (msg.type === 'audio') {
      const bubble = document.createElement('div');
      bubble.className = 'bubble audio-bubble';
      const icon = document.createElement('span');
      icon.textContent = '🔊';
      const text = document.createElement('span');
      text.textContent = '语音';
      bubble.appendChild(icon);
      bubble.appendChild(text);
      bubble.addEventListener('click', (e) => { e.stopPropagation(); window.playAudio(msg.audioUrl, bubble); });
      wrap.appendChild(bubble);
    } else if (msg.type === 'image') {
      const bubble = document.createElement('div');
      bubble.className = 'bubble image-bubble';
      const safeImage = normalizeMediaUrl(msg.imageUrl);
      if (safeImage) {
        const img = document.createElement('img');
        img.src = safeImage;
        img.className = 'chat-img-clickable';
        img.style.cursor = 'zoom-in';
        img.style.pointerEvents = 'auto';
        img.addEventListener('click', (e) => { e.stopPropagation(); window.openImageViewer(safeImage); });
        bubble.appendChild(img);
      } else {
        bubble.textContent = '图片已失效';
      }
      wrap.appendChild(bubble);
    } else if (msg.type === 'card') {
      const c = msg.card || {};
      const card = document.createElement('div');
      card.className = 'trade-card';
      const safeImage = normalizeMediaUrl(c.imageUrl || '');
      if (safeImage) {
        const img = document.createElement('img');
        img.className = 'trade-card-img';
        img.src = safeImage;
        img.addEventListener('click', (e) => { e.stopPropagation(); window.openImageViewer(safeImage); });
        card.appendChild(img);
      }
      const title = document.createElement('div');
      title.className = 'trade-card-title';
      title.textContent = c.title || '闲置';
      card.appendChild(title);
      const desc = document.createElement('div');
      desc.style.fontSize = '12px';
      desc.style.color = 'var(--text-muted)';
      desc.style.marginBottom = '4px';
      desc.textContent = c.description || '';
      card.appendChild(desc);
      const meta = document.createElement('div');
      meta.className = 'trade-card-price';
      meta.textContent = c.meta || '';
      card.appendChild(meta);
      wrap.appendChild(card);
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      const parts = String(msg.text || '').split('\n');
      parts.forEach((part, idx) => {
        if (idx > 0) bubble.appendChild(document.createElement('br'));
        bubble.appendChild(document.createTextNode(part));
      });
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
  if(status === 'completed') return '已完成';
  if(status === 'price_updated') return '已改价';
  if(status === 'price_pending') return '待确认改价';
  return '已下单';
}

function buildOrderCardMessage(msg){
  const order = msg.order || {};
  const wrap = document.createElement('div');
  wrap.className = 'trade-card';
  wrap.dataset.orderId = order.id || '';
  const title = document.createElement('div');
  title.className = 'trade-card-title';
  title.textContent = order.title || `订单 #${String(order.id || '').slice(-6) || '-'}`;
  const sub = document.createElement('div');
  sub.className = 'trade-card-sub';
  sub.textContent = order.summary || '订单通知';
  const price = document.createElement('div');
  price.className = 'trade-card-price';
  price.textContent = formatMoney(order.total || 0);
  const status = document.createElement('div');
  status.className = 'trade-card-status' + (order.status === 'completed' ? ' done' : '');
  status.textContent = formatOrderStatusLabel(order.status);
  wrap.append(title, sub, price, status);

  const actions = document.createElement('div');
  actions.className = 'trade-card-actions';
  const detailBtn = document.createElement('button');
  detailBtn.type = 'button';
  detailBtn.className = 'secondary-btn';
  detailBtn.textContent = '查看详情';
  detailBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openChatOrderDetail(order);
  });
  actions.appendChild(detailBtn);

  const canEdit = msg.senderId === state.currentUser?.id && order.role === 'seller' && order.status !== 'completed';
  if(canEdit){
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'primary-btn';
    editBtn.textContent = '修改价格';
    editBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const raw = prompt('请输入新的总价', String(order.total || ''));
      if(raw === null) return;
      try{
        await api(`/api/orders/${order.id}/price`, { method:'POST', body: JSON.stringify({ total: parseMoney(raw) }) });
        await reloadActiveConversationMessages();
      }catch(err){ alert(err.message || '修改失败'); }
    });
    actions.appendChild(editBtn);
  }
  wrap.appendChild(actions);
  return wrap;
}

function buildBroadcastCardMessage(msg){
  const card = document.createElement('div');
  card.className = 'trade-card';
  const title = document.createElement('div');
  title.className = 'trade-card-title';
  title.textContent = (msg.broadcast && msg.broadcast.title) || '图文通知';
  const sub = document.createElement('div');
  sub.className = 'trade-card-sub';
  sub.textContent = (msg.broadcast && msg.broadcast.summary) || '点击查看详情';
  card.append(title, sub);
  if(msg.broadcast && msg.broadcast.cover){
    const img = document.createElement('img');
    img.className = 'trade-card-cover';
    img.src = normalizeMediaUrl(msg.broadcast.cover) || '';
    img.alt = 'broadcast';
    card.appendChild(img);
  }
  const actions = document.createElement('div');
  actions.className = 'trade-card-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'primary-btn';
  btn.textContent = '查看详情';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openBroadcastDetail(
      (msg.broadcast && msg.broadcast.title) || '图文通知',
      (msg.broadcast && msg.broadcast.summary) || ''
    );
  });
  actions.appendChild(btn);
  card.appendChild(actions);
  return card;
}

function openChatOrderDetail(order){
  const card = $('chatOrderDetailCard');
  if(!card) return;
  card.replaceChildren();
  const title = document.createElement('div');
  title.className = 'profile-order-title';
  title.textContent = order.title || `订单 #${String(order.id || '').slice(-6) || '-'}`;
  const sub = document.createElement('div');
  sub.className = 'profile-order-sub';
  sub.textContent = order.summary || '订单详情';
  const status = document.createElement('div');
  status.className = 'profile-order-status' + (order.status === 'completed' ? ' done' : '');
  status.textContent = formatOrderStatusLabel(order.status);
  const total = document.createElement('div');
  total.className = 'trade-card-price';
  total.textContent = formatMoney(order.total || 0);
  card.append(title, sub, status, total);
  window.openSecondaryPage('chatOrderDetailPage', state.activeConversation ? 'chat' : 'home');
}

async function reloadActiveConversationMessages(){
  try{
    if(!state.activeConversation?.id) return;
    const data = await api(`/api/conversations/${state.activeConversation.id}/messages`);
    state.messages = data.messages || [];
    state.peerLastReadAt = Number((data && data.peerLastReadAt) || state.peerLastReadAt || 0);
    renderMessages();
    applyLastOutgoingReadState?.();
    loadConversations?.();
  }catch(_){}
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
  if (oldFirstMessage && lastTime && ((oldFirstMessage.createdAt || 0) - lastTime) <= 180000) {
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
  const index = state.messages.findIndex((m) => m.id === msg.id || (msg.clientMessageId && m.clientMessageId === msg.clientMessageId));
  const prev = index > 0 ? state.messages[index - 1] : null;
  existing.replaceWith(buildMessageChunk(msg, prev?.createdAt || 0));
  refreshMessageReadReceipts();
  return true;
  applyLastOutgoingReadState();
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
    const idx = state.messages.findIndex((m) => m.id === (next.dataset.id || ''));
    const nextMsg = idx >= 0 ? state.messages[idx] : null;
    if (nextMsg) {
      const stamp = document.createElement('div');
      stamp.className = 'time-stamp';
      const span = document.createElement('span');
      span.textContent = formatTime(nextMsg.createdAt);
      stamp.appendChild(span);
      next.before(stamp);
    }
  }
  refreshMessageReadReceipts();
  return true;
}
function applyRecalledMessageLocally(messageId, senderId) {
  const msg = state.messages.find((m) => m.id === messageId);
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
  if (msg.type === 'card') return '[商品]';
  return String(msg.text || '');
}

function refreshMessageReadReceipts() {
  const chatView = $('chatView');
  if (!chatView) return;
  chatView.querySelectorAll('.message-read-receipt').forEach((el) => el.remove());
  if (!state.activeConversation || state.activeConversation.type !== 'direct') return;
  const peerLastReadAt = Number(state.activeConversation.peerLastReadAt || 0);
  let target = null;
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const msg = state.messages[i];
    if (!msg) continue;
    if (msg.senderId !== state.currentUser.id) continue;
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
  const receipt = document.createElement('div');
  receipt.className = `message-read-receipt ${isRead ? 'is-read' : 'is-unread'}`;
  const dot = document.createElement('span');
  dot.className = 'receipt-dot';
  const text = document.createElement('span');
  text.className = 'receipt-text';
  text.textContent = isRead ? '已读' : '未读';
  receipt.appendChild(dot);
  receipt.appendChild(text);
  wrap.appendChild(receipt);
}

function syncActiveConversationListMeta() {
  if (!state.activeConversation) return;
  const conv = state.conversations.find((item) => item.id === state.activeConversation.id);
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
  const conv = (state.conversations || []).find((item) => item.id === conversationId);
  if (!conv) return;
  conv.preview = summarizeMessagePreview(message);
  conv.lastMessageAt = message?.createdAt || Date.now();
  const fromOther = message && message.senderId && message.senderId !== state.currentUser.id;
  if (state.activeConversation && state.activeConversation.id === conversationId) conv.unread = 0;
  else if (fromOther) conv.unread = (conv.unread || 0) + 1;
  sortConversationsInPlace();
}
function buildConversationSignature(visible, totalUnread) {
  return JSON.stringify({
    totalUnread,
    items: visible.map((conv) => ({
      id: conv.id,
      title: conv.title,
      preview: conv.preview || '',
      unread: conv.unread || 0,
      muted: isConversationMuted(conv),
      pinned: isConversationPinned(conv),
      avatar: conv.peerAvatarUrl || '',
      clearedAt: getConversationClearedAt(conv),
      lastMessageAt: conv.lastMessageAt || 0
    }))
  });
}
function buildFriendListSignature(customGroups, grouped) {
  return JSON.stringify(customGroups.map((groupName) => ({
    groupName,
    members: (grouped.get(groupName) || []).map((item) => ({
      id: item.friend.id,
      name: item.friend.displayName || '',
      remark: item.friend.remark || '',
      avatar: item.friend.avatarUrl || ''
    }))
  })));
}
function buildMallSignature(products) {
  return JSON.stringify(products.map((p) => ({
    id: p.id,
    title: p.title || '',
    price: p.price,
    image: p.image || '',
    sellerId: p.sellerId || '',
    sellerName: p.sellerName || '',
    sellerAvatarUrl: p.sellerAvatarUrl || p.sellerAvatar || ''
  })));
}
function isConversationMuted(conv) {
  if (!conv) return false;
  if (typeof conv.muted === 'boolean') return conv.muted;
  return Array.isArray(conv.mutedBy) && conv.mutedBy.includes(state.currentUser.id);
}
function isConversationPinned(conv) {
  if (!conv) return false;
  if (typeof conv.pinned === 'boolean') return conv.pinned;
  return Array.isArray(conv.pinnedBy) && conv.pinnedBy.includes(state.currentUser.id);
}
function getConversationClearedAt(conv) {
  if (!conv) return 0;
  if (typeof conv.clearedAt === 'number') return conv.clearedAt;
  return conv.clearedAt?.[state.currentUser.id] || 0;
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
  return JSON.stringify({
    title: conv.title || '',
    preview: conv.preview || '',
    unread: conv.unread || 0,
    muted: isConversationMuted(conv),
    pinned: isConversationPinned(conv),
    avatar: conv.peerAvatarUrl || '',
    clearedAt: getConversationClearedAt(conv),
    lastMessageAt: conv.lastMessageAt || 0
  });
}
function createEmptyChatListNode() {
  const empty = document.createElement('div');
  empty.className = 'chat-list-empty';
  const title = document.createElement('div');
  title.textContent = '暂无消息';
  const tip = document.createElement('div');
  tip.className = 'chat-list-empty-tip';
  tip.textContent = '点击右上角 ⊕ 添加好友';
  empty.append(title, tip);
  return empty;
}
function buildConversationRow(conv) {
  const isPinned = isConversationPinned(conv);
  const isMuted = isConversationMuted(conv);
  const peerId = conversationPeerId(conv);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-item';
  if (isPinned) btn.classList.add('is-pinned');
  if (isMuted) btn.classList.add('is-muted');
  btn.dataset.conversationId = conv.id;
  btn.addEventListener('click', () => window.openConversation(conv.id));

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'chat-item-avatar';
  setAvatarContainer(avatarWrap, {avatarUrl: conv.peerAvatarUrl, displayName: conv.title}, conv.title);
  avatarWrap.addEventListener('click', (event) => { event.stopPropagation(); if (peerId) window.openUserProfile(peerId, conv.title); });
  btn.appendChild(avatarWrap);

  const info = document.createElement('div');
  info.className = 'chat-item-main';

  const titleRow = document.createElement('div');
  titleRow.className = 'chat-item-title-row';
  const title = document.createElement('strong');
  title.className = 'chat-item-title';
  title.textContent = conv.title || '';
  const time = document.createElement('span');
  time.className = 'chat-item-time';
  time.textContent = formatConversationTime(conv.lastMessageAt);
  titleRow.append(title, time);

  const metaRow = document.createElement('div');
  metaRow.className = 'chat-item-meta';
  const preview = document.createElement('div');
  preview.className = 'preview';
  preview.textContent = conv.preview || '';
  metaRow.appendChild(preview);
  if (isMuted) {
    const mute = document.createElement('span');
    mute.className = 'chat-item-status';
    mute.textContent = '🔕';
    metaRow.appendChild(mute);
  }

  info.append(titleRow, metaRow);
  btn.appendChild(info);

  if (conv.unread) {
    const unread = document.createElement('span');
    unread.dataset.role = 'unread';
    if (isMuted) unread.className = 'unread-dot';
    else unread.className = 'unread-btn';
    unread.textContent = isMuted ? '' : (conv.unread > 99 ? '99+' : String(conv.unread));
    btn.appendChild(unread);
  }
  return btn;
}
function patchConversationRow(row, conv) {
  const replacement = buildConversationRow(conv);
  row.replaceWith(replacement);
  return replacement;
}
function buildFriendItemSignature(item, groupName = '') {
  return JSON.stringify({
    key: `${groupName}::${item.friend.id}`,
    id: item.friend.id,
    name: item.friend.displayName || '',
    username: item.friend.username || '',
    remark: item.friend.remark || '',
    avatar: item.friend.avatarUrl || ''
  });
}
function buildFriendGroupSignature(groupName, members) {
  return JSON.stringify({
    groupName,
    count: members.length,
    items: members.map((item) => buildFriendItemSignature(item, groupName))
  });
}
function buildFriendRow(item, groupName = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-item';
  btn.dataset.friendId = item.friend.id;
  btn.dataset.friendKey = `${groupName}::${item.friend.id}`;
  btn.addEventListener('click', () => window.openUserProfile(item.friend.id, item.friend.displayName));
  btn.appendChild(createAvatarNode(item.friend, item.friend.displayName));
  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0;text-align:left;';
  const strong = document.createElement('strong');
  strong.textContent = item.friend.remark || item.friend.displayName || '';
  info.appendChild(strong);
  btn.appendChild(info);
  return btn;
}
function patchFriendRow(row, item, groupName = '') {
  const replacement = buildFriendRow(item, groupName);
  row.replaceWith(replacement);
  return replacement;
}
function createFriendGroupSection(groupName, members) {
  const wrap = document.createElement('div');
  wrap.dataset.groupName = groupName;
  const header = document.createElement('div');
  header.className = 'qq-group-header';
  header.dataset.role = 'friend-group-header';
  header.addEventListener('click', () => window.toggleQQGroup(header));
  const content = document.createElement('div');
  content.className = 'qq-group-content';
  content.dataset.role = 'friend-group-content';
  wrap.appendChild(header);
  wrap.appendChild(content);
  return patchFriendGroupSection(wrap, groupName, members);
}
function patchFriendGroupSection(section, groupName, members) {
  section.dataset.groupName = groupName;
  let header = section.querySelector('[data-role="friend-group-header"]');
  if (!header) {
    header = document.createElement('div');
    header.className = 'qq-group-header';
    header.dataset.role = 'friend-group-header';
    header.addEventListener('click', () => window.toggleQQGroup(header));
    section.prepend(header);
  }
  header.replaceChildren();
  header.append(document.createTextNode(groupName + ' '));
  const count = document.createElement('span');
  count.style.cssText = 'color:#8e8e93; font-size:12px; margin-left:6px;';
  count.textContent = String(members.length);
  header.appendChild(count);
  let content = section.querySelector('[data-role="friend-group-content"]');
  if (!content) {
    content = document.createElement('div');
    content.className = 'qq-group-content';
    content.dataset.role = 'friend-group-content';
    section.appendChild(content);
  }
  const existingRows = new Map(Array.from(content.querySelectorAll('button.chat-item[data-friend-key]')).map((node) => [node.dataset.friendKey, node]));
  const nextItemSignatures = {};
  const orderedNodes = [];
  members.forEach((item) => {
    const itemKey = `${groupName}::${item.friend.id}`;
    const sig = buildFriendItemSignature(item, groupName);
    nextItemSignatures[itemKey] = sig;
    const existing = existingRows.get(itemKey);
    let row = existing;
    if (!existing) row = buildFriendRow(item, groupName);
    else if (state.friendItemSignatures[itemKey] !== sig) row = patchFriendRow(existing, item, groupName);
    orderedNodes.push(row);
    existingRows.delete(itemKey);
  });
  const needsOrderUpdate = orderedNodes.length !== content.childElementCount || orderedNodes.some((node, idx) => content.children[idx] !== node);
  if (needsOrderUpdate) content.replaceChildren(...orderedNodes);
  else existingRows.forEach((node) => node.remove());
  Object.entries(nextItemSignatures).forEach(([id, sig]) => { state.friendItemSignatures[id] = sig; });
  return section;
}
function buildMallItemSignature(product) {
  return JSON.stringify({
    id: product.id,
    title: product.title || '',
    price: product.price,
    image: product.image || '',
    sellerId: product.sellerId || '',
    sellerName: product.sellerName || '',
    sellerAvatarUrl: product.sellerAvatarUrl || product.sellerAvatar || ''
  });
}
function buildMallCard(product) {
  const card = document.createElement('div');
  card.className = 'product-card';
  card.dataset.productId = product.id;
  card.addEventListener('click', () => window.openProductChat(product.sellerId, product.title, product.price, product.image));
  return patchMallCard(card, product);
}
function patchMallCard(card, product) {
  const replacement = card.cloneNode(false);
  replacement.className = 'product-card';
  replacement.dataset.productId = product.id;
  replacement.addEventListener('click', () => window.openProductChat(product.sellerId, product.title, product.price, product.image));
  const safeImage = normalizeMediaUrl(product.image);
  if (safeImage) {
    const img = document.createElement('img');
    img.src = safeImage;
    img.alt = product.title || '商品图';
    replacement.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = 'height:140px;display:flex;align-items:center;justify-content:center;background:#f4f4f5;color:#8e8e93;';
    placeholder.textContent = '无图片';
    replacement.appendChild(placeholder);
  }
  const info = document.createElement('div');
  info.className = 'product-info';
  const title = document.createElement('div');
  title.className = 'product-title';
  title.textContent = product.title || '';
  const price = document.createElement('div');
  price.className = 'product-price';
  price.textContent = `¥${product.price}`;
  const seller = document.createElement('div');
  seller.className = 'product-seller';
  seller.appendChild(createAvatarNode({avatarUrl: product.sellerAvatarUrl || product.sellerAvatar, displayName: product.sellerName}, product.sellerName));
  const sellerName = document.createElement('span');
  sellerName.textContent = product.sellerName || '';
  seller.appendChild(sellerName);
  info.appendChild(title);
  info.appendChild(price);
  info.appendChild(seller);
  replacement.appendChild(info);
  if (card.parentNode) card.replaceWith(replacement);
  return replacement;
}

// ==========================================
// ★ 1. 全局方法池（100%防止找不到函数） ★
// ==========================================

window.switchAuth = (type) => {
    $("loginForm").classList.toggle("hidden", type !== 'login');
    $("registerForm").classList.toggle("hidden", type !== 'register');
    $("loginTab").classList.toggle("active", type === 'login');
    $("registerTab").classList.toggle("active", type === 'register');
};

window.openSecondaryPage = (page, backTo = 'home') => {
  state.secondaryPage = page; state.secondaryReturn = backTo;
  ["chatListView","friendListView","mallView","profileView","chatView","composerPanel","homeTabbar","profileDetailPage","messageSettingsPage","friendRequestsView","addFriendPage","scanPage","privacyPage", "qrCodePage", "editProfilePage", "publishProductPage", "myProductsPage", "settingsPage", "groupManagePage", "profileCartPage", "profileOrdersPage", "buyerOrdersManagePage", "sellerCenterPage", "sellerOrdersPage", "sellerProductsPage", "productDetailPage", "orderDetailPage", "broadcastManagePage", "broadcastEditorPage"].forEach(id => { if($(id)) $(id).classList.add('hidden'); });
  if($(page)) $(page).classList.remove('hidden');
  if($("backBtn")) $("backBtn").classList.remove('hidden');
  if($("homeMoreBtn")) $("homeMoreBtn").classList.add("hidden");
  if($("chatSettingsBtn")) $("chatSettingsBtn").classList.add("hidden");

  if (page === 'friendRequestsView') {
    if($("chatTitle")) $("chatTitle").textContent = '新的朋友';
    refreshFriendRequestState({ forceList: true });
  }
  else if (page === 'profileDetailPage') { if($("chatTitle")) $("chatTitle").textContent = '详细资料'; if($("chatSettingsBtn")) $("chatSettingsBtn").classList.remove('hidden'); }
  else if (page === 'messageSettingsPage') { if($("chatTitle")) $("chatTitle").textContent = '聊天信息'; }
  else if (page === 'addFriendPage') { if($("chatTitle")) $("chatTitle").textContent = '添加朋友'; }
  else if (page === 'scanPage') {
    if($("chatTitle")) $("chatTitle").textContent = '扫一扫';
    if($("scanManualPanel")) $("scanManualPanel").classList.add('hidden');
    if($("scanIdInput")) $("scanIdInput").value = '';
    setTimeout(() => { startScanCamera(); }, 0);
  }
  else if (page === 'privacyPage') { if($("chatTitle")) $("chatTitle").textContent = '黑名单管理'; }
  else if (page === 'qrCodePage') { if($("chatTitle")) $("chatTitle").textContent = '二维码名片'; }
  else if (page === 'editProfilePage') { if($("chatTitle")) $("chatTitle").textContent = '个人信息'; }
  else if (page === 'publishProductPage') { if($("chatTitle")) $("chatTitle").textContent = '发布闲置'; }
  else if (page === 'myProductsPage') { if($("chatTitle")) $("chatTitle").textContent = '我的闲置'; }
  else if (page === 'settingsPage') { if($("chatTitle")) $("chatTitle").textContent = '设置'; }
  else if (page === 'groupManagePage') { if($("chatTitle")) $("chatTitle").textContent = '分组管理'; renderGroupManageList(); }
  else if (page === 'buyerOrdersManagePage') { if($("chatTitle")) $("chatTitle").textContent = '我购买的订单'; }
  else if (page === 'sellerCenterPage') { if($("chatTitle")) $("chatTitle").textContent = '卖家中心'; }
  else if (page === 'sellerOrdersPage') { if($("chatTitle")) $("chatTitle").textContent = '订单管理'; }
  else if (page === 'sellerProductsPage') { if($("chatTitle")) $("chatTitle").textContent = '商品管理'; }
  else if (page === 'productDetailPage') { if($("chatTitle")) $("chatTitle").textContent = '商品详情'; }
  else if (page === 'orderDetailPage') { if($("chatTitle")) $("chatTitle").textContent = '订单详情'; }
  else if (page === 'broadcastManagePage') { if($("chatTitle")) $("chatTitle").textContent = '广播管理'; renderBroadcastDrafts(); }
  else if (page === 'broadcastEditorPage') { if($("chatTitle")) $("chatTitle").textContent = '广播编辑'; }

};

window.removeFromBlacklist = async (targetId) => { try { await api('/api/blacklist', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, targetId, action: 'remove' }) }); $("privacySettingsBtn").click(); } catch(e){ alert(e.message || '操作失败'); } }
window.toggleQQGroup = (el) => { el.classList.toggle('expanded'); const content = el.nextElementSibling; if(content) content.classList.toggle('expanded'); };
window.openImageViewer = (url) => { const safe = normalizeMediaUrl(url); if(!safe) return alert('无效图片地址'); if($("viewerImage")) $("viewerImage").src = safe; if($("imageViewer")) $("imageViewer").classList.remove('hidden'); };
window.closeImageViewer = () => { if($("imageViewer")) $("imageViewer").classList.add('hidden'); if($("viewerImage")) $("viewerImage").removeAttribute('src'); };

window.playAudio = (url, el) => {
  const safe = normalizeMediaUrl(url);
  if(!safe) { if(el) el.classList.remove('playing'); return alert('无效语音地址'); }
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
      window.currentAudio.onerror = () => { alert('设备不支持此录音格式'); if (el) el.classList.remove('playing'); };
      window.currentAudio.play().catch(() => { alert('播放被拦截，请重试'); if (el) el.classList.remove('playing'); });
  } catch(e) {
      if (el) el.classList.remove('playing');
      alert('播放器初始化失败。');
  }
};

window.copyText = (enc) => { navigator.clipboard ? navigator.clipboard.writeText(decodeURIComponent(enc)) : alert('已复制'); };
window.deleteLocalMsg = async (id) => {
  const prevMessages = [...state.messages];
  state.messages = state.messages.filter(m => m.id !== id);
    state.peerLastReadAt = Number((data && data.peerLastReadAt) || state.peerLastReadAt || 0);
  if (!removeMessageFromView(id)) renderMessages();
  applyLastOutgoingReadState();
  try {
    await api(`/api/conversations/${state.activeConversation.id}/messages/${id}/delete`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
    syncActiveConversationListMeta();
    renderConversationListFromState();
    loadConversations();
  } catch(e) {
    state.messages = prevMessages;
    renderMessages();
  applyLastOutgoingReadState();
    alert(e.message || '删除失败');
  }
};
window.recallMsg = async (id) => {
  try {
    await api(`/api/conversations/${state.activeConversation.id}/messages/${id}/recall`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
    if (!applyRecalledMessageLocally(id, state.currentUser.id)) renderMessages();
  applyLastOutgoingReadState();
    syncActiveConversationListMeta();
    renderConversationListFromState();
    loadConversations();
  } catch(e) { alert(e.message || '撤回失败'); }
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
  msgToForward = state.messages.find(m => m.id === msgId); if(!msgToForward) return;
  if($("contextMenu")) $("contextMenu").classList.add('hidden');
  const list = $("forwardList");
  if(list) {
    list.replaceChildren();
    state.conversations.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-item';
      btn.appendChild(createAvatarNode({avatarUrl: c.peerAvatarUrl, displayName: c.title}, c.title));
      const info = document.createElement('div');
      info.style.cssText = 'flex:1; text-align:left;';
      const strong = document.createElement('strong');
      strong.textContent = c.title || '';
      info.appendChild(strong);
      btn.appendChild(info);
      btn.addEventListener('click', () => window.confirmForward(c.id));
      list.appendChild(btn);
    });
  }
  if($("forwardModal")) $("forwardModal").classList.remove('hidden');
};
window.confirmForward = async (convId) => {
  if($("forwardModal")) $("forwardModal").classList.add('hidden'); if(!msgToForward) return;
  try { await api(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ senderId: state.currentUser.id, type: msgToForward.type, text: msgToForward.text, imageUrl: msgToForward.imageUrl, audioUrl: msgToForward.audioUrl, card: msgToForward.card }) }); alert('已转发'); } catch(e) { alert('转发失败: ' + e.message); }
};

window.showContextMenu = function(event, msg) {
  const menu = $("contextMenu"); if(!menu) return;
  menu.replaceChildren();
  if (msg.type === 'text') appendActionButton(menu, '复制', () => window.copyText(encodeURIComponent(msg.text || '')));
  appendActionButton(menu, '转发', () => window.forwardMsg(msg.id));
  appendActionButton(menu, '删除', () => window.deleteLocalMsg(msg.id));
  if (msg.senderId === state.currentUser.id && (Date.now() - msg.createdAt < 120000)) {
     appendActionButton(menu, '撤回', () => window.recallMsg(msg.id));
  }
  menu.style.visibility = 'hidden';
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const anchor = event?.touches ? getTouchAnchor(event) : getTouchAnchor(event);
  let x = anchor.clientX; let y = anchor.clientY;
  if (x + rect.width > window.innerWidth - 10) x = window.innerWidth - rect.width - 10; if (x < 10) x = 10;
  if (y < rect.height + 20) { y = y + 20; } else { y = y - rect.height - 15; }
  menu.style.left = `${x}px`; menu.style.top = `${y}px`;
  menu.style.visibility = '';
  const closeMenu = (e) => { if(e && e.target.closest('#contextMenu')) return; menu.classList.add('hidden'); menu.replaceChildren(); document.removeEventListener('click', closeMenu, true); document.removeEventListener('touchstart', closeMenu, true); };
  setTimeout(() => { document.addEventListener('click', closeMenu, true); document.addEventListener('touchstart', closeMenu, true); }, 0);
};

window.openProductChat = async (sellerId, title, price, image) => {
  if(sellerId === state.currentUser.id) return alert("这是你自己发布的商品哦！");
  try {
    const data = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ creatorId: state.currentUser.id, memberIds: [sellerId] }) });
    await window.openConversation(data.conversation.id);
    $("messageInput").value = `你好，我想买你的【${title}】`; $("messageInput").dispatchEvent(new Event("input"));
    window.sendMessage({ type: 'card', card: { cardType: '闲置商品', title, description: `售价：¥${price}`, meta: '来自ChatTrade商城', imageUrl: image } });
  } catch(e) { alert("发起交易沟通失败"); }
};

window.acceptRequest = async (requestId) => {
  try { await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, requestId }) }); alert('已添加对方为好友！'); await Promise.all([loadFriends(), loadFriendRequests(), loadConversations()]); if($("backBtn")) $("backBtn").click(); } catch(e) { alert(e.message || '操作失败'); }
};

window.deleteMyProduct = async (productId) => {
  if(!confirm("确定要下架并删除该商品吗？")) return;
  try { await api('/api/products/delete', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, productId }) }); loadMyProducts(); loadMall(); } catch(e) { alert("删除失败：" + e.message); }
};

window.deleteGroup = async (groupName) => {
  if(groupName === '我的好友') return alert('“我的好友”是全部好友列表，不能删除。');
  if(!confirm(`确定删除分组 [${groupName}] 吗？
该分组下的好友将被移入“我的好友”。`)) return;
  try {
    const data = await api('/api/groups/delete', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, groupName }) });
    syncSessionGroups(data.groups || getCustomGroups().filter(g => g !== groupName));
    await loadFriends();
    renderGroupManageList();
    alert('分组已删除');
  } catch(e) { alert(e.message || '删除失败'); }
};

window.renameGroup = async (groupName) => {
  if (groupName === '我的好友') return alert('“我的好友”是全部好友列表，不能重命名。');
  const nextNameRaw = prompt('请输入新的分组名称：', groupName);
  if (nextNameRaw === null) return;
  const nextName = normalizeGroupNameInput(nextNameRaw);
  if (!nextName) return alert('分组名称不能为空');
  const groups = getCustomGroups();
  if (groups.includes(nextName) && nextName !== groupName) return alert('分组名称已存在');
  try {
    const data = await api('/api/groups/rename', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, groupName, newName: nextName }) });
    syncSessionGroups(data.groups || groups.map((g) => g === groupName ? nextName : g));
    await loadFriends();
    renderGroupManageList();
  } catch (e) { alert(e.message || '重命名失败'); }
};

window.moveGroupOrder = async (groupName, offset) => {
  if (groupName === '我的好友') return;
  try {
    const data = await api('/api/groups/reorder', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, groupName, offset }) });
    syncSessionGroups(data.groups || getCustomGroups());
    renderGroupManageList();
    await loadFriends();
  } catch (e) { alert(e.message || '排序失败'); }
};

window.openGroupSelect = (targetUserId) => {
    state.targetForGroupMove = targetUserId;
    const list = $("groupSelectList");
    const cg = getCustomGroups();
    if (list) {
      list.innerHTML = '';
      cg.forEach((g) => {
        const btn = document.createElement('button');
        btn.className = 'primary-btn';
        btn.style.cssText = 'background:#f2f2f6; color:#000; width:100%; border-radius:8px; padding:12px; margin-bottom:10px;';
        btn.textContent = g;
        btn.addEventListener('click', () => window.confirmMoveGroup(g));
        list.appendChild(btn);
      });
    }
    $("groupSelectSheet").classList.remove('hidden');
};

window.confirmMoveGroup = async (groupName) => {
    $("groupSelectSheet").classList.add('hidden');
    try {
        await api('/api/friends/group', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendId: state.targetForGroupMove, group: groupName }) });
        alert("已成功移至分组：" + groupName);
        loadFriends();
        if($("backBtn") && !$("profileDetailPage").classList.contains("hidden")) $("backBtn").click();
    } catch(e) { alert(e.message); }
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
        $('scanManualPanel')?.classList.remove('hidden');
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
  const openCaptureFallback = () => {
    const input = $('scanCaptureInput');
    if (input) {
      input.value = '';
      input.click();
    }
  };
  try{
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no_camera_api');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    state.scanStream = stream;
    video.srcObject = stream;
    video.classList.remove('hidden');
    $('scanFallbackBox')?.classList.add('hidden');

    let detector = null;
    if ('BarcodeDetector' in window) {
      try { detector = state.scanDetector = state.scanDetector || new BarcodeDetector({ formats: ['qr_code'] }); } catch(_) {}
    }
    if (!detector) return; // keep camera preview; user can switch to input
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
              $('scanManualPanel')?.classList.remove('hidden');
              stopScanCamera(true);
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
  $('scanFallbackBox')?.classList.remove('hidden');
}

window.openConversation = async (id, options = {}) => {
  const { skipFetch = false } = options;
  const conv = state.conversations.find(c => c.id === id);
  state.activeConversation = { id, type: 'direct', members: conv?.members || [], title: conv?.title || '', peerAvatarUrl: conv?.peerAvatarUrl || '', muted: conv?.muted || false, pinned: conv?.pinned || false, clearedAt: conv?.clearedAt || 0, peerLastReadAt: Number(conv?.peerLastReadAt || 0) }; 
  state.peerLastReadAt = state.activeConversation.peerLastReadAt; 
  if (conv) {
    conv.unread = 0;
    renderConversationListFromState();
  }
  ["profileDetailPage","messageSettingsPage","friendRequestsView","addFriendPage","scanPage","privacyPage","qrCodePage","editProfilePage","publishProductPage","myProductsPage","settingsPage","groupManagePage","profileCartPage","profileOrdersPage","cartHubPage","productEditorPage","broadcastDetailPage"].forEach(pid => { if($(pid)) $(pid).classList.add('hidden'); });
  if($("chatTitle")) $("chatTitle").textContent = conv?.title || '会话';
  if($("chatListView")) $("chatListView").classList.add("hidden"); 
  if($("friendListView")) $("friendListView").classList.add("hidden");
  if($("mallView")) $("mallView").classList.add("hidden");
  if($("profileView")) $("profileView").classList.add("hidden");
  if($("chatView")) $("chatView").classList.remove("hidden"); 
  if($("composerPanel")) $("composerPanel").classList.remove("hidden");
  if($("homeTabbar")) $("homeTabbar").classList.add("hidden"); 
  if($("backBtn")) $("backBtn").classList.remove("hidden");
  if($("homeMoreBtn")) $("homeMoreBtn").classList.add("hidden"); 
  if($("chatSettingsBtn")) $("chatSettingsBtn").classList.remove("hidden");
  applyChatRelationshipState();
  applyChatRelationshipState();
  if (!skipFetch) {
    await fetchMessages(); 
    await api(`/api/conversations/${id}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) });
    refreshMessageReadReceipts();
  } else {
    Promise.resolve().then(async () => {
      try {
        if (!state.activeConversation || state.activeConversation.id !== id) return;
        await fetchMessages();
      } catch(_) {}
    });
  }
  sortConversationsInPlace();
  renderConversationListFromState();
  loadConversations(); 
  if ($("chatView")) setTimeout(() => $("chatView").scrollTop = $("chatView").scrollHeight, 100);
};

window.openPrivateChat = async (targetUserId) => {
  try {
    const data = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ creatorId: state.currentUser.id, memberIds: [targetUserId] }) });
    await window.openConversation(data.conversation.id);
  } catch(e) { alert("发起沟通失败"); }
};

window.openUserProfile = async (userId, fallbackName) => {
  if (!userId || userId === 'null') return;
  try {
    const data = await api(`/api/users/${userId}/profile?viewerId=${state.currentUser.id}`);
    if (data.profile) {
      state.currentProfileUser = data.profile;
      setAvatarContainer($("profileAvatar"), data.profile, fallbackName);
      
      const finalName = data.profile.remarkName || data.profile.nickname || fallbackName || '未知用户';
      data.profile.isFriend = !!data.profile.isFriend;
      state.currentProfileUser = data.profile;
      if($("profileRemarkName")) $("profileRemarkName").textContent = finalName;
      if($("profileNickName")) $("profileNickName").textContent = data.profile.nickname || '-'; 
      if($("profileAppId")) $("profileAppId").textContent = `ID：${data.profile.appNumberId}`;
      if($("profileSignature")) $("profileSignature").textContent = data.profile.signature || '这个人很神秘，还没有填写签名';
      updateProfileDetailActions();
      await loadProfileStore(data.profile.id);
      window.openSecondaryPage('profileDetailPage', state.activeConversation ? 'chat' : 'home');
    }
  } catch (e) {}
};

window.insertEmoji = (emoji) => { const input = $("messageInput"); if(!input) return; input.value += emoji; input.dispatchEvent(new Event("input")); input.focus(); };

window.sendMessage = async (payload) => {
  if (!state.activeConversation) return;
  const clientMessageId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tempMsg = { id: 'temp_'+Date.now(), senderId: state.currentUser.id, createdAt: Date.now(), clientMessageId, ...payload };
  state.messages.push(tempMsg);
  appendMessageToView(tempMsg);
  syncActiveConversationListMeta();
  renderConversationListFromState();
  try {
    const res = await api(`/api/conversations/${state.activeConversation.id}/messages`, { method: "POST", body: JSON.stringify({ senderId: state.currentUser.id, clientMessageId, ...payload }) });
    if (res?.message) {
      const result = upsertMessage(res.message);
      if (result.action === 'replace') {
        if (!replaceMessageInView(res.message)) renderMessages();
  applyLastOutgoingReadState();
      } else {
        appendMessageToView(res.message);
      }
      syncActiveConversationListMeta();
      renderConversationListFromState();
      refreshMessageReadReceipts();
      refreshMessageReadReceipts();
    }
    loadConversations();
  } catch (err) {
    state.messages = state.messages.filter(m => m.id !== tempMsg.id);
    if (!removeMessageFromView(tempMsg.id)) renderMessages();
  applyLastOutgoingReadState();
    syncActiveConversationListMeta();
    renderConversationListFromState();
    if (err.message && err.message.includes('拒收')) {
      alert(err.message);
    } else {
      alert("发送失败: " + err.message);
    }
  }
};

window.handleSendText = async () => {
    const input = $("messageInput"); if(!input) return; const text = input.value.trim(); if (!text) return;
    input.value = ""; input.style.height = 'auto'; 
    if($("toggleActionsBtn")) $("toggleActionsBtn").classList.remove("hidden"); if($("sendMsgBtn")) $("sendMsgBtn").classList.add("hidden");
    if($("emojiPanel")) $("emojiPanel").classList.add("hidden"); if($("actionPanel")) $("actionPanel").classList.add("hidden");
    await window.sendMessage({ type: "text", text });
};


// ==========================================
// ★ 2. DOM 交互事件同步挂载 (不再依赖 load 事件)
// ==========================================
let _eventsBound = false;
function bindAllEvents() {
  if (_eventsBound) return;
  _eventsBound = true;

  on("doLoginBtn", "click", async () => {
      const u = $("loginUsername").value.trim(); const p = $("loginPassword").value;
      if(!u || !p) return alert("请输入账号和密码！");
      $("doLoginBtn").textContent = "登录中...";
      try {
          const res = await api("/api/login", { method: "POST", body: JSON.stringify({username: u, password: p}) });
          writeSession(res.user, res.token); location.reload();
      } catch(err) { alert("登录失败：" + (err.message || "账号或密码错误")); $("doLoginBtn").textContent = "立即登录"; } 
  });

  on("doRegisterBtn", "click", async () => {
      const n = $("registerDisplayName").value.trim(); const u = $("registerUsername").value.trim(); const p = $("registerPassword").value;
      if(!n || !u || !p) return alert("请填写完整信息！");
      $("doRegisterBtn").textContent = "注册中...";
      try {
          const res = await api("/api/register", { method: "POST", body: JSON.stringify({displayName: n, username: u, password: p}) });
          alert("注册成功，自动登录！"); writeSession(res.user, res.token); location.reload();
      } catch(err) { 
          let msg = err.message || "账号可能已存在";
          if(msg === 'username_exists') msg = "该账号已被注册，请换一个";
          alert("注册失败：" + msg); $("doRegisterBtn").textContent = "注册并登录"; 
      }
  });

  on("loginPassword", "keydown", (e) => { if(e.key === 'Enter') $("doLoginBtn").click(); });
  on("registerPassword", "keydown", (e) => { if(e.key === 'Enter') $("doRegisterBtn").click(); });
  on("loginTab", "click", () => switchAuth('login'));
  on("registerTab", "click", () => switchAuth('register'));

  on("messageInput", "focus", () => { setTimeout(() => { window.scrollTo(0, document.body.scrollHeight); if ($("chatView")) $("chatView").scrollTop = $("chatView").scrollHeight; }, 300); });
  on("closeGroupSelectSheetBtn", "click", () => { if($("groupSelectSheet")) $("groupSelectSheet").classList.add("hidden"); });
  on("mallSearchInput", "input", loadMall);
  on("publishProductEntryBtn", "click", () => { window.openSecondaryPage("publishProductPage"); $("productTitleInput").value = ""; $("productDescInput").value = ""; $("productPriceInput").value = ""; $("productImagePreview").textContent = "+"; state.tempProductImage = null; });
  on("productImagePreview", "click", () => { if($("productImageInput")) $("productImageInput").click(); });
  
  on("productImageInput", "change", async () => {
      const file = $("productImageInput").files?.[0]; if (!file) return;
      $("productImageInput").value = "";
      try {
          $("productImagePreview").textContent = "上传中...";
          const blob = await resizeImageFile(file, 800, 0.7);
          state.tempProductImage = await uploadBinary(blob, file.name || 'product.jpg', 'image/jpeg');
          setImagePreview($("productImagePreview"), state.tempProductImage);
      } catch (err) {
          state.tempProductImage = null;
          $("productImagePreview").textContent = "+";
          alert('商品图片上传失败: ' + err.message);
      }
  });

  on("submitProductBtn", "click", async () => {
      const title = $("productTitleInput").value.trim(); const desc = $("productDescInput").value.trim(); const price = $("productPriceInput").value.trim();
      if(!title || !price || !state.tempProductImage) return alert("请填写商品名称、价格并上传图片！");
      try {
          $("submitProductBtn").textContent = "发布中...";
          await api('/api/products', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, title, desc, price, image: state.tempProductImage }) });
          alert("发布成功！"); $("submitProductBtn").textContent = "立即发布到商城"; if($("backBtn")) $("backBtn").click(); loadMall();
      } catch(e) { alert(e.message); $("submitProductBtn").textContent = "立即发布到商城"; }
  });

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
          alert('头像上传失败: ' + err.message);
      }
  });
  
  on("myProfileCard", "click", () => { 
      if(!state.currentUser) return; window.openSecondaryPage('editProfilePage');
      $("editNameInput").value = state.currentUser.displayName || ''; $("editSignatureInput").value = state.currentUser.signature || '';
      if($("editAppIdDisplay")) $("editAppIdDisplay").textContent = state.currentUser.appNumberId || '-';
      state.tempAvatarUrl = state.currentUser.avatarUrl || null;
      if (state.tempAvatarUrl) setImagePreview($("editAvatarPreview"), state.tempAvatarUrl, firstChar(state.currentUser?.displayName));
      else $("editAvatarPreview").textContent = firstChar(state.currentUser.displayName);
  });

  on("saveProfileBtn", "click", async () => {
      const name = $("editNameInput").value.trim(); const sign = $("editSignatureInput").value.trim();
      if(!name) return alert("名字不能为空");
      try {
          const data = await api('/api/users/update', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, displayName: name, signature: sign, avatarUrl: state.tempAvatarUrl }) });
          state.currentUser = data.user; writeSession(state.currentUser); alert("资料修改成功！");
          if($("profileDisplayName")) $("profileDisplayName").textContent = state.currentUser.displayName;
          if($("myProfileAvatar")) {
              if(state.currentUser.avatarUrl) setImagePreview($("myProfileAvatar"), state.currentUser.avatarUrl, firstChar(state.currentUser.displayName));
              else $("myProfileAvatar").textContent = firstChar(state.currentUser.displayName);
          }
          if($("backBtn")) $("backBtn").click();
      } catch(e) { alert("保存失败: " + e.message); }
  });

  on("messagesTab", "click", () => setMainTab('messages'));
  on("friendsTab", "click", () => setMainTab('friends'));
  on("mallTab", "click", () => setMainTab('mall'));
  on("profileTab", "click", () => setMainTab('profile'));

  on("backBtn", "click", () => {
    try { stopScanCamera(); } catch(_) {}
      const backTo = state.secondaryReturn; state.secondaryPage = null; state.secondaryReturn = null; 
      ["profileDetailPage","messageSettingsPage","friendRequestsView","addFriendPage","scanPage","privacyPage", "qrCodePage", "editProfilePage", "publishProductPage", "myProductsPage", "settingsPage", "groupManagePage", "profileCartPage", "profileOrdersPage", "buyerOrdersManagePage", "sellerCenterPage", "sellerOrdersPage", "sellerProductsPage", "productDetailPage", "orderDetailPage", "broadcastManagePage", "broadcastEditorPage"].forEach(id => { if($(id)) $(id).classList.add('hidden'); });
      if (backTo === 'chat' && state.activeConversation) {
          if($("backBtn")) $("backBtn").classList.remove('hidden'); 
          if($("chatView")) $("chatView").classList.remove('hidden'); 
          if($("composerPanel")) $("composerPanel").classList.remove('hidden');
          if($("chatTitle")) $("chatTitle").textContent = state.conversations.find((c) => c.id === state.activeConversation.id)?.title || '会话';
          if($("chatSettingsBtn")) $("chatSettingsBtn").classList.remove("hidden");
          return;
      }
      state.activeConversation = null; 
      if($("chatView")) $("chatView").classList.add("hidden"); if($("composerPanel")) $("composerPanel").classList.add("hidden");
      if($("homeTabbar")) $("homeTabbar").classList.remove("hidden"); if($("backBtn")) $("backBtn").classList.add("hidden"); if($("chatSettingsBtn")) $("chatSettingsBtn").classList.add("hidden");
      const activeTab = document.querySelector('.tab-item.active');
      if(activeTab) {
          if(activeTab.id === 'messagesTab') setMainTab('messages'); else if(activeTab.id === 'friendsTab') setMainTab('friends'); else if(activeTab.id === 'mallTab') setMainTab('mall'); else if(activeTab.id === 'profileTab') setMainTab('profile');
      } else { setMainTab('messages'); }
  });

  on("logoutBtn", "click", () => { if(confirm("确定要退出登录吗？")) { localStorage.removeItem(SESSION_KEY); location.reload(); } });
  on("clearCacheBtn", "click", () => { if(confirm("确定清理本地缓存吗？")) { localStorage.clear(); location.reload(); } });
  on("openSettingsBtn", "click", () => { window.openSecondaryPage('settingsPage'); });
  on("globalNotifyBtn", "click", () => { alert("新消息通知目前跟随系统默认设置开启"); });
  on("myQrCodeBtn", "click", () => { window.openSecondaryPage("qrCodePage"); if($("myQrCodeImg")) $("myQrCodeImg").src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${state.currentUser.appNumberId}`; if($("myQrCodeIdTxt")) $("myQrCodeIdTxt").textContent = `ID: ${state.currentUser.appNumberId}`; });
  on("myProductsBtn", "click", () => { window.openSecondaryPage('myProductsPage'); loadMyProducts(); });

  on("privacySettingsBtn", "click", async () => {
      window.openSecondaryPage('privacyPage');
      try {
          const data = await api(`/api/blacklist?userId=${state.currentUser.id}`);
          const list = $("blacklistContainer"); if(!list) return;
          const blacklist = data.users || data.blacklist || [];
          if(blacklist.length === 0) list.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted); font-size:14px;">黑名单为空</div>`;
          else {
            list.replaceChildren();
            blacklist.forEach((u) => {
              const row = document.createElement('div');
              row.className = 'chat-item';
              row.appendChild(createAvatarNode(u, u.displayName));
              const info = document.createElement('div');
              info.style.cssText = 'flex:1;text-align:left;';
              const strong = document.createElement('strong');
              strong.textContent = u.displayName || '';
              info.appendChild(strong);
              row.appendChild(info);
              const btn = document.createElement('button');
              btn.className = 'primary-btn';
              btn.style.background = '#ff3b30';
              btn.textContent = '移出';
              btn.addEventListener('click', () => window.removeFromBlacklist(u.id));
              row.appendChild(btn);
              list.appendChild(row);
            });
          }
      } catch(e){}
  });
  
  on("chatSettingsBtn", "click", () => {
      if(!$("profileDetailPage")?.classList.contains("hidden")) { showProfileActionSheet(); return; }
      window.openSecondaryPage("messageSettingsPage", "chat");
      const peerId = conversationPeerId(state.activeConversation);
      if(peerId) {
          const friend = state.friends.find(f => f.friend.id === peerId);
          const userObj = friend ? friend.friend : { displayName: state.activeConversation?.title || state.conversations.find((c) => c.id === state.activeConversation?.id)?.title || '未知用户', avatarUrl: state.activeConversation?.peerAvatarUrl || null };
          const finalName = userObj.remark || userObj.displayName || '未知用户';
          const profileCard = $("chatSettingsPeerProfile");
          if (profileCard) {
            profileCard.replaceChildren();
            profileCard.appendChild(createAvatarNode(userObj, finalName));
            const info = document.createElement('div');
            info.style.cssText = 'flex:1;text-align:left;';
            const strong = document.createElement('strong');
            strong.style.fontSize = '18px';
            strong.textContent = finalName;
            info.appendChild(strong);
            profileCard.appendChild(info);
            profileCard.onclick = () => window.openUserProfile(peerId, finalName);
          }
      }
  });

  const toggleAction = async (action) => {
    if(!state.activeConversation) return null;
    try {
      const res = await api(`/api/conversations/${state.activeConversation.id}/${action}`, { method:'POST', body: JSON.stringify({userId: state.currentUser.id}) });
      const conv = state.conversations.find((item) => item.id === state.activeConversation?.id);
      if (action === 'mute') {
        const nextMuted = Boolean(res?.muted);
        if (state.activeConversation) state.activeConversation.muted = nextMuted;
        if (conv) conv.muted = nextMuted;
      } else if (action === 'pin') {
        const nextPinned = Boolean(res?.pinned);
        if (state.activeConversation) state.activeConversation.pinned = nextPinned;
        if (conv) conv.pinned = nextPinned;
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
      alert(e.message || '操作失败');
      return null;
    }
  };
  on("muteSettingBtn", "click", async () => {
    const res = await toggleAction('mute');
    if (!res) return;
    alert(res.muted ? '已开启免打扰' : '已关闭免打扰');
    sortConversationsInPlace();
    renderConversationListFromState();
    loadConversations();
  });
  on("pinConversationBtn", "click", async () => {
    const res = await toggleAction('pin');
    if (!res) return;
    alert(res.pinned ? '已置顶会话' : '已取消置顶');
    sortConversationsInPlace();
    renderConversationListFromState();
    loadConversations();
  });
  on("clearChatBtn", "click", async () => {
    if(!confirm("确认清空?")) return;
    const res = await toggleAction('clear');
    if (!res) return;
    alert('聊天记录已清空');
    state.messages = [];
    state.messageBefore = null;
    renderMessages();
  applyLastOutgoingReadState();
    state.chatListSignature = '';
    renderConversationListFromState();
    loadConversations();
  });

  on("blacklistBtn", "click", async () => {
      const peerId = conversationPeerId(state.activeConversation); if(!peerId) return;
      if(confirm("确定把他加入黑名单吗？加入后将拒收他的消息。")) { try { await api('/api/blacklist', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, targetId: peerId, action: 'add' }) }); alert("已加入黑名单"); if($("backBtn")) $("backBtn").click(); } catch(e){} }
  });
  on("deleteFriendBtn", "click", async () => {
      if(!confirm("确定删除好友并清空聊天记录?")) return;
      const peerId = conversationPeerId(state.activeConversation);
      try {
        await api('/api/friends/delete', { method:'POST', body: JSON.stringify({userId: state.currentUser.id, friendId: peerId}) });
        state.friends = (state.friends || []).filter((item) => item.friend?.id !== peerId);
        alert('好友已删除');
        await Promise.all([loadFriends(), loadConversations()]);
        $("backBtn")?.click();
      } catch(e) { alert(e.message || '删除失败'); }
  });

  on("homeMoreBtn", "click", () => { if($("plusMenuSheet")) $("plusMenuSheet").classList.remove("hidden"); });
  on("closePlusMenuBtn", "click", () => { if($("plusMenuSheet")) $("plusMenuSheet").classList.add("hidden"); });
  on("menuAddFriend", "click", () => { if($("plusMenuSheet")) $("plusMenuSheet").classList.add("hidden"); window.openSecondaryPage('addFriendPage'); if($("myProfileIdDisplay")) $("myProfileIdDisplay").textContent = state.currentUser.appNumberId || state.currentUser.username; });
  on("menuScan", "click", () => { if($("plusMenuSheet")) $("plusMenuSheet").classList.add("hidden"); window.openSecondaryPage('scanPage'); });

  on("doSearchFriendBtn", "click", async () => {
      const keyword = $("addFriendSearchInput").value.trim(); if (!keyword) return alert("请输入对方账号或ID");
      const greeting = prompt('打个招呼吧：', `你好，我是${state.currentUser.displayName}`); if(greeting === null) return;
      try { await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendUsername: keyword, greeting }) }); alert('好友请求已发送');
        refreshFriendRequestState(); if($("backBtn")) $("backBtn").click(); } catch(e) { alert(e.message || '发送失败'); }
  });
  const submitScanRequest = async () => {
      const keyword = ($("scanIdInput")?.value || '').trim(); if (!keyword) return alert('请输入对方 ChatTrade ID');
      const greeting = `你好，我是${state.currentUser.displayName}`;
      try {
        await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendUsername: keyword, greeting }) });
        alert('好友请求已发送');
        refreshFriendRequestState();
        if($("scanIdInput")) $("scanIdInput").value = '';
        if($("backBtn")) $("backBtn").click();
      } catch(e) { alert(e.message || '未找到该用户'); }
  };
  on("toggleManualScanBtn", "click", () => {
    if($("scanManualPanel")) $("scanManualPanel").classList.toggle('hidden');
    if(!$("scanManualPanel")?.classList.contains('hidden') && $("scanIdInput")) $("scanIdInput").focus();
  });
  on("startCameraScanBtn", "click", startScanCamera);
  on("scanCaptureInput", "change", async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    const ok = await decodeScanFromImageFile(file);
    if (!ok) {
      $("scanManualPanel")?.classList.remove('hidden');
      if($("scanIdInput")) $("scanIdInput").focus();
      alert('未能识别二维码，请手动输入 ChatTrade ID');
    }
  });
  on("scanSubmitBtn", "click", submitScanRequest);
  on("scanIdInput", "keydown", (e) => { if (e.key === 'Enter') submitScanRequest(); });

  on("profileSendMsgBtn", "click", () => { if(state.currentProfileUser) window.openPrivateChat(state.currentProfileUser.id); });
  on("profileAddFriendBtn", "click", () => sendFriendRequestToCurrentProfile());
    on("myCartEntryBtn", "click", () => {
    renderCartHubPage();
    window.openSecondaryPage('cartHubPage', 'home');
  });
on("profileOrdersEntryBtn", "click", async () => {
    await loadProfileOrders();
    window.openSecondaryPage('profileOrdersPage', state.secondaryReturn || (state.activeConversation ? 'chat' : 'home'));
  });
  on("openProfileCartBtn", "click", () => {
    renderProfileCartPage();
    window.openSecondaryPage('profileCartPage', state.secondaryReturn || (state.activeConversation ? 'chat' : 'home'));
  });
  on("submitProfileOrderBtn", "click", submitProfileOrder);
  on("closeSpecSheetBtn", "click", closeProductSpecSheet);
  on("confirmAddToCartBtn", "click", addSelectedProductToCart);
  on("saveProductEditorBtn", "click", () => {
    alert('商品草稿已保存');
    if($("productEditorTitle")) $("productEditorTitle").value = '';
    if($("productEditorPrice")) $("productEditorPrice").value = '';
    if($("productEditorDesc")) $("productEditorDesc").value = '';
  });


  on("profileShareEntryBtn", "click", () => showProfileActionSheet());
  on("closeProfileActionSheetBtn", "click", hideProfileActionSheet);
  on("profileActionShareBtn", "click", async () => {
      const p = state.currentProfileUser; if(!p) return;
      hideProfileActionSheet();
      const text = `ChatTrade名片：${p.nickname || p.remarkName || p.appNumberId}\nID: ${p.appNumberId}`;
      try {
        if (navigator.share) await navigator.share({ title: p.nickname || 'ChatTrade', text });
        else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); alert('已复制分享信息'); }
        else alert(text);
      } catch(_) {}
  });
  on("profileActionBlacklistBtn", "click", async () => {
      const p = state.currentProfileUser; if(!p) return;
      hideProfileActionSheet();
      try { await api('/api/blacklist', { method:'POST', body: JSON.stringify({ userId: state.currentUser.id, targetId: p.id, action: 'add' }) }); alert('已加入黑名单'); loadFriends(); } catch(e) { alert(e.message || '操作失败'); }
  });
  on("profileActionReportBtn", "click", () => { hideProfileActionSheet(); alert('已收到举报，我们会尽快处理'); });
  on("setFriendGroupBtn", "click", () => { if(state.currentProfileUser) window.openGroupSelect(state.currentProfileUser.id); });
  on("btnSettingsMoveGroup", "click", () => { const peerId = conversationPeerId(state.activeConversation); if(peerId) window.openGroupSelect(peerId); });
  on("setRemarkBtn", "click", async () => {
      const p = state.currentProfileUser; if(!p) return;
      const newRemark = prompt("请输入好友备注名：", p.remarkName || "");
      if(newRemark === null) return;
      try { await api('/api/friends/remark', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendId: p.id, remark: newRemark }) }); alert("备注设置成功"); loadFriends(); loadConversations(); if($("backBtn")) $("backBtn").click(); } catch(e) { alert(e.message); }
  });

  on("openGroupManageBtn", "click", () => window.openSecondaryPage('groupManagePage'));
  on("openFriendRequestsBtn", "click", () => window.openSecondaryPage('friendRequestsView'));
  on("doAddGroupBtn", "click", async () => {
      const n = normalizeGroupNameInput($("newGroupInput").value);
      if(!n) return alert('分组名称不能为空');
      let cg = getCustomGroups();
      if(cg.includes(n)) return alert('分组已存在');
      try {
        const data = await api('/api/groups/create', {method:'POST', body: JSON.stringify({userId: state.currentUser.id, name: n})});
        syncSessionGroups(data.groups || [...cg, n]);
        renderGroupManageList();
        $("newGroupInput").value = '';
        await loadFriends();
        alert('添加分组成功');
      } catch(e) { alert(e.message || '添加失败'); }
  });

  on("imageViewer", "click", (e) => { if(e.target === $("imageViewer")) window.closeImageViewer(); });
  document.addEventListener("keydown", (e) => { if(e.key === "Escape" && $("imageViewer") && !$("imageViewer").classList.contains("hidden")) window.closeImageViewer(); });
  on("closeForwardModalBtn", "click", () => { if($("forwardModal")) $("forwardModal").classList.add("hidden"); });
  
  on("chatView", "click", (e) => {
      if(e.target.tagName !== 'IMG') {
          if($("actionPanel")) $("actionPanel").classList.add("hidden"); 
          if($("emojiPanel")) $("emojiPanel").classList.add("hidden"); 
      }
  });

  on("sendMsgBtn", "click", window.handleSendText);
  on("messageInput", "keydown", (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.handleSendText(); } });
  on("emojiBtn", "click", () => { if($("actionPanel")) $("actionPanel").classList.add("hidden"); if($("emojiPanel")) $("emojiPanel").classList.toggle("hidden"); });
  on("toggleActionsBtn", "click", () => { if($("emojiPanel")) $("emojiPanel").classList.add("hidden"); if($("actionPanel")) $("actionPanel").classList.toggle("hidden"); });

  let typingDebounceTimer = null;
  on("messageInput", "input", function() {
      this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';
      const hasText = this.value.trim().length > 0;
      if($("toggleActionsBtn")) $("toggleActionsBtn").classList.toggle("hidden", hasText); if($("sendMsgBtn")) $("sendMsgBtn").classList.toggle("hidden", !hasText);
      if(state.activeConversation?.type === 'direct' && !typingDebounceTimer) { api(`/api/conversations/${state.activeConversation.id}/signal`, { method:'POST', body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: conversationPeerId(state.activeConversation), signal: {type:'typing'} }) }); typingDebounceTimer = setTimeout(() => { typingDebounceTimer = null; }, 3000); }
  });

  on("voiceToggleBtn", "click", () => {
      if(!$("pttBtn") || !$("messageInput")) return; const isVoice = $("pttBtn").classList.contains("hidden");
      if($("actionPanel")) $("actionPanel").classList.add("hidden"); if($("emojiPanel")) $("emojiPanel").classList.add("hidden"); 
      $("pttBtn").classList.toggle("hidden", !isVoice); $("messageInput").classList.toggle("hidden", isVoice);
      if($("voiceToggleBtn")) $("voiceToggleBtn").innerHTML = isVoice ? "⌨️" : "🎙️";
      if(!isVoice) {
          const hasText = $("messageInput").value.trim().length > 0;
          if($("toggleActionsBtn")) $("toggleActionsBtn").classList.toggle("hidden", hasText); if($("sendMsgBtn")) $("sendMsgBtn").classList.toggle("hidden", !hasText);
      } else {
          if($("toggleActionsBtn")) $("toggleActionsBtn").classList.remove("hidden"); if($("sendMsgBtn")) $("sendMsgBtn").classList.add("hidden");
      }
  });

  let recordStartTime = 0;
  on("pttBtn", "touchstart", async (e) => {
      e.preventDefault(); if($("pttBtn")) { $("pttBtn").textContent = "松开 结束"; $("pttBtn").style.background = "#c5c5c6"; }
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          let mimeType = ''; if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm'; else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
          state.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {}); state.audioChunks = []; recordStartTime = Date.now();
          state.mediaRecorder.ondataavailable = ev => state.audioChunks.push(ev.data);
          state.mediaRecorder.onstop = async () => {
              if (Date.now() - recordStartTime < 1000) return alert("录音太短");
              try {
                  const audioBlob = new Blob(state.audioChunks, { type: mimeType || 'audio/webm' });
                  const audioUrl = await uploadBinary(audioBlob, `voice_${Date.now()}.webm`, audioBlob.type || 'audio/webm');
                  await window.sendMessage({ type: 'audio', audioUrl });
              } catch (err) {
                  alert('语音上传失败: ' + err.message);
              }
          };
          state.mediaRecorder.start();
      } catch(err) { if($("pttBtn")) $("pttBtn").textContent = "按住 说话"; alert("无录音权限"); }
  });
  on("pttBtn", "touchend", (e) => {
      e.preventDefault(); if($("pttBtn")) { $("pttBtn").textContent = "按住 说话"; $("pttBtn").style.background = "#fff"; }
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') { state.mediaRecorder.stop(); state.mediaRecorder.stream.getTracks().forEach(t => t.stop()); }
  });

  on("btnTakePhoto", "click", () => { if($("cameraInput")) $("cameraInput").click(); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });
  on("btnSendImage", "click", () => { if($("imageInput")) $("imageInput").click(); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });
  on("btnCallVoice", "click", () => { window.startCall('voice'); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });
  on("btnCallVideo", "click", () => { window.startCall('video'); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });

  const handleImageUpload = async (e) => { 
      const input = e.target; const file = input.files?.[0]; if (!file) return; input.value = "";
      try {
          const blob = await resizeImageFile(file, 1080, 0.7);
          const imageUrl = await uploadBinary(blob, file.name || `image_${Date.now()}.jpg`, 'image/jpeg');
          await window.sendMessage({ type: "image", imageUrl });
      } catch (err) {
          alert('图片上传失败: ' + err.message);
      }
  };
  on("imageInput", "change", handleImageUpload);
  on("cameraInput", "change", handleImageUpload);

  on("toggleSpeakerBtn", "click", () => { alert('【原生限制说明】\n网页端无法用代码强制切换听筒，请直接按手机侧边的音量键调节声音。'); });
  on("toggleMuteBtn", "click", () => { if (!state.rtc.localStream) return; isMuted = !isMuted; state.rtc.localStream.getAudioTracks().forEach(t => t.enabled = !isMuted); if($("toggleMuteBtn")) { $("toggleMuteBtn").classList.toggle('active', !isMuted); $("toggleMuteBtn").style.color = isMuted ? '#ff3b30' : '#fff'; } if($("muteText")) $("muteText").textContent = isMuted ? "已静音" : "静音"; });
  on("toggleCameraBtn", "click", () => { if (!state.rtc.localStream) return; isCameraOff = !isCameraOff; state.rtc.localStream.getVideoTracks().forEach(t => t.enabled = !isCameraOff); if($("toggleCameraBtn")) { $("toggleCameraBtn").classList.toggle('active', !isCameraOff); $("toggleCameraBtn").style.color = isCameraOff ? '#ff3b30' : '#fff'; } if($("cameraText")) $("cameraText").textContent = isCameraOff ? "已关镜头" : "镜头"; });
  
  on("acceptCallBtn", "click", async () => { 
      try {
          clearTimeout(outgoingTimeoutTimer); clearTimeout(incomingTimeoutTimer); const conversationId = state.rtc.pendingOffer?.conversationId || state.rtc.incomingMeta?.conversationId || state.activeConversation?.id; 
          if (!conversationId) return; state.rtc.conversationId = conversationId; 
          if(!state.activeConversation || state.activeConversation.id !== conversationId) { window.openConversation(conversationId, { skipFetch: true }); }
          syncCallConversationState(conversationId, state.rtc.pendingOffer?.senderId || state.rtc.incomingMeta?.senderId || state.rtc.peerId || null, state.rtc.incomingMeta?.senderName || '');
          if($("callPanel")) $("callPanel").classList.remove('hidden');
          if($("callTitle")) $("callTitle").textContent = `连接中...`; 
          if($("chatSubtitle")) $("chatSubtitle").textContent = '建立连接中…';
          if (!state.rtc.pendingOffer) { state.rtc.pendingAccept = true; return; } 
          const { senderId, mode, signal } = state.rtc.pendingOffer; state.rtc.pendingAccept = false; state.rtc.peerId = senderId; setRtcPhase('connecting'); 
          await createPeerConnection(mode); await state.rtc.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)); 
          scheduleConnectTimeout(); 
          for (const cand of (state.rtc.earlyCandidates || [])) { try { await state.rtc.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(e){} } 
          state.rtc.earlyCandidates = []; 
          await flushQueuedRemoteCandidates();
          const answer = await state.rtc.pc.createAnswer(); await state.rtc.pc.setLocalDescription(answer);
          
          const activeCallId = state.rtc.callId || state.rtc.pendingOffer?.callId || state.rtc.incomingMeta?.callId || null;
          state.rtc.callId = activeCallId;
          enqueueSignal(conversationId, { senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: senderId, mode, callId: activeCallId, signal: { type: 'answer', sdp: answer } }); 
          api(`/api/conversations/${conversationId}/call`, { method: 'POST', body: JSON.stringify({ senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: senderId, event: 'accept', mode, callId: activeCallId }) }); 
          
          const peerMeta = resolveCallPeerMeta(senderId, senderId);
          let peerName = peerMeta.name;
          
          markCallConnecting(senderId, mode, '已接听，建立连接中...'); 
          if($("callName")) $("callName").textContent = peerName;
          state.rtc.pendingOffer = null; 
      } catch (err) { window.stopCall(); } 
  });
  
  on("rejectCallBtn", "click", () => { finalizeCall({ event: 'reject', reason: 'manual' }); });
  on("hangupBtn", "click", () => {
    if (state.rtc.phase === 'connected') finalizeCall({ event: 'end', reason: 'hangup' });
    else if (state.rtc.phase === 'outgoing' || state.rtc.phase === 'connecting') finalizeCall({ event: 'cancel', reason: 'caller_cancel' });
    else finalizeCall({ event: 'end', reason: 'hangup' });
  });

  on("searchInput", "input", () => loadConversations());
  on("friendSearchInput", "input", () => loadFriends());

  const emojiList = ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","☺️","😚"];
  if($("emojiPanel")) {
    $("emojiPanel").innerHTML = '';
    emojiList.forEach((e) => {
      const span = document.createElement('span');
      span.textContent = e;
      span.addEventListener('click', () => window.insertEmoji(e));
      $("emojiPanel").appendChild(span);
    });
  }
}


// ==========================================
// ★ 3. 核心拉取与渲染 ★
// ==========================================
function setMainTab(tab) {
  ['messages', 'friends', 'mall', 'profile'].forEach(t => { if($(t+'Tab')) { $(t+'Tab').classList.remove('active'); } });
  if($(tab+'Tab')) $(tab+'Tab').classList.add('active');
  ["chatListView","friendListView","mallView","profileView"].forEach(id => { if($(id)) { $(id).classList.add('hidden'); } });

  if (tab === 'messages') { if($("chatListView")) $("chatListView").classList.remove('hidden'); if($("chatTitle")) $("chatTitle").textContent = "微信"; loadConversations(); } 
  else if (tab === 'friends') { if($("friendListView")) $("friendListView").classList.remove('hidden'); if($("chatTitle")) $("chatTitle").textContent = "通讯录"; loadFriends(); loadFriendRequests(); } 
  else if (tab === 'mall') { if($("mallView")) $("mallView").classList.remove('hidden'); if($("chatTitle")) $("chatTitle").textContent = "发现"; loadMall(); } 
  else if (tab === 'profile') { if($("profileView")) $("profileView").classList.remove('hidden'); if($("chatTitle")) $("chatTitle").textContent = "我"; }
  if($("homeMoreBtn")) $("homeMoreBtn").classList.toggle("hidden", tab !== 'messages');
}

function renderGroupManageList() {
    const list = $("groupManageList"); if(!list) return;
    const cg = getCustomGroups();
    state.currentUser.customGroups = cg;
    list.replaceChildren();
    cg.forEach((g, index) => {
      const row = document.createElement('div');
      row.className = 'chat-item';
      row.style.justifyContent = 'space-between';
      row.style.gap = '8px';
      const left = document.createElement('div');
      left.style.cssText = 'display:flex; align-items:center; gap:8px; min-width:0; flex:1;';
      const name = document.createElement('span');
      name.style.cssText = 'font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
      name.textContent = g;
      left.appendChild(name);
      if (g === '我的好友') {
        const tag = document.createElement('span');
        tag.style.cssText = 'color:#b2b2b2; font-size:12px;';
        tag.textContent = '全部好友';
        left.appendChild(tag);
      }
      row.appendChild(left);
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex; gap:6px; flex-shrink:0;';
      const mkBtn = (text, color, handler) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.style.cssText = `background:${color}; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer;`;
        btn.addEventListener('click', handler);
        return btn;
      };
      if (g !== '我的好友') actions.appendChild(mkBtn('重命名', '#007aff', () => window.renameGroup(g)));
      actions.appendChild(mkBtn('上移', '#8e8e93', () => window.moveGroupOrder(g, -1)));
      actions.appendChild(mkBtn('下移', '#8e8e93', () => window.moveGroupOrder(g, 1)));
      if (g !== '我的好友') actions.appendChild(mkBtn('删除', '#ff3b30', () => window.deleteGroup(g)));
      row.appendChild(actions);
      list.appendChild(row);
    });
}

async function loadMyProducts() {
  try {
    const data = await api(`/api/users/${state.currentUser.id}/profile?viewerId=${state.currentUser.id}`);
    const list = $("myProductsList"); if(!list) return;
    const products = data.profile.products || [];
    if(products.length === 0) { list.innerHTML = `<div style="text-align:center; padding: 40px; color:#8e8e93; font-size:14px;">你还没有发布任何闲置商品</div>`; return; }
    list.innerHTML = '';
    products.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'chat-item';
      row.style.alignItems = 'flex-start';
      const safeImage = normalizeMediaUrl(p.image);
      if (safeImage) {
        const img = document.createElement('img');
        img.src = safeImage;
        img.style.cssText = 'width:60px; height:60px; object-fit:cover; border-radius:6px; margin-right:12px;';
        row.appendChild(img);
      }
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;text-align:left;';
      const title = document.createElement('strong');
      title.style.cssText = 'font-size:15px; margin-bottom:4px; display:block;';
      title.textContent = p.title || '';
      const price = document.createElement('div');
      price.style.cssText = 'color:#ff3b30; font-weight:bold; font-size:14px;';
      price.textContent = `¥${p.price}`;
      info.appendChild(title);
      info.appendChild(price);
      row.appendChild(info);
      const btn = document.createElement('button');
      btn.textContent = '下架';
      btn.style.cssText = 'background:#ff3b30; color:#fff; border:none; padding:6px 12px; border-radius:4px; font-size:12px; cursor:pointer;';
      btn.addEventListener('click', () => window.deleteMyProduct(p.id));
      row.appendChild(btn);
      list.appendChild(row);
    });
  } catch(e){}
}

async function loadMall() {
  try {
    const data = await api('/api/mall?userId=' + state.currentUser.id);
    const products = data.products || [];
    const list = $("mallList"); if (!list) return;
    const nextSignature = buildMallSignature(products);
    const nextItemSignatures = {};
    let grid = list.querySelector('.mall-grid');
    if (products.length === 0) {
      state.mallListSignature = nextSignature;
      state.mallItemSignatures = {};
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center; padding: 40px; color:#8e8e93; font-size:14px;';
      empty.textContent = '商城目前空空如也，快去发布吧';
      list.replaceChildren(empty);
      return;
    }
    if (nextSignature === state.mallListSignature && grid) return;
    if (!grid || list.children.length !== 1 || list.firstElementChild !== grid) {
      grid = document.createElement('div');
      grid.className = 'mall-grid';
      list.replaceChildren(grid);
    }
    const existingCards = new Map(Array.from(grid.querySelectorAll('.product-card[data-product-id]')).map((node) => [node.dataset.productId, node]));
    const orderedNodes = [];
    products.forEach((product) => {
      const id = String(product.id);
      const sig = buildMallItemSignature(product);
      nextItemSignatures[id] = sig;
      const existing = existingCards.get(id);
      let card = existing;
      if (!existing) card = buildMallCard(product);
      else if (state.mallItemSignatures[id] !== sig) card = patchMallCard(existing, product);
      orderedNodes.push(card);
      existingCards.delete(id);
    });
    const needsOrderUpdate = orderedNodes.length !== grid.childElementCount || orderedNodes.some((node, idx) => grid.children[idx] !== node);
    if (needsOrderUpdate) grid.replaceChildren(...orderedNodes);
    else existingCards.forEach((node) => node.remove());
    state.mallListSignature = nextSignature;
    state.mallItemSignatures = nextItemSignatures;
  } catch(e) { if($("mallList")) { const empty = document.createElement('div'); empty.style.cssText = 'text-align:center; padding:40px; color:#8e8e93;'; empty.textContent = '加载失败'; $("mallList").replaceChildren(empty); } }
}

async function loadFriendRequests() {
  try {
    const data = await api(`/api/friends/requests?userId=${state.currentUser.id}`);
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
      container.innerHTML = '';
      if (!state.friendRequests.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = '暂无新的朋友';
        container.replaceChildren(empty);
        return;
      }
      state.friendRequests.forEach((r) => {
        const sender = r.sender || r.fromUser || {};
        const senderName = sender.displayName || sender.username || sender.id || '未知用户';
        const row = document.createElement('div');
        row.className = 'chat-item';
        row.style.cursor = 'default';
        const avatarWrap = document.createElement('div');
        setAvatarContainer(avatarWrap, sender, senderName);
        avatarWrap.addEventListener('click', (event) => { event.stopPropagation(); if(sender.id) window.openUserProfile(sender.id, senderName); });
        row.appendChild(avatarWrap);
        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;text-align:left;';
        const strong = document.createElement('strong');
        strong.textContent = senderName;
        const preview = document.createElement('div');
        preview.className = 'preview';
        preview.textContent = r.greeting || '';
        info.appendChild(strong);
        info.appendChild(preview);
        row.appendChild(info);
        if (r.status === 'pending') {
          const btn = document.createElement('button');
          btn.className = 'primary-btn';
          btn.textContent = '同意';
          btn.addEventListener('click', () => window.acceptRequest(r.id));
          row.appendChild(btn);
        } else {
          const done = document.createElement('span');
          done.style.cssText = 'color:#8e8e93; font-size:14px;';
          done.textContent = '已处理';
          row.appendChild(done);
        }
        container.appendChild(row);
      });
    }
  } catch(e) {
    if($("requestsList")) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '加载失败，请重试';
      $("requestsList").replaceChildren(empty);
    }
  }
}

async function loadFriends() {
  try {
    const keyword = $("friendSearchInput") ? $("friendSearchInput").value.trim().toLowerCase() : "";
    const data = await api(`/api/friends?userId=${encodeURIComponent(state.currentUser.id)}`);
    let filteredFriends = data.friends;
    if (keyword) filteredFriends = filteredFriends.filter(f => f.friend.displayName.toLowerCase().includes(keyword) || f.friend.username.toLowerCase().includes(keyword));
    state.friends = data.friends;
    const grouped = new Map();
    grouped.set('我的好友', filteredFriends.slice());
    filteredFriends.forEach((f) => {
      const groupName = f.group && f.group !== '我的好友' ? f.group : '';
      if (!groupName) return;
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName).push(f);
    });
    const customGroups = getCustomGroups();
    state.currentUser.customGroups = customGroups;
    const nextSignature = buildFriendListSignature(customGroups, grouped);
    const container = $("friendList");
    if (!container) return;
    const nextGroupSignatures = {};
    if (nextSignature === state.friendListSignature && container.childElementCount) return;
    const existingGroups = new Map(Array.from(container.querySelectorAll(':scope > div[data-group-name]')).map((node) => [node.dataset.groupName, node]));
    const orderedGroups = [];
    customGroups.forEach((groupName) => {
      const members = grouped.get(groupName) || [];
      const groupSig = buildFriendGroupSignature(groupName, members);
      nextGroupSignatures[groupName] = groupSig;
      const existing = existingGroups.get(groupName);
      let section = existing;
      if (!existing) section = createFriendGroupSection(groupName, members);
      else if (state.friendGroupSignatures[groupName] !== groupSig) section = patchFriendGroupSection(existing, groupName, members);
      orderedGroups.push(section);
      existingGroups.delete(groupName);
    });
    const needsOrderUpdate = orderedGroups.length !== container.childElementCount || orderedGroups.some((node, idx) => container.children[idx] !== node);
    if (needsOrderUpdate) container.replaceChildren(...orderedGroups);
    else existingGroups.forEach((node) => node.remove());
    state.friendListSignature = nextSignature;
    state.friendGroupSignatures = nextGroupSignatures;
    const nextFriendItemSignatures = {};
    customGroups.forEach((groupName) => {
      const members = grouped.get(groupName) || [];
      members.forEach((item) => { const itemKey = `${groupName}::${item.friend.id}`; nextFriendItemSignatures[itemKey] = buildFriendItemSignature(item, groupName); });
    });
    state.friendItemSignatures = nextFriendItemSignatures;
  } catch(e) {}
}


function applyLastOutgoingReadState(){
  try{
    if(!chatView) return;
    chatView.querySelectorAll('.message-read-state').forEach(el=> el.remove());
    const outgoing = [...chatView.querySelectorAll('.msg.me[data-mid]')];
    if(!outgoing.length) return;
    const last = outgoing[outgoing.length - 1];
    const mid = last.dataset.mid || '';
    if(!mid) return;
    const msgs = (state.messages || []).filter(Boolean);
    const lastMsg = [...msgs].reverse().find(m => String(m.id || '') === String(mid) || String(m.clientMessageId || '') === String(mid));
    if(!lastMsg) return;
    const peerLastReadAt = Number((state.activeConversation && state.activeConversation.peerLastReadAt) || state.peerLastReadAt || 0);
    const createdAt = Number(new Date(lastMsg.createdAt || lastMsg.ts || Date.now()));
    const isRead = !!peerLastReadAt && peerLastReadAt >= createdAt;
    const status = document.createElement('div');
    status.className = 'message-read-state ' + (isRead ? 'is-read' : 'is-unread');
    const dot = document.createElement('span');
    dot.className = 'message-read-dot';
    const text = document.createElement('span');
    text.className = 'message-read-text';
    text.textContent = isRead ? '已读' : '未读';
    status.appendChild(dot);
    status.appendChild(text);
    last.appendChild(status);
  }catch(_){}
}

function renderMessages(preserveScroll = false) {
  const chatView = $("chatView"); if(!chatView) return;
  const oldScrollHeight = chatView.scrollHeight;
  chatView.innerHTML = "";
  const fragment = document.createDocumentFragment();
  let lastTime = 0;
  state.messages.forEach((msg) => {
    fragment.appendChild(buildMessageChunk(msg, lastTime));
    lastTime = msg.createdAt || lastTime;
  });
  chatView.appendChild(fragment);
  if (preserveScroll) { chatView.scrollTop = chatView.scrollHeight - oldScrollHeight; } else { setTimeout(() => chatView.scrollTo({ top: chatView.scrollHeight, behavior: 'smooth' }), 10); }
  refreshMessageReadReceipts();
}

async function fetchMessages(before = 0) {
  if (state.isLoadingMessages || !state.activeConversation) return;
  state.isLoadingMessages = true;
  try {
    const data = await api(`/api/conversations/${state.activeConversation.id}/messages?userId=${state.currentUser.id}&limit=20&before=${before}`);
    state.hasMoreMessages = data.hasMore;
    if (before === 0) {
      state.messages = data.messages;
      if (state.activeConversation) state.activeConversation.peerLastReadAt = Number(data.peerLastReadAt || state.activeConversation.peerLastReadAt || 0);
      state.peerLastReadAt = Number(data.peerLastReadAt || state.peerLastReadAt || 0);
      renderMessages();
  applyLastOutgoingReadState();
    } else if (data.messages.length > 0) {
      const oldFirst = state.messages[0] || null;
      state.messages = [...data.messages, ...state.messages];
      prependMessagesToView(data.messages, oldFirst);
    }
    state.oldestMessageTime = state.messages[0]?.createdAt || 0;
  } catch(e){} finally { state.isLoadingMessages = false; }
}

let callTimer = null; let callStartTime = 0; let outgoingTimeoutTimer = null; let incomingTimeoutTimer = null; let connectTimeoutTimer = null; let lastCallAttemptAt = 0;
function updateCallDuration() { if(!callStartTime) return; const diff = Math.floor((Date.now() - callStartTime) / 1000); const m = String(Math.floor(diff / 60)).padStart(2, '0'); const s = String(diff % 60).padStart(2, '0'); if($("callDuration")) $("callDuration").textContent = `${m}:${s}`; }
function describeMediaAccessError(err, mode) {
  const name = err && err.name ? err.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return mode === 'video' ? '摄像头或麦克风权限被拒绝，请在浏览器设置中允许访问。' : '麦克风权限被拒绝，请在浏览器设置中允许访问。';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return mode === 'video' ? '未检测到可用的摄像头或麦克风设备。' : '未检测到可用的麦克风设备。';
  if (name === 'NotReadableError' || name === 'TrackStartError') return mode === 'video' ? '摄像头或麦克风当前被其他程序占用。' : '麦克风当前被其他程序占用。';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return '当前设备不支持所需的通话能力。';
  return mode === 'video' ? '无法开启摄像头/麦克风权限' : '无法开启麦克风权限';
}
function isIgnoredCallPayload(payload) {
  if (!payload) return true;
  return Boolean(payload.callId && state.rtc.lastEndedCallId && payload.callId === state.rtc.lastEndedCallId);
}
function isCurrentCallPayload(payload) {
  if (!payload || isIgnoredCallPayload(payload)) return false;
  if (state.rtc.callId && payload.callId) return state.rtc.callId === payload.callId;
  if (state.rtc.callId && !payload.callId) return false;
  if (!state.rtc.callId && payload.callId) return false;
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
    notifyRemoteCallEvent({ ...ev, event: 'busy', reason: 'busy' });
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
async function enqueueSignal(conversationId, payload) { api(`/api/conversations/${conversationId}/signal`, { method: 'POST', body: JSON.stringify(payload) }); }

function resolveCallPeerMeta(peerId, fallbackName = '') {
  let name = fallbackName || peerId || '';
  let avatarUrl = null;
  const friend = state.friends.find(f =>
    f.friend.id === peerId ||
    f.friend.username === peerId ||
    f.friend.friendId === peerId
  );
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
    try { await state.rtc.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (_) {}
  }
}
function updateCallUIInfo(peerId, mode, statusText) { 
  if($("callTitle")) $("callTitle").textContent = statusText;
  const meta = resolveCallPeerMeta(peerId, peerId);
  if($("callName")) $("callName").textContent = meta.name || peerId || '';
  setAvatarContainer($("callAvatar"), {avatarUrl: meta.avatarUrl, displayName: meta.name}, meta.name || peerId || '');
  if($("toggleCameraBtn")) mode === 'video' ? $("toggleCameraBtn").classList.remove('hidden') : $("toggleCameraBtn").classList.add('hidden');
}
window.setCallActionLayout = (layout) => { 
  if($("acceptCallBtn")) $("acceptCallBtn").classList.toggle('hidden', layout !== 'incoming'); 
  if($("rejectCallBtn")) $("rejectCallBtn").classList.toggle('hidden', layout !== 'incoming'); 
  if($("hangupBtn")) $("hangupBtn").classList.toggle('hidden', layout === 'incoming'); 
  if($("callControls")) $("callControls").classList.toggle('hidden', layout !== 'connected'); 
  
  if (layout === 'connected') { 
      if (state.rtc.mode === 'video') { 
          if($("callInfo")) $("callInfo").classList.add('hidden'); 
          if($("videoContainer")) $("videoContainer").classList.remove('hidden'); 
      } else {
          if($("callInfo")) $("callInfo").classList.remove('hidden'); 
          if($("videoContainer")) $("videoContainer").classList.add('hidden'); 
      }
      callStartTime = Date.now(); 
      if($("callDuration")) $("callDuration").classList.remove('hidden'); 
      if(callTimer) clearInterval(callTimer);
      callTimer = setInterval(updateCallDuration, 1000);
  } else { 
      if($("callInfo")) $("callInfo").classList.remove('hidden'); 
      if($("videoContainer")) $("videoContainer").classList.add('hidden'); 
      if($("callDuration")) $("callDuration").classList.add('hidden');
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
  if ($('callPanel')) $('callPanel').classList.remove('hidden');
  setCallActionLayout('outgoing');
}
function setRtcPhase(phase) {
  state.rtc.phase = phase;
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
    const conv = (state.conversations || []).find(c => c.id === conversationId);
    const meta = resolveCallPeerMeta(peerId, conv?.title || fallbackName || peerId);
    if (state.activeConversation && state.activeConversation.id === conversationId) {
      state.activeConversation.title = conv?.title || meta.name || state.activeConversation.title || '';
      state.activeConversation.peerAvatarUrl = conv?.peerAvatarUrl || meta.avatarUrl || state.activeConversation.peerAvatarUrl || '';
      if ($("chatTitle")) $("chatTitle").textContent = state.activeConversation.title || '会话';
    }
  } catch(_) {}
}
function refreshAfterCallStateChange(conversationId) {
  try {
    sortConversationsInPlace();
    renderConversationListFromState();
    loadConversations();
    if (conversationId && state.activeConversation && state.activeConversation.id === conversationId) {
      Promise.resolve().then(async () => {
        try { await fetchMessages(); refreshMessageReadReceipts?.(); } catch(_) {}
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

    const msg = { id: 'call_'+Date.now(), senderId: 'system', type:'system', text, createdAt: new Date().toISOString() };
    state.messages = (state.messages || []).concat([msg]);
    appendMessageToView(msg);
    applyLastOutgoingReadState?.();
  }catch(_){}
}

function finalizeCall(options = {}) {
  const { alertText = '', event = '', reason = '' } = options;
  if (!hasActiveCallSession()) {
    if (alertText) alert(alertText);
    return;
  }
  const shouldNotify = event && !state.rtc.endingLocally && (state.rtc.peerId || state.rtc.incomingMeta?.senderId || state.rtc.pendingOffer?.senderId);
  if (shouldNotify) {
    state.rtc.endingLocally = true;
    notifyRemoteCallEvent(event, reason).finally(() => { state.rtc.endingLocally = false; });
  }
  window.stopCall();
  if (alertText) alert(alertText);
}
window.stopCall = () => { 
  const endedCallId = state.rtc.callId || state.rtc.pendingOffer?.callId || state.rtc.incomingMeta?.callId || state.rtc.lastEndedCallId || null;
  if (state.rtc.pc) {
    try { state.rtc.pc.onicecandidate = null; state.rtc.pc.ontrack = null; state.rtc.pc.onconnectionstatechange = null; state.rtc.pc.oniceconnectionstatechange = null; } catch(_) {}
    state.rtc.pc.close();
  }
  if (state.rtc.localStream) state.rtc.localStream.getTracks().forEach(t => t.stop()); if (state.rtc.remoteStream) state.rtc.remoteStream.getTracks().forEach(t => t.stop()); 
  state.rtc = { pc: null, mode: null, peerId: null, pendingOffer: null, incomingMeta: null, pendingAccept: false, earlyCandidates: [], phase: 'idle', endingLocally: false, conversationId: null, callId: null, lastEndedCallId: endedCallId, incomingShownKey: null }; 
  if($("localVideo")) $("localVideo").srcObject = null; if($("remoteVideo")) $("remoteVideo").srcObject = null; if($("callPanel")) $("callPanel").classList.add('hidden'); 
  isMuted = false; isCameraOff = false; isSpeaker = true; 
  if($("toggleMuteBtn")) { $("toggleMuteBtn").classList.add('active'); $("toggleMuteBtn").style.color = '#fff'; } if($("muteText")) $("muteText").textContent = "静音"; 
  if($("toggleCameraBtn")) { $("toggleCameraBtn").classList.add('active'); $("toggleCameraBtn").style.color = '#fff'; } if($("cameraText")) $("cameraText").textContent = "镜头"; 
  clearInterval(callTimer); callTimer = null; callStartTime = 0; clearAllCallTimers();
  if($("callDuration")) { $("callDuration").classList.add('hidden'); $("callDuration").textContent = "00:00"; } 
  refreshAfterCallStateChange(state.activeConversation?.id || state.rtc?.conversationId || null);
};

async function createPeerConnection(mode) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  state.rtc.pc = pc; state.rtc.mode = mode; state.rtc.remoteStream = new MediaStream(); state.rtc.remoteCandidateQueue = [];
  if($("remoteVideo")) $("remoteVideo").srcObject = state.rtc.remoteStream;
  pc.onicecandidate = async (e) => {
    if (e.candidate && state.rtc.peerId && state.rtc.conversationId) {
      enqueueSignal(state.rtc.conversationId, { senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: state.rtc.peerId, mode, callId: state.rtc.callId, signal: { type: 'candidate', candidate: e.candidate } });
    }
  };
  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => state.rtc.remoteStream.addTrack(t));
    if (state.rtc.phase !== 'connected') {
      clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null;
      setRtcPhase('connected');
      updateCallUIInfo(state.rtc.peerId, state.rtc.mode, '通话中');
      if($("chatSubtitle")) $("chatSubtitle").textContent = state.rtc.mode === 'video' ? '视频通话中' : '语音通话中';
      setCallActionLayout('connected');
    }
  };
  const markConnected = () => {
    clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null;
    setRtcPhase('connected');
    updateCallUIInfo(state.rtc.peerId, state.rtc.mode, '通话中');
    setCallActionLayout('connected');
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') {
      markConnected();
      return;
    }
    if (st === 'failed' || st === 'disconnected') {
      finalizeCall({ alertText: '通话已中断', event: 'end', reason: 'disconnect' });
    }
  };
  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'connected' || st === 'completed') {
      markConnected();
      return;
    }
    if (st === 'failed' || st === 'disconnected') {
      finalizeCall({ alertText: '通话已中断', event: 'end', reason: 'disconnect' });
    }
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' });
  } catch (err) {
    throw new Error(describeMediaAccessError(err, mode));
  }
  state.rtc.localStream = stream;
  if($("localVideo")) $("localVideo").srcObject = stream;
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
}

window.startCall = async (mode) => { 
  if (hasActiveCallSession()) return alert('当前已有通话进行中');
  const now = Date.now();
  if (now - lastCallAttemptAt < 1200) return alert('操作过快，请稍后再试');
  lastCallAttemptAt = now;
  const peerId = conversationPeerId(state.activeConversation); if (!peerId) return alert('仅支持单聊进行通话'); 
  try { 
    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    state.rtc.conversationId = state.activeConversation.id; state.rtc.peerId = peerId; state.rtc.callId = callId; setRtcPhase('outgoing'); await createPeerConnection(mode); const offer = await state.rtc.pc.createOffer(); await state.rtc.pc.setLocalDescription(offer); 
    const peerMeta = resolveCallPeerMeta(peerId, state.activeConversation?.title || peerId);
    syncCallConversationState(state.rtc.conversationId, peerId, peerMeta.name || peerId);
    updateCallUIInfo(peerId, mode, "等待对方接听...");
    if($("callName")) $("callName").textContent = peerMeta.name; if($("callPanel")) $("callPanel").classList.remove('hidden'); setCallActionLayout('outgoing'); 
    if($("chatSubtitle")) $("chatSubtitle").textContent = mode === 'video' ? '视频通话邀请中…' : '语音通话邀请中…';
    api(`/api/conversations/${state.rtc.conversationId}/call`, { method: 'POST', body: JSON.stringify({ senderId: state.currentUser.id, targetUserId: peerId, event: 'start', mode, callId, senderName: state.currentUser.displayName }) }); 
    enqueueSignal(state.rtc.conversationId, { senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: peerId, mode, callId, signal: { type: 'offer', sdp: offer } }); 
    outgoingTimeoutTimer = setTimeout(() => { finalizeCall({ alertText: "对方无应答", event: 'cancel', reason: 'timeout' }); }, 30000);
  } catch (e) { window.stopCall(); alert(e && e.message ? e.message : describeMediaAccessError(e, mode)); } 
}

function connectRealtime() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource(`/api/events?token=${encodeURIComponent(state.sessionToken || '')}`);
  state.eventSource.addEventListener('message_created', async (e) => { 
    const data = JSON.parse(e.data);
    if(state.activeConversation && state.activeConversation.id === data.conversationId && data.message) {
      const result = upsertMessage(data.message);
      if (result.action === 'append') appendMessageToView(data.message);
      else if (!replaceMessageInView(data.message)) renderMessages();
  applyLastOutgoingReadState();
      state.oldestMessageTime = state.messages[0]?.createdAt || 0;
      syncActiveConversationListMeta();
      renderConversationListFromState();
      api(`/api/conversations/${state.activeConversation.id}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) });
    } else if(state.activeConversation && state.activeConversation.id === data.conversationId) {
      await fetchMessages();
      api(`/api/conversations/${state.activeConversation.id}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) });
      syncActiveConversationListMeta();
      renderConversationListFromState();
    } else if (data.message) {
      applyIncomingConversationMeta(data.conversationId, data.message);
      renderConversationListFromState();
    } else {
      loadConversations();
    }
  });
  state.eventSource.addEventListener('message_recalled', (e) => { 
    const data = JSON.parse(e.data);
    if(state.activeConversation && state.activeConversation.id === data.conversationId) {
      if (!applyRecalledMessageLocally(data.messageId, data.senderId)) { fetchMessages(); }
      syncActiveConversationListMeta();
      renderConversationListFromState();
    } else if (data.message) {
      applyIncomingConversationMeta(data.conversationId, data.message);
      renderConversationListFromState();
    } else {
      loadConversations();
    }
  });
  state.eventSource.addEventListener('conversation_updated', loadConversations);
  state.eventSource.addEventListener('friends_updated', loadFriends);
  state.eventSource.addEventListener('friend_request_updated', loadFriendRequests);
  state.eventSource.addEventListener('mall_updated', loadMall);
  state.eventSource.addEventListener('typing_indicator', (e) => { const data = JSON.parse(e.data); if(state.activeConversation && state.activeConversation.id === data.conversationId) { if($("chatSubtitle")) $("chatSubtitle").textContent = "对方正在输入..."; clearTimeout(state.typingTimer); state.typingTimer = setTimeout(() => { applyChatRelationshipState(); }, 3000); } });

  state.eventSource.addEventListener('webrtc_signal', async (e) => {
    const payload = JSON.parse(e.data); const signal = payload.signal; if (!signal) return;
    if (signal.type === 'offer') {
      if (isIgnoredCallPayload(payload)) return;
      if (hasActiveCallSession() && !isSameIncomingCall(payload)) { api(`/api/conversations/${payload.conversationId}/call`, { method: 'POST', body: JSON.stringify({ senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: payload.senderId, event: 'reject', mode: payload.mode, reason: 'busy', callId: payload.callId || null }) }); return; }
      state.rtc.earlyCandidates = state.rtc.earlyCandidates || []; state.rtc.callId = payload.callId || state.rtc.callId || null; state.rtc.conversationId = payload.conversationId; state.rtc.incomingMeta = { senderId: payload.senderId, senderName: payload.senderName || state.rtc.incomingMeta?.senderName || null, mode: payload.mode, conversationId: payload.conversationId, callId: payload.callId || state.rtc.callId || null }; state.rtc.pendingOffer = payload; setRtcPhase('incoming');
      
      let peerName = payload.senderName || payload.senderId;
      const f = state.friends.find(x=>x.friend.id === payload.senderId);
      if(f) peerName = f.friend.remark || f.friend.displayName;
      
      if (shouldPresentIncomingUI(payload)) {
        updateCallUIInfo(payload.senderId, payload.mode, "邀请你进行通话...");
        if($("callName")) $("callName").textContent = peerName;
        if($("callPanel")) $("callPanel").classList.remove('hidden');
        setCallActionLayout('incoming');
      }
      clearTimeout(outgoingTimeoutTimer);
      clearTimeout(incomingTimeoutTimer);
      incomingTimeoutTimer = setTimeout(() => { if (state.rtc.phase === 'incoming' && isCurrentCallPayload(payload)) { finalizeCall({ alertText: '来电已超时', event: 'reject', reason: 'timeout' }); } }, 30000);
      if (state.activeConversation?.id !== payload.conversationId) window.openConversation(payload.conversationId, { skipFetch: true });
      syncCallConversationState(payload.conversationId, payload.senderId, payload.senderName || payload.senderId);
      if($("chatSubtitle")) $("chatSubtitle").textContent = payload.mode === 'video' ? '收到视频来电' : '收到语音来电';
      if (state.rtc.pendingAccept && $("acceptCallBtn")) $("acceptCallBtn").click();
    } else if (signal.type === 'answer' && state.rtc.pc) {
      if (!isCurrentCallPayload(payload)) return;
      clearTimeout(outgoingTimeoutTimer); state.rtc.callId = payload.callId || state.rtc.callId || null; setRtcPhase('connecting'); await state.rtc.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)); 
      
      let peerName = payload.senderName || state.rtc.peerId;
      const f = state.friends.find(x=>x.friend.id === state.rtc.peerId);
      if(f) peerName = f.friend.remark || f.friend.displayName;

      markCallConnecting(state.rtc.peerId, state.rtc.mode, '对方已接听，建立连接中...'); 
      if($("callName")) $("callName").textContent = peerName;
    } else if (signal.type === 'candidate') {
      if (!isCurrentCallPayload(payload)) return;
      if (state.rtc.pc && state.rtc.pc.remoteDescription) { 
        try { await state.rtc.pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (err) {} 
      } else {
        state.rtc.remoteCandidateQueue = state.rtc.remoteCandidateQueue || [];
        state.rtc.remoteCandidateQueue.push(signal.candidate);
        if ((state.rtc.pendingOffer || state.rtc.pc) && state.rtc.incomingMeta?.senderId === payload.senderId) {
          state.rtc.earlyCandidates = state.rtc.earlyCandidates || [];
          state.rtc.earlyCandidates.push(signal.candidate);
        }
      }
    }
  });

  state.eventSource.addEventListener('call_event', (e) => {
    const payload = JSON.parse(e.data);
    if (payload.event === 'start') {
      if (isIgnoredCallPayload(payload)) return;
      if (hasActiveCallSession() && !isSameIncomingCall(payload)) return;
      state.rtc.callId = payload.callId || state.rtc.callId || null;
      state.rtc.peerId = payload.senderId || state.rtc.peerId || null;
      state.rtc.conversationId = payload.conversationId; state.rtc.incomingMeta = { senderId: payload.senderId, senderName: payload.senderName || state.rtc.incomingMeta?.senderName || null, mode: payload.mode, conversationId: payload.conversationId, callId: payload.callId || state.rtc.callId || null }; setRtcPhase('incoming');
      if (shouldPresentIncomingUI(payload)) {
        updateCallUIInfo(payload.senderId, payload.mode, "收到来电");
        if($("callPanel")) $("callPanel").classList.remove('hidden');
        setCallActionLayout('incoming');
      }
      clearTimeout(incomingTimeoutTimer);
      incomingTimeoutTimer = setTimeout(() => { if (state.rtc.phase === 'incoming' && isCurrentCallPayload(payload)) { finalizeCall({ alertText: '来电已超时', event: 'reject', reason: 'timeout' }); } }, 30000);
      if (state.activeConversation?.id !== payload.conversationId) window.openConversation(payload.conversationId, { skipFetch: true });
      syncCallConversationState(payload.conversationId, payload.senderId, payload.senderName || payload.senderId);
      if($("chatSubtitle")) $("chatSubtitle").textContent = payload.mode === 'video' ? '收到视频来电' : '收到语音来电';
      return;
    }
    if (payload.event === 'accept') { if (!isCurrentCallPayload(payload)) return; clearTimeout(outgoingTimeoutTimer); clearTimeout(incomingTimeoutTimer); state.rtc.callId = payload.callId || state.rtc.callId || null; syncCallConversationState(payload.conversationId || state.rtc.conversationId, state.rtc.peerId || payload.senderId, payload.senderName || ''); markCallConnecting(state.rtc.peerId || payload.senderId, payload.mode || state.rtc.mode, '对方已接听，建立连接中...'); if($("chatSubtitle")) $("chatSubtitle").textContent = '建立连接中…'; scheduleConnectTimeout(); return; }
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
  });
  state.eventSource.onerror = () => { if(state.eventSource){state.eventSource.close(); state.eventSource=null;} setTimeout(() => { if (state.currentUser) connectRealtime(); }, 1500); };
}

window.addEventListener('pagehide', () => {
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
    const aPinned = Number(isConversationPinned(a));
    const bPinned = Number(isConversationPinned(b));
    if (bPinned !== aPinned) return bPinned - aPinned;
    return (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0);
  });
}
function renderConversationListFromState() {
  const keyword = $("searchInput") ? $("searchInput").value.trim().toLowerCase() : "";
  let filteredConvs = state.conversations || [];
  if (keyword) filteredConvs = filteredConvs.filter(c => (c.title || '').toLowerCase().includes(keyword));

  let totalUnread = 0;
  const visible = filteredConvs.filter((conv) => {
    const clearedAt = getConversationClearedAt(conv);
    return !(clearedAt && (conv.lastMessageAt || 0) <= clearedAt && !(conv.unread > 0));
  });
  visible.forEach((conv) => {
    const isMuted = isConversationMuted(conv);
    if (conv.unread && !isMuted) totalUnread += conv.unread;
  });

  const nextSignature = buildConversationSignature(visible, totalUnread);
  const container = $("chatList");
  if (nextSignature === state.chatListSignature) {
    updateMessagesTabBadge(totalUnread);
    return;
  }
  state.chatListSignature = nextSignature;

  if(container) {
    const nextIds = new Set(visible.map((conv) => String(conv.id)));
    const nextItemSignatures = {};
    const existingRows = new Map(Array.from(container.querySelectorAll('button.chat-item[data-conversation-id]')).map((node) => [node.dataset.conversationId, node]));
    const orderedNodes = [];
    if (visible.length === 0) {
      state.conversationItemSignatures = {};
      container.replaceChildren(createEmptyChatListNode());
    } else {
      visible.forEach((conv) => {
        const id = String(conv.id);
        const itemSig = buildConversationItemSignature(conv);
        nextItemSignatures[id] = itemSig;
        const existing = existingRows.get(id);
        let row = existing;
        if (!existing) row = buildConversationRow(conv);
        else if (state.conversationItemSignatures[id] !== itemSig) row = patchConversationRow(existing, conv);
        orderedNodes.push(row);
        existingRows.delete(id);
      });
      const hasOnlyEmptyState = container.children.length === 1 && container.firstElementChild && container.firstElementChild.classList.contains('chat-list-empty');
      const needsOrderUpdate = hasOnlyEmptyState || orderedNodes.length !== container.childElementCount || orderedNodes.some((node, idx) => container.children[idx] !== node);
      if (needsOrderUpdate) container.replaceChildren(...orderedNodes);
      else existingRows.forEach((node, id) => { if (!nextIds.has(id)) node.remove(); });
      state.conversationItemSignatures = nextItemSignatures;
    }
  }
  updateMessagesTabBadge(totalUnread);
}

async function loadConversations() {
  try {
    const data = await api(`/api/conversations?userId=${state.currentUser.id}`);
    state.conversations = (data.conversations || []).map(normalizeConversation);
    if (state.activeConversation) {
      const next = state.conversations.find((c) => c.id === state.activeConversation.id);
      if (next) Object.assign(state.activeConversation, {
        title: next.title || state.activeConversation.title,
        peerAvatarUrl: next.peerAvatarUrl || state.activeConversation.peerAvatarUrl,
        muted: !!next.muted,
        pinned: !!next.pinned,
        clearedAt: next.clearedAt || 0,
        peerLastReadAt: Number(next.peerLastReadAt || 0),
        unread: next.unread || 0,
        lastMessageAt: next.lastMessageAt || 0,
        preview: next.preview || ''
      });
    }
    sortConversationsInPlace();
    renderConversationListFromState();
    refreshMessageReadReceipts();
  } catch(e) { console.error(e); }
}

// ==========================================
// ★ 4. 引擎强力发车 ★
// ==========================================
async function bootstrap() {
  bindAllEvents(); // 无论如何先把所有事件绑定好
  
  try {
    const session = readSession();
    const user = session.user;
    state.sessionToken = session.token || null;
    if (!user || !user.id || !state.sessionToken) { if($("authScreen")) $("authScreen").classList.remove("hidden"); return; }
    
    try {
      const refreshed = await api(`/api/users/${user.id}/profile?viewerId=${user.id}`);
      if(refreshed.profile) {
        user.displayName = refreshed.profile.nickname; user.avatarUrl = refreshed.profile.avatarUrl; user.signature = refreshed.profile.signature; user.appNumberId = refreshed.profile.appNumberId; user.customGroups = normalizeCustomGroups(refreshed.profile.customGroups);
        writeSession(user);
      }
    } catch(e) {
      console.warn("账号已失效，需重新登录");
      localStorage.removeItem(SESSION_KEY);
      if($("authScreen")) $("authScreen").classList.remove("hidden");
      return; 
    }

    state.currentUser = user;
    if($("authScreen")) $("authScreen").classList.add("hidden"); 
    if($("appScreen")) $("appScreen").classList.remove("hidden");
    
    if($("profileDisplayName")) $("profileDisplayName").textContent = state.currentUser.displayName; 
    if($("profileUsername")) $("profileUsername").textContent = `ID: ${state.currentUser.appNumberId}`; 
    setAvatarContainer($("myProfileAvatar"), state.currentUser, state.currentUser.displayName);
    
    connectRealtime(); 
    
    ['messages', 'friends', 'mall', 'profile'].forEach(t => { if($(t+'Tab')) $(t+'Tab').classList.remove('active'); });
    if($('messagesTab')) $('messagesTab').classList.add('active');
    ["chatListView","friendListView","mallView","profileView"].forEach(id => { if($(id)) $(id).classList.add('hidden'); });
    if($("chatListView")) $("chatListView").classList.remove('hidden');
    if($("chatTitle")) $("chatTitle").textContent = "微信"; 
    
    loadConversations();
  } catch (err) {
    console.error("启动崩溃:", err);
    // 万一发生严重白屏错误，强行恢复登录页防止假死
    if($("authScreen") && $("authScreen").classList.contains("hidden") && $("appScreen") && $("appScreen").classList.contains("hidden")) {
        localStorage.removeItem(SESSION_KEY);
        $("authScreen").classList.remove("hidden");
        alert("页面重载异常，请重新登录");
    }
  }
}

// 暴力启动，绝不等待任何事件
bootstrap();