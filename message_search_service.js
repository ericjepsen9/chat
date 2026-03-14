/* message_search_service.js — consolidated message search logic */

/**
 * Search messages across all conversations for a user.
 * Messages within each conversation are already sorted by createdAt ASC,
 * so iterating newest-first and collecting into a flat array then sorting once.
 */
function searchMessagesGlobal({ authUser, keyword, limit, offset, index, isMessageVisibleToUser }) {
  const maxNeeded = offset + limit;
  // Cap total scan to prevent unbounded work on large message stores
  const SCAN_CAP = maxNeeded * 10;
  const results = [];
  const userConvs = index.convByUser.get(authUser.id) || [];
  let scanned = 0;
  // Cache peer info per conversation to avoid repeated Map lookups
  const peerCache = new Map();
  outer:
  for (let c = 0; c < userConvs.length; c++) {
    const conv = userConvs[c];
    let cached = peerCache.get(conv.id);
    if (!cached) {
      const members = conv.members || [];
      const peerId = members.length >= 2 ? (members[0] === authUser.id ? members[1] : members[0]) : null;
      if (peerId) {
        const peer = index.usersById.get(peerId);
        cached = { peerId, peerName: peer ? (peer.displayName || peer.username) : '', peerAvatarUrl: peer ? peer.avatarUrl : '' };
      } else {
        cached = { peerId: '', peerName: conv.title || '', peerAvatarUrl: '' };
      }
      peerCache.set(conv.id, cached);
    }
    const msgs = index.messagesByConv.get(conv.id) || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (msg.type !== 'text' || !msg.text) continue;
      if (!isMessageVisibleToUser(msg, conv, authUser.id)) continue;
      if (msg.text.toLowerCase().includes(keyword)) {
        results.push({
          messageId: msg.id, conversationId: conv.id, senderId: msg.senderId,
          text: msg.text, createdAt: msg.createdAt,
          peerName: cached.peerName, peerAvatarUrl: cached.peerAvatarUrl, peerId: cached.peerId,
        });
        if (++scanned >= SCAN_CAP) break outer;
      }
    }
  }
  results.sort((a, b) => b.createdAt - a.createdAt);
  const paged = results.slice(offset, maxNeeded);
  return { results: paged, total: results.length, hasMore: maxNeeded < results.length };
}

/**
 * Search messages within a specific conversation.
 * Iterates newest-first; skips offset results, collects limit results,
 * then counts remaining for total.
 */
function searchMessagesInConversation({ conv, keyword, limit, offset, authUserId, index, isMessageVisibleToUser }) {
  const msgs = index.messagesByConv.get(conv.id) || [];
  const results = [];
  let total = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.type !== 'text' || !msg.text) continue;
    if (!isMessageVisibleToUser(msg, conv, authUserId)) continue;
    if (msg.text.toLowerCase().includes(keyword)) {
      if (total >= offset && results.length < limit) {
        results.push({ id: msg.id, senderId: msg.senderId, text: msg.text, createdAt: msg.createdAt });
      }
      total++;
    }
  }
  return { results, total, hasMore: offset + limit < total };
}

module.exports = { searchMessagesGlobal, searchMessagesInConversation };
