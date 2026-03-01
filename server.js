const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'data.json');
const MSG_WAL_FILE = path.join(ROOT, 'message.wal');
const MAX_DEDUP_IDS = 5000;

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}


function appendWal(entry) {
  return fs.promises.appendFile(MSG_WAL_FILE, `${JSON.stringify(entry)}\n`);
}

function loadWalEntries() {
  if (!fs.existsSync(MSG_WAL_FILE)) return [];
  const lines = fs.readFileSync(MSG_WAL_FILE, 'utf8').split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // ignore malformed line
    }
  }
  return entries;
}

function rebuildWalFromMemory() {
  const lines = db.messages.map((msg) => JSON.stringify({ op: 'message_add', message: msg })).join('\n');
  const output = lines ? `${lines}\n` : '';
  fs.writeFileSync(MSG_WAL_FILE, output);
}

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    const alice = uid('u');
    const bob = uid('u');
    const conv = uid('c');
    const now = Date.now();
    const db = {
      users: [
        {
          id: alice,
          username: 'alice',
          password: '1234',
          displayName: 'Alice',
          signature: '热爱好物分享',
          phone: '13800000001',
          appNumberId: 'CT10001',
          products: [{ id: uid('p'), title: '闲置相机', price: 1299, desc: '成色95新，支持验货' }],
          createdAt: now,
        },
        {
          id: bob,
          username: 'bob',
          password: '1234',
          displayName: 'Bob',
          signature: '专注数码与潮玩',
          phone: '13800000002',
          appNumberId: 'CT10002',
          products: [{ id: uid('p'), title: '机械键盘', price: 299, desc: '红轴，支持蓝牙' }],
          createdAt: now,
        },
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
          lastMessageAt: now,
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
  if (!loaded.messages) loaded.messages = [];
  if (!loaded.conversations) loaded.conversations = [];
  if (!loaded.users) loaded.users = [];
  loaded.users = loaded.users.map((u, i) => ({
    signature: u.signature || '这个人很懒，暂未填写签名',
    phone: u.phone || '',
    appNumberId: u.appNumberId || `CT${10000 + i}`,
    products: Array.isArray(u.products) ? u.products : [],
    ...u,
  }));
  return loaded;
}

let db = loadDb();

for (const entry of loadWalEntries()) {
  if (entry.op !== 'message_add' || !entry.message) continue;
  const exists = db.messages.some((m) => m.id === entry.message.id);
  if (!exists) db.messages.push(entry.message);
}

const index = {
  usersById: new Map(),
  usersByName: new Map(),
  convById: new Map(),
  convByUser: new Map(),
  messagesByConv: new Map(),
  friendshipsByUser: new Map(),
};

function addToMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function rebuildIndexes() {
  index.usersById.clear();
  index.usersByName.clear();
  index.convById.clear();
  index.convByUser.clear();
  index.messagesByConv.clear();
  index.friendshipsByUser.clear();

  for (const user of db.users) {
    index.usersById.set(user.id, user);
    index.usersByName.set(user.username, user);
  }

  for (const conv of db.conversations) {
    if (!conv.lastRead) conv.lastRead = {};
    if (!Array.isArray(conv.mutedBy)) conv.mutedBy = [];
    if (!conv.lastMessageAt) conv.lastMessageAt = conv.createdAt || Date.now();
    index.convById.set(conv.id, conv);
    for (const memberId of conv.members || []) addToMapArray(index.convByUser, memberId, conv);
  }

  for (const msg of db.messages) {
    addToMapArray(index.messagesByConv, msg.conversationId, msg);
    const conv = index.convById.get(msg.conversationId);
    if (conv && msg.createdAt > (conv.lastMessageAt || 0)) conv.lastMessageAt = msg.createdAt;
  }

  for (const rel of db.friendships) addToMapArray(index.friendshipsByUser, rel.userId, rel);
}

rebuildIndexes();
rebuildWalFromMemory();

const recentClientMessageIds = new Map();

function rememberClientMessageId(conversationId, senderId, clientMessageId, messageId) {
  const key = `${conversationId}:${senderId}`;
  if (!recentClientMessageIds.has(key)) recentClientMessageIds.set(key, new Map());
  const map = recentClientMessageIds.get(key);
  map.set(clientMessageId, messageId);
  if (map.size > MAX_DEDUP_IDS) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
}

function findMessageIdByClientMessageId(conversationId, senderId, clientMessageId) {
  const key = `${conversationId}:${senderId}`;
  return recentClientMessageIds.get(key)?.get(clientMessageId) || null;
}

let persistTimer = null;
let persistInFlight = false;
let persistDirty = false;

async function flushPersist() {
  if (persistInFlight) {
    persistDirty = true;
    return;
  }
  persistInFlight = true;
  try {
    await fs.promises.writeFile(DB_FILE, JSON.stringify(db, null, 2));
    rebuildWalFromMemory();
  } finally {
    persistInFlight = false;
    if (persistDirty) {
      persistDirty = false;
      setTimeout(flushPersist, 10);
    }
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    await flushPersist();
  }, 80);
}

const sseClientsByUser = new Map();

function addSseClient(userId, res) {
  if (!sseClientsByUser.has(userId)) sseClientsByUser.set(userId, new Set());
  sseClientsByUser.get(userId).add(res);
}

function removeSseClient(userId, res) {
  const set = sseClientsByUser.get(userId);
  if (!set) return;
  set.delete(res);
  if (!set.size) sseClientsByUser.delete(userId);
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcastToUser(userId, event, payload) {
  const clients = sseClientsByUser.get(userId);
  if (!clients) return;
  for (const client of clients) {
    try {
      sendSse(client, event, payload);
    } catch {
      clients.delete(client);
    }
  }
}

function broadcastToConversation(conversationId, event, payload) {
  const conv = index.convById.get(conversationId);
  if (!conv) return;
  for (const userId of conv.members) broadcastToUser(userId, event, payload);
}

function broadcastAll(event, payload) {
  for (const userId of sseClientsByUser.keys()) broadcastToUser(userId, event, payload);
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
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt };
}

function conversationTitle(conv, userId) {
  if (conv.type === 'group') return conv.name;
  const peerId = conv.members.find((id) => id !== userId);
  return index.usersById.get(peerId)?.displayName || '未知用户';
}

function conversationPreview(conv) {
  const list = index.messagesByConv.get(conv.id) || [];
  const last = list[list.length - 1];
  if (!last) return '暂无消息';
  if (last.type === 'image') return '[图片]';
  if (last.type === 'card') return `[${last.card?.cardType || '卡片'}]`;
  return last.text || '系统消息';
}

function unreadCount(conv, userId) {
  const lastRead = conv.lastRead?.[userId] || 0;
  const list = index.messagesByConv.get(conv.id) || [];
  let unread = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m.createdAt <= lastRead) break;
    if (m.senderId !== userId) unread += 1;
  }
  return unread;
}

function canAccessConversation(conv, userId) {
  return conv.members.includes(userId);
}

function ensureFriend(userId, friendId, group = '我的好友') {
  const existing = (index.friendshipsByUser.get(userId) || []).find((f) => f.friendId === friendId);
  if (!existing) {
    const rel = { id: uid('f'), userId, friendId, group };
    db.friendships.push(rel);
    addToMapArray(index.friendshipsByUser, userId, rel);
  }
}

function addMessage(msg) {
  db.messages.push(msg);
  addToMapArray(index.messagesByConv, msg.conversationId, msg);
  const conv = index.convById.get(msg.conversationId);
  if (conv) conv.lastMessageAt = msg.createdAt;
  return msg;
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
      const userId = searchParams.get('userId');
      if (!userId) return sendJson(res, 400, { error: 'missing_userId' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      sendSse(res, 'ready', {});
      addSseClient(userId, res);
      req.on('close', () => removeSseClient(userId, res));
      return;
    }

    if (pathname === '/api/register' && req.method === 'POST') {
      const body = await parseBody(req);
      const displayName = String(body.displayName || '').trim();
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!displayName || !username || password.length < 4) return sendJson(res, 400, { error: 'invalid_input' });
      if (index.usersByName.has(username)) return sendJson(res, 409, { error: 'username_exists' });
      const user = {
        id: uid('u'),
        username,
        password,
        displayName,
        signature: '这个人很懒，暂未填写签名',
        phone: '',
        appNumberId: `CT${Date.now().toString().slice(-8)}`,
        products: [],
        createdAt: Date.now(),
      };
      db.users.push(user);
      index.usersById.set(user.id, user);
      index.usersByName.set(user.username, user);
      schedulePersist();
      broadcastAll('users_updated', { userId: user.id });
      return sendJson(res, 201, { user: getUserSafe(user) });
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const user = index.usersByName.get(username);
      if (!user || user.password !== password) return sendJson(res, 401, { error: 'invalid_credentials' });
      return sendJson(res, 200, { user: getUserSafe(user) });
    }

    if (pathname === '/api/users' && req.method === 'GET') {
      const currentUserId = searchParams.get('currentUserId');
      const q = (searchParams.get('q') || '').toLowerCase();
      let users = db.users.filter((u) => u.id !== currentUserId);
      if (q) users = users.filter((u) =>
        u.username.toLowerCase().includes(q)
        || u.displayName.toLowerCase().includes(q)
        || String(u.appNumberId || '').toLowerCase().includes(q));
      return sendJson(res, 200, { users: users.map(getUserSafe) });
    }

    const profileMatch = pathname.match(/^\/api\/users\/([^/]+)\/profile$/);
    if (profileMatch && req.method === 'GET') {
      const targetUserId = profileMatch[1];
      const viewerId = String(searchParams.get('viewerId') || '');
      const target = index.usersById.get(targetUserId);
      if (!target) return sendJson(res, 404, { error: 'user_not_found' });
      const relation = (index.friendshipsByUser.get(viewerId) || []).find((f) => f.friendId === targetUserId);
      const remarkName = relation?.remark || target.displayName;
      return sendJson(res, 200, {
        profile: {
          id: target.id,
          avatarText: (remarkName || target.displayName || target.username).slice(0, 1),
          nickname: target.displayName,
          remarkName,
          signature: target.signature || '',
          phone: target.phone || '',
          appNumberId: target.appNumberId || '',
          products: target.products || [],
        },
      });
    }

    if (pathname === '/api/friends' && req.method === 'GET') {
      const userId = searchParams.get('userId');
      if (!userId) return sendJson(res, 400, { error: 'missing_userId' });
      const friends = (index.friendshipsByUser.get(userId) || [])
        .map((f) => ({ ...f, friend: getUserSafe(index.usersById.get(f.friendId)) }))
        .filter((f) => f.friend);
      return sendJson(res, 200, { friends });
    }

    if (pathname === '/api/friends' && req.method === 'POST') {
      const body = await parseBody(req);
      const userId = String(body.userId || '');
      const friendUsername = String(body.friendUsername || '').trim();
      const group = String(body.group || '我的好友').trim() || '我的好友';
      if (!userId || !friendUsername) return sendJson(res, 400, { error: 'invalid_input' });
      const friend = index.usersByName.get(friendUsername);
      if (!friend || friend.id === userId) return sendJson(res, 404, { error: 'friend_not_found' });
      ensureFriend(userId, friend.id, group);
      ensureFriend(friend.id, userId, '我的好友');
      schedulePersist();
      broadcastToUser(userId, 'friends_updated', { userId });
      broadcastToUser(friend.id, 'friends_updated', { userId: friend.id });
      return sendJson(res, 201, { ok: true, friend: getUserSafe(friend) });
    }

    if (pathname === '/api/friends/group' && req.method === 'POST') {
      const body = await parseBody(req);
      const userId = String(body.userId || '');
      const friendId = String(body.friendId || '');
      const group = String(body.group || '我的好友').trim() || '我的好友';
      const rel = (index.friendshipsByUser.get(userId) || []).find((f) => f.friendId === friendId);
      if (!rel) return sendJson(res, 404, { error: 'friendship_not_found' });
      rel.group = group;
      schedulePersist();
      broadcastToUser(userId, 'friends_updated', { userId });
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/friends/remark' && req.method === 'POST') {
      const body = await parseBody(req);
      const userId = String(body.userId || '');
      const friendId = String(body.friendId || '');
      const remark = String(body.remark || '').trim();
      const rel = (index.friendshipsByUser.get(userId) || []).find((f) => f.friendId === friendId);
      if (!rel) return sendJson(res, 404, { error: 'friendship_not_found' });
      rel.remark = remark;
      schedulePersist();
      broadcastToUser(userId, 'friends_updated', { userId });
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/conversations' && req.method === 'GET') {
      const userId = searchParams.get('userId');
      if (!userId) return sendJson(res, 400, { error: 'missing_userId' });
      const convs = (index.convByUser.get(userId) || [])
        .map((c) => ({ ...c, title: conversationTitle(c, userId), preview: conversationPreview(c), unread: unreadCount(c, userId) }))
        .sort((a, b) => (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0));
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
        const existed = (index.convByUser.get(creatorId) || []).find((c) => c.type === 'direct' && c.members.includes(peerId));
        if (existed) return sendJson(res, 200, { conversation: existed });

        const conv = {
          id: uid('c'), type: 'direct', name: '', ownerId: null, members: [creatorId, peerId], announcement: '', mutedBy: [],
          lastOrderStep: -1, lastRead: { [creatorId]: Date.now(), [peerId]: 0 }, createdAt: Date.now(), lastMessageAt: Date.now(),
        };
        db.conversations.push(conv);
        index.convById.set(conv.id, conv);
        addToMapArray(index.convByUser, creatorId, conv);
        addToMapArray(index.convByUser, peerId, conv);

        ensureFriend(creatorId, peerId);
        ensureFriend(peerId, creatorId);

        schedulePersist();
        broadcastToUser(creatorId, 'conversation_updated', { conversationId: conv.id });
        broadcastToUser(peerId, 'conversation_updated', { conversationId: conv.id });
        broadcastToUser(creatorId, 'friends_updated', { userId: creatorId });
        broadcastToUser(peerId, 'friends_updated', { userId: peerId });
        return sendJson(res, 201, { conversation: conv });
      }

      const groupName = String(body.name || '新群聊').trim() || '新群聊';
      const unique = [...new Set([creatorId, ...memberIds])];
      const conv = {
        id: uid('c'), type: 'group', name: groupName, ownerId: creatorId, members: unique, announcement: '', mutedBy: [],
        lastOrderStep: -1, lastRead: Object.fromEntries(unique.map((id) => [id, id === creatorId ? Date.now() : 0])),
        createdAt: Date.now(), lastMessageAt: Date.now(),
      };
      db.conversations.push(conv);
      index.convById.set(conv.id, conv);
      for (const member of unique) addToMapArray(index.convByUser, member, conv);

      const systemMsg = { id: uid('m'), conversationId: conv.id, senderId: creatorId, type: 'system', text: `已创建群聊 ${groupName}`, createdAt: Date.now() };
      addMessage(systemMsg);
      schedulePersist();
      broadcastToConversation(conv.id, 'conversation_updated', { conversationId: conv.id });
      return sendJson(res, 201, { conversation: conv });
    }

    const convMatch = pathname.match(/^\/api\/conversations\/([^/]+)(\/messages|\/read|\/group|\/mute|\/signal|\/call)?$/);
    if (convMatch) {
      const conversationId = convMatch[1];
      const action = convMatch[2] || '';
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'conversation_not_found' });

      if (action === '/messages' && req.method === 'GET') {
        const userId = searchParams.get('userId');
        if (!userId || !canAccessConversation(conv, userId)) return sendJson(res, 403, { error: 'forbidden' });
        return sendJson(res, 200, { conversation: conv, messages: index.messagesByConv.get(conversationId) || [] });
      }

      if (action === '/messages' && req.method === 'POST') {
        const body = await parseBody(req);
        const senderId = String(body.senderId || '');
        if (!senderId || !canAccessConversation(conv, senderId)) return sendJson(res, 403, { error: 'forbidden' });

        const clientMessageId = body.clientMessageId ? String(body.clientMessageId) : '';
        if (clientMessageId) {
          const existingId = findMessageIdByClientMessageId(conversationId, senderId, clientMessageId);
          if (existingId) {
            const existingMsg = (index.messagesByConv.get(conversationId) || []).find((m) => m.id === existingId);
            if (existingMsg) return sendJson(res, 200, { message: existingMsg, deduplicated: true });
          }
        }

        const type = body.type || 'text';
        const msg = {
          id: uid('m'),
          conversationId,
          senderId,
          type,
          text: type === 'text' || type === 'system' ? String(body.text || '') : undefined,
          imageUrl: type === 'image' ? String(body.imageUrl || '') : undefined,
          card: type === 'card' ? body.card || null : undefined,
          createdAt: Date.now(),
        };

        await appendWal({ op: 'message_add', message: msg });
        addMessage(msg);
        if (clientMessageId) rememberClientMessageId(conversationId, senderId, clientMessageId, msg.id);
        schedulePersist();
        broadcastToConversation(conversationId, 'message_created', { conversationId, messageId: msg.id });
        return sendJson(res, 201, { message: msg });
      }

      if (action === '/read' && req.method === 'POST') {
        const body = await parseBody(req);
        const userId = String(body.userId || '');
        if (!userId || !canAccessConversation(conv, userId)) return sendJson(res, 403, { error: 'forbidden' });
        conv.lastRead[userId] = Date.now();
        schedulePersist();
        broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
        return sendJson(res, 200, { ok: true });
      }

      if (action === '/mute' && req.method === 'POST') {
        const body = await parseBody(req);
        const userId = String(body.userId || '');
        if (!userId || !canAccessConversation(conv, userId)) return sendJson(res, 403, { error: 'forbidden' });
        const idx = conv.mutedBy.indexOf(userId);
        if (idx >= 0) conv.mutedBy.splice(idx, 1); else conv.mutedBy.push(userId);
        schedulePersist();
        broadcastToUser(userId, 'conversation_updated', { conversationId });
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
          addMessage({ id: uid('m'), conversationId, senderId: userId, type: 'system', text: `群公告：${conv.announcement || '（空）'}`, createdAt: Date.now() });
          schedulePersist();
          broadcastToConversation(conversationId, 'message_created', { conversationId });
          return sendJson(res, 200, { ok: true });
        }

        if (op === 'invite') {
          const targetUserId = String(body.targetUserId || '');
          if (!targetUserId || conv.members.includes(targetUserId)) return sendJson(res, 400, { error: 'invalid_target' });
          conv.members.push(targetUserId);
          conv.lastRead[targetUserId] = 0;
          addToMapArray(index.convByUser, targetUserId, conv);
          addMessage({ id: uid('m'), conversationId, senderId: userId, type: 'system', text: `${nameOfUser(userId)} 邀请新成员加入群聊`, createdAt: Date.now() });
          schedulePersist();
          broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
          return sendJson(res, 200, { ok: true });
        }

        if (op === 'leave') {
          if (conv.ownerId === userId && conv.members.length > 1) return sendJson(res, 400, { error: 'owner_cannot_leave' });
          conv.members = conv.members.filter((id) => id !== userId);
          delete conv.lastRead[userId];
          const arr = index.convByUser.get(userId) || [];
          index.convByUser.set(userId, arr.filter((c) => c.id !== conv.id));
          schedulePersist();
          broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
          return sendJson(res, 200, { ok: true });
        }

        return sendJson(res, 400, { error: 'unknown_op' });
      }

      if (action === '/signal' && req.method === 'POST') {
        const body = await parseBody(req);
        const senderId = String(body.senderId || '');
        const targetUserId = String(body.targetUserId || '');
        if (!senderId || !targetUserId || !canAccessConversation(conv, senderId)) return sendJson(res, 403, { error: 'forbidden' });
        broadcastToUser(targetUserId, 'webrtc_signal', {
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
        broadcastToUser(targetUserId, 'call_event', { conversationId, senderId, targetUserId, event, mode });
        return sendJson(res, 200, { ok: true });
      }
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        users: db.users.length,
        conversations: db.conversations.length,
        messages: db.messages.length,
        walExists: fs.existsSync(MSG_WAL_FILE),
        sseClients: [...sseClientsByUser.values()].reduce((n, set) => n + set.size, 0),
      });
    }

    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: 'server_error' });
  }
});

function nameOfUser(userId) {
  return index.usersById.get(userId)?.displayName || '用户';
}

async function shutdown(signal) {
  try {
    await flushPersist();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`ChatTrade server running at http://0.0.0.0:${PORT}`);
});
