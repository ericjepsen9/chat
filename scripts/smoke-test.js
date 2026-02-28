const assert = require('assert');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';

async function j(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
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

  const login = await j('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password: '1234' }),
  });
  assert(login.user && login.user.id);

  const users = await j(`/api/users?currentUserId=${encodeURIComponent(login.user.id)}`);
  assert(Array.isArray(users.users) && users.users.length > 0);

  await j('/api/friends', {
    method: 'POST',
    body: JSON.stringify({ userId: login.user.id, friendUsername: 'alice', group: '压测组' }),
  });

  const conv = await j('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ creatorId: login.user.id, type: 'direct', memberIds: [users.users[0].id] }),
  });
  assert(conv.conversation && conv.conversation.id);

  await j(`/api/conversations/${conv.conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ senderId: login.user.id, type: 'text', text: 'smoke' }),
  });

  const messages = await j(`/api/conversations/${conv.conversation.id}/messages?userId=${encodeURIComponent(login.user.id)}`);
  assert(Array.isArray(messages.messages) && messages.messages.length > 0);

  const health = await j('/api/health');
  assert(health.ok === true);

  console.log('smoke-test: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
