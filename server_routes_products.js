/* server_routes_products.js — Product, mall, and broadcast route handlers */

const MAX_PRESETS = 50;
const RE_BROADCAST = /^\/api\/conversations\/([^/]+)\/broadcast$/;

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

    // --- GET routes ---
    if (method === 'GET') {
      if (matchRoute(pathname, '/api/product-presets')) {
        const authUser = getAuthedUser(req, res, { searchParams });
        if (!authUser) return true;
        return sendJson(res, 200, {
          categoryPresets: authUser.categoryPresets || [],
          specPresets: authUser.specPresets || [],
        });
      }

      if (matchRoute(pathname, '/api/mall')) {
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

      return false;
    }

    // --- POST routes only below ---
    if (method !== 'POST') return false;

    const broadcastMatch = pathname.match(RE_BROADCAST);
    if (broadcastMatch) {
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

    if (matchRoute(pathname, '/api/products')) {
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

    if (matchRoute(pathname, '/api/products/delete')) {
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

    if (matchRoute(pathname, '/api/products/update')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = updateProduct({
        authUser: context.authUser,
        body: context.body,
        rebuildMallIndex,
        schedulePersist,
        broadcastAll,
      });
      // Broadcast granular product changes so buyers can update their carts
      if (result.ok && result.payload?.changes && Object.keys(result.payload.changes).length > 0) {
        broadcastAll('product_changed', {
          sellerId: context.authUser.id,
          productId: result.payload.product?.id,
          changes: result.payload.changes,
        });
      }
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/product-presets/update')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: [] });
      if (!context) return true;
      const { categoryPresets, specPresets } = context.body;
      if (Array.isArray(categoryPresets)) {
        // Single-pass: normalize + filter + limit in one loop (avoids map+filter+slice chain)
        const cats = [];
        for (let i = 0; i < categoryPresets.length && cats.length < MAX_PRESETS; i++) {
          const s = String(categoryPresets[i] || '').trim().slice(0, 40);
          if (s) cats.push(s);
        }
        context.authUser.categoryPresets = cats;
      }
      if (Array.isArray(specPresets)) {
        const specs = [];
        for (let i = 0; i < specPresets.length && specs.length < MAX_PRESETS; i++) {
          const s = String(specPresets[i] || '').trim().slice(0, 40);
          if (s) specs.push(s);
        }
        context.authUser.specPresets = specs;
      }
      schedulePersist('product_presets_update', { userId: context.authUser.id });
      return sendJson(res, 200, {
        categoryPresets: context.authUser.categoryPresets,
        specPresets: context.authUser.specPresets,
      });
    }

    return false; // not handled
  };
};
