/* server_routes_chat.js — Conversation & message route handlers */

const SEARCH_LIMITS = { GLOBAL_DEFAULT: 20, GLOBAL_MAX: 50, CONV_DEFAULT: 30, CONV_MAX: 100 };

module.exports = function createChatRoutes(ctx) {
  const {
    matchRoute, sendJson, sendResult,
    getAuthedUser, getAuthedBody, getAuthedActingBody,
    ensureActingUser,
    isMessageVisibleToUser, getVisibleMessagesSlice, buildConversationMeta,
    searchMessagesGlobal, searchMessagesInConversation,
    listConversations, listConversationMessages, createConversationMessage,
    deleteConversationMessage, recallConversationMessage, applyConversationAction,
    createDirectConversation,
    getDirectConversation, areFriends, addToMapArray, uid,
    index, db,
    schedulePersist, broadcastToUser, broadcastToConversation,
    indexNewConversation,
    canAccessConversation,
  } = ctx;

  return async function handleChatRoutes(pathname, method, req, res, searchParams) {

    if (matchRoute(pathname, '/api/conversations') && method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      const data = listConversations({
        authUser,
        directConvBasesByUser: index.directConvBasesByUser,
        convById: index.convById,
        buildConversationMeta,
      });
      return sendJson(res, 200, data);
    }

    if (matchRoute(pathname, '/api/conversations') && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      ensureActingUser(context.body, context.authUser, 'creatorId');
      const peerId = (context.body.memberIds || [])[0];
      const result = createDirectConversation({
        authUser: context.authUser,
        peerId,
        usersById: index.usersById,
        getDirectConversation,
        uid,
        db,
        indexNewConversation,
        schedulePersist,
        broadcastToUser,
      });
      return sendResult(res, result);
    }

    if (matchRoute(pathname, '/api/messages/search') && method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      const keyword = (searchParams.get('keyword') || '').trim().toLowerCase();
      if (!keyword || keyword.length < 1) return sendJson(res, 400, { error: 'keyword_required' });
      const limit = Math.min(parseInt(searchParams.get('limit') || String(SEARCH_LIMITS.GLOBAL_DEFAULT), 10), SEARCH_LIMITS.GLOBAL_MAX);
      const offset = parseInt(searchParams.get('offset') || '0', 10);
      return sendJson(res, 200, searchMessagesGlobal({ authUser, keyword, limit, offset, index, isMessageVisibleToUser }));
    }

    const convSearchMatch = pathname.match(/(?:\/api)?\/conversations\/([^/]+)\/messages\/search$/);
    if (convSearchMatch && method === 'GET') {
      const conversationId = convSearchMatch[1];
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      if (!conv.members.includes(authUser.id)) return sendJson(res, 403, { error: 'forbidden' });
      const keyword = (searchParams.get('keyword') || '').trim().toLowerCase();
      if (!keyword || keyword.length < 1) return sendJson(res, 400, { error: 'keyword_required' });
      const limit = Math.min(parseInt(searchParams.get('limit') || String(SEARCH_LIMITS.CONV_DEFAULT), 10), SEARCH_LIMITS.CONV_MAX);
      const offset = parseInt(searchParams.get('offset') || '0', 10);
      return sendJson(res, 200, searchMessagesInConversation({ conv, keyword, limit, offset, authUserId: authUser.id, index, isMessageVisibleToUser }));
    }

    const convMsgMatch = pathname.match(/(?:\/api)?\/conversations\/([^/]+)\/messages$/);
    if (convMsgMatch) {
      const conversationId = convMsgMatch[1];
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });

      if (method === 'GET') {
        const authUser = getAuthedUser(req, res, { searchParams });
        if (!authUser) return true;
        const result = listConversationMessages({
          conv,
          authUser,
          searchParams,
          getVisibleMessagesSlice,
        });
        return sendResult(res, result);
      }

      if (method === 'POST') {
        const context = await getAuthedBody(req, res);
        if (!context) return true;
        ensureActingUser(context.body, context.authUser, 'senderId');
        const result = createConversationMessage({
          conversationId,
          conv,
          authUser: context.authUser,
          body: context.body,
          index,
          areFriends,
          uid,
          db,
          addToMapArray,
          schedulePersist,
          broadcastToConversation,
        });
        return sendResult(res, result);
      }
    }

    const convMsgActionMatch = pathname.match(/(?:\/api)?\/conversations\/([^/]+)\/messages\/([^/]+)\/(delete|recall)$/);
    if (convMsgActionMatch && method === 'POST') {
      const [_, conversationId, messageId, action] = convMsgActionMatch;
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const authUser = getAuthedUser(req, res);
      if (!authUser) return true;
      if (!conv.members.includes(authUser.id)) return sendJson(res, 403, { error: 'forbidden' });

      const result = action === 'delete'
        ? deleteConversationMessage({
          conversationId,
          messageId,
          authUser,
          index,
          schedulePersist,
          broadcastToUser,
          persistEvent: 'message_delete',
        })
        : recallConversationMessage({
          conversationId,
          messageId,
          authUser,
          index,
          schedulePersist,
          broadcastToConversation,
          persistEvent: 'message_recall',
        });

      return sendResult(res, result);
    }

    const convActionMatch = pathname.match(/(?:\/api)?\/conversations\/([^/]+)\/(delete|recall|read|signal|call|mute|pin|clear)$/);
    if (convActionMatch && method === 'POST') {
      const conversationId = convActionMatch[1];
      const action = convActionMatch[2];
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      if (!conv.members.includes(context.authUser.id)) return sendJson(res, 403, { error: 'forbidden' });

      const result = applyConversationAction({
        action,
        conversationId,
        body: context.body,
        authUser: context.authUser,
        conv,
        db,
        index,
        uid,
        addToMapArray,
        schedulePersist,
        broadcastToUser,
        broadcastToConversation,
      });

      return sendResult(res, result);
    }

    return false; // not handled
  };
};
