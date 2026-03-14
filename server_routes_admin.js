/* server_routes_admin.js — Comprehensive admin route handlers */

const SYSTEM_MSG_LIMITS = { TITLE: 80, SUMMARY: 240, COVER: 512, LIST_MAX: 30, STORE_MAX: 100 };
const ADMIN_PAGE_LIMIT = 50;
const VALID_ORDER_STATUSES = new Set(['pending', 'accepted', 'processing', 'in_progress', 'completed']);

// Pre-compiled route regexes
const RE_SYS_DEL = /^\/api\/admin\/system\/messages\/([^/]+)\/delete$/;
const RE_USER_DETAIL = /^\/api\/admin\/users\/([^/]+)$/;
const RE_USER_UPDATE = /^\/api\/admin\/users\/([^/]+)\/update$/;
const RE_USER_RESET_PW = /^\/api\/admin\/users\/([^/]+)\/reset-password$/;
const RE_ORDER_DETAIL = /^\/api\/admin\/orders\/([^/]+)$/;
const RE_ORDER_STATUS = /^\/api\/admin\/orders\/([^/]+)\/status$/;
const RE_PRODUCT_UPDATE = /^\/api\/admin\/products\/([^/]+)\/update$/;
const RE_PRODUCT_DELETE = /^\/api\/admin\/products\/([^/]+)\/delete$/;
const RE_CONV_MSG = /^\/api\/admin\/conversations\/([^/]+)\/messages$/;
const RE_MSG_DEL = /^\/api\/admin\/messages\/([^/]+)\/delete$/;

module.exports = function createAdminRoutes(ctx) {
  const {
    sendJson, matchRoute,
    getAuthedUser, getAuthedBody,
    isAdmin, requireAdmin,
    sessions, index, db,
    uid,
    buildAdminDashboardData,
    schedulePersist, schedulePersistCritical,
    broadcastAll, broadcastToUser,
    hashPasswordAsync,
    rebuildIndexes, rebuildMallIndex, rebuildFriendViewsIndex, rebuildConversationBaseIndex,
    rebuildBlacklistViewsIndex, rebuildRequestViewsIndex,
    sanitizePublicUser,
  } = ctx;

  function adminGuard(req, res, searchParams) {
    return requireAdmin(req, res, searchParams, sessions, index, sendJson, isAdmin);
  }

  function paginate(searchParams) {
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit')) || 20, 1), ADMIN_PAGE_LIMIT);
    const offset = Math.max(parseInt(searchParams.get('offset')) || 0, 0);
    return { limit, offset };
  }

  function slicePage(arr, offset, limit) {
    const total = arr.length;
    return { items: arr.slice(offset, offset + limit), total, hasMore: offset + limit < total };
  }

  return async function handleAdminRoutes(pathname, method, req, res, searchParams) {

    // ── Public: system messages list ──
    if (pathname === '/api/system/messages' && method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      return sendJson(res, 200, { items: (db.systemMessages || []).slice(0, SYSTEM_MSG_LIMITS.LIST_MAX) });
    }

    // ── Admin: create system message ──
    if (pathname === '/api/admin/system/messages' && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      if (!isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const title = String(context.body.title || '').trim().slice(0, SYSTEM_MSG_LIMITS.TITLE) || '系统消息';
      const summary = String(context.body.summary || '').trim().slice(0, SYSTEM_MSG_LIMITS.SUMMARY) || '请查看最新通知';
      const cover = String(context.body.cover || '').trim().slice(0, SYSTEM_MSG_LIMITS.COVER);
      const item = { id: uid('sys'), title, summary, cover, createdAt: Date.now(), senderId: context.authUser.id };
      if (!Array.isArray(db.systemMessages)) db.systemMessages = [];
      db.systemMessages.unshift(item);
      if (db.systemMessages.length > SYSTEM_MSG_LIMITS.STORE_MAX) db.systemMessages.length = SYSTEM_MSG_LIMITS.STORE_MAX;
      await schedulePersistCritical('system_message_create', { id: item.id });
      try { broadcastAll('system_message', { message: item }); } catch (e) { console.warn('[admin] broadcast failed:', e?.message || e); }
      return sendJson(res, 201, { item });
    }

    // ── Admin: delete system message ──
    const sysDelMatch = pathname.match(RE_SYS_DEL);
    if (sysDelMatch && method === 'POST') {
      const authUser = await getAuthedBody(req, res).then(c => c?.authUser);
      if (!authUser || !isAdmin(authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const msgId = sysDelMatch[1];
      if (!Array.isArray(db.systemMessages)) return sendJson(res, 404, { error: 'not_found' });
      const idx = db.systemMessages.findIndex(m => m.id === msgId);
      if (idx === -1) return sendJson(res, 404, { error: 'not_found' });
      db.systemMessages.splice(idx, 1);
      schedulePersist('system_message_delete', { id: msgId });
      return sendJson(res, 200, { ok: true });
    }

    // ── Admin: dashboard ──
    if (pathname === '/api/admin/dashboard' && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const data = buildAdminDashboardData(db);
      return sendJson(res, 200, data);
    }

    // ══════════════════════════════════════════
    //  USER MANAGEMENT
    // ══════════════════════════════════════════

    // List users (search, filter, pagination)
    if (pathname === '/api/admin/users' && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const { limit, offset } = paginate(searchParams);
      const q = String(searchParams.get('q') || '').trim().toLowerCase();
      const statusFilter = searchParams.get('status') || '';
      const roleFilter = searchParams.get('role') || '';
      // Single-pass filter: combine status, role, and search into one iteration
      const needFilter = statusFilter || roleFilter || q;
      const filtered = needFilter ? db.users.filter(u => {
        if (statusFilter && (u.status || 'active') !== statusFilter) return false;
        if (roleFilter && (u.role || 'user') !== roleFilter) return false;
        if (q) {
          const st = u._adminSearchText || (u._adminSearchText = ((u.username || '') + ' ' + (u.displayName || '') + ' ' + (u.phone || '') + ' ' + (u.appNumberId || '')).toLowerCase());
          if (!st.includes(q)) return false;
        }
        return true;
      }) : db.users;
      const result = slicePage(filtered, offset, limit);
      result.items = result.items.map(u => ({
        id: u.id, username: u.username, displayName: u.displayName,
        avatarUrl: u.avatarUrl, phone: u.phone, appNumberId: u.appNumberId,
        role: u.role || 'user', status: u.status || 'active',
        productCount: Array.isArray(u.products) ? u.products.length : 0,
        blacklistCount: Array.isArray(u.blacklist) ? u.blacklist.length : 0,
        createdAt: u.createdAt,
      }));
      return sendJson(res, 200, result);
    }

    // Get user detail
    const userDetailMatch = pathname.match(RE_USER_DETAIL);
    if (userDetailMatch && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const user = index.usersById.get(userDetailMatch[1]);
      if (!user) return sendJson(res, 404, { error: 'not_found' });
      const friendships = index.friendshipsByUser.get(user.id) || [];
      const buyerOrders = index.ordersByBuyer.get(user.id) || [];
      const sellerOrders = index.ordersBySeller.get(user.id) || [];
      return sendJson(res, 200, {
        user: {
          id: user.id, username: user.username, displayName: user.displayName,
          signature: user.signature, avatarUrl: user.avatarUrl, phone: user.phone,
          appNumberId: user.appNumberId, role: user.role || 'user',
          status: user.status || 'active', createdAt: user.createdAt,
          customGroups: user.customGroups,
          paymentCodes: user.paymentCodes || {},
          productCount: Array.isArray(user.products) ? user.products.length : 0,
          blacklistCount: Array.isArray(user.blacklist) ? user.blacklist.length : 0,
          blacklist: (user.blacklist || []).map(bid => {
            const bu = index.usersById.get(bid);
            return { id: bid, displayName: bu?.displayName || bid };
          }),
        },
        products: (user.products || []).map(p => ({
          id: p.id, title: p.title, price: p.price, image: p.image,
          stock: p.stock, listed: !!p.listed, category: p.category, createdAt: p.createdAt,
        })),
        friendCount: friendships.length,
        orderStats: {
          asBuyer: buyerOrders.length,
          asSeller: sellerOrders.length,
          pending: buyerOrders.reduce((n, o) => n + (o.status === 'pending'), 0)
                 + sellerOrders.reduce((n, o) => n + (o.status === 'pending'), 0),
        },
      });
    }

    // Update user
    const userUpdateMatch = pathname.match(RE_USER_UPDATE);
    if (userUpdateMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const user = index.usersById.get(userUpdateMatch[1]);
      if (!user) return sendJson(res, 404, { error: 'not_found' });
      const b = context.body;
      if (b.displayName !== undefined) user.displayName = String(b.displayName || '').trim().slice(0, 40) || user.displayName;
      if (b.signature !== undefined) user.signature = String(b.signature || '').trim().slice(0, 160);
      if (b.status !== undefined && (b.status === 'active' || b.status === 'disabled')) user.status = b.status;
      if (b.role !== undefined && (b.role === 'admin' || b.role === 'user')) user.role = b.role;
      rebuildFriendViewsIndex();
      rebuildConversationBaseIndex();
      schedulePersist('admin_user_update', { userId: user.id });
      return sendJson(res, 200, { ok: true, user: { id: user.id, displayName: user.displayName, status: user.status, role: user.role } });
    }

    // Reset user password
    const userResetPwMatch = pathname.match(RE_USER_RESET_PW);
    if (userResetPwMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const user = index.usersById.get(userResetPwMatch[1]);
      if (!user) return sendJson(res, 404, { error: 'not_found' });
      const newPw = String(context.body.password || '').trim();
      if (!newPw || newPw.length < 4 || newPw.length > 64) return sendJson(res, 400, { error: '密码长度需 4-64 位' });
      user.password = await hashPasswordAsync(newPw);
      schedulePersist('admin_user_reset_password', { userId: user.id });
      return sendJson(res, 200, { ok: true });
    }

    // ══════════════════════════════════════════
    //  ORDER MANAGEMENT
    // ══════════════════════════════════════════

    // List orders
    if (pathname === '/api/admin/orders' && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const { limit, offset } = paginate(searchParams);
      const q = String(searchParams.get('q') || '').trim().toLowerCase();
      const statusFilter = searchParams.get('status') || '';
      let filtered = db.orders || [];
      if (statusFilter) filtered = filtered.filter(o => o.status === statusFilter);
      if (q) {
        // Pre-build user name cache to avoid repeated index lookups in filter
        const userNameCache = new Map();
        const getUserNames = (id) => {
          let cached = userNameCache.get(id);
          if (!cached) {
            const u = index.usersById.get(id);
            cached = ((u?.displayName || '') + ' ' + (u?.username || '')).toLowerCase();
            userNameCache.set(id, cached);
          }
          return cached;
        };
        filtered = filtered.filter(o =>
          (o.id || '').toLowerCase().includes(q) ||
          getUserNames(o.buyerId).includes(q) ||
          getUserNames(o.sellerId).includes(q)
        );
      }
      const result = slicePage(filtered, offset, limit);
      result.items = result.items.map(o => {
        const buyer = index.usersById.get(o.buyerId);
        const seller = index.usersById.get(o.sellerId);
        return {
          id: o.id, total: o.total, status: o.status,
          buyerId: o.buyerId, sellerId: o.sellerId,
          buyerName: buyer?.displayName || o.buyerId,
          sellerName: seller?.displayName || o.sellerId,
          itemCount: (o.items || []).length,
          summary: (o.items || []).map(i => `${i.title}×${i.quantity}`).join('，'),
          remark: o.remark || '',
          createdAt: o.createdAt, updatedAt: o.updatedAt,
        };
      });
      return sendJson(res, 200, result);
    }

    // Get order detail
    const orderDetailMatch = pathname.match(RE_ORDER_DETAIL);
    if (orderDetailMatch && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const order = index.ordersById.get(orderDetailMatch[1]);
      if (!order) return sendJson(res, 404, { error: 'not_found' });
      const buyer = index.usersById.get(order.buyerId);
      const seller = index.usersById.get(order.sellerId);
      // Attach view-only fields directly instead of spread-copying entire order
      order.buyerName = buyer?.displayName || order.buyerId;
      order.sellerName = seller?.displayName || order.sellerId;
      order.buyerAvatar = buyer?.avatarUrl || '';
      order.sellerAvatar = seller?.avatarUrl || '';
      return sendJson(res, 200, { order });
    }

    // Update order status (admin force)
    const orderStatusMatch = pathname.match(RE_ORDER_STATUS);
    if (orderStatusMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const order = index.ordersById.get(orderStatusMatch[1]);
      if (!order) return sendJson(res, 404, { error: 'not_found' });
      const nextStatus = String(context.body.status || '').trim();
      if (!VALID_ORDER_STATUSES.has(nextStatus)) return sendJson(res, 400, { error: 'invalid_status' });
      order.status = nextStatus;
      order.updatedAt = Date.now();
      schedulePersist('admin_order_status', { orderId: order.id, status: nextStatus });
      return sendJson(res, 200, { ok: true, order: { id: order.id, status: order.status } });
    }

    // ══════════════════════════════════════════
    //  PRODUCT MANAGEMENT
    // ══════════════════════════════════════════

    // List all products — uses pre-built mallItems index (already sorted by createdAt desc)
    if (pathname === '/api/admin/products' && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const { limit, offset } = paginate(searchParams);
      const q = String(searchParams.get('q') || '').trim().toLowerCase();
      const listedFilter = searchParams.get('listed');
      // Use pre-built allProductsSorted from index (already sorted by createdAt desc)
      let allProducts;
      if (!listedFilter && !q) {
        allProducts = index.allProductsSorted;
      } else {
        allProducts = [];
        const src = index.allProductsSorted;
        for (let pi = 0; pi < src.length; pi++) {
          const p = src[pi];
          if (listedFilter === 'true' && !p.listed) continue;
          if (listedFilter === 'false' && p.listed !== false) continue;
          if (q) {
            const st = p._adminSearchText || (p._adminSearchText = ((p.title || '') + ' ' + (p.sellerName || '') + ' ' + (p.category || '')).toLowerCase());
            if (!st.includes(q)) continue;
          }
          allProducts.push(p);
        }
      }
      const result = slicePage(allProducts, offset, limit);
      return sendJson(res, 200, result);
    }

    // Update product (admin)
    const productUpdateMatch = pathname.match(RE_PRODUCT_UPDATE);
    if (productUpdateMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const productId = productUpdateMatch[1];
      const found = index.productById.get(productId);
      if (!found) return sendJson(res, 404, { error: 'not_found' });
      const b = context.body;
      if (b.price !== undefined) found.price = String(b.price || '').trim().slice(0, 24);
      if (b.stock !== undefined) found.stock = Math.max(0, Math.floor(Number(b.stock) || 0));
      if (b.listed !== undefined) found.listed = !!b.listed;
      if (b.title !== undefined) found.title = String(b.title || '').trim().slice(0, 80) || found.title;
      rebuildMallIndex();
      schedulePersist('admin_product_update', { productId });
      return sendJson(res, 200, { ok: true, product: found });
    }

    // Delete product (admin)
    const productDeleteMatch = pathname.match(RE_PRODUCT_DELETE);
    if (productDeleteMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const productId = productDeleteMatch[1];
      const delOwner = index.productOwnerMap.get(productId);
      if (!delOwner) return sendJson(res, 404, { error: 'not_found' });
      const delProduct = index.productById.get(productId);
      if (!delProduct) return sendJson(res, 404, { error: 'not_found' });
      const delIdx = (delOwner.products || []).indexOf(delProduct);
      if (delIdx !== -1) delOwner.products.splice(delIdx, 1);
      rebuildMallIndex();
      broadcastAll('mall_updated', {});
      schedulePersist('admin_product_delete', { productId });
      return sendJson(res, 200, { ok: true });
    }

    // ══════════════════════════════════════════
    //  CONVERSATION / MESSAGE MANAGEMENT
    // ══════════════════════════════════════════

    // List conversations
    if (pathname === '/api/admin/conversations' && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const { limit, offset } = paginate(searchParams);
      const q = String(searchParams.get('q') || '').trim().toLowerCase();
      const typeFilter = searchParams.get('type') || '';
      const rawConvs = db.conversations || [];
      // Filter first to reduce sort input size, then sort the smaller result
      let convs = rawConvs;
      if (typeFilter) convs = convs.filter(c => c.type === typeFilter);
      if (q) {
        // Pre-build user name cache for conversation member name lookups
        const memberNameCache = new Map();
        convs = convs.filter(c => {
          if ((c.name || '').toLowerCase().includes(q)) return true;
          const members = c.members || [];
          for (let mi = 0; mi < members.length; mi++) {
            const mid = members[mi];
            let name = memberNameCache.get(mid);
            if (name === undefined) {
              const u = index.usersById.get(mid);
              name = ((u?.displayName || '') + (u?.username || '')).toLowerCase();
              memberNameCache.set(mid, name);
            }
            if (name.includes(q)) return true;
          }
          return false;
        });
      }
      // Sort filtered copy by lastMessageAt descending; only copy if we haven't already
      if (convs === rawConvs) convs = convs.slice();
      convs.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
      const result = slicePage(convs, offset, limit);
      result.items = result.items.map(c => {
        const memberInfo = (c.members || []).map(mid => {
          const u = index.usersById.get(mid);
          return { id: mid, displayName: u?.displayName || mid, avatarUrl: u?.avatarUrl || '' };
        });
        const msgCount = (index.messagesByConv.get(c.id) || []).length;
        return {
          id: c.id, type: c.type, name: c.name, members: memberInfo,
          messageCount: msgCount, lastMessageAt: c.lastMessageAt, createdAt: c.createdAt,
        };
      });
      return sendJson(res, 200, result);
    }

    // Get conversation messages
    const convMsgMatch = pathname.match(RE_CONV_MSG);
    if (convMsgMatch && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const convId = convMsgMatch[1];
      const conv = index.convById.get(convId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const { limit, offset } = paginate(searchParams);
      const msgs = index.messagesByConv.get(convId) || [];
      // Messages are stored chronologically; iterate in reverse for newest-first without full copy+sort
      const total = msgs.length;
      const start = total - 1 - offset;
      const pageItems = [];
      for (let mi = start; mi >= 0 && pageItems.length < limit; mi--) pageItems.push(msgs[mi]);
      const result = { items: pageItems, total, hasMore: start - limit >= 0 };
      result.items = result.items.map(m => {
        const sender = index.usersById.get(m.senderId);
        return {
          id: m.id, type: m.type, text: m.text, imageUrl: m.imageUrl, audioUrl: m.audioUrl,
          senderId: m.senderId, senderName: sender?.displayName || m.senderId || '系统',
          createdAt: m.createdAt,
        };
      });
      return sendJson(res, 200, result);
    }

    // Admin delete message
    const adminMsgDelMatch = pathname.match(RE_MSG_DEL);
    if (adminMsgDelMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const msg = index.messagesById.get(adminMsgDelMatch[1]);
      if (!msg) return sendJson(res, 404, { error: 'not_found' });
      msg.type = 'system';
      msg.text = '[管理员已删除此消息]';
      msg.imageUrl = null;
      msg.audioUrl = null;
      msg.card = null;
      msg.order = null;
      msg.broadcast = null;
      schedulePersist('admin_message_delete', { messageId: msg.id });
      return sendJson(res, 200, { ok: true });
    }

    // ══════════════════════════════════════════
    //  STATISTICS
    // ══════════════════════════════════════════

    if (pathname === '/api/admin/stats' && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const today = now - (now % dayMs);

      let newUsersToday = 0, newOrdersToday = 0, completedOrdersToday = 0;
      let totalRevenue = 0, totalProducts = 0;
      const statusCounts = {};

      // Merged: today stats + 7-day trend in single pass per collection
      const weekStart = today - 6 * dayMs;
      const trendUsers = new Int32Array(7);
      const trendOrders = new Int32Array(7);
      const trendMsgs = new Int32Array(7);
      for (const u of db.users) {
        const t = u.createdAt || 0;
        if (t >= today) newUsersToday++;
        if (t >= weekStart) { const d = Math.floor((t - weekStart) / dayMs); if (d >= 0 && d < 7) trendUsers[d]++; }
        if (Array.isArray(u.products)) totalProducts += u.products.length;
      }
      for (const o of (db.orders || [])) {
        statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
        const t = o.createdAt || 0;
        if (t >= today) newOrdersToday++;
        if (o.status === 'completed') {
          totalRevenue += Number(o.total) || 0;
          if ((o.updatedAt || 0) >= today) completedOrdersToday++;
        }
        if (t >= weekStart) { const d = Math.floor((t - weekStart) / dayMs); if (d >= 0 && d < 7) trendOrders[d]++; }
      }
      for (const m of (db.messages || [])) {
        const t = m.createdAt || 0;
        if (t >= weekStart) { const d = Math.floor((t - weekStart) / dayMs); if (d >= 0 && d < 7) trendMsgs[d]++; }
      }
      const trend = [];
      for (let d = 0; d < 7; d++) {
        trend.push({ date: new Date(weekStart + d * dayMs).toISOString().slice(5, 10), users: trendUsers[d], orders: trendOrders[d], messages: trendMsgs[d] });
      }

      return sendJson(res, 200, {
        overview: {
          totalUsers: db.users.length,
          totalOrders: (db.orders || []).length,
          totalProducts,
          totalMessages: (db.messages || []).length,
          totalConversations: (db.conversations || []).length,
          totalRevenue,
          newUsersToday,
          newOrdersToday,
          completedOrdersToday,
        },
        orderStatusCounts: statusCounts,
        trend,
      });
    }

    return false; // not handled
  };
};
