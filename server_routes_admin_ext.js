/* server_routes_admin_ext.js — Extended admin routes: friends, sessions, user-create, order-delete, blacklist, export, online */

const ADMIN_PAGE_LIMIT = 50;
const AUDIT_LOG_MAX = 200;
const adminAuditLog = []; // in-memory ring buffer

// CSV helper: escape a field value once (avoids repeated .replace() calls)
function csvField(val) {
  const s = String(val ?? '');
  return s.indexOf('"') !== -1 ? `"${s.replace(/"/g, '""')}"` : s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 ? `"${s}"` : s;
}

// Pre-compiled route regexes
const RE_USER_DELETE = /^\/api\/admin\/users\/([^/]+)\/delete$/;
const RE_BL_REMOVE = /^\/api\/admin\/users\/([^/]+)\/blacklist\/remove$/;
const RE_ORDER_DELETE = /^\/api\/admin\/orders\/([^/]+)\/delete$/;
const RE_FRIEND_REMOVE = /^\/api\/admin\/friends\/remove$/;
const RE_FR_DELETE = /^\/api\/admin\/friend-requests\/([^/]+)\/delete$/;
const RE_SESSION_REVOKE = /^\/api\/admin\/sessions\/([^/]+)\/revoke$/;
const RE_CONV_DELETE = /^\/api\/admin\/conversations\/([^/]+)\/delete$/;

function logAudit(adminUser, action, detail) {
  adminAuditLog.unshift({
    adminId: adminUser.id,
    adminName: adminUser.displayName || adminUser.username,
    action, detail: String(detail || '').slice(0, 200),
    createdAt: Date.now(),
  });
  if (adminAuditLog.length > AUDIT_LOG_MAX) adminAuditLog.length = AUDIT_LOG_MAX;
}

module.exports = function createAdminExtRoutes(ctx) {
  const {
    sendJson, matchRoute,
    getAuthedUser, getAuthedBody,
    isAdmin, requireAdmin,
    sessions, index, db,
    uid,
    hashPasswordAsync,
    generateUniqueAppNumberId, indexNewUser,
    schedulePersist, schedulePersistCritical,
    broadcastAll, broadcastToUser,
    rebuildIndexes, rebuildMallIndex, rebuildFriendViewsIndex, rebuildConversationBaseIndex,
    rebuildBlacklistViewsIndex, rebuildRequestViewsIndex,
    rebuildFriendshipAndRequestIndexes, rebuildRequestIndexesOnly,
    revokeSessionsForUser,
    sseClientsByUser,
    removeFriendshipPair,
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

  return async function handleAdminExtRoutes(pathname, method, req, res, searchParams) {

    // ══════════════════════════════════════════
    //  USER CREATE
    // ══════════════════════════════════════════
    if (matchRoute(pathname, '/api/admin/users/create') && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const b = context.body;
      const username = String(b.username || '').trim().toLowerCase();
      if (!username || username.length < 2 || username.length > 24) return sendJson(res, 400, { error: '用户名需 2-24 位' });
      if (!/^[a-z0-9_]+$/.test(username)) return sendJson(res, 400, { error: '用户名只允许小写字母、数字、下划线' });
      if (index.usersByName.get(username)) return sendJson(res, 400, { error: '用户名已存在' });
      const password = String(b.password || '').trim();
      if (!password || password.length < 4 || password.length > 64) return sendJson(res, 400, { error: '密码长度需 4-64 位' });
      const displayName = String(b.displayName || username).trim().slice(0, 40);
      const role = b.role === 'admin' ? 'admin' : 'user';
      const phone = String(b.phone || '').trim();

      const user = {
        id: uid('u'),
        username,
        password: await hashPasswordAsync(password),
        displayName,
        signature: '',
        avatarUrl: '',
        products: [],
        blacklist: [],
        customGroups: ['我的好友'],
        appNumberId: generateUniqueAppNumberId(),
        createdAt: Date.now(),
        role,
        status: 'active',
        paymentCodes: {},
        phone: phone || '',
        categoryPresets: [],
        specPresets: [],
      };
      db.users.push(user);
      indexNewUser(user);
      logAudit(context.authUser, '创建用户', `${username} (${displayName})`);
      await schedulePersistCritical('admin_user_create', { userId: user.id });
      return sendJson(res, 201, { ok: true, user: { id: user.id, username: user.username, displayName: user.displayName } });
    }

    // ══════════════════════════════════════════
    //  USER DELETE
    // ══════════════════════════════════════════
    const userDeleteMatch = pathname.match(RE_USER_DELETE);
    if (userDeleteMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const userId = userDeleteMatch[1];
      const user = index.usersById.get(userId);
      if (!user) return sendJson(res, 404, { error: 'not_found' });
      if (user.id === context.authUser.id) return sendJson(res, 400, { error: '不能删除自己' });
      // Remove from db.users
      const idx = db.users.indexOf(user);
      if (idx !== -1) db.users.splice(idx, 1);
      // Remove friendships involving this user
      if (Array.isArray(db.friendships)) {
        db.friendships = db.friendships.filter(f => f.userId !== userId && f.friendId !== userId);
      }
      // Remove friend requests involving this user
      if (Array.isArray(db.friendRequests)) {
        db.friendRequests = db.friendRequests.filter(r => r.userId !== userId && r.targetId !== userId);
      }
      // Revoke sessions
      revokeSessionsForUser(userId);
      // Rebuild all indexes
      rebuildIndexes();
      logAudit(context.authUser, '删除用户', `${user.username} (${user.displayName})`);
      await schedulePersistCritical('admin_user_delete', { userId });
      return sendJson(res, 200, { ok: true });
    }

    // ══════════════════════════════════════════
    //  BLACKLIST MANAGEMENT
    // ══════════════════════════════════════════
    const blRemoveMatch = pathname.match(RE_BL_REMOVE);
    if (blRemoveMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const user = index.usersById.get(blRemoveMatch[1]);
      if (!user) return sendJson(res, 404, { error: 'not_found' });
      const targetId = String(context.body.targetId || '');
      if (!targetId) return sendJson(res, 400, { error: 'missing_target' });
      if (!Array.isArray(user.blacklist)) return sendJson(res, 200, { ok: true });
      const bi = user.blacklist.indexOf(targetId);
      if (bi !== -1) user.blacklist.splice(bi, 1);
      if (user._blacklistSet) user._blacklistSet.delete(targetId);
      rebuildBlacklistViewsIndex();
      schedulePersist('admin_blacklist_remove', { userId: user.id, targetId });
      return sendJson(res, 200, { ok: true });
    }

    // ══════════════════════════════════════════
    //  ORDER DELETE
    // ══════════════════════════════════════════
    const orderDeleteMatch = pathname.match(RE_ORDER_DELETE);
    if (orderDeleteMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const orderId = orderDeleteMatch[1];
      const order = index.ordersById.get(orderId);
      if (!order) return sendJson(res, 404, { error: 'not_found' });
      const oi = (db.orders || []).indexOf(order);
      if (oi !== -1) db.orders.splice(oi, 1);
      index.ordersById.delete(orderId);
      // Remove from buyer/seller indexes
      const buyerOrders = index.ordersByBuyer.get(order.buyerId);
      if (buyerOrders) {
        const bi = buyerOrders.indexOf(order);
        if (bi !== -1) buyerOrders.splice(bi, 1);
      }
      const sellerOrders = index.ordersBySeller.get(order.sellerId);
      if (sellerOrders) {
        const si = sellerOrders.indexOf(order);
        if (si !== -1) sellerOrders.splice(si, 1);
      }
      logAudit(context.authUser, '删除订单', orderId);
      await schedulePersistCritical('admin_order_delete', { orderId });
      return sendJson(res, 200, { ok: true });
    }

    // ══════════════════════════════════════════
    //  FRIEND MANAGEMENT
    // ══════════════════════════════════════════

    // List all friendships
    if (matchRoute(pathname, '/api/admin/friends') && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const { limit, offset } = paginate(searchParams);
      const q = String(searchParams.get('q') || '').trim().toLowerCase();
      // Deduplicate: only show one record per pair (userId < friendId)
      const seen = new Set();
      let pairs = [];
      const friendNameCache = new Map();
      const getFriendName = (id) => {
        let name = friendNameCache.get(id);
        if (name === undefined) { const u = index.usersById.get(id); name = u?.displayName || id; friendNameCache.set(id, name); }
        return name;
      };
      for (const f of (db.friendships || [])) {
        const key = f.userId < f.friendId ? `${f.userId}:${f.friendId}` : `${f.friendId}:${f.userId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const userName = getFriendName(f.userId);
        const friendName = getFriendName(f.friendId);
        if (q && !userName.toLowerCase().includes(q) && !friendName.toLowerCase().includes(q)) continue;
        pairs.push({
          userId: f.userId, friendId: f.friendId,
          userName, friendName,
          group: f.group || '我的好友',
          remark: f.remark || '',
        });
      }
      return sendJson(res, 200, slicePage(pairs, offset, limit));
    }

    // Admin remove friendship
    const friendRemoveMatch = pathname.match(RE_FRIEND_REMOVE);
    if (friendRemoveMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const { userId, friendId } = context.body;
      if (!userId || !friendId) return sendJson(res, 400, { error: 'missing_params' });
      removeFriendshipPair(userId, friendId);
      rebuildFriendViewsIndex();
      rebuildConversationBaseIndex();
      logAudit(context.authUser, '解除好友', `${userId} ↔ ${friendId}`);
      schedulePersist('admin_friend_remove', { userId, friendId });
      return sendJson(res, 200, { ok: true });
    }

    // List friend requests
    if (matchRoute(pathname, '/api/admin/friend-requests') && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const { limit, offset } = paginate(searchParams);
      const statusFilter = searchParams.get('status') || '';
      // Filter first, then sort only the smaller filtered set
      const rawRequests = db.friendRequests || [];
      let requests = statusFilter
        ? rawRequests.filter(r => r.status === statusFilter)
        : rawRequests.slice();
      requests.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const result = slicePage(requests, offset, limit);
      result.items = result.items.map(r => {
        const sender = index.usersById.get(r.userId);
        const target = index.usersById.get(r.targetId);
        return {
          id: r.id, status: r.status, greeting: r.greeting || '',
          userId: r.userId, targetId: r.targetId,
          senderName: sender?.displayName || r.userId,
          targetName: target?.displayName || r.targetId,
          createdAt: r.createdAt,
        };
      });
      return sendJson(res, 200, result);
    }

    // Admin delete friend request
    const frDeleteMatch = pathname.match(RE_FR_DELETE);
    if (frDeleteMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const reqId = frDeleteMatch[1];
      const reqObj = index.friendRequestsById.get(reqId);
      if (!reqObj) return sendJson(res, 404, { error: 'not_found' });
      // Remove from array using indexOf on the reference (faster than findIndex with predicate)
      const ri = (db.friendRequests || []).indexOf(reqObj);
      if (ri !== -1) db.friendRequests.splice(ri, 1);
      rebuildRequestIndexesOnly();
      schedulePersist('admin_friend_request_delete', { requestId: reqId });
      return sendJson(res, 200, { ok: true });
    }

    // ══════════════════════════════════════════
    //  SESSION MANAGEMENT
    // ══════════════════════════════════════════

    // List active sessions
    if (matchRoute(pathname, '/api/admin/sessions') && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const { limit, offset } = paginate(searchParams);
      const q = String(searchParams.get('q') || '').trim().toLowerCase();
      const now = Date.now();
      let sessionList = [];
      const sessUserCache = new Map();
      for (const [token, sess] of sessions) {
        if (sess.expiresAt <= now) continue;
        let userInfo = sessUserCache.get(sess.userId);
        if (!userInfo) {
          const user = index.usersById.get(sess.userId);
          userInfo = { displayName: user?.displayName || sess.userId, username: user?.username || '' };
          sessUserCache.set(sess.userId, userInfo);
        }
        if (q && !userInfo.displayName.toLowerCase().includes(q) && !userInfo.username.toLowerCase().includes(q)) continue;
        sessionList.push({
          tokenPrefix: token.slice(0, 8) + '…',
          userId: sess.userId,
          displayName: userInfo.displayName,
          username: userInfo.username,
          createdAt: sess.createdAt,
          expiresAt: sess.expiresAt,
          remainingHours: Math.round((sess.expiresAt - now) / 3600000),
        });
      }
      sessionList.sort((a, b) => b.createdAt - a.createdAt);
      return sendJson(res, 200, slicePage(sessionList, offset, limit));
    }

    // Force logout user (revoke all sessions)
    const sessionRevokeMatch = pathname.match(RE_SESSION_REVOKE);
    if (sessionRevokeMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const userId = sessionRevokeMatch[1];
      revokeSessionsForUser(userId);
      logAudit(context.authUser, '强制下线', userId);
      return sendJson(res, 200, { ok: true });
    }

    // ══════════════════════════════════════════
    //  ONLINE USERS (SSE connections)
    // ══════════════════════════════════════════
    if (matchRoute(pathname, '/api/admin/online') && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const onlineList = [];
      for (const [userId, conns] of sseClientsByUser) {
        if (!conns || conns.size === 0) continue;
        const user = index.usersById.get(userId);
        onlineList.push({
          userId,
          displayName: user?.displayName || userId,
          username: user?.username || '',
          avatarUrl: user?.avatarUrl || '',
          connections: conns.size,
        });
      }
      onlineList.sort((a, b) => a.displayName.localeCompare(b.displayName));
      return sendJson(res, 200, { items: onlineList, total: onlineList.length });
    }

    // ══════════════════════════════════════════
    //  DATA EXPORT
    // ══════════════════════════════════════════
    if (matchRoute(pathname, '/api/admin/export/users') && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const rows = [['ID', '用户名', '昵称', '手机号', 'APP号', '角色', '状态', '商品数', '注册时间'].join(',')];
      for (const u of db.users) {
        rows.push([
          u.id, u.username, csvField(u.displayName),
          u.phone || '', u.appNumberId || '', u.role || 'user', u.status || 'active',
          Array.isArray(u.products) ? u.products.length : 0,
          u.createdAt ? new Date(u.createdAt).toISOString() : '',
        ].join(','));
      }
      const csv = rows.join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="users_export.csv"',
      });
      res.end('\uFEFF' + csv); // BOM for Excel
      return true;
    }

    if (matchRoute(pathname, '/api/admin/export/orders') && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const rows = [['订单号', '买家', '卖家', '金额', '状态', '商品摘要', '备注', '创建时间', '更新时间'].join(',')];
      const exportNameCache = new Map();
      for (const o of (db.orders || [])) {
        let buyerName = exportNameCache.get(o.buyerId);
        if (buyerName === undefined) { const u = index.usersById.get(o.buyerId); buyerName = u?.displayName || o.buyerId; exportNameCache.set(o.buyerId, buyerName); }
        let sellerName = exportNameCache.get(o.sellerId);
        if (sellerName === undefined) { const u = index.usersById.get(o.sellerId); sellerName = u?.displayName || o.sellerId; exportNameCache.set(o.sellerId, sellerName); }
        const items = o.items || [];
        const parts = new Array(items.length);
        for (let j = 0; j < items.length; j++) parts[j] = `${items[j].title}×${items[j].quantity}`;
        rows.push([
          o.id, buyerName, sellerName,
          Number(o.total) || 0, o.status || '',
          csvField(parts.join('; ')),
          csvField(o.remark),
          o.createdAt ? new Date(o.createdAt).toISOString() : '',
          o.updatedAt ? new Date(o.updatedAt).toISOString() : '',
        ].join(','));
      }
      const csv = rows.join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="orders_export.csv"',
      });
      res.end('\uFEFF' + csv);
      return true;
    }

    // ══════════════════════════════════════════
    //  CONVERSATION DELETE
    // ══════════════════════════════════════════
    const convDeleteMatch = pathname.match(RE_CONV_DELETE);
    if (convDeleteMatch && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const convId = convDeleteMatch[1];
      const conv = index.convById.get(convId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      // Remove messages
      const msgs = index.messagesByConv.get(convId) || [];
      for (const m of msgs) index.messagesById.delete(m.id);
      index.messagesByConv.delete(convId);
      if (Array.isArray(db.messages)) {
        let w = 0;
        for (let r = 0; r < db.messages.length; r++) {
          if (db.messages[r].conversationId !== convId) db.messages[w++] = db.messages[r];
        }
        db.messages.length = w;
      }
      // Remove conversation
      const ci = (db.conversations || []).indexOf(conv);
      if (ci !== -1) db.conversations.splice(ci, 1);
      index.convById.delete(convId);
      rebuildConversationBaseIndex();
      logAudit(context.authUser, '删除会话', convId);
      await schedulePersistCritical('admin_conv_delete', { convId });
      return sendJson(res, 200, { ok: true });
    }

    // ══════════════════════════════════════════
    //  GLOBAL MESSAGE SEARCH
    // ══════════════════════════════════════════
    if (matchRoute(pathname, '/api/admin/messages/search') && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const q = String(searchParams.get('q') || '').trim().toLowerCase();
      if (!q || q.length < 2) return sendJson(res, 200, { items: [], total: 0 });
      const { limit, offset } = paginate(searchParams);
      const results = [];
      const allMsgs = db.messages || [];
      const nameCache = new Map();
      const maxScan = offset + limit + 100;
      for (let i = allMsgs.length - 1; i >= 0 && results.length < maxScan; i--) {
        const m = allMsgs[i];
        if (!m.text || m.type === 'system') continue;
        if (m.text.toLowerCase().includes(q)) {
          let senderName = nameCache.get(m.senderId);
          if (senderName === undefined) {
            const sender = index.usersById.get(m.senderId);
            senderName = sender?.displayName || m.senderId || '系统';
            nameCache.set(m.senderId, senderName);
          }
          const conv = index.convById.get(m.conversationId);
          let memberNames = '';
          if (conv) {
            const members = conv.members || [];
            const names = new Array(members.length);
            for (let j = 0; j < members.length; j++) {
              const mid = members[j];
              let n = nameCache.get(mid);
              if (n === undefined) { const u = index.usersById.get(mid); n = u?.displayName || mid; nameCache.set(mid, n); }
              names[j] = n;
            }
            memberNames = names.join(' ↔ ');
          }
          results.push({
            id: m.id, text: m.text, type: m.type,
            senderId: m.senderId, senderName,
            conversationId: m.conversationId, conversationName: memberNames,
            createdAt: m.createdAt,
          });
        }
      }
      return sendJson(res, 200, slicePage(results, offset, limit));
    }

    // ══════════════════════════════════════════
    //  ADMIN CHANGE OWN PASSWORD
    // ══════════════════════════════════════════
    if (matchRoute(pathname, '/api/admin/change-password') && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context || !isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const { oldPassword, newPassword } = context.body;
      if (!oldPassword || !newPassword) return sendJson(res, 400, { error: '请填写旧密码和新密码' });
      const { verifyPasswordAsync } = ctx;
      const valid = await verifyPasswordAsync(oldPassword, context.authUser.password);
      if (!valid) return sendJson(res, 400, { error: '旧密码不正确' });
      if (newPassword.length < 4 || newPassword.length > 64) return sendJson(res, 400, { error: '新密码长度需 4-64 位' });
      context.authUser.password = await hashPasswordAsync(newPassword);
      await schedulePersistCritical('admin_change_password', { userId: context.authUser.id });
      return sendJson(res, 200, { ok: true });
    }

    // ══════════════════════════════════════════
    //  ADMIN OPERATION LOG (in-memory ring buffer)
    // ══════════════════════════════════════════
    if (matchRoute(pathname, '/api/admin/audit-log') && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const { limit, offset } = paginate(searchParams);
      return sendJson(res, 200, slicePage(adminAuditLog, offset, limit));
    }

    // ══════════════════════════════════════════
    //  SIDEBAR BADGE COUNTS
    // ══════════════════════════════════════════
    if (matchRoute(pathname, '/api/admin/badge-counts') && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      // Single-pass counting instead of .filter().length (avoids 3 temporary array allocations)
      let pendingOrders = 0;
      const orders = db.orders || [];
      for (let i = 0; i < orders.length; i++) { if (orders[i].status === 'pending') pendingOrders++; }
      let pendingRequests = 0;
      const reqs = db.friendRequests || [];
      for (let i = 0; i < reqs.length; i++) { if (reqs[i].status === 'pending') pendingRequests++; }
      // sseClientsByUser entries with empty Sets are already cleaned up, so .size = online user count
      return sendJson(res, 200, { pendingOrders, pendingRequests, onlineCount: sseClientsByUser.size });
    }

    // ══════════════════════════════════════════
    //  SYSTEM INFO
    // ══════════════════════════════════════════
    if (matchRoute(pathname, '/api/admin/system/info') && method === 'GET') {
      const authUser = adminGuard(req, res, searchParams);
      if (!authUser) return true;
      const mem = process.memoryUsage();
      return sendJson(res, 200, {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: Math.floor(process.uptime()),
        memoryMB: {
          rss: Math.round(mem.rss / 1048576),
          heapUsed: Math.round(mem.heapUsed / 1048576),
          heapTotal: Math.round(mem.heapTotal / 1048576),
        },
        activeSessions: sessions.size,
        onlineUsers: sseClientsByUser.size,
        dataStats: {
          users: db.users.length,
          orders: (db.orders || []).length,
          conversations: (db.conversations || []).length,
          messages: (db.messages || []).length,
          friendships: (db.friendships || []).length,
          friendRequests: (db.friendRequests || []).length,
          systemMessages: (db.systemMessages || []).length,
        },
      });
    }

    return false;
  };
};
