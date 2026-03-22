function listFriendRequests({ authUser, requestViewsByTarget }) {
  const requests = requestViewsByTarget.get(authUser.id) || [];
  return { requests };
}

function listFriends({ authUser, friendViewsByUser }) {
  const friends = friendViewsByUser.get(authUser.id) || [];
  return { friends };
}

function listConversations({ authUser, directConvBasesByUser, convById, convByUser, usersById, friendshipByPair, buildConversationMeta }) {
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
      members: base.members, peerId: base.peerId,
      title: base.title, peerAvatarUrl: base.peerAvatarUrl,
      peerIsFriend: base.peerIsFriend, peerAppNumberId: base.peerAppNumberId,
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

  // Include group conversations
  const userConvs = convByUser ? (convByUser.get(uid) || []) : [];
  for (let i = 0; i < userConvs.length; i++) {
    const conv = userConvs[i];
    if (conv.type !== 'group') continue;
    if (conv.dismissed) continue;
    const pinned = conv._pinnedBySet ? conv._pinnedBySet.has(uid) : false;
    const muted = conv._mutedBySet ? conv._mutedBySet.has(uid) : false;
    const meta = buildConversationMeta(conv, uid);
    // Build group avatar from first few members
    const memberAvatars = [];
    const members = conv.members || [];
    for (let j = 0; j < members.length && memberAvatars.length < 9; j++) {
      const u = usersById ? usersById.get(members[j]) : null;
      if (u) memberAvatars.push(u.avatarUrl || '');
    }
    // Get last message sender name for preview
    let groupPreview = meta.preview || '';
    if (groupPreview && meta.lastSenderId && meta.lastSenderId !== uid) {
      const sender = usersById ? usersById.get(meta.lastSenderId) : null;
      const senderNick = (conv.memberNicknames && conv.memberNicknames[meta.lastSenderId]) || '';
      const rel = friendshipByPair ? friendshipByPair.get(`${uid}:${meta.lastSenderId}`) : null;
      const senderName = senderNick || (rel && rel.remark) || (sender ? sender.displayName : '');
      if (senderName && !groupPreview.startsWith(senderName + ':') && meta.lastMsgType !== 'system') {
        groupPreview = senderName + ': ' + groupPreview;
      }
    }
    const view = {
      id: conv.id, type: 'group', name: conv.name,
      members: conv.members, memberCount: members.length,
      title: conv.name || '群聊',
      memberAvatars,
      ownerId: conv.ownerId,
      lastMessageAt: conv.lastMessageAt, createdAt: conv.createdAt,
      preview: groupPreview,
      unread: meta.unread,
      pinned,
      muted,
      clearedAt: conv.clearedAt?.[uid] || 0,
      _sortKey: (meta.lastMessageAt || conv.lastMessageAt || conv.createdAt || 0),
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
