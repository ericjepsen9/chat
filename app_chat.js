/* app_chat.js — Message indexing, building & rendering extracted from app.js */

const conversationPeerId = c => {
  if (!c || !c.members || !state.currentUser) return null;
  const uid = state.currentUser.id;
  // Invalidate cache if current user changed
  if (c._peerIdFor === uid && c._peerId !== undefined) return c._peerId;
  c._peerIdFor = uid;
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
  state.messagesById.clear();
  for (let i = 0; i < state.messages.length; i++) state.messagesById.set(state.messages[i].id, i);
  _messagesSig = '';
}
function findMessageIndex(msg) {
  if (!msg) return -1;
  const byId = state.messagesById.get(msg.id);
  if (byId !== undefined && byId < state.messages.length && state.messages[byId]?.id === msg.id) return byId;
  // Single combined scan: check both id and clientMessageId in one pass
  const hasCmid = !!msg.clientMessageId;
  let cmidMatch = -1;
  for (let i = 0; i < state.messages.length; i++) {
    const m = state.messages[i];
    if (m.id === msg.id) { state.messagesById.set(msg.id, i); return i; }
    if (hasCmid && cmidMatch < 0 && m.clientMessageId === msg.clientMessageId && m.senderId === msg.senderId) cmidMatch = i;
  }
  return cmidMatch;
}
function upsertMessage(msg) {
  const idx = findMessageIndex(msg);
  if (idx >= 0) {
    Object.assign(state.messages[idx], msg);
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
  // Register in element cache for O(1) lookups
  if (msg.id) _msgElCache.set(String(msg.id), node);
  if (msg.clientMessageId) _msgElCacheByClient.set(String(msg.clientMessageId), node);
  let userObj = state.currentUser; let finalName = '我';
  if (msg.senderId !== state.currentUser?.id) {
    const friend = findFriendEntry(msg.senderId);
    userObj = (friend && friend.friend) ? friend.friend : { displayName: '用户' };
    finalName = userObj.remark || userObj.displayName || '用户';
  }
  const isTemp = String(msg.id).startsWith('temp_');

  if (msg.type === 'system') {
    let txt = msg.text;
    if (txt === '你撤回了一条消息' && msg.senderId !== state.currentUser.id) txt = '对方撤回了一条消息';
    node.className = 'message-row system-msg';
    node.appendChild(createEl('div', 'bubble', txt || ''));
  } else {
    const isGroupChat = state.activeConversation?.type === 'group';
    const avatarWrap = createEl('div', 'avatar-click-wrap');
    avatarWrap.dataset.senderId = msg.senderId;
    avatarWrap.dataset.senderName = finalName;
    avatarWrap.appendChild(createAvatarNode(userObj, finalName));
    // Click handled via delegation on chatView
    node.appendChild(avatarWrap);

    const wrap = createEl('div', 'content-wrap');
    if (isTemp) wrap.style.opacity = '0.6';
    // Show sender name for group messages (not own messages)
    if (isGroupChat && msg.senderId !== state.currentUser?.id) {
      wrap.appendChild(createEl('div', 'group-sender-name', finalName));
    }

    if (msg.type === 'audio') {
      const bubble = createEl('div', 'bubble audio-bubble');
      bubble.dataset.audioUrl = normalizeMediaUrl(msg.audioUrl) || '';
      bubble.append(createEl('span', null, '🔊'), createEl('span', null, '语音'));
      // Click handled via delegation on chatView
      wrap.appendChild(bubble);
    } else if (msg.type === 'image') {
      const bubble = createEl('div', 'bubble image-bubble');
      const safeImage = normalizeMediaUrl(msg.imageUrl);
      if (safeImage) {
        const img = createEl('img', 'chat-img-clickable');
        img.src = safeImage;
        img.style.cursor = 'zoom-in';
        img.style.pointerEvents = 'auto';
        // Click handled via delegation on chatView
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
        img.onerror = function() { this.style.display = 'none'; };
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
            // Single-pass: build candidate list without two .filter() calls
            let candidateIds;
            if (cardSellerId) { candidateIds = [cardSellerId]; }
            else {
              candidateIds = [];
              if (msg.senderId) candidateIds.push(msg.senderId);
              for (let mi = 0; mi < members.length; mi++) { if (members[mi] && members[mi] !== msg.senderId) candidateIds.push(members[mi]); }
            }
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
  if (s === 'shipped') return '已发货';
  if (s === 'accepted') return '已接单';
  if (s === 'pending' || s === 'created' || s === 'new') return '未接单';
  if (s === 'refunded') return '已退款';
  return '未接单';
}

function buildOrderCardMessage(msg){
  const order = msg.order || {};
  const wrap = createEl('div', 'trade-card clickable-card');
  wrap.dataset.orderId = order.id || '';

  const safeOrderImage = normalizeMediaUrl(order.imageUrl || (order.items || []).find((item) => item && item.imageUrl)?.imageUrl || '');
  if (safeOrderImage) {
    const cover = createEl('img', 'trade-card-cover chat-img-clickable');
    cover.src = safeOrderImage;
    cover.alt = order.title || '订单商品';
    cover.style.cursor = 'zoom-in';
    // Click handled via chatView delegation (chat-img-clickable class)
    wrap.appendChild(cover);
  }

  appendTradeCardHeader(wrap, order.title || `订单 #${formatOrderId(order.id, order.orderNo) || '-'}`, order.summary || '订单通知');
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

  // Seller can ship accepted orders
  if(isSeller && order.status === 'accepted'){
    actions.appendChild(createStopBtn('primary-btn', '发货', (e, btn) => {
      if(!order.id) return;
      openShipOrderDialog(order.id);
    }));
  }
  // Buyer sees waiting text for accepted orders
  if(isBuyer && order.status === 'accepted'){
    actions.appendChild(createEl('span', 'trade-card-sub', '商家备货中'));
  }

  // Shipped: show tracking info + buyer confirm receipt
  if(isParticipant && order.status === 'shipped'){
    if(order.trackingNo){
      actions.appendChild(createEl('span', 'trade-card-sub', '快递单号: ' + order.trackingNo));
    }
    if(isBuyer){
      actions.appendChild(createStopBtn('primary-btn', '确认收货', (e, btn) => {
        if(!order.id) return;
        showConfirm('确认已收到商品？', () => {
          withButtonLock(btn, () => doCompleteOrder(order.id), '处理中...');
        });
      }));
    }
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
    try{ await Promise.all([loadBuyerOrders(), loadSellerOrders()]); }catch(e){ console.warn('[loadOrders]', e); }
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
  // Batch read before write to avoid layout thrashing
  const sh = chatView.scrollHeight;
  const st = chatView.scrollTop;
  const ch = chatView.clientHeight;
  const wasNearBottom = (sh - st - ch) < 100;
  const prev = state.messages.length > 1 ? state.messages[state.messages.length - 2] : null;
  chatView.appendChild(buildMessageChunk(msg, prev?.createdAt || 0));
  if (wasNearBottom) requestAnimationFrame(() => { chatView.scrollTop = chatView.scrollHeight; });
  scheduleReceiptRefresh();
}
function prependMessagesToView(messages, oldFirstMessage = null) {
  const chatView = $('chatView');
  if (!chatView || !messages || !messages.length) return;
  // Read scrollHeight once before DOM mutation
  const oldHeight = chatView.scrollHeight;
  const fragment = document.createDocumentFragment();
  let lastTime = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    fragment.appendChild(buildMessageChunk(msg, lastTime));
    lastTime = msg.createdAt || lastTime;
  }
  chatView.prepend(fragment);
  if (oldFirstMessage && lastTime && ((oldFirstMessage.createdAt || 0) - lastTime) <= DELAYS.TIME_SEPARATOR_GAP) {
    const firstArticle = chatView.querySelector('article.message-row');
    const maybeStamp = firstArticle?.previousElementSibling;
    if (maybeStamp && maybeStamp.classList && maybeStamp.classList.contains('time-stamp')) maybeStamp.remove();
  }
  // Defer scroll position restoration to next frame to batch reflow
  requestAnimationFrame(() => { chatView.scrollTop = chatView.scrollHeight - oldHeight; });
  scheduleReceiptRefresh();
}
function replaceMessageInView(msg) {
  const chatView = $('chatView');
  if (!chatView || !msg) return false;
  const existing = _lookupMsgEl(chatView, msg);
  if (!existing) return false;
  const index = findMessageIndex(msg);
  const prev = index > 0 ? state.messages[index - 1] : null;
  // Remove old cache entries before replacement
  if (msg.id) _msgElCache.delete(String(msg.id));
  if (msg.clientMessageId) _msgElCacheByClient.delete(String(msg.clientMessageId));
  existing.replaceWith(buildMessageChunk(msg, prev?.createdAt || 0));
  scheduleReceiptRefresh();
  return true;
}
function removeMessageFromView(messageId) {
  const chatView = $('chatView');
  if (!chatView || !messageId) return false;
  const existing = _lookupMsgElById(chatView, messageId);
  if (!existing) return false;
  // Remove from cache
  _msgElCache.delete(String(messageId));
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
  scheduleReceiptRefresh();
  return true;
}
function applyRecalledMessageLocally(messageId, senderId) {
  const msgIdx = state.messagesById.get(messageId);
  const msg = msgIdx !== undefined ? state.messages[msgIdx] : undefined;
  if (!msg) return false;
  msg.type = 'system';
  msg.text = senderId === state.currentUser?.id ? '你撤回了一条消息' : '对方撤回了一条消息';
  msg.imageUrl = null; msg.audioUrl = null; msg.card = null;
  return replaceMessageInView(msg) || false;
}
// Pre-allocated preview strings to avoid repeated allocations in hot path
const _PREVIEW_BY_TYPE = { image: '[图片]', audio: '[语音]', order_card: '[订单]', broadcast_card: '[图文通知]' };
function summarizeMessagePreview(msg) {
  if (!msg) return '';
  if (msg.type === 'system') return String(msg.text || '');
  const quick = _PREVIEW_BY_TYPE[msg.type];
  if (quick) return quick;
  if (msg.type === 'card') {
    if (isContactCardPayload(msg.card || {})) return '[名片]';
    const ct = String((msg.card || {}).cardType || '').trim();
    if (ct === '收款码') return '[收款码]';
    return '[商品]';
  }
  return String(msg.text || '');
}

// O(1) message element lookup caches — populated by buildMessageChunk, cleared on full re-render
const _msgElCache = new Map();
const _msgElCacheByClient = new Map();
function _lookupMsgEl(chatView, msg) {
  if (!msg) return null;
  const byId = msg.id ? _msgElCache.get(String(msg.id)) : null;
  if (byId && chatView.contains(byId)) return byId;
  const byCid = msg.clientMessageId ? _msgElCacheByClient.get(String(msg.clientMessageId)) : null;
  if (byCid && chatView.contains(byCid)) return byCid;
  // Fallback to DOM query (shouldn't happen normally)
  return chatView.querySelector(`article.message-row[data-id="${CSS.escape(String(msg.id || ''))}"]`)
    || (msg.clientMessageId ? chatView.querySelector(`article.message-row[data-client-message-id="${CSS.escape(String(msg.clientMessageId))}"]`) : null);
}
function _lookupMsgElById(chatView, messageId) {
  if (!messageId) return null;
  const cached = _msgElCache.get(String(messageId));
  if (cached && chatView.contains(cached)) return cached;
  return chatView.querySelector(`article.message-row[data-id="${CSS.escape(String(messageId))}"]`);
}
let _lastReceiptKey = '';
let _lastReceiptEl = null;
function refreshMessageReadReceipts() {
  const chatView = $('chatView');
  if (!chatView) return;
  if (!state.currentUser || !state.activeConversation || state.activeConversation.type !== 'direct') {
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
  const row = _lookupMsgEl(chatView, target);
  if (!row) return;
  const wrap = row.querySelector('.content-wrap');
  if (!wrap) return;
  const isRead = peerLastReadAt >= Number(target.createdAt || 0);
  const receipt = createEl('div', `message-read-receipt ${isRead ? 'is-read' : 'is-unread'}`);
  receipt.append(createEl('span', 'receipt-dot'), createEl('span', 'receipt-text', isRead ? '已读' : '未读'));
  wrap.appendChild(receipt);
  _lastReceiptEl = receipt;
}
