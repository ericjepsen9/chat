function createDirectConversation({ authUser, peerId, usersById, getDirectConversation, uid, db, indexNewConversation, schedulePersist, broadcastToUser }) {
  if (!peerId || !usersById.has(peerId) || peerId === authUser.id) {
    return { ok: false, status: 400, error: 'invalid_member' };
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
