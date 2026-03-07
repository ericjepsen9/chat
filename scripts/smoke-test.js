const assert = require('assert');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
let authToken = null;
let adminToken = null;

async function j(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken && !('Authorization' in headers)) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}


async function expectHttpError(path, options = {}, expectedStatus = 400) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken && !('Authorization' in headers)) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json();
  if (res.status !== expectedStatus) {
    throw new Error(`${path} expected ${expectedStatus} got ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

(async () => {
  const now = Date.now();
  const username = `u_${now}`;
  const phone = `139${String(now).slice(-8)}`;
  const register = await j('/api/register', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'SmokeUser', username, password: '1234', phone }),
  });
  assert(register.user && register.user.username === username);
  assert(register.token);
  authToken = register.token;

  const login = await j('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password: '1234' }),
  });
  assert(login.user && login.user.id);
  assert(login.token);
  authToken = login.token;


  const adminLoginRes = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: '1234' }),
  });
  const adminLogin = await adminLoginRes.json();
  if (!adminLoginRes.ok) throw new Error(`admin login failed ${adminLoginRes.status}`);
  adminToken = adminLogin.token;

  const users = await j(`/api/users?currentUserId=${encodeURIComponent(login.user.id)}`);
  assert(Array.isArray(users.users) && users.users.length > 0);
  const target = users.users.find((u) => u.username === 'alice') || users.users[0];

  await j('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ userId: login.user.id, friendUsername: target.username, group: '压测组' }),
  });

  const requestsRes = await fetch(`${BASE}/api/friends/requests?userId=${encodeURIComponent(target.id)}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const requestsData = await requestsRes.json();
  if (!requestsRes.ok) throw new Error(`fetch friend requests failed ${requestsRes.status} ${JSON.stringify(requestsData)}`);
  const pendingRequest = (requestsData.requests || []).find((r) => r.status === 'pending' && (r.fromUserId === login.user.id || r.sender?.id === login.user.id));
  if (pendingRequest) {
    const acceptRes = await fetch(`${BASE}/api/friends/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ userId: target.id, requestId: pendingRequest.id }),
    });
    const acceptData = await acceptRes.json();
    if (!acceptRes.ok) throw new Error(`accept friend request failed ${acceptRes.status} ${JSON.stringify(acceptData)}`);
  }

  const conv = await j('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ creatorId: login.user.id, type: 'direct', memberIds: [target.id] }),
  });
  assert(conv.conversation && conv.conversation.id);

  const first = await j(`/api/conversations/${conv.conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: login.user.id, type: 'card', clientMessageId: 'smoke-fixed-id', card: { cardType: '闲置商品', title: 'smoke', description: 'test' } }),
  });
  const second = await j(`/api/conversations/${conv.conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: login.user.id, type: 'card', clientMessageId: 'smoke-fixed-id', card: { cardType: '闲置商品', title: 'smoke-dup', description: 'test' } }),
  });
  assert(second.deduplicated === true);
  assert(first.message.id === second.message.id);

  const messages = await j(`/api/conversations/${conv.conversation.id}/messages?userId=${encodeURIComponent(login.user.id)}`);
  assert(Array.isArray(messages.messages) && messages.messages.length > 0);

  const incomingRes = await fetch(`${BASE}/api/conversations/${conv.conversation.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ senderId: target.id, type: 'text', text: 'smoke-unread-check' }),
  });
  const incomingData = await incomingRes.json();
  if (!incomingRes.ok) throw new Error(`incoming message failed ${incomingRes.status} ${JSON.stringify(incomingData)}`);
  assert(incomingData.message && incomingData.message.senderId === target.id);

  const convListWithUnread = await j(`/api/conversations?userId=${encodeURIComponent(login.user.id)}`);
  const convWithUnread = (convListWithUnread.conversations || []).find((c) => c.id === conv.conversation.id);
  assert(convWithUnread && convWithUnread.unread >= 1, 'conversation unread count should update after incoming message');

  await j(`/api/conversations/${conv.conversation.id}/read`, {
    method: 'POST',
    body: JSON.stringify({ userId: login.user.id }),
  });

  const convListAfterRead = await j(`/api/conversations?userId=${encodeURIComponent(login.user.id)}`);
  const convAfterRead = (convListAfterRead.conversations || []).find((c) => c.id === conv.conversation.id);
  assert(convAfterRead && convAfterRead.unread === 0, 'conversation unread should be cleared after read');

  await j(`/api/conversations/${conv.conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: login.user.id, type: 'card', card: { cardType: '名片', title: 'Smoke名片', description: 'desc' } }),
  });
  const convList = await j(`/api/conversations?userId=${encodeURIComponent(login.user.id)}`);
  const convMeta = (convList.conversations || []).find((c) => c.id === conv.conversation.id);
  assert(convMeta && convMeta.preview === '[名片]');

  await expectHttpError(`/api/conversations/${conv.conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: login.user.id, type: 'order_card', order: { id: 'o_not_exists' } }),
  }, 404);

  await expectHttpError(`/api/conversations/${conv.conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: login.user.id, type: 'card', card: { cardType: '收款码', title: '微信收款码', imageUrl: '/uploads/fake.png' } }),
  }, 400);

  const orderPayload = {
    sellerId: target.id,
    clientRequestId: 'smoke-order-1',
    items: [{ productId: 'smoke-p', title: 'smoke item', spec: '默认规格', quantity: 1, price: 9.9 }],
  };
  const orderFirst = await j('/api/orders', { method: 'POST', body: JSON.stringify(orderPayload) });
  const orderSecond = await j('/api/orders', { method: 'POST', body: JSON.stringify(orderPayload) });
  assert(orderFirst.order && orderFirst.order.id);
  assert(orderFirst.order.status === 'accepted');
  assert(orderSecond.order && orderSecond.order.id === orderFirst.order.id);
  assert(orderSecond.deduplicated === true);

  const orderCardMsg = await j(`/api/conversations/${conv.conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: login.user.id, type: 'order_card', order: { id: orderFirst.order.id } }),
  });
  assert(orderCardMsg.message && orderCardMsg.message.type === 'order_card');
  assert(orderCardMsg.message.order && orderCardMsg.message.order.id === orderFirst.order.id);
  assert(orderCardMsg.message.order.buyerId && orderCardMsg.message.order.sellerId);

  const convListAfterOrderCard = await j(`/api/conversations?userId=${encodeURIComponent(login.user.id)}`);
  const convMetaAfterOrderCard = (convListAfterOrderCard.conversations || []).find((c) => c.id === conv.conversation.id);
  assert(convMetaAfterOrderCard && convMetaAfterOrderCard.preview === '[交易提醒]');

  const clearRes = await j(`/api/conversations/${conv.conversation.id}/clear`, {
    method: 'POST',
    body: JSON.stringify({ userId: login.user.id }),
  });
  assert(clearRes.ok === true);
  assert(Number(clearRes.clearedAt) > 0);

  const listAfterClear = await j(`/api/conversations?userId=${encodeURIComponent(login.user.id)}`);
  const convMetaAfterClear = (listAfterClear.conversations || []).find((c) => c.id === conv.conversation.id);
  assert(convMetaAfterClear, 'conversation metadata should still be queryable after clear');
  assert(convMetaAfterClear.unread === 0, 'conversation should have no unread messages after clear');

  const messagesAfterClear = await j(`/api/conversations/${conv.conversation.id}/messages?userId=${encodeURIComponent(login.user.id)}`);
  assert(Array.isArray(messagesAfterClear.messages));
  assert(messagesAfterClear.messages.length === 0, 'messages before clear should be hidden for current user');

  const refetched = await j(`/api/conversations/${conv.conversation.id}/messages?userId=${encodeURIComponent(login.user.id)}`);
  const lastOrderCard = [...(refetched.messages || [])].reverse().find((m) => m.type === 'order_card');
  assert(!lastOrderCard, 'order card from before clear should not be visible');

  const priceReq = await j(`/api/orders/${orderFirst.order.id}/price-request`, {
    method: 'POST',
    body: JSON.stringify({ total: 8.8 }),
  });
  assert(priceReq.order && Number(priceReq.order.pendingPrice) === 8.8);

  await expectHttpError(`/api/orders/${orderFirst.order.id}/price-confirm`, {
    method: 'POST',
    body: JSON.stringify({ total: 8.8 }),
  }, 403);

  await expectHttpError(`/api/orders/${orderFirst.order.id}/price-request`, {
    method: 'POST',
    body: JSON.stringify({ total: 8.6 }),
  }, 409);

  const confirmBySellerRes = await fetch(`${BASE}/api/orders/${orderFirst.order.id}/price-confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ total: 8.8 }),
  });
  const confirmBySeller = await confirmBySellerRes.json();
  if (!confirmBySellerRes.ok) throw new Error(`price-confirm failed ${confirmBySellerRes.status} ${JSON.stringify(confirmBySeller)}`);
  assert(confirmBySeller.order && Number(confirmBySeller.order.total) === 8.8);
  assert(confirmBySeller.order.status === 'accepted');

  await expectHttpError(`/api/orders/${orderFirst.order.id}/price-request`, {
    method: 'POST',
    body: JSON.stringify({ total: 7.7 }),
  }, 409);

  const completeRes = await j(`/api/orders/${orderFirst.order.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ userId: login.user.id, status: 'completed', expectedUpdatedAt: confirmBySeller.order.updatedAt }),
  });
  assert(completeRes.order && completeRes.order.status === 'completed');

  await expectHttpError(`/api/orders/${orderFirst.order.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ userId: login.user.id, status: 'placed' }),
  }, 400);

  const sysRes = await fetch(`${BASE}/api/admin/system/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ title: 'Smoke系统消息', summary: '测试发布' }),
  });
  const sysData = await sysRes.json();
  if (!sysRes.ok) throw new Error(`system message publish failed ${sysRes.status} ${JSON.stringify(sysData)}`);
  assert(sysData.item && sysData.item.id);

  const systemList = await j('/api/system/messages');
  assert(Array.isArray(systemList.items));
  assert(systemList.items.some((it) => it.id === sysData.item.id));

  const health = await j('/api/health');
  assert(health.ok === true);
  assert(health.walExists === true);

  console.log('smoke-test: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
