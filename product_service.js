function normalizeText(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
}

function isValidMediaUrl(value) {
  const url = String(value || '').trim();
  if (!url) return false;
  return /^https?:\/\//i.test(url) || url.startsWith('/uploads/');
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
  const specs = Array.isArray(body.specs)
    ? body.specs.map((s) => normalizeText(s, 24)).filter(Boolean).slice(0, 12)
    : [];
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
  // Auto-add new categories/specs to user presets
  if (!Array.isArray(authUser.categoryPresets)) authUser.categoryPresets = [];
  if (!Array.isArray(authUser.specPresets)) authUser.specPresets = [];
  if (category) {
    const parts = category.split(/[\/,、]/);
    for (let i = 0; i < parts.length; i++) { const c = parts[i].trim(); if (c && !authUser.categoryPresets.includes(c)) authUser.categoryPresets.push(c); }
  }
  specs.forEach(s => { if (s && !authUser.specPresets.includes(s)) authUser.specPresets.push(s); });

  rebuildMallIndex();
  schedulePersist('product_create', { userId: authUser.id });
  broadcastAll('mall_updated', {});
  return { ok: true, status: 201, payload: { ok: true } };
}

function deleteProduct({ authUser, productId, rebuildMallIndex, schedulePersist, broadcastAll }) {
  const idx = (authUser.products || []).findIndex((p) => p.id === productId);
  if (idx === -1) return { ok: false, status: 404, error: 'not_found' };
  authUser.products.splice(idx, 1);
  rebuildMallIndex();
  schedulePersist('product_delete', { userId: authUser.id, productId });
  broadcastAll('mall_updated', {});
  return { ok: true, status: 200, payload: { ok: true } };
}

function updateProduct({ authUser, body, rebuildMallIndex, schedulePersist, broadcastAll }) {
  const productId = String(body.productId || '').trim();
  if (!productId) return { ok: false, status: 400, error: 'missing_product_id' };
  const product = (authUser.products || []).find((p) => p.id === productId);
  if (!product) return { ok: false, status: 404, error: 'not_found' };

  // Track whether significant fields changed (price/image) to auto-delist
  let significantChange = false;
  const wasListed = product.listed !== false;

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
    if (product.price !== price) significantChange = true;
    product.price = price;
  }
  if (body.stock !== undefined) {
    const stock = normalizeStock(body.stock);
    if (stock <= 0) return { ok: false, status: 400, error: 'invalid_stock' };
    product.stock = stock;
  }
  if (body.image !== undefined) {
    const image = String(body.image || '').trim().slice(0, 512);
    if (!image) return { ok: false, status: 400, error: 'invalid_image_url' };
    if (!isValidMediaUrl(image)) return { ok: false, status: 400, error: 'invalid_image_url' };
    if (product.image !== image) significantChange = true;
    product.image = image;
  }
  if (body.specs !== undefined) {
    product.specs = Array.isArray(body.specs)
      ? body.specs.map((s) => normalizeText(s, 24)).filter(Boolean).slice(0, 12)
      : [];
  }
  if (body.listed !== undefined) {
    product.listed = normalizeListed(body.listed, product.listed !== false);
  }

  // Auto-delist on significant changes (price/image) unless listing status was explicitly set
  let autoDelisted = false;
  if (significantChange && wasListed && body.listed === undefined) {
    product.listed = false;
    autoDelisted = true;
  }

  rebuildMallIndex();
  schedulePersist('product_update', { userId: authUser.id, productId: product.id });
  broadcastAll('mall_updated', {});
  return { ok: true, status: 200, payload: { ok: true, product, autoDelisted } };
}

module.exports = {
  createProduct,
  deleteProduct,
  updateProduct,
};
