/* server_routes_social.js — Friend, group, and blacklist route handlers */

module.exports = function createSocialRoutes(ctx) {
  const {
    matchRoute, sendJson, sendResult,
    getAuthedUser, getAuthedActingBody,
    sanitizePublicUser, normalizePhone, findUserByPhone,
    areFriends, getDirectConversation, getOrCreateDirectConversation,
    removeFriendshipPair, uid,
    index, db,
    createFriendRequest, acceptFriendRequest, rejectFriendRequest,
    updateBlacklist, updateFriendRemark, updateFriendGroup, deleteFriendRelation,
    createGroup, renameGroup, reorderGroup, deleteGroup,
    listFriendRequests, listFriends,
    rebuildFriendViewsIndex, rebuildConversationBaseIndex,
    rebuildBlacklistViewsIndex, rebuildRequestViewsIndex,
    rebuildFriendshipAndRequestIndexes, rebuildRequestIndexesOnly,
    normalizeSingleGroupName, normalizeUserCustomGroups,
    DEFAULT_GROUP,
    schedulePersist, broadcastToUser,
    addTradeMessage,
  } = ctx;

  return async function handleSocialRoutes(pathname, method, req, res, searchParams) {

    // --- GET routes (3 routes) ---
    if (method === 'GET') {
      if (matchRoute(pathname, '/api/blacklist')) {
        const authUser = getAuthedUser(req, res, { searchParams });
        if (!authUser) return true;
        const blacklist = index.blacklistViewsByUser.get(authUser.id) || [];
        return sendJson(res, 200, { users: blacklist });
      }

      if (matchRoute(pathname, '/api/users/search')) {
        const authUser = getAuthedUser(req, res, { searchParams });
        if (!authUser) return true;
        const keyword = String(searchParams.get('keyword') || '').trim();
        if (!keyword) return sendJson(res, 400, { error: '请输入搜索内容' });
        const target = index.usersByName.get(keyword) || index.usersByAppNumber.get(keyword) || findUserByPhone(keyword);
        if (!target || target.id === authUser.id) return sendJson(res, 404, { error: '未找到该用户' });
        return sendJson(res, 200, { user: sanitizePublicUser(target) });
      }

      if (matchRoute(pathname, '/api/friends/requests')) {
        const authUser = getAuthedUser(req, res, { searchParams });
        if (!authUser) return true;
        const data = listFriendRequests({
          authUser,
          requestViewsByTarget: index.requestViewsByTarget,
        });
        return sendJson(res, 200, data);
      }

      if (matchRoute(pathname, '/api/friends')) {
        const authUser = getAuthedUser(req, res, { searchParams });
        if (!authUser) return true;
        const data = listFriends({
          authUser,
          friendViewsByUser: index.friendViewsByUser,
        });
        return sendJson(res, 200, data);
      }

      return false;
    }

    // --- POST routes only below ---
    if (method !== 'POST') return false;

    if (matchRoute(pathname, '/api/blacklist')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = updateBlacklist({
        authUser: context.authUser,
        targetId: context.body.targetId,
        action: context.body.action,
        index,
        rebuildBlacklistViewsIndex,
        schedulePersist,
        removeFriendshipPair,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        broadcastToUser,
      });
      return sendResult(res, result);
    }

    // Both /api/friends/request and /api/friends POST create a friend request
    if (pathname === '/api/friends/request' || pathname === '/api/friends') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = createFriendRequest({
        reqBody: context.body,
        authUser: context.authUser,
        index,
        db,
        areFriends,
        uid,
        rebuildFriendshipAndRequestIndexes,
        schedulePersist,
        broadcastToUser,
        findUserByPhone,
        getOrCreateDirectConversation,
      });
      // Send welcome message when auto-accepted (both sides had pending requests)
      if (result.ok && result.payload?.autoAccepted) {
        const keyword = String(context.body.friendUsername || '').trim();
        const target = index.usersByName.get(keyword) || index.usersByAppNumber.get(keyword) || (findUserByPhone ? findUserByPhone(keyword) : null);
        if (target) {
          const conv = getOrCreateDirectConversation(context.authUser.id, target.id, { skipBlacklistCheck: true });
          if (conv) {
            addTradeMessage(conv.id, {
              senderId: context.authUser.id,
              type: 'text',
              text: '我们已经是好友了，开始聊天吧！',
            });
          }
        }
      }
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/friends/accept')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = acceptFriendRequest({
        requestId: context.body.requestId,
        authUser: context.authUser,
        db,
        index,
        uid,
        getDirectConversation,
        rebuildFriendshipAndRequestIndexes,
        schedulePersist,
        broadcastToUser,
      });
      // Send welcome message after successful acceptance
      if (result.ok) {
        const request = index.friendRequestsById.get(context.body.requestId);
        if (request) {
          const conv = getOrCreateDirectConversation(context.authUser.id, request.userId, { skipBlacklistCheck: true });
          if (conv) {
            const greeting = request.greeting || '';
            const welcomeText = greeting
              ? `我们已经是好友了，开始聊天吧！对方的招呼：${greeting}`
              : '我们已经是好友了，开始聊天吧！';
            addTradeMessage(conv.id, {
              senderId: context.authUser.id,
              type: 'text',
              text: welcomeText,
            });
          }
        }
      }
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/friends/reject')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = rejectFriendRequest({
        requestId: context.body.requestId,
        authUser: context.authUser,
        db,
        index,
        rebuildRequestIndexesOnly,
        schedulePersist,
        broadcastToUser,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/friends/remark')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = updateFriendRemark({
        authUser: context.authUser,
        friendId: context.body.friendId,
        group: context.body.group,
        remark: context.body.remark,
        friendshipByPair: index.friendshipByPair,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        schedulePersist,
        broadcastToUser,
        defaultGroup: DEFAULT_GROUP,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/groups/create')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = createGroup({
        authUser: context.authUser,
        rawName: context.body.name,
        defaultGroup: DEFAULT_GROUP,
        normalizeSingleGroupName,
        normalizeUserCustomGroups,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        schedulePersist,
        broadcastToUser,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/groups/rename')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = renameGroup({
        authUser: context.authUser,
        groupNameRaw: context.body.groupName,
        newNameRaw: context.body.newName,
        defaultGroup: DEFAULT_GROUP,
        normalizeSingleGroupName,
        normalizeUserCustomGroups,
        friendshipsByUser: index.friendshipsByUser,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        schedulePersist,
        broadcastToUser,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/groups/reorder')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = reorderGroup({
        authUser: context.authUser,
        groupNameRaw: context.body.groupName,
        offsetRaw: context.body.offset,
        defaultGroup: DEFAULT_GROUP,
        normalizeSingleGroupName,
        normalizeUserCustomGroups,
        schedulePersist,
        broadcastToUser,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/groups/delete')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = deleteGroup({
        authUser: context.authUser,
        groupNameRaw: context.body.groupName,
        defaultGroup: DEFAULT_GROUP,
        normalizeSingleGroupName,
        normalizeUserCustomGroups,
        friendshipsByUser: index.friendshipsByUser,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        schedulePersist,
        broadcastToUser,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/friends/group')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = updateFriendGroup({
        authUser: context.authUser,
        friendId: context.body.friendId,
        groupRaw: context.body.group,
        friendshipByPair: index.friendshipByPair,
        normalizeSingleGroupName,
        defaultGroup: DEFAULT_GROUP,
        schedulePersist,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        broadcastToUser,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/friends/delete')) {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return true;
      const result = deleteFriendRelation({
        authUser: context.authUser,
        friendId: context.body.friendId,
        usersById: index.usersById,
        removeFriendshipPair,
        getDirectConversation,
        schedulePersist,
        broadcastToUser,
      });
      return sendResult(res, result);
    }

    return false; // not handled
  };
};
