function createFriendRequest({
  reqBody,
  authUser,
  index,
  db,
  areFriends,
  uid,
  rebuildIndexes,
  schedulePersist,
  broadcastToUser,
}) {
  const keyword = String(reqBody.friendUsername || '').trim();
  const target = index.usersByName.get(keyword) || index.usersByAppNumber.get(keyword);
  if (!target || target.id === authUser.id) {
    return { ok: false, status: 404, error: '未找到该用户' };
  }
  if (areFriends(authUser.id, target.id)) {
    return { ok: false, status: 409, error: 'already_friends' };
  }
  const existingPending = (index.requestsByTarget.get(target.id) || []).find((r) => r.userId === authUser.id);
  if (existingPending) {
    return { ok: false, status: 409, error: 'request_pending' };
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
  rebuildIndexes();
  schedulePersist('friend_request', { requestId: request.id });
  broadcastToUser(target.id, 'friend_request_updated', {});
  return { ok: true, status: 201, payload: { ok: true, request } };
}

function acceptFriendRequest({
  requestId,
  authUser,
  db,
  uid,
  getDirectConversation,
  rebuildIndexes,
  schedulePersist,
  broadcastToUser,
}) {
  const request = db.friendRequests.find((r) => r.id === requestId && r.targetId === authUser.id && r.status === 'pending');
  if (!request) return { ok: false, status: 404, error: 'not_found' };
  request.status = 'accepted';
  db.friendships.push({ id: uid('f'), userId: authUser.id, friendId: request.userId, group: '我的好友', remark: '' });
  db.friendships.push({ id: uid('f'), userId: request.userId, friendId: authUser.id, group: '我的好友', remark: '' });
  const existed = getDirectConversation(authUser.id, request.userId);
  if (!existed) {
    db.conversations.push({ id: uid('c'), type: 'direct', name: '', ownerId: authUser.id, members: [authUser.id, request.userId], announcement: '', mutedBy: [], pinnedBy: [], lastRead: {}, clearedAt: {}, createdAt: Date.now(), lastMessageAt: Date.now() });
  }
  rebuildIndexes();
  schedulePersist('friend_accept', { requestId: request.id });
  broadcastToUser(authUser.id, 'friends_updated', {});
  broadcastToUser(request.userId, 'friends_updated', {});
  broadcastToUser(authUser.id, 'friend_request_updated', {});
  broadcastToUser(request.userId, 'conversation_updated', {});
  broadcastToUser(authUser.id, 'conversation_updated', {});
  return { ok: true, status: 200, payload: { ok: true } };
}

function rejectFriendRequest({ requestId, authUser, db, rebuildIndexes, schedulePersist, broadcastToUser }) {
  const request = db.friendRequests.find((r) => r.id === requestId && r.targetId === authUser.id && r.status === 'pending');
  if (!request) return { ok: false, status: 404, error: 'not_found' };
  request.status = 'rejected';
  rebuildIndexes();
  schedulePersist('friend_reject', { requestId: request.id, userId: authUser.id });
  broadcastToUser(authUser.id, 'friend_request_updated', {});
  return { ok: true, status: 200, payload: { ok: true } };
}

module.exports = {
  createFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
};
