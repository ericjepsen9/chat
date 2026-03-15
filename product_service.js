const { normalizeText } = require('./order_utils');

const RE_HTTP_URL = /^https?:\/\//i;
const RE_CATEGORY_SPLIT = /[\/,、]/;

function isValidMediaUrl(value) {
  const url = String(value || '').trim();
  if (!url) return false;
  return RE_HTTP_URL.test(url) || url.startsWith('/uploads/');
}

function normalizeStock(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function normalizeListed(value, defaultValue = true) {
  if (value === undefined) return !!defaultValue;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'false' || v === '0') return false;
    if (v === 'true' || v === '1') return true;
  }
  return !!value;
}

function createProduct({ authUser, body, uid, rebuildMallIndex, schedulePersist, broadcastAll }) {
  const title = normalizeText(body.title, 80);
  const category = normalizeText(body.category, 24);
  const desc = normalizeText(body.desc, 500);
  const price = normalizeText(body.price, 24);
  let specs;
  if (Array.isArray(body.specs)) {
    specs = [];
    for (let i = 0; i < body.specs.length && specs.length < 12; i++) {
      const s = normalizeText(body.specs[i], 24);
      if (s) specs.push(s);
    }
  } else {
    specs = [];
  }
  const stock = normalizeStock(body.stock);
  const image = String(body.image || '').trim().slice(0, 512);
  if (!title || !price || !image) {
    return { ok: false, status: 400, error: 'missing_fields' };
  }
  if (stock <= 0) {
    return { ok: false, status: 400, error: 'invalid_stock' };
  }
  if (!isValidMediaUrl(image)) {
    return { ok: false, status: 400, error: 'invalid_image_url' };
  }

  if (!Array.isArray(authUser.products)) authUser.products = [];
  authUser.products.unshift({
    id: uid('p'),
    title,
    category,
    desc,
    price,
    image,
    specs,
    stock,
    listed: normalizeListed(body.listed, true),
    createdAt: Date.now(),
  });
  // Auto-add new categories/specs to user presets (Set-based O(1) dedup)
  if (!Array.isArray(authUser.categoryPresets)) authUser.categoryPresets = [];
  if (!Array.isArray(authUser.specPresets)) authUser.specPresets = [];
  if (category) {
    const existingCats = new Set(authUser.categoryPresets);
    const parts = category.split(RE_CATEGORY_SPLIT);
    for (let i = 0; i < parts.length; i++) { const c = parts[i].trim(); if (c && !existingCats.has(c) && authUser.categoryPresets.length < 50) { authUser.categoryPresets.push(c); existingCats.add(c); } }
  }
  if (specs.length) {
    const existingSpecs = new Set(authUser.specPresets);
    for (let i = 0; i < specs.length; i++) { const s = specs[i]; if (s && !existingSpecs.has(s) && authUser.specPresets.length < 50) { authUser.specPresets.push(s); existingSpecs.add(s); } }
  }

  rebuildMallIndex();
  schedulePersist('product_create', { userId: authUser.id });
  broadcastAll('mall_updated', {});
  return { ok: true, status: 201, payload: { ok: true } };
}

function deleteProduct({ authUser, productId, rebuildMallIndex, schedulePersist, broadcastAll }) {
  const products = authUser.products || [];
  let idx = -1;
  for (let i = 0; i < products.length; i++) { if (products[i].id === productId) { idx = i; break; } }
  if (idx === -1) return { ok: false, status: 404, error: 'not_found' };
  products.splice(idx, 1);
  rebuildMallIndex();
  schedulePersist('product_delete', { userId: authUser.id, productId });
  broadcastAll('mall_updated', {});
  return { ok: true, status: 200, payload: { ok: true } };
}

function updateProduct({ authUser, body, rebuildMallIndex, schedulePersist, broadcastAll }) {
  const productId = String(body.productId || '').trim();
  if (!productId) return { ok: false, status: 400, error: 'missing_product_id' };
  const products = authUser.products || [];
  let product = null;
  for (let i = 0; i < products.length; i++) { if (products[i].id === productId) { product = products[i]; break; } }
  if (!product) return { ok: false, status: 404, error: 'not_found' };

  // Track field-level changes for downstream notifications
  const changes = {};

  if (body.title !== undefined) {
    const title = normalizeText(body.title, 80);
    if (!title) return { ok: false, status: 400, error: 'invalid_title' };
    product.title = title;
  }
  if (body.category !== undefined) product.category = normalizeText(body.category, 24);
  if (body.desc !== undefined) product.desc = normalizeText(body.desc, 500);
  if (body.price !== undefined) {
    const price = normalizeText(body.price, 24);
    if (!price) return { ok: false, status: 400, error: 'invalid_price' };
    if (product.price !== price) changes.price = price;
    product.price = price;
  }
  if (body.stock !== undefined) {
    const stock = normalizeStock(body.stock);
    if (stock <= 0) return { ok: false, status: 400, error: 'invalid_stock' };
    if (product.stock !== stock) changes.stock = stock;
    product.stock = stock;
  }
  if (body.image !== undefined) {
    const image = String(body.image || '').trim().slice(0, 512);
    if (!image) return { ok: false, status: 400, error: 'invalid_image_url' };
    if (!isValidMediaUrl(image)) return { ok: false, status: 400, error: 'invalid_image_url' };
    if (product.image !== image) changes.image = true;
    product.image = image;
  }
  if (body.specs !== undefined) {
    if (Array.isArray(body.specs)) {
      const normSpecs = [];
      for (let i = 0; i < body.specs.length && normSpecs.length < 12; i++) {
        const s = normalizeText(body.specs[i], 24);
        if (s) normSpecs.push(s);
      }
      product.specs = normSpecs;
    } else {
      product.specs = [];
    }
  }
  if (body.listed !== undefined) {
    const newListed = normalizeListed(body.listed, product.listed !== false);
    if (product.listed !== newListed) changes.listed = newListed;
    product.listed = newListed;
  }

  rebuildMallIndex();
  schedulePersist('product_update', { userId: authUser.id, productId: product.id });
  broadcastAll('mall_updated', {});
  return { ok: true, status: 200, payload: { ok: true, product, changes } };
}

module.exports = {
  createProduct,
  deleteProduct,
  updateProduct,
};
