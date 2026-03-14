/* app_contacts.js — Contact cards, trade pickers & group management extracted from app.js */

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
  const _ccpInput = $("ccpSearchInput");
  if (_ccpInput) _ccpInput.value = '';
  hideEl("ccpConfirmBar");
  renderContactCardPicker();
  window.openSecondaryPage('contactCardPickerPage', 'chat');
  const _chatTitleEl = $("chatTitle");
  if (_chatTitleEl) _chatTitleEl.textContent = '选择名片';
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
  const appMatch = fromText.match(_RE_CT_ID);
  const appId = appMatch ? appMatch[0].toUpperCase() : '';

  const srcFriends = state.friends || [];
  const title = String(card.title || '').trim();
  if (!appId && !title) return '';
  let titleMatch = '';
  for (let i = 0; i < srcFriends.length; i++) {
    const f = srcFriends[i].friend;
    if (!f) continue;
    if (appId && String(f.appNumberId || '').toUpperCase() === appId && f.id) return f.id;
    if (!titleMatch && title) {
      const r = String(f.remark || '').trim();
      const d = String(f.displayName || '').trim();
      const u = String(f.username || '').trim();
      if ((r && r === title) || (d && d === title) || (u && u === title)) titleMatch = f.id;
    }
  }
  return titleMatch;
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
  for (let gi = 0; gi < customGroups.length; gi++) grouped.set(customGroups[gi], []);
  for (let fi = 0; fi < allFriends.length; fi++) {
    const item = allFriends[fi];
    const f = item.friend;
    if (!f) continue;
    if (search && !(f._lcName || (f._lcName = (f.displayName || '').toLowerCase())).includes(search) && !(f._lcRemark || (f._lcRemark = (f.remark || '').toLowerCase())).includes(search) && !(f._lcUser || (f._lcUser = (f.username || '').toLowerCase())).includes(search)) continue;
    const groupName = item.group || DEFAULT_GROUP;
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName).push(f);
  }

  // Count total visible
  let totalVisible = 0;
  for (const [, members] of grouped) totalVisible += members.length;
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
      row.appendChild(createEl('div', 'ccp-check'));
      content.appendChild(row);
    });

    section.append(header, content);
    frag.appendChild(section);
  });

  list.replaceChildren(frag);
  // Single delegated click handler instead of per-row listeners
  list.onclick = (e) => {
    const row = e.target.closest('.ccp-friend-row');
    if (!row) return;
    const friendId = row.dataset.friendId;
    // Deselect previous
    const prev = list.querySelector('.ccp-friend-row.selected');
    if (prev && prev !== row) { prev.classList.remove('selected'); const c = prev.querySelector('.ccp-check'); if (c) c.textContent = ''; }
    // Select this one
    row.classList.add('selected');
    const check = row.querySelector('.ccp-check');
    if (check) check.textContent = '✓';
    // Look up the friend object from state
    const entry = state.friendsById.get(friendId);
    const f = entry?.friend || entry;
    if (f) {
      state._ccpSelectedFriend = f;
      showEl("ccpConfirmBar");
      const nameEl = $("ccpSelectedName");
      if (nameEl) nameEl.textContent = f.remark || f.displayName || f.username || '好友';
      const avatarWrap = $("ccpSelectedAvatar");
      if (avatarWrap) { avatarWrap.replaceChildren(); avatarWrap.appendChild(createAvatarNode(f, f.displayName || f.username || '友')); }
    }
  };
}

async function renderProductCardPicker(){
  const list = $("productCardPickerList");
  if(!list) return;
  const srcProducts = Array.isArray(state.currentUser?.products) ? state.currentUser.products : [];
  // Count valid products first to check emptiness without allocating a filtered array
  let hasProducts = false;
  for (let i = 0; i < srcProducts.length; i++) { if (srcProducts[i]) { hasProducts = true; break; } }
  if(!hasProducts){
    showEmptyState(list, '暂无可发送商品，请先发布');
    return;
  }
  const frag = document.createDocumentFragment();
  for (let i = 0; i < srcProducts.length; i++) {
    const p = srcProducts[i];
    if (!p) continue;
    const card = createEl('button', 'picker-product-card');
    card.type = 'button';
    const imgUrl = normalizeMediaUrl(p.image || p.imageUrl) || '';
    const img = createEl('img', 'picker-product-img');
    lazyImg(img, imgUrl);
    img.alt = '';
    const info = createEl('div', 'picker-product-info');
    info.append(createEl('div', 'picker-product-name', p.title || '商品'), createEl('div', 'picker-product-price', formatMoney(p.price)));
    card.append(img, info);
    card.addEventListener('click', async () => {
      await window.sendMessage({ type:'card', card:{ cardType:'闲置商品', title: p.title || '商品', description: `售价：${formatMoney(p.price)}`, meta: String(p.price || 0), imageUrl: p.image || p.imageUrl || '', sellerId: p.sellerId || state.currentUser?.id || '', productId: p.id || '' } });
      if($("backBtn")) $("backBtn").click();
    });
    frag.appendChild(card);
  }
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
    const tabs = tabBar.querySelectorAll('.picker-tab');
    for (let i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].dataset.tab === tab);
  }
  const uid = state.currentUser?.id;
  const orders = [];
  for (let i = 0; i < allOrders.length; i++) {
    const o = allOrders[i];
    if (tab === 'bought' ? o.buyerId === uid : o.sellerId === uid) orders.push(o);
  }
  if(!orders.length){
    showEmptyState(list, tab === 'bought' ? '暂无从对方购买的订单' : '暂无卖给对方的订单');
    return;
  }
  const frag = document.createDocumentFragment();
  for (let j = 0; j < orders.length; j++) {
    const o = orders[j];
    const isBuyer = o.buyerId === uid;
    const role = isBuyer ? 'buyer' : 'seller';
    const roleLabel = isBuyer ? '买家' : '卖家';
    // Build items summary without .map().join()
    const oItems = o.items || [];
    let itemsSummary = '';
    for (let k = 0; k < oItems.length; k++) {
      const it = oItems[k];
      if (k > 0) itemsSummary += '，';
      itemsSummary += `${it.title}(${it.spec||'默认'})x${it.quantity||1}`;
    }
    if (!itemsSummary) itemsSummary = '订单内容';
    const card = createEl('button', 'picker-order-card');
    card.type = 'button';
    const top = createEl('div', 'picker-order-top');
    top.append(createEl('span', 'picker-order-id', `#${formatOrderId(o.id)}`), createEl('span', `picker-order-role ${role}`, roleLabel));
    const bottom = createEl('div', 'picker-order-bottom');
    bottom.append(createEl('span', 'picker-order-total', formatMoney(o.total)), createEl('span', 'picker-order-status', formatOrderStatusLabel(o.status)));
    card.append(top, createEl('div', 'picker-order-items', itemsSummary), bottom);
    card.addEventListener('click', async () => {
      // Find first item imageUrl without .find()
      let orderImgUrl = '';
      for (let k = 0; k < oItems.length; k++) { if (oItems[k] && oItems[k].imageUrl) { orderImgUrl = oItems[k].imageUrl; break; } }
      await window.sendMessage({ type:'order_card', order:{ id:o.id, buyerId:o.buyerId, sellerId:o.sellerId, title:`订单 #${formatOrderId(o.id)}`, summary:itemsSummary, total:o.total, status:o.status, imageUrl: orderImgUrl, pendingPrice:o.pendingPrice||null, pendingPriceRequestedBy:o.pendingPriceRequestedBy||null, priceAdjustmentLocked:!!o.priceAdjustmentLocked, role } });
      if($("backBtn")) $("backBtn").click();
    });
    frag.appendChild(card);
  }
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
