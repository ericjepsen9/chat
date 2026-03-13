/* server_routes_products.js — Product, mall, and broadcast route handlers */

const MAX_PRESETS = 50;

module.exports = function createProductRoutes(ctx) {
  const {
    matchRoute, sendJson, sendResult,
    getAuthedUser, getAuthedBody, getAuthedActingBody,
    index,
    uid,
    createProduct, deleteProduct, updateProduct,
    queryMallItems,
    createBroadcastMessage,
    canAccessConversation, addTradeMessage, touchConversation,
    rebuildMallIndex,
    schedulePersist,
    broadcastAll,
  } = ctx;

  return async function handleProductRoutes(pathname, method, req, res, searchParams) {

    const broadcastMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/broadcast$/);
    if (broadcastMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const result = createBroadcastMessage({
        conversationId: broadcastMatch[1],
        authUser: context.authUser,
        body: context.body,
        index,
        canAccessConversation,
        addTradeMessage,
        touchConversation,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/products') && method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = createProduct({
        authUser: context.authUser,
        body: context.body,
        uid,
        rebuildMallIndex,
        schedulePersist,
        broadcastAll,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/products/delete') && method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = deleteProduct({
        authUser: context.authUser,
        productId: context.body.productId,
        rebuildMallIndex,
        schedulePersist,
        broadcastAll,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/products/update') && method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = updateProduct({
        authUser: context.authUser,
        body: context.body,
        rebuildMallIndex,
        schedulePersist,
        broadcastAll,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/product-presets') && method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      return sendJson(res, 200, {
        categoryPresets: authUser.categoryPresets || [],
        specPresets: authUser.specPresets || [],
      });
    }

    if (matchRoute(pathname, '/api/product-presets/update') && method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: [] });
      if (!context) return true;
      const { categoryPresets, specPresets } = context.body;
      if (Array.isArray(categoryPresets)) {
        context.authUser.categoryPresets = categoryPresets.map(s => String(s || '').trim().slice(0, 40)).filter(Boolean).slice(0, MAX_PRESETS);
      }
      if (Array.isArray(specPresets)) {
        context.authUser.specPresets = specPresets.map(s => String(s || '').trim().slice(0, 40)).filter(Boolean).slice(0, MAX_PRESETS);
      }
      schedulePersist('product_presets_update', { userId: context.authUser.id });
      return sendJson(res, 200, {
        categoryPresets: context.authUser.categoryPresets,
        specPresets: context.authUser.specPresets,
      });
    }

    if (matchRoute(pathname, '/api/mall') && method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      const data = queryMallItems({
        mallItems: index.mallItems,
        keyword: searchParams.get('q') || '',
        limit: searchParams.get('limit'),
        offset: searchParams.get('offset'),
      });
      return sendJson(res, 200, data);
    }

    return false; // not handled
  };
};
