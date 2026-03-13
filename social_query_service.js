function listFriendRequests({ authUser, requestViewsByTarget }) {
  const requests = requestViewsByTarget.get(authUser.id) || [];
  return { requests };
}

function listFriends({ authUser, friendViewsByUser }) {
  const friends = friendViewsByUser.get(authUser.id) || [];
  return { friends };
}

function listConversations({ authUser, directConvBasesByUser, convById, buildConversationMeta }) {
  const uid = authUser.id;
  const conversations = (directConvBasesByUser.get(uid) || []).filter((base) => convById.has(base.id)).map((base) => {
    const conv = convById.get(base.id);
    const members = conv.members || [];
    const peerId = members[0] === uid ? members[1] : members[0];
    const pinned = conv.pinnedBy ? conv.pinnedBy.indexOf(uid) !== -1 : false;
    const muted = conv.mutedBy ? conv.mutedBy.indexOf(uid) !== -1 : false;
    const meta = buildConversationMeta(conv, uid);
    return {
      ...base,
      ...meta,
      pinned,
      muted,
      clearedAt: conv?.clearedAt?.[uid] || 0,
      peerLastReadAt: peerId ? (conv?.lastRead?.[peerId] || 0) : 0,
      _sortKey: (meta.lastMessageAt || base.lastMessageAt || base.createdAt || 0),
    };
  });
  conversations.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b._sortKey - a._sortKey;
  });
  for (const c of conversations) delete c._sortKey;
  return { conversations };
}

module.exports = {
  listFriendRequests,
  listFriends,
  listConversations,
};
