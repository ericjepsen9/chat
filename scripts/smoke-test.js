const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
let authToken = null;
let authCsrf = null;
let adminToken = null;
let adminCsrf = null;
let serverProc = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerReachable() {
  try {
    const res = await fetch(`${BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServerReady() {
  if (await isServerReachable()) return;
  serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
  });
  serverProc.unref();

  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i += 1) {
    if (await isServerReachable()) return;
    await sleep(150);
  }
  throw new Error(`server_not_ready: ${BASE}`);
}

async function shutdownOwnedServer() {
  if (!serverProc || serverProc.killed) return;
  serverProc.kill('SIGTERM');
  await sleep(100);
}

async function j(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken && !('Authorization' in headers)) headers.Authorization = `Bearer ${authToken}`;
  if (authCsrf && !('X-CSRF-Token' in headers)) headers['X-CSRF-Token'] = authCsrf;
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function jAdmin(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  if (adminCsrf) headers['X-CSRF-Token'] = adminCsrf;
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
  if (authCsrf && !('X-CSRF-Token' in headers)) headers['X-CSRF-Token'] = authCsrf;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json();
  if (res.status !== expectedStatus) {
    throw new Error(`${path} expected ${expectedStatus} got ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

(async () => {
  await ensureServerReady();
  const now = Date.now();
  const phone = `139${String(now).slice(-8)}`;
  const password = 'smoke12345';

  // Request phone verification code before registration
  await j('/api/auth/send-code', {
    method: 'POST',
    body: JSON.stringify({ phone, scene: 'register' }),
  });

  const register = await j('/api/register', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'SmokeUser', password, phone, code: '1234' }),
  });
  assert(register.user && register.user.username === phone);
  assert(register.token);
  authToken = register.token;
  authCsrf = register.csrfToken;

  const login = await j('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: phone, password }),
  });
  assert(login.user && login.user.id);
  assert(login.token);
  authToken = login.token;
  authCsrf = login.csrfToken;


  const adminLoginRes = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: '1234' }),
  });
  const adminLogin = await adminLoginRes.json();
  if (!adminLoginRes.ok) throw new Error(`admin login failed ${adminLoginRes.status}`);
  adminToken = adminLogin.token;
  adminCsrf = adminLogin.csrfToken;

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
    await jAdmin(`/api/friends/accept`, {
      method: 'POST',
      body: JSON.stringify({ userId: target.id, requestId: pendingRequest.id }),
    });
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

  const incomingData = await jAdmin(`/api/conversations/${conv.conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: target.id, type: 'text', text: 'smoke-unread-check' }),
  });
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

  const sellerProductData = await jAdmin('/api/products', {
    method: 'POST',
    body: JSON.stringify({
      userId: target.id,
      title: 'smoke item',
      category: '数码',
      desc: 'smoke test product',
      stock: 3,
      specs: ['默认规格'],
      price: 9.9,
      image: '/uploads/smoke-product.png',
    }),
  });
  const sellerStore = await j(`/api/users/${encodeURIComponent(target.id)}/store`);
  const smokeProduct = (sellerStore.items || []).find((item) => item.title === 'smoke item');
  assert(smokeProduct && smokeProduct.id, 'smoke seller product should exist');

  const orderPayload = {
    sellerId: target.id,
    clientRequestId: 'smoke-order-1',
    items: [{ productId: smokeProduct.id, title: 'tampered title', spec: '默认规格', quantity: 1, price: 1 }],
  };
  const orderFirst = await j('/api/orders', { method: 'POST', body: JSON.stringify(orderPayload) });
  const orderSecond = await j('/api/orders', { method: 'POST', body: JSON.stringify(orderPayload) });
  assert(orderFirst.order && orderFirst.order.id);
  assert(orderFirst.order.status === 'pending');
  assert(orderFirst.order.items && Number(orderFirst.order.items[0].price) === 9.9, 'order item price should come from seller product');
  assert(orderSecond.order && orderSecond.order.id === orderFirst.order.id);
  assert(orderSecond.deduplicated === true);

  // Seller accepts the order
  const acceptRes = await jAdmin(`/api/orders/${orderFirst.order.id}/accept`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert(acceptRes.order && acceptRes.order.status === 'accepted');

  const orderCardMsg = await j(`/api/conversations/${conv.conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: login.user.id, type: 'order_card', order: { id: orderFirst.order.id } }),
  });
  assert(orderCardMsg.message && orderCardMsg.message.type === 'order_card');
  assert(orderCardMsg.message.order && orderCardMsg.message.order.id === orderFirst.order.id);
  assert(orderCardMsg.message.order.buyerId && orderCardMsg.message.order.sellerId);

  const convListAfterOrderCard = await j(`/api/conversations?userId=${encodeURIComponent(login.user.id)}`);
  const convMetaAfterOrderCard = (convListAfterOrderCard.conversations || []).find((c) => c.id === conv.conversation.id);
  assert(convMetaAfterOrderCard && convMetaAfterOrderCard.preview === '[订单]');

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

  const confirmBySeller = await jAdmin(`/api/orders/${orderFirst.order.id}/price-confirm`, {
    method: 'POST',
    body: JSON.stringify({ total: 8.8 }),
  });
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

  const orderPending = await j('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      sellerId: target.id,
      items: [{ productId: smokeProduct.id, title: 'pending', spec: '默认规格', quantity: 1, price: 1 }],
    }),
  });
  await expectHttpError(`/api/orders/${orderPending.order.id}/delete`, { method: 'POST', body: JSON.stringify({}) }, 409);

  const delByBuyer = await j(`/api/orders/${orderFirst.order.id}/delete`, { method: 'POST', body: JSON.stringify({}) });
  assert(delByBuyer.ok === true);
  const buyerOrdersAfterDelete = await j('/api/orders');
  assert(!(buyerOrdersAfterDelete.orders || []).some((o) => o.id === orderFirst.order.id), 'deleted order should be hidden for buyer');

  const sellerOrdersAfterDelete = await jAdmin(`/api/orders?sellerId=${encodeURIComponent(target.id)}`);
  assert((sellerOrdersAfterDelete.orders || []).some((o) => o.id === orderFirst.order.id), 'order should still be visible for seller before seller deletes');

  const delBySeller = await jAdmin(`/api/orders/${orderFirst.order.id}/delete`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const sellerOrdersAfterSelfDelete = await jAdmin(`/api/orders?sellerId=${encodeURIComponent(target.id)}`);
  assert(!(sellerOrdersAfterSelfDelete.orders || []).some((o) => o.id === orderFirst.order.id), 'deleted order should be hidden for seller too');

  const sysData = await jAdmin('/api/admin/system/messages', {
    method: 'POST',
    body: JSON.stringify({ title: 'Smoke系统消息', summary: '测试发布' }),
  });
  assert(sysData.item && sysData.item.id);

  const systemList = await j('/api/system/messages');
  assert(Array.isArray(systemList.items));
  assert(systemList.items.some((it) => it.id === sysData.item.id));

  const health = await j('/api/health');
  assert(health.ok === true);
  assert(health.walExists === true);

  // ── Edge Cases & Security Tests ──

  // Empty/missing fields should fail gracefully
  await expectHttpError('/api/register', {
    method: 'POST',
    body: JSON.stringify({ displayName: '', password: '', phone: '', code: '' }),
  }, 400);

  // Very long input should not crash
  const longStr = 'a'.repeat(5000);
  await expectHttpError('/api/register', {
    method: 'POST',
    body: JSON.stringify({ displayName: longStr, password: longStr, phone: longStr, code: '1234' }),
  }, 400);

  // Non-admin cannot access admin endpoints
  const nonAdminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}`, 'X-CSRF-Token': authCsrf };
  const adminCheckRes = await fetch(`${BASE}/api/admin/users`, { headers: nonAdminHeaders });
  assert(adminCheckRes.status === 403, 'non-admin should get 403 on admin endpoints');

  // Product with invalid price should fail
  await expectHttpError('/api/products', {
    method: 'POST',
    body: JSON.stringify({ userId: login.user.id, title: 'bad', category: '测试', price: -10, stock: 1, specs: ['默认'] }),
  }, 400);

  // Product with zero stock should fail
  await expectHttpError('/api/products', {
    method: 'POST',
    body: JSON.stringify({ userId: login.user.id, title: 'bad', category: '测试', price: 10, stock: 0, specs: ['默认'] }),
  }, 400);

  // Blacklist self should fail
  await expectHttpError('/api/blacklist', {
    method: 'POST',
    body: JSON.stringify({ targetId: login.user.id, action: 'add' }),
  }, 400);

  // API responses should not contain password fields
  const selfProfile = await j(`/api/users/${encodeURIComponent(login.user.id)}/profile`);
  if (selfProfile.user) {
    assert(selfProfile.user.password === undefined, 'API response should not contain password');
    assert(selfProfile.user.passwordHash === undefined, 'API response should not contain passwordHash');
  }

  console.log('smoke-test: ok (with edge cases)');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(async () => {
  await shutdownOwnedServer();
});
