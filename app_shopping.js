/* app_shopping.js — Cart, checkout & profile store extracted from app.js */

function sumCartTotals(items) {
  let count = 0, total = 0;
  for (let i = 0; i < items.length; i++) { const q = Number(items[i].quantity)||0; count += q; total += (Number(items[i].unitPrice)||0)*q; }
  return { count, total };
}

// Cached cart quantity map: productId → totalQuantity (invalidated on cart change)
let _cartQtyCache = null;
let _cartQtyCacheSellerId = '';
function _buildCartQtyCache(sellerId) {
  const cart = getCurrentSellerCart(sellerId);
  const m = new Map();
  for (let i = 0; i < cart.length; i++) {
    const pid = String(cart[i].productId);
    m.set(pid, (m.get(pid) || 0) + (Number(cart[i].quantity) || 0));
  }
  _cartQtyCache = m;
  _cartQtyCacheSellerId = sellerId;
  return m;
}
function invalidateCartQtyCache() { _cartQtyCache = null; }

function getProfileStoreItemCartQuantity(item){
  if(!item) return 0;
  const sellerId = item.sellerId || state.currentProfileUser?.id || '';
  const cache = (_cartQtyCache && _cartQtyCacheSellerId === sellerId) ? _cartQtyCache : _buildCartQtyCache(sellerId);
  return cache.get(String(item.id)) || 0;
}

function getItemAvailableStock(item){
  const stock = Number(item?.stock ?? 0);
  if (!Number.isFinite(stock)) return 0;
  return Math.max(0, Math.floor(stock));
}

function adjustProfileStoreItemQuantity(item, delta){
  if(!item || !delta) return;
  invalidateCartQtyCache();
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
    if (inCartQty >= 9999) {
      showToast('单品数量已达上限');
      return;
    }
    if(found){
      found.quantity = Math.min(9999, (Number(found.quantity) || 0) + 1);
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

const renderProfileStore = safeRender(function renderProfileStore(){
  const list = $("profileStoreList");
  const title = $("profileStoreTitle");
  const moreBtn = $("profileStoreMoreBtn");
  if(!list) return;
  const _psi = state.profileStoreItems || [];
  const _sigParts = new Array(_psi.length);
  for (let i = 0; i < _psi.length; i++) { const it = _psi[i]; _sigParts[i] = it.id+'|'+(it.listed?'1':'0')+'|'+it.stock+'|'+(it.createdAt||0); }
  const sig = _sigParts.join(';') + '|' + state.profileStoreCategoryFilter + '|' + (state.profileStoreExpanded?'1':'0');
  if (!sigChanged('profileStore', sig)) return;
  const sortedItems = (state.profileStoreItems || []);
  sortedItems.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  // Single-pass: cache parsed categories and collect unique categories
  const cats = new Set();
  for (const item of sortedItems) {
    if (item.category && !item._parsedCats) item._parsedCats = _splitCategories(item.category);
    if (item._parsedCats && !item._parsedCatsSet) item._parsedCatsSet = new Set(item._parsedCats);
    if (item._parsedCats) for (let ci = 0; ci < item._parsedCats.length; ci++) cats.add(item._parsedCats[ci]);
  }
  // Build category tabs
  const catTabsEl = $("profileStoreCategoryTabs");
  if (catTabsEl) {
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
    ? sortedItems.filter(item => item._parsedCatsSet && item._parsedCatsSet.has(state.profileStoreCategoryFilter))
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
  // Build product lookup for delegated click handlers
  const _storeItemsById = new Map();
  for (const p of items) if (p.id) _storeItemsById.set(String(p.id), p);
  if (list.dataset.storeClickBound !== '1') {
    list.dataset.storeClickBound = '1';
    list.addEventListener('click', (e) => {
      const card = e.target.closest('.profile-store-item[data-product-id]');
      if (!card) return;
      const item = state._storeItemsById?.get(card.dataset.productId);
      if (!item) return;
      // Delegated stepper/spec button handling
      const specBtn = e.target.closest('.secondary-btn');
      if (specBtn) { e.stopPropagation(); openProductSpecSheet(item); return; }
      const qtyBtn = e.target.closest('.qty-btn');
      if (qtyBtn) { e.stopPropagation(); adjustProfileStoreItemQuantity(item, qtyBtn.dataset.delta === '-1' ? -1 : 1); return; }
      if (e.target.closest('.profile-qty-stepper')) return;
      openProductDetail(item, false);
    });
  }
  state._storeItemsById = _storeItemsById;
  const frag = document.createDocumentFragment();
  items.forEach(item => {
    const card = createEl('div', 'profile-store-item');
    card.dataset.productId = String(item.id || '');
    // Card click handled via delegation on profileStoreList

    const img = createEl('img', '');
    lazyImg(img, normalizeMediaUrl(item.image || item.imageUrl) || '');
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
      side.appendChild(btn);
    }else{
      const stepper = createEl('div', 'profile-qty-stepper');
      const minus = createEl('button', 'qty-btn', '−');
      minus.type = 'button'; minus.dataset.delta = '-1';
      minus.disabled = qty <= 0;
      const qtyText = createEl('span', 'qty-num', String(qty));
      const plus = createEl('button', 'qty-btn primary', '+');
      plus.type = 'button'; plus.dataset.delta = '1';
      stepper.append(minus, qtyText, plus);
      side.appendChild(stepper);
    }

    card.append(img, info, side);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
  updateProfileCartBar();
});

function openProductSpecSheet(item, mode = 'cart'){
  if(!item) return;
  state.selectedProfileProduct = item;
  state.specSheetQty = 1;
  state.specSheetMode = mode;
  const specs = Array.isArray(item.specs) && item.specs.length ? item.specs : ['默认规格'];
  state.selectedProfileSpec = specs[0];
  const _ssImg = $("specSheetImage");
  if(_ssImg) _ssImg.src = normalizeMediaUrl(item.image || item.imageUrl) || '';
  setText("specSheetTitle", item.title || '商品');
  setText("specSheetDesc", item.desc || '商品详情页包含图片、文字与价格');
  setText("specSheetPrice", formatMoney(item.price));
  const list = $("specOptionsList");
  if(list){
    const frag = document.createDocumentFragment();
    specs.forEach(spec => {
      const chip = createEl('button', 'spec-option-chip' + (spec === state.selectedProfileSpec ? ' active' : ''), spec);
      chip.type = 'button';
      frag.appendChild(chip);
    });
    list.replaceChildren(frag);
    // Single delegated click handler instead of per-chip listeners
    list.onclick = (e) => {
      const chip = e.target.closest('.spec-option-chip');
      if (!chip) return;
      state.selectedProfileSpec = chip.textContent;
      const chips = list.children;
      for (let ci = 0; ci < chips.length; ci++) chips[ci].classList.toggle('active', chips[ci] === chip);
    };
  }
  // Reset quantity UI
  setText("specSheetQtyNum", '1');
  const _ssQtyMinus = $("specSheetQtyMinus");
  if(_ssQtyMinus) _ssQtyMinus.disabled = true;
  // Toggle cart vs buy-now buttons
  toggleEl("confirmAddToCartBtn", 'hidden', mode === 'buyNow');
  toggleEl("confirmBuyNowBtn", 'hidden', mode !== 'buyNow');
  // Disable action buttons when out of stock
  const specSheetStock = getItemAvailableStock(item);
  const _ssAddCart = $("confirmAddToCartBtn");
  const _ssBuyNow = $("confirmBuyNowBtn");
  const _ssQtyPlus = $("specSheetQtyPlus");
  if(_ssAddCart) _ssAddCart.disabled = specSheetStock <= 0;
  if(_ssBuyNow) _ssBuyNow.disabled = specSheetStock <= 0;
  if(_ssQtyPlus) _ssQtyPlus.disabled = specSheetStock <= 0;
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
  invalidateCartQtyCache();
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
  invalidateCartQtyCache();
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
  let sum = 0;
  for (let i = 0; i < cart.length; i++) sum += (Number(cart[i].unitPrice) || 0) * (Number(cart[i].quantity) || 0);
  return sum;
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
    const _sName = (!profile && state.sellerNameCache) ? (state.sellerNameCache.get(sellerId) || '') : '';
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
    let count = 0; for (let ci = 0; ci < currentCart.length; ci++) count += Number(currentCart[ci].quantity) || 0;
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
      lazyImg(img, imgUrl);
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
      const currentQty = Number(item.quantity) || 1;
      const productInStore = (state._storeItemsById || new Map()).get(String(item.productId));
      const availableStock = productInStore ? getItemAvailableStock(productInStore) : Infinity;
      if (currentQty >= availableStock) { showToast('库存不足'); return; }
      item.quantity = currentQty + 1;
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
  // Use Object.keys loop to avoid Object.entries allocation
  const _cart = state.profileCartBySeller || {};
  const groups = [];
  for (const sid of Object.keys(_cart)) {
    const arr = _cart[sid];
    if (Array.isArray(arr) && arr.length) groups.push([sid, arr]);
  }
  const sig = groups.map(([sid, arr]) => sid + ':' + arr.map(i => i.productId + ',' + (i.quantity||0)).join('|')).join(';');
  if (!sigChanged('cartHub', sig)) return;
  if(!groups.length){
    showEmptyState(list, '暂无待结算商品');
    return;
  }
  const frag = document.createDocumentFragment();
  groups.forEach(([sellerId, arr]) => {
    const profile = sellerId === state.currentProfileUser?.id ? state.currentProfileUser : null;
    const knownSeller = state.sellerNameCache?.get(sellerId) || '';
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
