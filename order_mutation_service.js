function formatOrderSummary(items = []) {
  return items.map((item) => `${item.title}(${item.spec}) x${item.quantity}`).join('，');
}

function normalizeOrderItems(items = []) {
  return items.map((item) => ({
    productId: item.productId || '',
    title: String(item.title || '').trim() || '商品',
    spec: String(item.spec || '默认规格').trim(),
    quantity: Math.max(1, Number(item.quantity || 1)),
    price: Math.max(0, Number(item.price || 0)),
  }));
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
  const aBlacklist = Array.isArray(userA?.blacklist) ? userA.blacklist : [];
  const bBlacklist = Array.isArray(userB?.blacklist) ? userB.blacklist : [];
  if (!userA || !userB) return false;
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
    summary: formatOrderSummary(order.items || []),
    total: order.total,
    status: order.status,
    priceAdjustmentLocked: !!order.priceAdjustmentLocked,
    pendingPrice: order.pendingPrice ?? null,
    pendingPriceRequestedBy: order.pendingPriceRequestedBy || null,
    ...extras,
  };
}

function createOrder({ authUser, body, db, usersById, uid, getOrCreateDirectConversation, addTradeMessage, schedulePersist, rebuildMallIndex, broadcastAll }) {
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

  const normalized = normalizeOrderItems(items);

  const stockUpdates = [];
  for (const item of normalized) {
    const sellerProduct = (seller.products || []).find((p) => String(p.id || '') === String(item.productId || ''));
    if (!sellerProduct) continue;
    const currentStock = Math.max(0, Math.floor(Number(sellerProduct.stock ?? 0)));
    if (currentStock < item.quantity) {
      return { ok: false, status: 409, error: 'insufficient_stock' };
    }
    stockUpdates.push({ sellerProduct, nextStock: currentStock - item.quantity });
  }

  stockUpdates.forEach(({ sellerProduct, nextStock }) => {
    sellerProduct.stock = nextStock;
  });

  const total = normalized.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const now = Date.now();
  const order = {
    id: uid('o'),
    buyerId: authUser.id,
    sellerId: seller.id,
    items: normalized,
    total,
    status: 'accepted',
    createdAt: now,
    updatedAt: now,
    clientRequestId: clientRequestId || null,
    priceAdjustmentLocked: false,
  };
  db.orders.unshift(order);

  const conv = getOrCreateDirectConversation(authUser.id, seller.id);
  addTradeMessage(conv.id, {
    senderId: authUser.id,
    type: 'order_card',
    order: buildOrderCardPayload(order, {
      title: `新订单 · ${seller.displayName || seller.nickname || seller.username}`,
      role: 'buyer',
    }),
  });
  conv.updatedAt = new Date().toISOString();
  if (typeof rebuildMallIndex === 'function') rebuildMallIndex();
  if (typeof broadcastAll === 'function') broadcastAll('mall_updated', {});
  schedulePersist('order_create', { orderId: order.id, buyerId: authUser.id, sellerId: seller.id });
  return { ok: true, status: 201, payload: { order, deduplicated: false } };
}

function updateOrderPrice({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist }) {
  const order = (db.orders || []).find((item) => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: false, allowSeller: true });
  if (!actor.ok) return actor;
  if (order.status === 'completed') return { ok: false, status: 409, error: 'order_already_completed' };
  if (order.priceAdjustmentLocked) return { ok: false, status: 409, error: 'price_adjustment_locked' };
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;

  order.total = Math.max(0, Number(body.total || 0));
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
      title: '订单价格已更新',
      role: authUser.id === order.sellerId ? 'seller' : 'buyer',
    }),
  });
  conv.updatedAt = new Date().toISOString();
  schedulePersist('order_update_price', { orderId: order.id });
  return { ok: true, status: 200, payload: { order } };
}

function updateOrderStatus({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist }) {
  const order = (db.orders || []).find((item) => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: true, allowSeller: false });
  if (!actor.ok) return actor;
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;

  const nextStatus = String(body.status || '').trim();
  if (nextStatus !== 'completed') return { ok: false, status: 400, error: 'invalid_status_transition' };
  if (order.status === 'completed') {
    return { ok: true, status: 200, payload: { order, deduplicated: true } };
  }

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
  conv.updatedAt = new Date().toISOString();
  schedulePersist('order_update_status', { orderId: order.id, status: order.status });
  return { ok: true, status: 200, payload: { order, deduplicated: false } };
}


function requestOrderPriceChange({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist }) {
  const order = (db.orders || []).find((item) => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: true, allowSeller: false });
  if (!actor.ok) return actor;
  if (order.status === 'completed') return { ok: false, status: 409, error: 'order_already_completed' };
  if (order.priceAdjustmentLocked) return { ok: false, status: 409, error: 'price_adjustment_locked' };
  if (order.pendingPriceRequestedBy) return { ok: false, status: 409, error: 'pending_price_request_exists' };
  const requestedTotal = Math.max(0, Number(body.total || 0));
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
  conv.updatedAt = new Date().toISOString();
  schedulePersist('order_price_request', { orderId: order.id });
  return { ok: true, status: 200, payload: { order } };
}

function confirmOrderPriceChange({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist }) {
  const order = (db.orders || []).find((item) => item.id === orderId);
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: false, allowSeller: true });
  if (!actor.ok) return actor;
  if (order.status === 'completed') return { ok: false, status: 409, error: 'order_already_completed' };
  if (order.priceAdjustmentLocked) return { ok: false, status: 409, error: 'price_adjustment_locked' };
  if (!order.pendingPriceRequestedBy) return { ok: false, status: 409, error: 'no_pending_price_request' };
  if (order.pendingPriceRequestedBy === authUser.id) return { ok: false, status: 409, error: 'cannot_confirm_own_request' };
  const confirmedTotal = Math.max(0, Number(body.total || order.pendingPrice || order.total || 0));
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
  conv.updatedAt = new Date().toISOString();
  schedulePersist('order_price_confirm', { orderId: order.id });
  return { ok: true, status: 200, payload: { order } };
}

module.exports = {
  createOrder,
  updateOrderPrice,
  updateOrderStatus,
  requestOrderPriceChange,
  confirmOrderPriceChange,
};
