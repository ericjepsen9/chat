const assert = require('assert');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
let authToken = null;

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

(async () => {
  const username = `u_${Date.now()}`;
  const register = await j('/api/register', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'SmokeUser', username, password: '1234' }),
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

  const users = await j(`/api/users?currentUserId=${encodeURIComponent(login.user.id)}`);
  assert(Array.isArray(users.users) && users.users.length > 0);
  const target = users.users.find((u) => u.username === 'alice') || users.users[0];

  await j('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ userId: login.user.id, friendUsername: target.username, group: '压测组' }),
  });

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

  const health = await j('/api/health');
  assert(health.ok === true);
  assert(health.walExists === true);

  console.log('smoke-test: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
