function listFriendRequests({ authUser, requestViewsByTarget }) {
  const requests = requestViewsByTarget.get(authUser.id) || [];
  return { requests };
}

function listFriends({ authUser, friendViewsByUser }) {
  const friends = friendViewsByUser.get(authUser.id) || [];
  return { friends };
}

function listConversations({ authUser, directConvBasesByUser, convById, buildConversationMeta }) {
  const conversations = (directConvBasesByUser.get(authUser.id) || []).map((base) => {
    const conv = convById.get(base.id);
    const peerId = (conv?.members || []).find((id) => id !== authUser.id);
    return {
      ...base,
      ...buildConversationMeta(conv, authUser.id),
      pinned: Boolean(conv?.pinnedBy?.includes(authUser.id)),
      muted: Boolean(conv?.mutedBy?.includes(authUser.id)),
      clearedAt: conv?.clearedAt?.[authUser.id] || 0,
      peerLastReadAt: peerId ? (conv?.lastRead?.[peerId] || 0) : 0,
    };
  }).sort((a, b) => {
    if (Number(b.pinned) !== Number(a.pinned)) return Number(b.pinned) - Number(a.pinned);
    return (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0);
  });
  return { conversations };
}

module.exports = {
  listFriendRequests,
  listFriends,
  listConversations,
};
