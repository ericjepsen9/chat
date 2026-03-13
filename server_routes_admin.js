/* server_routes_admin.js — Admin and system message route handlers */

const SYSTEM_MSG_LIMITS = { TITLE: 80, SUMMARY: 240, COVER: 512, LIST_MAX: 30, STORE_MAX: 100 };

module.exports = function createAdminRoutes(ctx) {
  const {
    sendJson,
    getAuthedUser, getAuthedBody,
    isAdmin, requireAdmin,
    sessions, index, db,
    uid,
    buildAdminDashboardData,
    schedulePersistCritical,
    broadcastAll,
  } = ctx;

  return async function handleAdminRoutes(pathname, method, req, res, searchParams) {

    if (pathname === '/api/system/messages' && method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      return sendJson(res, 200, { items: (db.systemMessages || []).slice(0, SYSTEM_MSG_LIMITS.LIST_MAX) });
    }

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

    if (pathname === '/api/admin/dashboard' && method === 'GET') {
      const authUser = requireAdmin(req, res, searchParams, sessions, index, sendJson, isAdmin);
      if (!authUser) return true;
      const data = buildAdminDashboardData(db);
      return sendJson(res, 200, data);
    }

    return false; // not handled
  };
};
