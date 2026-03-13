/* server_routes_admin.js — Comprehensive admin route handlers */

const SYSTEM_MSG_LIMITS = { TITLE: 80, SUMMARY: 240, COVER: 512, LIST_MAX: 30, STORE_MAX: 100 };
const ADMIN_PAGE_LIMIT = 50;

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
      let filtered = db.users;
      if (statusFilter) filtered = filtered.filter(u => (u.status || 'active') === statusFilter);
      if (roleFilter) filtered = filtered.filter(u => (u.role || 'user') === roleFilter);
      if (q) {
        filtered = filtered.filter(u =>
          (u.username || '').toLowerCase().includes(q) ||
          (u.displayName || '').toLowerCase().includes(q) ||
          (u.phone || '').includes(q) ||
          (u.appNumberId || '').toLowerCase().includes(q)
        );
      }
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
          pending: buyerOrders.filter(o => o.status === 'pending').length + sellerOrders.filter(o => o.status === 'pending').length,
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
        filtered = filtered.filter(o => {
          const buyer = index.usersById.get(o.buyerId);
          const seller = index.usersById.get(o.sellerId);
          return (o.id || '').toLowerCase().includes(q) ||
            (buyer?.displayName || '').toLowerCase().includes(q) ||
            (buyer?.username || '').toLowerCase().includes(q) ||
            (seller?.displayName || '').toLowerCase().includes(q) ||
            (seller?.username || '').toLowerCase().includes(q);
        });
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
      return sendJson(res, 200, {
        order: {
          ...order,
          buyerName: buyer?.displayName || order.buyerId,
          sellerName: seller?.displayName || order.sellerId,
          buyerAvatar: buyer?.avatarUrl || '',
          sellerAvatar: seller?.avatarUrl || '',
        },
      });
    }

    // Update order status (admin force)
    const orderStatusMatch = pathname.match(RE_ORDER_STATUS);
    if (orderStatusMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const order = index.ordersById.get(orderStatusMatch[1]);
      if (!order) return sendJson(res, 404, { error: 'not_found' });
      const nextStatus = String(context.body.status || '').trim();
      const validStatuses = ['pending', 'accepted', 'processing', 'in_progress', 'completed'];
      if (!validStatuses.includes(nextStatus)) return sendJson(res, 400, { error: 'invalid_status' });
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
      // mallItems only contains listed+in-stock items; for admin we need all products
      let allProducts;
      if (!listedFilter && !q) {
        // Unfiltered: build from users (admin needs unlisted items too)
        allProducts = [];
        for (const u of db.users) {
          if (!Array.isArray(u.products)) continue;
          const sellerId = u.id;
          const sellerName = u.displayName || u.username;
          for (let pi = 0; pi < u.products.length; pi++) {
            const p = u.products[pi];
            p.sellerId = sellerId;
            p.sellerName = sellerName;
            allProducts.push(p);
          }
        }
        allProducts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      } else {
        // Filtered: still need full scan but avoid spread-copying each product
        allProducts = [];
        for (const u of db.users) {
          if (!Array.isArray(u.products)) continue;
          const sellerId = u.id;
          const sellerName = u.displayName || u.username;
          for (let pi = 0; pi < u.products.length; pi++) {
            const p = u.products[pi];
            if (listedFilter === 'true' && !p.listed) continue;
            if (listedFilter === 'false' && p.listed !== false) continue;
            if (q && !(p.title || '').toLowerCase().includes(q) && !(sellerName || '').toLowerCase().includes(q) && !(p.category || '').toLowerCase().includes(q)) continue;
            p.sellerId = sellerId;
            p.sellerName = sellerName;
            allProducts.push(p);
          }
        }
        allProducts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
      let found = null;
      for (const u of db.users) {
        if (!Array.isArray(u.products)) continue;
        found = u.products.find(p => p.id === productId);
        if (found) break;
      }
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
      let deleted = false;
      for (const u of db.users) {
        if (!Array.isArray(u.products)) continue;
        const idx = u.products.findIndex(p => p.id === productId);
        if (idx !== -1) { u.products.splice(idx, 1); deleted = true; break; }
      }
      if (!deleted) return sendJson(res, 404, { error: 'not_found' });
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
      let convs = db.conversations || [];
      convs = convs.slice().sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
      if (typeFilter) convs = convs.filter(c => c.type === typeFilter);
      if (q) {
        convs = convs.filter(c => {
          const memberNames = (c.members || []).map(mid => {
            const u = index.usersById.get(mid);
            return (u?.displayName || '') + (u?.username || '');
          }).join(' ').toLowerCase();
          return memberNames.includes(q) || (c.name || '').toLowerCase().includes(q);
        });
      }
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
      const sorted = msgs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const result = slicePage(sorted, offset, limit);
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
      let totalRevenue = 0;
      const statusCounts = {};
      for (const u of db.users) { if ((u.createdAt || 0) >= today) newUsersToday++; }
      for (const o of (db.orders || [])) {
        statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
        if ((o.createdAt || 0) >= today) newOrdersToday++;
        if (o.status === 'completed') {
          totalRevenue += Number(o.total) || 0;
          if ((o.updatedAt || 0) >= today) completedOrdersToday++;
        }
      }

      // Activity trend (last 7 days) — single pass over each collection
      const weekStart = today - 6 * dayMs;
      const trendUsers = new Int32Array(7);
      const trendOrders = new Int32Array(7);
      const trendMsgs = new Int32Array(7);
      for (const u of db.users) {
        const t = u.createdAt || 0;
        if (t >= weekStart) { const d = Math.floor((t - weekStart) / dayMs); if (d >= 0 && d < 7) trendUsers[d]++; }
      }
      for (const o of (db.orders || [])) {
        const t = o.createdAt || 0;
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
          totalProducts: db.users.reduce((s, u) => s + (Array.isArray(u.products) ? u.products.length : 0), 0),
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
