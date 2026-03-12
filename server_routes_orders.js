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
      const data = queryOrders({ db, authUser, searchParams, isAdmin });
      (data.orders || []).forEach(o => {
        const buyer = index.usersById.get(o.buyerId);
        const seller = index.usersById.get(o.sellerId);
        o.buyerName = buyer?.displayName || buyer?.nickname || '';
        o.sellerName = seller?.displayName || seller?.nickname || '';
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
      });
      return sendResult(res, result);
    }

    const orderAcceptMatch = pathname.match(/^\/api\/orders\/([^/]+)\/accept$/);
    if (orderAcceptMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const result = acceptOrder({
        authUser: context.authUser,
        orderId: orderAcceptMatch[1],
        body: context.body,
        db,
        usersById: index.usersById,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
        ordersById: index.ordersById,
      });
      return sendResult(res, result);
    }

    const orderPriceMatch = pathname.match(/^\/api\/orders\/([^/]+)\/price$/);
    if (orderPriceMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const result = updateOrderPrice({
        authUser: context.authUser,
        orderId: orderPriceMatch[1],
        body: context.body,
        db,
        usersById: index.usersById,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
        ordersById: index.ordersById,
      });
      return sendResult(res, result);
    }

    const orderPriceRequestMatch = pathname.match(/^\/api\/orders\/([^/]+)\/price-request$/);
    if (orderPriceRequestMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const result = requestOrderPriceChange({
        authUser: context.authUser,
        orderId: orderPriceRequestMatch[1],
        body: context.body,
        db,
        usersById: index.usersById,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
        ordersById: index.ordersById,
      });
      return sendResult(res, result);
    }

    const orderPriceConfirmMatch = pathname.match(/^\/api\/orders\/([^/]+)\/price-confirm$/);
    if (orderPriceConfirmMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const result = confirmOrderPriceChange({
        authUser: context.authUser,
        orderId: orderPriceConfirmMatch[1],
        body: context.body,
        db,
        usersById: index.usersById,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
        ordersById: index.ordersById,
      });
      return sendResult(res, result);
    }

    const orderStatusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (orderStatusMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const result = updateOrderStatus({
        authUser: context.authUser,
        orderId: orderStatusMatch[1],
        body: context.body,
        db,
        usersById: index.usersById,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
        ordersById: index.ordersById,
      });
      return sendResult(res, result);
    }

    const orderDeleteMatch = pathname.match(/^\/api\/orders\/([^/]+)\/delete$/);
    if (orderDeleteMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const result = deleteOrder({
        authUser: context.authUser,
        orderId: orderDeleteMatch[1],
        db,
        usersById: index.usersById,
        schedulePersist,
        ordersById: index.ordersById,
      });
      return sendResult(res, result);
    }

    return false; // not handled
  };
};
