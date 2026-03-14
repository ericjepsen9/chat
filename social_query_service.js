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
    // Mutate base in-place to avoid two spread copies per conversation
    base.preview = meta.preview;
    base.unread = meta.unread;
    base.pinned = pinned;
    base.muted = muted;
    base.clearedAt = conv?.clearedAt?.[uid] || 0;
    base.peerLastReadAt = peerId ? (conv?.lastRead?.[peerId] || 0) : 0;
    base._sortKey = (meta.lastMessageAt || base.lastMessageAt || base.createdAt || 0);
    conversations.push(base);
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
