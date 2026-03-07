function normalizeText(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
}

function isValidMediaUrl(value) {
  const url = String(value || '').trim();
  if (!url) return false;
  return /^https?:\/\//i.test(url) || url.startsWith('/uploads/');
}

function createProduct({ authUser, body, uid, rebuildMallIndex, schedulePersist, broadcastAll }) {
  const title = normalizeText(body.title, 80);
  const desc = normalizeText(body.desc, 500);
  const price = normalizeText(body.price, 24);
  const image = String(body.image || '').trim().slice(0, 512);
  if (!title || !price || !image) {
    return { ok: false, status: 400, error: 'missing_fields' };
  }
  if (!isValidMediaUrl(image)) {
    return { ok: false, status: 400, error: 'invalid_image_url' };
  }

  authUser.products.unshift({
    id: uid('p'),
    title,
    desc,
    price,
    image,
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
