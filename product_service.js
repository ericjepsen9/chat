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

  authUser.products.unshift({
    id: uid('p'),
    title,
    category,
    desc,
    price,
    image,
    specs,
    stock,
    createdAt: Date.now(),
  });
  rebuildMallIndex();
  schedulePersist('product_create', { userId: authUser.id });
  broadcastAll('mall_updated', {});
  return { ok: true, status: 201, payload: { ok: true } };
}

function deleteProduct({ authUser, productId, rebuildMallIndex, schedulePersist, broadcastAll }) {
  authUser.products = authUser.products.filter((p) => p.id !== productId);
  rebuildMallIndex();
  schedulePersist('product_delete', { userId: authUser.id, productId });
  broadcastAll('mall_updated', {});
  return { ok: true, status: 200, payload: { ok: true } };
}

module.exports = {
  createProduct,
  deleteProduct,
};
