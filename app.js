const SESSION_KEY = "chattrade_api_session_user";

const $ = id => document.getElementById(id);
function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { user: null, token: null, csrfToken: null };
    const parsed = JSON.parse(raw);
    if (parsed && parsed.user && parsed.token) return parsed;
    if (parsed && parsed.id) return { user: parsed, token: null, csrfToken: null };
  } catch (_) {}
  return { user: null, token: null, csrfToken: null };
}
function writeSession(user, token, csrfToken) {
  const nextToken = token ?? state.sessionToken ?? null;
  const nextCsrf = csrfToken ?? state.csrfToken ?? null;
  // Preserve original loginAt timestamp; only set on new login (when token is provided)
  let loginAt;
  if (token) {
    loginAt = Date.now();
  } else {
    try {
      const existing = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
      loginAt = existing.loginAt || existing.savedAt || Date.now();
    } catch (_) { loginAt = Date.now(); }
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user, token: nextToken, csrfToken: nextCsrf, savedAt: Date.now(), loginAt }));
  state.sessionToken = nextToken;
  state.csrfToken = nextCsrf;
}
// Session expiry: auto-logout after 7 days or on 401
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function checkSessionExpiry() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.loginAt || parsed.savedAt) && (Date.now() - (parsed.loginAt || parsed.savedAt) > SESSION_MAX_AGE_MS)) {
      localStorage.removeItem(SESSION_KEY);
      showToast('登录已过期，请重新登录');
      setTimeout(() => location.reload(), 1500);
    }
  } catch (_) {}
}
setInterval(checkSessionExpiry, 60 * 1000);

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
    const csrf = state.csrfToken || session.csrfToken;
    if (csrf && o.method && o.method !== 'GET') headers['X-CSRF-Token'] = csrf;
    let r;
    try {
      r = await fetch(p, { ...o, headers });
    } catch (netErr) {
      const err = new Error('网络连接失败，请检查网络后重试');
      err.isNetworkError = true;
      throw err;
    }
    if (r.status === 401 && token) {
      localStorage.removeItem(SESSION_KEY);
      showToast('登录已过期，请重新登录');
      setTimeout(() => location.reload(), 1500);
      throw new Error('session_expired');
    }
    const contentType = r.headers.get("content-type") || "";
    const d = contentType.includes("application/json") ? await r.json() : {};
    if(!r.ok) throw new Error(d.error || `http_${r.status}`);
    return d;
}
function escapeHTML(s) { return typeof s!=='string'?'':s.replace(/[&<>'"]/g,t=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[t])); }
const firstChar = t => String(t||'').trim().charAt(0)||'?';
// Loading overlay for async operations
function showLoading(msg = '加载中...') {
  let overlay = $('globalLoadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'globalLoadingOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:20px 30px;border-radius:12px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.15);';
    box.innerHTML = '<div style="width:28px;height:28px;border:3px solid #e0e0e0;border-top-color:#07c160;border-radius:50%;animation:spin .6s linear infinite;margin:0 auto 10px;"></div>';
    const txt = document.createElement('div');
    txt.id = 'globalLoadingText';
    txt.style.cssText = 'font-size:14px;color:#333;';
    txt.textContent = msg;
    box.appendChild(txt);
    overlay.appendChild(box);
    if (!document.getElementById('spinKeyframes')) {
      const style = document.createElement('style');
      style.id = 'spinKeyframes';
      style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
    document.body.appendChild(overlay);
  } else {
    const txt = $('globalLoadingText');
    if (txt) txt.textContent = msg;
    overlay.style.display = 'flex';
  }
}
function hideLoading() {
  const overlay = $('globalLoadingOverlay');
  if (overlay) overlay.style.display = 'none';
}
// Double-click prevention: wraps an async handler so the button is disabled during execution
function withButtonLock(btn, asyncFn, loadingText) {
  if (!btn || btn.disabled) return;
  const origText = btn.textContent;
  btn.disabled = true;
  if (loadingText) btn.textContent = loadingText;
  Promise.resolve(asyncFn()).catch(() => {}).finally(() => {
    btn.disabled = false;
    if (loadingText) btn.textContent = origText;
  });
}
function showToast(msg, duration = 2000){
  let el = document.getElementById('_toast');
  if(!el){
    el = document.createElement('div');
    el.id = '_toast';
    el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.76);color:#fff;padding:10px 22px;border-radius:8px;font-size:14px;z-index:99999;pointer-events:none;opacity:0;transition:opacity .25s;white-space:nowrap;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, duration);
}

// ---- Custom Modal Dialog (replaces native alert) ----
function showModal(msg, onOk) {
  let overlay = document.getElementById('_appModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_appModal';
    overlay.innerHTML =
      '<div class="app-modal-mask"></div>' +
      '<div class="app-modal-box">' +
        '<div class="app-modal-body"></div>' +
        '<div class="app-modal-footer">' +
          '<button class="app-modal-cancel" style="display:none">取消</button>' +
          '<button class="app-modal-ok">确定</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    // Style
    const s = document.createElement('style');
    s.textContent =
      '#_appModal{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;}' +
      '#_appModal.hidden{display:none;}' +
      '.app-modal-mask{position:absolute;inset:0;background:rgba(0,0,0,.45);}' +
      '.app-modal-box{position:relative;width:280px;max-width:85vw;background:#fff;border-radius:14px;overflow:hidden;text-align:center;animation:modalIn .2s ease;}' +
      '@keyframes modalIn{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}' +
      '.app-modal-body{padding:24px 20px 16px;font-size:15px;line-height:1.5;color:#333;word-break:break-word;white-space:pre-wrap;max-height:60vh;overflow-y:auto;}' +
      '.app-modal-footer{display:flex;border-top:0.5px solid #e5e7eb;}' +
      '.app-modal-footer button{flex:1;height:44px;border:none;background:transparent;font-size:16px;cursor:pointer;transition:background .15s;}' +
      '.app-modal-footer button:active{background:#f2f2f6;}' +
      '.app-modal-cancel{color:#999;border-right:0.5px solid #e5e7eb !important;}' +
      '.app-modal-ok{color:#07c160;font-weight:600;}';
    document.head.appendChild(s);
  }
  overlay.classList.remove('hidden');
  overlay.querySelector('.app-modal-body').textContent = msg;
  const cancelBtn = overlay.querySelector('.app-modal-cancel');
  const okBtn = overlay.querySelector('.app-modal-ok');
  cancelBtn.style.display = 'none';
  const close = () => { overlay.classList.add('hidden'); };
  okBtn.onclick = () => { close(); if (onOk) onOk(); };
  overlay.querySelector('.app-modal-mask').onclick = close;
}
function showConfirm(msg, onOk, onCancel) {
  showModal(msg);
  const overlay = document.getElementById('_appModal');
  const cancelBtn = overlay.querySelector('.app-modal-cancel');
  const okBtn = overlay.querySelector('.app-modal-ok');
  cancelBtn.style.display = '';
  cancelBtn.onclick = () => { overlay.classList.add('hidden'); if (onCancel) onCancel(); };
  okBtn.onclick = () => { overlay.classList.add('hidden'); if (onOk) onOk(); };
}

function normalizePhoneInput(phone){
  const digits = String(phone || '').replace(/\D+/g, '');
  let normalized = digits;
  if (normalized.startsWith('86') && normalized.length === 13 && normalized[2] === '1') {
    normalized = normalized.slice(2);
  }
  if (!/^1\d{10}$/.test(normalized)) return '';
  return normalized;
}

const state = { 
  currentUser: null, sessionToken: null, conversations: [], activeConversation: null, messages: [], 
  friends: [], friendRequests: [], currentProfileUser: null, targetForGroupMove: null,
  profileStoreItems: [], profileCartBySeller: {}, selectedProfileProduct: null, selectedProfileSpec: '', profileOrders: [], currentCartSellerId: '',
  profileStoreExpanded: false,
  systemMessages: [],
  adminDashboard: null,
  paymentCodeDraft: { wechat:'', alipay:'', cloudpay:'' },
  buyerOrders: [], sellerOrders: [], sellerProducts: [], selectedOrderDetail: null, selectedOrderRole: 'buyer', selectedProductDetail: null, publishEditingProductId: '', sellerProductViewTab: 'listed', sellerProductSearch: '', sellerProductSort: 'newest', buyerOrderSearch: '', buyerOrderFrom: '', buyerOrderTo: '', sellerOrderSearch: '', sellerOrderFrom: '', sellerOrderTo: '', broadcastDrafts: [], tradePickerResolver: null,
  hasMoreMessages: false, isLoadingMessages: false, oldestMessageTime: 0, 
  eventSource: null, peerLastReadAt: 0, rtc: { pc: null, mode: null, peerId: null, pendingOffer: null, incomingMeta: null, pendingAccept: false, earlyCandidates: [], remoteCandidateQueue: [], phase: 'idle', endingLocally: false, conversationId: null, callId: null, lastEndedCallId: null, incomingShownKey: null }, 
  typingTimer: null, mediaRecorder: null, audioChunks: [], chatListSignature: '', friendListSignature: '', mallListSignature: '', conversationItemSignatures: {}, friendGroupSignatures: {}, friendItemSignatures: {}, mallItemSignatures: {},
  mallTab: 'nearby', userLocation: null, userLocationName: '正在定位...',
  sidebarMode: 'expanded'
};
let isMuted = false, isCameraOff = false, isSpeaker = false;

const isFriendUser = (userId) => !!(userId && (state.friends || []).some(f => (f.friend?.id || f.friendId) === userId));

function getPendingFriendRequest(userId) {
  return state.friendRequests.find(r => r.status === 'pending' && (r.sender?.id === userId || r.fromUser?.id === userId));
}

function updateProfileDetailActions(){
  const p = state.currentProfileUser;
  if(!p) return;
  const isFriend = !!p.isFriend || isFriendUser(p.id);
  const isSelf = p.id === state.currentUser?.id;
  const pendingReq = !isFriend && !isSelf ? getPendingFriendRequest(p.id) : null;
  if($("profileAddFriendBtn")) $("profileAddFriendBtn").classList.toggle("hidden", isFriend || !!pendingReq);
  if($("profileStrangerHint")) $("profileStrangerHint").classList.toggle("hidden", isFriend);
  if($("profileActionRemarkBtn")) $("profileActionRemarkBtn").style.display = isFriend ? '' : 'none';
  if($("profileActionMoveGroupBtn")) $("profileActionMoveGroupBtn").style.display = isFriend ? '' : 'none';
  if($("profileSendMessageBtn")) $("profileSendMessageBtn").classList.toggle("hidden", isSelf);
  if($("profilePrimaryActions")) $("profilePrimaryActions").classList.toggle('hidden', isFriend || isSelf || !!pendingReq);
  if($("profileFriendRequestActions")) {
    $("profileFriendRequestActions").classList.toggle('hidden', !pendingReq);
    // Always rebind to avoid stale closure; clear when no pending request
    if (pendingReq) {
      const reqId = pendingReq.id;
      if($("profileAcceptRequestBtn")) $("profileAcceptRequestBtn").onclick = () => window.acceptRequest(reqId);
      if($("profileRejectRequestBtn")) $("profileRejectRequestBtn").onclick = () => window.rejectRequest(reqId);
    } else {
      if($("profileAcceptRequestBtn")) $("profileAcceptRequestBtn").onclick = null;
      if($("profileRejectRequestBtn")) $("profileRejectRequestBtn").onclick = null;
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

function formatMoney(v){
  const n = Number(String(v).replace(/[^\d.]/g, '')) || 0;
  return `¥${n.toFixed(2)}`;
}

function parseMoney(v){
  return Number(String(v).replace(/[^\d.]/g, '')) || 0;
}

function getSecondaryBackTarget(defaultTarget = 'home'){
  if (state.secondaryPage) return state.secondaryPage;
  if (state.secondaryReturn) return state.secondaryReturn;
  return defaultTarget;
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
  renderConversationListFromState();
}

async function loadSellerOrders(){
  if(!state.currentUser) return;
  try{
    const data = await api(`/api/orders?sellerId=${encodeURIComponent(state.currentUser.id)}`);
    state.sellerOrders = data.orders || [];
  }catch(_){
    state.sellerOrders = [];
  }
  renderSellerOrdersManage();
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

async function loadSellerProductsManage(){
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
}


function orderMatchesFilters(order, role = 'buyer'){
  const prefix = role === 'seller' ? 'seller' : 'buyer';
  const keyword = String(state[`${prefix}OrderSearch`] || '').trim().toLowerCase();
  const fromVal = state[`${prefix}OrderFrom`] || '';
  const toVal = state[`${prefix}OrderTo`] || '';
  const createdAt = Number(order?.createdAt || 0);
  if (keyword) {
    const hay = `#${String(order?.id || '').slice(-6)} ${(order?.items || []).map(i => `${i.title} ${i.spec || ''}`).join(' ')}`.toLowerCase();
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
  const prefix = role === 'seller' ? 'seller' : 'buyer';
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
  const prefix = role === 'seller' ? 'seller' : 'buyer';
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
      const start = now - (days * 24 * 60 * 60 * 1000);
      active = Math.abs(fromTs - start) < 2 * 60 * 1000 && Math.abs(toTs - now) < 2 * 60 * 1000;
    }
    btn.classList.toggle('active', active);
  });
}

function applyOrderQuickRange(role = 'buyer', days = 0){
  const prefix = role === 'seller' ? 'seller' : 'buyer';
  const now = new Date();
  const from = new Date(now.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  const fmt = (d) => {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };
  state[`${prefix}OrderFrom`] = fmt(from);
  state[`${prefix}OrderTo`] = fmt(now);
  if (role === 'seller') renderSellerOrdersManage();
  else renderBuyerOrdersManage();
}

/* ── WeChat-style Date Picker ── */
const _dp = {
  overlay: null, callback: null, role: '', which: '',
  cols: { year: null, month: null, day: null, hour: null, minute: null },
  ranges: { year: [], month: [], day: [], hour: [], minute: [] },
  selected: { year: 0, month: 0, day: 0, hour: 0, minute: 0 },
};

function dpInit() {
  _dp.overlay = $('datePickerOverlay');
  _dp.cols.year = $('dpColYear');
  _dp.cols.month = $('dpColMonth');
  _dp.cols.day = $('dpColDay');
  _dp.cols.hour = $('dpColHour');
  _dp.cols.minute = $('dpColMinute');
}

function dpBuildItems(col, items, selectedVal) {
  if (!col) return;
  const ITEM_H = 44;
  const padCount = 2; // blank items top/bottom for centering
  col.innerHTML = '';
  for (let i = 0; i < padCount; i++) {
    const pad = document.createElement('div');
    pad.className = 'dp-item dp-pad';
    col.appendChild(pad);
  }
  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'dp-item';
    el.textContent = item.label;
    el.dataset.value = item.value;
    if (item.value === selectedVal) el.classList.add('selected');
    col.appendChild(el);
  });
  for (let i = 0; i < padCount; i++) {
    const pad = document.createElement('div');
    pad.className = 'dp-item dp-pad';
    col.appendChild(pad);
  }
  // Scroll to selected
  const idx = items.findIndex(i => i.value === selectedVal);
  if (idx >= 0) col.scrollTop = idx * ITEM_H;
}

function dpGetSelectedIndex(col) {
  const ITEM_H = 44;
  const scrollTop = col.scrollTop;
  return Math.round(scrollTop / ITEM_H);
}

function dpHighlight(col, items) {
  const idx = dpGetSelectedIndex(col);
  const allItems = col.querySelectorAll('.dp-item:not(.dp-pad)');
  allItems.forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
  return items[idx]?.value;
}

function dpDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function dpRebuildDays() {
  const y = _dp.selected.year;
  const m = _dp.selected.month;
  const maxD = dpDaysInMonth(y, m);
  const days = [];
  for (let d = 1; d <= maxD; d++) days.push({ value: d, label: d + '日' });
  _dp.ranges.day = days;
  if (_dp.selected.day > maxD) _dp.selected.day = maxD;
  dpBuildItems(_dp.cols.day, days, _dp.selected.day);
}

function dpSetupScroll(col, key, items, onChange) {
  let timer = null;
  col.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const val = dpHighlight(col, items());
      if (val !== undefined) {
        _dp.selected[key] = val;
        if (onChange) onChange();
      }
    }, 80);
  }, { passive: true });
}

function openDatePicker(role, which, currentVal) {
  if (!_dp.overlay) dpInit();
  _dp.role = role;
  _dp.which = which;

  const now = new Date();
  let d = currentVal ? new Date(currentVal) : now;
  if (isNaN(d.getTime())) d = now;

  _dp.selected.year = d.getFullYear();
  _dp.selected.month = d.getMonth() + 1;
  _dp.selected.day = d.getDate();
  _dp.selected.hour = d.getHours();
  _dp.selected.minute = d.getMinutes();

  // Build year range: current year -2 to +1
  const curYear = now.getFullYear();
  const years = [];
  for (let y = curYear - 2; y <= curYear + 1; y++) years.push({ value: y, label: y + '年' });
  _dp.ranges.year = years;

  const months = [];
  for (let m = 1; m <= 12; m++) months.push({ value: m, label: m + '月' });
  _dp.ranges.month = months;

  const hours = [];
  for (let h = 0; h < 24; h++) hours.push({ value: h, label: String(h).padStart(2, '0') + '时' });
  _dp.ranges.hour = hours;

  const minutes = [];
  for (let mi = 0; mi < 60; mi += 5) minutes.push({ value: mi, label: String(mi).padStart(2, '0') + '分' });
  _dp.ranges.minute = minutes;
  // Snap minute to nearest 5
  _dp.selected.minute = Math.round(_dp.selected.minute / 5) * 5;
  if (_dp.selected.minute >= 60) _dp.selected.minute = 55;

  dpBuildItems(_dp.cols.year, years, _dp.selected.year);
  dpBuildItems(_dp.cols.month, months, _dp.selected.month);
  dpRebuildDays();
  dpBuildItems(_dp.cols.hour, hours, _dp.selected.hour);
  dpBuildItems(_dp.cols.minute, minutes, _dp.selected.minute);

  // Re-attach scroll listeners (remove old by cloning)
  ['year', 'month', 'day', 'hour', 'minute'].forEach(key => {
    const oldCol = _dp.cols[key];
    const newCol = oldCol.cloneNode(true);
    oldCol.parentNode.replaceChild(newCol, oldCol);
    _dp.cols[key] = newCol;
    const getItems = () => _dp.ranges[key];
    const onChange = (key === 'year' || key === 'month') ? dpRebuildDays : null;
    dpSetupScroll(newCol, key, getItems, onChange);
    // Re-scroll after clone
    const idx = _dp.ranges[key].findIndex(i => i.value === _dp.selected[key]);
    if (idx >= 0) newCol.scrollTop = idx * 44;
  });

  _dp.overlay.classList.remove('hidden');
}

function closeDatePicker(confirmed) {
  if (!_dp.overlay) return;
  _dp.overlay.classList.add('hidden');
  if (!confirmed) return;

  const { year, month, day, hour, minute } = _dp.selected;
  const dt = new Date(year, month - 1, day, hour, minute);
  const pad = n => String(n).padStart(2, '0');
  // Format as datetime-local compatible value
  const val = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;

  const prefix = _dp.role === 'seller' ? 'seller' : 'buyer';
  const stateKey = _dp.which === 'from' ? `${prefix}OrderFrom` : `${prefix}OrderTo`;
  state[stateKey] = val;

  // Update hidden input
  const inputId = _dp.which === 'from' ? `${prefix}OrdersFromInput` : `${prefix}OrdersToInput`;
  const inp = $(inputId);
  if (inp) inp.value = val;

  // Update button text
  const btnId = _dp.which === 'from' ? `${prefix}OrdersFromBtn` : `${prefix}OrdersToBtn`;
  const btn = $(btnId);
  if (btn) {
    btn.textContent = `${year}/${pad(month)}/${pad(day)} ${pad(hour)}:${pad(minute)}`;
    btn.classList.remove('placeholder');
  }

  if (_dp.role === 'seller') renderSellerOrdersManage();
  else renderBuyerOrdersManage();
}

function syncOrderDateBtnText(role) {
  const prefix = role === 'seller' ? 'seller' : 'buyer';
  ['from', 'to'].forEach(which => {
    const stateKey = which === 'from' ? `${prefix}OrderFrom` : `${prefix}OrderTo`;
    const btnId = which === 'from' ? `${prefix}OrdersFromBtn` : `${prefix}OrdersToBtn`;
    const val = state[stateKey] || '';
    const btn = $(btnId);
    if (!btn) return;
    if (val) {
      const dt = new Date(val);
      if (!isNaN(dt.getTime())) {
        const pad = n => String(n).padStart(2, '0');
        btn.textContent = `${dt.getFullYear()}/${pad(dt.getMonth()+1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        btn.classList.remove('placeholder');
        return;
      }
    }
    btn.textContent = '请选择';
    btn.classList.add('placeholder');
  });
}

async function deleteOrderRecord(orderId){
  if(!orderId) return;
  try{
    await api(`/api/orders/${orderId}/delete`, { method:'POST', body: JSON.stringify({}) });
    await Promise.all([loadBuyerOrders(), loadSellerOrders()]);
    if (state.currentProfileUser?.id) await loadProfileOrders();
    showToast('订单已删除');
  }catch(e){
    showModal(e.message || '删除失败（仅已完成订单可删除）');
  }
}

function orderStatusText(status){
  return formatOrderStatusLabel(status);
}

function buildOrderCard(order, role){
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'profile-order-card';

  const header = document.createElement('div');
  header.className = 'order-card-header';
  const idSpan = document.createElement('span');
  idSpan.className = 'order-card-id';
  idSpan.textContent = `#${String(order.id || '').slice(-6)}`;
  const statusSpan = document.createElement('span');
  const st = String(order.status || '').toLowerCase();
  statusSpan.className = 'order-card-status' + (st === 'completed' ? ' s-done' : (st === 'accepted' || st === 'processing' || st === 'in_progress') ? ' s-active' : ' s-pending');
  statusSpan.textContent = orderStatusText(order.status);
  header.append(idSpan, statusSpan);

  const body = document.createElement('div');
  body.className = 'order-card-body';
  const itemsText = document.createElement('div');
  itemsText.className = 'order-card-items';
  itemsText.textContent = (order.items || []).map(i => `${i.title}(${i.spec || '默认'}) x${i.quantity || 1}`).join('，') || '订单内容';
  body.appendChild(itemsText);

  const footer = document.createElement('div');
  footer.className = 'order-card-footer';
  const price = document.createElement('span');
  price.className = 'order-card-price';
  price.textContent = formatMoney(order.total);
  const time = document.createElement('span');
  time.className = 'order-card-time';
  time.textContent = order.createdAt ? formatTime(order.createdAt) : '';
  footer.append(price, time);

  card.append(header, body, footer);

  if(order.status === 'completed'){
    const actions = document.createElement('div');
    actions.className = 'order-card-actions';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'order-card-del-btn';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if(delBtn.disabled) return;
      if(!confirm('确认删除该订单？')) return;
      delBtn.disabled = true; delBtn.textContent = '删除中...';
      try { await deleteOrderRecord(order.id); } finally { delBtn.disabled = false; delBtn.textContent = '删除'; }
    });
    actions.appendChild(delBtn);
    card.appendChild(actions);
  }

  card.addEventListener('click', () => openOrderDetail(order, role));
  return card;
}

function renderBuyerOrdersManage(){
  const list = $("buyerOrdersManageList");
  if(!list) return;
  syncOrderFilterInputs('buyer');
  const rows = (state.buyerOrders || []).filter((o) => orderMatchesFilters(o, 'buyer'));
  if(!rows.length){
    const empty = document.createElement('div');
    empty.className = 'order-empty-state';
    empty.textContent = '🧾 暂无购买订单';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach(order => frag.appendChild(buildOrderCard(order, 'buyer')));
  list.replaceChildren(frag);
}


function renderSellerOrdersManage(){
  const list = $("sellerOrdersList");
  if(!list) return;
  syncOrderFilterInputs('seller');
  const rows = (state.sellerOrders || []).filter((o) => orderMatchesFilters(o, 'seller'));
  if(!rows.length){
    const empty = document.createElement('div');
    empty.className = 'order-empty-state';
    empty.textContent = '📋 暂无卖家订单';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach(order => frag.appendChild(buildOrderCard(order, 'seller')));
  list.replaceChildren(frag);
}


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
    if (p.category) p.category.split(/[\/,、]/).forEach(c => { const t = c.trim(); if (t) cats.add(t); });
  });
  // Also merge from presets if loaded
  (state._sellerCategoryPresets || []).forEach(c => cats.add(c));
  const prev = sel.value;
  sel.innerHTML = '<option value="">全部分类</option>';
  [...cats].sort().forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    sel.appendChild(opt);
  });
  sel.value = prev || '';
}

function getFilteredSellerProducts(){
  const all = Array.isArray(state.sellerProducts) ? [...state.sellerProducts] : [];
  const showUnlisted = state.sellerProductViewTab === 'unlisted';
  const keyword = String(state.sellerProductSearch || '').trim().toLowerCase();
  const catFilter = String(state.sellerProductCategoryFilter || '').trim();
  const visible = all.filter((item) => {
    const listed = item?.listed !== false;
    if (showUnlisted ? listed : !listed) return false;
    if (catFilter) {
      const itemCats = (item.category || '').split(/[\/,、]/).map(s => s.trim());
      if (!itemCats.includes(catFilter)) return false;
    }
    if (keyword) {
      const hay = `${item.title || ''} ${item.category || ''} ${item.desc || ''}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });
  const sortBy = state.sellerProductSort || 'newest';
  visible.sort((a, b) => {
    if (sortBy === 'price_asc') return parseMoney(a.price) - parseMoney(b.price);
    if (sortBy === 'price_desc') return parseMoney(b.price) - parseMoney(a.price);
    if (sortBy === 'stock_desc') return (Number(b.stock)||0) - (Number(a.stock)||0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  return visible;
}

function renderSellerProductsManage(){
  const list = $("sellerProductsList");
  if(!list) return;
  populateSellerCategoryFilter();
  updateSellerProductsFilterUI();
  const products = getFilteredSellerProducts();
  if(!products.length){
    const empty = document.createElement('div');
    empty.className = 'order-empty-state';
    empty.textContent = '📦 ' + (state.sellerProductViewTab === 'unlisted' ? '暂无未上架商品' : '暂无已上架商品，可先发布');
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  products.forEach(item => {
    const card = document.createElement('div');
    card.className = 'sp-card';
    card.addEventListener('click', () => openProductDetail(item, true));

    const imgUrl = normalizeMediaUrl(item.image || item.imageUrl) || '';
    if (imgUrl) {
      const img = document.createElement('img');
      img.className = 'sp-card-img';
      img.src = imgUrl;
      img.alt = item.title || '商品';
      img.onerror = function() { this.style.display = 'none'; };
      card.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'sp-card-body';

    const topRow = document.createElement('div');
    topRow.className = 'sp-card-top';
    const title = document.createElement('div');
    title.className = 'sp-card-title';
    title.textContent = item.title || '未命名商品';
    topRow.appendChild(title);
    body.appendChild(topRow);

    const desc = document.createElement('div');
    desc.className = 'sp-card-desc';
    desc.textContent = item.desc || '可在商品详情页继续编辑文案与规格';
    body.appendChild(desc);

    const meta = document.createElement('div');
    meta.className = 'sp-card-meta';
    const price = document.createElement('span');
    price.className = 'sp-card-price';
    price.textContent = formatMoney(item.price);
    const stockNum = Math.max(0, Math.floor(Number(item.stock || 0)));
    const stockSpan = document.createElement('span');
    stockSpan.className = 'sp-card-stock' + (stockNum === 0 ? ' low' : '');
    stockSpan.textContent = `库存 ${stockNum}`;
    meta.append(price, stockSpan);
    body.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'sp-card-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'sp-action-btn';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openPublishProductPage('sellerProductsPage', item); });

    const stockBtn = document.createElement('button');
    stockBtn.type = 'button';
    stockBtn.className = 'sp-action-btn';
    stockBtn.textContent = '改库存';
    stockBtn.addEventListener('click', (e) => { e.stopPropagation(); window.updateSellerProductStock(item.id, item.stock || 0); });

    const listedBtn = document.createElement('button');
    listedBtn.type = 'button';
    listedBtn.className = 'sp-action-btn' + (item.listed === false ? ' accent' : '');
    listedBtn.textContent = item.listed === false ? '上架' : '下架';
    listedBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (listedBtn.disabled) return;
      listedBtn.disabled = true;
      await window.toggleSellerProductListed(item.id, item.listed === false);
      listedBtn.disabled = false;
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'sp-action-btn danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); window.deleteMyProduct(item.id); });

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
  if($("productDetailImage")) { $("productDetailImage").src = normalizeMediaUrl(item.image || item.imageUrl) || ''; $("productDetailImage").onerror = function() { this.style.display = 'none'; }; }
  if($("productDetailTitle")) $("productDetailTitle").textContent = item.title || '商品';
  if($("productDetailDesc")) $("productDetailDesc").textContent = item.desc || '商品详情页为图片、文字、价格与规格';
  if($("productDetailPrice")) $("productDetailPrice").textContent = formatMoney(item.price);
  const stock = Math.max(0, Math.floor(Number(item.stock || 0)));
  if($("productDetailStock")) $("productDetailStock").textContent = `库存 ${stock}`;
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
  if($("productDetailBuyNowBtn")) $("productDetailBuyNowBtn").classList.toggle('hidden', fromSeller);
  if($("productDetailAddCartBtn")) $("productDetailAddCartBtn").classList.toggle('hidden', fromSeller);
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
  if(!order){
    box.textContent = '暂无订单详情';
    return;
  }
  if($("orderDetailStatus")) $("orderDetailStatus").textContent = orderStatusText(order.status);
  box.replaceChildren();
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
  if(!order?.id) return;
  const raw = prompt('请输入新的总价', String(order.total || ''));
  if(raw === null) return;
  try{
    const data = await api(`/api/orders/${order.id}/price`, { method:'POST', body: JSON.stringify({ total: parseMoney(raw) }) });
    state.selectedOrderDetail = data.order || order;
    await Promise.all([loadSellerOrders(), loadProfileOrders(), state.activeConversation?.id ? reloadActiveConversationMessages() : Promise.resolve()]);
    renderOrderDetailPage();
  }catch(e){ showModal(e.message || '修改失败'); }
}

async function completeSelectedOrder(){
  const order = state.selectedOrderDetail;
  if(!order?.id) return;
  try{
    const data = await api(`/api/orders/${order.id}/status`, { method:'POST', body: JSON.stringify({ status:'completed' }) });
    state.selectedOrderDetail = data.order || order;
    await Promise.all([loadSellerOrders(), loadProfileOrders(), loadBuyerOrders()]);
    renderOrderDetailPage();
  }catch(e){ showModal(e.message || '更新失败'); }
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

async function loadProfileStore(userId){
  if(!userId || !state.currentUser) return;
  state.profileStoreExpanded = false;
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
  openProductDetail(item, false);
}

function getProfileStoreItemCartQuantity(item){
  if(!item) return 0;
  const cart = getCurrentSellerCart(item.sellerId || state.currentProfileUser?.id || '');
  if(!cart.length) return 0;
  return cart
    .filter((entry) => String(entry.productId) === String(item.id))
    .reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
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
  const allItems = (state.profileStoreItems || []).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  if(title) title.textContent = `在售商品 ${allItems.length}`;
  if(!allItems.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无在售商品';
    list.replaceChildren(empty);
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
    const card = document.createElement('div');
    card.className = 'profile-store-item';
    card.addEventListener('click', () => openProductDetail(item, false));

    const img = document.createElement('img');
    img.src = normalizeMediaUrl(item.image || item.imageUrl) || '';
    img.alt = item.title || '商品';

    const info = document.createElement('div');
    info.className = 'profile-store-info';
    const title = document.createElement('div');
    title.className = 'profile-store-title';
    title.textContent = item.title || '未命名商品';
    const desc = document.createElement('div');
    desc.className = 'profile-store-desc';
    const categoryText = item.category ? `【${item.category}】` : '';
    desc.textContent = `${categoryText}${item.desc || '商品详情页包含图片、文字与价格'}`;
    const price = document.createElement('div');
    price.className = 'profile-store-price';
    price.textContent = formatMoney(item.price);
    const stock = document.createElement('div');
    stock.className = 'profile-store-desc';
    stock.textContent = `库存：${getItemAvailableStock(item)}`;
    info.append(title, desc, price, stock);

    const side = document.createElement('div');
    side.className = 'profile-store-side';
    const hasMultiSpecs = Array.isArray(item.specs) && item.specs.length > 1;
    const qty = getProfileStoreItemCartQuantity(item);
    if(hasMultiSpecs){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary-btn';
      btn.textContent = qty > 0 ? `选规格 (${qty})` : '选规格';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openProductSpecSheet(item);
      });
      side.appendChild(btn);
    }else{
      const stepper = document.createElement('div');
      stepper.className = 'profile-qty-stepper';
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'qty-btn';
      minus.textContent = '−';
      minus.disabled = qty <= 0;
      minus.addEventListener('click', (e) => {
        e.stopPropagation();
        adjustProfileStoreItemQuantity(item, -1);
      });
      const qtyText = document.createElement('span');
      qtyText.className = 'qty-num';
      qtyText.textContent = String(qty);
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'qty-btn primary';
      plus.textContent = '+';
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
  const inCartQty = getProfileStoreItemCartQuantity(item);
  const availableStock = getItemAvailableStock(item);
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
  saveCartToStorage();
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
    const knownSeller = (state.sellerOrders || []).find((o) => o.sellerId === sellerId)?.sellerName
      || (state.buyerOrders || []).find((o) => o.sellerId === sellerId)?.sellerName;
    const title = profile?.displayName || profile?.nickname || knownSeller || `商家 ${sellerId.slice(-6)}`;
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
      window.openSecondaryPage('profileCartPage', 'cartHubPage');
    });
    line.appendChild(document.createElement('span'));
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
    const payload = {
      sellerId,
      items: currentCart.map(item => ({
        productId: item.productId,
        title: item.title,
        spec: item.spec,
        quantity: item.quantity,
        price: Number(item.unitPrice || 0)
      }))
    };
    await api('/api/orders', { method:'POST', body: JSON.stringify(payload) });
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
    window.openSecondaryPage('profileOrdersPage', backTo);
  }catch(e){
    hideLoading();
    showModal(e.message || '提交订单失败');
  }
}

async function loadProfileOrders(){
  const profileUserId = state.currentProfileUser?.id;
  if(!profileUserId || !state.currentUser) return;
  try{
    const data = await api(`/api/orders?sellerId=${profileUserId}`);
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

async function renderBuyerOrdersPage(){
  await loadProfileOrders();
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
    status.textContent = formatOrderStatusLabel(order.status);

    const actions = document.createElement('div');
    actions.className = 'profile-order-actions';
    const canManage = state.currentUser?.id && state.currentUser.id === order.sellerId;

    if (canManage) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'secondary-btn';
      editBtn.textContent = '修改价格';
      editBtn.addEventListener('click', async () => {
        if(!order.id) return;
        const raw = prompt('请输入新的总价', String(order.total || ''));
        if(raw === null) return;
        try{
          await api(`/api/orders/${order.id}/price`, { method:'POST', body: JSON.stringify({ total: parseMoney(raw) }) });
          await loadProfileOrders();
        }catch(e){ showModal(e.message || '修改失败'); }
      });
      actions.appendChild(editBtn);

      if(order.status !== 'completed'){
        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'primary-btn';
        doneBtn.textContent = '标记已完成';
        doneBtn.addEventListener('click', async (e) => { e.stopPropagation();
          if(!order.id) return;
          try{
            await api(`/api/orders/${order.id}/status`, { method:'POST', body: JSON.stringify({ status:'completed' }) });
            await loadProfileOrders();
            if(state.activeConversation?.id) await reloadActiveConversationMessages();
          }catch(e){ showModal(e.message || '更新失败'); }
        });
        actions.appendChild(doneBtn);
      }
    }

    card.append(title, sub, status);
    if (actions.childElementCount) card.appendChild(actions);
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
    || (state.conversations || []).find((c) => c.id === state.activeConversation?.id)?.peerIsFriend === true;
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
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = emptyText || '暂无可选项';
    list.appendChild(empty);
  } else {
    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'profile-order-card';
      btn.innerHTML = `<div class="profile-order-title">${idx + 1}. ${escapeHTML(renderLine(item))}</div>`;
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
  if ($("ccpConfirmBar")) $("ccpConfirmBar").classList.add('hidden');
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
  const all = [...(state.buyerOrders || []), ...(state.sellerOrders || [])];
  const seen = new Set();
  return all.filter((o) => {
    if(!o || seen.has(o.id)) return false;
    const match = (o.buyerId === state.currentUser?.id && o.sellerId === peerId) || (o.sellerId === state.currentUser?.id && o.buyerId === peerId);
    if(match) seen.add(o.id);
    return match;
  });
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
    const groupName = item.group || '我的好友';
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName).push(f);
  });

  // Count total visible
  let totalVisible = 0;
  grouped.forEach(members => { totalVisible += members.length; });
  if (totalVisible === 0) {
    const empty = document.createElement('div');
    empty.className = 'ccp-empty';
    empty.textContent = search ? '未找到匹配的好友' : '通讯录暂无好友可发送';
    list.replaceChildren(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  grouped.forEach((members, groupName) => {
    if (!members.length) return;
    const section = document.createElement('div');
    section.dataset.groupName = groupName;

    const header = document.createElement('div');
    header.className = 'qq-group-header expanded';
    header.dataset.role = 'friend-group-header';
    header.textContent = groupName + ' ';
    const count = document.createElement('span');
    count.style.cssText = 'color:#8e8e93;font-size:12px;margin-left:6px;';
    count.textContent = String(members.length);
    header.appendChild(count);
    header.addEventListener('click', () => window.toggleQQGroup(header));

    const content = document.createElement('div');
    content.className = 'qq-group-content expanded';
    content.dataset.role = 'friend-group-content';

    members.forEach(f => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ccp-friend-row';
      row.dataset.friendId = f.id;
      row.appendChild(createAvatarNode(f, f.displayName || f.username || '友'));
      const info = document.createElement('div');
      info.className = 'ccp-friend-info';
      const name = document.createElement('div');
      name.className = 'ccp-friend-name';
      name.textContent = f.remark || f.displayName || f.username || '好友';
      const sub = document.createElement('div');
      sub.className = 'ccp-friend-id';
      sub.textContent = 'ID: ' + (f.appNumberId || f.username || '-');
      info.append(name, sub);
      row.appendChild(info);
      const check = document.createElement('div');
      check.className = 'ccp-check';
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
        const bar = $("ccpConfirmBar");
        if (bar) bar.classList.remove('hidden');
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
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '暂无可发送商品，请先发布';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  products.forEach((p) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'picker-product-card';
    const imgUrl = normalizeMediaUrl(p.image || p.imageUrl) || '';
    card.innerHTML = `<img class="picker-product-img" src="${escapeHTML(imgUrl)}" alt="" /><div class="picker-product-info"><div class="picker-product-name">${escapeHTML(p.title || '商品')}</div><div class="picker-product-price">${escapeHTML(formatMoney(p.price))}</div></div>`;
    card.addEventListener('click', async () => {
      await window.sendMessage({ type:'card', card:{ cardType:'闲置商品', title: p.title || '商品', description: p.desc || '', meta:`售价：${formatMoney(p.price)}`, imageUrl: p.image || p.imageUrl || '' } });
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
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = tab === 'bought' ? '暂无从对方购买的订单' : '暂无卖给对方的订单';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  orders.forEach((o) => {
    const isBuyer = o.buyerId === state.currentUser?.id;
    const role = isBuyer ? 'buyer' : 'seller';
    const roleLabel = isBuyer ? '买家' : '卖家';
    const itemsSummary = (o.items||[]).map(i=>`${i.title}(${i.spec||'默认'})x${i.quantity||1}`).join('，') || '订单内容';
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'picker-order-card';
    card.innerHTML = `<div class="picker-order-top"><span class="picker-order-id">#${escapeHTML(String(o.id||'').slice(-6))}</span><span class="picker-order-role ${role}">${roleLabel}</span></div><div class="picker-order-items">${escapeHTML(itemsSummary)}</div><div class="picker-order-bottom"><span class="picker-order-total">${escapeHTML(formatMoney(o.total))}</span><span class="picker-order-status">${escapeHTML(formatOrderStatusLabel(o.status))}</span></div>`;
    card.addEventListener('click', async () => {
      await window.sendMessage({ type:'order_card', order:{ id:o.id, buyerId:o.buyerId, sellerId:o.sellerId, title:`订单 #${String(o.id||'').slice(-6)}`, summary:itemsSummary, total:o.total, status:o.status, imageUrl:(o.items||[]).find(i=>i && i.imageUrl)?.imageUrl || '', pendingPrice:o.pendingPrice||null, pendingPriceRequestedBy:o.pendingPriceRequestedBy||null, priceAdjustmentLocked:!!o.priceAdjustmentLocked, role } });
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
  el.replaceChildren();
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
    img.onerror = function() { this.remove(); wrap.textContent = firstChar(userObj?.displayName || userObj?.username || fallbackName); };
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
  const safeFileName = String(fileName || 'upload.bin')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'upload.bin';
  const res = await api('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': contentType || blob.type || 'application/octet-stream',
      'X-File-Name': safeFileName
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
  if (diffDays === 1) return '昨天';
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
  const ts = msg.createdAt || 0;
  let lo = 0, hi = state.messages.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if ((state.messages[mid].createdAt || 0) <= ts) lo = mid + 1; else hi = mid; }
  state.messages.splice(lo, 0, msg);
  return { action: 'append', index: lo };
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
    avatarWrap.className = 'avatar-click-wrap';
    const avatarNode = createAvatarNode(userObj, finalName);
    avatarWrap.appendChild(avatarNode);
    avatarWrap.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('.avatar')) return;
      e.stopPropagation();
      window.openUserProfile(msg.senderId, finalName);
    });
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
    } else if (msg.type === 'card' && msg.card) {
      const c = msg.card;
      const card = document.createElement('div');
      card.className = 'trade-card';
      const isContactCard = isContactCardPayload(c);
      if (isContactCard) {
        card.classList.add('contact-card-message');
      }
      const safeImage = normalizeMediaUrl(c.imageUrl || '');
      if (isContactCard) {
        const head = document.createElement('div');
        head.className = 'contact-card-message-head';
        if (safeImage) {
          const avatar = document.createElement('img');
          avatar.className = 'contact-card-message-avatar';
          avatar.src = safeImage;
          head.appendChild(avatar);
        } else {
          const avatar = document.createElement('div');
          avatar.className = 'contact-card-message-avatar-fallback';
          avatar.textContent = firstChar(c.title || '友');
          head.appendChild(avatar);
        }
        const headMeta = document.createElement('div');
        const headTitle = document.createElement('div');
        headTitle.className = 'trade-card-title';
        headTitle.textContent = c.title || '好友名片';
        const label = document.createElement('div');
        label.className = 'contact-card-label';
        label.textContent = c.meta || '个人名片';
        headMeta.append(headTitle, label);
        head.appendChild(headMeta);
        card.appendChild(head);
      } else if (safeImage) {
        const img = document.createElement('img');
        img.className = 'trade-card-img';
        img.src = safeImage;
        img.addEventListener('click', (e) => { e.stopPropagation(); window.openImageViewer(safeImage); });
        card.appendChild(img);
      }
      if (!isContactCard) {
        const title = document.createElement('div');
        title.className = 'trade-card-title';
        title.textContent = c.title || '闲置';
        card.appendChild(title);
      }
      const desc = document.createElement('div');
      desc.className = 'trade-card-sub';
      desc.textContent = c.description || '';
      card.appendChild(desc);
      if (!isContactCard) {
        const meta = document.createElement('div');
        meta.className = 'trade-card-price';
        meta.textContent = c.meta || '';
        card.appendChild(meta);
      }
      const contactTargetUserId = isContactCard ? extractContactCardUserId(c) : '';
      if (isContactCard && contactTargetUserId) {
        card.classList.add('clickable-card');
        card.addEventListener('click', (e) => {
          e.stopPropagation();
          window.openUserProfile(contactTargetUserId, c.title || '用户');
        });
      } else if (!isContactCard) {
        card.classList.add('clickable-card');
        card.addEventListener('click', (e) => {
          e.stopPropagation();
          const productItem = { title: c.title || '商品', desc: c.description || '', price: parseMoney(c.meta || '0'), image: c.imageUrl || '', specs: [], sellerId: msg.senderId || '' };
          openProductDetail(productItem, false);
        });
      }
      wrap.appendChild(card);
    } else if (msg.type === 'order_card' && msg.order) {
      wrap.appendChild(buildOrderCardMessage(msg));
    } else if (msg.type === 'broadcast_card' && msg.broadcast) {
      wrap.appendChild(buildBroadcastCardMessage(msg));
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
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return '已完成';
  if (s === 'accepted' || s === 'processing' || s === 'in_progress') return '已接单';
  if (s === 'pending' || s === 'created' || s === 'new') return '未接单';
  return '未接单';
}

function buildOrderCardMessage(msg){
  const order = msg.order || {};
  const wrap = document.createElement('div');
  wrap.className = 'trade-card clickable-card';
  wrap.dataset.orderId = order.id || '';

  const safeOrderImage = normalizeMediaUrl(order.imageUrl || (order.items || []).find((item) => item && item.imageUrl)?.imageUrl || '');
  if (safeOrderImage) {
    const cover = document.createElement('img');
    cover.className = 'trade-card-cover';
    cover.src = safeOrderImage;
    cover.alt = order.title || '订单商品';
    cover.addEventListener('click', (e) => {
      e.stopPropagation();
      window.openImageViewer(safeOrderImage);
    });
    wrap.appendChild(cover);
  }

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

  const openDetail = (e) => {
    if (e) e.stopPropagation();
    openChatOrderDetail(order);
  };
  wrap.addEventListener('click', openDetail);

  const actions = document.createElement('div');
  actions.className = 'trade-card-actions';
  const detailBtn = document.createElement('button');
  detailBtn.type = 'button';
  detailBtn.className = 'secondary-btn';
  detailBtn.textContent = '查看详情';
  detailBtn.addEventListener('click', openDetail);
  actions.appendChild(detailBtn);

  const currentUserId = state.currentUser?.id || '';
  const isParticipant = currentUserId && (currentUserId === order.buyerId || currentUserId === order.sellerId);
  const pendingRequester = order.pendingPriceRequestedBy || '';
  const hasPendingPrice = order.pendingPrice != null && !!pendingRequester;
  const isPriceLocked = !!order.priceAdjustmentLocked;

  const canRequest = isParticipant && order.status !== 'completed' && !hasPendingPrice && !isPriceLocked;
  if(canRequest){
    const reqBtn = document.createElement('button');
    reqBtn.type = 'button';
    reqBtn.className = 'secondary-btn';
    reqBtn.textContent = '申请改价';
    reqBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if(!order.id || reqBtn.disabled) return;
      const raw = prompt('申请改价金额', String(order.total || ''));
      if(raw === null) return;
      reqBtn.disabled = true; reqBtn.textContent = '提交中...';
      try{
        await api(`/api/orders/${order.id}/price-request`, { method:'POST', body: JSON.stringify({ total: parseMoney(raw) }) });
        await Promise.all([reloadActiveConversationMessages(), loadBuyerOrders(), loadSellerOrders()]);
      }catch(err){ showModal(err.message || '申请失败'); } finally { reqBtn.disabled = false; reqBtn.textContent = '申请改价'; }
    });
    actions.appendChild(reqBtn);
  }

  const canConfirm = isParticipant && hasPendingPrice && pendingRequester !== currentUserId && order.status !== 'completed';
  if(canConfirm){
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'primary-btn';
    confirmBtn.textContent = `确认改价 ${formatMoney(order.pendingPrice || order.total || 0)}`;
    confirmBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if(!order.id || confirmBtn.disabled) return;
      confirmBtn.disabled = true; confirmBtn.textContent = '确认中...';
      try{
        await api(`/api/orders/${order.id}/price-confirm`, { method:'POST', body: JSON.stringify({ total: Number(order.pendingPrice || order.total || 0) }) });
        await Promise.all([reloadActiveConversationMessages(), loadBuyerOrders(), loadSellerOrders()]);
      }catch(err){ showModal(err.message || '确认失败'); } finally { confirmBtn.disabled = false; confirmBtn.textContent = `确认改价 ${formatMoney(order.pendingPrice || order.total || 0)}`; }
    });
    actions.appendChild(confirmBtn);
  }else if(isParticipant && hasPendingPrice && pendingRequester === currentUserId){
    const waiting = document.createElement('span');
    waiting.className = 'trade-card-sub';
    waiting.textContent = `改价申请中，等待对方确认：${formatMoney(order.pendingPrice || order.total || 0)}`;
    actions.appendChild(waiting);
  }
  if(isParticipant && isPriceLocked && !hasPendingPrice && order.status !== 'completed'){
    const locked = document.createElement('span');
    locked.className = 'trade-card-sub';
    locked.textContent = '本订单已完成一次改价，如需再次改价请回到购物车重新下单';
    actions.appendChild(locked);
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
    desc: p.desc || '',
    price: p.price,
    image: p.image || '',
    sellerId: p.sellerId || '',
    sellerName: p.sellerName || '',
    sellerAvatarUrl: p.sellerAvatarUrl || p.sellerAvatar || '',
    location: p.location || '',
    distance: p.distance ?? null
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
    lastMessageAt: conv.lastMessageAt || 0,
    isActive: !!(state.activeConversation && state.activeConversation.id === conv.id)
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
  const threshold = 48;
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
    }
  };

  const finish = (x, y) => {
    if (!tracking) return;
    tracking = false;
    const dx = dragDx || (x - startX);
    const dy = y - startY;
    if (Math.abs(dx) < Math.abs(dy)) {
      setTimeout(() => { suppressClick = false; }, 180);
      return;
    }
    if (dx <= -threshold) wrap.classList.add('revealed');
    else if (dx >= threshold) wrap.classList.remove('revealed');
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
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-item';
  if (isPinned) btn.classList.add('is-pinned');
  if (isMuted) btn.classList.add('is-muted');
  if (state.activeConversation && state.activeConversation.id === conv.id) btn.classList.add('is-active');
  btn.dataset.conversationId = conv.id;
  if (conv.syntheticType === 'trade') btn.addEventListener('click', async () => {
    await Promise.all([loadBuyerOrders(), loadSellerOrders()]);
    const pendingSeller = (state.sellerOrders || []).filter(o => o && o.status !== 'completed');
    if (pendingSeller.length) window.openSecondaryPage('sellerOrdersPage', 'home');
    else window.openSecondaryPage('buyerOrdersManagePage', 'home');
  });
  else if (conv.syntheticType === 'system') btn.addEventListener('click', () => { window.openSecondaryPage('systemMessagesPage', 'home'); });
  else btn.addEventListener('click', () => window.openConversation(conv.id));

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'chat-item-avatar';
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

  if (conv.syntheticType === 'trade' || conv.syntheticType === 'system') {
    return btn;
  }

  const wrap = document.createElement('div');
  wrap.className = 'chat-swipe-row';
  wrap.dataset.conversationId = conv.id;
  const content = document.createElement('div');
  content.className = 'chat-swipe-content';
  content.appendChild(btn);
  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'chat-swipe-actions';
  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'chat-swipe-pin-btn';
  pinBtn.textContent = isPinned ? '取消置顶' : '置顶';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'chat-swipe-delete-btn';
  deleteBtn.textContent = '删除';
  actionsWrap.append(pinBtn, deleteBtn);
  wrap.append(content, actionsWrap);

  attachConversationSwipeDelete(wrap, async () => {
    try {
      await api(`/api/conversations/${conv.id}/clear`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
      const now = Date.now();
      const target = state.conversations.find((item) => item.id === conv.id);
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
        const target = state.conversations.find((item) => item.id === conv.id);
        const nextPinned = Boolean(res?.pinned);
        if (target) target.pinned = nextPinned;
        if (state.activeConversation?.id === conv.id) state.activeConversation.pinned = nextPinned;
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
    desc: product.desc || '',
    price: product.price,
    stock: product.stock,
    image: product.image || '',
    sellerId: product.sellerId || '',
    sellerName: product.sellerName || '',
    sellerAvatarUrl: product.sellerAvatarUrl || product.sellerAvatar || '',
    location: product.location || '',
    distance: product.distance ?? null
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
  const stock = document.createElement('div');
  stock.className = 'preview';
  stock.textContent = `库存 ${Math.max(0, Math.floor(Number(product.stock || 0)))}`;
  const seller = document.createElement('div');
  seller.className = 'product-seller';
  seller.appendChild(createAvatarNode({avatarUrl: product.sellerAvatarUrl || product.sellerAvatar, displayName: product.sellerName}, product.sellerName));
  const sellerName = document.createElement('span');
  sellerName.textContent = product.sellerName || '';
  seller.appendChild(sellerName);
  info.appendChild(title);
  if (product.desc) {
    const desc = document.createElement('div');
    desc.className = 'product-desc';
    desc.textContent = product.desc;
    info.appendChild(desc);
  }
  info.appendChild(price);
  info.appendChild(seller);
  if (product.location || product.distance != null) {
    const loc = document.createElement('div');
    loc.className = 'product-location';
    const distText = product.distance != null ? (product.distance < 1 ? `${Math.round(product.distance * 1000)}m` : `${product.distance.toFixed(1)}km`) : '';
    loc.textContent = (product.location || '附近') + (distText ? ` · ${distText}` : '');
    info.appendChild(loc);
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
  'systemMessagesPage','termsPage','privacyPolicyPage','aboutPage'
];

window.openSecondaryPage = (page, backTo = 'home') => {
  state.secondaryPage = page; state.secondaryReturn = backTo;
  ["chatListView","friendListView","mallView","profileView","chatView","composerPanel","homeTabbar", ...SECONDARY_PAGE_IDS].forEach(id => { if($(id)) $(id).classList.add('hidden'); });
  if($(page)) $(page).classList.remove('hidden');
  if($("backBtn")) $("backBtn").classList.remove('hidden');
  if($("homeMoreBtn")) $("homeMoreBtn").classList.add("hidden");
  if($("chatSettingsBtn")) $("chatSettingsBtn").classList.add("hidden");
  if($("sidebarToggleBtn")) $("sidebarToggleBtn").classList.add("hidden");
  if($("sidebarPanel")) $("sidebarPanel").classList.add("sidebar-tab-hidden");

  if (page === 'friendRequestsView') {
    if($("chatTitle")) $("chatTitle").textContent = '新的朋友';
    refreshFriendRequestState({ forceList: true });
  }
  else if (page === 'profileDetailPage') { if($("chatTitle")) $("chatTitle").textContent = '详细资料'; if($("chatSettingsBtn")) $("chatSettingsBtn").classList.remove('hidden'); }
  else if (page === 'messageSettingsPage') { if($("chatTitle")) $("chatTitle").textContent = '聊天信息'; if($("pinConversationBtn")) $("pinConversationBtn").textContent = (state.activeConversation && state.activeConversation.pinned) ? '取消置顶' : '置顶聊天'; if($("muteSettingBtn")) $("muteSettingBtn").textContent = (state.activeConversation && state.activeConversation.muted) ? '取消免打扰' : '消息免打扰'; }
  else if (page === 'addFriendPage') { if($("chatTitle")) $("chatTitle").textContent = '添加朋友'; }
  else if (page === 'scanPage') {
    if($("chatTitle")) $("chatTitle").textContent = '扫一扫';
    if($("scanManualPanel")) $("scanManualPanel").classList.add('hidden');
    if($("scanIdInput")) $("scanIdInput").value = '';
    if($("scanHintText")) $("scanHintText").textContent = '将二维码放入框内，即可自动扫描';
    setTimeout(() => { startScanCamera(); }, 0);
  }
  else if (page === 'privacyPage') { if($("chatTitle")) $("chatTitle").textContent = '黑名单管理'; }
  else if (page === 'qrCodePage') { if($("chatTitle")) $("chatTitle").textContent = '二维码名片'; }
  else if (page === 'editProfilePage') { if($("chatTitle")) $("chatTitle").textContent = '个人信息'; }
  else if (page === 'forgotPasswordPage') { if($("chatTitle")) $("chatTitle").textContent = '找回密码'; }
  else if (page === 'changePasswordPage') { if($("chatTitle")) $("chatTitle").textContent = '修改密码'; }
  else if (page === 'changePhonePage') { if($("chatTitle")) $("chatTitle").textContent = '修改手机号'; }
  else if (page === 'publishProductPage') { if($("chatTitle")) $("chatTitle").textContent = '发布闲置'; }
  else if (page === 'myProductsPage') { if($("chatTitle")) $("chatTitle").textContent = '我的闲置'; }
  else if (page === 'settingsPage') { if($("chatTitle")) $("chatTitle").textContent = '设置'; }
  else if (page === 'groupManagePage') { if($("chatTitle")) $("chatTitle").textContent = '分组管理'; renderGroupManageList(); }
  else if (page === 'buyerOrdersManagePage') { if($("chatTitle")) $("chatTitle").textContent = '我购买的订单'; }
  else if (page === 'sellerCenterPage') { if($("chatTitle")) $("chatTitle").textContent = '卖家中心'; }
  else if (page === 'sellerPaymentPage') { if($("chatTitle")) $("chatTitle").textContent = '收款码管理'; }
  else if (page === 'sellerOrdersPage') { if($("chatTitle")) $("chatTitle").textContent = '订单管理'; }
  else if (page === 'sellerProductsPage') { if($("chatTitle")) $("chatTitle").textContent = '商品管理'; }
  else if (page === 'productDetailPage') { if($("chatTitle")) $("chatTitle").textContent = '商品详情'; }
  else if (page === 'orderDetailPage') { if($("chatTitle")) $("chatTitle").textContent = '订单详情'; }
  else if (page === 'contactCardPickerPage') { if($("chatTitle")) $("chatTitle").textContent = '发送名片'; }
  else if (page === 'productCardPickerPage') { if($("chatTitle")) $("chatTitle").textContent = '我的商品'; }
  else if (page === 'orderCardPickerPage') { if($("chatTitle")) $("chatTitle").textContent = '相关订单'; state.orderPickerTab = 'bought'; }
  else if (page === 'broadcastManagePage') { if($("chatTitle")) $("chatTitle").textContent = '广播管理'; renderBroadcastDrafts(); }
  else if (page === 'broadcastEditorPage') { if($("chatTitle")) $("chatTitle").textContent = '广播编辑'; }
  else if (page === 'cartHubPage') { if($("chatTitle")) $("chatTitle").textContent = '购物车'; renderCartHubPage(); }
  else if (page === 'profileCartPage') { if($("chatTitle")) $("chatTitle").textContent = '结算'; renderProfileCartPage(); }
  else if (page === 'profileOrdersPage') { if($("chatTitle")) $("chatTitle").textContent = '我的订单'; renderProfileOrders(); }
  else if (page === 'chatOrderDetailPage') { if($("chatTitle")) $("chatTitle").textContent = '订单详情'; }
  else if (page === 'systemMessagesPage') { if($("chatTitle")) $("chatTitle").textContent = '系统消息'; renderSystemMessagesList(); }

};

window.removeFromBlacklist = async (targetId) => { try { await api('/api/blacklist', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, targetId, action: 'remove' }) }); $("privacySettingsBtn").click(); } catch(e){ showModal(e.message || '操作失败'); } }
window.toggleQQGroup = (el) => { el.classList.toggle('expanded'); const content = el.nextElementSibling; if(content) content.classList.toggle('expanded'); };
window.openImageViewer = (url) => { const safe = normalizeMediaUrl(url); if(!safe) return showModal('无效图片地址'); if($("viewerImage")) $("viewerImage").src = safe; if($("imageViewer")) $("imageViewer").classList.remove('hidden'); };
window.closeImageViewer = () => { if($("imageViewer")) $("imageViewer").classList.add('hidden'); if($("viewerImage")) $("viewerImage").removeAttribute('src'); };

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

window.copyText = (enc) => { navigator.clipboard ? navigator.clipboard.writeText(decodeURIComponent(enc)) : showModal('已复制'); };
window.deleteLocalMsg = async (id) => {
  if (!state.activeConversation?.id) return;
  const conversationId = state.activeConversation.id;
  const prevMessages = [...state.messages];
  state.messages = state.messages.filter(m => m.id !== id);
  if (!removeMessageFromView(id)) renderMessages();
  applyLastOutgoingReadState();
  try {
    await api(`/api/conversations/${conversationId}/messages/${id}/delete`, { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id }) });
    syncActiveConversationListMeta();
    renderConversationListFromState();
    loadConversations();
  } catch(e) {
    state.messages = prevMessages;
    renderMessages();
  applyLastOutgoingReadState();
    showModal(e.message || '删除失败');
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
  try { await api(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ senderId: state.currentUser.id, type: msgToForward.type, text: msgToForward.text, imageUrl: msgToForward.imageUrl, audioUrl: msgToForward.audioUrl, card: msgToForward.card }) }); showModal('已转发'); } catch(e) { showModal('转发失败: ' + e.message); }
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
  if (state._ctxMenuClose) { document.removeEventListener('click', state._ctxMenuClose, true); document.removeEventListener('touchstart', state._ctxMenuClose, true); }
  const closeMenu = (e) => { if(e && e.target.closest('#contextMenu')) return; menu.classList.add('hidden'); menu.replaceChildren(); document.removeEventListener('click', closeMenu, true); document.removeEventListener('touchstart', closeMenu, true); state._ctxMenuClose = null; };
  state._ctxMenuClose = closeMenu;
  setTimeout(() => { document.addEventListener('click', closeMenu, true); document.addEventListener('touchstart', closeMenu, true); }, 0);
};

window.openProductChat = async (sellerId, title, price, image) => {
  if(sellerId === state.currentUser.id) return showModal("这是你自己发布的商品哦！");
  try {
    const data = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ creatorId: state.currentUser.id, memberIds: [sellerId] }) });
    await window.openConversation(data.conversation.id);
    $("messageInput").value = `你好，我想买你的【${title}】`; $("messageInput").dispatchEvent(new Event("input"));
    window.sendMessage({ type: 'card', card: { cardType: '闲置商品', title, description: `售价：¥${price}`, meta: '来自ChatTrade商城', imageUrl: image } }).catch(() => {});
  } catch(e) { showModal("发起交易沟通失败"); }
};

window.acceptRequest = async (requestId) => {
  const btn = $("profileAcceptRequestBtn");
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = '处理中...'; }
  try { await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, requestId }) }); showModal('已添加对方为好友！'); await Promise.all([loadFriends(), loadFriendRequests(), loadConversations()]); updateProfileDetailActions(); if($("backBtn")) $("backBtn").click(); } catch(e) { showModal(e.message || '操作失败'); } finally { if (btn) { btn.disabled = false; btn.textContent = '接受'; } }
};

window.rejectRequest = async (requestId) => {
  if (!confirm('确定拒绝该好友请求吗？')) return;
  const btn = $("profileRejectRequestBtn");
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = '处理中...'; }
  try {
    await api('/api/friends/reject', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, requestId }) });
    await loadFriendRequests();
    updateProfileDetailActions();
  } catch (e) {
    showModal(e.message || '操作失败');
  } finally { if (btn) { btn.disabled = false; btn.textContent = '拒绝'; } }
};

window.deleteMyProduct = async (productId) => {
  if(!confirm("确定要下架并删除该商品吗？")) return;
  showLoading('删除中...');
  try {
    await api('/api/products/delete', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, productId }) });
    await refreshProductViews();
  } catch(e) { showModal("删除失败：" + e.message); } finally { hideLoading(); }
};

window.updateSellerProductStock = async (productId, currentStock = 0) => {
  const raw = prompt('请输入新的库存数量', String(Math.max(0, Math.floor(Number(currentStock || 0)))));
  if (raw === null) return;
  const stock = Math.max(0, Math.floor(Number(raw)));
  if (!Number.isFinite(stock)) return showModal('请输入有效库存');
  try {
    await api('/api/products/update', { method:'POST', body: JSON.stringify({ userId: state.currentUser.id, productId, stock }) });
    await refreshProductViews();
    showToast('库存已更新');
  } catch (e) {
    showModal(e.message || '库存更新失败');
  }
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

window.deleteGroup = async (groupName) => {
  if(groupName === '我的好友') return showModal('“我的好友”是全部好友列表，不能删除。');
  if(!confirm(`确定删除分组 [${groupName}] 吗？
该分组下的好友将被移入“我的好友”。`)) return;
  try {
    const data = await api('/api/groups/delete', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, groupName }) });
    syncSessionGroups(data.groups || getCustomGroups().filter(g => g !== groupName));
    await loadFriends();
    renderGroupManageList();
    showModal('分组已删除');
  } catch(e) { showModal(e.message || '删除失败'); }
};

window.renameGroup = async (groupName) => {
  if (groupName === '我的好友') return showModal('“我的好友”是全部好友列表，不能重命名。');
  const nextNameRaw = prompt('请输入新的分组名称：', groupName);
  if (nextNameRaw === null) return;
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
};

window.moveGroupOrder = async (groupName, offset) => {
  if (groupName === '我的好友') return;
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
        showModal("已成功移至分组：" + groupName);
        loadFriends();
        if($("backBtn") && !$("profileDetailPage").classList.contains("hidden")) $("backBtn").click();
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
        $('scanManualPanel')?.classList.remove('hidden');
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
      await new Promise(r => setTimeout(r, 1500));
      if (!window.NativeBridge.hasCameraPermission()) {
        if ($('scanHintText')) $('scanHintText').textContent = '需要相机权限才能扫码，请在设置中开启';
        $('scanFallbackBox')?.classList.remove('hidden');
        return;
      }
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no_camera_api');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    state.scanStream = stream;
    video.srcObject = stream;
    video.classList.remove('hidden');
    $('scanFallbackBox')?.classList.add('hidden');
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
              $('scanManualPanel')?.classList.remove('hidden');
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
  $('scanFallbackBox')?.classList.remove('hidden');
}

window.openConversation = async (id, options = {}) => {
  const { skipFetch = false } = options;
  const conv = state.conversations.find(c => c.id === id);
  state.activeConversation = { id, type: 'direct', members: conv?.members || [], title: conv?.title || '', peerAvatarUrl: conv?.peerAvatarUrl || '', peerIsFriend: conv?.peerIsFriend === true, muted: conv?.muted || false, pinned: conv?.pinned || false, clearedAt: conv?.clearedAt || 0, peerLastReadAt: Number(conv?.peerLastReadAt || 0) }; 
  state.peerLastReadAt = state.activeConversation.peerLastReadAt; 
  if (conv) {
    conv.unread = 0;
    renderConversationListFromState();
  }
  ["profileDetailPage","messageSettingsPage","friendRequestsView","addFriendPage","scanPage","privacyPage","qrCodePage","editProfilePage","publishProductPage","myProductsPage","settingsPage","groupManagePage","profileCartPage","profileOrdersPage","cartHubPage","contactCardPickerPage","productCardPickerPage","orderCardPickerPage","productEditorPage","broadcastDetailPage","forgotPasswordPage","changePasswordPage","changePhonePage"].forEach(pid => { if($(pid)) $(pid).classList.add('hidden'); });
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
  // show sidebar in chat conversation view
  if($("sidebarToggleBtn")) $("sidebarToggleBtn").classList.remove("hidden");
  if($("sidebarPanel")) $("sidebarPanel").classList.remove("sidebar-tab-hidden");
  applySidebarMode();
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
  } catch(e) { showModal("发起沟通失败"); }
};

window.openUserProfile = async (userId, fallbackName) => {
  if (!userId || userId === 'null') return;
  try {
    const data = await api(`/api/users/${userId}/profile?viewerId=${encodeURIComponent(state.currentUser.id)}`);
    if (data.profile) {
      state.currentProfileUser = data.profile;
      state.currentCartSellerId = data.profile.id || '';
      setAvatarContainer($("profileAvatar"), data.profile, fallbackName);
      
      const finalName = data.profile.remarkName || data.profile.nickname || fallbackName || '未知用户';
      const nickname = data.profile.nickname || finalName;
      data.profile.isFriend = !!data.profile.isFriend;
      state.currentProfileUser = data.profile;
      if($("profileRemarkName")) $("profileRemarkName").textContent = nickname;
      if($("profileNickName")) $("profileNickName").textContent = data.profile.nickname || '-'; 
      if($("profileAppId")) $("profileAppId").textContent = `ID：${data.profile.appNumberId}`;
      if($("profileSignature")) $("profileSignature").textContent = data.profile.signature || '这个人很神秘，还没有填写签名';
      updateProfileDetailActions();
      await loadProfileStore(data.profile.id);
      window.openSecondaryPage('profileDetailPage', state.activeConversation ? 'chat' : 'home');
    }
  } catch (e) {
    console.warn('openUserProfile failed', e);
    showModal('打开个人主页失败，请稍后重试');
  }
};

window.insertEmoji = (emoji) => { const input = $("messageInput"); if(!input) return; input.value += emoji; input.dispatchEvent(new Event("input")); input.focus(); };

window.sendMessage = async (payload) => {
  if (!state.activeConversation) return;
  const clientMessageId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tempMsg = { id: 'temp_'+Date.now(), senderId: state.currentUser.id, createdAt: Date.now(), clientMessageId, ...payload };
  state.messages.push(tempMsg);
  appendMessageToView(tempMsg);
  const cv = $("chatView"); if (cv) setTimeout(() => { cv.scrollTop = cv.scrollHeight; }, 10);
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
    }
    loadConversations();
    loadSystemMessages();
  } catch (err) {
    state.messages = state.messages.filter(m => m.id !== tempMsg.id);
    if (!removeMessageFromView(tempMsg.id)) renderMessages();
  applyLastOutgoingReadState();
    syncActiveConversationListMeta();
    renderConversationListFromState();
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
    if($("toggleActionsBtn")) $("toggleActionsBtn").classList.remove("hidden"); if($("sendMsgBtn")) $("sendMsgBtn").classList.add("hidden");
    if($("emojiPanel")) $("emojiPanel").classList.add("hidden"); if($("actionPanel")) $("actionPanel").classList.add("hidden");
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

  // ---- Login: Phone input → Next ----
  bindPhoneValidation('loginPhone', 'loginPhoneNextBtn', 'loginAgreeCheck');
  on("loginPhoneNextBtn", "click", async () => {
    const phone = normalizePhoneInput($("loginPhone")?.value.trim());
    if (!phone) return;
    window._authState.loginPhone = phone;
    const btn = $("loginPhoneNextBtn");
    btn.disabled = true;
    btn.textContent = '发送中...';
    try {
      await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone, scene: 'login' }) });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '下一步';
      showModal(e.message || '发送验证码失败，请稍后再试');
      return;
    }
    btn.disabled = false;
    btn.textContent = '下一步';
    if ($("loginCodePhoneDisplay")) $("loginCodePhoneDisplay").textContent = phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    clearCodeBoxes('loginCodeBoxes');
    authGotoStep('authLoginCode');
    startResendCountdown('resendLoginCodeBtn', 60, async () => {
      try { await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone, scene: 'login' }) }); } catch (_) {}
      startResendCountdown('resendLoginCodeBtn', 60, () => {});
    });
  });
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
  on("loginPwdPhone", "keydown", (e) => { if (e.key === 'Enter') $("loginPassword")?.focus(); });
  on("loginPassword", "keydown", (e) => { if (e.key === 'Enter') $("doLoginBtn").click(); });

  // ---- Register: Phone → Next ----
  bindPhoneValidation('registerPhone', 'regPhoneNextBtn', 'regAgreeCheck');
  on("regPhoneNextBtn", "click", async () => {
    const phone = normalizePhoneInput($("registerPhone")?.value.trim());
    if (!phone) return;
    window._authState.regPhone = phone;
    const btn = $("regPhoneNextBtn");
    btn.disabled = true;
    btn.textContent = '发送中...';
    try {
      await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone, scene: 'register' }) });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '下一步';
      showModal(e.message || '发送验证码失败，请稍后再试');
      return;
    }
    btn.disabled = false;
    btn.textContent = '下一步';
    if ($("regCodePhoneDisplay")) $("regCodePhoneDisplay").textContent = phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    clearCodeBoxes('regCodeBoxes');
    authGotoStep('authRegCode');
    startResendCountdown('resendRegCodeBtn', 60, async () => {
      try { await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone, scene: 'register' }) }); } catch (_) {}
      startResendCountdown('resendRegCodeBtn', 60, () => {});
    });
  });
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
  on("registerDisplayName", "keydown", (e) => { if (e.key === 'Enter') $("registerPassword")?.focus(); });
  on("registerPassword", "keydown", (e) => { if (e.key === 'Enter') $("doRegisterBtn").click(); });

  // ---- Forgot password ----
  on("forgotPasswordBtn", "click", () => authGotoStep('authForgotPwd'));
  on("forgotPasswordBtn2", "click", () => authGotoStep('authForgotPwd'));
  on("authForgotSendBtn", "click", async () => {
    const phone = normalizePhoneInput($("authForgotPhone")?.value.trim());
    if (!phone) return showModal('请输入11位手机号');
    const sendBtn = $("authForgotSendBtn");
    sendBtn.disabled = true;
    sendBtn.textContent = '发送中...';
    try {
      await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone, scene: 'reset' }) });
      showModal('验证码已发送（测试环境请输入 1234）');
    } catch (e) {
      const waitSec = Number(e?.data?.retryAfterSec || 0);
      if (waitSec > 0) showModal(`操作频繁，请${waitSec}秒后重试`);
      else showModal(e.message || '发送验证码失败');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = '获取验证码';
    }
  });
  on("authForgotSubmitBtn", "click", async () => {
    const phone = normalizePhoneInput($("authForgotPhone")?.value.trim());
    const code = $("authForgotCode")?.value.trim();
    const newPassword = $("authForgotNewPwd")?.value || '';
    if (!phone || !code || !newPassword) return showModal('请填写完整信息');
    if (!/^\d{4}$/.test(code)) return showModal('请输入4位验证码');
    if (newPassword.length < 8) return showModal('新密码至少8位');
    const submitBtn = $("authForgotSubmitBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';
    try {
      await api('/api/password/forgot', { method: 'POST', body: JSON.stringify({ phone, code, newPassword }) });
      showModal('密码重置成功，请重新登录');
      authGotoStep('authLoginPassword');
    } catch (e) {
      showModal(e.message || '重置密码失败');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '重置密码';
    }
  });

  // ---- Settings: forgot password page (in appScreen for logged-in users) ----
  on("sendForgotCodeBtn", "click", async () => {
    const phone = normalizePhoneInput($("forgotPhoneInput")?.value.trim());
    if (!phone) return showModal('请输入11位手机号');
    const sendBtn = $("sendForgotCodeBtn");
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
  });
  on("submitForgotPasswordBtn", "click", async () => {
    const phone = normalizePhoneInput($("forgotPhoneInput")?.value.trim());
    const code = $("forgotCodeInput")?.value.trim();
    const newPassword = $("forgotNewPasswordInput")?.value || '';
    if (!phone || !code || !newPassword) return showModal('请填写完整信息');
    if (!/^\d{4}$/.test(code)) return showModal('请输入4位验证码');
    if (newPassword.length < 8) return showModal('新密码至少8位');
    const submitBtn = $("submitForgotPasswordBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';
    try {
      await api('/api/password/forgot', { method: 'POST', body: JSON.stringify({ phone, code, newPassword }) });
      showModal('密码重置成功，请重新登录');
      localStorage.removeItem(SESSION_KEY); location.reload();
    } catch (e) { showModal(e.message || '重置密码失败');
    } finally { submitBtn.disabled = false; submitBtn.textContent = '重置密码'; }
  });
  on("changePasswordBtn", "click", () => window.openSecondaryPage('changePasswordPage', 'settingsPage'));
  on("changePhoneBtn", "click", () => window.openSecondaryPage('changePhonePage', 'settingsPage'));
  on("openTermsPageBtn", "click", () => window.openSecondaryPage('termsPage', 'settingsPage'));
  on("openPrivacyPageBtn", "click", () => window.openSecondaryPage('privacyPolicyPage', 'settingsPage'));
  on("openAboutPageBtn", "click", () => window.openSecondaryPage('aboutPage', 'settingsPage'));
  on("aboutTermsBtn", "click", () => window.openSecondaryPage('termsPage', 'aboutPage'));
  on("aboutPrivacyBtn", "click", () => window.openSecondaryPage('privacyPolicyPage', 'aboutPage'));
  on("sendChangePhoneCodeBtn", "click", async () => {
    const phone = normalizePhoneInput($("changePhoneInput")?.value.trim());
    if(!phone) return showModal('请输入11位手机号');
    const btn = $("sendChangePhoneCodeBtn");
    if (btn) { btn.disabled = true; btn.textContent = '发送中...'; }
    try {
      const res = await api('/api/auth/send-code', { method:'POST', body: JSON.stringify({ phone, scene:'reset' }) });
      showModal(res.mockCode ? `验证码（测试）: ${res.mockCode}` : '验证码已发送');
    } catch (e) {
      showModal(e.message || '发送失败');
    } finally { if (btn) { btn.disabled = false; btn.textContent = '获取验证码'; } }
  });
  on("submitChangePhoneBtn", "click", async () => {
    const phone = normalizePhoneInput($("changePhoneInput")?.value.trim());
    const code = $("changePhoneCodeInput")?.value.trim();
    if(!phone || !code) return showModal('请填写手机号和验证码');
    const btn = $("submitChangePhoneBtn");
    if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }
    try {
      const data = await api('/api/users/change-phone', { method:'POST', body: JSON.stringify({ phone, code }) });
      state.currentUser = data.user || state.currentUser;
      writeSession(state.currentUser);
      if($("editPhoneDisplay")) $("editPhoneDisplay").textContent = state.currentUser.phone || '未绑定';
      showModal('手机号修改成功');
      if($("backBtn")) $("backBtn").click();
    } catch (e) {
      showModal(e.message || '修改失败');
    } finally { if (btn) { btn.disabled = false; btn.textContent = '确认修改'; } }
  });
  on("submitChangePasswordBtn", "click", async () => {
    const oldPassword = $("oldPasswordInput")?.value || '';
    const newPassword = $("newPasswordInput")?.value || '';
    if(!oldPassword.trim() || !newPassword.trim()) return showModal('请填写旧密码和新密码');
    if(oldPassword === newPassword) return showModal('新密码不能与旧密码相同');
    if((newPassword || '').length < 8) return showModal('新密码至少8位');
    const submitBtn = $("submitChangePasswordBtn");
    submitBtn.disabled = true;
    const prevText = submitBtn.textContent;
    submitBtn.textContent = '提交中...';
    try {
      await api('/api/password/change', { method:'POST', body: JSON.stringify({ oldPassword, newPassword }) });
      showModal('密码修改成功，请重新登录');
      localStorage.removeItem(SESSION_KEY);
      location.reload();
    } catch (e) {
      showModal(e.message || '修改密码失败');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prevText || '保存新密码';
    }
  });

  on("forgotPhoneInput", "keydown", (e) => { if(e.key === 'Enter') $("sendForgotCodeBtn").click(); });
  on("forgotCodeInput", "keydown", (e) => { if(e.key === 'Enter') $("submitForgotPasswordBtn").click(); });
  on("forgotNewPasswordInput", "keydown", (e) => { if(e.key === 'Enter') $("submitForgotPasswordBtn").click(); });
  on("oldPasswordInput", "keydown", (e) => { if(e.key === 'Enter') $("submitChangePasswordBtn").click(); });
  on("newPasswordInput", "keydown", (e) => { if(e.key === 'Enter') $("submitChangePasswordBtn").click(); });

  on("messageInput", "focus", () => { setTimeout(() => { window.scrollTo(0, document.body.scrollHeight); if ($("chatView")) $("chatView").scrollTop = $("chatView").scrollHeight; }, 300); });

  // Load older messages when scrolling near top (throttled)
  if ($("chatView")) {
    let _scrollThrottled = false;
    $("chatView").addEventListener("scroll", () => {
      if (_scrollThrottled) return;
      _scrollThrottled = true;
      setTimeout(() => { _scrollThrottled = false; }, 200);
      const cv = $("chatView");
      if (!cv || cv.scrollTop > 80 || !state.hasMoreMessages || state.isLoadingMessages) return;
      fetchMessages(state.oldestMessageTime);
    }, { passive: true });
  }
  on("closeGroupSelectSheetBtn", "click", () => { if($("groupSelectSheet")) $("groupSelectSheet").classList.add("hidden"); });
  on("mallSearchInput", "input", loadMall);
  // ---- Tag input (still used for adding new items inline) ----
  function initTagInput(wrapperId, inputId, onAdd) {
    const wrap = $(wrapperId); const input = $(inputId);
    if (!wrap || !input) return { getTags: () => [], setTags: () => {} };
    let tags = [];
    function render() {
      wrap.querySelectorAll('.tag-item').forEach(el => el.remove());
      tags.forEach((tag, i) => {
        const span = document.createElement('span');
        span.className = 'tag-item';
        span.textContent = tag;
        const btn = document.createElement('button');
        btn.className = 'tag-item-remove';
        btn.type = 'button';
        btn.textContent = '\u00d7';
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
      catWrap.innerHTML = '';
      const selectedCats = categoryTags.getTags();
      _categoryPresets.forEach(cat => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'preset-chip' + (selectedCats.includes(cat) ? ' selected' : '');
        chip.textContent = cat;
        chip.addEventListener('click', () => {
          if (selectedCats.includes(cat)) categoryTags.removeTag(cat);
          else categoryTags.addTag(cat);
          renderPresetChips();
        });
        catWrap.appendChild(chip);
      });
    }
    if (specWrap) {
      specWrap.innerHTML = '';
      const selectedSpecs = specsTags.getTags();
      _specPresets.forEach(spec => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'preset-chip' + (selectedSpecs.includes(spec) ? ' selected' : '');
        chip.textContent = spec;
        chip.addEventListener('click', () => {
          if (selectedSpecs.includes(spec)) specsTags.removeTag(spec);
          else specsTags.addTag(spec);
          renderPresetChips();
        });
        specWrap.appendChild(chip);
      });
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
    $('presetManagePanel')?.classList.remove('hidden');
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
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
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
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
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
    list.innerHTML = '';
    if (items.length === 0) {
      list.innerHTML = '<div style="text-align:center;color:#999;padding:20px;font-size:14px;">暂无项目，请在下方添加</div>';
      return;
    }
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'preset-manage-item';
      row.setAttribute('data-idx', i);
      row.innerHTML = `<span class="preset-drag-handle">☰</span><span class="preset-manage-item-text"></span><button type="button" class="preset-manage-item-edit">编辑</button><button type="button" class="preset-manage-item-del">删除</button>`;
      row.querySelector('.preset-manage-item-text').textContent = item;
      // Drag handle events
      const handle = row.querySelector('.preset-drag-handle');
      handle.addEventListener('mousedown', (e) => { e.preventDefault(); _startDrag(e, i, row); });
      handle.addEventListener('touchstart', (e) => { _startDrag(e, i, row); }, { passive: false });
      row.querySelector('.preset-manage-item-edit').addEventListener('click', () => {
        const textEl = row.querySelector('.preset-manage-item-text');
        const inp = document.createElement('input');
        inp.className = 'preset-manage-input';
        inp.value = item;
        inp.style.cssText = 'flex:1;height:30px;';
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
      row.querySelector('.preset-manage-item-del').addEventListener('click', () => {
        const arr = _presetManageType === 'category' ? _categoryPresets : _specPresets;
        arr.splice(i, 1);
        saveProductPresets();
        renderPresetManageList();
        renderPresetChips();
      });
      list.appendChild(row);
    });
  }

  // Global drag event listeners
  document.addEventListener('mousemove', _moveDrag);
  document.addEventListener('mouseup', _endDrag);
  document.addEventListener('touchmove', _moveDrag, { passive: false });
  document.addEventListener('touchend', _endDrag);

  on('manageCategoryBtn', 'click', () => openPresetManagePanel('category'));
  on('manageSpecBtn', 'click', () => openPresetManagePanel('spec'));
  on('presetManageCloseBtn', 'click', () => $('presetManagePanel')?.classList.add('hidden'));
  if ($('presetManagePanel')) {
    $('presetManagePanel').querySelector('.preset-manage-mask')?.addEventListener('click', () => $('presetManagePanel').classList.add('hidden'));
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
    categoryTags.setTags(presetProduct?.category ? presetProduct.category.split(/[\/,、]/).map(s => s.trim()).filter(Boolean) : []);
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
    $("mallTabs").querySelectorAll('.mall-tab').forEach(t => t.classList.remove('active'));
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
            await api('/api/products/update', { method: 'POST', body: JSON.stringify({ ...payload, productId: state.publishEditingProductId }) });
            setPublishProductHint('商品已更新，展示页已同步', 'success');
            showModal("商品已更新！");
          } else {
            await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
            setPublishProductHint('发布成功，商品已展示在个人主页', 'success');
            showModal("发布成功！");
          }
          await refreshProductViews();
          state.publishEditingProductId = '';
          if (state.secondaryReturn === 'sellerProductsPage') {
            window.openSecondaryPage('sellerProductsPage', 'sellerCenterPage');
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
      if($("editAppIdDisplay")) $("editAppIdDisplay").textContent = state.currentUser.appNumberId || '-';
      if($("editPhoneDisplay")) $("editPhoneDisplay").textContent = state.currentUser.phone || '未绑定';
      state.tempAvatarUrl = state.currentUser.avatarUrl || null;
      if (state.tempAvatarUrl) setImagePreview($("editAvatarPreview"), state.tempAvatarUrl, firstChar(state.currentUser?.displayName));
      else $("editAvatarPreview").textContent = firstChar(state.currentUser.displayName);
  });

  on("saveProfileBtn", "click", async () => {
      const name = $("editNameInput").value.trim(); const sign = $("editSignatureInput").value.trim();
      if(!name) return showModal("名字不能为空");
      const btn = $("saveProfileBtn");
      if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
      try {
          const data = await api('/api/users/update', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, displayName: name, signature: sign, avatarUrl: state.tempAvatarUrl }) });
          state.currentUser = data.user || state.currentUser; writeSession(state.currentUser); showModal("资料修改成功！");
          if($("profileDisplayName")) $("profileDisplayName").textContent = state.currentUser.displayName;
          if($("myProfileAvatar")) {
              if(state.currentUser.avatarUrl) setImagePreview($("myProfileAvatar"), state.currentUser.avatarUrl, firstChar(state.currentUser.displayName));
              else $("myProfileAvatar").textContent = firstChar(state.currentUser.displayName);
          }
          if($("backBtn")) $("backBtn").click();
      } catch(e) { showModal("保存失败: " + e.message); } finally { if (btn) { btn.disabled = false; btn.textContent = '保存'; } }
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
      const currentSecondary = state.secondaryPage;
      state.secondaryPage = null; state.secondaryReturn = null; 
      SECONDARY_PAGE_IDS.forEach(id => { if($(id)) $(id).classList.add('hidden'); });
      if (backTo && SECONDARY_PAGE_IDS.includes(backTo) && backTo !== currentSecondary) {
          window.openSecondaryPage(backTo, 'profile');
          return;
      }
      if (backTo === 'chat' && state.activeConversation) {
          if($("backBtn")) $("backBtn").classList.remove('hidden');
          if($("chatView")) $("chatView").classList.remove('hidden');
          if($("composerPanel")) $("composerPanel").classList.remove('hidden');
          if($("chatTitle")) $("chatTitle").textContent = state.conversations.find((c) => c.id === state.activeConversation.id)?.title || '会话';
          if($("chatSettingsBtn")) $("chatSettingsBtn").classList.remove("hidden");
          // restore sidebar when returning to conversation
          if($("sidebarToggleBtn")) $("sidebarToggleBtn").classList.remove("hidden");
          if($("sidebarPanel")) $("sidebarPanel").classList.remove("sidebar-tab-hidden");
          return;
      }
      state.activeConversation = null;
      state.chatListSignature = '';
      renderConversationListFromState();
      if($("chatView")) $("chatView").classList.add("hidden"); if($("composerPanel")) $("composerPanel").classList.add("hidden");
      if($("homeTabbar")) $("homeTabbar").classList.remove("hidden"); if($("backBtn")) $("backBtn").classList.add("hidden"); if($("chatSettingsBtn")) $("chatSettingsBtn").classList.add("hidden");
      const activeTab = document.querySelector('.tab-item.active');
      if(activeTab) {
          if(activeTab.id === 'messagesTab') setMainTab('messages'); else if(activeTab.id === 'friendsTab') setMainTab('friends'); else if(activeTab.id === 'mallTab') setMainTab('mall'); else if(activeTab.id === 'profileTab') setMainTab('profile');
      } else { setMainTab('messages'); }
  });

  on("logoutBtn", "click", async () => { if(confirm("确定要退出登录吗？")) { nativeOnLogout(state.currentUser?.id); try { await api('/api/logout', { method: 'POST' }); } catch (e) { console.warn('logout api failed, fallback to local logout', e); } localStorage.removeItem(SESSION_KEY); location.reload(); } });
  on("clearCacheBtn", "click", () => { if(confirm("确定清理本地缓存吗？")) { localStorage.clear(); location.reload(); } });
  on("openSettingsBtn", "click", () => { window.openSecondaryPage('settingsPage', 'profile'); });
  on("globalNotifyBtn", "click", () => { showModal("新消息通知目前跟随系统默认设置开启"); });
  on("myQrCodeBtn", "click", () => { window.openSecondaryPage("qrCodePage"); if($("myQrCodeImg")) $("myQrCodeImg").src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${state.currentUser.appNumberId}`; if($("myQrCodeIdTxt")) $("myQrCodeIdTxt").textContent = `ID: ${state.currentUser.appNumberId}`; });
  on("myProductsBtn", "click", () => { window.openSecondaryPage('myProductsPage'); loadMyProducts(); });
  on("myBuyerOrdersBtn", "click", async () => { await loadBuyerOrders(); window.openSecondaryPage('buyerOrdersManagePage', 'profile'); });
  on("sellerCenterBtn", "click", async () => {
    await Promise.all([loadSellerOrders(), loadBuyerOrders()]);
    await loadSellerProductsManage();
    const hero = document.querySelector('#sellerCenterPage .seller-center-hero span');
    if (hero) hero.textContent = `卖家订单 ${state.sellerOrders.length} / 买家订单 ${state.buyerOrders.length} / 商品 ${state.sellerProducts.length}`;
    window.openSecondaryPage('sellerCenterPage', 'profile');
  });
  on("sellerOrderManageBtn", "click", async () => { await loadSellerOrders(); window.openSecondaryPage('sellerOrdersPage', 'sellerCenterPage'); });
  on("buyerOrdersSearchInput", "input", () => { state.buyerOrderSearch = $("buyerOrdersSearchInput")?.value?.trim() || ''; renderBuyerOrdersManage(); });
  on("buyerOrdersFromBtn", "click", () => { openDatePicker('buyer', 'from', state.buyerOrderFrom); });
  on("buyerOrdersToBtn", "click", () => { openDatePicker('buyer', 'to', state.buyerOrderTo); });
  on("buyerOrdersClearFilterBtn", "click", () => { state.buyerOrderSearch=''; state.buyerOrderFrom=''; state.buyerOrderTo=''; renderBuyerOrdersManage(); });
  on("buyerFilterToggleBtn", "click", () => { const d = $("buyerFilterDrawer"); if(d) d.classList.toggle('open'); $("buyerFilterToggleBtn")?.classList.toggle('active'); });
  on("buyerOrdersRangePresets", "click", (e) => {
    const btn = e.target.closest('.order-filter-chip');
    if (!btn) return;
    const days = Number(btn.dataset.range || 0);
    if (!days) return;
    applyOrderQuickRange('buyer', days);
  });
  on("sellerOrdersSearchInput", "input", () => { state.sellerOrderSearch = $("sellerOrdersSearchInput")?.value?.trim() || ''; renderSellerOrdersManage(); });
  on("sellerOrdersFromBtn", "click", () => { openDatePicker('seller', 'from', state.sellerOrderFrom); });
  on("sellerOrdersToBtn", "click", () => { openDatePicker('seller', 'to', state.sellerOrderTo); });
  on("sellerOrdersClearFilterBtn", "click", () => { state.sellerOrderSearch=''; state.sellerOrderFrom=''; state.sellerOrderTo=''; renderSellerOrdersManage(); });
  on("sellerFilterToggleBtn", "click", () => { const d = $("sellerFilterDrawer"); if(d) d.classList.toggle('open'); $("sellerFilterToggleBtn")?.classList.toggle('active'); });
  on("sellerOrdersRangePresets", "click", (e) => {
    const btn = e.target.closest('.order-filter-chip');
    if (!btn) return;
    const days = Number(btn.dataset.range || 0);
    if (!days) return;
    applyOrderQuickRange('seller', days);
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
  on("sellerWxPayUploadBtn", "click", () => { $("sellerWxPayFileInput")?.click(); });
  on("sellerAliPayUploadBtn", "click", () => { $("sellerAliPayFileInput")?.click(); });
  on("sellerCloudPayUploadBtn", "click", () => { $("sellerCloudPayFileInput")?.click(); });
  on("sellerWxPayFileInput", "change", async () => {
    const file = $("sellerWxPayFileInput")?.files?.[0];
    if($("sellerWxPayFileInput")) $("sellerWxPayFileInput").value = '';
    await uploadSellerPaymentCode('wechat', file);
  });
  on("sellerAliPayFileInput", "change", async () => {
    const file = $("sellerAliPayFileInput")?.files?.[0];
    if($("sellerAliPayFileInput")) $("sellerAliPayFileInput").value = '';
    await uploadSellerPaymentCode('alipay', file);
  });
  on("sellerCloudPayFileInput", "change", async () => {
    const file = $("sellerCloudPayFileInput")?.files?.[0];
    if($("sellerCloudPayFileInput")) $("sellerCloudPayFileInput").value = '';
    await uploadSellerPaymentCode('cloudpay', file);
  });
  on("saveSellerPaymentBtn", "click", async () => {
    const paymentCodes = {
      wechat: state.paymentCodeDraft?.wechat || '',
      alipay: state.paymentCodeDraft?.alipay || '',
      cloudpay: state.paymentCodeDraft?.cloudpay || '',
    };
    if (!paymentCodes.wechat && !paymentCodes.alipay && !paymentCodes.cloudpay) return showModal('请至少上传一个收款码');
    const btn = $("saveSellerPaymentBtn");
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    try{
      const data = await api('/api/users/update', { method:'POST', body: JSON.stringify({ userId: state.currentUser.id, paymentCodes }) });
      state.currentUser = data.user || state.currentUser;
      writeSession(state.currentUser);
      showModal('收款码已保存');
      window.openSecondaryPage('sellerCenterPage', state.secondaryReturn || 'profile');
    }catch(e){ showModal(e.message || '保存失败'); } finally { if (btn) { btn.disabled = false; btn.textContent = '保存'; } }
  });

  on("privacySettingsBtn", "click", async () => {
      window.openSecondaryPage('privacyPage', 'settingsPage');
      try {
          const data = await api(`/api/blacklist?userId=${encodeURIComponent(state.currentUser.id)}`);
          const list = $("blacklistContainer"); if(!list) return;
          const blacklist = data.users || data.blacklist || [];
          if(blacklist.length === 0) { const emptyDiv = document.createElement('div'); emptyDiv.style.cssText = 'text-align:center;padding:40px;color:var(--text-muted);font-size:14px;'; emptyDiv.textContent = '黑名单为空'; list.replaceChildren(emptyDiv); }
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
        const hint = document.createElement('div');
        hint.style.cssText = 'padding:12px 0; color:var(--text-muted); font-size:14px;';
        hint.textContent = '当前会话暂无可查看的用户资料';
        profileCard.appendChild(hint);
        return;
      }
      const friend = state.friends.find(f => f.friend.id === peerId);
      const userObj = friend ? friend.friend : { displayName: state.activeConversation?.title || state.conversations.find((c) => c.id === state.activeConversation?.id)?.title || '未知用户', avatarUrl: state.activeConversation?.peerAvatarUrl || null };
      const finalName = userObj.remark || userObj.displayName || '未知用户';
      profileCard.style.opacity = '';
      profileCard.appendChild(createAvatarNode(userObj, finalName));
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;text-align:left;';
      const strong = document.createElement('strong');
      strong.style.fontSize = '18px';
      strong.textContent = finalName;
      info.appendChild(strong);
      profileCard.appendChild(info);
      profileCard.onclick = () => window.openUserProfile(peerId, finalName);
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
      showModal(e.message || '操作失败');
      return null;
    }
  };
  on("muteSettingBtn", "click", async () => {
    const res = await toggleAction('mute');
    if (!res) return;
    showModal(res.muted ? '已开启免打扰' : '已关闭免打扰');
    if($("muteSettingBtn")) $("muteSettingBtn").textContent = res.muted ? '取消免打扰' : '消息免打扰';
    sortConversationsInPlace();
    renderConversationListFromState();
    loadConversations();
  });
  on("pinConversationBtn", "click", async () => {
    const res = await toggleAction('pin');
    if (!res) return;
    showModal(res.pinned ? '已置顶会话' : '已取消置顶');
    if($("pinConversationBtn")) $("pinConversationBtn").textContent = res.pinned ? '取消置顶' : '置顶聊天';
    sortConversationsInPlace();
    renderConversationListFromState();
    loadConversations();
  });
  on("clearChatBtn", "click", async () => {
    if(!confirm("确认清空?")) return;
    const res = await toggleAction('clear');
    if (!res) return;
    showModal('聊天记录已清空');
    state.messages = [];
    state.messageBefore = null;
    renderMessages();
  applyLastOutgoingReadState();
    state.chatListSignature = '';
    renderConversationListFromState();
    loadConversations();
  });

  on("blacklistBtn", "click", async () => {
      const peerId = conversationPeerId(state.activeConversation);
      if(!peerId) return showModal('未找到会话对象');
      if(confirm("确定把他加入黑名单吗？加入后将拒收他的消息。")) { showLoading('处理中...'); try { await api('/api/blacklist', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, targetId: peerId, action: 'add' }) }); showModal("已加入黑名单"); loadFriends().catch(() => {}); loadConversations().catch(() => {}); if($("backBtn")) $("backBtn").click(); } catch(e){ console.warn('add blacklist failed', e); showModal(e?.message || '加入黑名单失败'); } finally { hideLoading(); } }
  });
  on("deleteFriendBtn", "click", async () => {
      if(!confirm("确定删除好友并清空聊天记录?")) return;
      const peerId = conversationPeerId(state.activeConversation);
      if(!peerId) return showModal('未找到会话对象');
      showLoading('删除中...');
      try {
        await api('/api/friends/delete', { method:'POST', body: JSON.stringify({userId: state.currentUser.id, friendId: peerId}) });
        state.friends = (state.friends || []).filter((item) => item.friend?.id !== peerId);
        showModal('好友已删除');
        await Promise.all([loadFriends(), loadConversations()]);
        $("backBtn")?.click();
      } catch(e) { showModal(e.message || '删除失败'); } finally { hideLoading(); }
  });

  on("homeMoreBtn", "click", () => { if($("plusMenuSheet")) $("plusMenuSheet").classList.remove("hidden"); });
  on("closePlusMenuBtn", "click", () => { if($("plusMenuSheet")) $("plusMenuSheet").classList.add("hidden"); });
  on("menuAddFriend", "click", () => { if($("plusMenuSheet")) $("plusMenuSheet").classList.add("hidden"); window.openSecondaryPage('addFriendPage'); if($("myProfileIdDisplay")) $("myProfileIdDisplay").textContent = state.currentUser.appNumberId || state.currentUser.username; });
  on("menuScan", "click", () => { if($("plusMenuSheet")) $("plusMenuSheet").classList.add("hidden"); window.openSecondaryPage('scanPage'); });

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
      const avatarContent = user.avatarUrl
        ? `<img src="${user.avatarUrl}" alt="" />`
        : firstChar(user.displayName);
      resultEl.innerHTML = `
        <div class="add-friend-card">
          <div class="add-friend-card-top">
            <div class="add-friend-avatar" ${user.avatarUrl ? '' : 'style="background:#07c160"'}>${avatarContent}</div>
            <div class="add-friend-info">
              <div class="add-friend-name">${escapeHTML(user.displayName)}</div>
              <div class="add-friend-meta">ID: ${escapeHTML(user.appNumberId || '')}${user.role === 'seller' ? ' · 商家' : ''}</div>
            </div>
          </div>
          ${user.signature ? `<div class="add-friend-sig">${escapeHTML(user.signature)}</div>` : ''}
          <div class="add-friend-actions">
            <button type="button" class="add-friend-add-btn ${isFriend ? 'already' : ''}" id="addFriendSendBtn" data-uid="${user.id}" data-uname="${escapeHTML(user.username)}" ${isFriend ? 'disabled' : ''}>${isFriend ? '已是好友' : '添加好友'}</button>
          </div>
        </div>
      `;
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
  document.addEventListener('click', async (e) => {
    const addBtn = e.target.closest('#addFriendSendBtn');
    if (!addBtn || addBtn.disabled) return;
    const uname = addBtn.dataset.uname;
    const greeting = prompt('打个招呼吧：', `你好，我是${state.currentUser.displayName}`);
    if (greeting === null) return;
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
    if($("scanManualPanel")) $("scanManualPanel").classList.toggle('hidden');
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
    if($("myQrCodeIdTxt")) $("myQrCodeIdTxt").textContent = `ID: ${state.currentUser.appNumberId}`;
  });
  on("scanCaptureInput", "change", async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    const ok = await decodeScanFromImageFile(file);
    if (!ok) {
      $("scanManualPanel")?.classList.remove('hidden');
      if($("scanIdInput")) $("scanIdInput").focus();
      showModal('未能识别二维码，请手动输入 ChatTrade ID');
    }
  });
  on("scanSubmitBtn", "click", submitScanRequest);
  on("scanIdInput", "keydown", (e) => { if (e.key === 'Enter') submitScanRequest(); });

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
  on("orderDetailEditPriceBtn", "click", updateSelectedOrderPrice);
  on("orderDetailCompleteBtn", "click", completeSelectedOrder);
  on("closeSpecSheetBtn", "click", closeProductSpecSheet);
  on("confirmAddToCartBtn", "click", addSelectedProductToCart);
  on("saveProductEditorBtn", "click", () => {
    showModal('商品草稿已保存');
    if($("productEditorTitle")) $("productEditorTitle").value = '';
    if($("productEditorPrice")) $("productEditorPrice").value = '';
    if($("productEditorDesc")) $("productEditorDesc").value = '';
  });

  on("createBroadcastBtn", "click", () => {
    if($("broadcastTitleInput")) $("broadcastTitleInput").value = '';
    if($("broadcastSummaryInput")) $("broadcastSummaryInput").value = '';
    if($("broadcastTargetInput")) $("broadcastTargetInput").value = '';
    window.openSecondaryPage('broadcastEditorPage', 'broadcastManagePage');
  });
  on("saveBroadcastDraftBtn", "click", saveBroadcastDraft);
  on("sendBroadcastNowBtn", "click", async () => {
    const draft = state.selectedBroadcastDraft;
    if(!draft) return showModal('请先选择一条广播');
    const title = draft.title || '广播通知';
    const summary = draft.summary || '';
    const btn = $("sendBroadcastNowBtn");
    if (btn) { btn.disabled = true; btn.textContent = '发送中...'; }
    try {
      await window.sendMessage({ type: 'broadcast_card', broadcast: { title, summary, cover: '' } });
      showToast('广播已发送');
      if($("backBtn")) $("backBtn").click();
    } catch(e) { showModal(e.message || '发送失败'); } finally { if (btn) { btn.disabled = false; btn.textContent = '发送'; } }
  });

  on("profileMoreBtn", "click", () => showProfileActionSheet());
  on("profileStoreMoreBtn", "click", () => { state.profileStoreExpanded = !state.profileStoreExpanded; renderProfileStore(); });
  on("closeProfileActionSheetBtn", "click", hideProfileActionSheet);
  on("profileActionSheet", "click", (e) => { if(e.target === $("profileActionSheet")) hideProfileActionSheet(); });
  on("profileActionRemarkBtn", "click", async () => {
      const p = state.currentProfileUser; if(!p) return;
      hideProfileActionSheet();
      const newRemark = prompt("请输入好友备注名：", p.remarkName || "");
      if(newRemark === null) return;
      try { await api('/api/friends/remark', { method: 'POST', body: JSON.stringify({ userId: state.currentUser.id, friendId: p.id, remark: newRemark }) }); showModal("备注设置成功"); loadFriends(); loadConversations(); if($("backBtn")) $("backBtn").click(); } catch(e) { showModal(e.message); }
  });
  on("profileActionMoveGroupBtn", "click", () => { hideProfileActionSheet(); if(state.currentProfileUser) window.openGroupSelect(state.currentProfileUser.id); });
  on("profileActionBlacklistBtn", "click", async () => {
      const p = state.currentProfileUser; if(!p) return;
      hideProfileActionSheet();
      showLoading('处理中...');
      try { await api('/api/blacklist', { method:'POST', body: JSON.stringify({ userId: state.currentUser.id, targetId: p.id, action: 'add' }) }); showModal('已加入黑名单'); loadFriends().catch(() => {}); loadConversations().catch(() => {}); } catch(e) { showModal(e.message || '操作失败'); } finally { hideLoading(); }
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
      if($("voiceToggleBtn")) $("voiceToggleBtn").textContent = isVoice ? "⌨️" : "🎙️";
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
          // On Android native app, ensure mic permission before recording
          if (window.__NATIVE_ANDROID__ && window.NativeBridge && !window.NativeBridge.hasMicrophonePermission()) {
            window.NativeBridge.requestMicrophonePermission();
            await new Promise(r => setTimeout(r, 1500));
            if (!window.NativeBridge.hasMicrophonePermission()) throw new Error('需要麦克风权限才能录音，请在设置中开启');
          }
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          let mimeType = ''; if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm'; else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
          state.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {}); state.audioChunks = []; recordStartTime = Date.now();
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
      } catch(err) { if($("pttBtn")) $("pttBtn").textContent = "按住 说话"; showModal("无录音权限"); }
  });
  on("pttBtn", "touchend", (e) => {
      e.preventDefault(); if($("pttBtn")) { $("pttBtn").textContent = "按住 说话"; $("pttBtn").style.background = "#fff"; }
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') { state.mediaRecorder.stop(); state.mediaRecorder.stream.getTracks().forEach(t => t.stop()); }
  });

  on("btnTakePhoto", "click", () => { if($("cameraInput")) $("cameraInput").click(); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });
  on("btnSendImage", "click", () => { if($("imageInput")) $("imageInput").click(); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });
  on("btnCallVoice", "click", () => { window.startCall('voice'); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });
  on("btnCallVideo", "click", () => { window.startCall('video'); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });
  on("btnSendContactCard", "click", async () => { await sendContactCardInChat(); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });

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

  on("btnSendProductCard", "click", async () => { await sendProductCardInChat(); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });
  on("btnSendOrderCard", "click", async () => { await sendOrderCardInChat(); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });
  on("btnSendPaymentCode", "click", async () => { await sendPaymentCodeInChat(); if($("actionPanel")) $("actionPanel").classList.add("hidden"); });
  // Order picker tab switching
  if($("orderPickerTabs")){
    $("orderPickerTabs").addEventListener('click', (e) => {
      const tab = e.target.closest('.picker-tab');
      if(!tab) return;
      renderOrderCardPicker(tab.dataset.tab);
    });
  }
  // Product detail - add to cart via spec sheet
  on("productDetailAddCartBtn", "click", () => {
    const item = state.selectedProductDetail;
    if(!item) return;
    openProductSpecSheet(item);
  });
  // Product detail - buy now: add to cart and go to cart
  on("productDetailBuyNowBtn", "click", () => {
    const item = state.selectedProductDetail;
    if(!item) return;
    openProductSpecSheet(item);
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
  on("toggleMuteBtn", "click", () => { if (!state.rtc.localStream) return; isMuted = !isMuted; state.rtc.localStream.getAudioTracks().forEach(t => t.enabled = !isMuted); if($("toggleMuteBtn")) { $("toggleMuteBtn").classList.toggle('active', !isMuted); $("toggleMuteBtn").style.color = isMuted ? '#ff3b30' : '#fff'; } if($("muteText")) $("muteText").textContent = isMuted ? "已静音" : "静音"; });
  on("toggleCameraBtn", "click", () => { if (!state.rtc.localStream) return; isCameraOff = !isCameraOff; state.rtc.localStream.getVideoTracks().forEach(t => t.enabled = !isCameraOff); if($("toggleCameraBtn")) { $("toggleCameraBtn").classList.toggle('active', !isCameraOff); $("toggleCameraBtn").style.color = isCameraOff ? '#ff3b30' : '#fff'; } if($("cameraText")) $("cameraText").textContent = isCameraOff ? "已关镜头" : "镜头"; });
  
  on("acceptCallBtn", "click", async () => {
      if (state.rtc._accepting) return;
      state.rtc._accepting = true;
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
          if($("callName")) $("callName").textContent = peerName;
          state.rtc.pendingOffer = null; 
      } catch (err) { window.stopCall(); showModal(err && err.message ? err.message : '接听失败'); } finally { state.rtc._accepting = false; }
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
    if ($("callPanel")) $("callPanel").classList.add('hidden');
    const bubble = $("callFloatingBubble");
    if (bubble) {
      bubble.classList.remove('hidden');
      updateFloatingDuration();
      clearInterval(_callFloatingTimer);
      _callFloatingTimer = setInterval(updateFloatingDuration, 1000);
    }
  }
  function restoreCall() {
    const bubble = $("callFloatingBubble");
    if (bubble) bubble.classList.add('hidden');
    clearInterval(_callFloatingTimer);
    if (hasActiveCallSession() && $("callPanel")) $("callPanel").classList.remove('hidden');
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
  // Hide floating bubble when call ends
  const _origStopCall = window.stopCall;
  window.stopCall = () => {
    clearInterval(_callFloatingTimer);
    if ($("callFloatingBubble")) $("callFloatingBubble").classList.add('hidden');
    _origStopCall();
  };

  on("searchInput", "input", () => { loadConversations().catch(() => {}); });
  on("friendSearchInput", "input", () => { loadFriends().catch(() => {}); });

  const emojiList = ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","☺️","😚"];
  if($("emojiPanel")) {
    $("emojiPanel").replaceChildren();
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

  if (tab === 'messages') { if($("chatListView")) $("chatListView").classList.remove('hidden'); if($("chatTitle")) $("chatTitle").textContent = "微信"; loadConversations().catch(() => {}); loadSystemMessages().catch(() => {}); scheduleTradeReminderRefresh(0); }
  else if (tab === 'friends') { if($("friendListView")) $("friendListView").classList.remove('hidden'); if($("chatTitle")) $("chatTitle").textContent = "通讯录"; loadFriends().catch(() => {}); loadFriendRequests().catch(() => {}); }
  else if (tab === 'mall') { if($("mallView")) $("mallView").classList.remove('hidden'); if($("chatTitle")) $("chatTitle").textContent = "发现"; if (!state.userLocation) refreshUserLocation(); loadMall().catch(() => {}); } 
  else if (tab === 'profile') { if($("profileView")) $("profileView").classList.remove('hidden'); if($("chatTitle")) $("chatTitle").textContent = "我"; }
  if($("homeMoreBtn")) $("homeMoreBtn").classList.toggle("hidden", tab !== 'messages');
  // sidebar avatar bar only visible inside chat conversation, hide on all tab views
  if($("sidebarPanel")) $("sidebarPanel").classList.add("sidebar-tab-hidden");
  if($("sidebarToggleBtn")) $("sidebarToggleBtn").classList.add("hidden");
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
    const data = await api(`/api/users/${state.currentUser.id}/profile?viewerId=${encodeURIComponent(state.currentUser.id)}`);
    const list = $("myProductsList"); if(!list) return;
    const products = data.profile.products || [];
    if(products.length === 0) { const emptyDiv = document.createElement('div'); emptyDiv.style.cssText = 'text-align:center; padding: 40px; color:#8e8e93; font-size:14px;'; emptyDiv.textContent = '你还没有发布任何闲置商品'; list.replaceChildren(emptyDiv); return; }
    list.replaceChildren();
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
  } catch(e){
    console.warn('load my products failed', e);
    const list = $("myProductsList");
    if (list) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center; padding:40px; color:#8e8e93;';
      empty.textContent = e?.message || '加载我的商品失败';
      list.replaceChildren(empty);
    }
  }
}

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

async function loadMall() {

  try {
    const keyword = ($('mallSearchInput')?.value || '').trim();
    let qs = 'userId=' + state.currentUser.id;
    if (keyword) qs += '&q=' + encodeURIComponent(keyword);
    if (state.userLocation) qs += '&lat=' + state.userLocation.lat + '&lng=' + state.userLocation.lng;
    if (state.mallTab === 'price') qs += '&sort=price';
    else if (state.mallTab === 'latest') qs += '&sort=latest';
    else qs += '&sort=nearby';
    const data = await api('/api/mall?' + qs);
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
      empty.textContent = state.mallTab === 'nearby' ? '附近暂无闲置商品，快去发布吧' : '暂无商品，快去发布吧';
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
        row.style.cursor = 'pointer';
        const avatarWrap = document.createElement('div');
        avatarWrap.className = 'avatar-click-wrap';
        setAvatarContainer(avatarWrap, sender, senderName);
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
        row.addEventListener('click', () => { if(sender.id) window.openUserProfile(sender.id, senderName); });
        if (r.status === 'pending') {
          const actions = document.createElement('div');
          actions.style.cssText = 'display:flex; gap:8px; margin-left:auto;';
          const acceptBtn = document.createElement('button');
          acceptBtn.className = 'primary-btn';
          acceptBtn.style.cssText = 'min-height:36px; padding:0 14px; font-size:13px;';
          acceptBtn.textContent = '同意';
          acceptBtn.addEventListener('click', (e) => { e.stopPropagation(); window.acceptRequest(r.id); });
          const rejectBtn = document.createElement('button');
          rejectBtn.className = 'secondary-btn';
          rejectBtn.textContent = '拒绝';
          rejectBtn.addEventListener('click', (e) => { e.stopPropagation(); window.rejectRequest(r.id); });
          actions.appendChild(rejectBtn);
          actions.appendChild(acceptBtn);
          row.appendChild(actions);
        } else {
          const done = document.createElement('span');
          done.style.cssText = 'color:#8e8e93; font-size:14px;';
          done.textContent = r.status === 'rejected' ? '已拒绝' : '已处理';
          row.appendChild(done);
        }
        container.appendChild(row);
      });
    }
  } catch(e) {
    console.warn('load friend requests failed', e);
    if($("requestsList")) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '加载失败，请重试';
      $("requestsList").replaceChildren(empty);
    }
  }
}

function refreshFriendRequestState(options = {}) {
  const { forceList = false } = options || {};
  if (!state.currentUser || !state.currentUser.id) return Promise.resolve();
  if (!forceList && $("friendRequestsView") && $("friendRequestsView").classList.contains('hidden')) {
    return loadFriendRequests();
  }
  return loadFriendRequests();
}

async function loadFriends() {
  try {
    const keyword = $("friendSearchInput") ? $("friendSearchInput").value.trim().toLowerCase() : "";
    const data = await api(`/api/friends?userId=${encodeURIComponent(state.currentUser.id)}`);
    let filteredFriends = data.friends;
    if (keyword) filteredFriends = filteredFriends.filter(f => f.friend && ((f.friend.displayName || '').toLowerCase().includes(keyword) || (f.friend.username || '').toLowerCase().includes(keyword)));
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
    if (state.activeConversation?.id) applyChatRelationshipState();
  } catch(e) {
    console.warn('load friends failed', e);
    const container = $("friendList");
    if (container) {
      const empty = document.createElement('div');
      empty.className = 'chat-list-empty';
      empty.textContent = e?.message || '加载联系人失败';
      container.replaceChildren(empty);
    }
  }
}


function applyLastOutgoingReadState(){
  try{
    const chatView = $("chatView");
    if(!chatView) return;
    chatView.querySelectorAll('.message-read-state').forEach(el=> el.remove());
    const outgoing = [...chatView.querySelectorAll('article.message-row.me[data-id]')];
    if(!outgoing.length) return;
    const last = outgoing[outgoing.length - 1];
    const mid = last.dataset.id || '';
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
  chatView.replaceChildren();
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
    const data = await api(`/api/conversations/${encodeURIComponent(state.activeConversation.id)}/messages?userId=${encodeURIComponent(state.currentUser.id)}&limit=20&before=${encodeURIComponent(before)}`);
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
  } catch(e){
    console.warn('[messages] fetch failed', e);
  } finally { state.isLoadingMessages = false; }
}

let callTimer = null; let callStartTime = 0; let outgoingTimeoutTimer = null; let incomingTimeoutTimer = null; let connectTimeoutTimer = null; let lastCallAttemptAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden && callTimer && !hasActiveCallSession()) {
    clearInterval(callTimer); callTimer = null;
  }
  if (!document.hidden && !callTimer && hasActiveCallSession() && state.rtc.phase === 'connected' && callStartTime) {
    updateCallDuration();
    callTimer = setInterval(updateCallDuration, 1000);
  }
});
function updateCallDuration() { if(!callStartTime) return; const diff = Math.floor((Date.now() - callStartTime) / 1000); const m = String(Math.floor(diff / 60)).padStart(2, '0'); const s = String(diff % 60).padStart(2, '0'); if($("callDuration")) $("callDuration").textContent = `${m}:${s}`; }
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
async function enqueueSignal(conversationId, payload) { await api(`/api/conversations/${conversationId}/signal`, { method: 'POST', body: JSON.stringify(payload) }).catch(() => {}); }

function resolveCallPeerMeta(peerId, fallbackName = '') {
  let name = fallbackName || peerId || '';
  let avatarUrl = null;
  const friend = state.friends.find(f =>
    f.friend && (f.friend.id === peerId ||
    f.friend.username === peerId ||
    f.friend.friendId === peerId)
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
    try { await state.rtc.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) { console.warn('[webrtc] addIceCandidate failed:', e); }
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

    const msg = { id: 'call_'+Date.now(), senderId: 'system', type:'system', text, createdAt: new Date().toISOString() };
    state.messages = (state.messages || []).concat([msg]);
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
  const endedCallId = state.rtc.callId || state.rtc.pendingOffer?.callId || state.rtc.incomingMeta?.callId || state.rtc.lastEndedCallId || null;
  if (state.rtc.pc) {
    try { state.rtc.pc.onicecandidate = null; state.rtc.pc.ontrack = null; state.rtc.pc.onconnectionstatechange = null; state.rtc.pc.oniceconnectionstatechange = null; } catch(_) {}
    state.rtc.pc.close();
  }
  if (state.rtc.localStream) state.rtc.localStream.getTracks().forEach(t => t.stop()); if (state.rtc.remoteStream) state.rtc.remoteStream.getTracks().forEach(t => t.stop()); 
  state.rtc = { pc: null, mode: null, peerId: null, pendingOffer: null, incomingMeta: null, pendingAccept: false, earlyCandidates: [], phase: 'idle', endingLocally: false, conversationId: null, callId: null, lastEndedCallId: endedCallId, incomingShownKey: null, localStream: null, remoteStream: null, remoteCandidateQueue: [], _accepting: false, _starting: false }; 
  if($("localVideo")) $("localVideo").srcObject = null; if($("remoteVideo")) $("remoteVideo").srcObject = null; if($("callPanel")) $("callPanel").classList.add('hidden'); 
  isMuted = false; isCameraOff = false; isSpeaker = true; 
  if($("toggleMuteBtn")) { $("toggleMuteBtn").classList.add('active'); $("toggleMuteBtn").style.color = '#fff'; } if($("muteText")) $("muteText").textContent = "静音"; 
  if($("toggleCameraBtn")) { $("toggleCameraBtn").classList.add('active'); $("toggleCameraBtn").style.color = '#fff'; } if($("cameraText")) $("cameraText").textContent = "镜头"; 
  clearInterval(callTimer); callTimer = null; callStartTime = 0; clearAllCallTimers();
  if($("callDuration")) { $("callDuration").classList.add('hidden'); $("callDuration").textContent = "00:00"; } 
  refreshAfterCallStateChange(state.activeConversation?.id || state.rtc?.conversationId || null);
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
  if($("remoteVideo")) $("remoteVideo").srcObject = state.rtc.remoteStream;
  if($("localVideo")) $("localVideo").srcObject = stream;
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
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
    if($("callName")) $("callName").textContent = peerMeta.name; if($("callPanel")) $("callPanel").classList.remove('hidden'); setCallActionLayout('outgoing'); 
    if($("chatSubtitle")) $("chatSubtitle").textContent = mode === 'video' ? '视频通话邀请中…' : '语音通话邀请中…';
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
  _on('message_created', async (e) => { 
    const data = safeParseEventData(e);
    if (!data) return;
    if(state.activeConversation && state.activeConversation.id === data.conversationId && data.message) {
      const result = upsertMessage(data.message);
      if (result.action === 'append') appendMessageToView(data.message);
      else if (!replaceMessageInView(data.message)) renderMessages();
  applyLastOutgoingReadState();
      state.oldestMessageTime = state.messages[0]?.createdAt || 0;
      syncActiveConversationListMeta();
      scheduleRenderConversationList();
      api(`/api/conversations/${state.activeConversation.id}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) }).catch(() => {});
    } else if(state.activeConversation && state.activeConversation.id === data.conversationId) {
      await fetchMessages();
      api(`/api/conversations/${state.activeConversation.id}/read`, { method: "POST", body: JSON.stringify({ userId: state.currentUser.id }) }).catch(() => {});
      syncActiveConversationListMeta();
      scheduleRenderConversationList();
    } else if (data.message) {
      applyIncomingConversationMeta(data.conversationId, data.message);
      scheduleRenderConversationList();
      if (data.message.type === 'order_card') scheduleTradeReminderRefresh(120);
    } else {
      loadConversations();
    }
  });
  _on('message_recalled', (e) => { 
    const data = safeParseEventData(e);
    if (!data) return;
    if(state.activeConversation && state.activeConversation.id === data.conversationId) {
      if (!applyRecalledMessageLocally(data.messageId, data.senderId)) { fetchMessages(); }
      syncActiveConversationListMeta();
      scheduleRenderConversationList();
    } else if (data.message) {
      applyIncomingConversationMeta(data.conversationId, data.message);
      scheduleRenderConversationList();
    } else {
      loadConversations();
    }
  });
  _on('conversation_updated', () => { loadConversations().catch(() => {}); scheduleTradeReminderRefresh(180); });
  _on('friends_updated', async () => { await loadFriends(); if (state.activeConversation) applyChatRelationshipState(); });
  _on('friend_request_updated', loadFriendRequests);
  _on('mall_updated', async () => { await loadMall(); await syncProductViewsIfVisible(); });
  _on('system_message', (e) => { const data = safeParseEventData(e); if(!data || !data.message) return; state.systemMessages = [data.message, ...(state.systemMessages || []).filter((m)=>m.id!==data.message.id)].slice(0,30); scheduleRenderConversationList(); });
  _on('order_updated', () => { scheduleTradeReminderRefresh(120); });
  _on('typing_indicator', (e) => {
    const data = safeParseEventData(e);
    if (!data) return;
    if(state.activeConversation && state.activeConversation.id === data.conversationId) {
      if($("chatSubtitle")) $("chatSubtitle").textContent = "对方正在输入...";
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => { applyChatRelationshipState(); }, 3000);
    }
  });

  _on('webrtc_signal', async (e) => {
    const payload = safeParseEventData(e);
    if (!payload) return;
    const signal = payload.signal; if (!signal) return;
    if (!payload.mode) payload.mode = 'voice';
    if (signal.type === 'offer') {
      if (isIgnoredCallPayload(payload)) return;
      if (hasActiveCallSession() && !isSameIncomingCall(payload)) { api(`/api/conversations/${payload.conversationId}/call`, { method: 'POST', body: JSON.stringify({ senderId: state.currentUser.id, senderName: state.currentUser.displayName, targetUserId: payload.senderId, event: 'reject', mode: payload.mode, reason: 'busy', callId: payload.callId || null }) }).catch(() => {}); return; }
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
  });

  _on('call_event', (e) => {
    const payload = safeParseEventData(e);
    if (!payload) return;
    if (payload.event === 'start') {
      if (isIgnoredCallPayload(payload)) return;
      if (hasActiveCallSession() && !isSameIncomingCall(payload)) { autoBusyIncomingCall(payload); return; }
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
/* ===== Sidebar Avatar Bar ===== */
let _sidebarSignature = '';
function renderSidebar() {
  const panel = $('sidebarPanel');
  const list = $('sidebarList');
  if (!panel || !list) return;
  if (state.sidebarMode === 'hidden') return;

  const convs = (state.conversations || []).filter(c => !c.synthetic && !c.syntheticType);
  const visible = convs.filter(c => {
    const clearedAt = getConversationClearedAt(c);
    return !(clearedAt && (c.lastMessageAt || 0) <= clearedAt && !(c.unread > 0));
  });

  const sig = JSON.stringify(visible.map(c => c.id + ':' + (c.unread||0) + ':' + (c.preview||'') + ':' + (c.peerAvatarUrl||'') + ':' + (c.title||''))) + ':' + (state.activeConversation?.id || '') + ':' + state.sidebarMode;
  if (sig === _sidebarSignature) return;
  _sidebarSignature = sig;

  const frag = document.createDocumentFragment();
  visible.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    if (state.activeConversation && state.activeConversation.id === conv.id) item.classList.add('is-active');
    item.dataset.convId = conv.id;
    item.addEventListener('click', () => { window.openConversation(conv.id); });

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'sidebar-item-avatar';
    const safeAvatar = normalizeMediaUrl(conv.peerAvatarUrl);
    if (safeAvatar) {
      const img = document.createElement('img');
      img.src = safeAvatar;
      img.alt = '';
      img.onerror = function() { this.remove(); avatarWrap.textContent = firstChar(conv.title); };
      avatarWrap.appendChild(img);
    } else {
      avatarWrap.textContent = firstChar(conv.title);
    }

    if (conv.unread && conv.unread > 0) {
      const badge = document.createElement('span');
      const isMuted = isConversationMuted(conv);
      if (isMuted) {
        badge.className = 'sidebar-badge-dot';
      } else {
        badge.className = 'sidebar-badge';
        badge.textContent = conv.unread > 99 ? '99+' : String(conv.unread);
      }
      avatarWrap.appendChild(badge);
    }
    item.appendChild(avatarWrap);

    if (state.sidebarMode === 'expanded') {
      const name = document.createElement('div');
      name.className = 'sidebar-item-name';
      name.textContent = conv.title || '';
      item.appendChild(name);
      const preview = document.createElement('div');
      preview.className = 'sidebar-item-preview';
      preview.textContent = conv.preview || '';
      item.appendChild(preview);
    }

    frag.appendChild(item);
  });
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

let _renderConvListTimer = null;
function scheduleRenderConversationList() {
  if (_renderConvListTimer) return;
  _renderConvListTimer = requestAnimationFrame(() => { _renderConvListTimer = null; renderConversationListFromState(); });
}
function renderConversationListFromState() {
  bindConversationSwipeDismiss();
  const keyword = $("searchInput") ? $("searchInput").value.trim().toLowerCase() : "";
  let filteredConvs = state.conversations || [];
  if (keyword) filteredConvs = filteredConvs.filter(c => (c.title || '').toLowerCase().includes(keyword));

  const tradeOrders = (state.buyerOrders || []).concat(state.sellerOrders || []).filter((o) => o && o.status !== 'completed');
  const tradeConv = tradeOrders.length ? {
    id: '__trade_alert__',
    title: '交易提醒',
    preview: `待处理 ${tradeOrders.length} 单（拉黑不影响交易提醒）`,
    unread: tradeOrders.length,
    muted: false,
    pinned: true,
    peerAvatarUrl: '',
    lastMessageAt: Math.max(...tradeOrders.map((o) => Number(o.updatedAt || o.createdAt || 0)), Date.now()),
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
    return !(clearedAt && (conv.lastMessageAt || 0) <= clearedAt && !(conv.unread > 0));
  });
  visible.forEach((conv) => {
    const isMuted = isConversationMuted(conv);
    if (conv.unread && !isMuted) totalUnread += conv.unread;
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
    const nextIds = new Set(visible.map((conv) => String(conv.id)));
    const nextItemSignatures = {};
    const existingRows = new Map(Array.from(container.querySelectorAll('[data-conversation-id]')).map((node) => [node.dataset.conversationId, node]));
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
  renderSidebar();
}

async function loadSystemMessages(){
  if(!state.currentUser) return;
  try{
    const data = await api('/api/system/messages');
    state.systemMessages = data.items || [];
  }catch(_){
    state.systemMessages = [];
  }
  renderConversationListFromState();
}

function renderSystemMessagesList(){
  const list = $("systemMessagesList");
  if(!list) return;
  const msgs = state.systemMessages || [];
  if(!msgs.length){
    const empty = document.createElement('div');
    empty.className = 'order-empty-state';
    empty.textContent = '📢 暂无系统消息';
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  msgs.forEach(msg => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'profile-order-card';
    const title = document.createElement('div');
    title.className = 'profile-order-title';
    title.textContent = msg.title || '系统通知';
    const sub = document.createElement('div');
    sub.className = 'profile-order-sub';
    sub.textContent = msg.summary || msg.text || '';
    const time = document.createElement('div');
    time.className = 'order-card-time';
    time.style.marginTop = '6px';
    time.textContent = msg.createdAt ? formatTime(msg.createdAt) : '';
    card.append(title, sub, time);
    card.addEventListener('click', () => openBroadcastDetail(msg.title || '系统消息', msg.summary || msg.text || ''));
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
  state.systemMessagesReadAt = Date.now();
}

async function loadConversations() {
  try {
    const data = await api(`/api/conversations?userId=${encodeURIComponent(state.currentUser.id)}`);
    state.conversations = (data.conversations || []).map(normalizeConversation);
    if (state.activeConversation) {
      const next = state.conversations.find((c) => c.id === state.activeConversation.id);
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
    state.csrfToken = session.csrfToken || null;
    if (!user || !user.id || !state.sessionToken) { if($("authScreen")) $("authScreen").classList.remove("hidden"); return; }
    
    try {
      const refreshed = await api(`/api/users/${user.id}/profile?viewerId=${user.id}`);
      if(refreshed.profile) {
        user.displayName = refreshed.profile.nickname; user.avatarUrl = refreshed.profile.avatarUrl; user.signature = refreshed.profile.signature; user.appNumberId = refreshed.profile.appNumberId; user.customGroups = normalizeCustomGroups(refreshed.profile.customGroups); user.paymentCodes = refreshed.profile.paymentCodes || user.paymentCodes || { wechat:'', alipay:'', cloudpay:'' }; user.phone = refreshed.profile.phone || user.phone || '';
        writeSession(user);
      }
    } catch(e) {
      console.warn("账号已失效，需重新登录");
      localStorage.removeItem(SESSION_KEY);
      if($("authScreen")) $("authScreen").classList.remove("hidden");
      return; 
    }

    state.currentUser = user;
    nativeOnLogin(user.id);
    loadCartFromStorage();
    if($("authScreen")) $("authScreen").classList.add("hidden");
    if($("appScreen")) $("appScreen").classList.remove("hidden");
    
    if($("profileDisplayName")) $("profileDisplayName").textContent = state.currentUser.displayName; 
    if($("profileUsername")) $("profileUsername").textContent = `ID: ${state.currentUser.appNumberId}`; 
    setAvatarContainer($("myProfileAvatar"), state.currentUser, state.currentUser.displayName);
    
    connectRealtime().catch(() => {});

    ['messages', 'friends', 'mall', 'profile'].forEach(t => { if($(t+'Tab')) $(t+'Tab').classList.remove('active'); });
    if($('messagesTab')) $('messagesTab').classList.add('active');
    ["chatListView","friendListView","mallView","profileView"].forEach(id => { if($(id)) $(id).classList.add('hidden'); });
    if($("chatListView")) $("chatListView").classList.remove('hidden');
    if($("chatTitle")) $("chatTitle").textContent = "微信"; 
    
    loadConversations();
    loadSystemMessages();
    loadFriendRequests();
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

// ==========================================
// ★ Android Native Bridge Integration ★
// ==========================================
// Detects if running inside Android WebView with NativeBridge
// and connects H5 call/push logic to native capabilities.

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
window.__onNativeCallAction = (action, callerId, conversationId, callId) => {
  if (action === 'accept_call') {
    // Open conversation and auto-accept
    if (conversationId) {
      window.openConversation(conversationId, { skipFetch: false }).then(() => {
        // The SSE webrtc_signal handler will pick up the pending offer
        // Set pendingAccept so it auto-accepts when offer arrives
        state.rtc.pendingAccept = true;
      }).catch(() => {});
    }
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

// 暴力启动，绝不等待任何事件
bootstrap();
