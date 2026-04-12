/* server_routes_orders.js — Order route handlers */

const RE_ORDER_ACTION = /^\/api\/orders\/([^/]+)\/(accept|price|price-request|price-confirm|status|ship|delete)$/;

module.exports = function createOrderRoutes(ctx) {
  const {
    matchRoute, sendJson, sendResult,
    getAuthedUser, getAuthedBody,
    queryOrders, createOrder, acceptOrder,
    updateOrderPrice, requestOrderPriceChange, confirmOrderPriceChange,
    updateOrderStatus, shipOrder, deleteOrder,
    getOrCreateDirectConversation, addTradeMessage,
    uid, isAdmin,
    index, db,
    schedulePersist, rebuildMallIndex, broadcastAll,
  } = ctx;

  return async function handleOrderRoutes(pathname, method, req, res, searchParams) {

    if (matchRoute(pathname, '/api/orders') && method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      const data = queryOrders({ db, authUser, searchParams, isAdmin, index });
      // Build view objects with display names to avoid mutating original order objects
      const nameCache = new Map();
      const orders = data.orders.map(o => {
        let buyerName = o.buyerName;
        if (!buyerName) {
          buyerName = nameCache.get(o.buyerId);
          if (buyerName === undefined) { buyerName = index.usersById.get(o.buyerId)?.displayName || ''; nameCache.set(o.buyerId, buyerName); }
        }
        let sellerName = o.sellerName;
        if (!sellerName) {
          sellerName = nameCache.get(o.sellerId);
          if (sellerName === undefined) { sellerName = index.usersById.get(o.sellerId)?.displayName || ''; nameCache.set(o.sellerId, sellerName); }
        }
        return { ...o, buyerName, sellerName };
      });
      return sendJson(res, 200, { ...data, orders });
    }

    if (matchRoute(pathname, '/api/orders') && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const result = await createOrder({
        authUser: context.authUser,
        body: context.body,
        db,
        usersById: index.usersById,
        uid,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
        rebuildMallIndex,
        broadcastAll,
        ordersById: index.ordersById,
        ordersByBuyer: index.ordersByBuyer,
        ordersBySeller: index.ordersBySeller,
      });
      // Broadcast stock changes so other buyers' carts can update
      if (result.ok && result.payload?.stockChanges?.length) {
        broadcastAll('product_changed', {
          sellerId: context.body.sellerId,
          stockUpdates: result.payload.stockChanges,
        });
      }
      // Enrich order with display names so the client's order detail page
      // can show the seller/buyer name instead of falling back to the raw
      // user id. createOrder builds the order object without buyerName /
      // sellerName (it would otherwise pollute the stored db object),
      // so we mirror the same lookup used by the GET /api/orders route
      // above. We spread into new objects to avoid mutating the order
      // that's been pushed into db.orders / ordersById.
      if (result.ok && result.payload?.order) {
        const o = result.payload.order;
        const buyerName = o.buyerName || index.usersById.get(o.buyerId)?.displayName || '';
        const sellerName = o.sellerName || index.usersById.get(o.sellerId)?.displayName || '';
        result.payload = { ...result.payload, order: { ...o, buyerName, sellerName } };
      }
      return sendResult(res, result);
    }

    // Single regex for all /api/orders/:id/:action POST routes (avoids 6 separate regex matches)
    const orderActionMatch = method === 'POST' && pathname.match(RE_ORDER_ACTION);
    if (orderActionMatch) {
      const orderId = orderActionMatch[1];
      const action = orderActionMatch[2];
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const args = { authUser: context.authUser, orderId, body: context.body, db, usersById: index.usersById, schedulePersist, ordersById: index.ordersById, getOrCreateDirectConversation, addTradeMessage };
      let result;
      if (action === 'accept') result = acceptOrder(args);
      else if (action === 'price') result = updateOrderPrice(args);
      else if (action === 'price-request') result = requestOrderPriceChange(args);
      else if (action === 'price-confirm') result = confirmOrderPriceChange(args);
      else if (action === 'status') result = updateOrderStatus(args);
      else if (action === 'ship') result = shipOrder(args);
      else result = deleteOrder(args);
      return sendResult(res, result);
    }

    return false; // not handled
  };
};
