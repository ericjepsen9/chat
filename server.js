const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { promisify } = require('util');
const { isAdmin, normalizeUserRole, canAccessConversation } = require('./server_roles');
const { parseAuthToken, requireAuth, requireAdmin } = require('./server_auth');
const { createFriendRequest, acceptFriendRequest, rejectFriendRequest } = require('./friend_request_service');
const { queryOrders } = require('./order_query_service');
const { createOrder, updateOrderPrice, updateOrderStatus, requestOrderPriceChange, confirmOrderPriceChange } = require('./order_mutation_service');
const { buildAdminDashboardData } = require('./admin_dashboard_service');
const { createPersistence } = require('./server_persistence');
const { updateBlacklist } = require('./blacklist_service');
const { createGroup, renameGroup, reorderGroup, deleteGroup } = require('./group_service');
const { updateFriendRemark, updateFriendGroup, deleteFriendRelation } = require('./friend_relation_service');
const { createDirectConversation } = require('./conversation_service');
const { createProduct, deleteProduct, updateProduct } = require('./product_service');
const { updateUserProfile, buildUserProfileView } = require('./user_profile_service');
const { buildUserStoreItems, queryMallItems } = require('./catalog_service');
const { createBroadcastMessage } = require('./broadcast_service');
const { listFriendRequests, listFriends, listConversations } = require('./social_query_service');
const { deleteConversationMessage, recallConversationMessage, applyConversationAction } = require('./conversation_action_service');
const { listConversationMessages, createConversationMessage } = require('./conversation_message_service');

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

const scryptAsync = promisify(crypto.scrypt);

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

async function hashPasswordAsync(password, salt = makeSalt()) {
  const hash = (await scryptAsync(String(password), salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPasswordAsync(password, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (!stored.includes(':')) return String(password) === stored;
  const [salt, hash] = stored.split(':');
  const actual = (await scryptAsync(String(password), salt, 64)).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(actual, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const phoneCodeStore = new Map();
const phoneCodeCooldownStore = new Map();
const phoneCodeIpCooldownStore = new Map();
const phoneCodeVerifyAttempts = new Map();
const phoneCodeVerifyIpAttempts = new Map();
const PHONE_CODE_COOLDOWN_MS = 60 * 1000;
const PHONE_CODE_IP_COOLDOWN_MS = 3 * 1000;
const PHONE_CODE_MAX_VERIFY_ATTEMPTS = 6;
const PHONE_CODE_VERIFY_BLOCK_MS = 10 * 60 * 1000;
const EXPOSE_MOCK_PHONE_CODE = process.env.EXPOSE_MOCK_PHONE_CODE === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

function normalizePhone(phone) {
  const raw = String(phone || '').trim();
  const normalized = raw.replace(/\s+/g, '');
  if (!/^1\d{10}$/.test(normalized)) return '';
  return normalized;
}

function findUserByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return db.users.find((u) => String(u.phone || '') === normalized) || null;
}

function cleanupExpiredPhoneCodeState() {
  const now = Date.now();
  for (const [key, record] of phoneCodeStore.entries()) {
    if (!record || record.expiresAt < now) phoneCodeStore.delete(key);
  }
  for (const [key, cooldownUntil] of phoneCodeCooldownStore.entries()) {
    if (!cooldownUntil || cooldownUntil < now) phoneCodeCooldownStore.delete(key);
  }
  for (const [key, cooldownUntil] of phoneCodeIpCooldownStore.entries()) {
    if (!cooldownUntil || cooldownUntil < now) phoneCodeIpCooldownStore.delete(key);
  }
  for (const [key, state] of phoneCodeVerifyAttempts.entries()) {
    const expiredBlock = !state?.blockedUntil || Number(state.blockedUntil) < now;
    const staleWindow = !state?.windowStart || now - Number(state.windowStart) > 60 * 60 * 1000;
    if (expiredBlock && staleWindow) phoneCodeVerifyAttempts.delete(key);
  }
  for (const [ip, state] of phoneCodeVerifyIpAttempts.entries()) {
    const expiredBlock = !state?.blockedUntil || Number(state.blockedUntil) < now;
    const staleWindow = !state?.windowStart || now - Number(state.windowStart) > 60 * 60 * 1000;
    if (expiredBlock && staleWindow) phoneCodeVerifyIpAttempts.delete(ip);
  }
}

function issuePhoneCode(phone, scene = 'login') {
  cleanupExpiredPhoneCodeState();
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: '手机号格式错误' };
  const key = `${scene}:${normalized}`;
  const now = Date.now();
  const cooldownUntil = phoneCodeCooldownStore.get(key) || 0;
  if (cooldownUntil > now) {
    return { ok: false, error: '请求过于频繁，请稍后再试', retryAfterSec: Math.ceil((cooldownUntil - now) / 1000) };
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  phoneCodeStore.set(key, { code, expiresAt: now + 5 * 60 * 1000 });
  phoneCodeCooldownStore.set(key, now + PHONE_CODE_COOLDOWN_MS);
  phoneCodeVerifyAttempts.delete(key);
  return { ok: true, code, expiresInSec: 300 };
}

function ensureUserActiveForAuth(user) {
  return String(user?.status || 'active') === 'active';
}

function consumePhoneCode(phone, code, scene = 'login') {
  cleanupExpiredPhoneCodeState();
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: '验证码错误或已过期' };
  const key = `${scene}:${normalized}`;
  const now = Date.now();
  const attemptState = phoneCodeVerifyAttempts.get(key) || { count: 0, windowStart: now, blockedUntil: 0 };
  if (attemptState.blockedUntil && attemptState.blockedUntil > now) {
    return { ok: false, error: '验证码尝试过多，请稍后再试', retryAfterSec: Math.ceil((attemptState.blockedUntil - now) / 1000) };
  }
  if (now - Number(attemptState.windowStart || now) > 10 * 60 * 1000) {
    attemptState.count = 0;
    attemptState.windowStart = now;
    attemptState.blockedUntil = 0;
  }
  const record = phoneCodeStore.get(key);
  if (!record || record.expiresAt < now) {
    phoneCodeStore.delete(key);
    return { ok: false, error: '验证码错误或已过期' };
  }
  if (String(record.code) !== String(code || '').trim()) {
    const nextCount = Number(attemptState.count || 0) + 1;
    const next = { ...attemptState, count: nextCount, windowStart: attemptState.windowStart || now };
    if (nextCount >= PHONE_CODE_MAX_VERIFY_ATTEMPTS) {
      next.blockedUntil = now + PHONE_CODE_VERIFY_BLOCK_MS;
      phoneCodeStore.delete(key);
    }
    phoneCodeVerifyAttempts.set(key, next);
    return { ok: false, error: '验证码错误或已过期' };
  }
  phoneCodeStore.delete(key);
  phoneCodeVerifyAttempts.delete(key);
  return { ok: true };
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
    role: normalizeUserRole(user),
    status: user.status || 'active',
    paymentCodes: user.paymentCodes || { wechat:'', alipay:'', cloudpay:'' },
    phone: user.phone || '',
  };
}

function defaultDb() {
  const alice = uid('u');
  const bob = uid('u');
  const conv = uid('c');
  const now = Date.now();
  return {
    users: [
      { id: alice, username: 'alice', password: hashPassword('1234'), displayName: 'Alice', signature: '热爱生活', avatarUrl: null, products: [], blacklist: [], customGroups: ['我的好友', '家人', '同事'], appNumberId: 'CT10001', createdAt: now, role: 'admin', status: 'active', paymentCodes: { wechat:'', alipay:'', cloudpay:'' }, phone: '13800000001' },
      { id: bob, username: 'bob', password: hashPassword('1234'), displayName: 'Bob', signature: '专注数码', avatarUrl: null, products: [], blacklist: [], customGroups: ['我的好友', '同学'], appNumberId: 'CT10002', createdAt: now, role: 'user', status: 'active', paymentCodes: { wechat:'', alipay:'', cloudpay:'' }, phone: '13800000002' },
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

let db = null;
const persistence = createPersistence({
  msgWalFile: MSG_WAL_FILE,
  dbFile: DB_FILE,
  getStore: getSqliteStore,
  getDb: () => db,
  onError: (stage, error) => {
    console.error(`[persistence] ${stage} failed`, error);
  },
});
const { appendWal, schedulePersist, schedulePersistCritical, ensureWalFile, flushNow: flushPersistenceNow, getStats: getPersistenceStats } = persistence;

function loadDb() {
  const store = getSqliteStore();
  if (store) {
    ensureWalFile();
    return store.load();
  }
  if (!fs.existsSync(DB_FILE)) {
    const db = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    ensureWalFile();
    return db;
  }
  const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  return { users: [], friendships: [], friendRequests: [], conversations: [], messages: [], orders: [], systemMessages: [], ...loaded };
}

db = loadDb();
const sessions = new Map();
const loginAttempts = new Map();
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
    user.products = user.products.map((p) => {
      const next = p && typeof p === 'object' ? p : {};
      const rawStock = Number(next.stock);
      next.stock = Number.isFinite(rawStock) ? Math.max(0, Math.floor(rawStock)) : 99;
      return next;
    });
    if (!user.paymentCodes || typeof user.paymentCodes !== 'object') user.paymentCodes = { wechat: '', alipay: '', cloudpay: '' };
    user.paymentCodes = {
      wechat: String(user.paymentCodes.wechat || '').slice(0, 512),
      alipay: String(user.paymentCodes.alipay || '').slice(0, 512),
      cloudpay: String(user.paymentCodes.cloudpay || '').slice(0, 512),
    };
    user.role = normalizeUserRole(user);
    if (!user.status) user.status = 'active';
    user.customGroups = normalizeUserCustomGroups(user.customGroups);
    user.phone = normalizePhone(user.phone || '');
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
  for (const order of db.orders || []) {
    if (!Array.isArray(order.items)) order.items = [];
    if (!order.status) order.status = 'accepted';
    if (typeof order.priceAdjustmentLocked !== 'boolean') order.priceAdjustmentLocked = false;
    if (!('pendingPrice' in order)) order.pendingPrice = null;
    if (!('pendingPriceRequestedBy' in order)) order.pendingPriceRequestedBy = null;
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

const sseClientsByUser = new Map();
const sseSessionTokens = new Map();
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
      else if (msg.type === 'order_card') preview = '[交易提醒]';
      else if (msg.type === 'broadcast_card') preview = '[系统消息]';
      else if (msg.type === 'card') {
        const cardType = String(msg.card?.cardType || '').trim();
        if (cardType === '名片') preview = '[名片]';
        else if (cardType === '收款码') preview = '[收款码]';
        else preview = '[商品卡片]';
      } else preview = msg.text || '[消息]';
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

function issueSession(userId, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, createdAt: Date.now(), expiresAt: Date.now() + ttlMs });
  return token;
}

function revokeSessionsForUser(userId) {
  if (!userId) return;
  for (const [token, session] of sessions.entries()) {
    if (session?.userId === userId) sessions.delete(token);
  }
}

function issueSseSessionToken(userId, ttlMs = 10 * 60 * 1000) {
  const token = crypto.randomBytes(24).toString('hex');
  sseSessionTokens.set(token, { userId, expiresAt: Date.now() + ttlMs });
  return token;
}

function consumeUserBySseSessionToken(token) {
  const key = String(token || '').trim();
  if (!key) return null;
  const record = sseSessionTokens.get(key);
  if (!record) return null;
  if (!record.expiresAt || record.expiresAt < Date.now()) {
    sseSessionTokens.delete(key);
    return null;
  }
  sseSessionTokens.delete(key);
  return index.usersById.get(record.userId) || null;
}



function normalizeIpForThrottle(raw) {
  const value = String(raw || '').trim().slice(0, 64);
  if (!value) return '';
  return /^[0-9a-fA-F:.]+$/.test(value) ? value : '';
}

function getClientIp(req) {
  const remoteIp = normalizeIpForThrottle(req.socket?.remoteAddress || '');
  if (!TRUST_PROXY) return remoteIp;
  const forwarded = normalizeIpForThrottle(String(req.headers['x-forwarded-for'] || '').split(',')[0]);
  return forwarded || remoteIp;
}

function getLoginAttemptState(key) {
  const now = Date.now();
  const existing = loginAttempts.get(key) || { count: 0, windowStart: now, blockedUntil: 0 };
  if (existing.blockedUntil && existing.blockedUntil > now) return existing;
  if (now - existing.windowStart > 10 * 60 * 1000) {
    const reset = { count: 0, windowStart: now, blockedUntil: 0 };
    loginAttempts.set(key, reset);
    return reset;
  }
  return existing;
}

function recordLoginAttempt(key, success) {
  const now = Date.now();
  const state = getLoginAttemptState(key);
  if (success) {
    loginAttempts.delete(key);
    return;
  }
  const next = {
    count: (state.count || 0) + 1,
    windowStart: state.windowStart || now,
    blockedUntil: state.blockedUntil || 0,
  };
  if (next.count >= 8) {
    next.blockedUntil = now + 5 * 60 * 1000;
  }
  loginAttempts.set(key, next);
}



function getPhoneCodeIpAttemptState(ip) {
  const now = Date.now();
  if (!ip) return { count: 0, windowStart: now, blockedUntil: 0 };
  const existing = phoneCodeVerifyIpAttempts.get(ip) || { count: 0, windowStart: now, blockedUntil: 0 };
  if (existing.blockedUntil && existing.blockedUntil > now) return existing;
  if (now - Number(existing.windowStart || now) > 10 * 60 * 1000) {
    const reset = { count: 0, windowStart: now, blockedUntil: 0 };
    phoneCodeVerifyIpAttempts.set(ip, reset);
    return reset;
  }
  return existing;
}

function recordPhoneCodeIpAttempt(ip, success) {
  if (!ip) return;
  const now = Date.now();
  const state = getPhoneCodeIpAttemptState(ip);
  if (success) {
    phoneCodeVerifyIpAttempts.delete(ip);
    return;
  }
  const next = {
    count: Number(state.count || 0) + 1,
    windowStart: state.windowStart || now,
    blockedUntil: state.blockedUntil || 0,
  };
  if (next.count >= 20) next.blockedUntil = now + 10 * 60 * 1000;
  phoneCodeVerifyIpAttempts.set(ip, next);
}

function cleanupAuthState() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session?.expiresAt && Number(session.expiresAt) < now) sessions.delete(token);
  }
  for (const [token, entry] of sseSessionTokens.entries()) {
    if (!entry?.expiresAt || Number(entry.expiresAt) < now) sseSessionTokens.delete(token);
  }
  for (const [key, state] of loginAttempts.entries()) {
    const expiredBlock = !state?.blockedUntil || Number(state.blockedUntil) < now;
    const staleWindow = !state?.windowStart || now - Number(state.windowStart) > 60 * 60 * 1000;
    if (expiredBlock && staleWindow) loginAttempts.delete(key);
  }
  for (const [key, record] of phoneCodeStore.entries()) {
    if (!record?.expiresAt || Number(record.expiresAt) < now) phoneCodeStore.delete(key);
  }
  for (const [key, cooldownUntil] of phoneCodeCooldownStore.entries()) {
    if (!cooldownUntil || Number(cooldownUntil) < now) phoneCodeCooldownStore.delete(key);
  }
  for (const [key, cooldownUntil] of phoneCodeIpCooldownStore.entries()) {
    if (!cooldownUntil || Number(cooldownUntil) < now) phoneCodeIpCooldownStore.delete(key);
  }
  for (const [key, state] of phoneCodeVerifyAttempts.entries()) {
    const expiredBlock = !state?.blockedUntil || Number(state.blockedUntil) < now;
    const staleWindow = !state?.windowStart || now - Number(state.windowStart) > 60 * 60 * 1000;
    if (expiredBlock && staleWindow) phoneCodeVerifyAttempts.delete(key);
  }
  for (const [ip, state] of phoneCodeVerifyIpAttempts.entries()) {
    const expiredBlock = !state?.blockedUntil || Number(state.blockedUntil) < now;
    const staleWindow = !state?.windowStart || now - Number(state.windowStart) > 60 * 60 * 1000;
    if (expiredBlock && staleWindow) phoneCodeVerifyIpAttempts.delete(ip);
  }
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







function getAuthedUser(req, res, { searchParams = null } = {}) {
  return requireAuth(req, res, searchParams, sessions, index, sendJson);
}

async function getAuthedBody(req, res, { searchParams = null } = {}) {
  const authUser = requireAuth(req, res, searchParams, sessions, index, sendJson);
  if (!authUser) return null;
  const body = await parseBody(req);
  return { authUser, body };
}

async function getAuthedActingBody(req, res, { searchParams = null, actingKeys = [] } = {}) {
  const authUser = requireAuth(req, res, searchParams, sessions, index, sendJson);
  if (!authUser) return null;
  const body = await parseBody(req);
  ensureActingUser(body, authUser, ...actingKeys);
  return { authUser, body };
}

function areFriends(userId, friendId) {
  return index.friendshipByPair.has(`${userId}:${friendId}`);
}

function getDirectConversation(userId, peerId) {
  return (index.convByUser.get(userId) || []).find((c) => c.type === 'direct' && c.members.includes(peerId));
}

function getOrCreateDirectConversation(userId, peerId) {
  const existed = getDirectConversation(userId, peerId);
  if (existed) return existed;
  const now = Date.now();
  const conv = {
    id: uid('c'),
    type: 'direct',
    name: '',
    ownerId: userId,
    members: [userId, peerId],
    announcement: '',
    mutedBy: [],
    pinnedBy: [],
    lastRead: {},
    clearedAt: {},
    createdAt: now,
    lastMessageAt: now,
  };
  db.conversations.push(conv);
  rebuildIndexes();
  return index.convById.get(conv.id) || conv;
}

function addTradeMessage(conversationId, payload = {}) {
  const msg = {
    id: uid('m'),
    conversationId,
    senderId: payload.senderId || null,
    type: payload.type || 'system',
    text: payload.text,
    imageUrl: payload.imageUrl,
    audioUrl: payload.audioUrl,
    card: payload.card,
    order: payload.order,
    broadcast: payload.broadcast,
    deletedBy: [],
    createdAt: Date.now(),
  };
  db.messages.push(msg);
  addToMapArray(index.messagesByConv, conversationId, msg);
  const conv = index.convById.get(conversationId);
  if (conv) conv.lastMessageAt = msg.createdAt;
  broadcastToConversation(conversationId, 'message_created', { conversationId, message: msg });
  broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
  return msg;
}

function touchConversation(conversationId) {
  const conv = index.convById.get(conversationId);
  if (!conv) return;
  conv.lastMessageAt = Date.now();
  broadcastToConversation(conversationId, 'conversation_updated', { conversationId });
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
      cleanupAuthState();
      return sendJson(res, 200, {
        ok: true,
        uptimeMs: Date.now() - serverStartedAt,
        walExists: fs.existsSync(MSG_WAL_FILE),
        pendingSseUsers: sseClientsByUser.size,
        activeSessions: sessions.size,
        persistence: getPersistenceStats(),
      });
    }

    if (matchRoute(pathname, '/api/login') && req.method === 'POST') {
      const body = await parseBody(req);
      const username = String(body.username || body.phone || '').trim();
      const loginPhone = normalizePhone(body.phone || username);
      const user = index.usersByName.get(username) || (loginPhone ? findUserByPhone(loginPhone) : null);
      const attemptKey = `${username || loginPhone}:${getClientIp(req)}`;
      const attemptState = getLoginAttemptState(attemptKey);
      if (attemptState.blockedUntil && attemptState.blockedUntil > Date.now()) {
        return sendJson(res, 429, { error: '登录尝试过多，请稍后再试' });
      }
      if (!user || !(await verifyPasswordAsync(body.password, user.password))) {
        recordLoginAttempt(attemptKey, false);
        return sendJson(res, 401, { error: '账号或密码错误' });
      }
      if (!ensureUserActiveForAuth(user)) {
        return sendJson(res, 403, { error: 'account_disabled' });
      }
      recordLoginAttempt(attemptKey, true);
      if (!user.password.includes(':')) {
        user.password = await hashPasswordAsync(body.password);
        await schedulePersistCritical('migrate_password', { userId: user.id });
      }
      const token = issueSession(user.id);
      return sendJson(res, 200, { token, user: sanitizePublicUser(user) });
    }


    if (matchRoute(pathname, '/api/auth/send-code') && req.method === 'POST') {
      const body = await parseBody(req);
      const phone = normalizePhone(body.phone || '');
      const scene = String(body.scene || 'login');
      if (!phone) return sendJson(res, 400, { error: '手机号格式错误' });
      if (!['login','reset'].includes(scene)) return sendJson(res, 400, { error: '验证码场景不支持' });
      const clientIp = getClientIp(req);
      if (clientIp) {
        const ipCooldownUntil = Number(phoneCodeIpCooldownStore.get(clientIp) || 0);
        if (ipCooldownUntil > Date.now()) {
          return sendJson(res, 429, { error: '请求过于频繁，请稍后再试', retryAfterSec: Math.ceil((ipCooldownUntil - Date.now()) / 1000) });
        }
        phoneCodeIpCooldownStore.set(clientIp, Date.now() + PHONE_CODE_IP_COOLDOWN_MS);
      }
      const issueResult = issuePhoneCode(phone, scene);
      if (!issueResult.ok) {
        return sendJson(res, 429, { error: issueResult.error || '发送验证码失败', retryAfterSec: issueResult.retryAfterSec || 0 });
      }
      return sendJson(res, 200, EXPOSE_MOCK_PHONE_CODE ? { ok: true, mockCode: issueResult.code, expiresInSec: issueResult.expiresInSec } : { ok: true, expiresInSec: issueResult.expiresInSec });
    }

    if (matchRoute(pathname, '/api/login/phone-code') && req.method === 'POST') {
      const body = await parseBody(req);
      const phone = normalizePhone(body.phone || '');
      const code = String(body.code || '').trim();
      const clientIp = getClientIp(req);
      const ipAttempt = getPhoneCodeIpAttemptState(clientIp);
      if (ipAttempt.blockedUntil && ipAttempt.blockedUntil > Date.now()) {
        return sendJson(res, 429, { error: '验证码尝试过多，请稍后再试', retryAfterSec: Math.ceil((ipAttempt.blockedUntil - Date.now()) / 1000) });
      }
      if (!phone) return sendJson(res, 400, { error: '手机号格式错误' });
      if (!/^\d{4}$/.test(code)) return sendJson(res, 400, { error: '请输入4位验证码' });
      const user = findUserByPhone(phone);
      if (!user) return sendJson(res, 400, { error: '验证码错误或已过期' });
      if (!ensureUserActiveForAuth(user)) return sendJson(res, 403, { error: 'account_disabled' });
      const codeResult = consumePhoneCode(phone, code, 'login');
      if (!codeResult.ok) {
        recordPhoneCodeIpAttempt(clientIp, false);
        const statusCode = codeResult.retryAfterSec ? 429 : 400;
        return sendJson(res, statusCode, { error: codeResult.error || '验证码错误或已过期', retryAfterSec: codeResult.retryAfterSec || 0 });
      }
      recordPhoneCodeIpAttempt(clientIp, true);
      const token = issueSession(user.id);
      return sendJson(res, 200, { token, user: sanitizePublicUser(user) });
    }

    if (matchRoute(pathname, '/api/password/forgot') && req.method === 'POST') {
      const body = await parseBody(req);
      const phone = normalizePhone(body.phone || '');
      const code = String(body.code || '').trim();
      const nextPassword = String(body.newPassword || '');
      const clientIp = getClientIp(req);
      const ipAttempt = getPhoneCodeIpAttemptState(clientIp);
      if (ipAttempt.blockedUntil && ipAttempt.blockedUntil > Date.now()) {
        return sendJson(res, 429, { error: '验证码尝试过多，请稍后再试', retryAfterSec: Math.ceil((ipAttempt.blockedUntil - Date.now()) / 1000) });
      }
      if (!phone) return sendJson(res, 400, { error: '手机号格式错误' });
      if (!nextPassword) return sendJson(res, 400, { error: '参数不完整' });
      if (!/^\d{4}$/.test(code)) return sendJson(res, 400, { error: '请输入4位验证码' });
      if (nextPassword.length < 4) return sendJson(res, 400, { error: '新密码至少4位' });
      const user = findUserByPhone(phone);
      if (!user) return sendJson(res, 400, { error: '验证码错误或已过期' });
      const codeResult = consumePhoneCode(phone, code, 'reset');
      if (!codeResult.ok) {
        recordPhoneCodeIpAttempt(clientIp, false);
        const statusCode = codeResult.retryAfterSec ? 429 : 400;
        return sendJson(res, statusCode, { error: codeResult.error || '验证码错误或已过期', retryAfterSec: codeResult.retryAfterSec || 0 });
      }
      recordPhoneCodeIpAttempt(clientIp, true);
      if (await verifyPasswordAsync(nextPassword, user.password)) {
        return sendJson(res, 400, { error: '新密码不能与旧密码相同' });
      }
      user.password = await hashPasswordAsync(nextPassword);
      revokeSessionsForUser(user.id);
      await schedulePersistCritical('password_forgot_reset', { userId: user.id });
      return sendJson(res, 200, { ok: true });
    }

    if (matchRoute(pathname, '/api/password/change') && req.method === 'POST') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const body = await parseBody(req);
      if (!(await verifyPasswordAsync(body.oldPassword, authUser.password))) {
        return sendJson(res, 400, { error: '旧密码错误' });
      }
      const nextPassword = String(body.newPassword || '');
      if (String(body.oldPassword || '') === nextPassword) {
        return sendJson(res, 400, { error: '新密码不能与旧密码相同' });
      }
      if (nextPassword.length < 4) return sendJson(res, 400, { error: '新密码至少4位' });
      authUser.password = await hashPasswordAsync(nextPassword);
      revokeSessionsForUser(authUser.id);
      const token = issueSession(authUser.id);
      await schedulePersistCritical('password_change', { userId: authUser.id });
      return sendJson(res, 200, { ok: true, token });
    }


    if (matchRoute(pathname, '/api/logout') && req.method === 'POST') {
      const authUser = getAuthedUser(req, res);
      if (!authUser) return;
      const token = parseAuthToken(req, searchParams);
      if (token) sessions.delete(token);
      return sendJson(res, 200, { ok: true });
    }

    if (matchRoute(pathname, '/api/register') && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.displayName || !body.username || !body.password) return sendJson(res, 400, { error: '请填写完整信息' });
      const displayName = String(body.displayName).trim();
      const username = String(body.username).trim();
      if (!displayName) return sendJson(res, 400, { error: '昵称不能为空' });
      if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
        return sendJson(res, 400, { error: '登录账号需为3-32位英文、数字或下划线' });
      }
      if (String(body.password || '').length < 4) {
        return sendJson(res, 400, { error: '密码至少4位' });
      }
      const phone = normalizePhone(body.phone || '');
      if (!phone) return sendJson(res, 400, { error: '请填写有效手机号' });
      if (index.usersByName.has(username)) return sendJson(res, 409, { error: '该登录账号已被注册，请更换账号' });
      if (phone && findUserByPhone(phone)) return sendJson(res, 409, { error: '该手机号已被注册' });
      const user = {
        id: uid('u'),
        username,
        password: await hashPasswordAsync(body.password),
        displayName,
        signature: '暂未填写签名',
        avatarUrl: null,
        products: [],
        blacklist: [],
        customGroups: ['我的好友'],
        appNumberId: `CT${Math.floor(Math.random() * 900000 + 100000)}`,
        createdAt: Date.now(),
        role: 'user',
        status: 'active',
        paymentCodes: { wechat:'', alipay:'', cloudpay:'' },
        phone,
      };
      db.users.push(user);
      rebuildIndexes();
      await schedulePersistCritical('register', { userId: user.id });
      const token = issueSession(user.id);
      broadcastAll('users_updated', { userId: user.id });
      return sendJson(res, 201, { token, user: sanitizePublicUser(user) });
    }


    if (matchRoute(pathname, '/api/upload') && req.method === 'POST') {
      const authUser = getAuthedUser(req, res, { searchParams });
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

    if (matchRoute(pathname, '/api/events/token') && req.method === 'POST') {
      const authUser = getAuthedUser(req, res);
      if (!authUser) return;
      const sseToken = issueSseSessionToken(authUser.id);
      return sendJson(res, 200, { sseToken, expiresInMs: 10 * 60 * 1000 });
    }

    if (matchRoute(pathname, '/api/events') && req.method === 'GET') {
      const sseToken = searchParams.get('sse') || '';
      if (!sseToken) return sendJson(res, 401, { error: 'sse_token_required' });
      const authUser = consumeUserBySseSessionToken(sseToken);
      if (!authUser) return sendJson(res, 401, { error: 'invalid_sse_token' });
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
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const users = db.users
        .filter((u) => u.id !== authUser.id)
        .map((u) => ({ id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, appNumberId: u.appNumberId }));
      return sendJson(res, 200, { users });
    }

    if (matchRoute(pathname, '/api/users/update') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = updateUserProfile({
        authUser: context.authUser,
        body: context.body,
        normalizePhone,
        findUserByPhone,
        normalizeUserCustomGroups,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        rebuildRequestViewsIndex,
        rebuildBlacklistViewsIndex,
        rebuildMallIndex,
        schedulePersist,
        broadcastToUser,
        broadcastAll,
        sanitizePublicUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/users/change-phone') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const phone = normalizePhone(context.body.phone || '');
      const code = String(context.body.code || '').trim();
      if (!phone) return sendJson(res, 400, { error: '手机号格式错误' });
      if (!/^\d{4}$/.test(code)) return sendJson(res, 400, { error: '验证码错误' });
      const verify = consumePhoneCode(phone, code, 'reset');
      if (!verify.ok) return sendJson(res, verify.status, { error: verify.error });
      const existing = findUserByPhone(phone);
      if (existing && existing.id !== context.authUser.id) return sendJson(res, 409, { error: '该手机号已被注册' });
      const result = updateUserProfile({
        authUser: context.authUser,
        body: { phone },
        normalizePhone,
        findUserByPhone,
        normalizeUserCustomGroups,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        rebuildRequestViewsIndex,
        rebuildBlacklistViewsIndex,
        rebuildMallIndex,
        schedulePersist,
        broadcastToUser,
        broadcastAll,
        sanitizePublicUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    const profileMatch = pathname.match(/(?:\/api)?\/users\/([^/]+)\/profile$/);
    if (profileMatch && req.method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const targetId = profileMatch[1];
      const result = buildUserProfileView({
        authUser,
        targetId,
        usersById: index.usersById,
        friendshipByPair: index.friendshipByPair,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }


    const storeMatch = pathname.match(/^\/api\/users\/([^/]+)\/store$/);
    if (storeMatch && req.method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const result = buildUserStoreItems({
        usersById: index.usersById,
        sellerId: storeMatch[1],
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/orders') && req.method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const data = queryOrders({ db, authUser, searchParams, isAdmin });
      return sendJson(res, 200, data);
    }

    if (matchRoute(pathname, '/api/orders') && req.method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return;
      const result = createOrder({
        authUser: context.authUser,
        body: context.body,
        db,
        usersById: index.usersById,
        uid,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
        rebuildMallIndex,
        broadcastAll,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    const orderPriceMatch = pathname.match(/^\/api\/orders\/([^/]+)\/price$/);
    if (orderPriceMatch && req.method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return;
      const result = updateOrderPrice({
        authUser: context.authUser,
        orderId: orderPriceMatch[1],
        body: context.body,
        db,
        usersById: index.usersById,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    const orderPriceRequestMatch = pathname.match(/^\/api\/orders\/([^/]+)\/price-request$/);
    if (orderPriceRequestMatch && req.method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return;
      const result = requestOrderPriceChange({
        authUser: context.authUser,
        orderId: orderPriceRequestMatch[1],
        body: context.body,
        db,
        usersById: index.usersById,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    const orderPriceConfirmMatch = pathname.match(/^\/api\/orders\/([^/]+)\/price-confirm$/);
    if (orderPriceConfirmMatch && req.method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return;
      const result = confirmOrderPriceChange({
        authUser: context.authUser,
        orderId: orderPriceConfirmMatch[1],
        body: context.body,
        db,
        usersById: index.usersById,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    const orderStatusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (orderStatusMatch && req.method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return;
      const result = updateOrderStatus({
        authUser: context.authUser,
        orderId: orderStatusMatch[1],
        body: context.body,
        db,
        usersById: index.usersById,
        getOrCreateDirectConversation,
        addTradeMessage,
        schedulePersist,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    
    
    if (pathname === '/api/system/messages' && req.method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      return sendJson(res, 200, { items: (db.systemMessages || []).slice(0, 30) });
    }

    if (pathname === '/api/admin/system/messages' && req.method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return;
      if (!isAdmin(context.authUser)) return sendJson(res, 403, { error: 'forbidden' });
      const title = String(context.body.title || '').trim().slice(0, 80) || '系统消息';
      const summary = String(context.body.summary || '').trim().slice(0, 240) || '请查看最新通知';
      const cover = String(context.body.cover || '').trim().slice(0, 512);
      const item = { id: uid('sys'), title, summary, cover, createdAt: Date.now(), senderId: context.authUser.id };
      if (!Array.isArray(db.systemMessages)) db.systemMessages = [];
      db.systemMessages.unshift(item);
      if (db.systemMessages.length > 100) db.systemMessages.length = 100;
      broadcastAll('system_message', { message: item });
      await schedulePersistCritical('system_message_create', { id: item.id });
      return sendJson(res, 201, { item });
    }

    if (pathname === '/api/admin/dashboard' && req.method === 'GET') {
      const authUser = requireAdmin(req, res, searchParams, sessions, index, sendJson, isAdmin);
      if (!authUser) return;
      const data = buildAdminDashboardData(db);
      return sendJson(res, 200, data);
    }

    const broadcastMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/broadcast$/);
    if (broadcastMatch && req.method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return;
      const result = createBroadcastMessage({
        conversationId: broadcastMatch[1],
        authUser: context.authUser,
        body: context.body,
        index,
        canAccessConversation,
        addTradeMessage,
        touchConversation,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/products') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = createProduct({
        authUser: context.authUser,
        body: context.body,
        uid,
        rebuildMallIndex,
        schedulePersist,
        broadcastAll,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/products/delete') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = deleteProduct({
        authUser: context.authUser,
        productId: context.body.productId,
        rebuildMallIndex,
        schedulePersist,
        broadcastAll,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/products/update') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = updateProduct({
        authUser: context.authUser,
        body: context.body,
        rebuildMallIndex,
        schedulePersist,
        broadcastAll,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/mall') && req.method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const data = queryMallItems({
        mallItems: index.mallItems,
        keyword: searchParams.get('q') || '',
      });
      return sendJson(res, 200, data);
    }

    if (matchRoute(pathname, '/api/blacklist') && req.method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const blacklist = index.blacklistViewsByUser.get(authUser.id) || [];
      return sendJson(res, 200, { users: blacklist });
    }

    if (matchRoute(pathname, '/api/blacklist') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = updateBlacklist({
        authUser: context.authUser,
        targetId: context.body.targetId,
        action: context.body.action,
        index,
        rebuildBlacklistViewsIndex,
        schedulePersist,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    const handleFriendRequestCreate = (context) => {
      const result = createFriendRequest({
        reqBody: context.body,
        authUser: context.authUser,
        index,
        db,
        areFriends,
        uid,
        rebuildIndexes,
        schedulePersist,
        broadcastToUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    };

    if (matchRoute(pathname, '/api/friends/request') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      return handleFriendRequestCreate(context);
    }

    if (matchRoute(pathname, '/api/friends') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      return handleFriendRequestCreate(context);
    }

    if (matchRoute(pathname, '/api/friends/requests') && req.method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const data = listFriendRequests({
        authUser,
        requestViewsByTarget: index.requestViewsByTarget,
      });
      return sendJson(res, 200, data);
    }

    if (matchRoute(pathname, '/api/friends/accept') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = acceptFriendRequest({
        requestId: context.body.requestId,
        authUser: context.authUser,
        db,
        uid,
        getDirectConversation,
        rebuildIndexes,
        schedulePersist,
        broadcastToUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/friends/reject') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = rejectFriendRequest({
        requestId: context.body.requestId,
        authUser: context.authUser,
        db,
        rebuildIndexes,
        schedulePersist,
        broadcastToUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/friends/remark') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = updateFriendRemark({
        authUser: context.authUser,
        friendId: context.body.friendId,
        group: context.body.group,
        remark: context.body.remark,
        friendshipByPair: index.friendshipByPair,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        schedulePersist,
        broadcastToUser,
        defaultGroup: DEFAULT_GROUP,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/groups/create') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = createGroup({
        authUser: context.authUser,
        rawName: context.body.name,
        defaultGroup: DEFAULT_GROUP,
        normalizeSingleGroupName,
        normalizeUserCustomGroups,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        schedulePersist,
        broadcastToUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/groups/rename') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = renameGroup({
        authUser: context.authUser,
        groupNameRaw: context.body.groupName,
        newNameRaw: context.body.newName,
        defaultGroup: DEFAULT_GROUP,
        normalizeSingleGroupName,
        normalizeUserCustomGroups,
        friendshipsByUser: index.friendshipsByUser,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        schedulePersist,
        broadcastToUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/groups/reorder') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = reorderGroup({
        authUser: context.authUser,
        groupNameRaw: context.body.groupName,
        offsetRaw: context.body.offset,
        defaultGroup: DEFAULT_GROUP,
        normalizeSingleGroupName,
        normalizeUserCustomGroups,
        schedulePersist,
        broadcastToUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/groups/delete') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = deleteGroup({
        authUser: context.authUser,
        groupNameRaw: context.body.groupName,
        defaultGroup: DEFAULT_GROUP,
        normalizeSingleGroupName,
        normalizeUserCustomGroups,
        friendshipsByUser: index.friendshipsByUser,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        schedulePersist,
        broadcastToUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/friends/group') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = updateFriendGroup({
        authUser: context.authUser,
        friendId: context.body.friendId,
        groupRaw: context.body.group,
        friendshipByPair: index.friendshipByPair,
        normalizeSingleGroupName,
        defaultGroup: DEFAULT_GROUP,
        schedulePersist,
        rebuildFriendViewsIndex,
        rebuildConversationBaseIndex,
        broadcastToUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/friends/delete') && req.method === 'POST') {
      const context = await getAuthedActingBody(req, res, { actingKeys: ['userId'] });
      if (!context) return;
      const result = deleteFriendRelation({
        authUser: context.authUser,
        friendId: context.body.friendId,
        usersById: index.usersById,
        removeFriendshipPair,
        rebuildIndexes,
        getDirectConversation,
        schedulePersist,
        broadcastToUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    if (matchRoute(pathname, '/api/friends') && req.method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const data = listFriends({
        authUser,
        friendViewsByUser: index.friendViewsByUser,
      });
      return sendJson(res, 200, data);
    }

    if (matchRoute(pathname, '/api/conversations') && req.method === 'GET') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const data = listConversations({
        authUser,
        directConvBasesByUser: index.directConvBasesByUser,
        convById: index.convById,
        buildConversationMeta,
      });
      return sendJson(res, 200, data);
    }

    if (matchRoute(pathname, '/api/conversations') && req.method === 'POST') {
      const context = await getAuthedBody(req, res);
      if (!context) return;
      ensureActingUser(context.body, context.authUser, 'creatorId');
      const peerId = (context.body.memberIds || [])[0];
      const result = createDirectConversation({
        authUser: context.authUser,
        peerId,
        usersById: index.usersById,
        getDirectConversation,
        uid,
        db,
        rebuildIndexes,
        schedulePersist,
        broadcastToUser,
      });
      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    const convMsgMatch = pathname.match(/(?:\/api)?\/conversations\/([^/]+)\/messages$/);
    if (convMsgMatch) {
      const conversationId = convMsgMatch[1];
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });

      if (req.method === 'GET') {
        const authUser = getAuthedUser(req, res, { searchParams });
        if (!authUser) return;
        const result = listConversationMessages({
          conv,
          authUser,
          searchParams,
          getVisibleMessagesSlice,
        });
        if (!result.ok) return sendJson(res, result.status, { error: result.error });
        return sendJson(res, result.status, result.payload);
      }

      if (req.method === 'POST') {
        const context = await getAuthedBody(req, res);
        if (!context) return;
        ensureActingUser(context.body, context.authUser, 'senderId');
        const result = createConversationMessage({
          conversationId,
          conv,
          authUser: context.authUser,
          body: context.body,
          index,
          areFriends,
          uid,
          db,
          addToMapArray,
          schedulePersist,
          broadcastToConversation,
        });
        if (!result.ok) return sendJson(res, result.status, { error: result.error });
        return sendJson(res, result.status, result.payload);
      }
    }

    const convMsgActionMatch = pathname.match(/(?:\/api)?\/conversations\/([^/]+)\/messages\/([^/]+)\/(delete|recall)$/);
    if (convMsgActionMatch && req.method === 'POST') {
      const [_, conversationId, messageId, action] = convMsgActionMatch;
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const authUser = getAuthedUser(req, res);
      if (!authUser) return;
      if (!conv.members.includes(authUser.id)) return sendJson(res, 403, { error: 'forbidden' });

      const result = action === 'delete'
        ? deleteConversationMessage({
          conversationId,
          messageId,
          authUser,
          index,
          schedulePersist,
          broadcastToUser,
          persistEvent: 'message_delete',
        })
        : recallConversationMessage({
          conversationId,
          messageId,
          authUser,
          index,
          schedulePersist,
          broadcastToConversation,
          persistEvent: 'message_recall',
        });

      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
    }

    const convActionMatch = pathname.match(/(?:\/api)?\/conversations\/([^/]+)\/(delete|recall|read|signal|call|mute|pin|clear)$/);
    if (convActionMatch && req.method === 'POST') {
      const conversationId = convActionMatch[1];
      const action = convActionMatch[2];
      const conv = index.convById.get(conversationId);
      if (!conv) return sendJson(res, 404, { error: 'not_found' });
      const context = await getAuthedBody(req, res);
      if (!context) return;
      if (!conv.members.includes(context.authUser.id)) return sendJson(res, 403, { error: 'forbidden' });


      const result = applyConversationAction({
        action,
        conversationId,
        body: context.body,
        authUser: context.authUser,
        conv,
        db,
        index,
        uid,
        addToMapArray,
        schedulePersist,
        broadcastToUser,
        broadcastToConversation,
      });

      if (!result.ok) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, result.payload);
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


async function gracefulShutdown(signal) {
  if (gracefulShutdown.inProgress) return;
  gracefulShutdown.inProgress = true;
  console.log(`[shutdown] Received ${signal}, draining persistence...`);
  const hardExitTimer = setTimeout(() => {
    console.error('[shutdown] force exit after timeout');
    process.exit(1);
  }, 10_000);
  hardExitTimer.unref?.();
  try {
    cleanupAuthState();
    await flushPersistenceNow();
  } catch (err) {
    console.error('[shutdown] persistence flush failed', err);
  }
  server.close((err) => {
    clearTimeout(hardExitTimer);
    if (err) {
      console.error('[shutdown] close failed', err);
      process.exit(1);
      return;
    }
    process.exit(0);
  });
}

setInterval(cleanupAuthState, 60 * 1000).unref();

process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });

server.listen(PORT, () => {
  ensureWalFile();
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
