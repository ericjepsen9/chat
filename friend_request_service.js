function createFriendRequest({
  reqBody,
  authUser,
  index,
  db,
  areFriends,
  uid,
  rebuildFriendshipAndRequestIndexes,
  schedulePersist,
  broadcastToUser,
  findUserByPhone,
  getOrCreateDirectConversation,
}) {
  const keyword = String(reqBody.friendUsername || '').trim();
  const target = index.usersByName.get(keyword) || index.usersByAppNumber.get(keyword) || (findUserByPhone ? findUserByPhone(keyword) : null);
  if (!target || target.id === authUser.id) {
    return { ok: false, status: 404, error: '未找到该用户' };
  }
  // Check blacklist - blocked users cannot send friend requests
  // Lazily ensure _blacklistSet for O(1) lookups
  if (!target._blacklistSet) target._blacklistSet = new Set(target.blacklist || []);
  if (target._blacklistSet.has(authUser.id)) {
    return { ok: false, status: 403, error: '对方已将你拉黑，无法添加好友' };
  }
  if (!authUser._blacklistSet) authUser._blacklistSet = new Set(authUser.blacklist || []);
  if (authUser._blacklistSet.has(target.id)) {
    return { ok: false, status: 403, error: '你已将对方拉黑，请先解除' };
  }
  if (areFriends(authUser.id, target.id)) {
    return { ok: false, status: 409, error: 'already_friends' };
  }
  const existingPending = (index.requestsByTarget.get(target.id) || []).find((r) => r.userId === authUser.id && r.status === 'pending');
  if (existingPending) {
    return { ok: false, status: 409, error: 'request_pending' };
  }
  // Check for reverse pending request — auto-accept if target already sent request to authUser
  const reversePending = (index.requestsByTarget.get(authUser.id) || []).find((r) => r.userId === target.id && r.status === 'pending');
  if (reversePending) {
    reversePending.status = 'accepted';
    if (!index.friendshipByPair.has(`${authUser.id}:${target.id}`)) {
      db.friendships.push({ id: uid('f'), userId: authUser.id, friendId: target.id, group: '我的好友', remark: '' });
    }
    if (!index.friendshipByPair.has(`${target.id}:${authUser.id}`)) {
      db.friendships.push({ id: uid('f'), userId: target.id, friendId: authUser.id, group: '我的好友', remark: '' });
    }
    if (typeof getOrCreateDirectConversation === 'function') {
      getOrCreateDirectConversation(authUser.id, target.id);
    }
    rebuildFriendshipAndRequestIndexes();
    schedulePersist('friend_auto_accept', { requestId: reversePending.id });
    broadcastToUser(authUser.id, 'friends_updated', {});
    broadcastToUser(target.id, 'friends_updated', {});
    broadcastToUser(authUser.id, 'friend_request_updated', {});
    broadcastToUser(target.id, 'friend_request_updated', {});
    broadcastToUser(authUser.id, 'conversation_updated', {});
    broadcastToUser(target.id, 'conversation_updated', {});
    return { ok: true, status: 200, payload: { ok: true, autoAccepted: true } };
  }
  const request = {
    id: uid('fr'),
    userId: authUser.id,
    targetId: target.id,
    greeting: String(reqBody.greeting || '你好，想加你为好友').slice(0, 100),
    status: 'pending',
    createdAt: Date.now(),
  };
  db.friendRequests.push(request);
  rebuildFriendshipAndRequestIndexes();
  schedulePersist('friend_request', { requestId: request.id });
  broadcastToUser(target.id, 'friend_request_updated', {});
  return { ok: true, status: 201, payload: { ok: true, request } };
}

function acceptFriendRequest({
  requestId,
  authUser,
  db,
  index,
  uid,
  getDirectConversation,
  rebuildFriendshipAndRequestIndexes,
  schedulePersist,
  broadcastToUser,
}) {
  const request = index.friendRequestsById.get(requestId);
  if (!request || request.targetId !== authUser.id || request.status !== 'pending') return { ok: false, status: 404, error: 'not_found' };
  request.status = 'accepted';
  if (!index.friendshipByPair.has(`${authUser.id}:${request.userId}`)) {
    db.friendships.push({ id: uid('f'), userId: authUser.id, friendId: request.userId, group: '我的好友', remark: '' });
  }
  if (!index.friendshipByPair.has(`${request.userId}:${authUser.id}`)) {
    db.friendships.push({ id: uid('f'), userId: request.userId, friendId: authUser.id, group: '我的好友', remark: '' });
  }
  const existed = getDirectConversation(authUser.id, request.userId);
  if (!existed) {
    db.conversations.push({ id: uid('c'), type: 'direct', name: '', ownerId: authUser.id, members: [authUser.id, request.userId], announcement: '', mutedBy: [], pinnedBy: [], lastRead: {}, clearedAt: {}, createdAt: Date.now(), lastMessageAt: Date.now() });
  }
  rebuildFriendshipAndRequestIndexes();
  schedulePersist('friend_accept', { requestId: request.id });
  broadcastToUser(authUser.id, 'friends_updated', {});
  broadcastToUser(request.userId, 'friends_updated', {});
  broadcastToUser(authUser.id, 'friend_request_updated', {});
  broadcastToUser(request.userId, 'conversation_updated', {});
  broadcastToUser(authUser.id, 'conversation_updated', {});
  return { ok: true, status: 200, payload: { ok: true } };
}

function rejectFriendRequest({ requestId, authUser, db, index, rebuildRequestIndexesOnly, schedulePersist, broadcastToUser }) {
  const request = index.friendRequestsById.get(requestId);
  if (!request || request.targetId !== authUser.id || request.status !== 'pending') return { ok: false, status: 404, error: 'not_found' };
  request.status = 'rejected';
  rebuildRequestIndexesOnly();
  schedulePersist('friend_reject', { requestId: request.id, userId: authUser.id });
  broadcastToUser(authUser.id, 'friend_request_updated', {});
  broadcastToUser(request.userId, 'friend_request_updated', {});
  return { ok: true, status: 200, payload: { ok: true } };
}

module.exports = {
  createFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
};
