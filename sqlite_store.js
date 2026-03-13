'use strict';

const fs = require('fs');
const path = require('path');

function requireBetterSqlite3() {
  try {
    // eslint-disable-next-line global-require
    return require('better-sqlite3');
  } catch (e) {
    const msg = [
      'SQLite backend requested (USE_SQLITE=1), but dependency "better-sqlite3" is not installed.',
      'Run: npm i --save-optional better-sqlite3',
      'Or unset USE_SQLITE to fall back to JSON file storage.',
    ].join(' ');
    const err = new Error(msg);
    err.cause = e;
    throw err;
  }
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_products_time ON products(created_at);
  `);
}

function getSnapshot(db) {
  const readAll = (table) => db.prepare(`SELECT json FROM ${table}`).all().map((r) => JSON.parse(r.json));
  const readMessages = () => db.prepare('SELECT json FROM messages ORDER BY created_at ASC').all().map((r) => JSON.parse(r.json));
  const readOrders = () => db.prepare('SELECT json FROM orders ORDER BY created_at DESC').all().map((r) => JSON.parse(r.json));
  const readProducts = () => db.prepare('SELECT json FROM products ORDER BY created_at ASC').all().map((r) => JSON.parse(r.json));

  return {
    users: readAll('users'),
    friendships: readAll('friendships'),
    friendRequests: readAll('friend_requests'),
    conversations: readAll('conversations'),
    messages: readMessages(),
    orders: readOrders(),
    // products are embedded in users in current app model, but we also persist a flattened view for faster restore.
    // If absent, server will rebuild from users.
    products: readProducts(),
  };
}

function saveSnapshot(db, snapshot) {
  const tx = db.transaction((snap) => {
    db.exec('DELETE FROM users; DELETE FROM friendships; DELETE FROM friend_requests; DELETE FROM conversations; DELETE FROM messages; DELETE FROM orders; DELETE FROM products;');

    const insUser = db.prepare('INSERT INTO users(id,json) VALUES(?,?)');
    const insFriend = db.prepare('INSERT INTO friendships(id,json) VALUES(?,?)');
    const insReq = db.prepare('INSERT INTO friend_requests(id,json) VALUES(?,?)');
    const insConv = db.prepare('INSERT INTO conversations(id,json) VALUES(?,?)');
    const insMsg = db.prepare('INSERT INTO messages(id,conversation_id,created_at,json) VALUES(?,?,?,?)');
    const insOrder = db.prepare('INSERT INTO orders(id,buyer_id,seller_id,created_at,json) VALUES(?,?,?,?,?)');
    const insProd = db.prepare('INSERT INTO products(id,seller_id,created_at,json) VALUES(?,?,?,?)');

    for (const u of snap.users || []) insUser.run(u.id, JSON.stringify(u));
    for (const f of snap.friendships || []) insFriend.run(f.id, JSON.stringify(f));
    for (const r of snap.friendRequests || []) insReq.run(r.id, JSON.stringify(r));
    for (const c of snap.conversations || []) insConv.run(c.id, JSON.stringify(c));
    for (const m of snap.messages || []) insMsg.run(m.id, m.conversationId, m.createdAt || Date.now(), JSON.stringify(m));
    for (const o of snap.orders || []) insOrder.run(o.id, o.buyerId, o.sellerId, o.createdAt || Date.now(), JSON.stringify(o));

    // products: prefer snap.products if provided; otherwise flatten from users.
    const prods = Array.isArray(snap.products) && snap.products.length
      ? snap.products
      : (snap.users || []).flatMap((u) => (Array.isArray(u.products) ? u.products.map((p) => ({ ...p, sellerId: u.id })) : []));

    for (const p of prods) { if (p.id) insProd.run(p.id, p.sellerId, p.createdAt || Date.now(), JSON.stringify(p)); }

    db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('snapshot_updated_at', String(Date.now()));
  });

  tx(snapshot);
}

function ensureImportedIfEmpty(db, jsonFilePath, defaultSnapshotFactory) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get('imported');
  if (row && row.value === '1') return;

  let snapshot = null;
  if (fs.existsSync(jsonFilePath)) {
    try {
      snapshot = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
    } catch (_) {
      snapshot = null;
    }
  }
  if (!snapshot) snapshot = defaultSnapshotFactory();

  // Normalize keys to what server expects.
  const normalized = {
    users: [], friendships: [], friendRequests: [], conversations: [], messages: [], orders: [],
    ...snapshot,
  };

  saveSnapshot(db, normalized);
  db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('imported', '1');
}

function openSqliteStore(sqliteFilePath, jsonFilePath, defaultSnapshotFactory) {
  const Database = requireBetterSqlite3();
  const db = new Database(sqliteFilePath);
  initSchema(db);
  ensureImportedIfEmpty(db, jsonFilePath, defaultSnapshotFactory);

  return {
    load: () => {
      const snap = getSnapshot(db);
      // Server currently embeds products inside users; rebuild that view if needed.
      if (Array.isArray(snap.products) && snap.products.length) {
        const bySeller = new Map();
        for (const p of snap.products) {
          if (!bySeller.has(p.sellerId)) bySeller.set(p.sellerId, []);
          bySeller.get(p.sellerId).push(p);
        }
        for (const u of snap.users) {
          const arr = bySeller.get(u.id);
          if (arr) u.products = arr.map(({ sellerId, ...rest }) => rest);
        }
      }
      return {
        users: [], friendships: [], friendRequests: [], conversations: [], messages: [], orders: [],
        ...snap,
      };
    },
    save: (snapshot) => saveSnapshot(db, snapshot),
    close: () => {
      try { db.close(); } catch (_) {}
    },
  };
}

module.exports = {
  openSqliteStore,
};
