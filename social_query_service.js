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
  const bases = directConvBasesByUser.get(uid) || [];
  // Single-pass: filter + transform in one loop, avoid .filter().map() chain
  const conversations = [];
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    const conv = convById.get(base.id);
    if (!conv) continue;
    const members = conv.members || [];
    const peerId = members.length >= 2 ? (members[0] === uid ? members[1] : members[0]) : null;
    const pinned = conv.pinnedBy ? conv.pinnedBy.indexOf(uid) !== -1 : false;
    const muted = conv.mutedBy ? conv.mutedBy.indexOf(uid) !== -1 : false;
    const meta = buildConversationMeta(conv, uid);
    conversations.push({
      ...base,
      ...meta,
      pinned,
      muted,
      clearedAt: conv?.clearedAt?.[uid] || 0,
      peerLastReadAt: peerId ? (conv?.lastRead?.[peerId] || 0) : 0,
      _sortKey: (meta.lastMessageAt || base.lastMessageAt || base.createdAt || 0),
    });
  }
  conversations.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b._sortKey - a._sortKey;
  });
  for (let i = 0; i < conversations.length; i++) delete conversations[i]._sortKey;
  return { conversations };
}

module.exports = {
  listFriendRequests,
  listFriends,
  listConversations,
};
