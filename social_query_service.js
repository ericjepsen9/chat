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
    const pinned = conv._pinnedBySet.has(uid);
    const muted = conv._mutedBySet.has(uid);
    const meta = buildConversationMeta(conv, uid);
    // Build view object instead of mutating shared base
    const view = {
      id: base.id, type: base.type, name: base.name,
      members: base.members, peerId: base.peerId, peerName: base.peerName,
      peerAvatar: base.peerAvatar, peerRemark: base.peerRemark,
      lastMessageAt: base.lastMessageAt, createdAt: base.createdAt,
      preview: meta.preview,
      unread: meta.unread,
      pinned,
      muted,
      clearedAt: conv?.clearedAt?.[uid] || 0,
      peerLastReadAt: peerId ? (conv?.lastRead?.[peerId] || 0) : 0,
      _sortKey: (meta.lastMessageAt || base.lastMessageAt || base.createdAt || 0),
    };
    conversations.push(view);
  }
  conversations.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b._sortKey - a._sortKey;
  });
  // _sortKey is a transient property used only for sorting; left on base objects
  // to avoid the overhead of delete (which deoptimizes V8 hidden classes)
  return { conversations };
}

module.exports = {
  listFriendRequests,
  listFriends,
  listConversations,
};
