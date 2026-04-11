/* app_shopping.js — Cart, checkout & profile store extracted from app.js */

function sumCartTotals(items) {
  let count = 0, totalCents = 0;
  for (let i = 0; i < items.length; i++) { const q = Number(items[i].quantity)||0; count += q; totalCents += Math.round((Number(items[i].unitPrice)||0)*100)*q; }
  return { count, total: totalCents / 100 };
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

function _buildStoreItemCard(item) {
  const card = createEl('div', 'profile-store-item');
  card.dataset.productId = String(item.id || '');

  const imgSrc = normalizeMediaUrl(item.image || item.imageUrl) || '';
  const fallbackChar = firstChar(item.title || '商品');
  let imgNode;
  if (imgSrc) {
    imgNode = createEl('img', 'profile-store-img');
    imgNode.alt = item.title || '商品';
    imgNode.onerror = function() {
      const placeholder = createEl('div', 'profile-store-img profile-store-img-placeholder', fallbackChar);
      this.replaceWith(placeholder);
    };
    lazyImg(imgNode, imgSrc);
  } else {
    imgNode = createEl('div', 'profile-store-img profile-store-img-placeholder', fallbackChar);
  }

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

  card.append(imgNode, info, side);
  return card;
}

function _bindStoreListClick(listEl) {
  if (listEl.dataset.storeClickBound === '1') return;
  listEl.dataset.storeClickBound = '1';
  listEl.addEventListener('click', (e) => {
    const card = e.target.closest('.profile-store-item[data-product-id]');
    if (!card) return;
    const item = state._storeItemsById?.get(card.dataset.productId);
    if (!item) return;
    const specBtn = e.target.closest('.secondary-btn');
    if (specBtn) { e.stopPropagation(); openProductSpecSheet(item); return; }
    const qtyBtn = e.target.closest('.qty-btn');
    if (qtyBtn) { e.stopPropagation(); adjustProfileStoreItemQuantity(item, qtyBtn.dataset.delta === '-1' ? -1 : 1); return; }
    if (e.target.closest('.profile-qty-stepper')) return;
    openProductDetail(item, false);
  });
}

const renderProfileStore = safeRender(function renderProfileStore(){
  const splitView = $("profileStoreSplitView");
  const sidebar = $("profileStoreCategorySidebar");
  const list = $("profileStoreList");
  const listNocat = $("profileStoreListNocat");
  const rightPanel = $("profileStoreRightPanel");
  const title = $("profileStoreTitle");
  const moreBtn = $("profileStoreMoreBtn");
  if(!list && !listNocat) return;
  const _psi = state.profileStoreItems || [];
  const _sigParts = new Array(_psi.length);
  for (let i = 0; i < _psi.length; i++) { const it = _psi[i]; _sigParts[i] = it.id+'|'+(it.listed?'1':'0')+'|'+it.stock+'|'+(it.createdAt||0)+'|'+getProfileStoreItemCartQuantity(it); }
  const sig = _sigParts.join(';') + '|' + state.profileStoreCategoryFilter + '|' + (state.profileStoreExpanded?'1':'0');
  if (!sigChanged('profileStore', sig)) return;
  const sortedItems = (state.profileStoreItems || []);
  sortedItems.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  // Single-pass: cache parsed categories and collect unique categories
  const cats = new Set();
  const catOrder = [];
  for (const item of sortedItems) {
    if (item.category && !item._parsedCats) item._parsedCats = _splitCategories(item.category);
    if (item._parsedCats && !item._parsedCatsSet) item._parsedCatsSet = new Set(item._parsedCats);
    if (item._parsedCats) for (let ci = 0; ci < item._parsedCats.length; ci++) {
      const c = item._parsedCats[ci];
      if (!cats.has(c)) { cats.add(c); catOrder.push(c); }
    }
  }

  const hasCats = cats.size > 0;
  if(title) title.textContent = `在售商品 ${sortedItems.length}`;

  if(!sortedItems.length){
    if(splitView) splitView.classList.add('hidden');
    if(listNocat) { listNocat.style.display = ''; showEmptyState(listNocat, '暂无在售商品'); }
    if(moreBtn) moreBtn.classList.add('hidden');
    updateProfileCartBar();
    return;
  }

  // Build product lookup
  const _storeItemsById = new Map();
  for (const p of sortedItems) if (p.id) _storeItemsById.set(String(p.id), p);
  state._storeItemsById = _storeItemsById;

  if (hasCats) {
    // --- Split view mode (food-delivery style) ---
    if(splitView) splitView.classList.remove('hidden');
    if(listNocat) listNocat.style.display = 'none';
    if(moreBtn) moreBtn.classList.add('hidden');

    // Group items by category
    const grouped = new Map();
    grouped.set('全部', []);
    for (const cat of catOrder) grouped.set(cat, []);
    const uncategorized = [];
    for (const item of sortedItems) {
      if (item._parsedCats && item._parsedCats.length) {
        for (const c of item._parsedCats) {
          const arr = grouped.get(c);
          if (arr) arr.push(item);
        }
      } else {
        uncategorized.push(item);
      }
    }
    if (uncategorized.length) { catOrder.push('其他'); grouped.set('其他', uncategorized); }

    // Build sidebar with "全部" as default first option
    const allCatOrder = ['全部', ...catOrder];
    if (sidebar) {
      const activeCat = state.profileStoreCategoryFilter || '全部';
      const sidebarFrag = document.createDocumentFragment();
      allCatOrder.forEach(cat => {
        const btn = createEl('button', 'profile-store-cat-item' + (cat === activeCat ? ' active' : ''), cat);
        btn.type = 'button';
        btn.dataset.cat = cat;
        sidebarFrag.appendChild(btn);
      });
      sidebar.replaceChildren(sidebarFrag);

      // Delegated click on sidebar
      if (!sidebar.dataset.delegated) {
        sidebar.dataset.delegated = '1';
        sidebar.addEventListener('click', (e) => {
          const btn = e.target.closest('.profile-store-cat-item');
          if (!btn) return;
          const cat = btn.dataset.cat || '';
          state.profileStoreCategoryFilter = cat;
          // Highlight active
          const items = sidebar.children;
          for (let i = 0; i < items.length; i++) items[i].classList.toggle('active', items[i] === btn);
          // Scroll sidebar item into view
          btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          // Re-render right panel with filtered items
          _sigCache.delete('profileStore');
          renderProfileStore();
        });
      }
    }

    // Build right panel with grouped items, filtered by selected category
    const activeCatFilter = state.profileStoreCategoryFilter || '全部';
    if (list) {
      const frag = document.createDocumentFragment();
      if (activeCatFilter === '全部') {
        // Show all items grouped by category
        catOrder.forEach(cat => {
          const catItems = grouped.get(cat) || [];
          if (!catItems.length) return;
          const header = createEl('div', 'profile-store-group-header', cat);
          header.dataset.catGroup = cat;
          frag.appendChild(header);
          catItems.forEach(item => frag.appendChild(_buildStoreItemCard(item)));
        });
      } else {
        // Show only items in the selected category
        const catItems = grouped.get(activeCatFilter) || [];
        catItems.forEach(item => frag.appendChild(_buildStoreItemCard(item)));
      }
      list.replaceChildren(frag);
      _bindStoreListClick(list);
    }
  } else {
    // --- No categories: flat list (original style) ---
    if(splitView) splitView.classList.add('hidden');
    if(listNocat) listNocat.style.display = '';
    const allItems = sortedItems;
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
    items.forEach(item => frag.appendChild(_buildStoreItemCard(item)));
    listNocat.replaceChildren(frag);
    _bindStoreListClick(listNocat);
  }
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
  // Auto-navigate back to profile page after adding to cart from product detail
  if (state.secondaryPage === 'productDetailPage') {
    const backBtn = $("backBtn");
    if (backBtn) backBtn.click();
  }
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
  const key = `${item.id}__${spec}`;
  const cart = getCurrentSellerCart(sellerId);
  const found = cart.find(i => i.key === key);
  const existingQty = found ? (Number(found.quantity) || 0) : 0;
  if(existingQty + addQty > availableStock){ showToast('库存不足'); return; }
  invalidateCartQtyCache();
  // Add to cart then navigate to checkout
  if(found){
    found.quantity = existingQty + addQty;
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

  // Seller info header with avatar and prominent name
  const sellerInfo = $("profileCartSellerInfo");
  if(sellerInfo){
    const profile = sellerId === state.currentProfileUser?.id ? state.currentProfileUser : null;
    const _sName = (!profile && state.sellerNameCache) ? (state.sellerNameCache.get(sellerId) || '') : '';
    const sellerName = profile?.displayName || profile?.nickname || _sName || `商家 ${sellerId.slice(-6)}`;
    const sellerAvatarUrl = profile?.avatarUrl || '';
    sellerInfo.replaceChildren();
    const sellerUserObj = { avatarUrl: sellerAvatarUrl, displayName: sellerName };
    const avatarNode = createAvatarNode(sellerUserObj, sellerName);
    avatarNode.classList.add('checkout-seller-avatar');
    const nameNode = createEl('span', 'checkout-seller-name', sellerName);
    sellerInfo.append(avatarNode, nameNode);
    sellerInfo.classList.toggle('hidden', !sellerId);
    // Fetch seller profile for avatar if not already loaded
    if (!sellerAvatarUrl && sellerId) {
      api(`/api/users/${encodeURIComponent(sellerId)}/profile?viewerId=${encodeURIComponent(state.currentUser?.id || '')}`).then(data => {
        if (data?.profile?.avatarUrl) {
          const freshAvatar = createAvatarNode({ avatarUrl: data.profile.avatarUrl, displayName: data.profile.nickname || sellerName }, sellerName);
          freshAvatar.classList.add('checkout-seller-avatar');
          const oldAvatar = sellerInfo.querySelector('.checkout-seller-avatar');
          if (oldAvatar) oldAvatar.replaceWith(freshAvatar);
          // Update name if available
          if (data.profile.nickname) nameNode.textContent = data.profile.nickname;
        }
      }).catch(() => {});
    }
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
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const detail = {
        id: item.productId, title: item.title, desc: item.desc || '',
        image: item.image || '', price: item.unitPrice,
        specs: item.spec ? [item.spec] : [], sellerId: item.sellerId
      };
      openProductDetail(detail, false);
    });
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
    // Only allow price editing for the seller, not the buyer
    const isSeller = state.currentUser?.id === sellerId;
    if (isSeller) {
      priceLabel.addEventListener('click', editPrice);
      const priceEditBtn = createEl('button', 'checkout-price-edit-btn', '改价');
      priceEditBtn.type = 'button';
      priceEditBtn.addEventListener('click', editPrice);
      priceWrap.append(priceLabel, priceEditBtn);
    } else {
      priceLabel.classList.remove('checkout-price-editable');
      priceLabel.title = '';
      priceWrap.append(priceLabel);
    }

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
      const availableStock = productInStore ? getItemAvailableStock(productInStore) : 999;
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
    const navigateToCart = () => {
      state.currentCartSellerId = sellerId;
      renderProfileCartPage();
      window.openSecondaryPage('profileCartPage', 'cartHubPage');
    };
    goBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateToCart();
    });
    card.addEventListener('click', navigateToCart);
    line.appendChild(createEl('span', ''));
    line.appendChild(goBtn);
    card.append(head, sub, line);
    frag.appendChild(card);
  });
  list.replaceChildren(frag);
}

// --- Real-time cart sync when product changes arrive via SSE ---
function syncCartWithProductChanges(data) {
  if (!data || !state.profileCartBySeller) return;
  const sellerId = data.sellerId;
  if (!sellerId) return;
  const cart = state.profileCartBySeller[sellerId];
  if (!Array.isArray(cart) || !cart.length) return;

  const alerts = [];

  // Handle single-product changes (from updateProduct)
  if (data.productId && data.changes) {
    const ch = data.changes;
    for (let i = cart.length - 1; i >= 0; i--) {
      const item = cart[i];
      if (String(item.productId) !== String(data.productId)) continue;

      if (ch.listed === false) {
        alerts.push(`"${item.title}" 已下架`);
        cart.splice(i, 1);
        continue;
      }
      if (ch.price !== undefined) {
        const newPrice = Number(String(ch.price).replace(/[^\d.]/g, '')) || 0;
        if (item.unitPrice !== newPrice) {
          alerts.push(`"${item.title}" 价格变为 ${ch.price}`);
          item.unitPrice = newPrice;
        }
      }
      if (ch.stock !== undefined) {
        const newStock = Math.max(0, Math.floor(Number(ch.stock)));
        if (item.quantity > newStock) {
          if (newStock <= 0) {
            alerts.push(`"${item.title}" 已无库存`);
            cart.splice(i, 1);
          } else {
            alerts.push(`"${item.title}" 库存不足，数量已调整为 ${newStock}`);
            item.quantity = newStock;
          }
        }
      }
    }
  }

  // Handle bulk stock updates (from order creation by other buyers)
  if (Array.isArray(data.stockUpdates)) {
    for (const su of data.stockUpdates) {
      const newStock = Math.max(0, Math.floor(Number(su.stock)));
      for (let i = cart.length - 1; i >= 0; i--) {
        const item = cart[i];
        if (String(item.productId) !== String(su.productId)) continue;
        if (item.quantity > newStock) {
          if (newStock <= 0) {
            alerts.push(`"${item.title}" 已无库存`);
            cart.splice(i, 1);
          } else {
            alerts.push(`"${item.title}" 库存不足，数量已调整为 ${newStock}`);
            item.quantity = newStock;
          }
        }
      }
    }
  }

  if (alerts.length) {
    invalidateCartQtyCache();
    updateProfileCartBar();
    renderProfileCartPage();
    renderProfileStore();
    showToast(alerts.join('；'));
  }
}

// --- Pre-submit validation: fetch latest product data and compare with cart ---
async function preCheckCartBeforeSubmit(sellerId) {
  const cart = getCurrentSellerCart(sellerId);
  if (!cart.length) return { ok: false, reason: '购物车为空' };

  let storeItems;
  try {
    const data = await api(`/api/users/${encodeURIComponent(sellerId)}/store`);
    storeItems = data.items || [];
  } catch (e) {
    return { ok: true }; // Network error — let server-side validation handle it
  }

  const productMap = new Map();
  for (const p of storeItems) if (p.id) productMap.set(String(p.id), p);

  const warnings = [];
  for (let i = cart.length - 1; i >= 0; i--) {
    const item = cart[i];
    const product = productMap.get(String(item.productId));

    if (!product) {
      warnings.push(`"${item.title}" 已下架或不存在`);
      cart.splice(i, 1);
      continue;
    }

    // Sync price
    const currentPrice = Number(String(product.price).replace(/[^\d.]/g, '')) || 0;
    if (Math.abs((item.unitPrice || 0) - currentPrice) > 0.001) {
      warnings.push(`"${item.title}" 价格已变更：${formatMoney(item.unitPrice)} → ${formatMoney(currentPrice)}`);
      item.unitPrice = currentPrice;
    }

    // Check stock
    const stock = Math.max(0, Math.floor(Number(product.stock || 0)));
    if (item.quantity > stock) {
      if (stock <= 0) {
        warnings.push(`"${item.title}" 已无库存`);
        cart.splice(i, 1);
      } else {
        warnings.push(`"${item.title}" 库存不足，数量已从 ${item.quantity} 调整为 ${stock}`);
        item.quantity = stock;
      }
    }
  }

  if (warnings.length) {
    invalidateCartQtyCache();
    updateProfileCartBar();
    renderProfileCartPage();
    return { ok: false, reason: warnings.join('\n'), adjusted: true };
  }

  return { ok: true };
}

async function submitProfileOrder(){
  const sellerId = state.currentCartSellerId || state.currentProfileUser?.id || '';
  const currentCart = getCurrentSellerCart(sellerId);
  if(!sellerId || !currentCart.length) return showModal('请先选择商品');

  // Pre-submit validation: check latest prices, stock, and availability
  const preCheck = await preCheckCartBeforeSubmit(sellerId);
  if (!preCheck.ok) {
    if (preCheck.adjusted) {
      // Items were adjusted — show what changed and let user review
      showModal('购物车已更新，请确认后重新提交：\n' + preCheck.reason);
      return;
    }
    showModal(preCheck.reason || '无法提交订单');
    return;
  }

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
    const result = await api('/api/orders', { method:'POST', body: JSON.stringify(payload) });

    // Alert user if server used different prices than what they saw
    if (result.priceChanged) {
      showToast('注意：部分商品价格在下单时已变更，以实际订单金额为准');
    }

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
    // Navigate to order detail page, replacing checkout page in the navigation stack
    if (result.order) {
      state.selectedOrderDetail = result.order;
      state.selectedOrderRole = 'buyer';
      renderOrderDetailPage();
      const backTo = state.secondaryReturn || (state.activeConversation ? 'chat' : 'home');
      window.openSecondaryPage('orderDetailPage', backTo, { replace: true });
    } else {
      const backTo = state.secondaryReturn || (state.activeConversation ? 'chat' : 'home');
      window.openSecondaryPage('buyerOrdersManagePage', backTo, { replace: true });
    }
  }catch(e){
    hideLoading();
    showModal(e.message || '提交订单失败');
  }
}
