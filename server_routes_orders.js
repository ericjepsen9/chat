/* server_routes_orders.js — Order route handlers */

module.exports = function createOrderRoutes(ctx) {
  const {
    matchRoute, sendJson, sendResult,
    getAuthedUser, getAuthedBody,
    queryOrders, createOrder, acceptOrder,
    updateOrderPrice, requestOrderPriceChange, confirmOrderPriceChange,
    updateOrderStatus, deleteOrder,
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
      (data.orders || []).forEach(o => {
        const buyer = index.usersById.get(o.buyerId);
        const seller = index.usersById.get(o.sellerId);
        o.buyerName = buyer?.displayName || '';
        o.sellerName = seller?.displayName || '';
      });
      return sendJson(res, 200, data);
    }

    if (matchRoute(pathname, '/api/orders') && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const result = createOrder({
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
      return sendResult(res, result);
    }

    // Single regex for all /api/orders/:id/:action POST routes (avoids 6 separate regex matches)
    const orderActionMatch = method === 'POST' && pathname.match(/^\/api\/orders\/([^/]+)\/(accept|price|price-request|price-confirm|status|delete)$/);
    if (orderActionMatch) {
      const orderId = orderActionMatch[1];
      const action = orderActionMatch[2];
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const commonArgs = { authUser: context.authUser, orderId, body: context.body, db, usersById: index.usersById, schedulePersist, ordersById: index.ordersById };
      const tradeArgs = { ...commonArgs, getOrCreateDirectConversation, addTradeMessage };
      let result;
      if (action === 'accept') result = acceptOrder(tradeArgs);
      else if (action === 'price') result = updateOrderPrice(tradeArgs);
      else if (action === 'price-request') result = requestOrderPriceChange(tradeArgs);
      else if (action === 'price-confirm') result = confirmOrderPriceChange(tradeArgs);
      else if (action === 'status') result = updateOrderStatus(tradeArgs);
      else result = deleteOrder(commonArgs);
      return sendResult(res, result);
    }

    return false; // not handled
  };
};
