/**
 * Unit tests for core service modules.
 * Run: node scripts/unit-tests.js
 */
const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}\n  ${e.message}`);
  }
}

// ============ order_utils.js ============
const { formatOrderSummary, normalizeText, findOrderById } = require('../order_utils');

test('formatOrderSummary: formats items correctly', () => {
  const items = [
    { title: '苹果', spec: '大号', quantity: 2 },
    { title: '香蕉', spec: '默认', quantity: 1 },
  ];
  assert.strictEqual(formatOrderSummary(items), '苹果(大号) x2，香蕉(默认) x1');
});

test('formatOrderSummary: empty array', () => {
  assert.strictEqual(formatOrderSummary([]), '');
});

test('formatOrderSummary: single item', () => {
  assert.strictEqual(formatOrderSummary([{ title: 'A', spec: 'S', quantity: 3 }]), 'A(S) x3');
});

test('normalizeText: trims and slices', () => {
  assert.strictEqual(normalizeText('  hello  ', 10), 'hello');
  assert.strictEqual(normalizeText('abcdefghij', 5), 'abcde');
});

test('normalizeText: handles null/undefined', () => {
  assert.strictEqual(normalizeText(null, 10), '');
  assert.strictEqual(normalizeText(undefined, 10), '');
});

test('findOrderById: finds by Map', () => {
  const order = { id: 'o1', total: 10 };
  const ordersById = new Map([['o1', order]]);
  assert.strictEqual(findOrderById('o1', { ordersById, db: { orders: [] } }), order);
});

test('findOrderById: falls back to db.orders', () => {
  const order = { id: 'o2', total: 20 };
  assert.strictEqual(findOrderById('o2', { ordersById: new Map(), db: { orders: [order] } }), order);
});

test('findOrderById: returns null when not found', () => {
  assert.strictEqual(findOrderById('o99', { ordersById: new Map(), db: { orders: [] } }), null);
});

// ============ server_crypto.js ============
const {
  uid, hashPassword, verifyPassword, normalizePhone, maskPhone,
  sanitizePublicUser, ensureUserActiveForAuth,
} = require('../server_crypto');

test('uid: generates prefixed unique IDs', () => {
  const id = uid('test');
  assert(id.startsWith('test_'));
  assert(id.length > 10);
  assert.notStrictEqual(uid('a'), uid('a'));
});

test('hashPassword + verifyPassword: round-trip', () => {
  const hashed = hashPassword('mypassword');
  assert(hashed.includes(':'));
  assert(verifyPassword('mypassword', hashed));
  assert(!verifyPassword('wrongpassword', hashed));
});

test('verifyPassword: handles empty/null', () => {
  assert(!verifyPassword('pass', ''));
  assert(!verifyPassword('pass', null));
  assert(!verifyPassword('pass', undefined));
});

test('verifyPassword: plain text fallback', () => {
  assert(verifyPassword('plain', 'plain'));
  assert(!verifyPassword('other', 'plain'));
});

test('normalizePhone: strips non-digits and normalizes', () => {
  const result = normalizePhone('139-1234-5678');
  assert(result === '13912345678' || result === '');
});

test('normalizePhone: returns empty for invalid', () => {
  assert.strictEqual(normalizePhone('abc'), '');
  assert.strictEqual(normalizePhone('1234'), '');
  assert.strictEqual(normalizePhone(''), '');
  assert.strictEqual(normalizePhone(null), '');
});

test('maskPhone: masks middle digits', () => {
  const masked = maskPhone('13912345678');
  assert(masked.includes('****'));
  assert.strictEqual(masked.length, 11);
});

test('maskPhone: handles empty', () => {
  assert.strictEqual(maskPhone(''), '');
  assert.strictEqual(maskPhone(null), '');
});

test('sanitizePublicUser: strips password', () => {
  const user = {
    id: 'u1', username: 'alice', displayName: 'Alice',
    password: 'secret_hash', phone: '13912345678',
    avatarUrl: '/av.png', signature: 'hi',
  };
  const safe = sanitizePublicUser(user);
  assert.strictEqual(safe.id, 'u1');
  assert.strictEqual(safe.displayName, 'Alice');
  assert.strictEqual(safe.password, undefined);
  assert(safe.phone.includes('****'));
});

test('sanitizePublicUser: includePhone reveals full phone', () => {
  const user = { id: 'u1', username: 'bob', displayName: 'Bob', phone: '13912345678' };
  const safe = sanitizePublicUser(user, { includePhone: true });
  assert.strictEqual(safe.phone, '13912345678');
});

test('ensureUserActiveForAuth: false for disabled', () => {
  assert(!ensureUserActiveForAuth({ status: 'disabled' }));
});

test('ensureUserActiveForAuth: truthy for active', () => {
  assert(ensureUserActiveForAuth({ id: 'u1', status: 'active' }));
});

test('ensureUserActiveForAuth: truthy for no status (default)', () => {
  assert(ensureUserActiveForAuth({ id: 'u1' }));
});

// ============ server_roles.js ============
const { normalizeUserRole } = require('../server_roles');

test('normalizeUserRole: returns admin/user', () => {
  assert.strictEqual(normalizeUserRole({ role: 'admin' }), 'admin');
  assert.strictEqual(normalizeUserRole({ role: 'user' }), 'user');
});

test('normalizeUserRole: defaults to user', () => {
  assert.strictEqual(normalizeUserRole({}), 'user');
  assert.strictEqual(normalizeUserRole({ role: '' }), 'user');
});

// ============ group_service.js (dependency injection) ============
const { createGroup, deleteGroup, renameGroup, reorderGroup } = require('../group_service');

const DEFAULT_GROUP = '我的好友';
const normalizeSingleGroupName = (name) => String(name || '').trim().slice(0, 20) || '';
const normalizeUserCustomGroups = (groups) => {
  const seen = new Set();
  const result = [];
  for (const g of groups) {
    const n = String(g || '').trim();
    if (n && !seen.has(n)) { seen.add(n); result.push(n); }
  }
  if (!result.includes(DEFAULT_GROUP)) result.unshift(DEFAULT_GROUP);
  return result;
};
const noop = () => {};

test('group_service: create group', () => {
  const user = { customGroups: [DEFAULT_GROUP] };
  const result = createGroup({
    authUser: user, rawName: '同事', defaultGroup: DEFAULT_GROUP,
    normalizeSingleGroupName, normalizeUserCustomGroups,
    rebuildFriendViewsIndex: noop, rebuildConversationBaseIndex: noop,
    schedulePersist: noop, broadcastToUser: noop,
  });
  assert(result.ok);
  assert(user.customGroups.includes('同事'));
});

test('group_service: duplicate group fails', () => {
  const user = { customGroups: [DEFAULT_GROUP, '同事'] };
  const result = createGroup({
    authUser: user, rawName: '同事', defaultGroup: DEFAULT_GROUP,
    normalizeSingleGroupName, normalizeUserCustomGroups,
    rebuildFriendViewsIndex: noop, rebuildConversationBaseIndex: noop,
    schedulePersist: noop, broadcastToUser: noop,
  });
  assert(!result.ok);
});

test('group_service: delete group', () => {
  const user = { customGroups: [DEFAULT_GROUP, '同事', '家人'] };
  const result = deleteGroup({
    authUser: user, groupNameRaw: '同事', defaultGroup: DEFAULT_GROUP,
    normalizeSingleGroupName, normalizeUserCustomGroups,
    friendshipsByUser: new Map(), rebuildFriendViewsIndex: noop,
    rebuildConversationBaseIndex: noop, schedulePersist: noop, broadcastToUser: noop,
  });
  assert(result.ok);
  assert(!user.customGroups.includes('同事'));
});

test('group_service: cannot delete default group', () => {
  const user = { customGroups: [DEFAULT_GROUP] };
  const result = deleteGroup({
    authUser: user, groupNameRaw: DEFAULT_GROUP, defaultGroup: DEFAULT_GROUP,
    normalizeSingleGroupName, normalizeUserCustomGroups,
    friendshipsByUser: new Map(), rebuildFriendViewsIndex: noop,
    rebuildConversationBaseIndex: noop, schedulePersist: noop, broadcastToUser: noop,
  });
  assert(!result.ok);
});

test('group_service: rename group', () => {
  const user = { customGroups: [DEFAULT_GROUP, '旧名'] };
  const result = renameGroup({
    authUser: user, groupNameRaw: '旧名', newNameRaw: '新名', defaultGroup: DEFAULT_GROUP,
    normalizeSingleGroupName, normalizeUserCustomGroups,
    friendshipsByUser: new Map(), rebuildFriendViewsIndex: noop,
    rebuildConversationBaseIndex: noop, schedulePersist: noop, broadcastToUser: noop,
  });
  assert(result.ok);
  assert(user.customGroups.includes('新名'));
  assert(!user.customGroups.includes('旧名'));
});

// ============ blacklist_service.js (dependency injection) ============
const { updateBlacklist } = require('../blacklist_service');

test('blacklist: add user', () => {
  const authUser = { id: 'u1', blacklist: [] };
  const target = { id: 'u2', displayName: 'Bob' };
  const index = { usersById: new Map([['u2', target]]) };
  const result = updateBlacklist({
    authUser, targetId: 'u2', action: 'add', index,
    rebuildBlacklistViewsIndex: noop, schedulePersist: noop,
  });
  assert(result.ok);
  assert(authUser.blacklist.includes('u2'));
});

test('blacklist: remove user', () => {
  const authUser = { id: 'u1', blacklist: ['u2'] };
  const target = { id: 'u2', displayName: 'Bob' };
  const index = { usersById: new Map([['u2', target]]) };
  const result = updateBlacklist({
    authUser, targetId: 'u2', action: 'remove', index,
    rebuildBlacklistViewsIndex: noop, schedulePersist: noop,
  });
  assert(result.ok);
  assert(!authUser.blacklist.includes('u2'));
});

test('blacklist: cannot blacklist self', () => {
  const authUser = { id: 'u1', blacklist: [] };
  const index = { usersById: new Map([['u1', authUser]]) };
  const result = updateBlacklist({
    authUser, targetId: 'u1', action: 'add', index,
    rebuildBlacklistViewsIndex: noop, schedulePersist: noop,
  });
  assert(!result.ok);
  assert.strictEqual(result.status, 400);
});

test('blacklist: invalid action', () => {
  const result = updateBlacklist({
    authUser: { id: 'u1' }, targetId: 'u2', action: 'invalid',
    index: { usersById: new Map() },
    rebuildBlacklistViewsIndex: noop, schedulePersist: noop,
  });
  assert(!result.ok);
});

// ============ Results ============
console.log(`\nUnit tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
else console.log('All unit tests passed!');
