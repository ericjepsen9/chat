const ALLOWED_MESSAGE_TYPES = new Set(['text', 'image', 'audio', 'card', 'order_card', 'broadcast_card', 'system']);

function formatOrderSummary(items = []) {
  return items.map((item) => `${item.title}(${item.spec}) x${item.quantity}`).join('，');
}

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

function listConversationMessages({ conv, authUser, searchParams, getVisibleMessagesSlice }) {
  if (conv.members[0] !== authUser.id && conv.members[1] !== authUser.id) return { ok: false, status: 403, error: 'forbidden' };
  const before = parseInt(searchParams.get('before') || '0', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100);
  const result = getVisibleMessagesSlice(conv, authUser.id, before, limit);
  const peerId = conv.members[0] === authUser.id ? conv.members[1] : conv.members[0];
  return {
    ok: true,
    status: 200,
    payload: { ...result, peerLastReadAt: peerId ? (conv.lastRead?.[peerId] || 0) : 0 },
  };
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
  schedulePersist,
  broadcastToConversation,
}) {
  if (conv.members[0] !== authUser.id && conv.members[1] !== authUser.id) return { ok: false, status: 403, error: 'forbidden' };

  if (!body.type || !ALLOWED_MESSAGE_TYPES.has(body.type)) {
    return { ok: false, status: 400, error: 'invalid_message_type' };
  }

  if (conv.type === 'direct') {
    const peerId = conv.members[0] === authUser.id ? conv.members[1] : conv.members[0];
    const peerUser = index.usersById.get(peerId);
    if (Array.isArray(authUser.blacklist) && authUser.blacklist.includes(peerId)) return { ok: false, status: 403, error: '你已将对方拉黑，请先解除。' };
    if (peerUser?.blacklist?.includes(authUser.id)) return { ok: false, status: 403, error: '消息被对方拒收' };
    if (body.type !== 'card' && body.type !== 'system' && body.type !== 'order_card' && !areFriends(peerId, authUser.id)) {
      return { ok: false, status: 403, error: '对方开启了验证，你还不是他(她)的好友。' };
    }
  }

  if (body.type === 'order_card') {
    if (conv.type !== 'direct') return { ok: false, status: 400, error: 'order_card_only_for_direct_chat' };
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
    const allowed = [codes.wechat, codes.alipay, codes.cloudpay].filter(Boolean);
    if (!allowed.length) return { ok: false, status: 400, error: 'payment_code_not_configured' };
    const imageUrl = String(body.card.imageUrl || '').trim();
    if (!allowed.includes(imageUrl)) return { ok: false, status: 400, error: 'invalid_payment_code' };
  }

  if (body.clientMessageId) {
    const found = index.messageByClientKey.get(`${conversationId}:${authUser.id}:${body.clientMessageId}`);
    if (found) return { ok: true, status: 200, payload: { message: found, deduplicated: true } };
  }

  const now = Date.now();
  const msg = {
    id: uid('m'),
    conversationId,
    senderId: authUser.id,
    type: body.type,
    text: body.text,
    imageUrl: body.imageUrl,
    audioUrl: body.audioUrl,
    card: body.card,
    order: body.order,
    broadcast: body.broadcast,
    clientMessageId: body.clientMessageId || null,
    deletedBy: [],
    createdAt: now,
  };

  db.messages.push(msg);
  addToMapArray(index.messagesByConv, conversationId, msg);
  index.messagesById.set(msg.id, msg);
  if (msg.clientMessageId) index.messageByClientKey.set(`${conversationId}:${authUser.id}:${msg.clientMessageId}`, msg);
  conv.lastMessageAt = now;
  schedulePersist('message_create', { conversationId, messageId: msg.id });
  broadcastToConversation(conversationId, 'message_created', { conversationId, message: msg });
  broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
  return { ok: true, status: 201, payload: { message: msg, deduplicated: false } };
}

module.exports = {
  listConversationMessages,
  createConversationMessage,
};
