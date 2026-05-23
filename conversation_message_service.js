const ALLOWED_MESSAGE_TYPES = new Set(['text', 'image', 'audio', 'card', 'order_card', 'broadcast_card', 'system']);
const NO_FRIEND_CHECK_TYPES = new Set(['card', 'system', 'order_card']);
const { formatOrderSummary } = require('./order_utils');
const { encryptField, decryptField } = require('./server_crypto');

function buildOrderCardPayload(order, authUserId) {
  return {
    id: order.id,
    buyerId: order.buyerId,
    sellerId: order.sellerId,
    title: `订单 #${String(order.id || '').slice(-6)}`,
    summary: formatOrderSummary(order.items || []),
    total: order.total,
    status: order.status,
    pendingPrice: order.pendingPrice ?? null,
    pendingPriceRequestedBy: order.pendingPriceRequestedBy || null,
    priceAdjustmentLocked: !!order.priceAdjustmentLocked,
    role: authUserId === order.sellerId ? 'seller' : 'buyer',
  };
}

function decryptMessageForClient(msg) {
  if (!msg || !msg.text) return msg;
  const decrypted = decryptField(msg.text);
  if (decrypted === msg.text) return msg;
  return Object.assign({}, msg, { text: decrypted });
}

function listConversationMessages({ conv, authUser, searchParams, getVisibleMessagesSlice }) {
  if (!conv._memberSet.has(authUser.id)) return { ok: false, status: 403, error: 'forbidden' };
  const before = Math.max(0, parseInt(searchParams.get('before') || '0', 10) || 0);
  const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '30', 10) || 30), 100);
  const result = getVisibleMessagesSlice(conv, authUser.id, before, limit);
  result.messages = result.messages.map(decryptMessageForClient);
  const members = conv.members || [];
  const peerId = members.length >= 2 ? (members[0] === authUser.id ? members[1] : members[0]) : null;
  result.peerLastReadAt = peerId ? (conv.lastRead?.[peerId] || 0) : 0;
  return { ok: true, status: 200, payload: result };
}

function createConversationMessage({
  conversationId,
  conv,
  authUser,
  body,
  index,
  areFriends,
  uid,
  db,
  addToMapArray,
  invalidateConvMeta,
  schedulePersist,
  broadcastToConversation,
}) {
  if (!conv._memberSet || !conv._memberSet.has(authUser.id)) return { ok: false, status: 403, error: 'forbidden' };

  if (!body.type || !ALLOWED_MESSAGE_TYPES.has(body.type)) {
    return { ok: false, status: 400, error: 'invalid_message_type' };
  }

  // Group chat: check if member is muted
  if (conv.type === 'group') {
    if (Array.isArray(conv.mutedMembers) && conv.mutedMembers.includes(authUser.id) && conv.ownerId !== authUser.id) {
      return { ok: false, status: 403, error: '你已被禁言' };
    }
  }

  if (conv.type === 'direct') {
    if (!conv.members || conv.members.length < 2) return { ok: false, status: 400, error: 'invalid_conversation' };
    const peerId = conv.members[0] === authUser.id ? conv.members[1] : conv.members[0];
    const peerUser = index.usersById.get(peerId);
    // Lazily ensure _blacklistSet exists for O(1) lookups (avoids O(n) .includes fallback)
    if (!authUser._blacklistSet) authUser._blacklistSet = new Set(authUser.blacklist || []);
    if (authUser._blacklistSet.has(peerId)) return { ok: false, status: 403, error: '你已将对方拉黑，请先解除。' };
    if (peerUser) {
      if (!peerUser._blacklistSet) peerUser._blacklistSet = new Set(peerUser.blacklist || []);
      if (peerUser._blacklistSet.has(authUser.id)) return { ok: false, status: 403, error: '消息被对方拒收' };
    }
    if (!NO_FRIEND_CHECK_TYPES.has(body.type) && !areFriends(peerId, authUser.id)) {
      return { ok: false, status: 403, error: '对方开启了验证，你还不是他(她)的好友。' };
    }
  }

  if (body.type === 'order_card') {
    if (conv.type !== 'direct') return { ok: false, status: 400, error: 'order_card_only_for_direct_chat' };
    if (!conv.members || conv.members.length < 2) return { ok: false, status: 400, error: 'invalid_conversation' };
    const orderId = String(body.order?.id || '').trim();
    if (!orderId) return { ok: false, status: 400, error: 'invalid_order_card' };
    const order = index.ordersById.get(orderId);
    if (!order) return { ok: false, status: 404, error: 'order_not_found' };
    const m0 = conv.members[0];
    const m1 = conv.members[1];
    const inConversation = (order.buyerId === m0 && order.sellerId === m1) || (order.buyerId === m1 && order.sellerId === m0);
    if (!inConversation) return { ok: false, status: 403, error: 'order_not_in_this_conversation' };
    if (authUser.id !== order.buyerId && authUser.id !== order.sellerId) return { ok: false, status: 403, error: 'forbidden' };
    body.order = buildOrderCardPayload(order, authUser.id);
  }

  if (body.type === 'card' && body.card?.cardType === '收款码') {
    if (conv.type !== 'direct') return { ok: false, status: 400, error: 'payment_code_only_for_direct_chat' };
    const codes = authUser.paymentCodes || {};
    if (!codes.wechat && !codes.alipay && !codes.cloudpay) return { ok: false, status: 400, error: 'payment_code_not_configured' };
    const imageUrl = String(body.card.imageUrl || '').trim();
    if (!imageUrl || (imageUrl !== codes.wechat && imageUrl !== codes.alipay && imageUrl !== codes.cloudpay)) return { ok: false, status: 400, error: 'invalid_payment_code' };
  }

  if (body.clientMessageId) {
    const found = index.messageByClientKey.get(`${conversationId}:${authUser.id}:${body.clientMessageId}`);
    if (found) return { ok: true, status: 200, payload: { message: found, deduplicated: true } };
  }

  const MAX_TEXT_LEN = 5000;
  const MAX_URL_LEN = 1024;
  const now = Date.now();
  const msg = {
    id: uid('m'),
    conversationId,
    senderId: authUser.id,
    type: body.type,
    text: body.text ? encryptField(String(body.text).slice(0, MAX_TEXT_LEN)) : body.text,
    imageUrl: body.imageUrl ? String(body.imageUrl).slice(0, MAX_URL_LEN) : body.imageUrl,
    audioUrl: body.audioUrl ? String(body.audioUrl).slice(0, MAX_URL_LEN) : body.audioUrl,
    card: body.card ? { cardType: String(body.card.cardType || '').slice(0, 32), imageUrl: String(body.card.imageUrl || '').slice(0, MAX_URL_LEN), name: String(body.card.name || '').slice(0, 80), avatarUrl: String(body.card.avatarUrl || '').slice(0, MAX_URL_LEN), userId: String(body.card.userId || '').slice(0, 64), title: String(body.card.title || '').slice(0, 80), description: String(body.card.description || '').slice(0, 500), meta: String(body.card.meta || '').slice(0, 200), sellerId: String(body.card.sellerId || '').slice(0, 64), productId: String(body.card.productId || '').slice(0, 64) } : undefined,
    order: body.type === 'order_card' ? body.order : undefined,
    broadcast: body.broadcast ? { title: String(body.broadcast.title || '').slice(0, 80), content: String(body.broadcast.content || '').slice(0, 5000), imageUrl: String(body.broadcast.imageUrl || '').slice(0, MAX_URL_LEN) } : undefined,
    atUsers: Array.isArray(body.atUsers) ? body.atUsers.filter(id => typeof id === 'string' && conv._memberSet && conv._memberSet.has(id)).slice(0, 50) : [],
    clientMessageId: body.clientMessageId || null,
    deletedBy: [],
    createdAt: now,
  };

  // Pre-lowercase on decrypted text for search performance
  const rawText = decryptField(msg.text || '');
  if (msg.type === 'text' && rawText) msg._lcText = rawText.toLowerCase();
  db.messages.push(msg);
  addToMapArray(index.messagesByConv, conversationId, msg);
  index.messagesById.set(msg.id, msg);
  if (msg.clientMessageId) index.messageByClientKey.set(`${conversationId}:${authUser.id}:${msg.clientMessageId}`, msg);
  conv.lastMessageAt = now;
  if (typeof invalidateConvMeta === 'function') invalidateConvMeta(conversationId);
  const clientMsg = decryptMessageForClient(msg);
  broadcastToConversation(conversationId, 'message_created', { conversationId, message: clientMsg });
  broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
  return { ok: true, status: 201, payload: { message: clientMsg, deduplicated: false } };
}

module.exports = {
  listConversationMessages,
  createConversationMessage,
};
