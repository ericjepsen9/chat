const { normalizeText } = require('./order_utils');

const RE_HTTP_URL = /^https?:\/\//i;

function normalizeCoverUrl(value) {
  const url = String(value || '').trim().slice(0, 512);
  if (!url) return '';
  if (RE_HTTP_URL.test(url) || url.startsWith('/uploads/')) return url;
  return '';
}

function createBroadcastMessage({ conversationId, authUser, body, index, canAccessConversation, addTradeMessage, touchConversation }) {
  const conversation = index.convById.get(conversationId);
  if (!conversation || !canAccessConversation(authUser.id, conversation)) {
    return { ok: false, status: 404, error: 'not_found' };
  }

  const title = normalizeText(body.title, 80) || '图文通知';
  const summary = normalizeText(body.summary, 240) || '新的图文通知';
  const cover = normalizeCoverUrl(body.cover);

  const msg = addTradeMessage(conversation.id, {
    senderId: authUser.id,
    type: 'broadcast_card',
    broadcast: {
      title,
      summary,
      cover,
    },
  });
  touchConversation(conversation.id);
  return { ok: true, status: 201, payload: { message: msg } };
}

module.exports = {
  createBroadcastMessage,
};
