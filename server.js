const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const STATIC_ROOT = ROOT;
const DB_FILE = path.join(ROOT, 'data.json');
const USE_SQLITE = process.env.USE_SQLITE === '1';
const SQLITE_FILE = path.join(ROOT, 'data.sqlite');
const MSG_WAL_FILE = path.join(ROOT, 'message.wal');
const BODY_LIMIT = 2 * 1024 * 1024;
const UPLOAD_LIMIT = 8 * 1024 * 1024;
const UPLOAD_ROOT = path.join(ROOT, 'uploads');
const serverStartedAt = Date.now();

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt = makeSalt()) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (!stored.includes(':')) return String(password) === stored;
  const [salt, hash] = stored.split(':');
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(actual, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function appendWal(event, payload = {}) {
  const line = JSON.stringify({ ts: Date.now(), event, payload });
  try {
    fs.appendFileSync(MSG_WAL_FILE, `${line}\n`);
  } catch (_) {}
}


function truncateWalIfLarge(maxBytes = 5 * 1024 * 1024) {
  try {
    const st = fs.statSync(MSG_WAL_FILE);
    if (st.size <= maxBytes) return;
    // Keep last maxBytes/2 bytes to retain recent audit trail.
    const keep = Math.floor(maxBytes / 2);
    const fd = fs.openSync(MSG_WAL_FILE, 'r');
    const buf = Buffer.allocUnsafe(keep);
    fs.readSync(fd, buf, 0, keep, st.size - keep);
    fs.closeSync(fd);
    fs.writeFileSync(MSG_WAL_FILE, buf);
  } catch (_) {}
}

function clearWal() {
  try {
    fs.writeFileSync(MSG_WAL_FILE, '');
  } catch (_) {}
}


function formatCallDuration(totalSec) {
  const sec = Math.max(0, Number(totalSec) || 0);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function buildCallHistoryText(body = {}) {
  const modeLabel = body.mode === 'video' ? '视频通话' : '语音通话';
  const durationSec = Math.max(0, Number(body.durationSec) || 0);
  if (body.event === 'start' || body.event === 'accept') return '';
  if (body.event === 'cancel') return `已取消${modeLabel}`;
  if (body.reason === 'busy') return `${modeLabel}（对方忙线）`;
  if (body.reason === 'timeout') return body.event === 'reject' ? `未接${modeLabel}` : `${modeLabel}（对方无应答）`;
  if (body.reason === 'disconnect') {
    return durationSec > 0 ? `${modeLabel} ${formatCallDuration(durationSec)}` : `${modeLabel}（已中断）`;
  }
  if (body.reason === 'pagehide') {
    return durationSec > 0 ? `${modeLabel} ${formatCallDuration(durationSec)}` : `已取消${modeLabel}`;
  }
  if (body.event === 'reject') return `已拒绝${modeLabel}`;
  if (body.event === 'end') {
    return durationSec > 0 ? `${modeLabel} ${formatCallDuration(durationSec)}` : `${modeLabel}（已结束）`;
  }
  return `${modeLabel}（通话状态更新）`;
}

function sanitizePublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    signature: user.signature,
    avatarUrl: user.avatarUrl,
    appNumberId: user.appNumberId,
    customGroups: user.customGroups,
  };
}

function defaultDb() {
  const alice = uid('u');
  const bob = uid('u');
  const conv = uid('c');
  const now = Date.now();
  return {
    users: [
      { id: alice, username: 'alice', password: hashPassword('1234'), displayName: 'Alice', signature: '热爱生活', avatarUrl: null, products: [], blacklist: [], customGroups: ['我的好友', '家人', '同事'], appNumberId: 'CT10001', createdAt: now },
      { id: bob, username: 'bob', password: hashPassword('1234'), displayName: 'Bob', signature: '专注数码', avatarUrl: null, products: [], blacklist: [], customGroups: ['我的好友', '同学'], appNumberId: 'CT10002', createdAt: now },
    ],
    friendships: [
      { id: uid('f'), userId: alice, friendId: bob, group: '我的好友', remark: '' },
      { id: uid('f'), userId: bob, friendId: alice, group: '我的好友', remark: '' },
    ],
    friendRequests: [],
    conversations: [
      { id: conv, type: 'direct', name: '', ownerId: null, members: [alice, bob], announcement: '', mutedBy: [], pinnedBy: [], lastRead: { [alice]: now, [bob]: now }, clearedAt: {}, createdAt: now, lastMessageAt: now },
    ],
    messages: [
      { id: uid('m'), conversationId: conv, senderId: bob, type: 'text', text: '你好，这是测试消息。', deletedBy: [], createdAt: now },
    ],
  };
}

let sqliteStore = null;
function getSqliteStore() {
  if (!USE_SQLITE) return null;
  if (sqliteStore) return sqliteStore;
  // Lazy require to keep JSON-only installs dependency-free.
  const { openSqliteStore } = require('./sqlite_store');
  sqliteStore = openSqliteStore(SQLITE_FILE, DB_FILE, defaultDb);
  return sqliteStore;
}

function loadDb() {
  const store = getSqliteStore();
  if (store) {
    if (!fs.existsSync(MSG_WAL_FILE)) clearWal();
    return store.load();
  }
  if (!fs.existsSync(DB_FILE)) {
    const db = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    if (!fs.existsSync(MSG_WAL_FILE)) clearWal();
    return db;
  }
  const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  return { users: [], friendships: [], friendRequests: [], conversations: [], messages: [], orders: [], ...loaded };
}

let db = loadDb();
const sessions = new Map();
const index = {
  usersById: new Map(),
  usersByName: new Map(),
  usersByAppNumber: new Map(),
  convById: new Map(),
  convByUser: new Map(),
  messagesByConv: new Map(),
  friendshipsByUser: new Map(),
  friendshipByPair: new Map(),
  friendViewsByUser: new Map(),
  directConvBasesByUser: new Map(),
  requestsByTarget: new Map(),
  requestViewsByTarget: new Map(),
  blacklistViewsByUser: new Map(),
  messageByClientKey: new Map(),
  mallItems: [],
};

function addToMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

const DEFAULT_GROUP = '我的好友';
const MAX_GROUPS = 20;
const MAX_GROUP_NAME_LEN = 20;

function normalizeUserCustomGroups(groups) {
  const ordered = [];
  const seen = new Set();
  const source = Array.isArray(groups) ? groups : [];
  for (const rawName of source) {
    const name = String(rawName || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    ordered.push(name.slice(0, MAX_GROUP_NAME_LEN));
  }
  if (!seen.has(DEFAULT_GROUP)) ordered.unshift(DEFAULT_GROUP);
  else {
    const idx = ordered.indexOf(DEFAULT_GROUP);
    if (idx > 0) {
      ordered.splice(idx, 1);
      ordered.unshift(DEFAULT_GROUP);
    }
  }
  return ordered.slice(0, MAX_GROUPS);
}

function normalizeSingleGroupName(name) {
  const trimmed = String(name || '').trim();
  return trimmed ? trimmed.slice(0, MAX_GROUP_NAME_LEN) : '';
}

function rebuildMallIndex() {
  const items = [];
  for (const user of db.users) {
    const sellerName = user.displayName;
    const sellerAvatarUrl = user.avatarUrl;
    const sellerAppNumberId = user.appNumberId;
    for (const product of user.products || []) {
      items.push({
        ...product,
        sellerId: user.id,
        sellerName,
        sellerAvatarUrl,
        sellerAppNumberId,
        _searchText: `${product.title || ''} ${product.desc || ''} ${sellerName || ''}`.toLowerCase(),
      });
    }
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  index.mallItems = items;
}

function rebuildRequestViewsIndex() {
  index.requestViewsByTarget.clear();
  for (const [targetId, requests] of index.requestsByTarget.entries()) {
    const views = [];
    for (const req of requests) {
      const fromUser = index.usersById.get(req.userId);
      if (!fromUser) continue;
      views.push({
        ...req,
        sender: {
          id: fromUser.id,
          displayName: fromUser.displayName,
          avatarUrl: fromUser.avatarUrl,
          username: fromUser.username,
        },
      });
    }
    index.requestViewsByTarget.set(targetId, views);
  }
}

function rebuildBlacklistViewsIndex() {
  index.blacklistViewsByUser.clear();
  for (const user of db.users) {
    const views = [];
    for (const id of user.blacklist || []) {
      const target = index.usersById.get(id);
      if (!target) continue;
      views.push({ id: target.id, displayName: target.displayName, avatarUrl: target.avatarUrl });
    }
    index.blacklistViewsByUser.set(user.id, views);
  }
}


function rebuildFriendViewsIndex() {
  index.friendViewsByUser.clear();
  for (const [userId, rels] of index.friendshipsByUser.entries()) {
    const views = [];
    for (const rel of rels) {
      const u = index.usersById.get(rel.friendId);
      if (!u) continue;
      views.push({
        ...rel,
        friend: {
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          appNumberId: u.appNumberId,
          remark: rel.remark,
        },
      });
    }
    index.friendViewsByUser.set(userId, views);
  }
}

function rebuildConversationBaseIndex() {
  index.directConvBasesByUser.clear();
  for (const conv of db.conversations) {
    if (conv.type !== 'direct') continue;
    for (const memberId of conv.members || []) {
      const peerId = (conv.members || []).find((id) => id !== memberId);
      const peer = index.usersById.get(peerId);
      const rel = peerId ? index.friendshipByPair.get(`${memberId}:${peerId}`) : null;
      addToMapArray(index.directConvBasesByUser, memberId, {
        id: conv.id,
        type: conv.type,
        name: conv.name,
        ownerId: conv.ownerId,
        members: conv.members,
        announcement: conv.announcement,
        createdAt: conv.createdAt,
        lastMessageAt: conv.lastMessageAt,
        title: rel?.remark || peer?.displayName || '未知用户',
        peerAvatarUrl: peer?.avatarUrl,
        peerAppNumberId: peer?.appNumberId,
      });
    }
  }
}

function rebuildIndexes() {
  index.usersById.clear();
  index.usersByName.clear();
  index.usersByAppNumber.clear();
  index.convById.clear();
  index.convByUser.clear();
  index.messagesByConv.clear();
  index.friendshipsByUser.clear();
  index.friendshipByPair.clear();
  index.friendViewsByUser.clear();
  index.directConvBasesByUser.clear();
  index.requestsByTarget.clear();
  index.requestViewsByTarget.clear();
  index.blacklistViewsByUser.clear();
  index.messageByClientKey.clear();
  index.mallItems = [];
  for (const user of db.users) {
    if (!Array.isArray(user.blacklist)) user.blacklist = [];
    if (!Array.isArray(user.products)) user.products = [];
    user.customGroups = normalizeUserCustomGroups(user.customGroups);
    if (!user.appNumberId) user.appNumberId = `CT${Math.floor(Math.random() * 900000 + 100000)}`;
    index.usersById.set(user.id, user);
    index.usersByName.set(user.username, user);
    index.usersByAppNumber.set(user.appNumberId, user);
  }
  for (const conv of db.conversations) {
    if (!conv.clearedAt) conv.clearedAt = {};
    if (!conv.lastRead) conv.lastRead = {};
    if (!Array.isArray(conv.mutedBy)) conv.mutedBy = [];
    if (!Array.isArray(conv.pinnedBy)) conv.pinnedBy = [];
    if (!Array.isArray(conv.members)) conv.members = [];
    index.convById.set(conv.id, conv);
    for (const memberId of conv.members) addToMapArray(index.convByUser, memberId, conv);
  }
  for (const msg of db.messages) {
    if (!Array.isArray(msg.deletedBy)) msg.deletedBy = [];
    addToMapArray(index.messagesByConv, msg.conversationId, msg);
    if (msg.clientMessageId && msg.senderId) index.messageByClientKey.set(`${msg.conversationId}:${msg.senderId}:${msg.clientMessageId}`, msg);
  }
  for (const rel of db.friendships) {
    addToMapArray(index.friendshipsByUser, rel.userId, rel);
    index.friendshipByPair.set(`${rel.userId}:${rel.friendId}`, rel);
  }
  for (const req of db.friendRequests) if (req.status === 'pending') addToMapArray(index.requestsByTarget, req.targetId, req);
  rebuildFriendViewsIndex();
  rebuildConversationBaseIndex();
  rebuildRequestViewsIndex();
  rebuildBlacklistViewsIndex();
  rebuildMallIndex();
}
rebuildIndexes();

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
    const store = getSqliteStore();
    if (store) {
      store.save(db);
    } else {
      const tmp = `${DB_FILE}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(db, null, 2));
      // Atomic replace on POSIX filesystems
      await fs.promises.rename(tmp, DB_FILE);
    }
    appendWal('checkpoint', { at: Date.now() });
    truncateWalIfLarge();
  } finally {
    persistInFlight = false;
    if (persistDirty) {
      persistDirty = false;
      setTimeout(flushPersist, 10);
    }
  }
}
function schedulePersist(reason = 'update', payload = {}) {
  appendWal(reason, payload);
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    await flushPersist();
  }, 60);
}

const sseClientsByUser = new Map();
const sseHeartbeatByRes = new WeakMap();
function addSseClient(userId, res) {
  if (!sseClientsByUser.has(userId)) sseClientsByUser.set(userId, new Set());
  sseClientsByUser.get(userId).add(res);
  const timer = setInterval(() => {
    try { if (!res.destroyed && !res.writableEnded) res.write(':ping\n\n'); } catch (_) {}
  }, 15000);
  sseHeartbeatByRes.set(res, timer);
}
function removeSseClient(userId, res) {
  const timer = sseHeartbeatByRes.get(res);
  if (timer) { clearInterval(timer); sseHeartbeatByRes.delete(res); }
  const set = sseClientsByUser.get(userId);
  if (!set) return;
  set.delete(res);
  if (!set.size) sseClientsByUser.delete(userId);
}
function sendSse(res, event, payload) {
  try {
    if (res.destroyed || res.writableEnded) return false;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch (_) { return false; }
}
function broadcastToUser(userId, event, payload) {
  const clients = sseClientsByUser.get(userId);
  if (!clients) return;
  for (const client of [...clients]) {
    const ok = sendSse(client, event, payload);
    if (!ok) removeSseClient(userId, client);
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
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        const err = new Error('payload_too_large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        const err = new Error('invalid_json');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}


function parseRawBody(req, limit = UPLOAD_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('payload_too_large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function ensureUploadRoot() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

function safeUploadFileName(name) {
  const base = path.basename(String(name || '').trim()).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(-80) || 'file.bin';
}

function fileExtFromType(contentType, originalName = '') {
  const lowered = String(contentType || '').toLowerCase();
  if (lowered.includes('image/jpeg')) return '.jpg';
  if (lowered.includes('image/png')) return '.png';
  if (lowered.includes('image/webp')) return '.webp';
  if (lowered.includes('audio/webm')) return '.webm';
  if (lowered.includes('audio/ogg')) return '.ogg';
  if (lowered.includes('audio/mp4')) return '.m4a';
  if (lowered.includes('video/mp4')) return '.mp4';
  const ext = path.extname(originalName || '');
  return ext && ext.length <= 8 ? ext : '.bin';
}

function isMessageVisibleToUser(msg, conv, userId) {
  const clearedAt = conv.clearedAt?.[userId] || 0;
  if (msg.createdAt <= clearedAt) return false;
  return !(msg.deletedBy || []).includes(userId);
}

function getVisibleMessagesSlice(conv, userId, before = 0, limit = 30) {
  const list = index.messagesByConv.get(conv.id) || [];
  const out = [];
  let hasMore = false;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (before > 0 && msg.createdAt >= before) continue;
    if (!isMessageVisibleToUser(msg, conv, userId)) continue;
    if (out.length < limit) out.push(msg);
    else {
      hasMore = true;
      break;
    }
  }
  out.reverse();
  return { messages: out, hasMore };
}

function buildConversationMeta(conv, userId) {
  const list = index.messagesByConv.get(conv.id) || [];
  const lastRead = conv.lastRead?.[userId] || 0;
  let unread = 0;
  let preview = '暂无消息';
  let foundPreview = false;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (!isMessageVisibleToUser(msg, conv, userId)) continue;
    if (!foundPreview) {
      if (msg.type === 'image') preview = '[图片]';
      else if (msg.type === 'audio') preview = '[语音]';
      else if (msg.type === 'card') preview = '[商品卡片]';
      else preview = msg.text || '[消息]';
      foundPreview = true;
    }
    if (msg.createdAt > lastRead && msg.senderId !== userId) unread += 1;
    if (foundPreview && msg.createdAt <= lastRead) break;
  }
  return { preview, unread };
}

function matchRoute(route, target) {
  const normalized = route.replace(/\/+$/, '');
  return normalized === target || normalized === `/api${target}` || normalized === target.replace(/^\/api/, '');
}

function issueSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, createdAt: Date.now() });
  return token;
}

function getAuthUser(req, searchParams = null) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  let token = match?.[1] || null;
  if (!token && searchParams) token = searchParams.get('token');
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  return index.usersById.get(session.userId) || null;
}

function requireAuth(req, res, searchParams = null) {
  const user = getAuthUser(req, searchParams);
  if (!user) {
    sendJson(res, 401, { error: 'unauthorized' });
    return null;
  }
  return user;
}

function ensureActingUser(body, authUser, ...candidateKeys) {
  for (const key of candidateKeys) {
    if (body[key] && body[key] !== authUser.id) {
      const err = new Error('forbidden');
      err.statusCode = 403;
      throw err;
    }
    if (key) body[key] = authUser.id;
  }
}

function areFriends(userId, friendId) {
  return index.friendshipByPair.has(`${userId}:${friendId}`);
}

function getDirectConversation(userId, peerId) {
  return (index.convByUser.get(userId) || []).find((c) => c.type === 'direct' && c.members.includes(peerId));
}

function removeFriendshipPair(a, b) {
  db.friendships = db.friendships.filter((f) => !((f.userId === a && f.friendId === b) || (f.userId === b && f.friendId === a)));
  rebuildIndexes();
}

function safeStaticPath(pathname) {
  const target = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.normalize(target).replace(/^([.][.][/\\])+/, '');
  const fullPath = path.join(STATIC_ROOT, normalized);
  const relative = path.relative(STATIC_ROOT, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return fullPath;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = requestUrl;
  const origin = req.headers.origin || '';
  const allowOrigins = new Set([
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
    'http://127.0.0.1:4173',
    'http://localhost:4173',
    'null',
  ]);
  if (!origin || allowOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || `http://127.0.0.1:${PORT}`);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, X-File-Name');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    if (matchRoute(pathname, '/api/health') && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        uptimeMs: Date.now() - serverStartedAt,
        walExists: fs.existsSync(MSG_WAL_FILE),
        pendingSseUsers: sseClientsByUser.size,
      });
    }

    if (matchRoute(pathname, '/api/login') && req.method === 'POST') {
      const body = await parseBody(req);
      const user = index.usersByName.get(String(body.username || '').trim());
      if (!user || !verifyPassword(body.password, user.password)) return sendJson(res, 401, { error: '账号或密码错误' });
      if (!user.password.includes(':')) {
        user.password = hashPassword(body.password);
        schedulePersist('migrate_password', { userId: user.id });
      }
      const token = issueSession(user.id);
      return sendJson(res, 200, { token, user: sanitizePublicUser(user) });
    }

    if (matchRoute(pathname, '/api/register') && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.displayName || !body.username || !body.password) return sendJson(res, 400, { error: '请填写完整信息' });
      const username = String(body.username).trim();
      if (index.usersByName.has(username)) return sendJson(res, 409, { error: '该登录账号已被注册，请更换账号' });
      const user = {
        id: uid('u'),
        username,
        password: hashPassword(body.password),
        displayName: String(body.displayName).trim(),
        signature: '暂未填写签名',
        avatarUrl: null,
        products: [],
        blacklist: [],
        customGroups: ['我的好友'],
        appNumberId: `CT${Math.floor(Math.random() * 900000 + 100000)}`,
        createdAt: Date.now(),
      };
      db.users.push(user);
      rebuildIndexes();
      schedulePersist('register', { userId: user.id });
      const token = issueSession(user.id);
      broadcastAll('users_updated', { userId: user.id });
      return sendJson(res, 201, { token, user: sanitizePublicUser(user) });
    }


    if (matchRoute(pathname, '/api/upload') && req.method === 'POST') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      if (!(contentType.startsWith('image/') || contentType.startsWith('audio/'))) {
        return sendJson(res, 400, { error: 'unsupported_media_type' });
      }
      const raw = await parseRawBody(req, UPLOAD_LIMIT);
      if (!raw.length) return sendJson(res, 400, { error: 'empty_upload' });
      ensureUploadRoot();
      const originalName = safeUploadFileName(req.headers['x-file-name'] || 'upload.bin');
      const ext = fileExtFromType(contentType, originalName);
      const storedName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      const filePath = path.join(UPLOAD_ROOT, storedName);
      await fs.promises.writeFile(filePath, raw);
      appendWal('upload', { userId: authUser.id, file: storedName, size: raw.length });
      return sendJson(res, 201, { url: `/uploads/${storedName}`, contentType, size: raw.length });
    }

    if (matchRoute(pathname, '/api/events') && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      res.write(':ping\n\n');
      sendSse(res, 'ready', {});
      addSseClient(authUser.id, res);
      req.on('close', () => removeSseClient(authUser.id, res));
      req.on('aborted', () => removeSseClient(authUser.id, res));
      res.on('close', () => removeSseClient(authUser.id, res));
      return;
    }

    if (matchRoute(pathname, '/api/users') && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const users = db.users
        .filter((u) => u.id !== authUser.id)
        .map((u) => ({ id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, appNumberId: u.appNumberId }));
      return sendJson(res, 200, { users });
    }

    if (matchRoute(pathname, '/api/users/update') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      if (body.displayName !== undefined) authUser.displayName = String(body.displayName).trim() || authUser.displayName;
      if (body.signature !== undefined) authUser.signature = String(body.signature).trim();
      if (body.avatarUrl !== undefined) authUser.avatarUrl = body.avatarUrl || null;
      if (Array.isArray(body.customGroups)) authUser.customGroups = normalizeUserCustomGroups(body.customGroups);
      rebuildFriendViewsIndex();
      rebuildConversationBaseIndex();
      rebuildRequestViewsIndex();
      rebuildBlacklistViewsIndex();
      rebuildMallIndex();
      schedulePersist('user_update', { userId: authUser.id });
      broadcastToUser(authUser.id, 'profile_updated', {});
      broadcastAll('mall_updated', {});
      return sendJson(res, 200, { user: sanitizePublicUser(authUser) });
    }

    const profileMatch = pathname.match(/(?:\/api)?\/users\/([^/]+)\/profile$/);
    if (profileMatch && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const targetId = profileMatch[1];
      const target = index.usersById.get(targetId);
      if (!target) return sendJson(res, 404, { error: 'not_found' });
      const rel = index.friendshipByPair.get(`${authUser.id}:${targetId}`);
      const profile = {
        id: target.id,
        username: target.username,
        nickname: target.displayName,
        avatarUrl: target.avatarUrl,
        signature: target.signature,
        appNumberId: target.appNumberId,
        remarkName: rel?.remark || '',
        groupName: rel?.group || '',
        isFriend: !!rel,
        customGroups: authUser.customGroups,
      };
      return sendJson(res, 200, { profile });
    }


    const storeMatch = pathname.match(/^\/api\/users\/([^/]+)\/store$/);
    if (storeMatch && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const seller = index.usersById.get(storeMatch[1]);
      if (!seller) return sendJson(res, 404, { error: 'not_found' });
      const items = (seller.products || []).map((p) => ({
        ...p,
        imageUrl: p.image,
        specs: Array.isArray(p.specs) ? p.specs : ['默认规格','标准版','高配版'],
      }));
      return sendJson(res, 200, { items });
    }

    if (matchRoute(pathname, '/api/orders') && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const sellerId = String(searchParams.get('sellerId') || '');
      const userId = String(searchParams.get('userId') || authUser.id);
      const orders = (db.orders || []).filter((o) => {
        if (sellerId) return o.sellerId === sellerId && (o.buyerId === authUser.id || o.sellerId === authUser.id);
        return o.buyerId === userId || o.sellerId === userId;
      }).sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
      return sendJson(res, 200, { orders });
    }

    if (matchRoute(pathname, '/api/orders') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      const seller = index.usersById.get(body.sellerId);
      if (!seller) return sendJson(res, 404, { error: 'not_found' });
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return sendJson(res, 400, { error: 'empty_items' });
      const normalized = items.map((item) => ({
        productId: item.productId || '',
        title: String(item.title || '').trim() || '商品',
        spec: String(item.spec || '默认规格').trim(),
        quantity: Math.max(1, Number(item.quantity || 1)),
        price: Math.max(0, Number(item.price || 0)),
      }));
      const total = normalized.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const order = {
        id: uid('o'),
        buyerId: authUser.id,
        sellerId: seller.id,
        items: normalized,
        total,
        status: 'placed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (!Array.isArray(db.orders)) db.orders = [];
      db.orders.unshift(order);
      const conv = getOrCreateDirectConversation(authUser.id, seller.id);
      const summary = normalized.map((item) => `${item.title}(${item.spec}) x${item.quantity}`).join('，');
      addTradeMessage(conv.id, {
        senderId: authUser.id,
        type: 'order_card',
        order: {
          id: order.id,
          title: `新订单 · ${seller.displayName || seller.nickname || seller.username}`,
          summary,
          total: order.total,
          status: order.status,
          role: 'buyer'
        }
      });
      conv.updatedAt = new Date().toISOString();
      schedulePersist('order_create', { orderId: order.id, buyerId: authUser.id, sellerId: seller.id });
      return sendJson(res, 201, { order });
    }

    const orderPriceMatch = pathname.match(/^\/api\/orders\/([^/]+)\/price$/);
    if (orderPriceMatch && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const order = (db.orders || []).find((o) => o.id === orderPriceMatch[1]);
      if (!order) return sendJson(res, 404, { error: 'not_found' });
      if (order.sellerId !== authUser.id && order.buyerId !== authUser.id) return sendJson(res, 403, { error: 'forbidden' });
      const body = await parseBody(req);
      order.total = Math.max(0, Number(body.total || 0));
      order.updatedAt = Date.now();
      order.status = 'price_updated';
      const conv = getOrCreateDirectConversation(order.buyerId, order.sellerId);
      const summary = (order.items || []).map((item) => `${item.title}(${item.spec}) x${item.quantity}`).join('，');
      addTradeMessage(conv.id, {
        senderId: authUser.id,
        type: 'order_card',
        order: {
          id: order.id,
          title: '订单价格已更新',
          summary,
          total: order.total,
          status: order.status,
          role: authUser.id === order.sellerId ? 'seller' : 'buyer'
        }
      });
      conv.updatedAt = new Date().toISOString();
      schedulePersist('order_update_price', { orderId: order.id });
      return sendJson(res, 200, { order });
    }

    const orderStatusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (orderStatusMatch && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const order = (db.orders || []).find((o) => o.id === orderStatusMatch[1]);
      if (!order) return sendJson(res, 404, { error: 'not_found' });
      if (order.sellerId !== authUser.id && order.buyerId !== authUser.id) return sendJson(res, 403, { error: 'forbidden' });
      const body = await parseBody(req);
      order.status = body.status === 'completed' ? 'completed' : 'placed';
      order.updatedAt = Date.now();
      const conv = getOrCreateDirectConversation(order.buyerId, order.sellerId);
      const summary = (order.items || []).map((item) => `${item.title}(${item.spec}) x${item.quantity}`).join('，');
      addTradeMessage(conv.id, {
        senderId: authUser.id,
        type: 'order_card',
        order: {
          id: order.id,
          title: order.status === 'completed' ? '订单已完成' : '订单状态更新',
          summary,
          total: order.total,
          status: order.status,
          role: authUser.id === order.sellerId ? 'seller' : 'buyer'
        }
      });
      conv.updatedAt = new Date().toISOString();
      schedulePersist('order_update_status', { orderId: order.id, status: order.status });
      return sendJson(res, 200, { order });
    }

    
    
    if (pathname === '/api/admin/dashboard' && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const users = db.users || [];
      const orders = db.orders || [];
      const products = users.flatMap((u) => Array.isArray(u.products) ? u.products.map((p) => ({ ...p, sellerId: u.id, sellerName: u.displayName || u.nickname || u.username })) : []);
      const friendships = db.friendships || [];
      const blacklistLinks = friendships.filter((f) => f.status === 'blacklisted').length;
      const stats = {
        users: users.length,
        products: products.length,
        orders: orders.length,
        broadcasts: (db.messages || []).filter((m) => m.type === 'broadcast_card').length,
        blacklistLinks,
        pendingOrders: orders.filter((o) => o.status !== 'completed').length,
      };
      const recentOrders = orders.slice(0, 20).map((o) => {
        const buyer = users.find((u) => u.id === o.buyerId);
        const seller = users.find((u) => u.id === o.sellerId);
        return {
          id: o.id,
          total: o.total,
          status: o.status,
          buyerName: buyer ? (buyer.displayName || buyer.nickname || buyer.username) : '买家',
          sellerName: seller ? (seller.displayName || seller.nickname || seller.username) : '卖家',
          summary: (o.items || []).map((i) => `${i.title} x${i.quantity}`).join('，'),
        };
      });
      const userList = users.slice(0, 30).map((u) => {
        const sellerOrderCount = orders.filter((o) => o.sellerId === u.id).length;
        const productCount = Array.isArray(u.products) ? u.products.length : 0;
        const blacklistCount = friendships.filter((f) => f.status === 'blacklisted' && (f.userId === u.id || f.friendId === u.id)).length;
        return {
          id: u.id,
          username: u.username,
          displayName: u.displayName || u.nickname || u.username,
          sellerOrderCount,
          productCount,
          blacklistCount,
        };
      });
      const productList = products.slice(0, 30).map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        sellerName: p.sellerName,
      }));
      const reportList = [];
      if (blacklistLinks) reportList.push({ title: '黑名单关系提醒', summary: `当前共有 ${blacklistLinks} 条黑名单关系` });
      const pending = stats.pendingOrders;
      if (pending) reportList.push({ title: '待完成订单提醒', summary: `当前仍有 ${pending} 笔订单未完成` });
      return sendJson(res, 200, { stats, recentOrders, userList, productList, reportList });
    }

const broadcastMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/broadcast$/);
    if (broadcastMatch && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const conversation = index.conversationsById.get(broadcastMatch[1]);
      if (!conversation || !canAccessConversation(authUser.id, conversation)) {
        return sendJson(res, 404, { error: 'not_found' });
      }
      const body = await parseBody(req);
      const msg = addTradeMessage(conversation.id, {
        senderId: authUser.id,
        type: 'broadcast_card',
        broadcast: {
          title: String(body.title || '').trim() || '图文通知',
          summary: String(body.summary || '').trim() || '新的图文通知',
          cover: String(body.cover || '').trim(),
        }
      });
      touchConversation(conversation.id);
      return sendJson(res, 201, { message: msg });
    }

if (matchRoute(pathname, '/api/products') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      if (!body.title || !body.price || !body.image) return sendJson(res, 400, { error: 'missing_fields' });
      authUser.products.unshift({
        id: uid('p'),
        title: String(body.title).trim(),
        desc: String(body.desc || '').trim(),
        price: String(body.price).trim(),
        image: body.image,
        createdAt: Date.now(),
      });
      rebuildMallIndex();
      schedulePersist('product_create', { userId: authUser.id });
      broadcastAll('mall_updated', {});
      return sendJson(res, 201, { ok: true });
    }

    if (matchRoute(pathname, '/api/products/delete') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      authUser.products = authUser.products.filter((p) => p.id !== body.productId);
      rebuildMallIndex();
      schedulePersist('product_delete', { userId: authUser.id, productId: body.productId });
      broadcastAll('mall_updated', {});
      return sendJson(res, 200, { ok: true });
    }

    if (matchRoute(pathname, '/api/mall') && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const q = String(searchParams.get('q') || '').toLowerCase();
      const source = index.mallItems;
      const filtered = q ? source.filter((i) => i._searchText.includes(q)) : source;
      const items = filtered.map(({ _searchText, ...item }) => item);
      return sendJson(res, 200, { items });
    }

    if (matchRoute(pathname, '/api/blacklist') && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const blacklist = index.blacklistViewsByUser.get(authUser.id) || [];
      return sendJson(res, 200, { users: blacklist });
    }

    if (matchRoute(pathname, '/api/blacklist') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      const target = index.usersById.get(body.targetId);
      if (!target) return sendJson(res, 404, { error: 'not_found' });
      if (body.action === 'add') {
        if (!authUser.blacklist.includes(target.id)) authUser.blacklist.push(target.id);
      } else {
        authUser.blacklist = authUser.blacklist.filter((id) => id !== target.id);
      }
      rebuildBlacklistViewsIndex();
      schedulePersist('blacklist_update', { userId: authUser.id, targetId: target.id, action: body.action });
      return sendJson(res, 200, { ok: true });
    }

    const friendRequestHandler = async (reqBody, authUser, resObj) => {
      ensureActingUser(reqBody, authUser, 'userId');
      const keyword = String(reqBody.friendUsername || '').trim();
      const target = index.usersByName.get(keyword) || index.usersByAppNumber.get(keyword);
      if (!target || target.id === authUser.id) return sendJson(resObj, 404, { error: '未找到该用户' });
      if (areFriends(authUser.id, target.id)) return sendJson(resObj, 409, { error: 'already_friends' });
      const existingPending = (index.requestsByTarget.get(target.id) || []).find((r) => r.userId === authUser.id);
      if (existingPending) return sendJson(resObj, 409, { error: 'request_pending' });
      const request = { id: uid('fr'), userId: authUser.id, targetId: target.id, greeting: String(reqBody.greeting || '你好，想加你为好友').slice(0, 100), status: 'pending', createdAt: Date.now() };
      db.friendRequests.push(request);
      rebuildIndexes();
      schedulePersist('friend_request', { requestId: request.id });
      broadcastToUser(target.id, 'friend_request_updated', {});
      return sendJson(resObj, 201, { ok: true, request });
    };

    if (matchRoute(pathname, '/api/friends/request') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      return friendRequestHandler(body, authUser, res);
    }

    if (matchRoute(pathname, '/api/friends') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      return friendRequestHandler(body, authUser, res);
    }

    if (matchRoute(pathname, '/api/friends/requests') && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const requests = index.requestViewsByTarget.get(authUser.id) || [];
      return sendJson(res, 200, { requests });
    }

    if (matchRoute(pathname, '/api/friends/accept') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      const request = db.friendRequests.find((r) => r.id === body.requestId && r.targetId === authUser.id && r.status === 'pending');
      if (!request) return sendJson(res, 404, { error: 'not_found' });
      request.status = 'accepted';
      db.friendships.push({ id: uid('f'), userId: authUser.id, friendId: request.userId, group: '我的好友', remark: '' });
      db.friendships.push({ id: uid('f'), userId: request.userId, friendId: authUser.id, group: '我的好友', remark: '' });
      const existed = getDirectConversation(authUser.id, request.userId);
      if (!existed) {
        db.conversations.push({ id: uid('c'), type: 'direct', name: '', ownerId: authUser.id, members: [authUser.id, request.userId], announcement: '', mutedBy: [], pinnedBy: [], lastRead: {}, clearedAt: {}, createdAt: Date.now(), lastMessageAt: Date.now() });
      }
      rebuildIndexes();
      schedulePersist('friend_accept', { requestId: request.id });
      broadcastToUser(authUser.id, 'friends_updated', {});
      broadcastToUser(request.userId, 'friends_updated', {});
      broadcastToUser(authUser.id, 'friend_request_updated', {});
      broadcastToUser(request.userId, 'conversation_updated', {});
      broadcastToUser(authUser.id, 'conversation_updated', {});
      return sendJson(res, 200, { ok: true });
    }

    if (matchRoute(pathname, '/api/friends/remark') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      const rel = index.friendshipByPair.get(`${authUser.id}:${body.friendId}`);
      if (!rel) return sendJson(res, 404, { error: 'not_found' });
      if (body.group !== undefined) rel.group = body.group || '我的好友';
      if (body.remark !== undefined) rel.remark = String(body.remark || '').trim();
      rebuildFriendViewsIndex();
      rebuildConversationBaseIndex();
      schedulePersist('friend_remark', { userId: authUser.id, friendId: rel.friendId });
      broadcastToUser(authUser.id, 'friends_updated', {});
      broadcastToUser(authUser.id, 'conversation_updated', {});
      return sendJson(res, 200, { ok: true });
    }

    if (matchRoute(pathname, '/api/groups/create') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      const groupName = normalizeSingleGroupName(body.name);
      if (!groupName) return sendJson(res, 400, { error: 'invalid_group_name' });
      if (groupName === DEFAULT_GROUP) return sendJson(res, 400, { error: 'reserved_group' });
      const nextGroups = normalizeUserCustomGroups([...(authUser.customGroups || []), groupName]);
      if (nextGroups.length === authUser.customGroups.length) return sendJson(res, 400, { error: 'group_exists' });
      authUser.customGroups = nextGroups;
      rebuildFriendViewsIndex();
      rebuildConversationBaseIndex();
      schedulePersist('group_create', { userId: authUser.id, groupName });
      broadcastToUser(authUser.id, 'friends_updated', {});
      return sendJson(res, 200, { groups: authUser.customGroups });
    }

    if (matchRoute(pathname, '/api/groups/rename') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      const groupName = normalizeSingleGroupName(body.groupName);
      const newName = normalizeSingleGroupName(body.newName);
      if (!groupName || groupName === DEFAULT_GROUP) return sendJson(res, 400, { error: 'cannot_rename_default_group' });
      if (!newName || newName === DEFAULT_GROUP) return sendJson(res, 400, { error: 'invalid_group_name' });
      if (!authUser.customGroups.includes(groupName)) return sendJson(res, 404, { error: 'not_found' });
      if (authUser.customGroups.includes(newName) && newName !== groupName) return sendJson(res, 400, { error: 'group_exists' });
      authUser.customGroups = normalizeUserCustomGroups((authUser.customGroups || []).map((name) => name === groupName ? newName : name));
      for (const rel of index.friendshipsByUser.get(authUser.id) || []) {
        if (rel.group === groupName) rel.group = newName;
      }
      rebuildFriendViewsIndex();
      rebuildConversationBaseIndex();
      schedulePersist('group_rename', { userId: authUser.id, groupName, newName });
      broadcastToUser(authUser.id, 'friends_updated', {});
      return sendJson(res, 200, { groups: authUser.customGroups });
    }

    if (matchRoute(pathname, '/api/groups/reorder') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      const groupName = normalizeSingleGroupName(body.groupName);
      const offset = Number(body.offset || 0);
      if (!groupName || groupName === DEFAULT_GROUP) return sendJson(res, 400, { error: 'cannot_move_default_group' });
      const groups = normalizeUserCustomGroups(authUser.customGroups);
      const fromIndex = groups.indexOf(groupName);
      if (fromIndex < 0) return sendJson(res, 404, { error: 'not_found' });
      const toIndex = Math.max(1, Math.min(groups.length - 1, fromIndex + (offset < 0 ? -1 : 1)));
      if (toIndex === fromIndex) return sendJson(res, 200, { groups });
      const next = groups.slice();
      const [picked] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, picked);
      authUser.customGroups = normalizeUserCustomGroups(next);
      schedulePersist('group_reorder', { userId: authUser.id, groupName, toIndex });
      broadcastToUser(authUser.id, 'friends_updated', {});
      return sendJson(res, 200, { groups: authUser.customGroups });
    }

    if (matchRoute(pathname, '/api/groups/delete') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      const groupName = normalizeSingleGroupName(body.groupName);
      if (!groupName || groupName === DEFAULT_GROUP) return sendJson(res, 400, { error: 'cannot_delete_default_group' });
      if (!authUser.customGroups.includes(groupName)) return sendJson(res, 404, { error: 'not_found' });
      authUser.customGroups = normalizeUserCustomGroups((authUser.customGroups || []).filter((name) => name !== groupName));
      for (const rel of index.friendshipsByUser.get(authUser.id) || []) {
        if (rel.group === groupName) rel.group = DEFAULT_GROUP;
      }
      rebuildFriendViewsIndex();
      rebuildConversationBaseIndex();
      schedulePersist('group_delete', { userId: authUser.id, groupName });
      broadcastToUser(authUser.id, 'friends_updated', {});
      return sendJson(res, 200, { groups: authUser.customGroups });
    }

    if (matchRoute(pathname, '/api/friends/group') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      const rel = index.friendshipByPair.get(`${authUser.id}:${body.friendId}`);
      if (!rel) return sendJson(res, 404, { error: 'not_found' });
      const nextGroup = normalizeSingleGroupName(body.group) || DEFAULT_GROUP;
      if (!authUser.customGroups.includes(nextGroup)) return sendJson(res, 400, { error: 'invalid_group' });
      rel.group = nextGroup;
      rebuildFriendViewsIndex();
      rebuildConversationBaseIndex();
      schedulePersist('friend_group', { userId: authUser.id, friendId: rel.friendId });
      broadcastToUser(authUser.id, 'friends_updated', {});
      return sendJson(res, 200, { ok: true });
    }

    if (matchRoute(pathname, '/api/friends/delete') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'userId');
      const friendId = body.friendId;
      if (!index.usersById.has(friendId)) return sendJson(res, 404, { error: 'not_found' });
      removeFriendshipPair(authUser.id, friendId);
      rebuildIndexes();
      const conv = getDirectConversation(authUser.id, friendId);
      if (conv) conv.clearedAt[authUser.id] = Date.now();
      schedulePersist('friend_delete', { userId: authUser.id, friendId });
      broadcastToUser(authUser.id, 'friends_updated', {});
      broadcastToUser(friendId, 'friends_updated', {});
      broadcastToUser(authUser.id, 'conversation_updated', {});
      return sendJson(res, 200, { ok: true });
    }

    if (matchRoute(pathname, '/api/friends') && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const friends = index.friendViewsByUser.get(authUser.id) || [];
      return sendJson(res, 200, { friends });
    }

    if (matchRoute(pathname, '/api/conversations') && req.method === 'GET') {
      const authUser = requireAuth(req, res, searchParams);
      if (!authUser) return;
      const conversations = (index.directConvBasesByUser.get(authUser.id) || []).map((base) => {
        const conv = index.convById.get(base.id);
        const peerId = (conv?.members || []).find((id) => id !== authUser.id);
        return {
          ...base,
          ...buildConversationMeta(conv, authUser.id),
          pinned: Boolean(conv?.pinnedBy?.includes(authUser.id)),
          muted: Boolean(conv?.mutedBy?.includes(authUser.id)),
          clearedAt: conv?.clearedAt?.[authUser.id] || 0,
          peerLastReadAt: peerId ? (conv?.lastRead?.[peerId] || 0) : 0,
        };
      }).sort((a, b) => {
        if (Number(b.pinned) !== Number(a.pinned)) return Number(b.pinned) - Number(a.pinned);
        return (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0);
      });
      return sendJson(res, 200, { conversations });
    }

    if (matchRoute(pathname, '/api/conversations') && req.method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = await parseBody(req);
      ensureActingUser(body, authUser, 'creatorId');
      const peerId = (body.memberIds || [])[0];
      if (!peerId || !index.usersById.has(peerId) || peerId === authUser.id) return sendJson(res, 400, { error: 'invalid_member' });
      const existed = getDirectConversation(authUser.id, peerId);
      if (existed) return sendJson(res, 200, { conversation: existed });
      const conv = { id: uid('c'), type: 'direct', name: '', ownerId: authUser.id, members: [authUser.id, peerId], announcement: '', mutedBy: [], pinnedBy: [], lastRead: {}, clearedAt: {}, createdAt: Date.now(), lastMessageAt: Date.now() };
      db.conversations.push(conv);
      rebuildIndexes();
      schedulePersist('conversation_create', { conversationId: conv.id });
      broadcastToUser(authUser.id, 'conversation_updated', {});
      broadcastToUser(peerId, 'conversation_updated', {});
      return sendJson(res, 201, { conversation: conv });
    }

    const convMsgMatch = pathname.match(/(?:\/api)?\/conversations\/([^/]+)\/messages$/);
    if (convMsgMatch) {
      const conversationId = convMsgMatch[1];
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });

      if (req.method === 'GET') {
        const authUser = requireAuth(req, res, searchParams);
        if (!authUser) return;
        if (!conv.members.includes(authUser.id)) return sendJson(res, 403, { error: 'forbidden' });
        const before = parseInt(searchParams.get('before') || '0', 10);
        const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100);
        const result = getVisibleMessagesSlice(conv, authUser.id, before, limit);
        const peerId = (conv.members || []).find((id) => id !== authUser.id);
        return sendJson(res, 200, { ...result, peerLastReadAt: peerId ? (conv.lastRead?.[peerId] || 0) : 0 });
      }

      if (req.method === 'POST') {
        const authUser = requireAuth(req, res);
        if (!authUser) return;
        const body = await parseBody(req);
        ensureActingUser(body, authUser, 'senderId');
        if (!conv.members.includes(authUser.id)) return sendJson(res, 403, { error: 'forbidden' });
        if (conv.type === 'direct') {
          const peerId = conv.members.find((id) => id !== authUser.id);
          const peerUser = index.usersById.get(peerId);
          if (authUser.blacklist.includes(peerId)) return sendJson(res, 403, { error: '你已将对方拉黑，请先解除。' });
          if (peerUser?.blacklist?.includes(authUser.id)) return sendJson(res, 403, { error: '消息被对方拒收' });
          if (body.type !== 'card' && body.type !== 'system' && !areFriends(peerId, authUser.id)) {
            return sendJson(res, 403, { error: '对方开启了验证，你还不是他(她)的好友。' });
          }
        }
        if (body.clientMessageId) {
          const found = index.messageByClientKey.get(`${conversationId}:${authUser.id}:${body.clientMessageId}`);
          if (found) return sendJson(res, 200, { message: found, deduplicated: true });
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
          clientMessageId: body.clientMessageId || null,
          deletedBy: [],
          createdAt: now,
        };
        db.messages.push(msg);
        addToMapArray(index.messagesByConv, conversationId, msg);
        if (msg.clientMessageId) index.messageByClientKey.set(`${conversationId}:${authUser.id}:${msg.clientMessageId}`, msg);
        conv.lastMessageAt = now;
        schedulePersist('message_create', { conversationId, messageId: msg.id });
        broadcastToConversation(conversationId, 'message_created', { conversationId, message: msg });
        broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
        return sendJson(res, 201, { message: msg, deduplicated: false });
      }
    }

    const convMsgActionMatch = pathname.match(/(?:\/api)?\/conversations\/([^/]+)\/messages\/([^/]+)\/(delete|recall)$/);
    if (convMsgActionMatch && req.method === 'POST') {
      const [_, conversationId, messageId, action] = convMsgActionMatch;
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      if (!conv.members.includes(authUser.id)) return sendJson(res, 403, { error: 'forbidden' });
      const msg = (index.messagesByConv.get(conversationId) || []).find((m) => m.id === messageId);
      if (!msg) return sendJson(res, 404, { error: 'not_found' });
      if (action === 'delete') {
        if (!msg.deletedBy.includes(authUser.id)) msg.deletedBy.push(authUser.id);
        schedulePersist('message_delete', { conversationId, messageId, userId: authUser.id });
        broadcastToUser(authUser.id, 'conversation_updated', { conversationId });
        return sendJson(res, 200, { ok: true });
      }
      if (msg.senderId !== authUser.id || Date.now() - msg.createdAt > 120000) return sendJson(res, 403, { error: '超时或无权限' });
      msg.type = 'system';
      msg.text = '你撤回了一条消息';
      msg.imageUrl = null;
      msg.audioUrl = null;
      msg.card = null;
      schedulePersist('message_recall', { conversationId, messageId });
      broadcastToConversation(conversationId, 'message_recalled', { conversationId, messageId: msg.id, message: msg });
      broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
      return sendJson(res, 200, { ok: true });
    }

    const convActionMatch = pathname.match(/(?:\/api)?\/conversations\/([^/]+)\/(delete|recall|read|signal|call|mute|pin|clear)$/);
    if (convActionMatch && req.method === 'POST') {
      const conversationId = convActionMatch[1];
      const action = convActionMatch[2];
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      if (!conv.members.includes(authUser.id)) return sendJson(res, 403, { error: 'forbidden' });
      const body = await parseBody(req);

      if (action === 'delete' || action === 'recall') {
        const msg = (index.messagesByConv.get(conversationId) || []).find((m) => m.id === body.msgId);
        if (!msg) return sendJson(res, 404, { error: 'not_found' });
        if (action === 'delete') {
          if (!msg.deletedBy.includes(authUser.id)) msg.deletedBy.push(authUser.id);
          schedulePersist('message_delete_legacy', { conversationId, messageId: msg.id, userId: authUser.id });
          broadcastToUser(authUser.id, 'conversation_updated', { conversationId });
          return sendJson(res, 200, { ok: true });
        }
        if (msg.senderId !== authUser.id || Date.now() - msg.createdAt > 120000) return sendJson(res, 403, { error: '超时或无权限' });
        msg.type = 'system';
        msg.text = '你撤回了一条消息';
        msg.imageUrl = null;
        msg.audioUrl = null;
        msg.card = null;
        schedulePersist('message_recall_legacy', { conversationId, messageId: msg.id });
        broadcastToConversation(conversationId, 'message_recalled', { conversationId, messageId: msg.id, message: msg });
        broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
        return sendJson(res, 200, { ok: true });
      }

      if (action === 'read') {
        conv.lastRead[authUser.id] = Date.now();
        schedulePersist('conversation_read', { conversationId, userId: authUser.id });
        broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
        return sendJson(res, 200, { ok: true });
      }

      if (action === 'mute') {
        if (conv.mutedBy.includes(authUser.id)) conv.mutedBy = conv.mutedBy.filter((id) => id !== authUser.id);
        else conv.mutedBy.push(authUser.id);
        schedulePersist('conversation_mute', { conversationId, userId: authUser.id });
        broadcastToUser(authUser.id, 'conversation_updated', { conversationId });
        return sendJson(res, 200, { ok: true, muted: conv.mutedBy.includes(authUser.id) });
      }

      if (action === 'pin') {
        if (conv.pinnedBy.includes(authUser.id)) conv.pinnedBy = conv.pinnedBy.filter((id) => id !== authUser.id);
        else conv.pinnedBy.push(authUser.id);
        schedulePersist('conversation_pin', { conversationId, userId: authUser.id });
        broadcastToUser(authUser.id, 'conversation_updated', { conversationId });
        return sendJson(res, 200, { ok: true, pinned: conv.pinnedBy.includes(authUser.id) });
      }

      if (action === 'clear') {
        conv.clearedAt[authUser.id] = Date.now();
        conv.lastRead[authUser.id] = conv.clearedAt[authUser.id];
        schedulePersist('conversation_clear', { conversationId, userId: authUser.id });
        broadcastToUser(authUser.id, 'conversation_updated', { conversationId });
        return sendJson(res, 200, { ok: true, clearedAt: conv.clearedAt[authUser.id] });
      }

      if (action === 'signal') {
        const targetUserId = body.targetUserId;
        if (!body.callId) return sendJson(res, 400, { error: 'call_id_required' });
        if (!conv.members.includes(targetUserId)) return sendJson(res, 403, { error: 'forbidden' });
        broadcastToUser(targetUserId, 'webrtc_signal', { conversationId, senderId: authUser.id, senderName: body.senderName || authUser.displayName, targetUserId, signal: body.signal, mode: body.mode, rejectReason: body.rejectReason, callId: body.callId });
        return sendJson(res, 200, { ok: true });
      }

      if (action === 'call') {
        const targetUserId = body.targetUserId;
        if (!body.callId) return sendJson(res, 400, { error: 'call_id_required' });
        if (!conv.members.includes(targetUserId)) return sendJson(res, 403, { error: 'forbidden' });
        const text = buildCallHistoryText(body);
        if (text) {
          const msg = { id: uid('m'), conversationId, senderId: authUser.id, type: 'system', text, deletedBy: [], createdAt: Date.now() };
          db.messages.push(msg);
          addToMapArray(index.messagesByConv, conversationId, msg);
          if (msg.clientMessageId) index.messageByClientKey.set(`${conversationId}:${authUser.id}:${msg.clientMessageId}`, msg);
          conv.lastMessageAt = msg.createdAt;
          broadcastToConversation(conversationId, 'message_created', { conversationId, message: msg });
          broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
        }
        schedulePersist('call_event', { conversationId, event: body.event, userId: authUser.id, callId: body.callId });
        broadcastToUser(targetUserId, 'call_event', { conversationId, senderId: authUser.id, senderName: body.senderName || authUser.displayName, targetUserId, event: body.event, mode: body.mode, reason: body.reason, callId: body.callId, durationSec: Math.max(0, Number(body.durationSec) || 0) });
        return sendJson(res, 200, { ok: true });
      }
    }

    if (!pathname.startsWith('/api/')) {
      const filePath = safeStaticPath(pathname);
      if (!filePath) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) return res.writeHead(404).end();
        const ext = path.extname(filePath);
        const contentType = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.json': 'application/json; charset=utf-8',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.webm': 'audio/webm',
          '.ogg': 'audio/ogg',
          '.m4a': 'audio/mp4',
          '.mp4': 'video/mp4',
        }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
      return;
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    const status = error.statusCode || 500;
    const message = status >= 500 ? 'server_error' : (error.message || 'request_error');
    return sendJson(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  if (!fs.existsSync(MSG_WAL_FILE)) clearWal();
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
