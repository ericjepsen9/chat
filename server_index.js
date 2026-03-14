module.exports = function createIndexManager({ db, index, normalizeUserRole, normalizePhone, generateUniqueAppNumberId }) {
function addToMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

const DEFAULT_GROUP = '我的好友';
const MAX_GROUPS = 20;
const MAX_GROUP_NAME_LEN = 20;
const MAX_PAYMENT_CODE_LEN = 512;
const CATEGORY_SPLIT_RE = /[\/,、]/;

function normalizePaymentCodes(codes) {
  if (!codes || typeof codes !== 'object') return { wechat: '', alipay: '', cloudpay: '' };
  return {
    wechat: String(codes.wechat || '').slice(0, MAX_PAYMENT_CODE_LEN),
    alipay: String(codes.alipay || '').slice(0, MAX_PAYMENT_CODE_LEN),
    cloudpay: String(codes.cloudpay || '').slice(0, MAX_PAYMENT_CODE_LEN),
  };
}

function normalizeUserCustomGroups(groups) {
  const ordered = [];
  const seen = new Set();
  const source = Array.isArray(groups) ? groups : [];
  for (const rawName of source) {
    const name = String(rawName || '').trim().slice(0, MAX_GROUP_NAME_LEN);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    ordered.push(name);
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
  const allProducts = [];
  const ownerMap = index.productOwnerMap;
  const byId = index.productById;
  ownerMap.clear();
  byId.clear();
  const users = db.users;
  for (let u = 0; u < users.length; u++) {
    const user = users[u];
    const products = user.products;
    if (!products || !products.length) continue;
    const sellerId = user.id;
    const sellerName = user.displayName;
    const sellerAvatarUrl = user.avatarUrl;
    const sellerAppNumberId = user.appNumberId;
    const nameLower = (sellerName || '').toLowerCase();
    for (let p = 0; p < products.length; p++) {
      const product = products[p];
      product.sellerId = sellerId;
      product.sellerName = sellerName;
      product.sellerAvatarUrl = sellerAvatarUrl;
      product.sellerAppNumberId = sellerAppNumberId;
      ownerMap.set(product.id, user);
      byId.set(product.id, product);
      allProducts.push(product);
      if (product.listed === false) continue;
      if (Number(product.stock || 0) <= 0) continue;
      product._searchText = ((product.title || '') + ' ' + (product.desc || '') + ' ' + nameLower).toLowerCase();
      items.push(product);
    }
  }
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  allProducts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  index.mallItems = items;
  index.allProductsSorted = allProducts;
}

function rebuildRequestViewsIndex() {
  index.requestViewsByTarget.clear();
  for (const [targetId, requests] of index.requestsByTarget.entries()) {
    const views = [];
    for (const req of requests) {
      const fromUser = index.usersById.get(req.userId);
      if (!fromUser) continue;
      // Attach sender directly instead of spread-copying the entire request object
      req.sender = {
        id: fromUser.id,
        displayName: fromUser.displayName,
        avatarUrl: fromUser.avatarUrl,
        username: fromUser.username,
      };
      views.push(req);
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
      // Attach friend view directly to avoid spread-copying each relation object
      rel.friend = {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        appNumberId: u.appNumberId,
        remark: rel.remark,
      };
      views.push(rel);
    }
    index.friendViewsByUser.set(userId, views);
  }
}

function rebuildConversationBaseIndex() {
  index.directConvBasesByUser.clear();
  for (const conv of db.conversations) {
    if (conv.type !== 'direct') continue;
    const members = conv.members || [];
    if (members.length !== 2) continue;
    const [m1, m2] = members;
    const buildEntry = (memberId, peerId) => {
      const peer = index.usersById.get(peerId);
      const rel = peerId ? index.friendshipByPair.get(`${memberId}:${peerId}`) : null;
      return {
        id: conv.id, type: conv.type, name: conv.name, ownerId: conv.ownerId,
        members, announcement: conv.announcement, createdAt: conv.createdAt,
        lastMessageAt: conv.lastMessageAt,
        title: rel?.remark || peer?.displayName || '未知用户',
        peerAvatarUrl: peer?.avatarUrl, peerAppNumberId: peer?.appNumberId, peerIsFriend: !!rel,
      };
    };
    addToMapArray(index.directConvBasesByUser, m1, buildEntry(m1, m2));
    addToMapArray(index.directConvBasesByUser, m2, buildEntry(m2, m1));
  }
}

function rebuildIndexes() {
  index.usersById.clear();
  index.usersByName.clear();
  index.usersByPhone.clear();
  index.usersByAppNumber.clear();
  index.convById.clear();
  index.convByUser.clear();
  index.directConvByPair.clear();
  index.messagesByConv.clear();
  index.messagesById.clear();
  index.friendshipsByUser.clear();
  index.friendshipByPair.clear();
  index.friendViewsByUser.clear();
  index.directConvBasesByUser.clear();
  index.requestsByTarget.clear();
  index.requestViewsByTarget.clear();
  index.blacklistViewsByUser.clear();
  index.ordersById.clear();
  index.messageByClientKey.clear();
  index.mallItems = [];
  for (const user of db.users) {
    if (!Array.isArray(user.blacklist)) user.blacklist = [];
    if (!Array.isArray(user.products)) user.products = [];
    for (let pi = 0; pi < user.products.length; pi++) {
      const p = user.products[pi];
      const next = p && typeof p === 'object' ? p : {};
      if (next !== p) user.products[pi] = next;
      const rawStock = Number(next.stock);
      next.stock = Number.isFinite(rawStock) ? Math.max(0, Math.floor(rawStock)) : 99;
      next.listed = next.listed !== false;
    }
    user.paymentCodes = normalizePaymentCodes(user.paymentCodes);
    user.role = normalizeUserRole(user);
    if (!user.status) user.status = 'active';
    user.customGroups = normalizeUserCustomGroups(user.customGroups);
    user.phone = normalizePhone(user.phone || '');
    // Ensure product presets exist; auto-collect from existing products if empty
    const needCats = !Array.isArray(user.categoryPresets);
    const needSpecs = !Array.isArray(user.specPresets);
    if (needCats || needSpecs) {
      const cats = needCats ? new Set() : null;
      const specs = needSpecs ? new Set() : null;
      for (const p of user.products) {
        if (cats && p.category) { const parts = p.category.split(CATEGORY_SPLIT_RE); for (let j = 0; j < parts.length; j++) { const c = parts[j].trim(); if (c) cats.add(c); } }
        if (specs && Array.isArray(p.specs)) { for (let j = 0; j < p.specs.length; j++) { if (p.specs[j]) specs.add(p.specs[j]); } }
      }
      if (cats) user.categoryPresets = [...cats].slice(0, 50);
      if (specs) user.specPresets = [...specs].slice(0, 50);
    }
    if (!user.appNumberId) {
      user.appNumberId = generateUniqueAppNumberId();
    }
    index.usersById.set(user.id, user);
    index.usersByName.set(user.username, user);
    if (user.phone) index.usersByPhone.set(user.phone, user);
    index.usersByAppNumber.set(user.appNumberId, user);
  }
  for (const conv of db.conversations) {
    if (!conv.clearedAt) conv.clearedAt = {};
    if (!conv.lastRead) conv.lastRead = {};
    if (!Array.isArray(conv.mutedBy)) conv.mutedBy = [];
    if (!Array.isArray(conv.pinnedBy)) conv.pinnedBy = [];
    if (!Array.isArray(conv.members)) conv.members = [];
    // Pre-built member Set for O(1) membership checks in hot paths
    conv._memberSet = new Set(conv.members);
    index.convById.set(conv.id, conv);
    for (const memberId of conv.members) addToMapArray(index.convByUser, memberId, conv);
    if (conv.type === 'direct' && conv.members.length === 2) {
      index.directConvByPair.set(`${conv.members[0]}:${conv.members[1]}`, conv);
      index.directConvByPair.set(`${conv.members[1]}:${conv.members[0]}`, conv);
    }
  }
  for (const msg of db.messages) {
    if (!Array.isArray(msg.deletedBy)) msg.deletedBy = [];
    addToMapArray(index.messagesByConv, msg.conversationId, msg);
    index.messagesById.set(msg.id, msg);
    if (msg.clientMessageId && msg.senderId) index.messageByClientKey.set(`${msg.conversationId}:${msg.senderId}:${msg.clientMessageId}`, msg);
  }
  index.ordersByBuyer.clear();
  index.ordersBySeller.clear();
  for (const order of db.orders || []) {
    if (!Array.isArray(order.items)) order.items = [];
    if (!order.status) order.status = 'accepted';
    if (typeof order.priceAdjustmentLocked !== 'boolean') order.priceAdjustmentLocked = false;
    if (!('pendingPrice' in order)) order.pendingPrice = null;
    if (!('pendingPriceRequestedBy' in order)) order.pendingPriceRequestedBy = null;
    if (!Array.isArray(order.deletedBy)) order.deletedBy = [];
    index.ordersById.set(order.id, order);
    if (order.buyerId) addToMapArray(index.ordersByBuyer, order.buyerId, order);
    if (order.sellerId) addToMapArray(index.ordersBySeller, order.sellerId, order);
  }

  for (const rel of db.friendships) {
    addToMapArray(index.friendshipsByUser, rel.userId, rel);
    index.friendshipByPair.set(`${rel.userId}:${rel.friendId}`, rel);
  }
  index.friendRequestsById.clear();
  for (const req of db.friendRequests) {
    index.friendRequestsById.set(req.id, req);
    if (req.status === 'pending') addToMapArray(index.requestsByTarget, req.targetId, req);
  }
  rebuildFriendViewsIndex();
  rebuildConversationBaseIndex();
  rebuildRequestViewsIndex();
  rebuildBlacklistViewsIndex();
  rebuildMallIndex();
}

// Targeted index helpers — avoid full rebuildIndexes() for single-entity mutations
function indexNewUser(user) {
  user.role = normalizeUserRole(user);
  if (!user.status) user.status = 'active';
  if (!Array.isArray(user.blacklist)) user.blacklist = [];
  if (!Array.isArray(user.products)) user.products = [];
  user.paymentCodes = normalizePaymentCodes(user.paymentCodes);
  user.customGroups = normalizeUserCustomGroups(user.customGroups);
  user.phone = normalizePhone(user.phone || '');
  if (!Array.isArray(user.categoryPresets)) user.categoryPresets = [];
  if (!Array.isArray(user.specPresets)) user.specPresets = [];
  index.usersById.set(user.id, user);
  if (user.username) index.usersByName.set(user.username, user);
  if (user.phone) index.usersByPhone.set(user.phone, user);
  if (user.appNumberId) index.usersByAppNumber.set(user.appNumberId, user);
}

function indexNewConversation(conv) {
  if (!conv.clearedAt) conv.clearedAt = {};
  if (!conv.lastRead) conv.lastRead = {};
  if (!Array.isArray(conv.mutedBy)) conv.mutedBy = [];
  if (!Array.isArray(conv.pinnedBy)) conv.pinnedBy = [];
  if (!Array.isArray(conv.members)) conv.members = [];
  conv._memberSet = new Set(conv.members);
  index.convById.set(conv.id, conv);
  for (const memberId of conv.members) addToMapArray(index.convByUser, memberId, conv);
  if (conv.type === 'direct' && conv.members.length === 2) {
    index.directConvByPair.set(`${conv.members[0]}:${conv.members[1]}`, conv);
    index.directConvByPair.set(`${conv.members[1]}:${conv.members[0]}`, conv);
  }
  rebuildConversationBaseIndex();
}

function rebuildFriendshipIndexes() {
  index.friendshipsByUser.clear();
  index.friendshipByPair.clear();
  for (const rel of db.friendships) {
    addToMapArray(index.friendshipsByUser, rel.userId, rel);
    index.friendshipByPair.set(`${rel.userId}:${rel.friendId}`, rel);
  }
  rebuildFriendViewsIndex();
  rebuildConversationBaseIndex();
}

function rebuildFriendRequestMaps() {
  index.friendRequestsById.clear();
  index.requestsByTarget.clear();
  for (const req of db.friendRequests) {
    index.friendRequestsById.set(req.id, req);
    if (req.status === 'pending') addToMapArray(index.requestsByTarget, req.targetId, req);
  }
  rebuildRequestViewsIndex();
}

function rebuildFriendshipAndRequestIndexes() {
  rebuildFriendshipIndexes();
  rebuildFriendRequestMaps();
}

function rebuildRequestIndexesOnly() {
  rebuildFriendRequestMaps();
}

function rebuildMessageIndexes() {
  index.messagesByConv.clear();
  index.messageByClientKey.clear();
  index.messagesById.clear();
  for (const msg of db.messages) {
    if (!Array.isArray(msg.deletedBy)) msg.deletedBy = [];
    addToMapArray(index.messagesByConv, msg.conversationId, msg);
    index.messagesById.set(msg.id, msg);
    if (msg.clientMessageId && msg.senderId) index.messageByClientKey.set(`${msg.conversationId}:${msg.senderId}:${msg.clientMessageId}`, msg);
  }
}

// Trim per-conversation message arrays that exceed the cap, removing oldest entries from indexes
const MAX_MESSAGES_PER_CONV = 2000;
function trimMessageIndexes() {
  for (const [convId, msgs] of index.messagesByConv.entries()) {
    if (msgs.length <= MAX_MESSAGES_PER_CONV) continue;
    const overflow = msgs.length - MAX_MESSAGES_PER_CONV;
    const removed = msgs.splice(0, overflow);
    for (const msg of removed) {
      index.messagesById.delete(msg.id);
      if (msg.clientMessageId && msg.senderId) {
        index.messageByClientKey.delete(`${convId}:${msg.senderId}:${msg.clientMessageId}`);
      }
    }
  }
}

  return {
    addToMapArray, DEFAULT_GROUP, MAX_GROUPS, MAX_GROUP_NAME_LEN,
    normalizeUserCustomGroups, normalizeSingleGroupName,
    rebuildMallIndex, rebuildRequestViewsIndex, rebuildBlacklistViewsIndex,
    rebuildFriendViewsIndex, rebuildConversationBaseIndex,
    rebuildIndexes, indexNewUser, indexNewConversation,
    rebuildFriendshipIndexes, rebuildFriendRequestMaps,
    rebuildFriendshipAndRequestIndexes, rebuildRequestIndexesOnly,
    rebuildMessageIndexes, trimMessageIndexes,
  };
};
