/* server_routes_group_chat.js — Group chat API route handlers */

const RE_GROUP_CHAT_ID = /(?:\/api)?\/group-chat\/([^/]+)$/;
const RE_GROUP_CHAT_ACTION = /(?:\/api)?\/group-chat\/([^/]+)\/(update|dismiss|transfer|nickname|mute-member)$/;
const RE_GROUP_CHAT_MEMBERS = /(?:\/api)?\/group-chat\/([^/]+)\/members\/(add|remove|leave)$/;
const RE_GROUP_CHAT_ADMINS = /(?:\/api)?\/group-chat\/([^/]+)\/admins\/(add|remove)$/;

module.exports = function createGroupChatRoutes(ctx) {
  const {
    matchRoute, sendJson, sendResult,
    getAuthedUser, getAuthedBody,
    index, db, uid,
    addToMapArray, invalidateConvMeta,
    schedulePersist, broadcastToUser, broadcastToConversation,
    indexNewConversation,
    createGroupChat, getGroupChatDetail, updateGroupChat,
    addGroupMembers, removeGroupMember, leaveGroupChat,
    dismissGroupChat, transferGroupOwner, setGroupAdmin,
    setGroupNickname, muteGroupMember,
  } = ctx;

  return async function handleGroupChatRoutes(pathname, method, req, res, searchParams) {

    // POST /api/group-chat/create
    if (matchRoute(pathname, '/api/group-chat/create') && method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return true;
      const result = createGroupChat({
        authUser: context.authUser,
        memberIds: context.body.memberIds || [],
        name: context.body.name || '',
        uid, db, index, addToMapArray, indexNewConversation,
        schedulePersist, broadcastToUser, broadcastToConversation,
      });
      return sendResult(res, result);
    }

    // GET /api/group-chat/:id — get detail
    const detailMatch = method === 'GET' && pathname.match(RE_GROUP_CHAT_ID);
    if (detailMatch) {
      const convId = detailMatch[1];
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return true;
      const result = getGroupChatDetail({ convId, authUser, index });
      return sendResult(res, result);
    }

    // POST /api/group-chat/:id/update
    const actionMatch = method === 'POST' && pathname.match(RE_GROUP_CHAT_ACTION);
    if (actionMatch) {
      const convId = actionMatch[1];
      const action = actionMatch[2];
      const context = await getAuthedBody(req, res);
      if (!context) return true;

      if (action === 'update') {
        return sendResult(res, updateGroupChat({
          convId, authUser: context.authUser, body: context.body,
          index, uid, db, addToMapArray, invalidateConvMeta,
          schedulePersist, broadcastToConversation,
        }));
      }

      if (action === 'dismiss') {
        return sendResult(res, dismissGroupChat({
          convId, authUser: context.authUser,
          index, uid, db, addToMapArray, invalidateConvMeta,
          schedulePersist, broadcastToUser, broadcastToConversation,
        }));
      }

      if (action === 'transfer') {
        return sendResult(res, transferGroupOwner({
          convId, authUser: context.authUser,
          newOwnerId: context.body.newOwnerId,
          index, uid, db, addToMapArray,
          schedulePersist, broadcastToConversation,
        }));
      }

      if (action === 'nickname') {
        return sendResult(res, setGroupNickname({
          convId, authUser: context.authUser,
          nickname: context.body.nickname,
          index, schedulePersist, broadcastToConversation,
        }));
      }

      if (action === 'mute-member') {
        return sendResult(res, muteGroupMember({
          convId, authUser: context.authUser,
          targetId: context.body.targetId,
          mute: !!context.body.mute,
          index, schedulePersist, broadcastToConversation,
        }));
      }

      return sendJson(res, 400, { error: 'unsupported_action' });
    }

    // POST /api/group-chat/:id/members/add|remove|leave
    const membersMatch = method === 'POST' && pathname.match(RE_GROUP_CHAT_MEMBERS);
    if (membersMatch) {
      const convId = membersMatch[1];
      const action = membersMatch[2];
      const context = await getAuthedBody(req, res);
      if (!context) return true;

      if (action === 'add') {
        return sendResult(res, addGroupMembers({
          convId, authUser: context.authUser,
          memberIds: context.body.memberIds || [],
          index, uid, db, addToMapArray, invalidateConvMeta,
          schedulePersist, broadcastToUser, broadcastToConversation,
        }));
      }

      if (action === 'remove') {
        return sendResult(res, removeGroupMember({
          convId, authUser: context.authUser,
          memberId: context.body.memberId,
          index, uid, db, addToMapArray, invalidateConvMeta,
          schedulePersist, broadcastToUser, broadcastToConversation,
        }));
      }

      if (action === 'leave') {
        return sendResult(res, leaveGroupChat({
          convId, authUser: context.authUser,
          index, uid, db, addToMapArray, invalidateConvMeta,
          schedulePersist, broadcastToUser, broadcastToConversation,
        }));
      }

      return sendJson(res, 400, { error: 'unsupported_action' });
    }

    // POST /api/group-chat/:id/admins/add|remove
    const adminsMatch = method === 'POST' && pathname.match(RE_GROUP_CHAT_ADMINS);
    if (adminsMatch) {
      const convId = adminsMatch[1];
      const action = adminsMatch[2];
      const context = await getAuthedBody(req, res);
      if (!context) return true;

      return sendResult(res, setGroupAdmin({
        convId, authUser: context.authUser,
        targetId: context.body.targetId,
        isAdmin: action === 'add',
        index, schedulePersist, broadcastToConversation,
      }));
    }

    return false; // not handled
  };
};
