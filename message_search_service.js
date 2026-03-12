/* message_search_service.js — consolidated message search logic */

/**
 * Search messages across all conversations for a user.
 */
function searchMessagesGlobal({ authUser, keyword, limit, offset, index, isMessageVisibleToUser }) {
  const results = [];
  const userConvs = index.convByUser.get(authUser.id) || [];
  for (const conv of userConvs) {
    const members = conv.members || [];
    const peerId = members[0] === authUser.id ? members[1] : members[0];
    const peer = peerId ? index.usersById.get(peerId) : null;
    const peerName = peer ? (peer.displayName || peer.username) : (conv.title || '');
    const peerAvatarUrl = peer ? peer.avatarUrl : '';
    const msgs = index.messagesByConv.get(conv.id) || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (msg.type !== 'text' || !msg.text) continue;
      if (!isMessageVisibleToUser(msg, conv, authUser.id)) continue;
      if (msg.text.toLowerCase().includes(keyword)) {
        results.push({
          messageId: msg.id, conversationId: conv.id, senderId: msg.senderId,
          text: msg.text, createdAt: msg.createdAt,
          peerName, peerAvatarUrl, peerId: peerId || '',
        });
      }
    }
  }
  results.sort((a, b) => b.createdAt - a.createdAt);
  const paged = results.slice(offset, offset + limit);
  return { results: paged, total: results.length, hasMore: offset + limit < results.length };
}

/**
 * Search messages within a specific conversation.
 */
function searchMessagesInConversation({ conv, keyword, limit, offset, authUserId, index, isMessageVisibleToUser }) {
  const msgs = index.messagesByConv.get(conv.id) || [];
  const results = [];
  const maxNeeded = offset + limit;
  let total = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.type !== 'text' || !msg.text) continue;
    if (!isMessageVisibleToUser(msg, conv, authUserId)) continue;
    if (msg.text.toLowerCase().includes(keyword)) {
      total++;
      if (results.length < maxNeeded) {
        results.push({ id: msg.id, senderId: msg.senderId, text: msg.text, createdAt: msg.createdAt });
      }
    }
  }
  const paged = results.slice(offset, offset + limit);
  return { results: paged, total, hasMore: offset + limit < total };
}

module.exports = { searchMessagesGlobal, searchMessagesInConversation };
