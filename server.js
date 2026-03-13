const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { isAdmin, normalizeUserRole, canAccessConversation } = require('./server_roles');
const {
  uid, hashPassword, verifyPassword, hashPasswordAsync, verifyPasswordAsync,
  normalizePhone, maskPhone, sanitizePublicUser, ensureUserActiveForAuth,
  issuePhoneCode, consumePhoneCode, cleanupExpiredPhoneCodeState,
  issueCsrfToken, validateCsrf, csrfTokens,
  cleanupExpiredMap, isRateLimitEntryStale,
  normalizeIpForThrottle, getClientIp,
  getRateLimitState, recordRateLimitAttempt,
  loginAttempts, getLoginAttemptState, recordLoginAttempt,
  getPhoneCodeIpAttemptState, recordPhoneCodeIpAttempt,
  cleanupAuthState,
  EXPOSE_MOCK_PHONE_CODE, TRUST_PROXY,
  phoneCodeIpCooldownStore, PHONE_CODE_IP_COOLDOWN_MS,
} = require('./server_crypto');
const createIndexManager = require('./server_index');
const { searchMessagesGlobal, searchMessagesInConversation } = require('./message_search_service');
const { parseAuthToken, requireAuth, requireAdmin } = require('./server_auth');
const { createFriendRequest, acceptFriendRequest, rejectFriendRequest } = require('./friend_request_service');
const { queryOrders } = require('./order_query_service');
const { createOrder, acceptOrder, updateOrderPrice, updateOrderStatus, requestOrderPriceChange, confirmOrderPriceChange, deleteOrder } = require('./order_mutation_service');
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
const { pushIncomingCall, pushNewMessage, pushFriendRequest, pushOrderUpdate, isUserOnline } = require('./push_service');
const createAuthRoutes = require('./server_routes_auth');
const createSocialRoutes = require('./server_routes_social');
const createChatRoutes = require('./server_routes_chat');
const createOrderRoutes = require('./server_routes_orders');
const createUserRoutes = require('./server_routes_users');
const createProductRoutes = require('./server_routes_products');
const createAdminRoutes = require('./server_routes_admin');
const createAdminExtRoutes = require('./server_routes_admin_ext');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const STATIC_ROOT = ROOT;

const CSRF_EXEMPT = new Set(['/api/login', '/api/register', '/api/auth/send-code', '/api/password/forgot', '/api/login/phone-code']);
const MIME_TYPES = {
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
};

const FILE_EXT_MAP = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'],
  ['audio/webm', '.webm'], ['audio/ogg', '.ogg'], ['audio/mp4', '.m4a'],
  ['video/mp4', '.mp4'],
]);
const DB_FILE = path.join(ROOT, 'data.json');
const USE_SQLITE = process.env.USE_SQLITE === '1';
const SQLITE_FILE = path.join(ROOT, 'data.sqlite');
const MSG_WAL_FILE = path.join(ROOT, 'message.wal');
const MESSAGE_RETENTION_DAYS = parseInt(process.env.MESSAGE_RETENTION_DAYS || '90', 10);
const BODY_LIMIT = 2 * 1024 * 1024;
const UPLOAD_LIMIT = 8 * 1024 * 1024;
const UPLOAD_ROOT = path.join(ROOT, 'uploads');
const SSE_HEARTBEAT_MS = 15 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SSE_TOKEN_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_AGE_UPLOADS = 2592000;   // 30 days
const CACHE_MAX_AGE_DEFAULT = 300;       // 5 minutes
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = MS_PER_DAY;
const CLEANUP_STARTUP_DELAY_MS = 30 * 1000;
const serverStartedAt = Date.now();

function generateUniqueAppNumberId() {
  let appNum;
  do { appNum = `CT${Math.floor(Math.random() * 900000 + 100000)}`; } while (index.usersByAppNumber && index.usersByAppNumber.has(appNum));
  return appNum;
}

function findUserByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return index.usersByPhone?.get(normalized) || null;
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
    orders: [],
    systemMessages: [],
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
  let loaded;
  try {
    loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error(`[STARTUP] Failed to parse ${DB_FILE}, backing up and starting fresh:`, e.message);
    const backupPath = `${DB_FILE}.corrupt.${Date.now()}`;
    try { fs.renameSync(DB_FILE, backupPath); } catch (_) {}
    return defaultDb();
  }
  return { users: [], friendships: [], friendRequests: [], conversations: [], messages: [], orders: [], systemMessages: [], ...loaded };
}

db = loadDb();
const sessions = new Map();
const index = {
  usersById: new Map(),
  usersByName: new Map(),
  usersByPhone: new Map(),
  usersByAppNumber: new Map(),
  convById: new Map(),
  convByUser: new Map(),
  messagesByConv: new Map(),
  messagesById: new Map(),
  friendshipsByUser: new Map(),
  friendshipByPair: new Map(),
  friendViewsByUser: new Map(),
  ordersById: new Map(),
  directConvByPair: new Map(),
  friendRequestsById: new Map(),
  directConvBasesByUser: new Map(),
  requestsByTarget: new Map(),
  requestViewsByTarget: new Map(),
  blacklistViewsByUser: new Map(),
  messageByClientKey: new Map(),
  ordersByBuyer: new Map(),
  ordersBySeller: new Map(),
  mallItems: [],
};

// Index manager — all index rebuild/management functions
const {
  addToMapArray, DEFAULT_GROUP, MAX_GROUPS, MAX_GROUP_NAME_LEN,
  normalizeUserCustomGroups, normalizeSingleGroupName,
  rebuildMallIndex, rebuildRequestViewsIndex, rebuildBlacklistViewsIndex,
  rebuildFriendViewsIndex, rebuildConversationBaseIndex,
  rebuildIndexes, indexNewUser, indexNewConversation,
  rebuildFriendshipIndexes, rebuildFriendRequestMaps,
  rebuildFriendshipAndRequestIndexes, rebuildRequestIndexesOnly,
  rebuildMessageIndexes, trimMessageIndexes,
} = createIndexManager({ db, index, normalizeUserRole, normalizePhone, generateUniqueAppNumberId });


rebuildIndexes();

const sseClientsByUser = new Map();
const sseSessionTokens = new Map();
const sseHeartbeatByRes = new WeakMap();
const MAX_SSE_PER_USER = 8;
function addSseClient(userId, res) {
  if (!sseClientsByUser.has(userId)) sseClientsByUser.set(userId, new Set());
  let conns = sseClientsByUser.get(userId);
  if (conns.size >= MAX_SSE_PER_USER) {
    const snapshot = Array.from(conns);
    for (let i = 0; i < snapshot.length; i++) {
      try { snapshot[i].end(); } catch (_) {}
      removeSseClient(userId, snapshot[i]);
      if ((sseClientsByUser.get(userId)?.size || 0) < MAX_SSE_PER_USER) break;
    }
  }
  // Re-fetch or create: removeSseClient may have deleted the Map entry
  if (!sseClientsByUser.has(userId)) sseClientsByUser.set(userId, new Set());
  conns = sseClientsByUser.get(userId);
  conns.add(res);
  const timer = setInterval(() => {
    try { if (!res.destroyed && !res.writableEnded) res.write(':ping\n\n'); } catch (_) {}
  }, SSE_HEARTBEAT_MS);
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
function sendSseRaw(res, chunk) {
  try {
    if (res.destroyed || res.writableEnded) return false;
    res.write(chunk);
    return true;
  } catch (_) { return false; }
}
function sendSse(res, event, payload) {
  return sendSseRaw(res, `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}
function broadcastToUser(userId, event, payload, _prebuilt) {
  const clients = sseClientsByUser.get(userId);
  if (!clients || clients.size === 0) {
    sendPushFallback(userId, event, payload);
    return;
  }
  // Pre-serialize once for multiple clients
  const chunk = _prebuilt || `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  // Snapshot to array to allow safe removal during iteration
  const snapshot = Array.from(clients);
  for (let i = 0; i < snapshot.length; i++) {
    if (!sendSseRaw(snapshot[i], chunk)) removeSseClient(userId, snapshot[i]);
  }
}
/**
 * Push fallback: when user has no active SSE connection, send via EMAS push.
 * Only sends push for important events (calls, messages).
 */
function sendPushFallback(userId, event, payload) {
  try {
    if (event === 'call_event' && payload.event === 'start') {
      pushIncomingCall(userId, payload.senderId, payload.senderName,
        payload.mode, payload.conversationId, payload.callId).catch(() => {});
    } else if (event === 'webrtc_signal' && payload.signal?.type === 'offer') {
      pushIncomingCall(userId, payload.senderId, payload.senderName,
        payload.mode, payload.conversationId, payload.callId).catch(() => {});
    } else if (event === 'message_created' && payload.message) {
      const msg = payload.message;
      if (msg.type === 'order_card') {
        const orderData = msg.order || {};
        const title = orderData.title || '订单更新';
        pushOrderUpdate(userId, orderData.id || '', title).catch(() => {});
      } else if (msg.type !== 'system') {
        const sender = index.usersById.get(msg.senderId);
        const senderName = sender?.displayName || '新消息';
        const content = msg.text || (msg.type === 'image' ? '[图片]' : msg.type === 'audio' ? '[语音]' : '[消息]');
        pushNewMessage(userId, senderName, content, payload.conversationId).catch(() => {});
      }
    } else if (event === 'friend_request_updated') {
      pushFriendRequest(userId, '有人').catch(() => {});
    }
  } catch (_) { /* push is best-effort */ }
}
function broadcastToConversation(conversationId, event, payload) {
  const conv = index.convById.get(conversationId);
  if (!conv) return;
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const userId of conv.members) broadcastToUser(userId, event, payload, chunk);
}
function broadcastAll(event, payload) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const userId of sseClientsByUser.keys()) broadcastToUser(userId, event, payload, chunk);
}

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendResult(res, result) {
  if (!result.ok) return sendJson(res, result.status, { error: result.error });
  return sendJson(res, result.status, result.payload);
}

function collectBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        const err = new Error('payload_too_large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
    req.on('close', () => {
      if (settled) return;
      settled = true;
      const err = new Error('client_closed');
      err.statusCode = 499;
      reject(err);
    });
  });
}

async function parseBody(req) {
  const buf = await collectBody(req, BODY_LIMIT);
  if (!buf.length) return {};
  const raw = buf.toString('utf8');
  try {
    return JSON.parse(raw);
  } catch (_) {
    const err = new Error('invalid_json');
    err.statusCode = 400;
    throw err;
  }
}

function parseRawBody(req, limit = UPLOAD_LIMIT) {
  return collectBody(req, limit);
}

function ensureUploadRoot() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

function safeUploadFileName(name) {
  const base = path.basename(String(name || '').trim()).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 80) || 'file.bin';
}

function checkFileMagicBytes(buf) {
  if (buf.length < 4) return false;
  // JPEG: FF D8 FF
  if (buf[0]===0xFF && buf[1]===0xD8 && buf[2]===0xFF) return true;
  // PNG: 89 50 4E 47
  if (buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47) return true;
  // GIF: 47 49 46 38
  if (buf[0]===0x47 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x38) return true;
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buf.length >= 12 && buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46 && buf[8]===0x57 && buf[9]===0x45 && buf[10]===0x42 && buf[11]===0x50) return true;
  // BMP: 42 4D
  if (buf[0]===0x42 && buf[1]===0x4D) return true;
  // OGG audio: 4F 67 67 53
  if (buf[0]===0x4F && buf[1]===0x67 && buf[2]===0x67 && buf[3]===0x53) return true;
  // MP3: FF FB / FF F3 / FF F2 / ID3
  if (buf[0]===0xFF && (buf[1]===0xFB || buf[1]===0xF3 || buf[1]===0xF2)) return true;
  if (buf[0]===0x49 && buf[1]===0x44 && buf[2]===0x33) return true;
  // WAV: 52 49 46 46 ... 57 41 56 45
  if (buf.length >= 12 && buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46 && buf[8]===0x57 && buf[9]===0x41 && buf[10]===0x56 && buf[11]===0x45) return true;
  // AAC: FF F1 / FF F9
  if (buf[0]===0xFF && (buf[1]===0xF1 || buf[1]===0xF9)) return true;
  // M4A/MP4: ftyp at offset 4
  if (buf.length >= 8 && buf[4]===0x66 && buf[5]===0x74 && buf[6]===0x79 && buf[7]===0x70) return true;
  // WebM (EBML header): 1A 45 DF A3
  if (buf[0]===0x1A && buf[1]===0x45 && buf[2]===0xDF && buf[3]===0xA3) return true;
  return false;
}

function fileExtFromType(contentType, originalName = '') {
  const lowered = String(contentType || '').toLowerCase();
  // Direct O(1) lookup first; fall back to includes() scan for partial matches
  const direct = FILE_EXT_MAP.get(lowered);
  if (direct) return direct;
  for (const [mime, ext] of FILE_EXT_MAP) {
    if (lowered.includes(mime)) return ext;
  }
  const ext = path.extname(originalName || '');
  return ext && ext.length <= 8 ? ext : '.bin';
}

function isMessageVisibleToUser(msg, conv, userId) {
  const clearedAt = conv.clearedAt?.[userId] || 0;
  if (msg.createdAt <= clearedAt) return false;
  const deletedBy = msg.deletedBy;
  return !deletedBy || !deletedBy.length || !deletedBy.includes(userId);
}

function getVisibleMessagesSlice(conv, userId, before = 0, limit = 30) {
  const list = index.messagesByConv.get(conv.id) || [];
  const out = new Array(limit);
  let count = 0;
  let hasMore = false;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (before > 0 && msg.createdAt >= before) continue;
    if (!isMessageVisibleToUser(msg, conv, userId)) continue;
    if (count < limit) { out[count++] = msg; }
    else { hasMore = true; break; }
  }
  // Reverse in-place without allocation: items are in out[0..count-1] in reverse order
  for (let l = 0, r = count - 1; l < r; l++, r--) { const t = out[l]; out[l] = out[r]; out[r] = t; }
  out.length = count;
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
      else if (msg.type === 'order_card') preview = '[订单]';
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
  if (route === target) return true;
  // Handle route without /api prefix
  if (target.startsWith('/api') && route === target.slice(4)) return true;
  return false;
}

function issueSession(userId, ttlMs = SESSION_TTL_MS) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, createdAt: Date.now(), expiresAt: Date.now() + ttlMs });
  return token;
}

function revokeSessionsForUser(userId) {
  if (!userId) return;
  // Collect tokens first to avoid modifying map during iteration
  const toDelete = [];
  for (const [token, session] of sessions) {
    if (session?.userId === userId) toDelete.push(token);
  }
  for (let i = 0; i < toDelete.length; i++) {
    sessions.delete(toDelete[i]);
    csrfTokens.delete(toDelete[i]);
  }
}

function issueSseSessionToken(userId, ttlMs = SSE_TOKEN_TTL_MS) {
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



// Wrap cleanupAuthState to pass server-local maps
function runCleanupAuthState() {
  cleanupAuthState({ sessions, sseSessionTokens });
}

function ensureActingUser(body, authUser, ...candidateKeys) {
  for (const key of candidateKeys) {
    if (body[key] && body[key] !== authUser.id) {
      const err = new Error('forbidden');
      err.statusCode = 403;
      throw err;
    }
    body[key] = authUser.id;
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
  return index.directConvByPair.get(`${userId}:${peerId}`) || null;
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
  indexNewConversation(conv);
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
  index.messagesById.set(msg.id, msg);
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
  const arr = db.friendships;
  // Single-pass compact: avoid multiple splice calls which shift the entire array each time
  let write = 0;
  for (let i = 0; i < arr.length; i++) {
    const f = arr[i];
    if ((f.userId === a && f.friendId === b) || (f.userId === b && f.friendId === a)) continue;
    arr[write++] = f;
  }
  arr.length = write;
  rebuildFriendshipIndexes();
}

function safeStaticPath(pathname) {
  const target = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.normalize(target).replace(/^([.][.][/\\])+/, '');
  const fullPath = path.join(STATIC_ROOT, normalized);
  const relative = path.relative(STATIC_ROOT, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return fullPath;
}

const allowOrigins = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);

// Route context shared by all extracted route modules
const routeCtx = {
  matchRoute, sendJson, sendResult, parseBody, parseRawBody,
  getAuthedUser, getAuthedBody, getAuthedActingBody, ensureActingUser,
  parseAuthToken,
  db, index, sessions,
  uid, isAdmin, canAccessConversation,
  normalizePhone, findUserByPhone, sanitizePublicUser,
  ensureUserActiveForAuth, issueCsrfToken, validateCsrf, csrfTokens,
  hashPasswordAsync, verifyPasswordAsync,
  issuePhoneCode, consumePhoneCode,
  issueSession, revokeSessionsForUser,
  getClientIp, getLoginAttemptState, recordLoginAttempt,
  getPhoneCodeIpAttemptState, recordPhoneCodeIpAttempt,
  phoneCodeIpCooldownStore, PHONE_CODE_IP_COOLDOWN_MS,
  generateUniqueAppNumberId, indexNewUser, indexNewConversation,
  schedulePersist, schedulePersistCritical, appendWal,
  broadcastToUser, broadcastToConversation, broadcastAll,
  areFriends, getDirectConversation, getOrCreateDirectConversation,
  addTradeMessage, touchConversation, removeFriendshipPair,
  addToMapArray, DEFAULT_GROUP,
  normalizeSingleGroupName, normalizeUserCustomGroups,
  rebuildIndexes, rebuildFriendViewsIndex, rebuildConversationBaseIndex,
  rebuildBlacklistViewsIndex, rebuildRequestViewsIndex, rebuildMallIndex,
  rebuildFriendshipAndRequestIndexes, rebuildRequestIndexesOnly,
  isMessageVisibleToUser, getVisibleMessagesSlice, buildConversationMeta,
  searchMessagesGlobal, searchMessagesInConversation,
  queryOrders, createOrder, acceptOrder, updateOrderPrice,
  requestOrderPriceChange, confirmOrderPriceChange, updateOrderStatus, deleteOrder,
  createFriendRequest, acceptFriendRequest, rejectFriendRequest,
  updateBlacklist, updateFriendRemark, updateFriendGroup, deleteFriendRelation,
  createGroup, renameGroup, reorderGroup, deleteGroup,
  listFriendRequests, listFriends, listConversations,
  listConversationMessages, createConversationMessage,
  deleteConversationMessage, recallConversationMessage, applyConversationAction,
  createDirectConversation,
  updateUserProfile, buildUserProfileView, buildUserStoreItems,
  createProduct, deleteProduct, updateProduct, queryMallItems,
  createBroadcastMessage, buildAdminDashboardData, requireAdmin,
  sseClientsByUser,
};
const handleAuthRoutes = createAuthRoutes(routeCtx);
const handleSocialRoutes = createSocialRoutes(routeCtx);
const handleChatRoutes = createChatRoutes(routeCtx);
const handleOrderRoutes = createOrderRoutes(routeCtx);
const handleUserRoutes = createUserRoutes(routeCtx);
const handleProductRoutes = createProductRoutes(routeCtx);
const handleAdminRoutes = createAdminRoutes(routeCtx);
const handleAdminExtRoutes = createAdminExtRoutes(routeCtx);

const server = http.createServer(async (req, res) => {
  try {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = requestUrl;
  const origin = req.headers.origin || '';
  if (!origin || allowOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || `http://127.0.0.1:${PORT}`);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With, X-File-Name, X-CSRF-Token');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // CSRF validation for state-changing requests
  if (req.method === 'POST' && pathname.startsWith('/api/') && !CSRF_EXEMPT.has(pathname)) {
    const sessionToken = parseAuthToken(req);
    if (sessionToken && !validateCsrf(req, sessionToken)) {
      return sendJson(res, 403, { error: 'csrf_token_invalid' });
    }
  }
    if (matchRoute(pathname, '/api/health') && req.method === 'GET') {
      runCleanupAuthState();
      return sendJson(res, 200, {
        ok: true,
        uptimeMs: Date.now() - serverStartedAt,
        walExists: fs.existsSync(MSG_WAL_FILE),
        pendingSseUsers: sseClientsByUser.size,
        activeSessions: sessions.size,
        persistence: getPersistenceStats(),
      });
    }

    // Auth routes (login, register, phone code, password)
    if (await handleAuthRoutes(pathname, req.method, req, res, searchParams)) return;

    if (matchRoute(pathname, '/api/upload') && req.method === 'POST') {
      const authUser = getAuthedUser(req, res, { searchParams });
      if (!authUser) return;
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      if (!(contentType.startsWith('image/') || contentType.startsWith('audio/'))) {
        return sendJson(res, 400, { error: 'unsupported_media_type' });
      }
      const raw = await parseRawBody(req, UPLOAD_LIMIT);
      if (!raw.length) return sendJson(res, 400, { error: 'empty_upload' });
      if (!checkFileMagicBytes(raw)) return sendJson(res, 400, { error: 'file_type_mismatch' });
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
      return sendJson(res, 200, { sseToken, expiresInMs: SSE_TOKEN_TTL_MS });
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
      let cleaned = false;
      const cleanup = () => { if (cleaned) return; cleaned = true; removeSseClient(authUser.id, res); };
      req.on('close', cleanup);
      res.on('close', cleanup);
      return;
    }

    // User profile & store routes
    if (await handleUserRoutes(pathname, req.method, req, res, searchParams)) return;

    // Order routes
    if (await handleOrderRoutes(pathname, req.method, req, res, searchParams)) return;

    // Admin & system message routes
    if (await handleAdminRoutes(pathname, req.method, req, res, searchParams)) return;
    if (await handleAdminExtRoutes(pathname, req.method, req, res, searchParams)) return;

    // Product, mall & broadcast routes
    if (await handleProductRoutes(pathname, req.method, req, res, searchParams)) return;

    // Friend, group & blacklist routes
    if (await handleSocialRoutes(pathname, req.method, req, res, searchParams)) return;

    // Conversation & message routes
    if (await handleChatRoutes(pathname, req.method, req, res, searchParams)) return;

    if (!pathname.startsWith('/api/')) {
      const filePath = safeStaticPath(pathname);
      if (!filePath) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) return res.writeHead(404).end();
        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const headers = { 'Content-Type': contentType, 'Content-Length': stat.size };
        // ETag based on mtime + size for conditional requests
        const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
        headers['ETag'] = etag;
        if (pathname.startsWith('/uploads/')) {
          headers['Cache-Control'] = `public, max-age=${CACHE_MAX_AGE_UPLOADS}, immutable`;
        } else if (ext === '.html') {
          headers['Cache-Control'] = 'no-cache';
        } else {
          headers['Cache-Control'] = `public, max-age=${CACHE_MAX_AGE_DEFAULT}`;
        }
        // Conditional request: return 304 if ETag matches
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etag) {
          res.writeHead(304, { 'ETag': etag });
          res.end();
          return;
        }
        res.writeHead(200, headers);
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => { if (!res.writableEnded) res.end(); });
        stream.pipe(res);
      });
      return;
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    if (res.headersSent) {
      try { if (!res.writableEnded) res.end(); } catch (_) {}
      return;
    }
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
  // Close all SSE connections so their heartbeat timers are cleared
  for (const [userId, conns] of Array.from(sseClientsByUser.entries())) {
    for (const res of Array.from(conns)) {
      try { res.end(); } catch (_) {}
      removeSseClient(userId, res);
    }
  }
  try {
    runCleanupAuthState();
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

setInterval(runCleanupAuthState, 60 * 1000).unref();

// Message retention cleanup — runs daily, removes messages older than MESSAGE_RETENTION_DAYS
function cleanupExpiredMessages() {
  const cutoff = Date.now() - MESSAGE_RETENTION_DAYS * MS_PER_DAY;
  const msgs = db.messages;
  const before = msgs.length;
  // In-place compact avoids allocating a new array for potentially large message lists
  let write = 0;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].createdAt > cutoff) msgs[write++] = msgs[i];
  }
  msgs.length = write;
  if (write < before) {
    rebuildMessageIndexes();
    schedulePersist('message_retention_cleanup', {});
    console.log(`[retention] cleaned ${before - write} messages older than ${MESSAGE_RETENTION_DAYS} days`);
  }
}
setInterval(cleanupExpiredMessages, CLEANUP_INTERVAL_MS).unref();
setTimeout(cleanupExpiredMessages, CLEANUP_STARTUP_DELAY_MS); // run once shortly after startup

// Periodically trim per-conversation message indexes to cap memory usage
setInterval(trimMessageIndexes, 10 * 60 * 1000).unref();

process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });

server.listen(PORT, () => {
  ensureWalFile();
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
