function hasCustomGroup(authUser, groupName, defaultGroup) {
  if (!Array.isArray(authUser.customGroups)) authUser.customGroups = [defaultGroup];
  // Small array: Set is overkill, but for consistency use indexOf which V8 optimizes for small arrays
  return authUser.customGroups.indexOf(groupName) !== -1;
}

function updateFriendRemark({ authUser, friendId, group, remark, friendshipByPair, rebuildFriendViewsIndex, rebuildConversationBaseIndex, schedulePersist, broadcastToUser, defaultGroup }) {
  const rel = friendshipByPair.get(`${authUser.id}:${friendId}`);
  if (!rel) return { ok: false, status: 404, error: 'not_found' };
  if (group !== undefined) {
    const nextGroup = String(group || '').trim() || defaultGroup;
    if (!hasCustomGroup(authUser, nextGroup, defaultGroup)) return { ok: false, status: 400, error: 'invalid_group' };
    rel.group = nextGroup;
  }
  if (remark !== undefined) rel.remark = String(remark || '').trim().slice(0, 40);
  rebuildFriendViewsIndex();
  rebuildConversationBaseIndex();
  schedulePersist('friend_remark', { userId: authUser.id, friendId: rel.friendId });
  broadcastToUser(authUser.id, 'friends_updated', {});
  broadcastToUser(authUser.id, 'conversation_updated', {});
  return { ok: true, status: 200, payload: { ok: true } };
}

function updateFriendGroup({ authUser, friendId, groupRaw, friendshipByPair, normalizeSingleGroupName, defaultGroup, schedulePersist, rebuildFriendViewsIndex, rebuildConversationBaseIndex, broadcastToUser }) {
  const rel = friendshipByPair.get(`${authUser.id}:${friendId}`);
  if (!rel) return { ok: false, status: 404, error: 'not_found' };
  const nextGroup = normalizeSingleGroupName(groupRaw) || defaultGroup;
  if (!hasCustomGroup(authUser, nextGroup, defaultGroup)) return { ok: false, status: 400, error: 'invalid_group' };
  rel.group = nextGroup;
  rebuildFriendViewsIndex();
  rebuildConversationBaseIndex();
  schedulePersist('friend_group', { userId: authUser.id, friendId: rel.friendId });
  broadcastToUser(authUser.id, 'friends_updated', {});
  return { ok: true, status: 200, payload: { ok: true } };
}

function deleteFriendRelation({ authUser, friendId, usersById, removeFriendshipPair, getDirectConversation, schedulePersist, broadcastToUser }) {
  if (!friendId || friendId === authUser.id) return { ok: false, status: 400, error: 'invalid_target' };
  if (!usersById.has(friendId)) return { ok: false, status: 404, error: 'not_found' };
  removeFriendshipPair(authUser.id, friendId);
  const conv = getDirectConversation(authUser.id, friendId);
  if (conv) conv.clearedAt[authUser.id] = Date.now();
  schedulePersist('friend_delete', { userId: authUser.id, friendId });
  broadcastToUser(authUser.id, 'friends_updated', {});
  broadcastToUser(friendId, 'friends_updated', {});
  broadcastToUser(authUser.id, 'conversation_updated', {});
  return { ok: true, status: 200, payload: { ok: true } };
}

module.exports = {
  updateFriendRemark,
  updateFriendGroup,
  deleteFriendRelation,
};
