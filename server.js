const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'data.json');

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    const alice = uid('u');
    const bob = uid('u');
    const conv = uid('c');
    const now = Date.now();
    const db = {
      users: [
        { id: alice, username: 'alice', password: '1234', displayName: 'Alice', createdAt: now },
        { id: bob, username: 'bob', password: '1234', displayName: 'Bob', createdAt: now },
      ],
      friendships: [
        { id: uid('f'), userId: alice, friendId: bob, group: '同事' },
        { id: uid('f'), userId: bob, friendId: alice, group: '同事' },
      ],
      conversations: [
        {
          id: conv,
          type: 'direct',
          name: '',
          ownerId: null,
          members: [alice, bob],
          announcement: '',
          mutedBy: [],
          lastOrderStep: -1,
          lastRead: { [alice]: now, [bob]: now },
          createdAt: now,
        },
      ],
      messages: [
        { id: uid('m'), conversationId: conv, senderId: bob, type: 'text', text: '你好，可以聊天下单吗？', createdAt: now - 20000 },
        { id: uid('m'), conversationId: conv, senderId: alice, type: 'text', text: '可以，点加号里的商品卡即可。', createdAt: now - 10000 },
      ],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }
  const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!loaded.friendships) loaded.friendships = [];
  return loaded;
}

let db = loadDb();
const sseClients = new Set();

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function broadcastEvent(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function getUserSafe(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt };
}

function userById(userId) {
  return db.users.find((u) => u.id === userId);
}

function conversationTitle(conv, userId) {
  if (conv.type === 'group') return conv.name;
  const peerId = conv.members.find((id) => id !== userId);
  return db.users.find((u) => u.id === peerId)?.displayName || '未知用户';
}

function conversationPreview(conv) {
  const msgs = db.messages.filter((m) => m.conversationId === conv.id).sort((a, b) => a.createdAt - b.createdAt);
  const last = msgs.at(-1);
  if (!last) return '暂无消息';
  if (last.type === 'image') return '[图片]';
  if (last.type === 'card') return `[${last.card?.cardType || '卡片'}]`;
  return last.text || '系统消息';
}

function unreadCount(conv, userId) {
  const lastRead = conv.lastRead?.[userId] || 0;
  return db.messages.filter((m) => m.conversationId === conv.id && m.senderId !== userId && m.createdAt > lastRead).length;
}

function canAccessConversation(conv, userId) {
  return conv.members.includes(userId);
}

function ensureFriend(userId, friendId, group = '我的好友') {
  if (!db.friendships.some((f) => f.userId === userId && f.friendId === friendId)) {
    db.friendships.push({ id: uid('f'), userId, friendId, group });
  }
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.json': 'application/json; charset=utf-8',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = parsed;

  try {
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('event: ready\ndata: {}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (pathname === '/api/register' && req.method === 'POST') {
      const body = await parseBody(req);
      const displayName = String(body.displayName || '').trim();
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!displayName || !username || password.length < 4) return sendJson(res, 400, { error: 'invalid_input' });
      if (db.users.some((u) => u.username === username)) return sendJson(res, 409, { error: 'username_exists' });
      const user = { id: uid('u'), username, password, displayName, createdAt: Date.now() };
      db.users.push(user);
      saveDb();
      broadcastEvent('users_updated', { userId: user.id });
      return sendJson(res, 201, { user: getUserSafe(user) });
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const user = db.users.find((u) => u.username === username && u.password === password);
      if (!user) return sendJson(res, 401, { error: 'invalid_credentials' });
      return sendJson(res, 200, { user: getUserSafe(user) });
    }

    if (pathname === '/api/users' && req.method === 'GET') {
      const currentUserId = searchParams.get('currentUserId');
      const q = (searchParams.get('q') || '').toLowerCase();
      let users = db.users.filter((u) => u.id !== currentUserId);
      if (q) users = users.filter((u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
      return sendJson(res, 200, { users: users.map(getUserSafe) });
    }

    if (pathname === '/api/friends' && req.method === 'GET') {
      const userId = searchParams.get('userId');
      if (!userId) return sendJson(res, 400, { error: 'missing_userId' });
      const friends = db.friendships
        .filter((f) => f.userId === userId)
        .map((f) => ({ ...f, friend: getUserSafe(userById(f.friendId) || {}) }))
        .filter((f) => f.friend.id);
      return sendJson(res, 200, { friends });
    }

    if (pathname === '/api/friends' && req.method === 'POST') {
      const body = await parseBody(req);
      const userId = String(body.userId || '');
      const friendUsername = String(body.friendUsername || '').trim();
      const group = String(body.group || '我的好友').trim() || '我的好友';
      if (!userId || !friendUsername) return sendJson(res, 400, { error: 'invalid_input' });
      const friend = db.users.find((u) => u.username === friendUsername);
      if (!friend || friend.id === userId) return sendJson(res, 404, { error: 'friend_not_found' });
      ensureFriend(userId, friend.id, group);
      ensureFriend(friend.id, userId, '我的好友');
      saveDb();
      broadcastEvent('friends_updated', { userId });
      broadcastEvent('friends_updated', { userId: friend.id });
      return sendJson(res, 201, { ok: true, friend: getUserSafe(friend) });
    }

    if (pathname === '/api/friends/group' && req.method === 'POST') {
      const body = await parseBody(req);
      const userId = String(body.userId || '');
      const friendId = String(body.friendId || '');
      const group = String(body.group || '我的好友').trim() || '我的好友';
      const rel = db.friendships.find((f) => f.userId === userId && f.friendId === friendId);
      if (!rel) return sendJson(res, 404, { error: 'friendship_not_found' });
      rel.group = group;
      saveDb();
      broadcastEvent('friends_updated', { userId });
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/conversations' && req.method === 'GET') {
      const userId = searchParams.get('userId');
      if (!userId) return sendJson(res, 400, { error: 'missing_userId' });
      const convs = db.conversations
        .filter((c) => c.members.includes(userId))
        .map((c) => ({ ...c, title: conversationTitle(c, userId), preview: conversationPreview(c), unread: unreadCount(c, userId) }))
        .sort((a, b) => {
          const ta = db.messages.filter((m) => m.conversationId === a.id).at(-1)?.createdAt || a.createdAt;
          const tb = db.messages.filter((m) => m.conversationId === b.id).at(-1)?.createdAt || b.createdAt;
          return tb - ta;
        });
      return sendJson(res, 200, { conversations: convs });
    }

    if (pathname === '/api/conversations' && req.method === 'POST') {
      const body = await parseBody(req);
      const creatorId = String(body.creatorId || '');
      const type = body.type === 'group' ? 'group' : 'direct';
      const memberIds = Array.isArray(body.memberIds) ? body.memberIds.filter(Boolean) : [];
      if (!creatorId) return sendJson(res, 400, { error: 'missing_creator' });

      if (type === 'direct') {
        const peerId = memberIds[0];
        if (!peerId) return sendJson(res, 400, { error: 'missing_peer' });
        const existed = db.conversations.find((c) => c.type === 'direct' && c.members.includes(creatorId) && c.members.includes(peerId));
        if (existed) return sendJson(res, 200, { conversation: existed });
        const conv = {
          id: uid('c'), type, name: '', ownerId: null, members: [creatorId, peerId], announcement: '', mutedBy: [],
          lastOrderStep: -1, lastRead: { [creatorId]: Date.now(), [peerId]: 0 }, createdAt: Date.now(),
        };
        db.conversations.push(conv);
        ensureFriend(creatorId, peerId);
        ensureFriend(peerId, creatorId);
        saveDb();
        broadcastEvent('conversation_updated', { conversationId: conv.id });
        broadcastEvent('friends_updated', { userId: creatorId });
        broadcastEvent('friends_updated', { userId: peerId });
        return sendJson(res, 201, { conversation: conv });
      }

      const groupName = String(body.name || '新群聊').trim() || '新群聊';
      const unique = [...new Set([creatorId, ...memberIds])];
      const conv = {
        id: uid('c'), type: 'group', name: groupName, ownerId: creatorId, members: unique, announcement: '', mutedBy: [],
        lastOrderStep: -1, lastRead: Object.fromEntries(unique.map((id) => [id, id === creatorId ? Date.now() : 0])), createdAt: Date.now(),
      };
      db.conversations.push(conv);
      db.messages.push({ id: uid('m'), conversationId: conv.id, senderId: creatorId, type: 'system', text: `已创建群聊 ${groupName}`, createdAt: Date.now() });
      saveDb();
      broadcastEvent('conversation_updated', { conversationId: conv.id });
      return sendJson(res, 201, { conversation: conv });
    }

    const convMatch = pathname.match(/^\/api\/conversations\/([^/]+)(\/messages|\/read|\/group|\/mute|\/signal|\/call)?$/);
    if (convMatch) {
      const conversationId = convMatch[1];
      const action = convMatch[2] || '';
      const conv = db.conversations.find((c) => c.id === conversationId);
      if (!conv) return sendJson(res, 404, { error: 'conversation_not_found' });

      if (action === '/messages' && req.method === 'GET') {
        const userId = searchParams.get('userId');
        if (!userId || !canAccessConversation(conv, userId)) return sendJson(res, 403, { error: 'forbidden' });
        const messages = db.messages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.createdAt - b.createdAt);
        return sendJson(res, 200, { conversation: conv, messages });
      }

      if (action === '/messages' && req.method === 'POST') {
        const body = await parseBody(req);
        const senderId = String(body.senderId || '');
        if (!senderId || !canAccessConversation(conv, senderId)) return sendJson(res, 403, { error: 'forbidden' });
        const type = body.type || 'text';
        const msg = {
          id: uid('m'), conversationId, senderId, type,
          text: type === 'text' || type === 'system' ? String(body.text || '') : undefined,
          imageUrl: type === 'image' ? String(body.imageUrl || '') : undefined,
          card: type === 'card' ? body.card || null : undefined,
          createdAt: Date.now(),
        };
        db.messages.push(msg);
        saveDb();
        broadcastEvent('message_created', { conversationId, messageId: msg.id });
        return sendJson(res, 201, { message: msg });
      }

      if (action === '/read' && req.method === 'POST') {
        const body = await parseBody(req);
        const userId = String(body.userId || '');
        if (!userId || !canAccessConversation(conv, userId)) return sendJson(res, 403, { error: 'forbidden' });
        conv.lastRead[userId] = Date.now();
        saveDb();
        broadcastEvent('conversation_updated', { conversationId });
        return sendJson(res, 200, { ok: true });
      }

      if (action === '/mute' && req.method === 'POST') {
        const body = await parseBody(req);
        const userId = String(body.userId || '');
        if (!userId || !canAccessConversation(conv, userId)) return sendJson(res, 403, { error: 'forbidden' });
        const idx = conv.mutedBy.indexOf(userId);
        if (idx >= 0) conv.mutedBy.splice(idx, 1); else conv.mutedBy.push(userId);
        saveDb();
        broadcastEvent('conversation_updated', { conversationId });
        return sendJson(res, 200, { muted: conv.mutedBy.includes(userId) });
      }

      if (action === '/group' && req.method === 'POST') {
        const body = await parseBody(req);
        const userId = String(body.userId || '');
        const op = body.op;
        if (!userId || conv.type !== 'group' || !canAccessConversation(conv, userId)) return sendJson(res, 403, { error: 'forbidden' });

        if (op === 'announcement') {
          if (conv.ownerId !== userId) return sendJson(res, 403, { error: 'owner_only' });
          conv.announcement = String(body.announcement || '');
          db.messages.push({ id: uid('m'), conversationId, senderId: userId, type: 'system', text: `群公告：${conv.announcement || '（空）'}`, createdAt: Date.now() });
          saveDb();
          broadcastEvent('message_created', { conversationId });
          return sendJson(res, 200, { ok: true });
        }

        if (op === 'invite') {
          const targetUserId = String(body.targetUserId || '');
          if (!targetUserId || conv.members.includes(targetUserId)) return sendJson(res, 400, { error: 'invalid_target' });
          conv.members.push(targetUserId);
          conv.lastRead[targetUserId] = 0;
          db.messages.push({ id: uid('m'), conversationId, senderId: userId, type: 'system', text: `${nameOfUser(userId)} 邀请新成员加入群聊`, createdAt: Date.now() });
          saveDb();
          broadcastEvent('conversation_updated', { conversationId });
          return sendJson(res, 200, { ok: true });
        }

        if (op === 'leave') {
          if (conv.ownerId === userId && conv.members.length > 1) return sendJson(res, 400, { error: 'owner_cannot_leave' });
          conv.members = conv.members.filter((id) => id !== userId);
          delete conv.lastRead[userId];
          saveDb();
          broadcastEvent('conversation_updated', { conversationId });
          return sendJson(res, 200, { ok: true });
        }

        return sendJson(res, 400, { error: 'unknown_op' });
      }

      if (action === '/signal' && req.method === 'POST') {
        const body = await parseBody(req);
        const senderId = String(body.senderId || '');
        const targetUserId = String(body.targetUserId || '');
        if (!senderId || !targetUserId || !canAccessConversation(conv, senderId)) return sendJson(res, 403, { error: 'forbidden' });
        broadcastEvent('webrtc_signal', {
          conversationId,
          senderId,
          targetUserId,
          signal: body.signal || null,
          mode: body.mode || 'voice',
        });
        return sendJson(res, 200, { ok: true });
      }

      if (action === '/call' && req.method === 'POST') {
        const body = await parseBody(req);
        const senderId = String(body.senderId || '');
        const targetUserId = String(body.targetUserId || '');
        const event = String(body.event || '');
        const mode = body.mode === 'video' ? 'video' : 'voice';
        if (!senderId || !targetUserId || !canAccessConversation(conv, senderId)) return sendJson(res, 403, { error: 'forbidden' });
        broadcastEvent('call_event', { conversationId, senderId, targetUserId, event, mode });
        return sendJson(res, 200, { ok: true });
      }
    }

    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

function nameOfUser(userId) {
  return db.users.find((u) => u.id === userId)?.displayName || '用户';
}

server.listen(PORT, () => {
  console.log(`ChatTrade server running at http://0.0.0.0:${PORT}`);
});
