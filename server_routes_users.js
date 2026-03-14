/* server_routes_users.js — User profile, store, and phone change route handlers */

const RE_USER_PROFILE = /(?:\/api)?\/users\/([^/]+)\/profile$/;
const RE_USER_STORE = /^\/api\/users\/([^/]+)\/store$/;
const RE_CODE_4DIGIT = /^\d{4}$/;

module.exports = function createUserRoutes(ctx) {
  const {
    matchRoute, sendJson, sendResult,
    getAuthedUser, getAuthedActingBody,
    normalizePhone, findUserByPhone, consumePhoneCode,
    sanitizePublicUser,
    normalizeUserCustomGroups,
    index, db,
    updateUserProfile, buildUserProfileView, buildUserStoreItems,
    rebuildFriendViewsIndex, rebuildConversationBaseIndex,
    rebuildRequestViewsIndex, rebuildBlacklistViewsIndex, rebuildMallIndex,
    schedulePersist,
    broadcastToUser, broadcastAll,
  } = ctx;

  return async function handleUserRoutes(pathname, method, req, res, searchParams) {

    if (matchRoute(pathname, '/api/users') && method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      const users = [];
      for (let i = 0; i < db.users.length; i++) {
        const u = db.users[i];
        if (u.status === 'disabled') continue;
        if (u.id !== authUser.id) users.push({ id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, appNumberId: u.appNumberId });
      }
      return sendJson(res, 200, { users });
    }

    if (matchRoute(pathname, '/api/users/update') && method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = updateUserProfile({
        authUser: context.authUser,
        body: context.body,
        normalizePhone,
        findUserByPhone,
        normalizeUserCustomGroups,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        rebuildRequestViewsIndex,
        rebuildBlacklistViewsIndex,
        rebuildMallIndex,
        schedulePersist,
        broadcastToUser,
        broadcastAll,
        sanitizePublicUser,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/users/change-phone') && method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const phone = normalizePhone(context.body.phone || '');
      const code = String(context.body.code || '').trim();
      if (!phone) return sendJson(res, 400, { error: '手机号格式错误' });
      if (!RE_CODE_4DIGIT.test(code)) return sendJson(res, 400, { error: '验证码错误' });
      const verify = consumePhoneCode(phone, code, 'reset');
      if (!verify.ok) {
        const statusCode = verify.retryAfterSec ? 429 : 400;
        return sendJson(res, statusCode, { error: verify.error || '验证码错误或已过期', retryAfterSec: verify.retryAfterSec || 0 });
      }
      const existing = findUserByPhone(phone);
      if (existing && existing.id !== context.authUser.id) return sendJson(res, 409, { error: '该手机号已被注册' });
      const result = updateUserProfile({
        authUser: context.authUser,
        body: { phone },
        normalizePhone,
        findUserByPhone,
        normalizeUserCustomGroups,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        rebuildRequestViewsIndex,
        rebuildBlacklistViewsIndex,
        rebuildMallIndex,
        schedulePersist,
        broadcastToUser,
        broadcastAll,
        sanitizePublicUser,
      });
      return sendResult(res, result);
    }

    const profileMatch = pathname.match(RE_USER_PROFILE);
    if (profileMatch && method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      const targetId = profileMatch[1];
      if (targetId !== authUser.id) {
        const targetUser = index.usersById.get(targetId);
        if (!targetUser) return sendJson(res, 404, { error: '用户不存在' });
      }
      const result = buildUserProfileView({
        authUser,
        targetId,
        usersById: index.usersById,
        friendshipByPair: index.friendshipByPair,
      });
      return sendResult(res, result);
    }

    const storeMatch = pathname.match(RE_USER_STORE);
    if (storeMatch && method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      const sellerId = storeMatch[1];
      const sellerUser = index.usersById.get(sellerId);
      if (!sellerUser) return sendJson(res, 404, { error: '用户不存在' });
      const result = buildUserStoreItems({
        usersById: index.usersById,
        sellerId,
      });
      return sendResult(res, result);
    }

    return false; // not handled
  };
};
