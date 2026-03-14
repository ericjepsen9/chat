const { formatOrderSummary, findOrderById } = require('./order_utils');

const MAX_ORDER_TOTAL = 10_000_000; // 1000万 upper bound for order totals
const RE_NON_NUMERIC = /[^\d.]/g;

function clampOrderTotal(value) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? Math.max(0, Math.min(num, MAX_ORDER_TOTAL)) : 0;
}

function parseProductPrice(value) {
  const cleaned = String(value ?? '').replace(RE_NON_NUMERIC, '');
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
  if (userA._blacklistSet) { if (userA._blacklistSet.has(userB.id)) return true; }
  else if (Array.isArray(userA.blacklist) && userA.blacklist.includes(userB.id)) return true;
  if (userB._blacklistSet) return userB._blacklistSet.has(userA.id);
  return Array.isArray(userB.blacklist) && userB.blacklist.includes(userA.id);
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

function buildOrderCardPayload(order, extras) {
  const items = order.items || [];
  const payload = {
    id: order.id,
    buyerId: order.buyerId,
    sellerId: order.sellerId,
    items: items,
    summary: formatOrderSummary(items),
    total: order.total,
    status: order.status,
    createdAt: order.createdAt || null,
    remark: order.remark || '',
    priceAdjustmentLocked: !!order.priceAdjustmentLocked,
    pendingPrice: order.pendingPrice ?? null,
    pendingPriceRequestedBy: order.pendingPriceRequestedBy || null,
  };
  // Assign extras directly instead of spread to avoid object copy overhead
  if (extras) {
    if (extras.title !== undefined) payload.title = extras.title;
    if (extras.role !== undefined) payload.role = extras.role;
  }
  return payload;
}

function addToMapArray(map, key, value) {
  if (!map) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function createOrder({ authUser, body, db, usersById, uid, getOrCreateDirectConversation, addTradeMessage, schedulePersist, rebuildMallIndex, broadcastAll, ordersById, ordersByBuyer, ordersBySeller }) {
  const seller = usersById.get(body.sellerId);
  if (!seller) return { ok: false, status: 404, error: 'not_found' };
  if (seller.id === authUser.id) return { ok: false, status: 400, error: 'cannot_buy_own_product' };
  if (isUserBlockedByCounterparty(authUser, seller)) return { ok: false, status: 403, error: 'trade_blocked' };
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return { ok: false, status: 400, error: 'empty_items' };

  if (!Array.isArray(db.orders)) db.orders = [];
  const clientRequestId = resolveClientRequestId(body.clientRequestId);
  if (clientRequestId) {
    // Use buyer's order index for O(buyerOrders) dedup instead of O(allOrders)
    const buyerOrders = ordersByBuyer.get(authUser.id) || [];
    const existing = buyerOrders.find((o) => o.sellerId === seller.id
      && String(o.clientRequestId || '') === clientRequestId);
    if (existing) {
      return { ok: true, status: 200, payload: { order: existing, deduplicated: true } };
    }
  }

  // Build product-by-id map and spec sets once for O(1) lookups
  const productById = new Map();
  const specSetByProduct = new Map();
  for (const p of (seller.products || [])) {
    const pid = String(p.id || '');
    productById.set(pid, p);
    if (Array.isArray(p.specs)) {
      const specSet = new Set();
      for (let si = 0; si < p.specs.length; si++) { if (p.specs[si]) specSet.add(p.specs[si]); }
      if (specSet.size) specSetByProduct.set(pid, specSet);
    }
  }

  const normalized = [];
  const neededByProduct = new Map();
  for (const rawItem of items) {
    const reqItem = normalizeOrderItemRequest(rawItem);
    if (!reqItem.productId) return { ok: false, status: 400, error: 'invalid_product_id' };
    const sellerProduct = productById.get(reqItem.productId);
    if (!sellerProduct) return { ok: false, status: 404, error: 'product_not_found' };

    const specSet = specSetByProduct.get(reqItem.productId);
    if (specSet && !specSet.has(reqItem.spec)) {
      return { ok: false, status: 409, error: 'invalid_spec' };
    }

    const safeSpec = specSet ? reqItem.spec : '默认规格';
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

  // Validate stock availability before any mutations
  const stockUpdates = [];
  for (const [productId, neededQty] of neededByProduct.entries()) {
    const sellerProduct = productById.get(String(productId));
    if (!sellerProduct) return { ok: false, status: 404, error: 'product_not_found' };
    const currentStock = Math.max(0, Math.floor(Number(sellerProduct.stock ?? 0)));
    if (currentStock < neededQty) return { ok: false, status: 409, error: 'insufficient_stock' };
    stockUpdates.push({ sellerProduct, nextStock: currentStock - neededQty });
  }

  const total = clampOrderTotal(normalized.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const remark = String(body.remark || '').trim().slice(0, 200) || '';
  const now = Date.now();
  const order = {
    id: uid('order'),
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

  // Apply stock deduction and order insertion together after all validation passes
  for (let i = 0; i < stockUpdates.length; i++) {
    stockUpdates[i].sellerProduct.stock = stockUpdates[i].nextStock;
  }
  db.orders.unshift(order);
  if (ordersById) ordersById.set(order.id, order);
  if (order.buyerId) addToMapArray(ordersByBuyer, order.buyerId, order);
  if (order.sellerId) addToMapArray(ordersBySeller, order.sellerId, order);

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
  const order = findOrderById(orderId, { ordersById, db });
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
  const order = findOrderById(orderId, { ordersById, db });
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: false, allowSeller: true });
  if (!actor.ok) return actor;
  if (order.status === 'completed') return { ok: false, status: 409, error: 'order_already_completed' };
  if (order.status === 'accepted') return { ok: false, status: 409, error: 'price_change_not_allowed_after_accepted' };
  if (order.priceAdjustmentLocked) return { ok: false, status: 409, error: 'price_adjustment_locked' };
  if (order.pendingPriceRequestedBy) return { ok: false, status: 409, error: 'pending_price_request_exists' };
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;

  order.total = clampOrderTotal(body.total);
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

// Hoisted constants — avoid re-creating on every call
const _STATUS_TITLES = { completed: '订单已完成', processing: '订单处理中', in_progress: '订单进行中', accepted: '订单已接受' };

// Allowed status transitions: currentStatus -> Set of valid nextStatuses
const ALLOWED_TRANSITIONS = {
  pending:     new Set(['accepted']),
  accepted:    new Set(['completed', 'processing', 'in_progress']),
  processing:  new Set(['completed']),
  in_progress: new Set(['completed']),
};

function updateOrderStatus({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist, ordersById }) {
  const order = findOrderById(orderId, { ordersById, db });
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: true, allowSeller: true });
  if (!actor.ok) return actor;
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;

  const nextStatus = String(body.status || '').trim();
  if (order.status === nextStatus) {
    return { ok: true, status: 200, payload: { order, deduplicated: true } };
  }
  const allowed = ALLOWED_TRANSITIONS[order.status];
  if (!allowed || !allowed.has(nextStatus)) {
    return { ok: false, status: 400, error: 'invalid_status_transition' };
  }

  order.status = nextStatus;
  order.updatedAt = Date.now();

  const STATUS_TITLES = _STATUS_TITLES;
  const conv = getOrCreateDirectConversation(order.buyerId, order.sellerId);
  addTradeMessage(conv.id, {
    senderId: authUser.id,
    type: 'order_card',
    order: buildOrderCardPayload(order, {
      title: STATUS_TITLES[nextStatus] || '订单状态更新',
      role: authUser.id === order.sellerId ? 'seller' : 'buyer',
    }),
  });
  conv.updatedAt = Date.now();
  schedulePersist('order_update_status', { orderId: order.id, status: order.status });
  return { ok: true, status: 200, payload: { order, deduplicated: false } };
}


const PRICE_REQUEST_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between price change requests per order

function requestOrderPriceChange({ authUser, orderId, body, db, usersById, getOrCreateDirectConversation, addTradeMessage, schedulePersist, ordersById }) {
  const order = findOrderById(orderId, { ordersById, db });
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: true, allowSeller: false });
  if (!actor.ok) return actor;
  if (order.status === 'completed') return { ok: false, status: 409, error: 'order_already_completed' };
  if (order.status === 'pending') return { ok: false, status: 409, error: 'order_not_accepted_yet' };
  if (order.priceAdjustmentLocked) return { ok: false, status: 409, error: 'price_adjustment_locked' };
  if (order.pendingPriceRequestedBy) return { ok: false, status: 409, error: 'pending_price_request_exists' };
  // Rate limit: prevent spamming price change requests
  if (order._lastPriceRequestAt && (Date.now() - order._lastPriceRequestAt) < PRICE_REQUEST_COOLDOWN_MS) {
    return { ok: false, status: 429, error: 'price_request_too_frequent' };
  }
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;
  const requestedTotal = clampOrderTotal(body.total);
  const nowPr = Date.now();
  order.pendingPrice = requestedTotal;
  order.pendingPriceRequestedBy = authUser.id;
  order.updatedAt = nowPr;
  order._lastPriceRequestAt = nowPr;
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
  const order = findOrderById(orderId, { ordersById, db });
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: false, allowSeller: true });
  if (!actor.ok) return actor;
  if (order.status === 'completed') return { ok: false, status: 409, error: 'order_already_completed' };
  if (order.priceAdjustmentLocked) return { ok: false, status: 409, error: 'price_adjustment_locked' };
  if (!order.pendingPriceRequestedBy) return { ok: false, status: 409, error: 'no_pending_price_request' };
  if (order.pendingPriceRequestedBy === authUser.id) return { ok: false, status: 409, error: 'cannot_confirm_own_request' };
  const versionError = assertOrderVersion(order, body.expectedUpdatedAt);
  if (versionError) return versionError;
  const confirmedTotal = clampOrderTotal(order.pendingPrice);
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
  const order = findOrderById(orderId, { ordersById, db });
  if (!order) return { ok: false, status: 404, error: 'not_found' };
  const actor = validateOrderActor(order, authUser, usersById, { allowBuyer: true, allowSeller: true });
  if (!actor.ok) return actor;
  if (order.status !== 'completed') return { ok: false, status: 409, error: 'order_not_completed' };
  if (!Array.isArray(order.deletedBy)) order.deletedBy = [];
  if (!order._deletedBySet) order._deletedBySet = new Set(order.deletedBy);
  if (!order._deletedBySet.has(authUser.id)) {
    order.deletedBy.push(authUser.id);
    order._deletedBySet.add(authUser.id);
  }
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
