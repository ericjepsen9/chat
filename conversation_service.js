function createDirectConversation({ authUser, peerId, usersById, getDirectConversation, uid, db, indexNewConversation, schedulePersist, broadcastToUser }) {
  if (!peerId || !usersById.has(peerId) || peerId === authUser.id) {
    return { ok: false, status: 400, error: 'invalid_member' };
  }
  // Check blacklist before creating conversation
  const peer = usersById.get(peerId);
  if (peer) {
    if (!authUser._blacklistSet) authUser._blacklistSet = new Set(authUser.blacklist || []);
    if (authUser._blacklistSet.has(peerId)) return { ok: false, status: 403, error: '该用户在你的黑名单中' };
    if (!peer._blacklistSet) peer._blacklistSet = new Set(peer.blacklist || []);
    if (peer._blacklistSet.has(authUser.id)) return { ok: false, status: 403, error: '对方已将你拉黑' };
  }

  const existed = getDirectConversation(authUser.id, peerId);
  if (existed) return { ok: true, status: 200, payload: { conversation: existed } };

  const now = Date.now();
  const conv = {
    id: uid('c'),
    type: 'direct',
    name: '',
    ownerId: authUser.id,
    members: [authUser.id, peerId],
    announcement: '',
    mutedBy: [],
    pinnedBy: [],
    lastRead: {},
    clearedAt: {},
    createdAt: now,
    lastMessageAt: now,
  };
  db.conversations.push(conv);
  indexNewConversation(conv);
  schedulePersist('conversation_create', { conversationId: conv.id });
  broadcastToUser(authUser.id, 'conversation_updated', {});
  broadcastToUser(peerId, 'conversation_updated', {});
  return { ok: true, status: 201, payload: { conversation: conv } };
}

module.exports = {
  createDirectConversation,
};
