function formatOrderSummary(items = []) {
  return items.map((item) => `${item.title}(${item.spec}) x${item.quantity}`).join('，');
}

function parseProductPrice(value) {
  const cleaned = String(value ?? '').replace(/[^\d.]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

function normalizeOrderItemRequest(item = {}) {
  const price = Number(item.price);
  return {
    productId: String(item.productId || '').trim(),
    spec: String(item.spec || '默认规格').trim() || '默认规格',
    quantity: Math.max(1, Math.floor(Number(item.quantity || 1))),
    price: Number.isFinite(price) && price >= 0 ? price : null,
  };
}

function resolveClientRequestId(value) {
  const id = String(value || '').trim();
  return id ? id.slice(0, 80) : '';
}

function assertOrderVersion(order, expectedUpdatedAtRaw) {
  if (expectedUpdatedAtRaw === undefined || expectedUpdatedAtRaw === null || expectedUpdatedAtRaw === '') return null;
  const expected = Number(expectedUpdatedAtRaw);
  if (!Number.isFinite(expected) || expected <= 0) return { ok: false, status: 400, error: 'invalid_expected_updated_at' };
  if (Number(order.updatedAt || 0) !== expected) return { ok: false, status: 409, error: 'order_version_conflict' };
  return null;
}


function isUserBlockedByCounterparty(userA, userB) {
  if (!userA || !userB) return false;
  const aBlacklist = Array.isArray(userA.blacklist) ? userA.blacklist : [];
  const bBlacklist = Array.isArray(userB.blacklist) ? userB.blacklist : [];
  return aBlacklist.includes(userB.id) || bBlacklist.includes(userA.id);
}

function validateOrderActor(order, authUser, usersById, { allowBuyer = true, allowSeller = true } = {}) {
  const isBuyer = order.buyerId === authUser.id;
  const isSeller = order.sellerId === authUser.id;
  if (!isBuyer && !isSeller) return { ok: false, status: 403, error: 'forbidden' };
  if (isBuyer && !allowBuyer) return { ok: false, status: 403, error: 'forbidden' };
  if (isSeller && !allowSeller) return { ok: false, status: 403, error: 'forbidden' };
  const buyer = usersById?.get(order.buyerId);
  const seller = usersById?.get(order.sellerId);
  if (isUserBlockedByCounterparty(buyer, seller)) return { ok: false, status: 403, error: 'trade_blocked' };
  return { ok: true, isBuyer, isSeller, buyer, seller };
}

function buildOrderCardPayload(order, extras = {}) {
  return {
    id: order.id,
    buyerId: order.buyerId,
    sellerId: order.sellerId,
    items: (order.items || []).map(i => ({
      productId: i.productId,
      title: i.title,
      spec: i.spec,
      quantity: i.quantity,
      price: i.price,
      imageUrl: i.imageUrl || '',
    })),
    summary: formatOrderSummary(order.items || []),
    total: order.total,
    status: order.status,
    createdAt: order.createdAt || null,
    remark: order.remark || '',
    priceAdjustmentLocked: !!order.priceAdjustmentLocked,
    pendingPrice: order.pendingPrice ?? null,
    pendingPriceRequestedBy: order.pendingPriceRequestedBy || null,
    ...extras,
  };
}

function createOrder({ authUser, body, db, usersById, uid, getOrCreateDirectConversation, addTradeMessage, schedulePersist, rebuildMallIndex, broadcastAll, ordersById }) {
  const seller = usersById.get(body.sellerId);
  if (!seller) return { ok: false, status: 404, error: 'not_found' };
  if (isUserBlockedByCounterparty(authUser, seller)) return { ok: false, status: 403, error: 'trade_blocked' };
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return { ok: false, status: 400, error: 'empty_items' };

  if (!Array.isArray(db.orders)) db.orders = [];
  const clientRequestId = resolveClientRequestId(body.clientRequestId);
  if (clientRequestId) {
    const existing = db.orders.find((o) => o.buyerId === authUser.id
      && o.sellerId === seller.id
      && String(o.clientRequestId || '') === clientRequestId);
    if (existing) {
      return { ok: true, status: 200, payload: { order: existing, deduplicated: true } };
    }
  }

  const normalized = [];
  const neededByProduct = new Map();
  for (const rawItem of items) {
    const reqItem = normalizeOrderItemRequest(rawItem);
    if (!reqItem.productId) return { ok: false, status: 400, error: 'invalid_product_id' };
    const sellerProduct = (seller.products || []).find((p) => String(p.id || '') === reqItem.productId);
    if (!sellerProduct) return { ok: false, status: 404, error: 'product_not_found' };

    const availableSpecs = Array.isArray(sellerProduct.specs) ? sellerProduct.specs.filter(Boolean) : [];
    if (availableSpecs.length && !availableSpecs.includes(reqItem.spec)) {
      return { ok: false, status: 409, error: 'invalid_spec' };
    }

    const safeSpec = availableSpecs.length ? reqItem.spec : '默认规格';
    const productPrice = parseProductPrice(sellerProduct.price);
    const unitPrice = productPrice;
    normalized.push({
      productId: sellerProduct.id,
      title: String(sellerProduct.title || '').trim() || '商品',
      spec: safeSpec,
      quantity: reqItem.quantity,
      price: unitPrice,
      imageUrl: sellerProduct.image || '',
    });

    neededByProduct.set(
      sellerProduct.id,
      (neededByProduct.get(sellerProduct.id) || 0) + reqItem.quantity,
    );
  }

  const stockUpdates = [];
  for (const [productId, neededQty] of neededByProduct.entries()) {
    const sellerProduct = (seller.products || []).find((p) => String(p.id || '') === String(productId));
    if (!sellerProduct) return { ok: false, status: 404, error: 'product_not_found' };
    const currentStock = Math.max(0, Math.floor(Number(sellerProduct.stock ?? 0)));
    if (currentStock < neededQty) return { ok: false, status: 409, error: 'insufficient_stock' };
    stockUpdates.push({ sellerProduct, nextStock: currentStock - neededQty });
  }

  stockUpdates.forEach(({ sellerProduct, nextStock }) => {
    sellerProduct.stock = nextStock;
  });

  const total = normalized.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const remark = String(body.remark || '').trim().slice(0, 200) || '';
  const now = Date.now();
  const order = {
    id: String(Date.now()) + String(Math.floor(Math.random() * 900000) + 100000),
    buyerId: authUser.id,
    sellerId: seller.id,
    items: normalized,
    total,
    remark: remark || undefined,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    clientRequestId: clientRequestId || null,
    priceAdjustmentLocked: false,
  };
  db.orders.unshift(order);
  if (ordersById) ordersById.set(order.id, order);

  const conv = getOrCreateDirectConversation(authUser.id, seller.id);
  addTradeMessage(conv.id, {
    senderId: authUser.id,
    type: 'order_card',
    order: buildOrderCardPayload(order, {
      title: `新订单 · ${seller.displayName || seller.nickname || seller.username}`,
      role: 'buyer',
    }),
  });
  conv.updatedAt = Date.now();
  if (typeof rebuildMallIndex === 'function') rebuildMallIndex();
  if (typeof broadcastAll === 'function') broadcastAll('mall_updated', {});
  schedulePersist('order_create', { orderId: order.id, buyerId: authUser.id, sellerId: seller.id });
  return { ok: true, status: 201, payload: { order, deduplicated: false } };
}

function acceptOrder({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist, ordersById }) {
  const order = (ordersById && ordersById.get(orderId)) || (db.orders || []).find((item) => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: false, allowSeller: true });
  if (!actor.ok) return actor;
  if (order.status !== 'pending') return { ok: false, status: 409, error: 'order_not_pending' };
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;

  order.status = 'accepted';
  order.updatedAt = Date.now();

  const conv = getOrCreateDirectConversation(order.buyerId, order.sellerId);
  addTradeMessage(conv.id, {
    senderId: authUser.id,
    type: 'order_card',
    order: buildOrderCardPayload(order, {
      title: '商家已接单',
      role: 'seller',
    }),
  });
  conv.updatedAt = Date.now();
  schedulePersist('order_accept', { orderId: order.id });
  return { ok: true, status: 200, payload: { order } };
}

function updateOrderPrice({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist, ordersById }) {
  const order = (ordersById && ordersById.get(orderId)) || (db.orders || []).find((item) => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: false, allowSeller: true });
  if (!actor.ok) return actor;
  if (order.status === 'completed') return { ok: false, status: 409, error: 'order_already_completed' };
  if (order.status === 'accepted') return { ok: false, status: 409, error: 'price_change_not_allowed_after_accepted' };
  if (order.priceAdjustmentLocked) return { ok: false, status: 409, error: 'price_adjustment_locked' };
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;

  order.total = Math.max(0, Number(body.total ?? 0));
  order.pendingPrice = null;
  order.pendingPriceRequestedBy = null;
  order.updatedAt = Date.now();

  const conv = getOrCreateDirectConversation(order.buyerId, order.sellerId);
  addTradeMessage(conv.id, {
    senderId: authUser.id,
    type: 'order_card',
    order: buildOrderCardPayload(order, {
      title: '订单价格已更新',
      role: authUser.id === order.sellerId ? 'seller' : 'buyer',
    }),
  });
  conv.updatedAt = Date.now();
  schedulePersist('order_update_price', { orderId: order.id });
  return { ok: true, status: 200, payload: { order } };
}

function updateOrderStatus({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist, ordersById }) {
  const order = (ordersById && ordersById.get(orderId)) || (db.orders || []).find((item) => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: true, allowSeller: true });
  if (!actor.ok) return actor;
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;

  const nextStatus = String(body.status || '').trim();
  if (nextStatus !== 'completed') return { ok: false, status: 400, error: 'invalid_status_transition' };
  if (order.status === 'completed') {
    return { ok: true, status: 200, payload: { order, deduplicated: true } };
  }
  if (order.status === 'pending') return { ok: false, status: 409, error: 'order_not_accepted_yet' };

  order.status = 'completed';
  order.updatedAt = Date.now();

  const conv = getOrCreateDirectConversation(order.buyerId, order.sellerId);
  addTradeMessage(conv.id, {
    senderId: authUser.id,
    type: 'order_card',
    order: buildOrderCardPayload(order, {
      title: '订单已完成',
      role: authUser.id === order.sellerId ? 'seller' : 'buyer',
    }),
  });
  conv.updatedAt = Date.now();
  schedulePersist('order_update_status', { orderId: order.id, status: order.status });
  return { ok: true, status: 200, payload: { order, deduplicated: false } };
}


function requestOrderPriceChange({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist, ordersById }) {
  const order = (ordersById && ordersById.get(orderId)) || (db.orders || []).find((item) => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: true, allowSeller: false });
  if (!actor.ok) return actor;
  if (order.status === 'completed') return { ok: false, status: 409, error: 'order_already_completed' };
  if (order.status === 'pending') return { ok: false, status: 409, error: 'order_not_accepted_yet' };
  if (order.priceAdjustmentLocked) return { ok: false, status: 409, error: 'price_adjustment_locked' };
  if (order.pendingPriceRequestedBy) return { ok: false, status: 409, error: 'pending_price_request_exists' };
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;
  const requestedTotal = Math.max(0, Number(body.total ?? 0));
  order.pendingPrice = requestedTotal;
  order.pendingPriceRequestedBy = authUser.id;
  order.updatedAt = Date.now();
  const conv = getOrCreateDirectConversation(order.buyerId, order.sellerId);
  addTradeMessage(conv.id, {
    senderId: authUser.id,
    type: 'order_card',
    order: buildOrderCardPayload(order, {
      title: '订单申请改价',
      role: authUser.id === order.sellerId ? 'seller' : 'buyer',
    }),
  });
  conv.updatedAt = Date.now();
  schedulePersist('order_price_request', { orderId: order.id });
  return { ok: true, status: 200, payload: { order } };
}

function confirmOrderPriceChange({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist, ordersById }) {
  const order = (ordersById && ordersById.get(orderId)) || (db.orders || []).find((item) => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: false, allowSeller: true });
  if (!actor.ok) return actor;
  if (order.status === 'completed') return { ok: false, status: 409, error: 'order_already_completed' };
  if (order.priceAdjustmentLocked) return { ok: false, status: 409, error: 'price_adjustment_locked' };
  if (!order.pendingPriceRequestedBy) return { ok: false, status: 409, error: 'no_pending_price_request' };
  if (order.pendingPriceRequestedBy === authUser.id) return { ok: false, status: 409, error: 'cannot_confirm_own_request' };
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;
  const confirmedTotal = Math.max(0, Number(order.pendingPrice ?? order.total ?? 0));
  order.total = confirmedTotal;
  order.pendingPrice = null;
  order.pendingPriceRequestedBy = null;
  order.updatedAt = Date.now();
  order.status = 'accepted';
  order.priceAdjustmentLocked = true;
  const conv = getOrCreateDirectConversation(order.buyerId, order.sellerId);
  addTradeMessage(conv.id, {
    senderId: authUser.id,
    type: 'order_card',
    order: buildOrderCardPayload(order, {
      title: '订单改价已确认',
      role: authUser.id === order.sellerId ? 'seller' : 'buyer',
    }),
  });
  conv.updatedAt = Date.now();
  schedulePersist('order_price_confirm', { orderId: order.id });
  return { ok: true, status: 200, payload: { order } };
}


function deleteOrder({ authUser, orderId, db, usersById, schedulePersist, ordersById }) {
  const order = (ordersById && ordersById.get(orderId)) || (db.orders || []).find((item) => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: true, allowSeller: true });
  if (!actor.ok) return actor;
  if (order.status !== 'completed') return { ok: false, status: 409, error: 'order_not_completed' };
  if (!Array.isArray(order.deletedBy)) order.deletedBy = [];
  if (!order.deletedBy.includes(authUser.id)) order.deletedBy.push(authUser.id);
  schedulePersist('order_delete', { orderId: order.id, userId: authUser.id });
  return { ok: true, status: 200, payload: { ok: true, orderId: order.id } };
}

module.exports = {
  createOrder,
  acceptOrder,
  updateOrderPrice,
  updateOrderStatus,
  requestOrderPriceChange,
  confirmOrderPriceChange,
  deleteOrder,
};
