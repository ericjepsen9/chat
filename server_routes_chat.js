/* server_routes_chat.js — Conversation & message route handlers */

const SEARCH_LIMITS = { GLOBAL_DEFAULT: 20, GLOBAL_MAX: 50, CONV_DEFAULT: 30, CONV_MAX: 100 };

// Pre-compiled route regexes — avoid re-compilation on every request
const RE_CONV_SEARCH = /(?:\/api)?\/conversations\/([^/]+)\/messages\/search$/;
const RE_CONV_MSG = /(?:\/api)?\/conversations\/([^/]+)\/messages$/;
const RE_CONV_MSG_ACTION = /(?:\/api)?\/conversations\/([^/]+)\/messages\/([^/]+)\/(delete|recall)$/;
const RE_CONV_ACTION = /(?:\/api)?\/conversations\/([^/]+)\/(delete|recall|read|signal|call|mute|pin|clear)$/;

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
    getDirectConversation, areFriends, addToMapArray, invalidateConvMeta, uid,
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
        convByUser: index.convByUser,
        usersById: index.usersById,
        friendshipByPair: index.friendshipByPair,
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
      const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || String(SEARCH_LIMITS.GLOBAL_DEFAULT), 10) || SEARCH_LIMITS.GLOBAL_DEFAULT), SEARCH_LIMITS.GLOBAL_MAX);
      const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
      return sendJson(res, 200, searchMessagesGlobal({ authUser, keyword, limit, offset, index, isMessageVisibleToUser }));
    }

    // Match regex routes: check method first to skip expensive regex when possible
    const convSearchMatch = method === 'GET' && pathname.match(RE_CONV_SEARCH);
    if (convSearchMatch) {
      const conversationId = convSearchMatch[1];
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      if (!(conv._memberSet.has(authUser.id))) return sendJson(res, 403, { error: 'forbidden' });
      const keyword = (searchParams.get('keyword') || '').trim().toLowerCase();
      if (!keyword || keyword.length < 1) return sendJson(res, 400, { error: 'keyword_required' });
      const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || String(SEARCH_LIMITS.CONV_DEFAULT), 10) || SEARCH_LIMITS.CONV_DEFAULT), SEARCH_LIMITS.CONV_MAX);
      const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
      return sendJson(res, 200, searchMessagesInConversation({ conv, keyword, limit, offset, authUserId: authUser.id, index, isMessageVisibleToUser }));
    }

    const convMsgMatch = pathname.match(RE_CONV_MSG);
    if (convMsgMatch) {
      const conversationId = convMsgMatch[1];
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });

      if (method === 'GET') {
        const authUser = getAuthedUser(req, res, { searchParams });
        if (!authUser) return true;
        if (!(conv._memberSet ? conv._memberSet.has(authUser.id) : conv.members.includes(authUser.id))) return sendJson(res, 403, { error: 'forbidden' });
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
        if (!(conv._memberSet ? conv._memberSet.has(context.authUser.id) : conv.members.includes(context.authUser.id))) return sendJson(res, 403, { error: 'forbidden' });
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
          invalidateConvMeta,
          schedulePersist,
          broadcastToConversation,
        });
        return sendResult(res, result);
      }
    }

    const convMsgActionMatch = method === 'POST' && pathname.match(RE_CONV_MSG_ACTION);
    if (convMsgActionMatch) {
      const [_, conversationId, messageId, action] = convMsgActionMatch;
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const authUser = getAuthedUser(req, res);
      if (!authUser) return true;
      if (!(conv._memberSet.has(authUser.id))) return sendJson(res, 403, { error: 'forbidden' });

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

    const convActionMatch = method === 'POST' && pathname.match(RE_CONV_ACTION);
    if (convActionMatch) {
      const conversationId = convActionMatch[1];
      const action = convActionMatch[2];
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      if (!(conv._memberSet.has(context.authUser.id))) return sendJson(res, 403, { error: 'forbidden' });

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
        invalidateConvMeta,
        schedulePersist,
        broadcastToUser,
        broadcastToConversation,
      });

      return sendResult(res, result);
    }

    return false; // not handled
  };
};
